# Scripts Overview

## Deployment Scripts

### Production
- `deploy-production.ps1` / `deploy-production.sh` - Deploy to production Kubernetes
- `setup-production-secrets.ps1` / `setup-production-secrets.sh` - Create secrets from .env.production

### Local
- `deploy-local.ps1` / `deploy-local.sh` - Deploy to local Kubernetes (Docker Desktop)
- `setup-local-secrets.ps1` / `setup-local-secrets.sh` - Create default secrets for local dev
- `teardown-local.ps1` / `teardown-local.sh` - Clean up local deployment

## Utility Scripts

- `validate-secrets.sh` - Validate required secrets exist
- `apply-healthcare-secrets.sh` - Apply secrets from environment variables
- `apply-walg-secrets.sh` - Setup WAL-G backup secrets (for PostgreSQL backups)
- `trigger-walg-backup.sh` - Trigger manual database backup

## Usage

**Production:**
```powershell
.\setup-production-secrets.ps1
.\deploy-production.ps1
```

**Local:**
```powershell
.\deploy-local.ps1
```

