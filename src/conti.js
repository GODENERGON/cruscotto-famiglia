// Logica del cruscotto: movimenti, import, riepiloghi, salvadanai e proiezione di cassa.
import { tx } from './db.js';
import { parseCsvText, guessMapping, extractRows, fingerprint, normalizeDesc } from './csv.js';
import { ym, addMonths, firstDay, lastDay, occursIn, dayOf, today, daysIn, toIdx, monthsBetween } from './mesi.js';

const all = (db, sql, ...p) => db.prepare(sql).all(...p);
const one = (db, sql, ...p) => db.prepare(sql).get(...p);
const sum = (rows, f = (r) => r.importo) => rows.reduce((s, r) => s + (f(r) || 0), 0);

// ---------------------------------------------------------------- categorie automatiche

// Cerca il testo della regola come parole intere ("eni" non scatta su "DENIS") e solo se il segno
// dell'importo è compatibile con la categoria (un'entrata non finisce in una categoria di uscita).
export function regolaPer(db, descrizione, importo = null) {
  const d = ' ' + normalizeDesc(descrizione).toLowerCase().replace(/[^a-z0-9à-ù&']+/g, ' ') + ' ';
  if (!d.trim()) return null;
  const regole = all(db, `SELECT r.*, c.tipo AS cat_tipo FROM regole r JOIN categorie c ON c.id = r.categoria_id ORDER BY r.priorita DESC, length(r.testo) DESC`);
  return regole.find((r) => {
    const t = r.testo.toLowerCase().replace(/[^a-z0-9à-ù&']+/g, ' ').trim();
    if (!t || !d.includes(' ' + t + ' ')) return false;
    if (importo != null && ((r.cat_tipo === 'entrata' && importo < 0) || (r.cat_tipo === 'uscita' && importo > 0))) return false;
    return true;
  }) || null;
}

// ---------------------------------------------------------------- movimenti

export function aggiungiMovimento(db, m) {
  return tx(db, () => inserisciMovimento(db, m));
}

function inserisciMovimento(db, m) {
  let { categoria_id = null, persona_id = null } = m;
  if (!categoria_id && m.descrizione) {
    const r = regolaPer(db, m.descrizione, m.importo);
    if (r) { categoria_id = r.categoria_id; persona_id = persona_id ?? r.persona_id; }
  }
  const res = db.prepare(`INSERT INTO movimenti (data, importo, descrizione, categoria_id, persona_id, conto_id, fonte, lotto_id, impronta, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    m.data, m.importo, normalizeDesc(m.descrizione), categoria_id, persona_id, m.conto_id ?? null,
    m.fonte || 'manuale', m.lotto_id ?? null, m.impronta ?? null, m.note ?? null);
  const id = Number(res.lastInsertRowid);
  applicaQuote(db, { id, data: m.data, importo: m.importo, categoria_id });
  return id;
}

// Quando entra un'entrata in una categoria collegata a un salvadanaio (es. Affitto → Tasse 35%),
// accantona subito la quota.
function applicaQuote(db, mov) {
  if (!mov.categoria_id || mov.importo <= 0) return;
  const pots = all(db, 'SELECT * FROM salvadanai WHERE archiviato = 0 AND quota_categoria_id = ? AND quota_percento > 0', mov.categoria_id);
  for (const p of pots) {
    const q = Math.round(mov.importo * p.quota_percento / 100);
    db.prepare(`INSERT INTO accantonamenti (salvadanaio_id, data, importo, causale, movimento_id, nota) VALUES (?, ?, ?, 'quota', ?, ?)`)
      .run(p.id, mov.data, q, mov.id, `${p.quota_percento}% dell'entrata`);
  }
}

export function aggiornaMovimento(db, id, campi) {
  return tx(db, () => {
    const prima = one(db, 'SELECT * FROM movimenti WHERE id = ?', id);
    if (!prima) throw httpError(404, 'Movimento non trovato');
    const m = { ...prima, ...campi };
    db.prepare('UPDATE movimenti SET data=?, importo=?, descrizione=?, categoria_id=?, persona_id=?, conto_id=?, note=? WHERE id=?')
      .run(m.data, m.importo, normalizeDesc(m.descrizione), m.categoria_id ?? null, m.persona_id ?? null, m.conto_id ?? null, m.note ?? null, id);
    // la quota dipende da importo e categoria: la ricalcoliamo
    db.prepare(`DELETE FROM accantonamenti WHERE movimento_id = ? AND causale = 'quota'`).run(id);
    applicaQuote(db, { id, data: m.data, importo: m.importo, categoria_id: m.categoria_id });
    if (campi.impara && m.categoria_id && m.descrizione) imparaRegola(db, m.descrizione, m.categoria_id, m.persona_id);
    return id;
  });
}

// Crea una regola dalla parte stabile della descrizione (senza date, numeri di carta e importi).
export function imparaRegola(db, descrizione, categoria_id, persona_id = null) {
  const testo = chiaveDescrizione(descrizione);
  if (testo.length < 3) return null;
  db.prepare('INSERT OR IGNORE INTO regole (testo, categoria_id, persona_id) VALUES (?, ?, ?)').run(testo, categoria_id, persona_id ?? null);
  return testo;
}

export function chiaveDescrizione(s) {
  const parole = normalizeDesc(s).toLowerCase()
    .replace(/\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?/g, ' ')
    .replace(/\b(carta|card|pagamento|pos|op\.?|operazione|del|il|n\.?|nr\.?|ore|data|presso|addebito|sdd|bonifico|a favore di|da)\b/g, ' ')
    .replace(/[*#]+\d+|\b\d+[.,]?\d*\b/g, ' ')
    .replace(/[^a-zà-ù\s&'-]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 1);
  return parole.slice(0, 3).join(' ');
}

// ---------------------------------------------------------------- import CSV

export function anteprimaImport(db, { testo, conto_id = null, mappa = null }) {
  const { rows, delim } = parseCsvText(testo || '');
  if (!rows.some((r) => r.some((c) => c))) throw httpError(400, 'Il file è vuoto');
  const proposta = guessMapping(rows);
  const map = { ...proposta, ...(mappa || {}) };
  if (map.col_data < 0 || (map.col_importo < 0 && map.col_dare < 0 && map.col_avere < 0))
    return { delim, mappa: map, righe: [], scartate: [], da_mappare: true };
  const { righe, scartate } = extractRows(rows, map);
  const visti = new Map();
  const esistente = db.prepare('SELECT id FROM movimenti WHERE impronta = ?');
  const out = righe.map((r) => {
    const k = `${r.data}|${r.importo}|${r.descrizione.toLowerCase()}`;
    const occ = visti.get(k) || 0; visti.set(k, occ + 1);
    const impronta = fingerprint(conto_id, r.data, r.importo, r.descrizione, occ);
    const regola = regolaPer(db, r.descrizione, r.importo);
    return {
      ...r, impronta,
      duplicato: !!esistente.get(impronta),
      categoria_id: regola?.categoria_id ?? null,
      persona_id: regola?.persona_id ?? null,
      regola: regola?.testo ?? null,
    };
  });
  return { delim, mappa: map, righe: out, scartate, da_mappare: false };
}

export function confermaImport(db, { conto_id = null, file_nome = null, righe = [], profilo = null, mappa = null }) {
  return tx(db, () => {
    const lotto = Number(db.prepare('INSERT INTO import_lotti (file_nome, conto_id, righe) VALUES (?, ?, ?)')
      .run(file_nome, conto_id, righe.length).lastInsertRowid);
    const esistente = db.prepare('SELECT id FROM movimenti WHERE impronta = ?');
    let importate = 0, duplicate = 0, regole = 0;
    for (const r of righe) {
      if (r.includi === false) continue;
      if (esistente.get(r.impronta)) { duplicate++; continue; }
      inserisciMovimento(db, { ...r, conto_id, fonte: 'csv', lotto_id: lotto });
      importate++;
      if (r.impara && r.categoria_id && imparaRegola(db, r.descrizione, r.categoria_id, r.persona_id)) regole++;
    }
    db.prepare('UPDATE import_lotti SET importate = ?, duplicate = ? WHERE id = ?').run(importate, duplicate, lotto);
    if (profilo && mappa) {
      db.prepare('INSERT INTO profili_csv (nome, conto_id, mappa) VALUES (?, ?, ?) ON CONFLICT(nome) DO UPDATE SET conto_id = excluded.conto_id, mappa = excluded.mappa')
        .run(profilo, conto_id, JSON.stringify(mappa));
    }
    return { lotto, importate, duplicate, regole };
  });
}

// ---------------------------------------------------------------- riepiloghi

function movimentiTra(db, dal, al) {
  return all(db, `SELECT m.*, c.tipo AS cat_tipo, c.natura AS cat_natura, c.nome AS cat_nome, c.area AS cat_area
    FROM movimenti m LEFT JOIN categorie c ON c.id = m.categoria_id
    WHERE m.data BETWEEN ? AND ? ORDER BY m.data, m.id`, dal, al);
}

const isGiro = (m) => m.cat_tipo === 'giroconto';
const totali = (movs) => {
  const v = movs.filter((m) => !isGiro(m));
  const entrate = sum(v.filter((m) => m.importo > 0));
  const fisse = sum(v.filter((m) => m.importo < 0 && m.cat_natura === 'fissa'));
  const variabili = sum(v.filter((m) => m.importo < 0 && m.cat_natura !== 'fissa'));
  return { entrate, fisse, variabili, netto: entrate + fisse + variabili };
};

function accantonatoTra(db, dal, al) {
  return one(db, 'SELECT COALESCE(SUM(importo),0) AS s FROM accantonamenti WHERE data BETWEEN ? AND ?', dal, al).s;
}

// Media mensile delle uscite variabili sugli ultimi n mesi completi con dati.
export function mediaVariabili(db, mese, n = 3) {
  const vals = [];
  for (let i = 1; i <= 12 && vals.length < n; i++) {
    const m = addMonths(mese, -i);
    const movs = movimentiTra(db, firstDay(m), lastDay(m));
    if (!movs.length) continue;
    vals.push(totali(movs).variabili);
  }
  return { media: vals.length ? Math.round(sum(vals, (x) => x) / vals.length) : 0, mesi: vals.length };
}

// Una ricorrenza di questo mese è già arrivata se c'è un movimento della stessa categoria,
// dello stesso segno e con importo entro il 15%.
function ricorrenzePendenti(db, mese, oggi) {
  const movs = movimentiTra(db, firstDay(mese), lastDay(mese));
  const usati = new Set();
  const out = [];
  for (const r of all(db, 'SELECT r.*, c.nome AS cat_nome FROM ricorrenze r LEFT JOIN categorie c ON c.id = r.categoria_id WHERE attiva = 1 ORDER BY giorno')) {
    if (!occursIn(r, mese)) continue;
    const match = movs.find((m) => !usati.has(m.id) && m.categoria_id === r.categoria_id && Math.sign(m.importo) === Math.sign(r.importo)
      && Math.abs(m.importo - r.importo) <= Math.abs(r.importo) * 0.15);
    if (match) { usati.add(match.id); continue; }
    out.push({ id: r.id, nome: r.nome, importo: r.importo, data: dayOf(r, mese), persona_id: r.persona_id, categoria: r.cat_nome, scaduta: dayOf(r, mese) < oggi });
  }
  return out;
}

export function riepilogoMese(db, mese, oggi = today()) {
  const movs = movimentiTra(db, firstDay(mese), lastDay(mese));
  const t = totali(movs);
  const accantonato = accantonatoTra(db, firstDay(mese), lastDay(mese));
  const libero = t.netto - accantonato;
  const corrente = mese === ym(oggi);
  const pendenti = corrente || toIdx(mese) > toIdx(ym(oggi)) ? ricorrenzePendenti(db, mese, oggi) : [];
  const { media } = mediaVariabili(db, mese);
  let stimaFine = null;
  if (corrente) {
    const giorno = Number(oggi.slice(8));
    const restoVariabili = Math.min(0, Math.round(media * (daysIn(mese) - giorno) / daysIn(mese)));
    const mensiliNonVersati = all(db, 'SELECT * FROM salvadanai WHERE archiviato = 0 AND versamento_mensile > 0')
      .filter((p) => !one(db, `SELECT 1 FROM accantonamenti WHERE salvadanaio_id = ? AND causale = 'mensile' AND data BETWEEN ? AND ?`, p.id, firstDay(mese), lastDay(mese)))
      .reduce((s, p) => s + p.versamento_mensile, 0);
    stimaFine = libero + sum(pendenti) + restoVariabili - mensiliNonVersati;
  }
  // corsie: per ogni persona entrate e uscite; i movimenti senza persona vanno a Famiglia
  const persone = all(db, 'SELECT * FROM persone ORDER BY id');
  const famiglia = persone.find((p) => p.ruolo === 'famiglia');
  const corsie = persone.map((p) => {
    const mine = movs.filter((m) => !isGiro(m) && (m.persona_id === p.id || (!m.persona_id && famiglia && p.id === famiglia.id)));
    return { persona_id: p.id, ...totali(mine) };
  }).filter((c) => c.entrate || c.fisse || c.variabili);
  // per categoria (uscite)
  const perCat = new Map();
  for (const m of movs) {
    if (isGiro(m) || m.importo >= 0) continue;
    const k = m.cat_nome || 'Da classificare';
    perCat.set(k, (perCat.get(k) || 0) + m.importo);
  }
  const categorie = [...perCat].map(([nome, importo]) => ({ nome, importo })).sort((a, b) => a.importo - b.importo);
  const daClassificare = movs.filter((m) => !m.categoria_id).length;
  return { mese, ...t, accantonato, libero, stima_fine_mese: stimaFine, media_variabili: media, pendenti, corsie, categorie, da_classificare: daClassificare, movimenti: movs.length };
}

export function andamento(db, mesi = 12, oggi = today()) {
  const fine = ym(oggi);
  const out = [];
  for (let i = mesi - 1; i >= 0; i--) {
    const m = addMonths(fine, -i);
    const t = totali(movimentiTra(db, firstDay(m), lastDay(m)));
    out.push({ mese: m, ...t, accantonato: accantonatoTra(db, firstDay(m), lastDay(m)) });
  }
  return out;
}

// ---------------------------------------------------------------- liquidità e salvadanai

export function liquidita(db, al = today()) {
  const conti = all(db, 'SELECT * FROM conti WHERE attivo = 1');
  return conti.map((c) => {
    const mov = one(db, 'SELECT COALESCE(SUM(importo),0) AS s FROM movimenti WHERE conto_id = ? AND data > ? AND data <= ?', c.id, c.data_saldo, al).s;
    return { ...c, saldo: c.saldo_iniziale + mov };
  });
}

export function statoSalvadanai(db, oggi = today()) {
  const pots = all(db, 'SELECT * FROM salvadanai WHERE archiviato = 0 ORDER BY priorita DESC, id');
  const proiez = proiezione(db, 36, oggi);
  return pots.map((p) => {
    const saldo = one(db, 'SELECT COALESCE(SUM(importo),0) AS s FROM accantonamenti WHERE salvadanaio_id = ? AND data <= ?', p.id, oggi).s;
    const serie = proiez.salvadanai[p.id] || [];
    const eventi = proiez.eventi.filter((e) => e.salvadanaio_id === p.id);
    const primaSpesa = eventi.length ? eventi[0].indice : serie.length;
    // l'obiettivo conta solo se raggiunto prima della spesa a cui serve
    const idx = p.obiettivo > 0 ? serie.slice(0, primaSpesa + 1).findIndex((v, i) => (i === primaSpesa && eventi.length ? v + eventi[0].coperto : v) >= p.obiettivo) : -1;
    let arrivo = p.obiettivo > 0 && saldo >= p.obiettivo ? ym(oggi) : idx >= 0 ? proiez.mesi[idx] : null;
    if (!arrivo && p.obiettivo > 0 && p.versamento_mensile > 0 && !eventi.length) {
      // oltre l'orizzonte: stima lineare dal saldo di fine proiezione
      const fine = serie.at(-1) ?? saldo;
      arrivo = addMonths(proiez.mesi.at(-1), Math.ceil((p.obiettivo - fine) / p.versamento_mensile));
    }
    let ritardo = null;
    if (p.scadenza && p.obiettivo > 0) ritardo = arrivo ? Math.max(0, monthsBetween(ym(p.scadenza), arrivo)) : null;
    const prossime = eventi.slice(0, 3);
    const ultimi = all(db, 'SELECT * FROM accantonamenti WHERE salvadanaio_id = ? ORDER BY data DESC, id DESC LIMIT 5', p.id);
    const mensileFatto = !!one(db, `SELECT 1 FROM accantonamenti WHERE salvadanaio_id = ? AND causale = 'mensile' AND data BETWEEN ? AND ?`, p.id, firstDay(ym(oggi)), lastDay(ym(oggi)));
    return { ...p, saldo, arrivo, ritardo_mesi: ritardo, prossime, ultimi, mensile_fatto: mensileFatto };
  });
}

// Registra i versamenti mensili del mese (una sola volta per salvadanaio e mese).
export function versaMensili(db, mese, oggi = today()) {
  return tx(db, () => {
    const data = ym(oggi) === mese ? oggi : firstDay(mese);
    let n = 0, totale = 0;
    for (const p of all(db, 'SELECT * FROM salvadanai WHERE archiviato = 0 AND versamento_mensile > 0')) {
      const fatto = one(db, `SELECT 1 FROM accantonamenti WHERE salvadanaio_id = ? AND causale = 'mensile' AND data BETWEEN ? AND ?`, p.id, firstDay(mese), lastDay(mese));
      if (fatto) continue;
      const saldo = one(db, 'SELECT COALESCE(SUM(importo),0) AS s FROM accantonamenti WHERE salvadanaio_id = ?', p.id).s;
      const v = p.obiettivo > 0 ? Math.min(p.versamento_mensile, Math.max(0, p.obiettivo - saldo)) : p.versamento_mensile;
      if (v <= 0) continue;
      db.prepare(`INSERT INTO accantonamenti (salvadanaio_id, data, importo, causale, nota) VALUES (?, ?, ?, 'mensile', ?)`).run(p.id, data, v, `Versamento di ${mese}`);
      n++; totale += v;
    }
    return { versamenti: n, totale };
  });
}

// ---------------------------------------------------------------- proiezione

// Proiezione mese per mese: liquidità totale, quanto è già destinato ai salvadanai, e quanto resta libero.
// Il mese corrente conta solo le ricorrenze che non sono ancora arrivate e la parte di variabili che resta.
export function proiezione(db, mesi = 24, oggi = today()) {
  const start = ym(oggi);
  const conti = liquidita(db, oggi);
  let totale = sum(conti, (c) => c.saldo);
  const pots = all(db, 'SELECT * FROM salvadanai WHERE archiviato = 0');
  const saldoPot = new Map(pots.map((p) => [p.id, one(db, 'SELECT COALESCE(SUM(importo),0) AS s FROM accantonamenti WHERE salvadanaio_id = ? AND data <= ?', p.id, oggi).s]));
  const ricorrenze = all(db, 'SELECT * FROM ricorrenze WHERE attiva = 1');
  const pianificate = all(db, 'SELECT * FROM uscite_pianificate WHERE fatta = 0 AND data >= ? ORDER BY data', firstDay(start));
  const { media, mesi: mesiStorico } = mediaVariabili(db, start);
  const out = { mesi: [], totale: [], destinato: [], libero: [], eventi: [], salvadanai: {}, media_variabili: media, mesi_storico: mesiStorico, liquidita_oggi: totale };
  for (const p of pots) out.salvadanai[p.id] = [];
  const chiusi = new Set();
  const giorno = Number(oggi.slice(8));
  for (let i = 0; i < mesi; i++) {
    const m = addMonths(start, i);
    let ric;
    if (i === 0) ric = ricorrenzePendenti(db, m, oggi).map((r) => ({ ...r, ricorrenza: ricorrenze.find((x) => x.id === r.id) }));
    else ric = ricorrenze.filter((r) => occursIn(r, m)).map((r) => ({ id: r.id, nome: r.nome, importo: r.importo, data: dayOf(r, m), ricorrenza: r }));
    const variabili = i === 0 ? Math.round(media * (daysIn(m) - giorno) / daysIn(m)) : media;
    const pian = pianificate.filter((u) => ym(u.data) === m);
    totale += sum(ric) + variabili + sum(pian);
    // salvadanai: quote sulle entrate collegate, versamenti mensili (fino all'obiettivo), spese pianificate pagate dal salvadanaio.
    // Un salvadanaio con obiettivo che paga la sua spesa si chiude: smette di ricevere versamenti.
    for (const p of pots) {
      let s = saldoPot.get(p.id);
      if (p.quota_percento > 0 && p.quota_categoria_id) {
        for (const r of ric) if (r.ricorrenza?.categoria_id === p.quota_categoria_id && r.importo > 0) s += Math.round(r.importo * p.quota_percento / 100);
      }
      const giaVersato = i === 0 && one(db, `SELECT 1 FROM accantonamenti WHERE salvadanaio_id = ? AND causale = 'mensile' AND data BETWEEN ? AND ?`, p.id, firstDay(m), lastDay(m));
      if (p.versamento_mensile > 0 && !giaVersato && !chiusi.has(p.id)) s += p.obiettivo > 0 ? Math.min(p.versamento_mensile, Math.max(0, p.obiettivo - s)) : p.versamento_mensile;
      for (const u of pian) {
        if (u.salvadanaio_id !== p.id) continue;
        const coperto = Math.min(s, -u.importo);
        out.eventi.push({ mese: m, indice: i, data: u.data, descrizione: u.descrizione, importo: u.importo, salvadanaio_id: p.id, coperto, mancante: -u.importo - coperto });
        s -= coperto;
        if (p.obiettivo > 0) chiusi.add(p.id);
      }
      saldoPot.set(p.id, s);
      out.salvadanai[p.id].push(s);
    }
    for (const u of pian) if (!u.salvadanaio_id) out.eventi.push({ mese: m, indice: i, data: u.data, descrizione: u.descrizione, importo: u.importo, salvadanaio_id: null, coperto: 0, mancante: -u.importo });
    const destinato = sum([...saldoPot.values()], (x) => x);
    out.mesi.push(m); out.totale.push(totale); out.destinato.push(destinato); out.libero.push(totale - destinato);
  }
  out.eventi.sort((a, b) => a.data.localeCompare(b.data));
  let min = 0;
  out.libero.forEach((v, i) => { if (v < out.libero[min]) min = i; });
  out.minimo = { mese: out.mesi[min], indice: min, libero: out.libero[min] };
  return out;
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
