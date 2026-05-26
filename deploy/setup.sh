#!/usr/bin/env bash
# VPS setup script for NodeBB + Redis (1 GB, no Docker)
# Run as root on a fresh Debian/Ubuntu server.
set -euo pipefail

NODEBB_DIR=/opt/nodebb
NODEBB_USER=www-data
DOMAIN=${1:-"your-domain.com"}

echo "==> Configuring swap (1 GB)"
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
sysctl -p /etc/sysctl.d/99-swap.conf

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y -qq git nginx redis-server certbot python3-certbot-nginx

echo "==> Configuring Redis"
cp "$(dirname "$0")/redis.conf" /etc/redis/redis.conf
systemctl enable redis-server
systemctl restart redis-server

echo "==> Installing Node.js 20 via nvm"
export NVM_DIR="/root/.nvm"
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# shellcheck disable=SC1090
source "$NVM_DIR/nvm.sh"
nvm install 20
nvm alias default 20
NODE_BIN=$(nvm which 20)

echo "==> Cloning NodeBB"
git clone --depth 1 --branch master "$(git -C "$(dirname "$0")/.." remote get-url origin)" "$NODEBB_DIR" || true
cd "$NODEBB_DIR"
npm install --omit=dev

echo "==> Installing plugin"
ln -sf "$NODEBB_DIR/plugins/nodebb-plugin-bot-platform" "$NODEBB_DIR/node_modules/nodebb-plugin-bot-platform"
cd "$NODEBB_DIR/node_modules/nodebb-plugin-bot-platform"
npm install --omit=dev

echo "==> Setting ownership"
chown -R "$NODEBB_USER":"$NODEBB_USER" "$NODEBB_DIR"

echo "==> Installing systemd service"
sed "s|/usr/bin/node|$NODE_BIN|g" "$(dirname "$0")/nodebb.service" > /etc/systemd/system/nodebb.service
systemctl daemon-reload
systemctl enable nodebb

echo "==> Configuring Nginx"
sed "s/your-domain.com/$DOMAIN/g" "$(dirname "$0")/nginx.conf" > /etc/nginx/sites-available/nodebb
ln -sf /etc/nginx/sites-available/nodebb /etc/nginx/sites-enabled/nodebb
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "==> Done. Next steps:"
echo "  1. Run: cd $NODEBB_DIR && sudo -u $NODEBB_USER ./nodebb setup"
echo "     (choose Redis, host=127.0.0.1, port=6379)"
echo "  2. Obtain SSL: certbot --nginx -d $DOMAIN"
echo "  3. Start NodeBB: systemctl start nodebb"
echo "  4. Activate plugin in NodeBB Admin → Extend → Plugins"
