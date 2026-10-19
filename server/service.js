import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { initialMenus, normalizeMenus, buildRichMenu, YSB_TABS } from './model.js';

export function createLineClient(token, fetcher = fetch) {
  return async (method, path, payload, image = false) => {
    if (!token) throw new Error('後端尚未設定 LINE_CHANNEL_ACCESS_TOKEN');
    const response = await fetcher(`https://${image ? 'api-data' : 'api'}.line.me/v2/bot${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : {
        'Content-Type': image ? payload.mime : 'application/json'
      }) },
      body: payload === undefined ? undefined : image ? Buffer.from(payload.base64, 'base64') : JSON.stringify(payload),
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) {
      // Do not echo credentials or arbitrary upstream response bodies to the browser.
      const error = new Error(`LINE API 回應 HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  };
}

export async function validateImage(dataUrl, name) {
  const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl));
  if (!match) throw new Error('圖片格式必須為 PNG 或 JPEG');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('圖片不得超過 1 MB');
  const metadata = await sharp(bytes, { limitInputPixels: 5000000 }).metadata();
  if (metadata.width !== 2500 || metadata.height !== 1686 ||
      metadata.format !== (match[1] === 'image/png' ? 'png' : 'jpeg')) {
    throw new Error('圖片必須為 2500 × 1686 的 PNG 或 JPEG');
  }
  return { mime: match[1], base64: bytes.toString('base64'), name: String(name || '選單圖片').slice(0, 120), updatedAt: new Date().toISOString() };
}

export class MenuService {
  constructor(store, line) { this.store = store; this.line = line; }
  async prepare(state) {
    const draft = normalizeMenus(state.draft || initialMenus());
    for (const tab of YSB_TABS) {
      if (!state.images?.[tab]) throw new Error('請先上傳兩個分頁的圖片');
      if (!draft[tab].items.length || draft[tab].items.some(item => !item.name || !item.url)) {
        throw new Error('每個分頁至少需一個已填妥名稱和網址的區塊');
      }
    }
    // Use a new pair of aliases each time. Preparing never changes live aliases.
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const aliases = YSB_TABS.map(tab => `ysb-${tab}-${suffix}`);
    const menus = [];
    state.publish ||= {};
    state.publish.staging = { menus, aliases, startedAt: new Date().toISOString() };
    await this.store.write(state);
    for (let i = 0; i < 2; i++) {
      const created = await this.line('POST', '/richmenu', buildRichMenu(YSB_TABS[i], aliases, draft));
      if (!created.richMenuId) throw new Error('LINE 未回傳 Rich Menu ID');
      menus.push(created.richMenuId);
      await this.store.write(state);
      await this.line('POST', `/richmenu/${encodeURIComponent(created.richMenuId)}/content`, state.images[YSB_TABS[i]], true);
    }
    for (let i = 0; i < 2; i++) {
      await this.line('POST', '/richmenu/alias', { richMenuAliasId: aliases[i], richMenuId: menus[i] });
    }
    state.publish.prepared = { menus: [...menus], aliases, preparedAt: new Date().toISOString() };
    delete state.publish.staging;
    await this.store.write(state);
    return state.publish;
  }
  async activate(state) {
    const p = state.publish;
    if (!p?.prepared || p.prepared.menus.length !== 2) throw new Error('請先準備新版選單');
    const next = p.prepared;
    await this.line('POST', `/user/all/richmenu/${encodeURIComponent(next.menus[0])}`);
    const actual = await this.line('GET', '/user/all/richmenu');
    if (actual.richMenuId !== next.menus[0]) throw new Error('LINE 預設選單尚未確認更新，停止清理舊版');
    const old = p.active;
    p.pending ||= [];
    if (old && old.menus[0] !== next.menus[0]) p.pending.push(old);
    p.active = next;
    p.published = true;
    p.publishedAt = new Date().toISOString();
    await this.store.write(state);
    return p;
  }
  async cleanup(state) {
    const p = state.publish;
    const result = { deleted: [], failed: [] };
    if (!p?.pending?.length) return result;
    const actual = await this.line('GET', '/user/all/richmenu');
    const aliases = (await this.line('GET', '/richmenu/alias/list')).aliases || [];
    if (actual.richMenuId !== p.active.menus[0] || p.active.aliases.some((id, i) =>
      !aliases.some(a => a.richMenuAliasId === id && a.richMenuId === p.active.menus[i]))) {
      throw new Error('LINE 預設選單或分頁 Alias 與新版不一致，停止清理');
    }
    const remaining = [];
    for (const old of p.pending) {
      let failed = false;
      for (const id of old.aliases || []) {
        if (p.active.aliases.includes(id)) continue;
        try { await this.line('DELETE', `/richmenu/alias/${encodeURIComponent(id)}`); }
        catch (e) { if (e.status !== 404) { failed = true; result.failed.push({ id, error: e.message }); } }
      }
      for (const id of old.menus || []) {
        if (p.active.menus.includes(id)) continue;
        // Never remove a menu that any currently known alias still references,
        // except an alias from this retired version (removed above).
        if (aliases.some(a => a.richMenuId === id && !(old.aliases || []).includes(a.richMenuAliasId))) {
          failed = true; result.failed.push({ id, error: '其他 Alias 仍在使用這個選單' }); continue;
        }
        if (failed) continue;
        try { await this.line('DELETE', `/richmenu/${encodeURIComponent(id)}`); result.deleted.push(id); }
        catch (e) { if (e.status !== 404) { failed = true; result.failed.push({ id, error: e.message }); } }
      }
      if (failed) remaining.push(old);
    }
    p.pending = remaining;
    await this.store.write(state);
    return result;
  }
  async call(method, args, user) {
    return this.store.exclusive(async () => {
      const state = await this.store.read();
      switch (method) {
        case 'exportBackup': return { version: 1, draft: state.draft || initialMenus(), images:
          Object.fromEntries(YSB_TABS.map(tab => {
            const img = state.images?.[tab];
            return [tab, img ? { dataUrl: `data:${img.mime};base64,${img.base64}`, name: img.name } : null];
          })) };
        case 'importBackup': {
          const backup = args[0];
          if (backup?.version !== 1) throw new Error('不支援的匯入檔');
          const draft = normalizeMenus(backup.draft);
          const images = {};
          for (const tab of YSB_TABS) {
            if (backup.images?.[tab]) images[tab] = await validateImage(backup.images[tab].dataUrl, backup.images[tab].name);
          }
          state.draft = draft; state.images = images;
          await this.store.write(state); return { ok: true };
        }
        case 'ysbGetCurrentGoogleUser': return { authorized: true, email: user.email, role: 'owner' };
        case 'getMenuDraft': return state.draft || initialMenus();
        case 'saveMenuDraft':
          state.draft = normalizeMenus(args[0]); await this.store.write(state);
          return { ok: true, savedAt: new Date().toISOString() };
        case 'ysbGetImageSettings': return Object.fromEntries(YSB_TABS.map(tab => [tab, state.images?.[tab] ? {
          name: state.images[tab].name, updatedAt: state.images[tab].updatedAt
        } : null]));
        case 'ysbGetMenuImageData': {
          if (!YSB_TABS.includes(args[0])) throw new Error('無效的分頁');
          const image = state.images?.[args[0]];
          return image ? { dataUrl: `data:${image.mime};base64,${image.base64}`, name: image.name, updatedAt: image.updatedAt } : null;
        }
        case 'ysbUploadMenuImage': {
          if (!YSB_TABS.includes(args[0])) throw new Error('無效的分頁');
          const image = await validateImage(args[1], args[2]);
          state.images ||= {}; state.images[args[0]] = image;
          await this.store.write(state);
          return { ok: true, name: image.name, updatedAt: image.updatedAt };
        }
        case 'ysbPrepareRichMenus': return this.prepare(state);
        case 'ysbPublishDefaultRichMenu': return this.activate(state);
        case 'ysbCleanupPublishedMenus': return this.cleanup(state);
        case 'ysbPublishFromAdmin': {
          state.draft = normalizeMenus(args[0]); await this.store.write(state);
          await this.prepare(state); await this.activate(state);
          let cleanup;
          try { cleanup = await this.cleanup(state); }
          catch (e) { cleanup = { failed: [], error: e.message }; }
          return { ok: true, publishedAt: state.publish.publishedAt,
            aboutMenuId: state.publish.active.menus[0], memberMenuId: state.publish.active.menus[1], cleanup,
            message: cleanup.failed.length || cleanup.error ? '新版發布完成；部分舊版待清理' : 'LINE 圖文選單已更新，舊版清理完成' };
        }
        case 'ysbCheckPublishStatus': return { state: state.publish || {}, actual: await this.line('GET', '/user/all/richmenu') };
        case 'ysbRemoveDefaultRichMenu':
          await this.line('DELETE', '/user/all/richmenu'); state.publish ||= {}; state.publish.published = false;
          await this.store.write(state); return { ok: true };
        case 'ysbListAllRichMenus': return {
          ...(await this.line('GET', '/richmenu/list')), ...(await this.line('GET', '/richmenu/alias/list')),
          state: state.publish || {}
        };
        default: throw new Error('不支援的操作');
      }
    });
  }
}
