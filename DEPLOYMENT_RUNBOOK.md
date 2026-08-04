# Deployment Runbook

Operational manual for the healthcare-backend multi-environment CI/CD pipeline.
Target audience: on-call engineers and release managers.

> **Companion docs:** `deploy/README.md` (deployment guide), `.kiro/specs/multi-environment-cicd-pipeline/design.mdc` (architecture), `deploy/RUNBOOK.md` if present (per-environment details).

---

## 1. Environments

| Env         | Branch                  | Host                         | Container prefix | Env file             | URL                                          |
|-------------|-------------------------|------------------------------|------------------|----------------------|----------------------------------------------|
| preprod     | `preprod` (deploy key)  | preprod-VPS (Contabo)        | `preprod-`       | `.env.preprod`       | `https://backend-service-preprod.ishswami.in`|
| production  | `main` (deploy key)     | prod-VPS (Contabo)           | `latest-`        | `.env.production`    | `https://backend-service-v1.ishswami.in`     |

Both VPS hosts run:

- Docker Engine 24+
- Traefik reverse proxy (`coolify` external network)
- `deploy/` checkout of this repo at `/opt/healthcare-backend`
- Healthcheck endpoint exposed at `GET /infra-health` → `200 OK` with JSON status

---

## 2. End-to-end deployment flow

### 2.1 CI pipeline (GitHub Actions)

Runs automatically on every push to `preprod` and `main`, and on PRs targeting those branches.

```
PR / push
  └─ detect-changes   ──── skip CI if no backend changes
  └─ pr-validation    ─── lint + typecheck + test (PRs only)
  └─ security-scan    ─── npm audit + secret scan
  └─ docker-build    ─── multi-arch image → ghcr.io cache
  └─ validate-infra   ─── compose config + env file present (no deploy)
  └─ deploy-preprod   ─── (push to preprod)
  └─ deploy-prod      ─── (push to main, gated by env approval)
  └─ post-verify      ─── smoke tests against public URL
  └─ portainer-sync   ─── (optional, runs in parallel with deploy)
```

### 2.2 Blue-green deployment (target host)

Per-target execute job, behind a deployment lock:

1. **Acquire lock** (`/var/lock/healthcare-deployment.lock`, 5 min timeout).
2. **Validate** — `validate-secrets.sh`, `validate-disk-space.sh` (≥ 10 GB free).
3. **Pre-backup** — `backup-infra.sh` (PostgreSQL + DragonflyDB + env) → `/opt/healthcare-backend/backups`.
4. **Pull image** — `docker compose pull` against `${DOCKER_IMAGE}`.
5. **Start idle (green)** — launch new containers with `latest-` / `preprod-` prefix, `--no-deps` for the API.
6. **Health checks** — wait up to 120 s for `infra-health`, `200 OK` from new API container.
7. **Nginx switch** — rewrite `nginx/upstream.conf` to point at the new API, `nginx -s reload` (≈ 0 ms downtime).
8. **Post-verify** — `health-check.sh` runs `/infra-health`, `/ready`, `/live` against the public URL.
9. **Stop idle (blue)** — `docker compose stop` the old containers; keep images for 1 hour for rollback.
10. **Release lock**, emit deployment summary.

A failed step at any point → automatic rollback (see §3).

### 2.3 Concurrency control

- **Per-environment lock file** on the VPS (`/var/lock/healthcare-deployment.lock`).
- **GitHub Actions `concurrency` block** ensures only one deployment per branch runs at a time:
  ```yaml
  concurrency:
    group: deploy-${{ inputs.environment }}
    cancel-in-progress: false
  ```
- New pushes **queue, never cancel** an in-flight deployment (`cancel-in-progress: false`).
- Maximum queue depth: 3 (failures surfaced via `DEPLOY_TIMEOUT` env).

---

## 3. Rollback procedures

### 3.1 Automatic rollback (deployment failed)

Triggered by the GitHub Actions `deploy-*` job when any of the post-verify checks fail. The `rollback` step:

1. Re-renders `nginx/upstream.conf` with previous-image tag (stored as `$PREVIOUS_IMAGE_TAG`).
2. `docker compose up -d` old image.
3. `nginx -s reload`.
4. Leaves the failed image on the host for forensic inspection (cleanup job runs hourly).

### 3.2 Manual rollback (production issue caught post-deploy)

Use when a problem surfaces after the deploy job has completed:

```bash
# On the target VPS as deployer / via SSH
sudo /opt/healthcare-backend/devops/scripts/blue-green-deploy.sh rollback \
    --env production \
    --to-image ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:<previous-sha>
```

Where `<previous-sha>` is the last known-good image (find with `docker image ls --format '{{.Tag}}'`).

### 3.3 Database rollback (point-in-time)

For Postgres restores, **never** rely on filesystem snapshots during an active incident:

```bash
sudo /opt/healthcare-backend/devops/scripts/backup-infra.sh restore postgres \
    --backup-id pre-deployment-20260804-153022 \
    --target latest-postgres \
    --pitr-window 5m
```

This writes a `pitr-restore-<ts>.log` to `/var/log/deployments/` and posts to Slack `#healthcare-deploys`.

---

## 4. Promoting preprod → production

Two paths are supported:

### 4.1 Hotfix / manual promotion

```bash
# Locally, with the deploy key configured in env
git checkout main
git pull --ff-only origin main
gh workflow run ci.yml \
    --ref main \
    -f environment=production \
    -f image_tag=<sha>
```

This bypasses the `preprod` branch step (skip-build: true). Production environment in GitHub **requires manual approval** by a release manager (configured under Settings → Environments).

### 4.2 Standard promotion (via `preprod`)

```
preprod (green + verified) ── git push origin preprod ──► CI runs deploy-preprod ──► smoke tests pass
                                                                                        │
                                          gh workflow run ci.yml --ref main               │
                                                       │                                  ▼
                                                       └──────────► CI runs deploy-prod ──► production
```

The two deployments are **independent jobs**; preprod failures do **not** block a manual `main` deployment.

---

## 5. Portainer access

The optional `portainer-sync` workflow keeps Portainer stacks in sync with the on-host Docker Compose deployment.

| Item       | Value                                                                 |
|------------|-----------------------------------------------------------------------|
| URL        | `https://portainer.<your-domain>` (configured via `PORTAINER_URL`)    |
| Auth       | API key in env secret `PORTAINER_API_KEY`                             |
| Stack name | `healthcare-backend-<env>` (`production` ⇒ `healthcare-backend-production`) |
| Sync mode  | **Pull-and-compare** — Portainer only re-deploys if its view diverges from `docker compose ps` |
| Manual sync | `gh workflow run ci.yml --ref <branch> -f job=portainer-sync -f environment=production` |

**Never** click "Update stack" in the Portainer UI during a CI-driven deploy — this races the lock and breaks blue-green semantics.

---

## 6. Health & observability

| Endpoint          | Purpose                | Expected response                            |
|-------------------|------------------------|----------------------------------------------|
| `GET /infra-health` | Deployment gate       | `200 {"status":"ok","services":{...}}`       |
| `GET /health`     | Liveness probe         | `200 "OK"`                                   |
| `GET /ready`      | Readiness probe        | `200 "ready"`                                |
| `GET /live`       | Process alive          | `200`                                        |
| `GET /metrics`    | Prometheus             | text/plain (port 9000 internal)              |

Logs live in `/opt/healthcare-backend/logs/` (bind-mounted into the `api` container). The deployment logger writes to `/var/log/deployments/deploy-<ts>.log`.

---

## 7. Troubleshooting

| Symptom                                                | First action                                                                                                           |
|--------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Deploy job stuck on "Acquire lock"                     | `ssh <host> 'sudo lsof /var/lock/healthcare-deployment.lock'` — kill stale PID if older than 30 min                    |
| `infra-health` returns 503                             | `docker compose ps` — check if `latest-api` is `Up (unhealthy)`; inspect with `docker logs latest-api --tail 200`        |
| Nginx still routing to old API after deploy            | `ssh <host> 'sudo nginx -T \| grep upstream'`; reload manually with `docker exec latest-nginx nginx -s reload`         |
| GitHub Actions secret missing                          | Settings → Environments → production → Secrets — re-add; never paste secrets in workflow logs                          |
| `validate-secrets.sh` fails on first deploy            | Confirm `.env.production` / `.env.preprod` has `chmod 600` and is owned by `deployer:deployer`                          |
| `docker compose pull` rate-limited                     | Re-login: `echo $GHCR_TOKEN \| docker login ghcr.io -u <user> --password-stdin`                                         |
| Postgres container OOM                                 | Reduce `shared_buffers` (4 GB → 2 GB) or upgrade VPS; the `validate-disk-space.sh` step alone won't catch RAM pressure |
| Traefik returning 502 for backend-service-v1           | Check that the `coolify` network exists: `docker network inspect coolify`; restart nginx container                      |
| Rollback image not present                             | Pre-1h-old images are kept; older ones are GC'd. Re-run `gh workflow run ci.yml --ref <branch> -f job=build` first    |

---

## 8. On-call escalation

1. **P0/P1** (prod outage, data risk): page on-call SRE → `#healthcare-incidents`.
2. **P2** (deploy failed, no impact): open `#healthcare-deploys` thread with the failed run URL.
3. **Always** attach: `docker compose ps`, last 200 lines of `latest-api`, `/infra-health` output.

---

## 9. Quick reference — useful one-liners

```bash
# Tail all running containers
ssh <host> 'sudo docker compose -f /opt/healthcare-backend/devops/docker/docker-compose.prod.yml logs -f --tail 50'

# Force a re-run of post-verify (no redeploy)
gh workflow run ci.yml --ref main -f job=post-verify -f environment=production

# Check lock holder
ssh <host> 'sudo cat /var/lock/healthcare-deployment.lock 2>/dev/null || echo "no lock"'

# List images retained for rollback
ssh <host> 'sudo docker images --filter "reference=ghcr.io/ishswami-tech/*" --format "{{.Repository}}:{{.Tag}} {{.CreatedAt}}"'
```
