// Sincronizzazione con Google Calendar, senza librerie: OAuth e API REST con fetch.
//
// Cosa fa:
//  - tiene un calendario dedicato «Cruscotto Famiglia» sul tuo account Google;
//  - ogni attività con una data diventa un evento lì (anche le ricorrenze), e viceversa;
//  - una modifica fatta da una parte arriva dall'altra; se cambiano tutte e due vince la più recente;
//  - legge come "occupato" gli altri calendari che scegli (lavoro, personale), per le ore della settimana.
import { tx, getSetting, setSetting } from './db.js';
import { addDays } from './tempo.js';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TZ = 'Europe/Rome';
const GIORNI_RR = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
// colori di Google Calendar più vicini alle tinte delle persone
const COLORE_PER_INCHIOSTRO = { '#0a3a80': '9', '#7a1747': '4', '#7a4a05': '5' };

const all = (db, sql, ...p) => db.prepare(sql).all(...p);
const one = (db, sql, ...p) => db.prepare(sql).get(...p);
const ora = () => new Date().toISOString();

export function migra(db) {
  const cols = all(db, 'PRAGMA table_info(attivita)').map((c) => c.name);
  if (!cols.includes('sincronizzato_il')) db.exec('ALTER TABLE attivita ADD COLUMN sincronizzato_il TEXT');
}

export function creaGcal(db, { fetch: f = globalThis.fetch, adesso = ora } = {}) {
  migra(db);
  const conf = () => getSetting(db, 'gcal', {});
  const salva = (cambi) => setSetting(db, 'gcal', { ...conf(), ...cambi });

  async function richiesta(url, opt = {}) {
    const res = await f(url, opt);
    const testo = await res.text();
    let dati = null; try { dati = testo ? JSON.parse(testo) : null; } catch { dati = { testo }; }
    if (!res.ok) { const e = new Error(dati?.error?.message || dati?.error_description || dati?.error || `Google ha risposto ${res.status}`); e.status = res.status; throw e; }
    return dati;
  }

  async function token() {
    const c = conf();
    if (!c.refresh_token) throw new Error('Google Calendar non è collegato');
    if (c.access_token && c.scade_il && Date.parse(c.scade_il) - Date.now() > 60000) return c.access_token;
    const r = await richiesta(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }) });
    salva({ access_token: r.access_token, scade_il: new Date(Date.now() + (r.expires_in || 3600) * 1000).toISOString() });
    return r.access_token;
  }

  async function g(metodo, percorso, corpo, query) {
    const url = API + percorso + (query ? '?' + new URLSearchParams(query) : '');
    return richiesta(url, { method: metodo, headers: { authorization: 'Bearer ' + (await token()), ...(corpo ? { 'content-type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  }

  // ---------------------------------------------------------------- collegamento

  function urlCollega(redirect) {
    const c = conf();
    if (!c.client_id) throw new Error('Mancano le credenziali OAuth');
    return AUTH + '?' + new URLSearchParams({ client_id: c.client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' });
  }

  async function completaCollegamento(code, redirect) {
    const c = conf();
    const r = await richiesta(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: 'authorization_code' }) });
    if (!r.refresh_token) throw new Error('Google non ha dato un refresh token: scollega l\'app da myaccount.google.com/permissions e riprova');
    salva({ refresh_token: r.refresh_token, access_token: r.access_token, scade_il: new Date(Date.now() + (r.expires_in || 3600) * 1000).toISOString(), errore: null });
    await assicuraCalendario();
  }

  function scollega() {
    const c = conf();
    setSetting(db, 'gcal', { client_id: c.client_id, client_secret: c.client_secret });
    db.exec('UPDATE attivita SET gcal_id = NULL, gcal_aggiornato = NULL, sincronizzato_il = NULL');
    db.exec("DELETE FROM attivita WHERE eliminata = 1");
    db.exec("DELETE FROM occupato WHERE fonte LIKE 'gcal:%'");
  }

  async function assicuraCalendario() {
    const c = conf();
    if (c.calendario_id) {
      try { await g('GET', `/calendars/${encodeURIComponent(c.calendario_id)}`); return c.calendario_id; } catch (e) { if (e.status !== 404) throw e; }
    }
    const nuovo = await g('POST', '/calendars', { summary: 'Cruscotto Famiglia', description: 'Attività del Cruscotto Famiglia: modificale qui o nell\'app, la sincronizzazione le allinea.', timeZone: TZ });
    salva({ calendario_id: nuovo.id, sync_token: null });
    db.exec('UPDATE attivita SET gcal_id = NULL, gcal_aggiornato = NULL, sincronizzato_il = NULL');
    return nuovo.id;
  }

  async function calendari() {
    const r = await g('GET', '/users/me/calendarList', null, { minAccessRole: 'reader' });
    const c = conf();
    return (r.items || []).filter((x) => x.id !== c.calendario_id).map((x) => ({ id: x.id, nome: x.summaryOverride || x.summary, principale: !!x.primary,
      leggi: (c.leggi || []).some((l) => l.id === x.id), persona_id: (c.leggi || []).find((l) => l.id === x.id)?.persona_id ?? null }));
  }

  function stato() {
    const c = conf();
    return { configurato: !!(c.client_id && c.client_secret), collegato: !!c.refresh_token, calendario_id: c.calendario_id || null,
      ultimo_sync: c.ultimo_sync || null, errore: c.errore || null, leggi: c.leggi || [], esito: c.esito || null };
  }

  // ---------------------------------------------------------------- sincronizzazione

  let inCorso = null;
  function sincronizza() {
    if (!inCorso) inCorso = esegui().finally(() => { inCorso = null; });
    return inCorso;
  }

  async function esegui() {
    const esito = { inviate: 0, eliminate_su_google: 0, ricevute: 0, create_da_google: 0, eliminate_da_google: 0, occupato: 0 };
    try {
      const cal = await assicuraCalendario();
      await invia(cal, esito);
      await ricevi(cal, esito);
      await leggiOccupato(esito);
      salva({ ultimo_sync: adesso(), errore: null, esito });
      return esito;
    } catch (e) {
      salva({ errore: e.message, ultimo_sync_fallito: adesso() });
      throw e;
    }
  }

  async function invia(cal, esito) {
    const calE = encodeURIComponent(cal);
    // eliminate nell'app → via anche da Google
    for (const a of all(db, 'SELECT id, gcal_id FROM attivita WHERE eliminata = 1')) {
      if (a.gcal_id) { try { await g('DELETE', `/calendars/${calE}/events/${encodeURIComponent(a.gcal_id)}`); } catch (e) { if (![404, 410].includes(e.status)) throw e; } }
      db.prepare('DELETE FROM attivita WHERE id = ?').run(a.id);
      esito.eliminate_su_google++;
    }
    // attività a cui è stata tolta la data: l'evento non serve più
    for (const a of all(db, 'SELECT id, gcal_id FROM attivita WHERE eliminata = 0 AND data IS NULL AND gcal_id IS NOT NULL')) {
      try { await g('DELETE', `/calendars/${calE}/events/${encodeURIComponent(a.gcal_id)}`); } catch (e) { if (![404, 410].includes(e.status)) throw e; }
      db.prepare('UPDATE attivita SET gcal_id = NULL, gcal_aggiornato = NULL, sincronizzato_il = NULL WHERE id = ?').run(a.id);
      esito.eliminate_su_google++;
    }
    // nuove o cambiate dall'ultima sincronizzazione
    const daInviare = all(db, `SELECT a.*, p.inchiostro FROM attivita a LEFT JOIN persone p ON p.id = a.persona_id
      WHERE a.eliminata = 0 AND a.data IS NOT NULL AND (a.sincronizzato_il IS NULL OR a.aggiornato_il > a.sincronizzato_il)`);
    for (const a of daInviare) {
      const ev = versoEvento(a);
      let r;
      if (a.gcal_id) {
        try { r = await g('PUT', `/calendars/${calE}/events/${encodeURIComponent(a.gcal_id)}`, ev); }
        catch (e) { if (![404, 410].includes(e.status)) throw e; r = await g('POST', `/calendars/${calE}/events`, ev); }
      } else r = await g('POST', `/calendars/${calE}/events`, ev);
      const t = adesso();
      db.prepare('UPDATE attivita SET gcal_id = ?, gcal_aggiornato = ?, sincronizzato_il = ?, aggiornato_il = ? WHERE id = ?').run(r.id, r.updated, t, t, a.id);
      esito.inviate++;
    }
  }

  async function ricevi(cal, esito) {
    const calE = encodeURIComponent(cal);
    let pagina = null, nuovoToken = null;
    const c = conf();
    const base = c.sync_token ? { syncToken: c.sync_token } : { timeMin: new Date(Date.now() - 90 * 86400000).toISOString(), showDeleted: 'true' };
    do {
      let r;
      try { r = await g('GET', `/calendars/${calE}/events`, null, { ...base, maxResults: '250', ...(pagina ? { pageToken: pagina } : {}) }); }
      catch (e) {
        if (e.status === 410) { salva({ sync_token: null }); return ricevi(cal, esito); } // token scaduto: rilettura completa
        throw e;
      }
      tx(db, () => { for (const ev of r.items || []) applicaEvento(ev, esito); });
      pagina = r.nextPageToken || null;
      nuovoToken = r.nextSyncToken || nuovoToken;
    } while (pagina);
    if (nuovoToken) salva({ sync_token: nuovoToken });
  }

  function applicaEvento(ev, esito) {
    if (ev.recurringEventId) return; // eccezioni di una serie: l'app gestisce la serie intera
    const loc = one(db, 'SELECT * FROM attivita WHERE gcal_id = ?', ev.id);
    if (ev.status === 'cancelled') {
      if (loc) { db.prepare('DELETE FROM attivita WHERE id = ?').run(loc.id); esito.eliminate_da_google++; }
      return;
    }
    const campi = daEvento(ev);
    if (!campi) return;
    if (loc) {
      if (loc.gcal_aggiornato === ev.updated) return; // è l'eco della nostra modifica
      const cambiataQui = loc.sincronizzato_il && loc.aggiornato_il > loc.sincronizzato_il;
      if (cambiataQui && loc.aggiornato_il > ev.updated) return; // la nostra è più recente: partirà al prossimo invio
      const cols = Object.keys(campi), t = adesso();
      db.prepare(`UPDATE attivita SET ${cols.map((k) => k + ' = ?').join(', ')}, gcal_aggiornato = ?, aggiornato_il = ?, sincronizzato_il = ? WHERE id = ?`)
        .run(...cols.map((k) => campi[k]), ev.updated, t, t, loc.id);
      esito.ricevute++;
      return;
    }
    // evento creato direttamente su Google nel calendario del cruscotto
    const idApp = Number(ev.extendedProperties?.private?.cruscotto_id);
    if (idApp && one(db, 'SELECT 1 FROM attivita WHERE id = ? AND gcal_id IS NULL', idApp)) {
      db.prepare('UPDATE attivita SET gcal_id = ?, gcal_aggiornato = ?, sincronizzato_il = ? WHERE id = ?').run(ev.id, ev.updated, adesso(), idApp);
      return;
    }
    const cols = Object.keys(campi), t = adesso();
    db.prepare(`INSERT INTO attivita (${cols.join(', ')}, gcal_id, gcal_aggiornato, sincronizzato_il, aggiornato_il) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?, ?)`)
      .run(...cols.map((k) => campi[k]), ev.id, ev.updated, t, t);
    esito.create_da_google++;
  }

  // Gli altri calendari scelti: intervalli occupati da 7 giorni fa a 5 settimane avanti.
  async function leggiOccupato(esito) {
    const leggi = conf().leggi || [];
    db.exec("DELETE FROM occupato WHERE fonte LIKE 'gcal:%'");
    if (!leggi.length) return;
    const timeMin = new Date(Date.now() - 7 * 86400000).toISOString(), timeMax = new Date(Date.now() + 35 * 86400000).toISOString();
    const r = await g('POST', '/freeBusy', { timeMin, timeMax, timeZone: TZ, items: leggi.map((l) => ({ id: l.id })) });
    const ins = db.prepare('INSERT INTO occupato (persona_id, inizio, fine, fonte) VALUES (?, ?, ?, ?)');
    for (const l of leggi) for (const b of r.calendars?.[l.id]?.busy || []) {
      ins.run(l.persona_id ?? null, locale(b.start), locale(b.end), 'gcal:' + l.id);
      esito.occupato++;
    }
  }

  function impostaCalendariDaLeggere(lista) {
    salva({ leggi: lista.filter((l) => l.id).map((l) => ({ id: l.id, persona_id: l.persona_id ?? null })) });
  }

  return { stato, urlCollega, completaCollegamento, scollega, calendari, sincronizza, impostaCalendariDaLeggere,
    salvaCredenziali: (id, segreto) => salva({ client_id: id.trim(), client_secret: segreto.trim() }) };
}

// ---------------------------------------------------------------- conversioni (esportate per i test)

export function versoEvento(a) {
  const ev = {
    summary: a.titolo,
    location: a.luogo || undefined,
    description: [a.note && a.note !== 'esempio' ? a.note : '', 'Dal Cruscotto Famiglia'].filter(Boolean).join('\n\n'),
    extendedProperties: { private: { cruscotto_id: String(a.id), tipo: a.tipo, stato: a.stato } },
    colorId: COLORE_PER_INCHIOSTRO[a.inchiostro] || undefined,
  };
  if (a.ora) {
    const inizio = `${a.data}T${a.ora}:00`;
    ev.start = { dateTime: inizio, timeZone: TZ };
    ev.end = { dateTime: sommaMinuti(inizio, a.durata_min || 60), timeZone: TZ };
  } else {
    ev.start = { date: a.data };
    ev.end = { date: addDays(a.fine || a.data, 1) };
  }
  const r = a.ripeti ? (typeof a.ripeti === 'string' ? JSON.parse(a.ripeti) : a.ripeti) : null;
  if (r) ev.recurrence = [rrule(r)];
  if (a.stato === 'fatta' && !a.ripeti) ev.summary = '✓ ' + a.titolo;
  return ev;
}

export function daEvento(ev) {
  const s = ev.start || {}, e = ev.end || {};
  let data, ora = null, durata = null, fine = null;
  if (s.date) {
    data = s.date;
    const ultimo = e.date ? addDays(e.date, -1) : s.date;
    if (ultimo > data) fine = ultimo;
  } else if (s.dateTime) {
    const [d, t] = locale(s.dateTime).split('T');
    data = d; ora = t.slice(0, 5);
    if (e.dateTime) durata = Math.round((Date.parse(e.dateTime) - Date.parse(s.dateTime)) / 60000);
  } else return null;
  let titolo = ev.summary || '(senza titolo)';
  let stato = ev.extendedProperties?.private?.stato || 'da_fare';
  if (titolo.startsWith('✓ ')) { titolo = titolo.slice(2); stato = 'fatta'; }
  const note = (ev.description || '').replace(/\n*Dal Cruscotto Famiglia\s*$/, '').trim() || null;
  const ripeti = (ev.recurrence || []).map(daRrule).find(Boolean) || null;
  return {
    titolo, data, ora, durata_min: durata, fine, luogo: ev.location || null, note, stato,
    tipo: ev.extendedProperties?.private?.tipo || (ora ? 'evento' : 'compito'),
    ripeti: ripeti ? JSON.stringify(ripeti) : null,
  };
}

export function rrule(r) {
  const parti = [];
  if (r.ogni === 'settimana') {
    parti.push('FREQ=WEEKLY');
    if (r.giorni?.length) parti.push('BYDAY=' + r.giorni.map((g) => GIORNI_RR[g - 1]).join(','));
    if (r.intervallo > 1) parti.push('INTERVAL=' + r.intervallo);
  } else if (r.ogni === 'mese') parti.push('FREQ=MONTHLY');
  else if (r.ogni === 'anno') parti.push('FREQ=YEARLY');
  else if (r.ogni === 'giorno') parti.push('FREQ=DAILY');
  if (r.fino) parti.push('UNTIL=' + r.fino.replace(/-/g, '') + 'T235959Z');
  return 'RRULE:' + parti.join(';');
}

export function daRrule(riga) {
  if (!riga.startsWith('RRULE:')) return null;
  const p = Object.fromEntries(riga.slice(6).split(';').map((x) => x.split('=')));
  const ogni = { WEEKLY: 'settimana', MONTHLY: 'mese', YEARLY: 'anno', DAILY: 'giorno' }[p.FREQ];
  if (!ogni) return null;
  const r = { ogni };
  if (p.BYDAY && ogni === 'settimana') r.giorni = p.BYDAY.split(',').map((d) => GIORNI_RR.indexOf(d.slice(-2)) + 1).filter((n) => n > 0);
  if (p.INTERVAL && Number(p.INTERVAL) > 1) r.intervallo = Number(p.INTERVAL);
  if (p.UNTIL) r.fino = `${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}`;
  return r;
}

function sommaMinuti(localeIso, min) {
  const [d, t] = localeIso.split('T');
  const [h, m] = t.split(':').map(Number);
  const tot = h * 60 + m + min;
  const giorni = Math.floor(tot / 1440), resto = tot % 1440;
  return `${addDays(d, giorni)}T${String(Math.floor(resto / 60)).padStart(2, '0')}:${String(resto % 60).padStart(2, '0')}:00`;
}

// Un orario ISO con fuso → data e ora locali di Roma "YYYY-MM-DDTHH:MM"
export function locale(iso) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return f.format(d).replace(' ', 'T');
}
