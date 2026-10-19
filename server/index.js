import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { Store } from './store.js';
import { MenuService, createLineClient } from './service.js';

export function createApp({ service, verify, clientId, origin }) {
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: '來源網站未獲允許' });
    if (req.headers.origin === origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/health' && req.method === 'GET') return send(200, { ok: true });
    if (path === '/api/config' && req.method === 'GET') return send(200, { googleClientId: clientId });
    if (path === '/api/rpc' && req.method === 'POST') {
      let user;
      try {
        const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
        if (!match || match[1].length > 10000) throw new Error('missing token');
        user = await verify(match[1]);
      } catch { return send(401, { error: '請重新使用擁有者 Google 帳號登入' }); }
      try {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: '必須使用 JSON' });
        let length = 0; const chunks = [];
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 3200000) { send(413, { error: '資料超過上限' }); req.resume(); return; }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof body.method !== 'string' || !Array.isArray(body.args)) return send(400, { error: '無效的操作資料' });
        return send(200, await service.call(body.method, body.args, user));
      } catch (error) { return send(400, { error: error.message || '操作失敗' }); }
    }
    const files = { '/': 'index.html', '/index.html': 'index.html', '/api.js': 'api.js', '/config.js': 'config.js', '/migration.js': 'migration.js' };
    if (req.method === 'GET' && files[path]) {
      try {
        const bytes = await readFile(new URL(`../public/${files[path]}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' }); return res.end(bytes);
      } catch { return send(404, { error: '找不到檔案' }); }
    }
    send(404, { error: '找不到此路徑' });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { GOOGLE_CLIENT_ID, OWNER_EMAIL, FRONTEND_ORIGIN, LINE_CHANNEL_ACCESS_TOKEN, DATA_DIR = './data', PORT = '3000' } = process.env;
  for (const [key, value] of Object.entries({ GOOGLE_CLIENT_ID, OWNER_EMAIL, FRONTEND_ORIGIN })) {
    if (!value || value.startsWith('replace-')) throw new Error(`請先設定 ${key}`);
  }
  if (new URL(FRONTEND_ORIGIN).origin !== FRONTEND_ORIGIN) throw new Error('FRONTEND_ORIGIN 只能填網址來源，不含路徑或結尾斜線');
  const auth = new OAuth2Client(GOOGLE_CLIENT_ID);
  const service = new MenuService(new Store(DATA_DIR), createLineClient(LINE_CHANNEL_ACCESS_TOKEN));
  const verify = async token => {
    const ticket = await auth.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const user = ticket.getPayload();
    if (!user?.email_verified || user.email?.toLowerCase() !== OWNER_EMAIL.trim().toLowerCase()) throw new Error('非擁有者');
    return { email: user.email };
  };
  const app = createApp({ service, verify, clientId: GOOGLE_CLIENT_ID, origin: FRONTEND_ORIGIN });
  app.requestTimeout = 30000;
  app.listen(Number(PORT), '0.0.0.0', () => console.log(`YSB server listening on ${PORT}`));
}
