# Note di design — Cruscotto Famiglia (fase 1)

Stile: pastel-consumer (seed 127112859), light, shell a icon rail.
Perché: budget di famiglia usato da due persone, spesso dal telefono, sguardo veloce; lo stile prevede una tinta per persona.

## Domanda dello schermo Panoramica
"Quanto ci resta libero questo mese, e i salvadanai arrivano in tempo?"
Il numero più grande: "Libero da allocare" del mese corrente.
Finding: la prossima uscita straordinaria coperta (o no) da un salvadanaio, oppure il mese in cui la liquidità libera scende al minimo.

## Faccia
- Persone con tinta propria, pallida con inchiostro scuro dello stesso tono:
  Denis 215° (#dcebff / #0a3a80), Carmen 335° (#fde4ef / #7a1747), Maddalena 35° (#fdeccb / #7a4a05), Famiglia neutro.
- Cifre in Manrope 600, tabulari, centesimi più piccoli e grigi.

## Elemento firma
"Il mese in corsie": Denis | Carmen | Famiglia affiancati — chi porta cosa, chi paga cosa, cosa resta.

## Hue dati
Cobalto #1d5fd6 sulla linea della liquidità libera proiettata (elemento principale). Totale in inchiostro grigio.

## Griglia
Canvas: rail 56px + padding 24 + contenuto fluido. Righe a 12 colonne, gap 24.
1440: 1440 - 56 - 48 = 1336 di contenuto → 12 x 91.33 + 11 x 24 = 1336.
