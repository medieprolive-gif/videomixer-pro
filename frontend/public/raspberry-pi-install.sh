#!/usr/bin/env bash
# KinoKontroll – Raspberry Pi Display installer
# -----------------------------------------------
# Konfigurerer Pi-en til å automatisk åpne /display-siden i fullskjerm
# Chromium ved oppstart — som en TV-kiosk uten musepeker eller menyer.
#
# Bruk:
#   curl -fsSL https://multi-view-video.emergent.host/raspberry-pi-install.sh | sudo bash
#
# Tested på Raspberry Pi OS Bookworm (Pi 3, 4, 5).
# Eldre Pi-er (Pi Zero, Pi 1) støttes ikke — HLS-avspilling krever H.264-decoder.

set -euo pipefail

DISPLAY_URL="${DISPLAY_URL:-https://multi-view-video.emergent.host/display}"
SERVICE_NAME="kinokontroll-display"
KIOSK_USER="${SUDO_USER:-pi}"

# --- root check -------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "Dette skriptet må kjøres som root. Prøv:"
  echo "  curl -fsSL https://multi-view-video.emergent.host/raspberry-pi-install.sh | sudo bash"
  exit 1
fi

echo ""
echo "================================================================"
echo "  KinoKontroll Display – Raspberry Pi installasjon"
echo "================================================================"
echo "  URL:        $DISPLAY_URL"
echo "  Bruker:     $KIOSK_USER"
echo "================================================================"
echo ""

# --- 1) System update + pakker ---------------------------------------------
echo "[1/5] Oppdaterer system og installerer Chromium..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  chromium-browser \
  unclutter \
  xdotool \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  openbox \
  fonts-noto-color-emoji \
  >/dev/null

# --- 2) Auto-login -----------------------------------------------------------
echo "[2/5] Setter opp auto-login for bruker $KIOSK_USER..."
raspi-config nonint do_boot_behaviour B4 >/dev/null 2>&1 || true

# --- 3) Openbox autostart ----------------------------------------------------
echo "[3/5] Konfigurerer kiosk-autostart..."
USER_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)
OPENBOX_DIR="$USER_HOME/.config/openbox"
mkdir -p "$OPENBOX_DIR"

cat > "$OPENBOX_DIR/autostart" <<'AUTOSTART_EOF'
#!/bin/bash
# KinoKontroll display autostart

# Slå av skjermsparing + power management
xset s off
xset -dpms
xset s noblank

# Skjul musepeker etter 0.5 sek inaktivitet
unclutter -idle 0.5 -root &

# Vent på nettverk (opptil 60s)
for i in {1..60}; do
  if ping -c1 -W1 8.8.8.8 >/dev/null 2>&1; then break; fi
  sleep 1
done

# Slett gammel sesjon-data så ingen "gjenoppta økt"-dialog vises
USER_DATA_DIR="/home/$USER/.config/chromium-kiosk"
mkdir -p "$USER_DATA_DIR"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' \
    "$USER_DATA_DIR/Default/Preferences" 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' \
    "$USER_DATA_DIR/Default/Preferences" 2>/dev/null || true

# Start Chromium i ren kiosk
DISPLAY_URL=$(cat /etc/kinokontroll/display-url 2>/dev/null || \
              echo "__DISPLAY_URL__")

while true; do
  chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=TranslateUI,AutofillServerCommunication \
    --no-first-run \
    --check-for-update-interval=31536000 \
    --autoplay-policy=no-user-gesture-required \
    --user-data-dir="$USER_DATA_DIR" \
    --start-fullscreen \
    --window-position=0,0 \
    --overscroll-history-navigation=0 \
    "$DISPLAY_URL"
  # Hvis Chromium dør (krasj/lukket), vent 5 sek og start på nytt
  sleep 5
done
AUTOSTART_EOF

# Injiser URL inn i autostart-skriptet
sed -i "s|__DISPLAY_URL__|$DISPLAY_URL|g" "$OPENBOX_DIR/autostart"
chmod +x "$OPENBOX_DIR/autostart"

# Lagre URL slik at brukeren kan endre den senere uten å reinstallere
mkdir -p /etc/kinokontroll
echo "$DISPLAY_URL" > /etc/kinokontroll/display-url

# --- 4) startx ved login -----------------------------------------------------
echo "[4/5] Sørger for at X starter automatisk..."
BASH_PROFILE="$USER_HOME/.bash_profile"
if ! grep -q "startx" "$BASH_PROFILE" 2>/dev/null; then
  cat >> "$BASH_PROFILE" <<'PROFILE_EOF'

# KinoKontroll: start grafisk sesjon automatisk på tty1
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx -- -nocursor
fi
PROFILE_EOF
fi

# --- 5) X session config -----------------------------------------------------
XINITRC="$USER_HOME/.xinitrc"
cat > "$XINITRC" <<'XINIT_EOF'
#!/bin/bash
exec openbox-session
XINIT_EOF
chmod +x "$XINITRC"

# Eierskap for kiosk-brukeren
chown -R "$KIOSK_USER":"$KIOSK_USER" "$USER_HOME/.config" "$XINITRC" "$BASH_PROFILE"

# --- ferdig ------------------------------------------------------------------
echo ""
echo "================================================================"
echo "  Installasjon ferdig!"
echo "================================================================"
echo ""
echo "  Reboot Pi-en for å starte kiosk-modus:"
echo "      sudo reboot"
echo ""
echo "  Etter reboot booter Pi-en direkte inn i $DISPLAY_URL"
echo ""
echo "  Slik endrer du URL senere (uten å reinstallere):"
echo "      sudo nano /etc/kinokontroll/display-url"
echo "      sudo reboot"
echo ""
echo "  Slik kommer du ut av kiosk-modus midlertidig (lokal tastatur):"
echo "      Ctrl + Alt + F2  (bytt til en annen tty)"
echo "      Tilbake:  Ctrl + Alt + F1"
echo ""
echo "================================================================"
