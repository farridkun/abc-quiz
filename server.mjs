import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './lib/app.mjs';
import { MemoryStore } from './lib/memory-store.mjs';

// Local development server. Production runs on Netlify (netlify/functions/api.mjs
// with Netlify Blobs); here the same handler uses in-memory stores.
const root = dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' };
const security = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

export function createApp({ stores = { sessions: new MemoryStore(), rooms: new MemoryStore() } } = {}) {
  const handle = createHandler(stores);
  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(security)) res.setHeader(k, v);
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/health' || path.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handle(request, { ip: req.socket.remoteAddress });
      const out = {}; response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) out['set-cookie'] = cookies;
      res.writeHead(response.status, out);
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    const file = path === '/' || /^\/r\/[A-Z2-9]{6}$/.test(path) ? resolve(root, 'public/index.html') : resolve(root, 'public', '.' + decodeURIComponent(path));
    if (!['GET', 'HEAD'].includes(req.method) || !file.startsWith(resolve(root, 'public') + '/') || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Halaman tidak ditemukan.');
    }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'text/plain', 'Cache-Control': ['.html', '.js', '.css'].includes(extname(file)) ? 'no-cache' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  });
  return { server, stores, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.ABC_PORT || process.env.PORT || 3000), host = process.env.ABC_HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`ABC — Aku Butuh Code · http://${host}:${port} (in-memory; data resets on restart)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
