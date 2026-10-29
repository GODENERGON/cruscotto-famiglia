// Lettura degli estratti conto CSV delle banche italiane.
// Gestisce: separatore ; , o tab, righe di intestazione prima della tabella, importi "1.234,56" o "-1234.56",
// colonne Dare/Avere separate, date gg/mm/aaaa, gg-mm-aa, aaaa-mm-gg.
import { createHash } from 'node:crypto';

export function parseCsvText(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sample = text.split('\n').slice(0, 30).join('\n');
  const delim = [';', '\t', ','].map((d) => [d, count(sample, d)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // le righe vuote restano, così i numeri di riga coincidono con il file
  while (rows.length && rows.at(-1).every((c) => c.trim() === '')) rows.pop();
  return { delim, rows: rows.map((r) => r.map((c) => c.trim())) };
}

function count(s, ch) { let n = 0; for (const c of s) if (c === ch) n++; return n; }

const KEYS = {
  data: [/^data( operazione| contabile| registrazione)?$/i, /^data$/i, /^date$/i, /data op/i, /^data contab/i],
  valuta: [/valuta/i],
  descrizione: [/descrizione/i, /causale/i, /dettagli/i, /operazione/i, /description/i, /movimento/i, /beneficiario/i],
  importo: [/^importo/i, /^amount/i, /^saldo movimento/i],
  dare: [/^dare/i, /addebit/i, /uscit/i, /^debit/i],
  avere: [/^avere/i, /accredit/i, /entrat/i, /^credit/i],
};

// Trova la riga di intestazione e propone quali colonne usare.
export function guessMapping(rows) {
  let headerIdx = -1, best = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    if (r.length < 3) continue;
    const score = r.filter((c) => Object.values(KEYS).flat().some((re) => re.test(c))).length;
    if (score > best) { best = score; headerIdx = i; }
  }
  if (headerIdx < 0) headerIdx = 0;
  const header = rows[headerIdx] || [];
  const find = (key, skip = []) => {
    for (const re of KEYS[key]) {
      const i = header.findIndex((h, j) => re.test(h) && !skip.includes(j));
      if (i >= 0) return i;
    }
    return -1;
  };
  const data = find('data');
  const descrizione = find('descrizione', [data]);
  const importo = find('importo');
  const dare = importo < 0 ? find('dare') : -1;
  const avere = importo < 0 ? find('avere') : -1;
  const body = rows.slice(headerIdx + 1);
  const sampleDates = body.slice(0, 20).map((r) => r[data]).filter(Boolean);
  return {
    header_riga: headerIdx, intestazioni: header,
    col_data: data, col_descrizione: descrizione, col_importo: importo, col_dare: dare, col_avere: avere,
    formato_data: guessDateFormat(sampleDates),
    // alcune banche scrivono le uscite senza segno nella colonna Dare
    dare_positivo: true,
  };
}

export function guessDateFormat(samples) {
  for (const s of samples) {
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'aaaa-mm-gg';
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m && +m[1] > 12) return 'gg/mm/aaaa';
    if (m && +m[2] > 12) return 'mm/gg/aaaa';
  }
  return 'gg/mm/aaaa';
}

export function parseDate(s, fmt = 'gg/mm/aaaa') {
  if (!s) return null;
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  let [a, b, y] = [+m[1], +m[2], +m[3]];
  if (y < 100) y += 2000;
  const [d, mo] = fmt === 'mm/gg/aaaa' ? [b, a] : [a, b];
  return iso(y, mo, d);
}
function iso(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "1.234,56" → 123456 ; "-1234.56" → -123456 ; "€ 12,00" → 1200 ; "(12,00)" → -1200
export function parseAmount(s) {
  if (s == null) return null;
  s = String(s).replace(/[€\s ]|EUR/gi, '');
  if (s === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) s = s.replace(/,/g, '');
  else if (lastComma < 0 && lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  const c = Math.round(v * 100);
  return neg ? -c : c;
}

export function normalizeDesc(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Impronta stabile di un movimento importato: conto, data, importo, descrizione e
// il numero d'ordine tra righe identiche dello stesso file (due caffè uguali nello stesso giorno restano due).
export function fingerprint(contoId, data, importo, descrizione, occorrenza = 0) {
  const key = [contoId ?? '', data, importo, normalizeDesc(descrizione).toLowerCase(), occorrenza].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 20);
}

// Applica la mappa alle righe: restituisce i movimenti letti e le righe scartate con il motivo.
export function extractRows(rows, map) {
  const out = [], scartate = [];
  const body = rows.slice(map.header_riga + 1);
  body.forEach((r, i) => {
    if (r.every((c) => c === '')) return;
    const riga = map.header_riga + 2 + i; // numero di riga come nel file (1-based)
    const data = parseDate(r[map.col_data], map.formato_data);
    let importo = null;
    if (map.col_importo >= 0) importo = parseAmount(r[map.col_importo]);
    else {
      const dare = parseAmount(r[map.col_dare]);
      const avere = parseAmount(r[map.col_avere]);
      if (dare) importo = map.dare_positivo ? -Math.abs(dare) : dare;
      else if (avere) importo = Math.abs(avere);
      else if (dare === 0 || avere === 0) importo = 0;
    }
    const descrizione = normalizeDesc(map.col_descrizione >= 0 ? r[map.col_descrizione] : '');
    if (!data || importo == null) {
      // righe di totale o note a piè di pagina: le segnaliamo senza bloccare
      if (r.join('').trim()) scartate.push({ riga, motivo: !data ? 'data non leggibile' : 'importo non leggibile', testo: r.join(' · ').slice(0, 120) });
      return;
    }
    out.push({ riga, data, importo, descrizione });
  });
  return { righe: out, scartate };
}
