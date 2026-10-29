// Cruscotto Famiglia — server HTTP (Node 22+, nessuna dipendenza).
//   PORT=8790 DB=./data/famiglia.db PASSWORD=... node server.js
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDb } from './src/db.js';
import { makeApi } from './src/api.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || '0.0.0.0';
const DB = process.env.DB || join(ROOT, 'data', 'famiglia.db');
const PASSWORD = process.env.PASSWORD || '';   // facoltativa: accesso con utente qualsiasi e questa password

const db = openDb(DB);
const api = makeApi(db, { clock: process.env.OGGI || undefined });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function autorizzato(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Richiesta troppo grande'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('JSON non valido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const send = (res, status, data, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
};

const server = createServer(async (req, res) => {
  if (!autorizzato(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Cruscotto Famiglia"' }); return res.end('Accesso richiesto'); }
  try {
    if (req.url.startsWith('/api/')) {
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : null;
      return send(res, 200, await api(req.method, req.url, body));
    }
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Vietato', 'text/plain');
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) return send(res, 404, 'Non trovato', 'text/plain');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) {
    let status = e.status || 500, msg = e.message;
    if (/UNIQUE constraint/.test(msg)) { status = 409; msg = 'Esiste già un elemento con questo nome'; }
    else if (/FOREIGN KEY/.test(msg)) { status = 409; msg = 'È collegato ad altri dati: rimuovi prima quelli'; }
    if (status >= 500) console.error(e);
    send(res, status, { errore: msg });
  }
});

server.listen(PORT, HOST, () => console.log(`Cruscotto Famiglia su http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (db: ${DB})`));
