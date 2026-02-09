#!/bin/bash
#
# PayTerm Raspberry Pi Setup Script
#
# This script sets up a Raspberry Pi for use as a PayTerm payment terminal.
# Run as root (sudo) on a fresh Raspberry Pi OS Lite installation.
#
# Usage: sudo ./install.sh
#

set -e

echo "=================================="
echo "  PayTerm Raspberry Pi Setup"
echo "=================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./install.sh)"
  exit 1
fi

# Get the user who will run the terminal
TERMINAL_USER=${SUDO_USER:-pi}
TERMINAL_HOME=$(getent passwd "$TERMINAL_USER" | cut -d: -f6)

echo "Setting up for user: $TERMINAL_USER"
echo "Home directory: $TERMINAL_HOME"

# Update system
echo "Updating system packages..."
apt-get update
apt-get upgrade -y

# Install dependencies
echo "Installing dependencies..."
apt-get install -y \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  chromium-browser \
  unclutter \
  nodejs \
  npm \
  git \
  libnfc-dev \
  libnfc-bin

# Install Node.js 20 (LTS)
echo "Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Create PayTerm directory
PAYTERM_DIR="$TERMINAL_HOME/payterm"
echo "Creating PayTerm directory at $PAYTERM_DIR..."
mkdir -p "$PAYTERM_DIR"

# Clone or update PayTerm
if [ -d "$PAYTERM_DIR/.git" ]; then
  echo "Updating PayTerm..."
  cd "$PAYTERM_DIR"
  git pull
else
  echo "Downloading PayTerm..."
  git clone https://github.com/jbx-protocol/juicy-vision.git "$PAYTERM_DIR"
fi

# Install npm dependencies
echo "Installing npm dependencies..."
cd "$PAYTERM_DIR/terminal"
npm install

# Build the terminal app
echo "Building PayTerm..."
npm run build:ui

# Set ownership
chown -R "$TERMINAL_USER:$TERMINAL_USER" "$PAYTERM_DIR"

# Create systemd service
echo "Creating systemd service..."
cat > /etc/systemd/system/payterm.service << EOF
[Unit]
Description=PayTerm Payment Terminal
After=graphical.target

[Service]
Type=simple
User=$TERMINAL_USER
WorkingDirectory=$PAYTERM_DIR/terminal
Environment=DISPLAY=:0
ExecStart=/usr/bin/npm start -- --kiosk
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
EOF

# Create X11 autostart
echo "Configuring X11 autostart..."
mkdir -p "$TERMINAL_HOME/.config/openbox"
cat > "$TERMINAL_HOME/.config/openbox/autostart" << EOF
# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Hide cursor after 5 seconds of inactivity
unclutter -idle 5 &

# Start PayTerm
systemctl --user start payterm
EOF

chown -R "$TERMINAL_USER:$TERMINAL_USER" "$TERMINAL_HOME/.config"

# Configure auto-login
echo "Configuring auto-login..."
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $TERMINAL_USER --noclear %I \$TERM
EOF

# Create .bash_profile to start X on login
cat > "$TERMINAL_HOME/.bash_profile" << EOF
if [ -z "\$DISPLAY" ] && [ "\$(tty)" = "/dev/tty1" ]; then
  startx
fi
EOF

chown "$TERMINAL_USER:$TERMINAL_USER" "$TERMINAL_HOME/.bash_profile"

# Configure NFC (if PN532 is connected)
echo "Configuring NFC..."
cat > /etc/nfc/libnfc.conf << EOF
# PayTerm NFC Configuration
allow_autoscan = true
allow_intrusive_scan = false

device.name = "PN532"
device.connstring = "pn532_i2c:/dev/i2c-1"
EOF

# Enable I2C for NFC
raspi-config nonint do_i2c 0

# Enable and start services
echo "Enabling services..."
systemctl daemon-reload
systemctl enable payterm

echo ""
echo "=================================="
echo "  Setup Complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Configure your terminal API key in the PayTerm app"
echo "2. Reboot to start the terminal: sudo reboot"
echo ""
echo "The terminal will auto-start on boot in kiosk mode."
echo ""
