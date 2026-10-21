#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 droplet. Run as root:
#   curl -fsSL <raw URL of this file> -o droplet-setup.sh   (or scp it up)
#   sudo bash droplet-setup.sh "ssh-ed25519 AAAA... github-actions-deploy"
# The argument is the PUBLIC half of the deploy key whose private half goes into the GitHub secret DROPLET_SSH_KEY.
set -euo pipefail
DEPLOY_KEY="${1:?Pass the deploy public key in quotes as the first argument}"

echo "== Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get upgrade -yq
apt-get install -yq ca-certificates curl ufw unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Installing Docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker

echo "== Creating the deploy user"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$DEPLOY_KEY" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$DEPLOY_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

echo "== App folder"
install -d -o deploy -g deploy /opt/logger /opt/logger/backups

echo "== Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== Nightly database backup at 02:30 server time, kept 14 days"
cat > /etc/cron.d/logger-backup <<'CRON'
30 2 * * * deploy cd /opt/logger && docker compose -f docker-compose.prod.yml --env-file .env exec -T db pg_dump -U logger -Fc logger > backups/logger-$(date +\%F).dump && find backups -name 'logger-*.dump' -mtime +14 -delete
CRON
chmod 644 /etc/cron.d/logger-backup

echo
echo "Done. Next:"
echo " 1. Put your .env in /opt/logger/.env (see deploy/.env.production.example), owned by deploy, mode 600."
echo " 2. Point your domain's A record at this droplet."
echo " 3. Lock the IBKR Flex token to this droplet's outbound IPv4: $(curl -4fsS https://icanhazip.com || echo 'run: curl -4 icanhazip.com')"
