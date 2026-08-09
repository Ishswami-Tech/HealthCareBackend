# Architecture & Deployment: Source of Truth

This document describes the production traffic path for the Healthcare Backend.
It separates public ingress, internal routing, and deploy-time health checks so
we can keep `/health` stable for the app while using a lightweight endpoint for
infra checks.

## Summary

- **Coolify** owns public HTTPS termination and domain ingress.
- **Internal Nginx** owns blue-green switching between `latest-api` and
  `latest-api-next`.
- **GitHub Actions** owns image build, deploy orchestration, and health gating.
- **`/health`** remains the public application readiness contract.
- **`/infra-health`** is the deploy-time liveness check used by Coolify and CI.

## Public Request Flow

1. User requests `https://backend-service-v1.ishswami.in`.
2. Coolify Traefik receives the request on ports `80` and `443` and terminates
   TLS.
3. Traefik forwards the request to the internal `latest-nginx` router on port
   `8088`.
4. Internal Nginx reads `upstream.conf`.
5. Nginx forwards traffic to the active API container.

## Blue-Green Switch

- GitHub Actions starts `latest-api-next` alongside `latest-api`.
- The new container is checked with `/infra-health`.
- When healthy, the pipeline rewrites `upstream.conf` and reloads Nginx.
- Existing requests continue on the old container until they drain.
- New requests flow to the new container without dropping connections.

## Endpoint Contract

- `GET /health` stays unchanged for the application contract.
- `GET /infra-health` returns a lightweight 200 OK for deploy gating.
- `/infra-health` must not depend on database, cache, queue, or external
  services.

## Why this layout

This split avoids coupling deploy success to the slower readiness path used by
clients and monitoring. The public app contract stays stable while the
infrastructure check stays fast and predictable.
