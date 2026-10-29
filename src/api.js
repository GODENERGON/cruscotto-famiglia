// Rotte HTTP dell'API, senza framework.
import * as C from './conti.js';
import { tx } from './db.js';
import { today, ym } from './mesi.js';
import * as T from './tempo.js';

// Tabelle con modifica generica: colonne ammesse e tipi.
const ENTITA = {
  persone: { cols: ['nome', 'ruolo', 'tinta', 'inchiostro'], order: 'id' },
  conti: { cols: ['nome', 'persona_id', 'tipo', 'saldo_iniziale', 'data_saldo', 'attivo'], order: 'id' },
  categorie: { cols: ['nome', 'tipo', 'natura', 'area'], order: 'tipo, nome' },
  regole: { cols: ['testo', 'categoria_id', 'persona_id', 'priorita'], order: 'testo' },
  ricorrenze: { cols: ['nome', 'importo', 'ogni_mesi', 'giorno', 'dal', 'al', 'categoria_id', 'persona_id', 'note', 'attiva'], order: 'importo DESC' },
  salvadanai: { cols: ['nome', 'obiettivo', 'scadenza', 'versamento_mensile', 'quota_percento', 'quota_categoria_id', 'persona_id', 'priorita', 'note', 'archiviato'], order: 'priorita DESC, id' },
  progetti: { cols: ['nome', 'area', 'persona_id', 'stato', 'inizio', 'fine', 'budget', 'salvadanaio_id', 'luogo', 'note'], order: 'nome' },
  uscite_pianificate: { cols: ['data', 'importo', 'descrizione', 'salvadanaio_id', 'fatta'], order: 'data' },
};

const VALIDA = {
  movimento(b) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data || '')) throw C.httpError(400, 'Data non valida');
    if (!Number.isInteger(b.importo) || b.importo === 0) throw C.httpError(400, 'Importo non valido');
  },
};

export function makeApi(db, { clock, gcal = null, dopoModifica = () => {} } = {}) {
  const oggi = () => today(clock);
  const routes = [];
  const on = (method, path, fn) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, fn });
  };

  on('GET', '/api/meta', () => ({
    oggi: oggi(),
    persone: db.prepare('SELECT * FROM persone ORDER BY id').all(),
    conti: C.liquidita(db, oggi()),
    categorie: db.prepare('SELECT * FROM categorie ORDER BY tipo, nome').all(),
    salvadanai: db.prepare('SELECT id, nome FROM salvadanai WHERE archiviato = 0 ORDER BY priorita DESC, id').all(),
    progetti: db.prepare("SELECT id, nome, area, stato FROM progetti WHERE stato != 'chiuso' ORDER BY nome").all(),
  }));

  on('GET', '/api/panoramica', (q) => {
    const mese = q.get('mese') || ym(oggi());
    return {
      oggi: oggi(),
      riepilogo: C.riepilogoMese(db, mese, oggi()),
      proiezione: C.proiezione(db, Number(q.get('mesi') || 24), oggi()),
      salvadanai: C.statoSalvadanai(db, oggi()),
      conti: C.liquidita(db, oggi()),
      andamento: C.andamento(db, 12, oggi()),
      stipendi: db.prepare("SELECT COUNT(*) AS n FROM ricorrenze r JOIN categorie c ON c.id = r.categoria_id WHERE r.attiva = 1 AND c.nome = 'Stipendio'").get().n,
      ultimo_import: db.prepare('SELECT l.*, c.nome AS conto FROM import_lotti l LEFT JOIN conti c ON c.id = l.conto_id ORDER BY l.id DESC LIMIT 1').get() || null,
    };
  });

  on('GET', '/api/movimenti', (q) => {
    const where = [], p = [];
    if (q.get('mese')) { where.push('m.data LIKE ?'); p.push(q.get('mese') + '%'); }
    if (q.get('categoria')) { where.push('m.categoria_id = ?'); p.push(Number(q.get('categoria'))); }
    if (q.get('persona')) { where.push('m.persona_id = ?'); p.push(Number(q.get('persona'))); }
    if (q.get('conto')) { where.push('m.conto_id = ?'); p.push(Number(q.get('conto'))); }
    if (q.get('da_classificare')) where.push('m.categoria_id IS NULL');
    if (q.get('q')) { where.push('m.descrizione LIKE ?'); p.push('%' + q.get('q') + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(500, Number(q.get('limit') || 100)), offset = Number(q.get('offset') || 0);
    const rows = db.prepare(`SELECT m.* FROM movimenti m ${w} ORDER BY m.data DESC, m.id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset);
    const tot = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN importo>0 THEN importo END),0) AS entrate, COALESCE(SUM(CASE WHEN importo<0 THEN importo END),0) AS uscite FROM movimenti m ${w}`).get(...p);
    return { righe: rows, totale: tot.n, entrate: tot.entrate, uscite: tot.uscite, offset, limit };
  });

  on('POST', '/api/movimenti', (_, b) => {
    VALIDA.movimento(b);
    const conto = b.conto_id ?? db.prepare('SELECT id FROM conti WHERE attivo = 1 ORDER BY id LIMIT 1').get()?.id ?? null;
    return { id: C.aggiungiMovimento(db, { ...b, conto_id: conto, fonte: b.fonte || 'manuale' }) };
  });
  on('PATCH', '/api/movimenti/:id', (_, b, p) => { if (b.data || b.importo) VALIDA.movimento({ data: b.data ?? '2000-01-01', importo: b.importo ?? 1 }); return { id: C.aggiornaMovimento(db, Number(p.id), b) }; });
  on('DELETE', '/api/movimenti/:id', (_, __, p) => { db.prepare('DELETE FROM movimenti WHERE id = ?').run(Number(p.id)); return { ok: true }; });

  on('POST', '/api/import/anteprima', (_, b) => C.anteprimaImport(db, b));
  on('POST', '/api/import/conferma', (_, b) => C.confermaImport(db, b));
  on('GET', '/api/import/profili', () => db.prepare('SELECT * FROM profili_csv ORDER BY nome').all().map((r) => ({ ...r, mappa: JSON.parse(r.mappa) })));
  on('GET', '/api/import/lotti', () => db.prepare('SELECT l.*, c.nome AS conto FROM import_lotti l LEFT JOIN conti c ON c.id = l.conto_id ORDER BY l.id DESC LIMIT 20').all());
  on('DELETE', '/api/import/lotti/:id', (_, __, p) => tx(db, () => {
    const n = db.prepare('DELETE FROM movimenti WHERE lotto_id = ?').run(Number(p.id)).changes;
    db.prepare('DELETE FROM import_lotti WHERE id = ?').run(Number(p.id));
    return { annullati: n };
  }));

  on('GET', '/api/salvadanai/stato', () => C.statoSalvadanai(db, oggi()));
  on('POST', '/api/salvadanai/versa-mensili', (_, b) => C.versaMensili(db, b.mese || ym(oggi()), oggi()));
  on('POST', '/api/salvadanai/:id/movimento', (_, b, p) => {
    if (!Number.isInteger(b.importo) || b.importo === 0) throw C.httpError(400, 'Importo non valido');
    db.prepare(`INSERT INTO accantonamenti (salvadanaio_id, data, importo, causale, nota) VALUES (?, ?, ?, ?, ?)`)
      .run(Number(p.id), b.data || oggi(), b.importo, b.importo < 0 ? 'spesa' : 'manuale', b.nota || null);
    return { ok: true };
  });

  // ---- tempo
  on('GET', '/api/calendario', (q) => {
    const dal = q.get('dal') || T.monday(oggi()), al = q.get('al') || T.addDays(dal, 6);
    return { dal, al, occorrenze: T.occorrenze(db, dal, al), ore: T.oreSettimana(db, T.monday(dal)) };
  });
  on('GET', '/api/todo', () => T.daFare(db, oggi()));
  on('GET', '/api/gantt', () => T.gantt(db, oggi()));
  on('GET', '/api/attivita', (q) => db.prepare(`SELECT id, titolo, progetto_id, stato, data, fine FROM attivita WHERE eliminata = 0 ${q.get('progetto') ? 'AND progetto_id = ?' : ''} ORDER BY COALESCE(data, '9999'), id`).all(...(q.get('progetto') ? [Number(q.get('progetto'))] : [])));
  on('GET', '/api/attivita/:id', (_, __, p) => { const a = T.leggiAttivita(db, Number(p.id)); if (!a) throw C.httpError(404, 'Attività non trovata'); return a; });
  on('POST', '/api/attivita', (_, b) => { const id = T.creaAttivita(db, b); dopoModifica(); return { id }; });
  on('PATCH', '/api/attivita/:id', (_, b, p) => { const id = T.aggiornaAttivita(db, Number(p.id), b); dopoModifica(); return { id }; });
  on('DELETE', '/api/attivita/:id', (_, __, p) => { T.eliminaAttivita(db, Number(p.id)); dopoModifica(); return { ok: true }; });

  // ---- Google Calendar
  if (gcal) {
    on('GET', '/api/gcal/stato', () => gcal.stato());
    on('POST', '/api/gcal/credenziali', (_, b) => {
      if (!b.client_id || !b.client_secret) throw C.httpError(400, 'Servono ID client e segreto client');
      gcal.salvaCredenziali(b.client_id, b.client_secret);
      return gcal.stato();
    });
    on('GET', '/api/gcal/calendari', () => gcal.calendari());
    on('POST', '/api/gcal/calendari', (_, b) => { gcal.impostaCalendariDaLeggere(b.leggi || []); return gcal.stato(); });
    on('POST', '/api/gcal/sincronizza', async () => ({ esito: await gcal.sincronizza(), stato: gcal.stato() }));
    on('POST', '/api/gcal/scollega', () => { gcal.scollega(); return gcal.stato(); });
  }
  on('GET', '/api/luoghi', () => db.prepare(`SELECT luogo FROM (SELECT luogo FROM attivita UNION SELECT luogo FROM progetti) WHERE luogo IS NOT NULL AND luogo != '' ORDER BY luogo`).all().map((r) => r.luogo));

  on('GET', '/api/proiezione', (q) => C.proiezione(db, Number(q.get('mesi') || 24), oggi()));

  for (const [tab, def] of Object.entries(ENTITA)) {
    on('GET', `/api/${tab}`, () => db.prepare(`SELECT * FROM ${tab} ORDER BY ${def.order}`).all());
    on('POST', `/api/${tab}`, (_, b) => {
      const cols = def.cols.filter((c) => b[c] !== undefined);
      if (!cols.length) throw C.httpError(400, 'Nessun campo');
      const r = db.prepare(`INSERT INTO ${tab} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => b[c] === '' ? null : b[c]));
      return { id: Number(r.lastInsertRowid) };
    });
    on('PATCH', `/api/${tab}/:id`, (_, b, p) => {
      const cols = def.cols.filter((c) => b[c] !== undefined);
      if (!cols.length) throw C.httpError(400, 'Nessun campo');
      db.prepare(`UPDATE ${tab} SET ${cols.map((c) => c + ' = ?').join(',')} WHERE id = ?`).run(...cols.map((c) => b[c] === '' ? null : b[c]), Number(p.id));
      return { id: Number(p.id) };
    });
    on('DELETE', `/api/${tab}/:id`, (_, __, p) => { db.prepare(`DELETE FROM ${tab} WHERE id = ?`).run(Number(p.id)); return { ok: true }; });
  }

  return async function handle(method, url, body) {
    const u = new URL(url, 'http://x');
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = u.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return r.fn(u.searchParams, body || {}, params);
    }
    throw C.httpError(404, 'Percorso non trovato');
  };
}
