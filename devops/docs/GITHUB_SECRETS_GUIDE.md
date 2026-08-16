# GitHub Secrets and Variables — Multi-Environment Setup

This reference lists every secret and variable you must configure in GitHub for
the multi-environment CI/CD pipeline.

## GitHub Environments

Create two environments under **Settings → Environments** in your GitHub repo:

- `production` — used when deploying from the `main` branch
- `preprod` — used when deploying from the `preprod` branch

Branch protection rules for `main` should require the PR author to be the
`preprod` branch and require the `validate-pr` CI check to pass.

## Required Secrets

Secrets are scoped per environment. Add them under the environment's **Secrets**
tab, not the repository-level **Secrets and variables → Actions** tab.

| Secret name                | Environment(s)          | Purpose                                                                         |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `SSH_PRIVATE_KEY`          | `production`, `preprod` | SSH private key for the deploy user on the VPS (RSA or Ed25519, no passphrase). |
| `SERVER_HOST`              | `production`, `preprod` | VPS public IPv4 or hostname (e.g., `123.45.67.89`).                             |
| `SERVER_USER`              | `production`, `preprod` | SSH user that can run `docker` commands on the VPS (e.g., `root` or `ubuntu`).  |
| `SERVER_DEPLOY_PATH`       | `production`            | Root path for production: `/opt/healthcare-backend`                             |
| `SERVER_DEPLOY_PATH`       | `preprod`               | Root path for preprod: `/opt/healthcare-preprod`                                |
| `DATABASE_URL`             | `production`            | PostgreSQL DSN for production DB (`userdb`).                                    |
| `DATABASE_URL`             | `preprod`               | PostgreSQL DSN for preprod DB (`userdb_preprod`).                               |
| `POSTGRES_PASSWORD`        | `production`, `preprod` | PostgreSQL password for the environment's DB user.                              |
| `POSTGRES_USER`            | `production`, `preprod` | PostgreSQL user (usually `postgres`).                                           |
| `S3_ACCESS_KEY_ID`         | `production`, `preprod` | Contabo S3 access key (optional — only if S3 backups are enabled).              |
| `S3_SECRET_ACCESS_KEY`     | `production`, `preprod` | Contabo S3 secret (optional).                                                   |
| `S3_BUCKET`                | `production`, `preprod` | Contabo S3 bucket name (optional).                                              |
| `S3_ENDPOINT`              | `production`, `preprod` | Contabo S3 endpoint URL (optional).                                             |
| `S3_REGION`                | `production`, `preprod` | S3 region (default `eu-central-1`).                                             |
| `S3_ENABLED`               | `production`, `preprod` | Set to `"true"` to enable S3 backups, else `"false"`.                           |
| `S3_FORCE_PATH_STYLE`      | `production`, `preprod` | Set to `"true"` for Contabo S3.                                                 |
| `BULL_BOARD_URL`           | `production`, `preprod` | Bull Board path (e.g., `/queue-dashboard`).                                     |
| `QUEUE_DASHBOARD_USER`     | `production`, `preprod` | Bull Board auth user.                                                           |
| `QUEUE_DASHBOARD_PASSWORD` | `production`, `preprod` | Bull Board auth password.                                                       |
| `JWT_SECRET`               | `production`, `preprod` | JWT signing secret (per-env).                                                   |
| `ALLOWED_ORIGINS`          | `production`, `preprod` | CORS origins for the environment.                                               |
| `PORTAINER_API_TOKEN`      | `production`, `preprod` | Portainer API JWT (optional — Portainer sync is non-blocking).                  |

> All secret values are masked in workflow logs. Never write secrets to
> `GITHUB_STEP_SUMMARY`.

## Required Variables

Variables are defined per environment under the environment's **Variables** tab.

| Variable name           | Environment(s)          | Default                          | Purpose                                                  |
| ----------------------- | ----------------------- | -------------------------------- | -------------------------------------------------------- |
| `NGINX_PORT`            | `production`            | `8088`                           | Internal port the production Nginx container listens on. |
| `NGINX_PORT`            | `preprod`               | `8090`                           | Internal port the preprod Nginx container listens on.    |
| `API_PORT`              | `production`, `preprod` | `8088`                           | Internal port the API container exposes.                 |
| `WORKER_PORT`           | `production`, `preprod` | `8080`                           | Internal port the worker container exposes.              |
| `API_SUBDOMAIN`         | `production`            | `backend-service-v1.ishswami.in` | Subdomain routed by Traefik to production Nginx.         |
| `API_SUBDOMAIN`         | `preprod`               | `preprod-backend.ishswami.in`    | Subdomain routed by Traefik to preprod Nginx.            |
| `CONTAINER_PREFIX`      | `production`            | `latest-`                        | Container name prefix for production services.           |
| `CONTAINER_PREFIX`      | `preprod`               | `preprod-`                       | Container name prefix for preprod services.              |
| `DOCKER_NETWORK`        | `production`            | `app-network`                    | Docker network for production.                           |
| `DOCKER_NETWORK`        | `preprod`               | `preprod-network`                | Docker network for preprod.                              |
| `COMPOSE_FILE`          | `production`            | `docker-compose.prod.yml`        | Compose file name for production.                        |
| `COMPOSE_FILE`          | `preprod`               | `docker-compose.preprod.yml`     | Compose file name for preprod.                           |
| `ENV_FILE`              | `production`            | `.env.production`                | Env file name for production.                            |
| `ENV_FILE`              | `preprod`               | `.env.preprod`                   | Env file name for preprod.                               |
| `PORTAINER_URL`         | `production`, `preprod` | `https://portainer.ishswami.in`  | Portainer CE base URL.                                   |
| `PORTAINER_ENDPOINT_ID` | `production`            | (set after Portainer setup)      | Portainer environment ID for production.                 |
| `PORTAINER_ENDPOINT_ID` | `preprod`               | (set after Portainer setup)      | Portainer environment ID for preprod.                    |
| `PORTAINER_STACK_ID`    | `production`            | (set after Portainer setup)      | Portainer stack ID for production.                       |
| `PORTAINER_STACK_ID`    | `preprod`               | (set after Portainer setup)      | Portainer stack ID for preprod.                          |

## Branch Protection Rules

For `main`:

- **Require a pull request before merging** — yes
- **Require approvals** — at least 1
- **Require status checks to pass before merging** — add `validate-pr`
- **Restrict who can push** — only maintainers/admins
- **Require conversation resolution before merging** — yes

For `preprod`:

- **Require a pull request before merging** — yes
- **Require status checks to pass before merging** — add `validate-pr`

## Secrets Validation in CI

The pipeline job validates all required secrets and variables are non-empty
before deploying. If any are missing, the job fails with an explicit list of
missing names (Requirements 6.5, 6.6).

## Concurrency Groups

The workflow uses concurrency groups automatically:

- Production deploys → group `deploy-production`
- Preprod deploys → group `deploy-preprod`

These are defined inside `ci.yml` and do not require extra GitHub configuration.
