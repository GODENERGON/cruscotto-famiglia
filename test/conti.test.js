import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { parseAmount, parseDate, parseCsvText, guessMapping } from '../src/csv.js';
import * as C from '../src/conti.js';

test('importi in formato italiano e inglese', () => {
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('-1.234,56'), -123456);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount('-45.9'), -4590);
  assert.equal(parseAmount('€ 12,00'), 1200);
  assert.equal(parseAmount('(12,00)'), -1200);
  assert.equal(parseAmount('12,00-'), -1200);
  assert.equal(parseAmount('1.200'), 120000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('date', () => {
  assert.equal(parseDate('05/11/2026'), '2026-11-05');
  assert.equal(parseDate('5-11-26'), '2026-11-05');
  assert.equal(parseDate('2026-11-05'), '2026-11-05');
  assert.equal(parseDate('12/13/2026'), null);
  assert.equal(parseDate('totale'), null);
});

function nuovoDb() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO persone (nome, ruolo) VALUES ('Denis','adulto'),('Carmen','adulto'),('Famiglia','famiglia');
    INSERT INTO conti (nome, persona_id, saldo_iniziale, data_saldo) VALUES ('Conto Denis', 1, 100000, '2026-09-30');
    INSERT INTO categorie (nome, tipo, natura) VALUES ('Affitto','entrata','fissa'),('Spesa','uscita','variabile'),('Mutuo','uscita','fissa'),('Giroconto','giroconto','variabile');
    INSERT INTO regole (testo, categoria_id) VALUES ('esselunga', 2);`);
  return db;
}

const CSV = `Banca di Esempio - Estratto conto
Intestatario;Denis

Data contabile;Data valuta;Descrizione;Dare;Avere
01/10/2026;01/10/2026;PAGAMENTO POS ESSELUNGA UDINE;45,90;
01/10/2026;01/10/2026;PAGAMENTO POS ESSELUNGA UDINE;45,90;
05/10/2026;05/10/2026;BONIFICO DA ROSSI CANONE OTTOBRE;;900,00
10/10/2026;10/10/2026;RATA MUTUO;500,00;
Saldo finale;;;;1.308,20
`;

test('lettura CSV con intestazione spostata e colonne Dare/Avere', () => {
  const { rows, delim } = parseCsvText(CSV);
  assert.equal(delim, ';');
  const m = guessMapping(rows);
  assert.equal(m.header_riga, 3);
  assert.equal(m.col_data, 0);
  assert.equal(m.col_descrizione, 2);
  assert.equal(m.col_importo, -1);
  assert.equal(m.col_dare, 3);
  assert.equal(m.col_avere, 4);
});

test('import: anteprima, categorie dalle regole, duplicati, righe identiche tenute', () => {
  const db = nuovoDb();
  const a = C.anteprimaImport(db, { testo: CSV, conto_id: 1 });
  assert.equal(a.righe.length, 4);
  assert.equal(a.scartate.length, 1);
  assert.deepEqual(a.righe.map((r) => r.importo), [-4590, -4590, 90000, -50000]);
  assert.equal(a.righe[0].categoria_id, 2);
  assert.notEqual(a.righe[0].impronta, a.righe[1].impronta);
  const righe = a.righe.map((r, i) => ({ ...r, categoria_id: i === 2 ? 1 : i === 3 ? 3 : r.categoria_id, impara: i === 3 }));
  const c1 = C.confermaImport(db, { conto_id: 1, righe });
  assert.equal(c1.importate, 4);
  assert.equal(c1.regole, 1);
  const b = C.anteprimaImport(db, { testo: CSV, conto_id: 1 });
  assert.ok(b.righe.every((r) => r.duplicato));
  const c2 = C.confermaImport(db, { conto_id: 1, righe: b.righe });
  assert.equal(c2.importate, 0);
  assert.equal(c2.duplicate, 4);
  // la regola imparata riconosce la rata
  assert.equal(C.regolaPer(db, 'RATA MUTUO NOVEMBRE')?.categoria_id, 3);
});

test('quota automatica al salvadanaio Tasse e riepilogo del mese', () => {
  const db = nuovoDb();
  db.exec(`INSERT INTO salvadanai (nome, quota_percento, quota_categoria_id) VALUES ('Tasse', 35, 1)`);
  C.aggiungiMovimento(db, { data: '2026-10-05', importo: 90000, descrizione: 'Canone', categoria_id: 1, conto_id: 1 });
  C.aggiungiMovimento(db, { data: '2026-10-06', importo: -4590, descrizione: 'ESSELUNGA', conto_id: 1 });
  C.aggiungiMovimento(db, { data: '2026-10-10', importo: -50000, descrizione: 'Rata', categoria_id: 3, conto_id: 1 });
  C.aggiungiMovimento(db, { data: '2026-10-11', importo: -20000, descrizione: 'Verso conto Carmen', categoria_id: 4, conto_id: 1 });
  const r = C.riepilogoMese(db, '2026-10', '2026-10-31');
  assert.equal(r.entrate, 90000);
  assert.equal(r.fisse, -50000);
  assert.equal(r.variabili, -4590);
  assert.equal(r.accantonato, 31500);
  assert.equal(r.libero, 90000 - 50000 - 4590 - 31500);
  // cambiando l'importo la quota si ricalcola
  const id = db.prepare("SELECT id FROM movimenti WHERE descrizione = 'Canone'").get().id;
  C.aggiornaMovimento(db, id, { importo: 100000 });
  assert.equal(C.riepilogoMese(db, '2026-10', '2026-10-31').accantonato, 35000);
});

test('ricorrenze già arrivate non contano due volte, proiezione e copertura delle spese', () => {
  const db = nuovoDb();
  db.exec(`INSERT INTO ricorrenze (nome, importo, giorno, dal, categoria_id) VALUES ('Affitto', 90000, 5, '2026-10-01', 1), ('Mutuo', -50000, 10, '2026-10-01', 3);
    INSERT INTO salvadanai (nome, obiettivo, versamento_mensile) VALUES ('Orto', 200000, 50000);
    INSERT INTO uscite_pianificate (data, importo, descrizione, salvadanaio_id) VALUES ('2027-01-15', -207000, 'Impianto', 1);`);
  C.aggiungiMovimento(db, { data: '2026-10-05', importo: 90000, descrizione: 'Canone', categoria_id: 1, conto_id: 1 });
  const r = C.riepilogoMese(db, '2026-10', '2026-10-06');
  assert.deepEqual(r.pendenti.map((p) => p.nome), ['Mutuo']);
  const p = C.proiezione(db, 4, '2026-10-06');
  // ottobre: 1.000 + 900 già entrati, -500 mutuo in arrivo
  assert.equal(p.liquidita_oggi, 190000);
  assert.equal(p.totale[0], 140000);
  assert.equal(p.totale[1], 180000);
  assert.deepEqual(p.salvadanai[1], [50000, 100000, 150000, 0]);
  const e = p.eventi[0];
  assert.equal(e.coperto, 200000);
  assert.equal(e.mancante, 7000);
  assert.equal(p.libero[3], p.totale[3]);
});

test('versamenti mensili una volta sola e fino all\'obiettivo', () => {
  const db = nuovoDb();
  db.exec(`INSERT INTO salvadanai (nome, obiettivo, versamento_mensile) VALUES ('Vacanza', 70000, 30000)`);
  assert.equal(C.versaMensili(db, '2026-10', '2026-10-29').totale, 30000);
  assert.equal(C.versaMensili(db, '2026-10', '2026-10-29').totale, 0);
  C.versaMensili(db, '2026-11', '2026-11-29');
  assert.equal(C.versaMensili(db, '2026-12', '2026-12-29').totale, 10000);
});

test('le regole cercano parole intere e rispettano il segno', () => {
  const db = nuovoDb();
  db.exec(`INSERT INTO regole (testo, categoria_id) VALUES ('eni', 2)`);
  assert.equal(C.regolaPer(db, 'STIPENDIO DENIS', 260000), null);
  assert.equal(C.regolaPer(db, 'ENI STATION FAEDIS', -5000)?.categoria_id, 2);
  assert.equal(C.regolaPer(db, 'RIMBORSO ENI', 5000), null);
});

test('chiave della regola senza date e numeri', () => {
  assert.equal(C.chiaveDescrizione('PAGAMENTO POS 12/10/2026 ORE 18.32 ESSELUNGA UDINE CARTA *1234'), 'esselunga udine');
});
