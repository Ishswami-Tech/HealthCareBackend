# Coolify Migration Guide

This guide describes the final production layout for the Healthcare Backend. It
is not a recipe for moving application deploys into Coolify. Coolify handles
public ingress and SSL, while GitHub Actions handles the blue-green rollout.

## Current Responsibility Split

- **Coolify**: public HTTPS termination and routing to the internal Nginx
  router.
- **GitHub Actions**: build, deploy, health-gate, and switch traffic.
- **Application containers**: run inside Docker and are only reachable through
  Nginx.

## Important Rules

- Do not deploy the API or Worker directly from the Coolify UI.
- Keep host-level Nginx only if it is not competing for ports `80` and `443`.
- Use `GET /infra-health` for deploy-time checks.
- Keep `GET /health` unchanged for the app and frontend consumers.

## Deploy Flow

1. GitHub Actions builds and publishes the new image.
2. The pipeline starts `latest-api-next` beside the current API container.
3. The new container must pass `/infra-health`.
4. GitHub Actions rewrites `upstream.conf` to point at the green container.
5. Nginx reloads and starts sending new requests to the new container.
6. The old container drains and is removed after the switch.

## Quick Reference

| Resource       | Managed By     | Location / Port |
| -------------- | -------------- | --------------- |
| Traefik / SSL  | Coolify        | Ports 80 / 443  |
| Internal Nginx | GitHub Actions | Port 8088       |
| API            | GitHub Actions | Internal only   |
| Worker         | GitHub Actions | Internal only   |
