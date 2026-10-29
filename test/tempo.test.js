import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import * as T from '../src/tempo.js';

function nuovoDb() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO persone (nome, ruolo) VALUES ('Denis','adulto'),('Carmen','adulto');
    INSERT INTO progetti (nome, area) VALUES ('Soffitta', 'Casa');`);
  return db;
}

test('date: lunedì e giorno della settimana', () => {
  assert.equal(T.weekday('2026-10-26'), 1);
  assert.equal(T.weekday('2026-11-01'), 7);
  assert.equal(T.monday('2026-10-29'), '2026-10-26');
  assert.equal(T.addDays('2026-10-31', 1), '2026-11-01');
});

test('ricorrenza settimanale su più giorni, con fine', () => {
  const db = nuovoDb();
  T.creaAttivita(db, { titolo: 'Palestra', tipo: 'evento', data: '2026-10-05', ora: '18:30', durata_min: 60, persona_id: 1, ripeti: { ogni: 'settimana', giorni: [1, 4], fino: '2026-11-02' } });
  const o = T.occorrenze(db, '2026-10-26', '2026-11-08');
  assert.deepEqual(o.map((x) => x.data), ['2026-10-26', '2026-10-29', '2026-11-02']);
  assert.deepEqual(T.oreSettimana(db, '2026-10-26'), [{ persona_id: 1, cruscotto: 120, altri: 0 }]);
});

test('ogni due settimane', () => {
  const db = nuovoDb();
  T.creaAttivita(db, { titolo: 'Pulizia filtri', data: '2026-10-05', ripeti: { ogni: 'settimana', intervallo: 2 } });
  assert.deepEqual(T.occorrenze(db, '2026-10-01', '2026-11-10').map((x) => x.data), ['2026-10-05', '2026-10-19', '2026-11-02']);
});

test('lavoro di più giorni appare su ogni giorno della finestra', () => {
  const db = nuovoDb();
  T.creaAttivita(db, { titolo: 'Botola', data: '2026-10-30', fine: '2026-11-03', progetto_id: 1 });
  const o = T.occorrenze(db, '2026-11-01', '2026-11-08');
  assert.deepEqual(o.map((x) => x.data), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(o.at(-1).ultimo, true);
});

test('to-do: gruppi, blocchi da dipendenze e dipendenze circolari rifiutate', () => {
  const db = nuovoDb();
  const a = T.creaAttivita(db, { titolo: 'Misure', data: '2026-10-20', progetto_id: 1 });
  const b = T.creaAttivita(db, { titolo: 'Taglio', data: '2026-11-10', fine: '2026-11-12', progetto_id: 1, dipende_da: [a] });
  T.creaAttivita(db, { titolo: 'Senza data' });
  T.creaAttivita(db, { titolo: 'Oggi', scadenza: '2026-10-29' });
  const td = T.daFare(db, '2026-10-29');
  const g = Object.fromEntries(td.map((x) => [x.titolo, x.gruppo]));
  assert.deepEqual(g, { Misure: 'in_ritardo', Taglio: 'dopo', 'Senza data': 'senza_data', Oggi: 'oggi' });
  assert.equal(td.find((x) => x.titolo === 'Taglio').bloccata, true);
  assert.throws(() => T.aggiornaAttivita(db, a, { dipende_da: [b] }), /circolare/);
  T.aggiornaAttivita(db, a, { stato: 'fatta' });
  assert.equal(T.daFare(db, '2026-10-29').find((x) => x.titolo === 'Taglio').bloccata, false);
});

test('Gantt: estremi del progetto e avanzamento', () => {
  const db = nuovoDb();
  const a = T.creaAttivita(db, { titolo: 'Misure', data: '2026-10-20', fine: '2026-10-22', progetto_id: 1, costo: 5000 });
  T.creaAttivita(db, { titolo: 'Taglio', data: '2026-11-10', fine: '2026-11-12', progetto_id: 1, costo: 38000, dipende_da: [a] });
  T.aggiornaAttivita(db, a, { stato: 'fatta' });
  const [p] = T.gantt(db, '2026-10-29');
  assert.equal(p.inizio, '2026-10-20');
  assert.equal(p.fine, '2026-11-12');
  assert.equal(`${p.fatte}/${p.totale}`, '1/2');
  assert.equal(p.costo_attivita, 43000);
  assert.deepEqual(p.attivita[1].dipende_da, [a]);
});

test('validazione', () => {
  const db = nuovoDb();
  assert.throws(() => T.creaAttivita(db, { titolo: 'X', data: '29/10/2026' }), /Data non valida/);
  assert.throws(() => T.creaAttivita(db, { titolo: 'X', data: '2026-10-29', fine: '2026-10-01' }), /prima/);
  assert.throws(() => T.creaAttivita(db, { data: '2026-10-29' }), /titolo/);
});
