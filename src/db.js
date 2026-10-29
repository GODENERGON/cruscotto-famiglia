// Database SQLite (modulo node:sqlite, nessuna dipendenza esterna).
// Tutti gli importi sono in centesimi interi: positivi = entrate, negativi = uscite.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS persone (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  ruolo TEXT,                      -- adulto | figlia | famiglia
  tinta TEXT, inchiostro TEXT      -- colori d'identità
);

CREATE TABLE IF NOT EXISTS conti (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  persona_id INTEGER REFERENCES persone(id),
  tipo TEXT NOT NULL DEFAULT 'corrente',   -- corrente | carta | contanti | risparmio
  saldo_iniziale INTEGER NOT NULL DEFAULT 0,
  data_saldo TEXT NOT NULL DEFAULT (date('now')),
  attivo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categorie (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrata','uscita','giroconto')),
  natura TEXT NOT NULL DEFAULT 'variabile' CHECK (natura IN ('fissa','variabile')),
  area TEXT                          -- Casa, Maddalena, Salute, DIY, Immobili...
);

CREATE TABLE IF NOT EXISTS regole (
  id INTEGER PRIMARY KEY,
  testo TEXT NOT NULL,               -- sottostringa cercata nella descrizione, senza maiuscole
  categoria_id INTEGER NOT NULL REFERENCES categorie(id) ON DELETE CASCADE,
  persona_id INTEGER REFERENCES persone(id),
  priorita INTEGER NOT NULL DEFAULT 0,
  UNIQUE (testo, categoria_id)
);

CREATE TABLE IF NOT EXISTS import_lotti (
  id INTEGER PRIMARY KEY,
  creato_il TEXT NOT NULL DEFAULT (datetime('now')),
  file_nome TEXT, conto_id INTEGER REFERENCES conti(id),
  righe INTEGER, importate INTEGER, duplicate INTEGER
);

CREATE TABLE IF NOT EXISTS movimenti (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,                -- YYYY-MM-DD
  importo INTEGER NOT NULL,          -- centesimi, con segno
  descrizione TEXT NOT NULL DEFAULT '',
  categoria_id INTEGER REFERENCES categorie(id) ON DELETE SET NULL,
  persona_id INTEGER REFERENCES persone(id),
  conto_id INTEGER REFERENCES conti(id),
  fonte TEXT NOT NULL DEFAULT 'manuale',   -- manuale | csv | bot
  lotto_id INTEGER REFERENCES import_lotti(id) ON DELETE SET NULL,
  impronta TEXT UNIQUE,              -- per riconoscere i duplicati negli import
  note TEXT,
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS movimenti_data ON movimenti(data);

CREATE TABLE IF NOT EXISTS ricorrenze (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  importo INTEGER NOT NULL,          -- centesimi, con segno
  ogni_mesi INTEGER NOT NULL DEFAULT 1,    -- 1 mensile, 3 trimestrale, 12 annuale
  giorno INTEGER NOT NULL DEFAULT 1,
  dal TEXT NOT NULL,                 -- primo mese YYYY-MM-DD
  al TEXT,                           -- ultimo mese, vuoto = senza fine
  categoria_id INTEGER REFERENCES categorie(id),
  persona_id INTEGER REFERENCES persone(id),
  note TEXT,
  attiva INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS salvadanai (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  obiettivo INTEGER NOT NULL DEFAULT 0,    -- centesimi
  scadenza TEXT,                     -- YYYY-MM-DD
  versamento_mensile INTEGER NOT NULL DEFAULT 0,
  quota_percento REAL NOT NULL DEFAULT 0,  -- es. 30 = 30% di ogni entrata nella categoria collegata
  quota_categoria_id INTEGER REFERENCES categorie(id),
  persona_id INTEGER REFERENCES persone(id),
  priorita INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  archiviato INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accantonamenti (
  id INTEGER PRIMARY KEY,
  salvadanaio_id INTEGER NOT NULL REFERENCES salvadanai(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  importo INTEGER NOT NULL,          -- + versamento, - prelievo
  causale TEXT NOT NULL DEFAULT 'manuale', -- manuale | mensile | quota | spesa
  movimento_id INTEGER REFERENCES movimenti(id) ON DELETE CASCADE,
  nota TEXT,
  UNIQUE (salvadanaio_id, causale, data, movimento_id)
);

CREATE TABLE IF NOT EXISTS uscite_pianificate (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  importo INTEGER NOT NULL,          -- centesimi, negativo
  descrizione TEXT NOT NULL,
  salvadanaio_id INTEGER REFERENCES salvadanai(id) ON DELETE SET NULL,
  fatta INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS profili_csv (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  conto_id INTEGER REFERENCES conti(id),
  mappa TEXT NOT NULL                -- JSON con colonne e formati
);

-- ---------------------------------------------------------------- tempo (fase 2)
CREATE TABLE IF NOT EXISTS progetti (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  area TEXT,                         -- Casa, DIY, Università, Maddalena, Salute...
  persona_id INTEGER REFERENCES persone(id),
  stato TEXT NOT NULL DEFAULT 'attivo' CHECK (stato IN ('idea','attivo','in_pausa','chiuso')),
  inizio TEXT, fine TEXT,            -- previsti
  budget INTEGER,                    -- centesimi
  salvadanaio_id INTEGER REFERENCES salvadanai(id) ON DELETE SET NULL,
  luogo TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS attivita (
  id INTEGER PRIMARY KEY,
  titolo TEXT NOT NULL,
  progetto_id INTEGER REFERENCES progetti(id) ON DELETE SET NULL,
  persona_id INTEGER REFERENCES persone(id),
  tipo TEXT NOT NULL DEFAULT 'compito' CHECK (tipo IN ('compito','evento')),
  stato TEXT NOT NULL DEFAULT 'da_fare' CHECK (stato IN ('da_fare','in_corso','fatta')),
  data TEXT,                         -- giorno (inizio, per un lavoro di più giorni)
  ora TEXT,                          -- HH:MM, vuota = tutto il giorno
  durata_min INTEGER,                -- per gli orari
  fine TEXT,                         -- ultimo giorno di un lavoro lungo (Gantt)
  scadenza TEXT,
  luogo TEXT,
  priorita INTEGER NOT NULL DEFAULT 0,
  ripeti TEXT,                       -- JSON {"ogni":"settimana","giorni":[1,4],"fino":"2027-06-30"} o {"ogni":"mese"}
  costo INTEGER,                     -- centesimi, stimato
  note TEXT,
  fatta_il TEXT,
  gcal_id TEXT UNIQUE,               -- evento collegato su Google Calendar
  gcal_aggiornato TEXT,              -- 'updated' di Google all'ultima sincronizzazione
  aggiornato_il TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  eliminata INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS attivita_data ON attivita(data);

CREATE TABLE IF NOT EXISTS dipendenze (
  attivita_id INTEGER NOT NULL REFERENCES attivita(id) ON DELETE CASCADE,
  dipende_da INTEGER NOT NULL REFERENCES attivita(id) ON DELETE CASCADE,
  PRIMARY KEY (attivita_id, dipende_da)
);

-- intervalli occupati letti dagli altri calendari Google (lavoro, personale), per il tempo libero reale
CREATE TABLE IF NOT EXISTS occupato (
  id INTEGER PRIMARY KEY,
  persona_id INTEGER REFERENCES persone(id),
  inizio TEXT NOT NULL, fine TEXT NOT NULL,   -- ISO locali
  fonte TEXT
);

CREATE TABLE IF NOT EXISTS impostazioni (
  chiave TEXT PRIMARY KEY,
  valore TEXT
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

// Esegue fn in una transazione.
export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function getSetting(db, chiave, fallback = null) {
  const r = db.prepare('SELECT valore FROM impostazioni WHERE chiave = ?').get(chiave);
  return r ? JSON.parse(r.valore) : fallback;
}
export function setSetting(db, chiave, valore) {
  db.prepare('INSERT INTO impostazioni (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore')
    .run(chiave, JSON.stringify(valore));
}
