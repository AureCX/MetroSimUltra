// Grandville multiplayer server: WebSocket endpoint (/ws) for the game, session list (/api/sessions),
// health check (/health) and — when the game has been built (npm run build) — the game itself, so one
// free web service can host both. Run: node server/server.js  (PORT env var, default 8080).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accept } from './ws.js';
import { Hub } from './rooms.js';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webp': 'image/webp' };

const hub = new Hub();
const conns = new Map(); // socket -> player

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (url.pathname === '/health') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, players: [...hub.players.values()].filter((p) => p.online).length, sessions: hub.sessions.size })); return; }
  if (url.pathname === '/api/sessions') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(hub.list())); return; }
  // Static game files (optional).
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(fs.existsSync(ROOT) ? 404 : 200, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(fs.existsSync(ROOT) ? 'Not found' : 'Grandville multiplayer server is running. Open the game and enter this address in Multiplayer.');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
  const ws = accept(req, socket); if (!ws) return;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    let p = conns.get(ws);
    if (m.t === 'hello') { p = hub.hello(ws, m); conns.set(ws, p); flush(); return; }
    if (!p) { ws.send({ t: 'error', code: 'hello', message: 'Say hello first.' }); return; }
    switch (m.t) {
      case 'list': ws.send({ t: 'sessions', list: hub.list() }); break;
      case 'create': hub.create(p, m); break;
      case 'join': hub.join(p, m); break;
      case 'leave': hub.leave(p); ws.send({ t: 'left' }); break;
      case 'drive': hub.drive(p, m.drive); break;
      case 'state': hub.state(p, m.s || {}); break;
      case 'event': hub.event(p, m); break;
      case 'ping': ws.send({ t: 'pong', c: m.c, s: Date.now() }); break;
      default: break;
    }
    flush();
  });
  ws.on('close', () => { const p = conns.get(ws); conns.delete(ws); if (p && p.conn === ws) hub.disconnect(p); flush(); });
});

function flush() {
  for (const { to, msg } of hub.drain()) { const p = hub.players.get(to); if (p?.conn?.open) p.conn.send(msg); }
}
setInterval(() => { hub.tick(); flush(); }, 100);                      // 10 Hz state broadcast
setInterval(() => { hub.sweep(); flush(); for (const ws of conns.keys()) { if (!ws.alive) { ws.close(1001, 'timeout'); continue; } ws.alive = false; ws.ping(); } }, 15000);

server.listen(PORT, () => console.log(`Grandville multiplayer server on :${PORT} (ws path /ws)${fs.existsSync(ROOT) ? ', serving the game from dist/' : ''}`));
