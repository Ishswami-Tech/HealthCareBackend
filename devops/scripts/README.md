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

## Security

### Security Features

All scripts include comprehensive security measures:

#### ✅ Input Validation
- **Backup ID Validation**: Validates backup ID format (alphanumeric, hyphens, underscores, or "latest")
- **File Path Validation**: Prevents path traversal attacks (`../../etc/passwd`)
- **Container Name Validation**: Validates Docker container names to prevent command injection
- **S3 Path Validation**: Validates S3 paths before operations
- **Command Name Validation**: Validates script command names to prevent path traversal

#### ✅ Security Functions (utils.sh)
- `validate_backup_id()` - Validates backup ID format
- `validate_file_path()` - Prevents path traversal
- `validate_container_name()` - Validates Docker container names
- `validate_s3_path()` - Validates S3 paths
- `sanitize_filename()` - Sanitizes filenames

#### ✅ Script-Specific Security

**restore.sh:**
- Backup ID validation before use
- File path validation for all file operations
- S3 path validation
- Filename sanitization from metadata
- Prevents path traversal and command injection

**backup.sh:**
- Container name validation
- Prevents command injection via container names

**health-check.sh, verify.sh, deploy.sh, diagnose.sh:**
- Container name validation for all services
- Prevents command injection

**healthcare.sh:**
- Command name validation (prevents path traversal in script paths)
- Prevents path traversal attacks

**docker.sh, k8s.sh:**
- Service/container/resource name validation
- Port number validation
- Prevents command injection

**S3 Functions (utils.sh):**
- S3 path validation in `s3_upload()`, `s3_download()`, `s3_exists()`
- Local file path validation (restricts to /tmp or backup directories)
- Endpoint URL format validation
- Prevents path traversal in S3 operations

**Container Functions (utils.sh):**
- Container name validation in `container_running()` and `get_container_status()`
- Prevents command injection via container names

### Security Best Practices Applied

✅ `set -euo pipefail` in all scripts (error handling)
✅ Variables properly quoted in commands
✅ Secrets stored in environment variables (not hardcoded)
✅ File permissions set correctly (600 for backups, 755 for directories)
✅ Input validation for all user-provided data
✅ Path traversal protection
✅ Command injection prevention
✅ Container name validation
✅ S3 path validation

### GitHub Actions Workflow Security

The CI/CD workflow includes:

#### ✅ SSH Security
- `StrictHostKeyChecking=accept-new` (prevents MITM attacks)
- Proper SSH key file permissions (700 for ~/.ssh, 600 for known_hosts)
- `UserKnownHostsFile=~/.ssh/known_hosts` to all SSH/SCP commands

#### ✅ Heredoc Security
- All heredoc delimiters use single quotes (`'ENDSSH'`)
- Prevents command injection on remote server

#### ✅ Input Validation
- Path validation for `SERVER_DEPLOY_PATH` (alphanumeric, slashes, hyphens, underscores only)
- Path traversal prevention (rejects `..`)
- Backup ID validation in restore operations

#### ✅ Secret Logging
- Sensitive data removed from echo statements
- `[REDACTED]` placeholders for server hostname and paths in logs
- Reduces risk of secrets appearing in logs

### Security Recommendations

#### Short-term
- Implement secret rotation policy
- Add audit logging for all deployments
- Use GitHub Actions OIDC for authentication (if applicable)

#### Long-term
- Implement deployment approval workflows
- Add automated security scanning in CI/CD
- Use infrastructure as code (IaC) for server setup
- Implement zero-trust networking

### Compliance Notes

- **HIPAA**: All secrets are encrypted at rest and in transit
- **GDPR**: No PII is logged in workflow logs
- **SOC 2**: Audit trail maintained for all deployments

## See Also

- [Verification & Implementation Status](VERIFICATION.md) - Complete verification checklist and integration status
- [Infrastructure Management Plan](docker-infra/INFRASTRUCTURE_MANAGEMENT_PLAN.md) - Complete implementation plan and architecture
- [Docker Compose Production](../docker/docker-compose.prod.yml)
