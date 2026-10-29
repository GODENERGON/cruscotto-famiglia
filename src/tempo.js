// Tempo: attività, ricorrenze settimanali, calendario, to-do, Gantt e ore impegnate.
import { tx } from './db.js';
import { today } from './mesi.js';

const all = (db, sql, ...p) => db.prepare(sql).all(...p);
const one = (db, sql, ...p) => db.prepare(sql).get(...p);

// ---------------------------------------------------------------- date

export const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
export const weekday = (d) => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1; // 1 = lunedì … 7 = domenica
export const monday = (d) => addDays(d, 1 - weekday(d));

const COLS = ['titolo', 'progetto_id', 'persona_id', 'tipo', 'stato', 'data', 'ora', 'durata_min', 'fine', 'scadenza', 'luogo', 'priorita', 'ripeti', 'costo', 'note'];

function pulisci(b) {
  const out = {};
  for (const c of COLS) if (b[c] !== undefined) out[c] = b[c] === '' ? null : b[c];
  if (out.ripeti && typeof out.ripeti === 'object') out.ripeti = JSON.stringify(out.ripeti);
  if (out.data != null && !/^\d{4}-\d{2}-\d{2}$/.test(out.data)) throw err(400, 'Data non valida');
  if (out.ora != null && !/^\d{2}:\d{2}$/.test(out.ora)) throw err(400, 'Ora non valida (HH:MM)');
  if (out.fine != null && out.data && out.fine < out.data) throw err(400, 'La fine viene prima dell\'inizio');
  return out;
}

export function creaAttivita(db, b) {
  const v = pulisci(b);
  if (!v.titolo) throw err(400, 'Manca il titolo');
  const cols = Object.keys(v);
  const id = Number(db.prepare(`INSERT INTO attivita (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => v[c])).lastInsertRowid);
  if (Array.isArray(b.dipende_da)) impostaDipendenze(db, id, b.dipende_da);
  return id;
}

export function aggiornaAttivita(db, id, b, { daGoogle = false } = {}) {
  return tx(db, () => {
    const prima = one(db, 'SELECT * FROM attivita WHERE id = ?', id);
    if (!prima) throw err(404, 'Attività non trovata');
    const v = pulisci(b);
    if (b.stato === 'fatta' && prima.stato !== 'fatta') v.fatta_il = today();
    if (b.stato && b.stato !== 'fatta') v.fatta_il = null;
    if (daGoogle) v.gcal_aggiornato = b.gcal_aggiornato;
    const cols = Object.keys(v);
    if (cols.length) db.prepare(`UPDATE attivita SET ${cols.map((c) => c + ' = ?').join(', ')}, aggiornato_il = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(...cols.map((c) => v[c]), id);
    if (Array.isArray(b.dipende_da)) impostaDipendenze(db, id, b.dipende_da);
    return id;
  });
}

// Cancella; se l'attività è su Google resta come "eliminata" finché la sincronizzazione non toglie anche l'evento.
export function eliminaAttivita(db, id) {
  const a = one(db, 'SELECT gcal_id FROM attivita WHERE id = ?', id);
  if (a?.gcal_id) db.prepare("UPDATE attivita SET eliminata = 1, aggiornato_il = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  else db.prepare('DELETE FROM attivita WHERE id = ?').run(id);
}

function impostaDipendenze(db, id, lista) {
  db.prepare('DELETE FROM dipendenze WHERE attivita_id = ?').run(id);
  for (const d of lista) {
    if (Number(d) === id) continue;
    if (dipendeDa(db, Number(d), id)) throw err(400, 'Dipendenza circolare');
    db.prepare('INSERT OR IGNORE INTO dipendenze (attivita_id, dipende_da) VALUES (?, ?)').run(id, Number(d));
  }
}
// a dipende (anche indirettamente) da b?
function dipendeDa(db, a, b, visti = new Set()) {
  if (visti.has(a)) return false; visti.add(a);
  for (const r of all(db, 'SELECT dipende_da FROM dipendenze WHERE attivita_id = ?', a)) {
    if (r.dipende_da === b || dipendeDa(db, r.dipende_da, b, visti)) return true;
  }
  return false;
}

export function leggiAttivita(db, id) {
  const a = one(db, 'SELECT * FROM attivita WHERE id = ?', id);
  if (!a) return null;
  return { ...a, ripeti: a.ripeti ? JSON.parse(a.ripeti) : null, dipende_da: all(db, 'SELECT dipende_da FROM dipendenze WHERE attivita_id = ?', id).map((r) => r.dipende_da) };
}

// ---------------------------------------------------------------- calendario

// Tutte le occorrenze tra dal e al (inclusi): ricorrenze espanse, lavori di più giorni ripetuti su ogni giorno.
export function occorrenze(db, dal, al) {
  const righe = all(db, `SELECT a.*, p.nome AS progetto FROM attivita a LEFT JOIN progetti p ON p.id = a.progetto_id
    WHERE a.eliminata = 0 AND a.data IS NOT NULL AND (a.ripeti IS NOT NULL OR (a.data <= ? AND COALESCE(a.fine, a.data) >= ?))`, al, dal);
  const out = [];
  for (const a of righe) {
    const r = a.ripeti ? JSON.parse(a.ripeti) : null;
    if (!r) {
      const fine = a.fine || a.data;
      for (let d = a.data > dal ? a.data : dal; d <= fine && d <= al; d = addDays(d, 1)) {
        out.push(occ(a, d, { primo: d === a.data, ultimo: d === fine, giorni: daysBetween(a.data, fine) + 1, fine }));
      }
      continue;
    }
    const fino = r.fino && r.fino < al ? r.fino : al;
    for (let d = a.data > dal ? a.data : dal; d <= fino; d = addDays(d, 1)) {
      if (cade(r, a.data, d)) out.push(occ(a, d, { ripetuta: true }));
    }
  }
  return out.sort((x, y) => (x.data + (x.ora || '')).localeCompare(y.data + (y.ora || '')));
}

function cade(r, inizio, d) {
  if (d < inizio) return false;
  if (r.ogni === 'giorno') return true;
  if (r.ogni === 'settimana') {
    const giorni = r.giorni?.length ? r.giorni : [weekday(inizio)];
    const sett = Math.floor(daysBetween(monday(inizio), monday(d)) / 7);
    return giorni.includes(weekday(d)) && sett % (r.intervallo || 1) === 0;
  }
  if (r.ogni === 'mese') return d.slice(8) === inizio.slice(8);
  if (r.ogni === 'anno') return d.slice(5) === inizio.slice(5);
  return false;
}

function occ(a, d, extra) {
  return { id: a.id, data: d, titolo: a.titolo, ora: a.ora, durata_min: a.durata_min, tipo: a.tipo, stato: a.stato, persona_id: a.persona_id,
    progetto_id: a.progetto_id, progetto: a.progetto, luogo: a.luogo, gcal: !!a.gcal_id, ...extra };
}

// Ore impegnate nella settimana per persona: occorrenze con orario + intervalli occupati dagli altri calendari.
export function oreSettimana(db, lunedi) {
  const dom = addDays(lunedi, 6);
  const per = new Map();
  const add = (pid, min, chiave) => { const k = pid ?? 0; const v = per.get(k) || { persona_id: pid ?? null, cruscotto: 0, altri: 0 }; v[chiave] += min; per.set(k, v); };
  for (const o of occorrenze(db, lunedi, dom)) if (o.ora && o.durata_min) add(o.persona_id, o.durata_min, 'cruscotto');
  for (const b of all(db, 'SELECT * FROM occupato WHERE inizio < ? AND fine > ?', dom + 'T24:00', lunedi + 'T00:00')) {
    add(b.persona_id, Math.max(0, (Date.parse(b.fine) - Date.parse(b.inizio)) / 60000), 'altri');
  }
  return [...per.values()];
}

// ---------------------------------------------------------------- to-do

export function daFare(db, oggi = today()) {
  const righe = all(db, `SELECT a.*, p.nome AS progetto FROM attivita a LEFT JOIN progetti p ON p.id = a.progetto_id
    WHERE a.eliminata = 0 AND a.tipo = 'compito' AND a.ripeti IS NULL AND (a.stato != 'fatta' OR a.fatta_il >= ?)
    ORDER BY COALESCE(a.scadenza, a.data, '9999'), a.priorita DESC, a.id`, addDays(oggi, -1));
  const fine = addDays(monday(oggi), 6);
  const aspetta = new Map();
  for (const r of all(db, `SELECT d.attivita_id, b.titolo FROM dipendenze d JOIN attivita b ON b.id = d.dipende_da WHERE b.stato != 'fatta' AND b.eliminata = 0`)) {
    aspetta.set(r.attivita_id, [...(aspetta.get(r.attivita_id) || []), r.titolo]);
  }
  return righe.map((a) => {
    const quando = a.scadenza || a.fine || a.data;
    const gruppo = a.stato === 'fatta' ? 'fatte' : !quando ? 'senza_data' : quando < oggi ? 'in_ritardo' : quando === oggi ? 'oggi' : quando <= fine ? 'settimana' : 'dopo';
    return { ...a, ripeti: null, gruppo, bloccata: aspetta.has(a.id), aspetta: aspetta.get(a.id) || [] };
  });
}

// ---------------------------------------------------------------- Gantt

export function gantt(db, oggi = today()) {
  const progetti = all(db, "SELECT * FROM progetti WHERE stato != 'chiuso' ORDER BY CASE stato WHEN 'attivo' THEN 0 WHEN 'in_pausa' THEN 1 ELSE 2 END, COALESCE(inizio, '9999'), nome");
  const att = all(db, "SELECT * FROM attivita WHERE eliminata = 0 AND progetto_id IS NOT NULL AND ripeti IS NULL AND tipo = 'compito' ORDER BY COALESCE(data, '9999'), id");
  const dip = all(db, 'SELECT * FROM dipendenze');
  return progetti.map((p) => {
    const mie = att.filter((a) => a.progetto_id === p.id).map((a) => ({
      id: a.id, titolo: a.titolo, stato: a.stato, persona_id: a.persona_id, inizio: a.data, fine: a.fine || a.data, costo: a.costo,
      dipende_da: dip.filter((d) => d.attivita_id === a.id).map((d) => d.dipende_da),
    }));
    const date = mie.flatMap((a) => [a.inizio, a.fine]).filter(Boolean).sort();
    const inizio = p.inizio || date[0] || null, fine = p.fine || date.at(-1) || null;
    const fatte = mie.filter((a) => a.stato === 'fatta').length;
    const inRitardo = mie.filter((a) => a.stato !== 'fatta' && a.fine && a.fine < oggi).length;
    const costo = mie.reduce((s, a) => s + (a.costo || 0), 0);
    return { ...p, inizio, fine, attivita: mie, fatte, totale: mie.length, in_ritardo: inRitardo, costo_attivita: costo };
  });
}

function err(status, message) { const e = new Error(message); e.status = status; return e; }
