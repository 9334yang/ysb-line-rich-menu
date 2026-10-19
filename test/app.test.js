import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Store } from '../server/store.js';
import { MenuService, validateImage } from '../server/service.js';
import { normalizeMenus, buildRichMenu } from '../server/model.js';
import { createApp } from '../server/index.js';

const draft = () => Object.fromEntries(['about','member'].map(tab => [tab, { items: [{ name: tab, url: 'https://example.com', bounds: { x:0,y:300,width:500,height:500 }, shape:'rectangle' }] }]));
async function fixture(t, line) {
  const directory = await mkdtemp(join(tmpdir(), 'ysb-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  return { store, service: new MenuService(store, line) };
}
test('bounds and HTTPS validation; LINE geometry retains switch tabs', () => {
  const d = normalizeMenus(draft());
  assert.equal(buildRichMenu('about', ['a','b'], d).areas.length, 3);
  const bad = draft(); bad.about.items[0].bounds.y = 0;
  assert.throws(() => normalizeMenus(bad), /超出/);
  bad.about.items[0].bounds.y = 300; bad.about.items[0].url = 'javascript:alert(1)';
  assert.throws(() => normalizeMenus(bad), /HTTPS/);
});
test('image content, MIME and dimensions are validated on backend', async () => {
  const png = await sharp({ create: { width:2500,height:1686,channels:3,background:'#315f49' } }).png().toBuffer();
  const url = 'data:image/png;base64,' + png.toString('base64');
  assert.equal((await validateImage(url, 'test')).mime, 'image/png');
  await assert.rejects(validateImage(url.replace('image/png', 'image/jpeg'), 'bad'));
  await assert.rejects(validateImage('data:image/png;base64,aGVsbG8=', 'bad'));
});
test('prepare leaves current menu aliases alone; failed verification never deletes old menus', async t => {
  const calls = []; let count = 0;
  const { store, service } = await fixture(t, async (method,path) => {
    calls.push([method,path]);
    if (path === '/richmenu') return { richMenuId: 'new'+(++count) };
    if (path === '/user/all/richmenu' && method === 'GET') return { richMenuId:'old1' };
    return {};
  });
  await store.write({ draft:draft(), images:{about:{},member:{}}, publish:{active:{menus:['old1','old2'],aliases:['old-a','old-b']}} });
  await service.call('ysbPrepareRichMenus', [], {});
  assert.ok(calls.every(([,path]) => !path.includes('old-')));
  await assert.rejects(service.call('ysbPublishDefaultRichMenu', [], {}), /停止清理/);
  assert.ok(calls.every(([method]) => method !== 'DELETE'));
});
test('publish succeeds even if cleanup fails; cleanup queue survives restart', async t => {
  let count = 0;
  const { store, service } = await fixture(t, async (method,path) => {
    if (path === '/richmenu') return {richMenuId:'new'+(++count)};
    if (path === '/user/all/richmenu' && method === 'GET') return {richMenuId:'new1'};
    if (path === '/richmenu/alias/list') throw new Error('upstream unavailable');
    return {};
  });
  await store.write({images:{about:{},member:{}},publish:{active:{menus:['old1','old2'],aliases:['old-a','old-b']}}});
  const result = await service.call('ysbPublishFromAdmin', [draft()], {});
  assert.equal(result.ok,true);
  assert.match(result.message,/待清理/);
  const restart = new Store(store.directory);
  assert.equal((await restart.read()).publish.pending[0].menus[0], 'old1');
});
test('operations are serialized and invalid backup leaves stored data intact', async t => {
  const { store, service } = await fixture(t, () => {});
  await service.call('saveMenuDraft', [draft()], {});
  const before = await store.read();
  await assert.rejects(service.call('importBackup',[{version:1,draft:draft(),images:{about:{dataUrl:'invalid'}}}],{}));
  assert.deepEqual(await store.read(), before);
  const order = [];
  await Promise.all([store.exclusive(async () => { await new Promise(resolve=>setTimeout(resolve,15)); order.push(1); }),store.exclusive(async()=>order.push(2))]);
  assert.deepEqual(order,[1,2]);
});
test('RPC rejects unauthenticated requests and unapproved origins; static server never serves secrets', async t => {
  const { service } = await fixture(t, () => {});
  const server = createApp({ service, clientId:'public-client', origin:'https://owner.github.io', verify:async token => {
    if (token !== 'valid') throw new Error('no'); return {email:'owner@example.com'};
  }});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/rpc',{method:'POST'})).status,401);
  assert.equal((await fetch(base+'/api/config',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/.env')).status,404);
  const response = await fetch(base+'/api/rpc',{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':'application/json'},body:JSON.stringify({method:'getMenuDraft',args:[]})});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).about.items,[]);
});
