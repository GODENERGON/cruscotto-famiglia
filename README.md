# Cruscotto Famiglia

Entrate, uscite, salvadanai e previsione di cassa a 24 mesi per Denis, Carmen e Maddalena.
Gira sul NUC con Node 22, senza dipendenze da installare: database SQLite in un file.

## Installazione sul NUC

```bash
cd ~/Projects
git clone https://github.com/GODENERGON/cruscotto-famiglia.git
cd cruscotto-famiglia
./install.sh
```

Lo script crea il database con i dati reali noti, avvia il servizio all'accensione (chiede la password di sudo)
e mette l'icona «Cruscotto Famiglia» nel menu e sulla Scrivania: si apre in una finestra sua, senza barra degli indirizzi.
Per aggiornare a una versione nuova: `git pull && ./install.sh`. Lo script aggiunge solo quello che manca
(tabelle, progetti, categorie nuove) e riavvia il servizio; i dati inseriti restano.

Per avviarlo a mano invece: `npm run seed` una volta, poi `npm start` (http://localhost:8790).

Per vedere l'app piena con dati **inventati** (stipendi, quattro mesi di spese) senza toccare quelli veri:

```bash
npm run demo                 # usa data/demo.db
```

Serve Node **22.13 o più recente** (usa il modulo `node:sqlite`). Controlla con `node -v`.

## Cosa c'è già dentro (`npm run seed`)

- Persone: Denis, Carmen, Maddalena, Famiglia, ognuno con la sua tinta.
- Conti: Conto Denis e Conto Carmen con saldo **0**: inserisci il saldo vero in *Impostazioni › Conti*.
- Ricorrenze reali: affitto Monfalcone +900 €, rimborso spese +50 €, mutuo Monfalcone −500 € (fino a ottobre 2036),
  mutuo casa −600 € (fino a ottobre 2046, residuo da inserire). I giorni del mese sono messi al 5 e al 10: correggili.
- Salvadanai: Tasse (35% di ogni canone, **da tarare** sull'aliquota marginale), Fondo emergenza, Fondo Maddalena,
  Vacanza 2027, Orto Faedis (obiettivo 2.070 €, la variante C del progetto impianto), Workstation LLM,
  Anticipo secondo appartamento. Obiettivi e versamenti mensili vuoti: decidili voi.
- Categorie (fisse e variabili) e una trentina di regole per i negozi più comuni.

**Da aggiungere per una previsione vera:** gli stipendi netti di Denis e Carmen come ricorrenze, i saldi dei conti,
le spese pianificate (2° acconto IRPEF del 30 novembre, saldo di giugno, assicurazioni annuali).

## Le cinque viste

| Vista | A cosa serve |
| --- | --- |
| Panoramica | Libero da allocare nel mese, il mese per persona, spese grandi in arrivo e se sono coperte, cassa a 24 mesi, salvadanai |
| Movimenti | Elenco con filtri; cambi la categoria dal menu della riga e la regola viene ricordata per le descrizioni simili |
| Importa | Trascini il CSV della banca, controlli colonne e categorie, confermi. I doppioni vengono saltati, un import si può annullare |
| Tempo | Calendario (settimana e mese, per persona), da fare (per quando, luogo o progetto, con i «giri» per luogo), Gantt dei progetti con dipendenze |
| Salvadanai | Saldo, obiettivo, versamento mensile, quota automatica; spese pianificate e se il salvadanaio basta |
| Impostazioni | Ricorrenze, conti, categorie, regole, persone |

## Come ragiona

- **Libero da allocare** = entrate − uscite − quanto è andato nei salvadanai nel mese. I giroconti non contano.
- **Salvadanai**: soldi già destinati, non conti separati. Il saldo in banca non cambia, cambia quanto è libero.
  La quota automatica accantona una percentuale di ogni entrata della categoria collegata (es. 35% dell'affitto → Tasse).
- **Previsione**: parte dai saldi dei conti, aggiunge le ricorrenze non ancora arrivate, toglie la media delle spese
  variabili degli ultimi 3 mesi e le spese pianificate. Una spesa pagata da un salvadanaio controlla se il salvadanaio
  basta e, se no, dice quanto manca.
- **Ricorrenza già arrivata**: se nel mese c'è un movimento della stessa categoria con importo entro il 15%.

## Google Calendar

Le attività con una data finiscono in un calendario «Cruscotto Famiglia» sul tuo account Google (ricorrenze comprese),
e quello che crei o sposti lì torna nel cruscotto. Se una cosa cambia da tutte e due le parti vince la modifica più recente.
Gli altri calendari (lavoro, personale di Carmen) si possono leggere solo come «occupato» per contare le ore della settimana.

Si collega da *Impostazioni › Google Calendar*, che guida passo passo. In breve:

1. Su console.cloud.google.com crei un progetto, attivi **Google Calendar API**, configuri la schermata di consenso
   (Esterno, poi **Pubblica app**: in modalità test il collegamento scade ogni 7 giorni).
2. Crei un **ID client OAuth** di tipo «Applicazione web» con URI di reindirizzamento `http://localhost:8790/api/gcal/callback`.
3. Incolli ID e segreto nel cruscotto e premi **Collega**, aprendo il cruscotto **dal NUC** (`http://localhost:8790`):
   Google accetta il ritorno solo su localhost. Dopo, funziona da ogni dispositivo.

La sincronizzazione parte ogni 10 minuti e 20 secondi dopo ogni modifica; c'è anche «Sincronizza ora».

## Accesso da altri dispositivi

Dall'esterno: via Tailscale (`http://<ip-tailscale>:8790`). Se un giorno lo esponi sul tunnel Cloudflare,
imposta prima `PASSWORD=...` nel servizio: l'app chiede utente e password a ogni browser nuovo.

## Backup

Tutto è in `data/famiglia.db`. Una copia coerente anche con il server acceso:

```bash
sqlite3 data/famiglia.db ".backup 'backups/famiglia-$(date +%F).db'"
```

## Test

```bash
npm test
```

## Stile grafico

Costruito con la Taste Skill (stile *pastel consumer*, seed 127112859): un colore solo sui dati, tinte pallide per le
persone, numeri tabulari in Manrope. Note in `.taste-skill/notes.md`. Per installare la skill anche nel Claude Code del NUC:

```bash
git clone https://github.com/Leonxlnx/taste-skill.git ~/tools/taste-skill
~/tools/taste-skill/install.sh        # la collega in ~/.claude/skills
```

## Prossime fasi

3. Fisco e immobili: motore IRPEF a scaglioni per anno, piano F24, immobili con quote.
4. Decisioni: laurea, orto, workstation come scenari a confronto.
5. Inbox da Telegram e WhatsApp con lettura degli scontrini.
