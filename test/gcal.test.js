// Sincronizzazione Google Calendar contro un Google finto in memoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting, getSetting } from '../src/db.js';
import * as T from '../src/tempo.js';
import { creaGcal, versoEvento, daEvento, rrule, daRrule, locale } from '../src/gcal.js';

function googleFinto() {
  const cals = new Map(); // id -> Map(eventId -> event)
  let seq = 1, clock = Date.parse('2026-10-29T10:00:00Z');
  const tick = () => new Date((clock += 1000)).toISOString();
  const changes = []; // [calId, eventId, seqNo]
  const log = [];
  const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const fetch = async (url, opt = {}) => {
    const u = new URL(url), m = opt.method || 'GET';
    log.push(`${m} ${u.pathname}`);
    if (u.href.startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    const p = u.pathname.replace('/calendar/v3', '');
    let r;
    if ((r = p.match(/^\/calendars$/)) && m === 'POST') { const id = 'cal' + seq++; cals.set(id, new Map()); return json(200, { id }); }
    if ((r = p.match(/^\/calendars\/([^/]+)$/))) return cals.has(decodeURIComponent(r[1])) ? json(200, { id: r[1] }) : json(404, { error: { message: 'nf' } });
    if (p === '/users/me/calendarList') return json(200, { items: [{ id: 'lavoro@x', summary: 'Lavoro' }, ...[...cals.keys()].map((id) => ({ id, summary: 'Cruscotto Famiglia' }))] });
    if (p === '/freeBusy') return json(200, { calendars: { 'lavoro@x': { busy: [{ start: '2026-10-29T08:00:00Z', end: '2026-10-29T16:00:00Z' }] } } });
    if ((r = p.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/))) {
      const cal = cals.get(decodeURIComponent(r[1])), id = r[2] && decodeURIComponent(r[2]);
      const body = opt.body ? JSON.parse(opt.body) : null;
      if (m === 'POST') { const ev = { ...body, id: 'ev' + seq++, status: 'confirmed', updated: tick() }; cal.set(ev.id, ev); changes.push([ev.id, changes.length + 1]); return json(200, ev); }
      if (m === 'PUT') { if (!cal.has(id)) return json(404, {}); const ev = { ...body, id, status: 'confirmed', updated: tick() }; cal.set(id, ev); changes.push([id, changes.length + 1]); return json(200, ev); }
      if (m === 'DELETE') { if (!cal.has(id)) return json(410, {}); cal.set(id, { id, status: 'cancelled', updated: tick() }); changes.push([id, changes.length + 1]); return json(204, null); }
      if (m === 'GET') {
        const st = u.searchParams.get('syncToken');
        const da = st ? Number(st) : 0;
        const ids = [...new Set(changes.filter(([, n]) => n > da).map(([e]) => e))];
        const items = st ? ids.map((e) => cal.get(e)) : [...cal.values()].filter((e) => e.status !== 'cancelled' || u.searchParams.get('showDeleted'));
        return json(200, { items, nextSyncToken: String(changes.length) });
      }
    }
    return json(404, { error: { message: 'route ' + m + ' ' + p } });
  };
  // modifica "dall'utente su Google"
  const modificaDaGoogle = (calId, evId, cambi) => { const cal = cals.get(calId); cal.set(evId, { ...cal.get(evId), ...cambi, updated: tick() }); changes.push([evId, changes.length + 1]); };
  const creaDaGoogle = (calId, ev) => { const id = 'ev' + seq++; cals.get(calId).set(id, { ...ev, id, status: 'confirmed', updated: tick() }); changes.push([id, changes.length + 1]); return id; };
  return { fetch, cals, log, modificaDaGoogle, creaDaGoogle };
}

function setup() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO persone (nome, ruolo, inchiostro) VALUES ('Denis','adulto','#0a3a80'),('Carmen','adulto','#7a1747');`);
  const G = googleFinto();
  let t = Date.parse('2026-10-29T12:00:00Z');
  const gc = creaGcal(db, { fetch: G.fetch, adesso: () => new Date((t += 1000)).toISOString() });
  setSetting(db, 'gcal', { client_id: 'id', client_secret: 's', refresh_token: 'r' });
  return { db, G, gc };
}

test('conversioni: evento con orario, giornata intera di più giorni, ricorrenza', () => {
  const ev = versoEvento({ id: 7, titolo: 'Palestra', data: '2026-10-29', ora: '23:30', durata_min: 75, ripeti: '{"ogni":"settimana","giorni":[1,4],"fino":"2026-12-31"}', tipo: 'evento', stato: 'da_fare', inchiostro: '#0a3a80' });
  assert.deepEqual(ev.start, { dateTime: '2026-10-29T23:30:00', timeZone: 'Europe/Rome' });
  assert.deepEqual(ev.end, { dateTime: '2026-10-30T00:45:00', timeZone: 'Europe/Rome' });
  assert.deepEqual(ev.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231T235959Z']);
  assert.equal(ev.colorId, '9');
  const lungo = versoEvento({ id: 8, titolo: 'Botola', data: '2026-11-10', fine: '2026-11-12', tipo: 'compito', stato: 'da_fare' });
  assert.deepEqual([lungo.start, lungo.end], [{ date: '2026-11-10' }, { date: '2026-11-13' }]);
  const back = daEvento({ ...lungo, updated: 'x' });
  assert.equal(back.fine, '2026-11-12');
  const ritorno = daEvento({ ...ev, start: { dateTime: '2026-10-29T23:30:00+01:00' }, end: { dateTime: '2026-10-30T00:45:00+01:00' } });
  assert.equal(ritorno.ora, '23:30');
  assert.equal(ritorno.durata_min, 75);
  assert.deepEqual(JSON.parse(ritorno.ripeti), { ogni: 'settimana', giorni: [1, 4], fino: '2026-12-31' });
  assert.deepEqual(daRrule(rrule({ ogni: 'settimana', giorni: [3], intervallo: 2 })), { ogni: 'settimana', giorni: [3], intervallo: 2 });
  assert.equal(locale('2026-07-01T10:00:00Z'), '2026-07-01T12:00');
});

test('sincronizzazione nei due sensi, senza rimbalzi', async () => {
  const { db, G, gc } = setup();
  const a = T.creaAttivita(db, { titolo: 'Visita pediatrica', tipo: 'evento', data: '2026-11-03', ora: '16:30', durata_min: 45, persona_id: 2 });
  T.creaAttivita(db, { titolo: 'Senza data' });
  const e1 = await gc.sincronizza();
  assert.equal(e1.inviate, 1);
  const cal = getSetting(db, 'gcal').calendario_id;
  const evId = db.prepare('SELECT gcal_id FROM attivita WHERE id = ?').get(a).gcal_id;
  assert.ok(G.cals.get(cal).get(evId));
  // una seconda sincronizzazione senza cambi non invia e non riceve niente
  const e2 = await gc.sincronizza();
  assert.equal(e2.inviate, 0);
  assert.equal(e2.ricevute, 0);
  // modifica su Google → arriva nell'app
  G.modificaDaGoogle(cal, evId, { start: { dateTime: '2026-11-04T17:00:00+01:00' }, end: { dateTime: '2026-11-04T17:30:00+01:00' }, location: 'Udine' });
  const e3 = await gc.sincronizza();
  assert.equal(e3.ricevute, 1);
  const dopo = db.prepare('SELECT * FROM attivita WHERE id = ?').get(a);
  assert.deepEqual([dopo.data, dopo.ora, dopo.durata_min, dopo.luogo], ['2026-11-04', '17:00', 30, 'Udine']);
  assert.equal((await gc.sincronizza()).inviate, 0);
  // modifica nell'app → va su Google
  T.aggiornaAttivita(db, a, { titolo: 'Visita pediatrica (richiamo)' });
  assert.equal((await gc.sincronizza()).inviate, 1);
  assert.equal(G.cals.get(cal).get(evId).summary, 'Visita pediatrica (richiamo)');
  // evento creato su Google → nuova attività
  G.creaDaGoogle(cal, { summary: 'Cena dai nonni', start: { dateTime: '2026-11-07T19:30:00+01:00' }, end: { dateTime: '2026-11-07T22:00:00+01:00' } });
  const e4 = await gc.sincronizza();
  assert.equal(e4.create_da_google, 1);
  assert.equal(db.prepare("SELECT tipo FROM attivita WHERE titolo = 'Cena dai nonni'").get().tipo, 'evento');
  // eliminata nell'app → cancellata su Google e poi sparisce
  T.eliminaAttivita(db, a);
  await gc.sincronizza();
  assert.equal(G.cals.get(cal).get(evId).status, 'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attivita WHERE id = ?').get(a).n, 0);
  // eliminata su Google → sparisce dall'app
  const cena = db.prepare("SELECT gcal_id FROM attivita WHERE titolo = 'Cena dai nonni'").get().gcal_id;
  G.modificaDaGoogle(cal, cena, { status: 'cancelled' });
  assert.equal((await gc.sincronizza()).eliminate_da_google, 1);
});

test('altri calendari come tempo occupato', async () => {
  const { db, gc } = setup();
  gc.impostaCalendariDaLeggere([{ id: 'lavoro@x', persona_id: 1 }]);
  const e = await gc.sincronizza();
  assert.equal(e.occupato, 1);
  assert.deepEqual(T.oreSettimana(db, '2026-10-26'), [{ persona_id: 1, cruscotto: 0, altri: 480 }]);
  const lista = await gc.calendari();
  assert.deepEqual(lista.map((c) => [c.id, c.leggi, c.persona_id]), [['lavoro@x', true, 1]]);
});

test('compito fatto: la spunta si vede anche su Google', async () => {
  const { db, G, gc } = setup();
  const a = T.creaAttivita(db, { titolo: 'F24', data: '2026-11-30' });
  await gc.sincronizza();
  T.aggiornaAttivita(db, a, { stato: 'fatta' });
  await gc.sincronizza();
  const cal = getSetting(db, 'gcal').calendario_id;
  const ev = G.cals.get(cal).get(db.prepare('SELECT gcal_id FROM attivita WHERE id = ?').get(a).gcal_id);
  assert.equal(ev.summary, '✓ F24');
});
