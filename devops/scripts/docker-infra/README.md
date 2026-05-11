# Docker Infrastructure Scripts - Complete Guide

## Overview

Production-ready CI/CD deployment automation for the Healthcare Backend. The
active stack uses 5 containers total:

- Infrastructure: `postgres`, `dragonfly`, `portainer`
- Application: `api`, `worker`

The scripts in this folder handle health checks, backups, deployment,
verification, rollback, diagnostics, and directory preparation.

---

## System Architecture

### Container Layout

```text
Production Server

Infrastructure Containers
- PostgreSQL   :5432
- Dragonfly    :6379
- Portainer    :9000

Application Containers
- API          :8088
- Worker       :BullMQ

Docker Network: app-network (172.18.0.0/16)
```

### Storage Layout

```text
Local backups:
/opt/healthcare-backend/backups/

  postgres/
    hourly/
    daily/
    weekly/
    pre-deployment/
    success/
    pre-migration/

  dragonfly/
  metadata/

Remote mirror:
Contabo S3 bucket for daily, weekly, pre-deployment, and success backups
```

### CI/CD Pipeline

```text
1. detect-changes
2. security
3. docker-build
4. check-infrastructure
5. backup-infrastructure
6. debug-infrastructure
7. recreate-infrastructure
8. restore-backup
9. verify-infrastructure
10. deploy
```

---

## Complete Deployment Flow

### Main Deployment Process

1. Push to the main branch.
2. Detect infra or app changes.
3. Run security checks and build images.
4. Check infrastructure health.
5. Back up healthy infrastructure before deployment.
6. Recreate unhealthy infrastructure if needed.
7. Restore data if a container had to be rebuilt.
8. Deploy the `api` and `worker` containers.
9. Wait for health checks.
10. Create a success backup after a successful deploy.
11. Release the deployment lock.

### Backup Flow

1. Choose backup type: hourly, daily, weekly, pre-deployment, or success.
2. Check disk space.
3. Back up PostgreSQL and Dragonfly data.
4. Write metadata and checksum files.
5. Upload to S3 when enabled.
6. Apply retention rules.

---

## Scripts Reference

### Core Scripts

| Script                     | Purpose                            | Usage                        |
| -------------------------- | ---------------------------------- | ---------------------------- | ----------- | ----------- | -------------- | --------- |
| `deploy.sh`                | Main deployment orchestrator       | `./deploy.sh [verify-image   | check-image | post-verify | help]`         |
| `health-check.sh`          | Infrastructure health monitoring   | `./health-check.sh`          |
| `backup.sh`                | Backup management                  | `./backup.sh [hourly         | daily       | weekly      | pre-deployment | success]` |
| `restore.sh`               | Restore from backups               | `./restore.sh <backup-id>`   |
| `verify.sh`                | Deployment and image verification  | `./verify.sh [deployment     | image       | fix-image   | status         | backup]`  |
| `diagnose.sh`              | Diagnostic and troubleshooting     | `./diagnose.sh`              |
| `setup-directories.sh`     | Prepare required directories       | `./setup-directories.sh`     |
| `fix-database-password.sh` | Verify and fix password mismatches | `./fix-database-password.sh` |
| `fix-missing-files.sh`     | Restore missing critical files     | `./fix-missing-files.sh`     |
| `clean-and-rebuild.sh`     | Clean containers and rebuild       | `./clean-and-rebuild.sh`     |

---

## Health Checks

Expected output:

- PostgreSQL - healthy
- Dragonfly - healthy
- Portainer - healthy

---

## Deployment Checks

The deployment flow validates:

1. Infrastructure health.
2. Image availability.
3. Environment variables.
4. Database migrations.
5. API and worker container startup.
6. Post-deploy health and rollback safety.

---

## Edge Cases Handled

### Infrastructure

1. Disk space exhaustion
2. S3 upload failure
3. Partial backup failure
4. Concurrent deployments
5. Backup corruption
6. Database migration failure
7. Container resource exhaustion
8. Network partition
9. Zombie containers
10. Disaster recovery
11. Portainer health
12. Container dependencies
13. Deployment rollback
14. Backup retention

### API / Worker

15. Prisma client missing
16. Connection pool exhaustion
17. Worker queue backlog
18. Memory leaks
19. Graceful shutdown

---

## Implementation Status

All Docker infrastructure management features are implemented for the current
stack:

- Docker Compose profiles for infrastructure and app services
- Automated health checks
- Local and remote backups
- Safe deployment and rollback
- Diagnostic and repair scripts
- Directory bootstrap and password verification helpers

---

## Notes

- Video handling is now routed through the backend `video` service abstraction.
