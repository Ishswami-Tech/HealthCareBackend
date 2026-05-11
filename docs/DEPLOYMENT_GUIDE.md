# Deployment Guide

This guide covers the current Docker-based deployment for the Healthcare
Backend.

## Current Runtime

- App services: `api`, `worker`
- Infrastructure: `postgres`, `dragonfly`, `portainer`
- Video: backend `video` service abstraction with provider fallback

## Deployment Entry Points

- `devops/docker/docker-compose.prod.yml`
- `devops/scripts/docker-infra/deploy.sh`
- `devops/nginx/sites-available/video.ishswami.in`

## Useful Checks

```bash
docker compose -f devops/docker/docker-compose.prod.yml ps
docker compose -f devops/docker/docker-compose.prod.yml logs -f api
curl http://127.0.0.1:8088/health
```

## Notes

- The backend `video` service decides which provider to use.
