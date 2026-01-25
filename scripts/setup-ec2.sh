#!/bin/bash
# One-time EC2 setup script for Big Daddy Sniper
# Run this once on a fresh EC2 instance

set -e

echo "=== Big Daddy Sniper EC2 Setup ==="

# Install git if not present
if ! command -v git &> /dev/null; then
    echo "Installing git..."
    if command -v yum &> /dev/null; then
        sudo yum install -y git
    elif command -v apt &> /dev/null; then
        sudo apt update && sudo apt install -y git
    fi
fi

# Install Bun
if [ ! -f ~/.bun/bin/bun ]; then
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Clone repo if not exists
if [ ! -d ~/big-daddy-sniper ]; then
    echo "Cloning repository..."
    git clone https://github.com/rchung29/big-daddy-sniper.git ~/big-daddy-sniper
fi

cd ~/big-daddy-sniper

# Install dependencies
echo "Installing dependencies..."
~/.bun/bin/bun install

# Create .env from example if it doesn't exist
if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    echo ""
    echo "=== IMPORTANT ==="
    echo "Edit .env with your credentials:"
    echo "  nano ~/big-daddy-sniper/.env"
    echo ""
fi

# Install systemd service
echo "Setting up systemd service..."
sudo cp scripts/big-daddy-sniper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable big-daddy-sniper

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit .env with your credentials: nano ~/big-daddy-sniper/.env"
echo "2. Start the service: sudo systemctl start big-daddy-sniper"
echo "3. Check status: sudo systemctl status big-daddy-sniper"
echo "4. View logs: sudo journalctl -u big-daddy-sniper -f"
