# Docker Deployment Guides

This folder contains Docker Compose files for the Healthcare Backend.

## Environments

- Production: `docker-compose.prod.yml`
- Local production-like: `docker-compose.local-prod.yml`
- Development: `docker-compose.dev.yml`

## Current Stack

- Infrastructure: `postgres`, `dragonfly`, `portainer`
- Application: `api`, `worker`
- Video: handled by the backend `video` service abstraction

## Common Commands

```bash
cd devops/docker
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.local-prod.yml --profile infrastructure --profile app up -d --build
docker compose -f docker-compose.dev.yml up -d --build
```

## Checks

- `docker compose -f docker-compose.prod.yml ps`
- `curl http://localhost:8088/health`
- `docker compose -f docker-compose.prod.yml logs -f api`
- `docker compose -f docker-compose.prod.yml logs -f worker`

## Notes

- Video provider selection happens in the backend.
