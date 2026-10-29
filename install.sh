#!/usr/bin/env bash
# Installa il Cruscotto Famiglia sul NUC:
#   1. controlla Node (serve 22.13+)
#   2. crea il database con i dati reali noti (se non c'è già)
#   3. lo avvia come servizio systemd all'accensione (chiede la password di sudo)
#   4. mette l'icona nel menu delle applicazioni e sulla Scrivania
# Si può rilanciare: non tocca un database esistente.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8790}"
URL="http://localhost:${PORT}"
UTENTE="$(id -un)"
NODE="$(command -v node || true)"

echo "Cruscotto Famiglia → $DIR"

# 1. Node
if [[ -z "$NODE" ]]; then echo "Node non trovato. Installa Node 22.13 o più recente." >&2; exit 1; fi
VER="$("$NODE" -p 'process.versions.node')"
if ! "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Serve Node 22.13 o più recente (trovato $VER)." >&2; exit 1
fi
echo "✓ Node $VER"

# 2. Database
if [[ -f "$DIR/data/famiglia.db" ]]; then
  echo "✓ Database già presente: lo lascio com'è"
else
  (cd "$DIR" && "$NODE" --disable-warning=ExperimentalWarning scripts/seed.js)
  echo "✓ Database creato"
fi

# 3. Servizio
SERVIZIO=/etc/systemd/system/cruscotto-famiglia.service
TMP="$(mktemp)"
cat > "$TMP" <<EOF
[Unit]
Description=Cruscotto Famiglia
After=network-online.target
Wants=network-online.target

[Service]
User=$UTENTE
WorkingDirectory=$DIR
Environment=PORT=$PORT
Environment=DB=$DIR/data/famiglia.db
ExecStart=$NODE --disable-warning=ExperimentalWarning server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo install -m 644 "$TMP" "$SERVIZIO"
rm -f "$TMP"
sudo systemctl daemon-reload
sudo systemctl enable --now cruscotto-famiglia
sudo systemctl restart cruscotto-famiglia
sleep 1
if curl -fsS "$URL/api/meta" >/dev/null 2>&1; then echo "✓ Servizio attivo su $URL"; else echo "! Il servizio non risponde: guarda 'journalctl -u cruscotto-famiglia -n 30'" >&2; fi

# 4. Icona: apre l'app in una finestra propria (Chrome o Chromium in modalità app), altrimenti nel browser
BROWSER=""
for b in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge; do
  if command -v "$b" >/dev/null 2>&1; then BROWSER="$b"; break; fi
done
if [[ -n "$BROWSER" ]]; then ESEGUI="$BROWSER --app=$URL --class=CruscottoFamiglia"; else ESEGUI="xdg-open $URL"; fi

ICONE="$HOME/.local/share/icons"
APPS="$HOME/.local/share/applications"
mkdir -p "$ICONE" "$APPS"
cp "$DIR/public/icona.svg" "$ICONE/cruscotto-famiglia.svg"
cat > "$APPS/cruscotto-famiglia.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Cruscotto Famiglia
Comment=Entrate, uscite, salvadanai e previsione di cassa
Exec=$ESEGUI
Icon=$ICONE/cruscotto-famiglia.svg
Terminal=false
Categories=Office;Finance;
StartupWMClass=CruscottoFamiglia
EOF
chmod +x "$APPS/cruscotto-famiglia.desktop"
update-desktop-database "$APPS" >/dev/null 2>&1 || true

SCRIVANIA="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Scrivania")"
if [[ -d "$SCRIVANIA" ]]; then
  cp "$APPS/cruscotto-famiglia.desktop" "$SCRIVANIA/"
  chmod +x "$SCRIVANIA/cruscotto-famiglia.desktop"
  # su Ubuntu l'icona va segnata come affidabile per poterla aprire con un doppio clic
  gio set "$SCRIVANIA/cruscotto-famiglia.desktop" metadata::trusted true 2>/dev/null || true
  echo "✓ Icona sulla Scrivania ($SCRIVANIA) e nel menu delle applicazioni"
else
  echo "✓ Icona nel menu delle applicazioni"
fi
echo
echo "Fatto. Apri «Cruscotto Famiglia» dal menu o dalla Scrivania, oppure $URL"
