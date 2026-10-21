# Deploying Tradelog to DigitalOcean

How it fits together:

```
push to main ──► CI (typecheck, unit tests, 29-check smoke test on Postgres, web build)
                   │ passes
                   ▼
                 Deploy: build API + web images ──► GitHub Container Registry (ghcr.io)
                   │
                   ▼  SSH as "deploy"
                 Droplet /opt/tradelog: pull images, migrate, restart, health check
                   │ fails? roll back to the previous version automatically
                   ▼
                 Caddy (HTTPS, auto certificates) ──► web (nginx) ──► api ──► Postgres
                                                                    worker ──► IBKR Flex
```

Secrets for the app (Google, IBKR, database) live only in `/opt/tradelog/.env` on the droplet. GitHub holds just the SSH key used to deploy.

All commands below run on your Mac unless marked **droplet**.

## 1. Put the code on GitHub

Create an **empty, private** repository (no README, .gitignore or license), then from the unzipped folder:

```
cd ~/repos/tradelog
git remote add origin git@github.com:santoshkrishna-cx/tradelog.git
git push -u origin main
```

The first push runs CI straight away. Deploy will fail until the steps below are done; that's expected.

## 2. Create the droplet

DigitalOcean > Create > Droplets:

- Image: **Ubuntu 24.04 LTS**
- Size: Basic, **2 GB RAM** (1 GB works but is tight with Postgres and two Node processes)
- Region: closest to you (for example SFO3)
- Authentication: your own SSH key (not a password)
- Turn on **Backups** (weekly droplet snapshots, on top of the nightly database dumps below)

Note the droplet's public IPv4 address. Below it's `203.0.113.10`; use yours.

## 3. Make a deploy key and prepare the droplet

```
ssh-keygen -t ed25519 -f ~/.ssh/tradelog_deploy -C github-actions-deploy -N ""
scp deploy/droplet-setup.sh root@203.0.113.10:
ssh root@203.0.113.10 "bash droplet-setup.sh '$(cat ~/.ssh/tradelog_deploy.pub)'"
```

The script updates Ubuntu, installs Docker, creates a `deploy` user that can only log in with that key, opens only ports 22, 80 and 443, turns on automatic security updates, and schedules a nightly database backup. At the end it prints the IP to lock the IBKR token to.

## 4. Point a domain at it

Add an **A record** for the name you'll use (for example `tradelog.yourdomain.com`) pointing to the droplet IP. Google sign-in needs HTTPS on a real hostname; Caddy gets the certificate automatically once DNS resolves.

## 5. Put the production settings on the droplet

```
cp deploy/.env.production.example .env.production
# edit .env.production: DOMAIN, APP_ORIGIN, GOOGLE_CALLBACK_URL, new POSTGRES_PASSWORD and SESSION_SECRET
# (openssl rand -base64 36), Google client ID and secret, IBKR Flex token and query IDs
scp .env.production deploy@203.0.113.10:/opt/tradelog/.env
ssh deploy@203.0.113.10 chmod 600 /opt/tradelog/.env
rm .env.production
```

## 6. Google sign-in for the live site

Google Cloud Console > APIs & Services > Credentials > your OAuth client:

- Authorized JavaScript origins: add `https://tradelog.yourdomain.com`
- Authorized redirect URIs: add `https://tradelog.yourdomain.com/auth/google/callback`

Keep the consent screen in **Testing** with only the two Gmail addresses as test users.

## 7. IBKR Flex token

Generate (or regenerate) the Flex Web Service token with **Valid For IP Address** = the droplet's public IPv4 printed in step 3. A droplet's outbound traffic comes from its own public IP, not from a reserved IP, unless you reconfigure its routing. Put the token in `/opt/tradelog/.env`.

## 8. Tell GitHub how to reach the droplet

Repository > Settings > Environments > **New environment** named `production`. Tick **Required reviewers** and add yourself if you want to approve each deploy.

Then add these under Settings > Secrets and variables > Actions. With the GitHub CLI (`brew install gh`, then `gh auth login`):

```
gh secret set DROPLET_HOST --body "203.0.113.10"
gh secret set DROPLET_USER --body "deploy"
gh secret set DROPLET_SSH_KEY < ~/.ssh/tradelog_deploy
ssh-keyscan -t ed25519 203.0.113.10 | gh secret set DROPLET_KNOWN_HOSTS
gh variable set TRADELOG_URL --body "https://tradelog.yourdomain.com"
```

| Name | Kind | Value |
| --- | --- | --- |
| `DROPLET_HOST` | secret | Droplet IP |
| `DROPLET_USER` | secret | `deploy` |
| `DROPLET_SSH_KEY` | secret | Contents of `~/.ssh/tradelog_deploy` (the private key) |
| `DROPLET_KNOWN_HOSTS` | secret | Output of `ssh-keyscan` above, so Actions only talks to your droplet |
| `TRADELOG_URL` | variable | `https://` address of the site, checked after every deploy |

## 9. Deploy

Actions tab > **Deploy** > Run workflow (or push any commit to `main`). The run:

1. builds the API and web images and pushes them to `ghcr.io/santoshkrishna-cx/tradelog-api` and `tradelog-web`, tagged with the commit;
2. copies the compose file, Caddyfile and deploy script to `/opt/tradelog`;
3. pulls the images, runs database migrations, restarts, and waits for `/api/health`;
4. if the new version doesn't come up, puts the previous version back and marks the run failed;
5. checks the live `https://` address.

Open the site and sign in with Gmail. From now on every push to `main` that passes CI goes live within a few minutes.

## Day to day

| Task | How |
| --- | --- |
| Roll back | Actions > Deploy > Run workflow, enter an older tag (the short commit hash shown in earlier runs) |
| See logs | `ssh deploy@203.0.113.10` then `cd /opt/tradelog && docker compose -f docker-compose.prod.yml logs -f api worker` |
| Change a setting or secret | Edit `/opt/tradelog/.env`, then `docker compose -f docker-compose.prod.yml up -d` |
| Backups | Nightly dumps in `/opt/tradelog/backups`, kept 14 days. Copy one off the droplet now and then: `scp deploy@203.0.113.10:/opt/tradelog/backups/tradelog-YYYY-MM-DD.dump .` |
| Restore a backup | `docker compose -f docker-compose.prod.yml exec -T db pg_restore -U tradelog -d tradelog --clean < backups/tradelog-YYYY-MM-DD.dump` |
| Flex token renewal | Regenerate in IBKR (same IP lock), update `FLEX_TOKEN` in `.env`, restart `worker` |
