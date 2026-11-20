// Minimal WebSocket server (RFC 6455) on Node's http module: handshake, masked client frames, text messages,
// ping/pong, close. No dependencies, so the server runs anywhere Node 18+ runs.
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

export class Socket {
  constructor(socket) {
    this.s = socket; this.buf = Buffer.alloc(0); this.open = true; this.handlers = {}; this.frags = [];
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
    socket.setNoDelay(true);
  }
  on(evt, fn) { this.handlers[evt] = fn; return this; }
  emit(evt, ...a) { this.handlers[evt]?.(...a); }
  send(obj) {
    if (!this.open) return;
    const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    this.frame(0x1, data);
  }
  frame(op, data) {
    const n = data.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
    try { this.s.write(Buffer.concat([head, data])); } catch { this.closed(); }
  }
  ping() { this.frame(0x9, Buffer.alloc(0)); }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    const b = Buffer.alloc(2 + Buffer.byteLength(reason)); b.writeUInt16BE(code, 0); b.write(reason, 2);
    this.frame(0x8, b); this.open = false; setTimeout(() => this.s.destroy(), 100); this.emit('close', code);
  }
  closed() { if (!this.open && this._done) return; this._done = true; const was = this.open; this.open = false; if (was) this.emit('close', 1006); }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1], fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_PAYLOAD) { this.close(1009, 'Message too big'); return; }
      if (!masked) { this.close(1002, 'Unmasked client frame'); return; }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4), payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.frame(0xA, payload); continue; }
      if (op === 0xA) { this.emit('pong'); continue; }
      if (op === 0x1 || op === 0x0) {
        this.frags.push(payload);
        if (fin) { const msg = Buffer.concat(this.frags).toString('utf8'); this.frags = []; this.emit('message', msg); }
      }
    }
  }
}

/** Upgrades an http request to a Socket (or rejects it). */
export function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return null; }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey}`, '', ''].join('\r\n'));
  return new Socket(socket);
}
