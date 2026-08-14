# Architecture & Deployment: Source of Truth

This document describes the production traffic path for the Healthcare Backend.
It separates public ingress, internal routing, and deploy-time health checks so
we can keep `/health` stable for the app while using a lightweight endpoint for
infra checks.

## Summary

- **Coolify** owns public HTTPS termination, domain ingress, and container
  management.
- **Traefik** (inside Coolify) routes traffic by Host header to the correct
  nginx.
- **GitHub Actions** owns image build and triggers deploy via Coolify API.
- **`/health`** remains the public application readiness contract.
- **`/infra-health`** is the deploy-time liveness check used by CI.

---

## Overall Architecture

```
                        INTERNET
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                    DNS (Cloudflare)                       │
│  backend-service-v1.ishswami.in  →  Server IP             │
│  preprod-backend.ishswami.in    →  Server IP             │
│  coolify.ishswami.in            →  Server IP             │
└───────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│              Contabo VPS                                  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Traefik (Coolify)                                  │  │
│  │  Port 80/443                                        │  │
│  │  Auto SSL via Let's Encrypt                         │  │
│  │                                                     │  │
│  │  Routes by Host header:                             │  │
│  │  backend-service-v1.ishswami.in → latest-nginx:8088 │  │
│  │  preprod-backend.ishswami.in   → preprod-nginx:8090 │  │
│  │  coolify.ishswami.in           → coolify:8000       │  │
│  └─────────────────────────────────────────────────────┘  │
│                           │                               │
│         ┌─────────────────┼─────────────────┐             │
│         ▼                 ▼                 ▼             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ coolify     │  │ latest-nginx│  │preprod-nginx│       │
│  │ :8000       │  │ :8088       │  │ :8090       │       │
│  │(dashboard)  │  │(prod gateway)│ │(preprod gw) │       │
│  └─────────────┘  └──────┬──────┘  └──────┬──────┘       │
│                          │                 │               │
│          ┌───────────────┼────────┐        │               │
│          ▼               ▼        ▼        ▼               │
│   ┌──────────┐   ┌──────────┐  ┌──────────┐              │
│   │latest-api│   │latest-   │  │preprod-  │              │
│   │  :8088   │   │worker    │  │api       │              │
│   │(prod API)│   │:8089     │  │:8088     │              │
│   │          │   │(prod     │  │(preprod  │              │
│   │          │   │queue)    │  │API)      │              │
│   └────┬─────┘   └────┬─────┘  └────┬─────┘              │
│        │              │             │                     │
│        │    ┌─────────┼─────────┐   │                     │
│        │    ▼         ▼         ▼   ▼                     │
│        │  ┌──────┐ ┌──────┐ ┌──────────┐                  │
│        │  │preprod│ │preprod│ │ preprod  │                  │
│        │  │worker │ │ (queue│ │worker    │                  │
│        │  │:9091  │ │ dash) │ │:8088     │                  │
│        │  └───────┘ └──────┘ └──────────┘                  │
│        │                                                  │
│  ──────┼──────────────────────────────────────             │
│   SHARED INFRASTRUCTURE (never redeployed)                 │
│  ──────┼──────────────────────────────────────             │
│        │                                                  │
│   ┌────┴──────────┐  ┌──────────────────┐                 │
│   │  postgres     │  │  dragonfly       │                 │
│   │  :5432        │  │  :6379           │                 │
│   │               │  │                  │                 │
│   │  userdb       │  │  healthcare:*    │ ← production    │
│   │  (prod data)  │  │  (prod cache)    │                 │
│   │               │  │                  │                 │
│   │  userdb_      │  │  healthcare-     │ ← preprod       │
│   │  preprod      │  │  preprod:*       │                 │
│   │  (preprod     │  │  (preprod cache) │                 │
│   │   data)       │  │                  │                 │
│   └──────────────┘  └──────────────────┘                 │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## Networks

Production containers connect via the `coolify` Docker network
(Coolify-managed). Preprod containers use a separate `preprod-network`
(172.19.0.0/16). Postgres and Dragonfly are connected to **both** networks —
they serve both environments without duplication.

```
  ┌──────────────────┐         ┌──────────────────┐
  │   coolify        │         │  preprod-network │
  │   (Coolify's     │         │  172.19.0.0/16   │
  │   own network)   │         │                  │
  │                  │         │  preprod-nginx   │
  │  latest-nginx    │         │  preprod-api     │
  │  latest-api      │         │  preprod-worker  │
  │  latest-worker   │         │                  │
  │  postgres ◄──────┼─────────│── connected      │
  │  dragonfly ◄─────┼─────────│── to both        │
  │  coolify         │         │                  │
  │  traefik         │         │                  │
  └──────────────────┘         └──────────────────┘
```

## Data Isolation

All data lives in the same physical containers. Separation is at the database
and cache key level:

|              | Production    | Preprod               |
| ------------ | ------------- | --------------------- |
| Database     | `userdb`      | `userdb_preprod`      |
| Cache prefix | `healthcare:` | `healthcare-preprod:` |

## Deploy Flow

```
  ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
  │  GitHub     │────▶│  CI (Actions)│────▶│   Coolify   │
  │  Push       │     │              │     │   API       │
  │             │     │ 1. Build     │     │             │
  │ main        │     │    image     │     │ Pull image  │
  │ preprod     │     │ 2. Push to   │     │ Redeploy    │
  │             │     │    GHCR      │     │ containers  │
  └─────────────┘     │ 3. Call      │     └─────────────┘
                      │    Coolify   │             │
                      │    API       │             ▼
                      │              │     ┌─────────────┐
                      └──────────────┘     │  Traefik    │
                                            │  routes to  │
                                            │  new        │
                                            │  containers │
                                            └─────────────┘
```

- `main` branch → production deploy (`latest-api`, `latest-worker`)
- `preprod` branch → preprod deploy (`preprod-api`, `preprod-worker`)

## What Coolify Manages

| Managed by Coolify                               | Not managed by Coolify |
| ------------------------------------------------ | ---------------------- |
| `latest-nginx`, `latest-api`, `latest-worker`    | `postgres`             |
| `preprod-nginx`, `preprod-api`, `preprod-worker` | `dragonfly`            |
| `traefik` (SSL + routing)                        |                        |
| `coolify` (dashboard)                            |                        |

Postgres and Dragonfly stay as standalone containers. They are not recreated or
managed by Coolify. They are only connected to additional networks as needed.

## Environment Comparison

|                  | Production                       | Preprod                       |
| ---------------- | -------------------------------- | ----------------------------- |
| Branch           | `main`                           | `preprod`                     |
| Container prefix | `latest-`                        | `preprod-`                    |
| Database         | `userdb`                         | `userdb_preprod`              |
| Cache prefix     | `healthcare:`                    | `healthcare-preprod:`         |
| Network          | `coolify`                        | `preprod-network`             |
| Domain           | `backend-service-v1.ishswami.in` | `preprod-backend.ishswami.in` |
| Approval gate    | Required                         | None (auto-deploy)            |
| Deploy trigger   | Push to main                     | Push to preprod               |

## URLs

|                   | URL                                                      |
| ----------------- | -------------------------------------------------------- |
| Production API    | `https://backend-service-v1.ishswami.in`                 |
| Production Queue  | `https://backend-service-v1.ishswami.in/queue-dashboard` |
| Preprod API       | `https://preprod-backend.ishswami.in`                    |
| Preprod Queue     | `https://preprod-backend.ishswami.in/queue-dashboard`    |
| Coolify Dashboard | `http://SERVER_IP:8000`                                  |

## Public Request Flow

1. User requests `https://backend-service-v1.ishswami.in`
2. Coolify Traefik receives on ports 80/443 and terminates TLS
3. Traefik forwards to `latest-nginx:8088`
4. Nginx forwards to active API container

### Preprod Request Flow

Same as above, but:

1. User requests `https://preprod-backend.ishswami.in`
2. Traefik routes to `preprod-nginx:8090`
3. Nginx forwards to active preprod API container

## Endpoint Contract

- `GET /health` — public application readiness (stable)
- `GET /infra-health` — lightweight deploy-time liveness check (fast, no
  DB/cache dependency)
