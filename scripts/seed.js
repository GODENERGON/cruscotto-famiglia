// Prepara il database.
//   node scripts/seed.js               dati reali noti (persone, categorie, mutui, affitto, salvadanai vuoti)
//   node scripts/seed.js --demo        in più: stipendi, saldi e quattro mesi di movimenti DI ESEMPIO (data/demo.db)
// Si può rilanciare: non duplica quello che c'è già.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, tx } from '../src/db.js';
import { aggiungiMovimento, versaMensili } from '../src/conti.js';
import { addMonths, ym, firstDay, today, lastDay } from '../src/mesi.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const dbArg = process.argv.indexOf('--db');
const file = dbArg > 0 ? process.argv[dbArg + 1] : process.env.DB || join(ROOT, 'data', demo ? 'demo.db' : 'famiglia.db');
const oggi = process.env.OGGI || today();
const db = openDb(file);
const id = (tab, nome) => db.prepare(`SELECT id FROM ${tab} WHERE nome = ?`).get(nome)?.id;
const eur = (v) => Math.round(v * 100);

tx(db, () => {
  const persone = [
    ['Denis', 'adulto', '#dcebff', '#0a3a80'],
    ['Carmen', 'adulto', '#fde4ef', '#7a1747'],
    ['Maddalena', 'figlia', '#fdeccb', '#7a4a05'],
    ['Famiglia', 'famiglia', '#eef1f4', '#3a3d40'],
  ];
  for (const p of persone) db.prepare('INSERT OR IGNORE INTO persone (nome, ruolo, tinta, inchiostro) VALUES (?, ?, ?, ?)').run(...p);

  const cat = [
    ['Stipendio', 'entrata', 'fissa', 'Lavoro'],
    ['Affitto Monfalcone', 'entrata', 'fissa', 'Immobili'],
    ['Rimborso spese Monfalcone', 'entrata', 'fissa', 'Immobili'],
    ['Altre entrate', 'entrata', 'variabile', null],
    ['Mutuo Monfalcone', 'uscita', 'fissa', 'Immobili'],
    ['Mutuo casa', 'uscita', 'fissa', 'Casa'],
    ['Condominio Monfalcone', 'uscita', 'fissa', 'Immobili'],
    ['Utenze', 'uscita', 'fissa', 'Casa'],
    ['Assicurazioni', 'uscita', 'fissa', null],
    ['Abbonamenti', 'uscita', 'fissa', null],
    ['Palestra e yoga', 'uscita', 'fissa', 'Salute'],
    ['Tasse e imposte', 'uscita', 'fissa', 'Fisco'],
    ['Spesa alimentare', 'uscita', 'variabile', 'Casa'],
    ['Casa e manutenzione', 'uscita', 'variabile', 'Casa'],
    ['Auto e moto', 'uscita', 'variabile', null],
    ['Carburante', 'uscita', 'variabile', null],
    ['Salute e farmacia', 'uscita', 'variabile', 'Salute'],
    ['Maddalena', 'uscita', 'variabile', 'Maddalena'],
    ['Ristoranti e uscite', 'uscita', 'variabile', null],
    ['Vacanze', 'uscita', 'variabile', null],
    ['Progetti DIY', 'uscita', 'variabile', 'DIY'],
    ['Università', 'uscita', 'variabile', 'Università'],
    ['Abbigliamento', 'uscita', 'variabile', null],
    ['Regali', 'uscita', 'variabile', null],
    ['Varie', 'uscita', 'variabile', null],
    ['Giroconto', 'giroconto', 'variabile', null],
  ];
  for (const c of cat) db.prepare('INSERT OR IGNORE INTO categorie (nome, tipo, natura, area) VALUES (?, ?, ?, ?)').run(...c);

  const regole = [
    ['esselunga', 'Spesa alimentare'], ['conad', 'Spesa alimentare'], ['coop', 'Spesa alimentare'], ['despar', 'Spesa alimentare'],
    ['eurospin', 'Spesa alimentare'], ['lidl', 'Spesa alimentare'], ['aldi', 'Spesa alimentare'], ['interspar', 'Spesa alimentare'],
    ['farmacia', 'Salute e farmacia'], ['eni', 'Carburante'], ['q8', 'Carburante'], ['ip', 'Carburante'], ['tamoil', 'Carburante'],
    ['leroy merlin', 'Progetti DIY'], ['brico', 'Casa e manutenzione'], ['obi', 'Progetti DIY'], ['amazon', 'Varie'],
    ['enel', 'Utenze'], ['hera', 'Utenze'], ['acegas', 'Utenze'], ['iliad', 'Abbonamenti'], ['tim', 'Abbonamenti'],
    ['netflix', 'Abbonamenti'], ['spotify', 'Abbonamenti'], ['f24', 'Tasse e imposte'], ['agenzia entrate', 'Tasse e imposte'],
  ];
  for (const [t, c] of regole) db.prepare('INSERT OR IGNORE INTO regole (testo, categoria_id) VALUES (?, ?)').run(t, id('categorie', c));

  if (!db.prepare('SELECT 1 FROM conti').get()) {
    db.prepare('INSERT INTO conti (nome, persona_id, tipo, saldo_iniziale, data_saldo) VALUES (?, ?, ?, ?, ?)').run('Conto Denis', id('persone', 'Denis'), 'corrente', 0, oggi);
    db.prepare('INSERT INTO conti (nome, persona_id, tipo, saldo_iniziale, data_saldo) VALUES (?, ?, ?, ?, ?)').run('Conto Carmen', id('persone', 'Carmen'), 'corrente', 0, oggi);
  }

  // Ricorrenze note. Giorni del mese da verificare.
  const mese = ym(oggi);
  const ric = [
    ['Affitto Monfalcone', 90000, 5, 'Affitto Monfalcone', 'Denis', null, 'Canone 900 € al mese'],
    ['Rimborso spese Monfalcone', 5000, 5, 'Rimborso spese Monfalcone', 'Denis', null, 'Spese ribaltate all\'inquilino'],
    ['Mutuo Monfalcone', -50000, 10, 'Mutuo Monfalcone', 'Denis', '2036-10-31', 'Residuo circa 60.000 €, circa 10 anni'],
    ['Mutuo casa', -60000, 10, 'Mutuo casa', 'Carmen', '2046-10-31', 'Residuo da inserire; circa 20 anni'],
  ];
  for (const [nome, imp, g, c, p, al, note] of ric) {
    if (db.prepare('SELECT 1 FROM ricorrenze WHERE nome = ?').get(nome)) continue;
    db.prepare('INSERT INTO ricorrenze (nome, importo, giorno, dal, al, categoria_id, persona_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nome, imp, g, firstDay(mese), al, id('categorie', c), id('persone', p), note);
  }

  const pots = [
    // nome, obiettivo, scadenza, versamento mensile, quota %, categoria quota, priorità, note
    ['Tasse', 0, null, 0, 35, 'Affitto Monfalcone', 10, 'Quota del canone da accantonare: da tarare sull\'aliquota marginale'],
    ['Fondo emergenza', 0, null, 0, 0, null, 9, 'Obiettivo suggerito: sei mesi di uscite fisse'],
    ['Fondo Maddalena', 0, null, 0, 0, null, 8, null],
    ['Vacanza 2027', 0, null, 0, 0, null, 6, null],
    ['Orto Faedis', eur(2070), null, 0, 0, null, 5, 'Impianto variante C; B costa 260 € in più'],
    ['Workstation LLM', 0, null, 0, 0, null, 4, 'In attesa di decisione'],
    ['Anticipo secondo appartamento', 0, null, 0, 0, null, 3, null],
  ];
  for (const [nome, ob, sc, vm, q, qc, pr, note] of pots) {
    db.prepare('INSERT OR IGNORE INTO salvadanai (nome, obiettivo, scadenza, versamento_mensile, quota_percento, quota_categoria_id, priorita, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nome, ob, sc, vm, q, qc ? id('categorie', qc) : null, pr, note);
  }

  // Progetti dalla lista di Denis. Stati e date da decidere: tutto parte come idea, tranne quelli già avviati.
  const progetti = [
    ['Camino, bagno e botola soffitta', 'Casa', 'attivo', 'Faedis', null],
    ['Rinnovo soffitta', 'Casa', 'idea', 'Faedis', null],
    ['Piscina esterna', 'Casa', 'idea', 'Faedis', null],
    ['Casetta esterna', 'Casa', 'idea', 'Faedis', null],
    ['Orto Faedis', 'DIY', 'attivo', 'Faedis', 'Orto Faedis'],
    ['Workstation LLM', 'DIY', 'idea', 'Faedis', 'Workstation LLM'],
    ['Sonic Ager in miniatura', 'DIY', 'idea', 'Faedis', null],
    ['Università Denis', 'Università', 'idea', null, null],
    ['Secondo appartamento', 'Investimenti', 'idea', null, 'Anticipo secondo appartamento'],
    ['Impegni Maddalena', 'Maddalena', 'attivo', null, null],
    ['Palestra e yoga', 'Salute', 'attivo', null, null],
  ];
  for (const [nome, area, stato, luogo, pot] of progetti) {
    db.prepare('INSERT OR IGNORE INTO progetti (nome, area, stato, luogo, salvadanaio_id, persona_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nome, area, stato, luogo, pot ? id('salvadanai', pot) : null, area === 'Maddalena' ? id('persone', 'Maddalena') : area === 'Università' ? id('persone', 'Denis') : null);
  }
  db.prepare("UPDATE progetti SET budget = ? WHERE nome = 'Orto Faedis' AND budget IS NULL").run(eur(2070));
});

if (demo) seedDemo();
console.log(`Database pronto: ${file}${demo ? ' (con dati di esempio)' : ''}`);

// ------------------------------------------------------------------ dati di esempio
// Tutto quello che segue è INVENTATO per vedere il cruscotto pieno. Non usarlo come dato reale.
function seedDemo() {
  if (db.prepare("SELECT 1 FROM movimenti WHERE note = 'esempio'").get()) return;
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const mese = ym(oggi);
  const inizio = addMonths(mese, -4);
  const P = (n) => id('persone', n), K = (n) => id('categorie', n);
  tx(db, () => {
    db.prepare('UPDATE conti SET saldo_iniziale = ?, data_saldo = ? WHERE nome = ?').run(eur(6400), lastDay(addMonths(inizio, -1)), 'Conto Denis');
    db.prepare('UPDATE conti SET saldo_iniziale = ?, data_saldo = ? WHERE nome = ?').run(eur(2900), lastDay(addMonths(inizio, -1)), 'Conto Carmen');
    db.prepare("UPDATE ricorrenze SET dal = ? WHERE dal >= ?").run(firstDay(inizio), firstDay(inizio));
    const ins = db.prepare('INSERT INTO ricorrenze (nome, importo, giorno, dal, categoria_id, persona_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
    ins.run('Stipendio Denis', eur(2650), 27, firstDay(inizio), K('Stipendio'), P('Denis'), 'esempio');
    ins.run('Stipendio Carmen', eur(1720), 27, firstDay(inizio), K('Stipendio'), P('Carmen'), 'esempio');
    ins.run('Utenze', eur(-185), 15, firstDay(inizio), K('Utenze'), P('Famiglia'), 'esempio');
    ins.run('Palestra Denis', eur(-45), 2, firstDay(inizio), K('Palestra e yoga'), P('Denis'), 'esempio');
    ins.run('Yoga Carmen', eur(-60), 2, firstDay(inizio), K('Palestra e yoga'), P('Carmen'), 'esempio');
    ins.run('Piscina Maddalena', eur(-55), 3, firstDay(inizio), K('Maddalena'), P('Maddalena'), 'esempio');
    ins.run('Assicurazione auto', eur(-410), 20, `${inizio.slice(0, 4)}-03-20`, K('Assicurazioni'), P('Famiglia'), 'esempio');
    db.prepare("UPDATE ricorrenze SET ogni_mesi = 12 WHERE nome = 'Assicurazione auto'").run();

    const pot = (n, f) => db.prepare(`UPDATE salvadanai SET ${Object.keys(f).map((k) => k + ' = ?').join(', ')} WHERE nome = ?`).run(...Object.values(f), n);
    pot('Fondo emergenza', { obiettivo: eur(12000), versamento_mensile: eur(300) });
    pot('Fondo Maddalena', { obiettivo: eur(20000), versamento_mensile: eur(100), scadenza: '2040-09-01' });
    pot('Vacanza 2027', { obiettivo: eur(3000), versamento_mensile: eur(250), scadenza: '2027-07-01' });
    pot('Orto Faedis', { versamento_mensile: eur(200), scadenza: '2027-03-01' });
    pot('Anticipo secondo appartamento', { obiettivo: eur(40000), versamento_mensile: eur(300) });
    const s = (n, imp, nota) => db.prepare(`INSERT INTO accantonamenti (salvadanaio_id, data, importo, causale, nota) VALUES (?, ?, ?, 'manuale', ?)`).run(id('salvadanai', n), lastDay(addMonths(inizio, -1)), eur(imp), nota);
    s('Fondo emergenza', 4200, 'Saldo di partenza (esempio)');
    s('Fondo Maddalena', 2600, 'Saldo di partenza (esempio)');
    s('Tasse', 900, 'Saldo di partenza (esempio)');
    const pian = db.prepare('INSERT INTO uscite_pianificate (data, importo, descrizione, salvadanaio_id) VALUES (?, ?, ?, ?)');
    pian.run(`${mese.slice(0, 4)}-11-30`, eur(-1240), '2° acconto IRPEF (esempio)', id('salvadanai', 'Tasse'));
    pian.run(`${Number(mese.slice(0, 4)) + 1}-06-30`, eur(-2350), 'Saldo e 1° acconto IRPEF (esempio)', id('salvadanai', 'Tasse'));
    pian.run(`${Number(mese.slice(0, 4)) + 1}-03-15`, eur(-2070), 'Impianto orto Faedis', id('salvadanai', 'Orto Faedis'));
  });

  seedDemoTempo(mese);

  // movimenti mese per mese: le ricorrenze arrivate più le spese variabili
  const negozi = [
    ['ESSELUNGA UDINE', 'Spesa alimentare', 'Famiglia', 60, 140, 6],
    ['CONAD CIVIDALE', 'Spesa alimentare', 'Famiglia', 25, 70, 4],
    ['ENI STATION FAEDIS', 'Carburante', 'Denis', 45, 70, 2],
    ['Q8 CIVIDALE', 'Carburante', 'Carmen', 35, 55, 2],
    ['FARMACIA COMUNALE FAEDIS', 'Salute e farmacia', 'Famiglia', 9, 38, 1],
    ['PIZZERIA AL PONTE', 'Ristoranti e uscite', 'Famiglia', 38, 72, 1],
    ['LEROY MERLIN UDINE', 'Progetti DIY', 'Denis', 25, 140, 1],
    ['AMAZON MARKETPLACE', null, 'Famiglia', 12, 60, 2],
    ['LIBRERIA TARANTOLA', 'Maddalena', 'Maddalena', 10, 28, 1],
    ['SUMUP *BAR CENTRALE', null, 'Denis', 3, 9, 3],
  ];
  const ric = db.prepare('SELECT * FROM ricorrenze WHERE attiva = 1').all();
  const contoDi = (persona) => id('conti', persona === 'Carmen' ? 'Conto Carmen' : 'Conto Denis');
  const nomeP = new Map(db.prepare('SELECT id, nome FROM persone').all().map((p) => [p.id, p.nome]));
  for (let i = 0; i <= 4; i++) {
    const m = addMonths(inizio, i);
    const finoA = m === mese ? oggi : lastDay(m);
    for (const r of ric) {
      const occ = (Number(m.slice(5)) - Number(r.dal.slice(5, 7)) + 12) % r.ogni_mesi === 0;
      const d = `${m}-${String(r.giorno).padStart(2, '0')}`;
      if (!occ || d > finoA) continue;
      aggiungiMovimento(db, { data: d, importo: r.importo, descrizione: r.nome.toUpperCase(), categoria_id: r.categoria_id, persona_id: r.persona_id, conto_id: contoDi(nomeP.get(r.persona_id)), note: 'esempio' });
    }
    for (const [desc, c, p, lo, hi, n] of negozi) {
      for (let k = 0; k < n; k++) {
        const g = 1 + Math.floor(rnd() * 27);
        const d = `${m}-${String(g).padStart(2, '0')}`;
        if (d > finoA) continue;
        aggiungiMovimento(db, { data: d, importo: -eur(lo + Math.round(rnd() * (hi - lo) * 100) / 100), descrizione: desc, categoria_id: c ? K(c) : null, persona_id: P(p), conto_id: contoDi(p), note: 'esempio' });
      }
    }
    if (m !== mese) versaMensili(db, m, lastDay(m));
  }
}

// Attività di esempio per calendario, to-do e Gantt (INVENTATE).
function seedDemoTempo(mese) {
  if (db.prepare("SELECT 1 FROM attivita WHERE note = 'esempio'").get()) return;
  const P = (n) => id('persone', n), G = (n) => id('progetti', n);
  const lun = (() => { const d = new Date(oggi + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  const g = (n) => { const d = new Date(lun + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ins = (a) => {
    const cols = Object.keys(a);
    return Number(db.prepare(`INSERT INTO attivita (${cols.join(',')}, note) VALUES (${cols.map(() => '?').join(',')}, 'esempio')`).run(...cols.map((c) => a[c])).lastInsertRowid);
  };
  const dip = (a, b) => db.prepare('INSERT INTO dipendenze (attivita_id, dipende_da) VALUES (?, ?)').run(a, b);
  tx(db, () => {
    ins({ titolo: 'Palestra', tipo: 'evento', persona_id: P('Denis'), progetto_id: G('Palestra e yoga'), data: g(-14), ora: '18:30', durata_min: 75, ripeti: JSON.stringify({ ogni: 'settimana', giorni: [1, 4] }), luogo: 'Cividale' });
    ins({ titolo: 'Yoga', tipo: 'evento', persona_id: P('Carmen'), progetto_id: G('Palestra e yoga'), data: g(-14), ora: '19:00', durata_min: 60, ripeti: JSON.stringify({ ogni: 'settimana', giorni: [2, 5] }), luogo: 'Faedis' });
    ins({ titolo: 'Piscina', tipo: 'evento', persona_id: P('Maddalena'), progetto_id: G('Impegni Maddalena'), data: g(-14), ora: '17:00', durata_min: 60, ripeti: JSON.stringify({ ogni: 'settimana', giorni: [2, 5] }), luogo: 'Cividale' });
    ins({ titolo: 'Visita pediatrica', tipo: 'evento', persona_id: P('Maddalena'), progetto_id: G('Impegni Maddalena'), data: g(3), ora: '16:30', durata_min: 45, luogo: 'Udine' });
    ins({ titolo: 'Prenotare richiamo vaccino', tipo: 'compito', persona_id: P('Carmen'), progetto_id: G('Impegni Maddalena'), scadenza: g(9) });
    ins({ titolo: 'Export CSV banca di ottobre', tipo: 'compito', persona_id: P('Denis'), data: g(1) });
    ins({ titolo: 'F24 secondo acconto IRPEF', tipo: 'compito', persona_id: P('Denis'), scadenza: `${mese.slice(0, 4)}-11-30`, priorita: 2 });
    ins({ titolo: 'Verifica conguaglio condominio', tipo: 'compito', persona_id: P('Denis'), luogo: 'Monfalcone' });
    const m1 = ins({ titolo: 'Misure e progetto botola', tipo: 'compito', persona_id: P('Denis'), progetto_id: G('Camino, bagno e botola soffitta'), data: g(-7), fine: g(-3), stato: 'fatta', fatta_il: g(-3), luogo: 'Faedis' });
    const m2 = ins({ titolo: 'Preventivo canna fumaria', tipo: 'compito', persona_id: P('Denis'), progetto_id: G('Camino, bagno e botola soffitta'), data: g(-2), fine: g(4), costo: eur(150), luogo: 'Faedis' });
    const m3 = ins({ titolo: 'Taglio solaio e posa botola', tipo: 'compito', persona_id: P('Denis'), progetto_id: G('Camino, bagno e botola soffitta'), data: g(12), fine: g(16), costo: eur(380), luogo: 'Faedis' });
    const m4 = ins({ titolo: 'Posa camino', tipo: 'compito', progetto_id: G('Camino, bagno e botola soffitta'), data: g(21), fine: g(33), costo: eur(2400), luogo: 'Faedis' });
    const m5 = ins({ titolo: 'Bagno: impianti e piastrelle', tipo: 'compito', progetto_id: G('Camino, bagno e botola soffitta'), data: g(40), fine: g(68), costo: eur(4200), luogo: 'Faedis' });
    dip(m2, m1); dip(m3, m1); dip(m4, m2); dip(m5, m3);
    const o1 = ins({ titolo: 'Chiusura stagione e pacciamatura', tipo: 'compito', persona_id: P('Denis'), progetto_id: G('Orto Faedis'), data: g(5), fine: g(6), luogo: 'Faedis' });
    const o2 = ins({ titolo: 'Prova radio LoRa con antenne di serie', tipo: 'compito', persona_id: P('Denis'), progetto_id: G('Orto Faedis'), data: g(18), fine: g(20), costo: eur(57), luogo: 'Faedis' });
    const o3 = ins({ titolo: 'Recinzione e antigrandine', tipo: 'compito', persona_id: P('Denis'), progetto_id: G('Orto Faedis'), data: g(126), fine: g(140), costo: eur(1140), luogo: 'Faedis' });
    const o4 = ins({ titolo: 'Quadro, sensori e irrigazione', tipo: 'compito', persona_id: P('Denis'), progetto_id: G('Orto Faedis'), data: g(141), fine: g(150), costo: eur(810), luogo: 'Faedis' });
    dip(o3, o1); dip(o4, o2); dip(o4, o3);
  });
}
