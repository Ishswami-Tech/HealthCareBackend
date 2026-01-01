# DevOps Scripts Directory

This directory contains organized scripts for development, Docker production, Kubernetes production, and shared utilities.

## Directory Structure

```
devops/scripts/
├── shared/              # Shared utilities (used by all scripts)
│   └── utils.sh        # Common functions (logging, S3, Docker helpers)
├── dev/                # Development scripts (local)
│   ├── docker.sh       # Docker Compose operations (local dev)
│   └── k8s.sh          # Kubernetes operations (local dev)
├── docker-infra/        # Docker infrastructure production scripts
│   ├── setup-directories.sh  # Server directory setup
│   ├── deploy.sh        # Smart deployment orchestrator
│   ├── health-check.sh  # Infrastructure health monitoring
│   ├── backup.sh        # Dual-backup system (local + Contabo S3)
│   ├── restore.sh       # Priority-based restore (local first, S3 fallback)
│   ├── diagnose.sh      # Auto-debugging and diagnostics
│   └── verify.sh        # Comprehensive post-deployment verification
└── kubernetes/         # Kubernetes production scripts
    └── (to be implemented)
```

## Usage

### Development Scripts (Local)

**Use main entry point:**
```bash
./healthcare.sh dev docker start     # Start local Docker services
./healthcare.sh dev docker logs api  # Show Docker API logs
./healthcare.sh dev k8s deploy local  # Deploy to local K8s
```

**Or use scripts directly:**
```bash
./dev/docker.sh start                # Start local Docker services
./dev/docker.sh logs api             # Show Docker API logs
./dev/k8s.sh deploy local            # Deploy to local K8s
```

### Docker Infrastructure Production Scripts

**Setup Directories:**
```bash
./docker-infra/setup-directories.sh
# Ensures all required server directories exist with proper permissions
# Safe to run multiple times - checks if directories exist before creating
```

**Health Check:**
```bash
./docker-infra/health-check.sh
# Exit codes: 0=healthy, 1=minor issues, 2=critical, 3=missing
```

**Backup:**
```bash
./docker-infra/backup.sh
# Creates backups in /opt/healthcare-backend/backups/ and uploads to Contabo S3
# Returns backup ID
```

**Restore:**
```bash
./docker-infra/restore.sh [backup-id|latest]
# Restores from local backup first, falls back to S3 if needed
```

**Diagnose:**
```bash
./docker-infra/diagnose.sh
# Collects diagnostics and attempts auto-fix
```

**Verify:**
```bash
./docker-infra/verify.sh
# Verifies infrastructure health, data integrity, and application readiness
```

**Deploy (Smart Orchestrator):**
```bash
export INFRA_CHANGED=true
export APP_CHANGED=true
export INFRA_HEALTHY=true
./docker-infra/deploy.sh
# Smart deployment based on conditions
```

**Or use main entry point:**
```bash
./healthcare.sh docker deploy              # Deploy Docker infrastructure production
./healthcare.sh docker health-check        # Check Docker infrastructure
./healthcare.sh docker backup             # Create backup
```

### Kubernetes Production Scripts

**Note:** Kubernetes production scripts are to be implemented. For now, use:
```bash
./healthcare.sh dev k8s <command>  # Local Kubernetes operations
```

## Environment Variables

Required environment variables (from `.env.production`):
- `S3_ENABLED`, `S3_PROVIDER`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`

## Directory Structure on Server

```
/opt/healthcare-backend/
├── backups/
│   ├── postgres/      # PostgreSQL backups
│   ├── dragonfly/     # Dragonfly backups
│   └── metadata/      # Backup metadata JSON files
├── data/
│   ├── postgres/      # PostgreSQL data volume
│   └── dragonfly/     # Dragonfly data volume
└── devops/
    └── scripts/        # These scripts (shared/, dev/, docker-infra/, kubernetes/)
```

## Script Dependencies

- **Docker scripts** depend on `shared/utils.sh` and use Docker commands
- **Kubernetes scripts** will depend on `shared/utils.sh` and use kubectl commands
- **Dev scripts** are standalone (no shared dependencies)
- All scripts use standard bash and common Unix utilities

## Platform Separation

- **`dev/`** - Local development (Docker Compose, local K8s)
- **`docker-infra/`** - Docker infrastructure production deployments (uses `docker compose`, `docker exec`)
- **`kubernetes/`** - Kubernetes production deployments (uses `kubectl`)
- **`shared/`** - Common utilities used by both Docker and Kubernetes scripts

## See Also

- [Verification & Implementation Status](VERIFICATION.md) - Complete verification checklist and integration status
- [Infrastructure Management Plan](docker-infra/INFRASTRUCTURE_MANAGEMENT_PLAN.md) - Complete implementation plan and architecture
- [Docker Compose Production](../docker/docker-compose.prod.yml)
