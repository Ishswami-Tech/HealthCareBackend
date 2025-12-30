# Healthcare Backend - Consolidated DevOps Scripts

Complete guide for managing the Healthcare Backend infrastructure using unified, consolidated scripts.

## 📋 Overview

This directory contains consolidated scripts for managing the Healthcare Backend infrastructure. All scripts are unified into a single entry point with consistent interfaces, reducing from **50+ scripts to 4 main scripts**.

### Script Structure

```
devops/scripts/
├── healthcare.sh    # Main entry point (routes to Docker or K8s)
├── docker.sh        # All Docker Compose operations
├── k8s.sh          # All Kubernetes operations
├── deploy.sh       # CI/CD deployment script (runs on server via GitHub Actions)
└── README.md       # This file
```

## 🚀 Quick Start

### Main Entry Point

```bash
# Show help
./devops/scripts/healthcare.sh help

# Docker operations
./devops/scripts/healthcare.sh docker start
./devops/scripts/healthcare.sh docker logs api
./devops/scripts/healthcare.sh docker status

# Kubernetes operations
./devops/scripts/healthcare.sh k8s deploy local
./devops/scripts/healthcare.sh k8s status
./devops/scripts/healthcare.sh k8s logs deployment/healthcare-api
```

### Direct Script Usage

You can also use the individual scripts directly:

```bash
# Docker
./devops/scripts/docker.sh start
./devops/scripts/docker.sh logs api
./devops/scripts/docker.sh status

# Kubernetes
./devops/scripts/k8s.sh deploy local
./devops/scripts/k8s.sh status
./devops/scripts/k8s.sh logs deployment/healthcare-api
```

---

## 📖 Script Documentation

### `healthcare.sh` - Main Entry Point

Unified entry point that routes to Docker or Kubernetes scripts.

**Usage:**
```bash
./devops/scripts/healthcare.sh <platform> <command> [options]
```

**Platforms:**
- `docker` or `d` - Docker Compose operations
- `k8s` or `k` or `kubernetes` - Kubernetes operations

**Examples:**
```bash
./devops/scripts/healthcare.sh docker start
./devops/scripts/healthcare.sh k8s deploy local
./devops/scripts/healthcare.sh help
```

---

### `docker.sh` - Docker Management

Consolidated Docker Compose operations for local development and testing.

**Commands:**
- `start` - Start all services
- `stop` - Stop all services
- `restart` - Restart all services
- `status` - Show service status
- `logs [service]` - Show logs (default: api)
- `monitor [service]` - Monitor logs in real-time (default: api)
- `health` - Check service health
- `clean` - Clean all Docker resources (⚠️ WARNING: deletes data)
- `shell [service]` - Open shell in container (default: api)
- `help` - Show help

**Examples:**
```bash
# Start all services
./devops/scripts/docker.sh start

# View logs
./devops/scripts/docker.sh logs postgres
./devops/scripts/docker.sh logs api

# Monitor logs in real-time
./devops/scripts/docker.sh monitor api
./devops/scripts/docker.sh monitor dragonfly

# Check health
./devops/scripts/docker.sh health

# Open shell in container
./devops/scripts/docker.sh shell api
./devops/scripts/docker.sh shell postgres

# Clean everything (WARNING: deletes data)
./devops/scripts/docker.sh clean
```

**Available Services:**
- `api` - Main API service
- `worker` - Background job processor
- `postgres` - PostgreSQL database
- `dragonfly` - Cache provider
- `openvidu-server` - Video conferencing service

---

### `k8s.sh` - Kubernetes Management

Consolidated Kubernetes operations for cluster deployment and management.

**Commands:**
- `deploy <env>` - Deploy to environment (`local`/`staging`/`production`)
- `setup-secrets <env>` - Setup secrets for environment
- `generate-secrets <type>` - Generate secrets (`openvidu`/`jitsi`)
- `configure-domain <type> [domain]` - Configure domain (`openvidu`/`jitsi`)
- `status` - Show cluster status
- `logs <resource>` - Show logs (e.g., `deployment/healthcare-api`)
- `port-forward [svc] [port]` - Port forward service (default: `healthcare-api:8088`)
- `shell [pod]` - Open shell in pod
- `teardown [env]` - Delete all resources for environment
- `validate-secrets` - Validate required secrets
- `backup` - Trigger database backup
- `help` - Show help

**Examples:**
```bash
# Deploy to environment
./devops/scripts/k8s.sh deploy local
./devops/scripts/k8s.sh deploy production

# Setup secrets
./devops/scripts/k8s.sh setup-secrets production
./devops/scripts/k8s.sh setup-secrets local

# Generate secrets
./devops/scripts/k8s.sh generate-secrets openvidu
./devops/scripts/k8s.sh generate-secrets jitsi

# Configure domain
./devops/scripts/k8s.sh configure-domain openvidu video.example.com
./devops/scripts/k8s.sh configure-domain jitsi meet.example.com

# View status and logs
./devops/scripts/k8s.sh status
./devops/scripts/k8s.sh logs deployment/healthcare-api
./devops/scripts/k8s.sh logs pod/healthcare-api-xxx

# Port forwarding
./devops/scripts/k8s.sh port-forward healthcare-api 8088

# Open shell in pod
./devops/scripts/k8s.sh shell

# Teardown environment
./devops/scripts/k8s.sh teardown local

# Validate and backup
./devops/scripts/k8s.sh validate-secrets
./devops/scripts/k8s.sh backup
```

---

### `deploy.sh` - CI/CD Deployment Script

**Note**: This script is executed on the server via SSH from GitHub Actions during CI/CD deployment. It is not meant to be run manually.

**Purpose:**
- Pulls Docker images from GitHub Container Registry (GHCR)
- Manages Docker containers on the production server
- Handles `.env.production` file creation from GitHub Secrets
- Performs health checks after deployment
- Manages container lifecycle (stop, start, restart)

**Location on Server:**
- `/opt/healthcare-backend/devops/scripts/deploy.sh`

**Usage (CI/CD only):**
The script is automatically called by GitHub Actions workflow (`.github/workflows/ci.yml`) during deployment to the `main` branch.

---

## 🔄 Migration from Old Scripts

All old scripts have been consolidated into the unified scripts. Use the following migration map:

### Docker Scripts Migration

| Old Script | New Command |
|------------|-------------|
| `devops/docker/start-dev.sh` | `./devops/scripts/docker.sh start` |
| `devops/docker/start-dev.ps1` | `./devops/scripts/docker.sh start` |
| `devops/docker/check-status.sh` | `./devops/scripts/docker.sh status` |
| `devops/docker/check-status.ps1` | `./devops/scripts/docker.sh status` |
| `devops/docker/monitor-logs.sh` | `./devops/scripts/docker.sh monitor` |
| `devops/docker/monitor-logs.ps1` | `./devops/scripts/docker.sh monitor` |
| `devops/docker/monitor-app.sh` | `./devops/scripts/docker.sh monitor api` |
| `devops/docker/monitor-cache.sh` | `./devops/scripts/docker.sh monitor dragonfly` |
| `devops/docker/check-docker-wsl.sh` | `./devops/scripts/docker.sh health` |
| `devops/docker/clean-docker-wsl.sh` | `./devops/scripts/docker.sh clean` |
| `devops/docker/verify-wsl.sh` | `./devops/scripts/docker.sh health` |

### Kubernetes Scripts Migration

| Old Script | New Command |
|------------|-------------|
| `devops/kubernetes/scripts/deploy-local.sh` | `./devops/scripts/k8s.sh deploy local` |
| `devops/kubernetes/scripts/deploy-local.ps1` | `./devops/scripts/k8s.sh deploy local` |
| `devops/kubernetes/scripts/deploy-production.sh` | `./devops/scripts/k8s.sh deploy production` |
| `devops/kubernetes/scripts/deploy-production.ps1` | `./devops/scripts/k8s.sh deploy production` |
| `devops/kubernetes/scripts/deploy-staging.sh` | `./devops/scripts/k8s.sh deploy staging` |
| `devops/kubernetes/scripts/setup-local-secrets.sh` | `./devops/scripts/k8s.sh setup-secrets local` |
| `devops/kubernetes/scripts/setup-local-secrets.ps1` | `./devops/scripts/k8s.sh setup-secrets local` |
| `devops/kubernetes/scripts/setup-production-secrets.sh` | `./devops/scripts/k8s.sh setup-secrets production` |
| `devops/kubernetes/scripts/setup-production-secrets.ps1` | `./devops/scripts/k8s.sh setup-secrets production` |
| `devops/kubernetes/scripts/generate-openvidu-secrets.sh` | `./devops/scripts/k8s.sh generate-secrets openvidu` |
| `devops/kubernetes/scripts/generate-jitsi-secrets.sh` | `./devops/scripts/k8s.sh generate-secrets jitsi` |
| `devops/kubernetes/scripts/generate-jitsi-secrets.ps1` | `./devops/scripts/k8s.sh generate-secrets jitsi` |
| `devops/kubernetes/scripts/configure-openvidu-domain.sh` | `./devops/scripts/k8s.sh configure-domain openvidu <domain>` |
| `devops/kubernetes/scripts/configure-jitsi-domain.sh` | `./devops/scripts/k8s.sh configure-domain jitsi <domain>` |
| `devops/kubernetes/scripts/teardown-local.sh` | `./devops/scripts/k8s.sh teardown local` |
| `devops/kubernetes/scripts/teardown-local.ps1` | `./devops/scripts/k8s.sh teardown local` |
| `devops/kubernetes/scripts/get-logs.sh` | `./devops/scripts/k8s.sh logs <resource>` |
| `devops/kubernetes/scripts/validate-secrets.sh` | `./devops/scripts/k8s.sh validate-secrets` |
| `devops/kubernetes/scripts/trigger-walg-backup.sh` | `./devops/scripts/k8s.sh backup` |

### Removed Scripts

**Docker (11 scripts removed):**
- All monitoring, status checking, and startup scripts have been consolidated into `docker.sh`

**Kubernetes (24 scripts removed):**
- All deployment, secret setup, and domain configuration scripts have been consolidated into `k8s.sh`

**Troubleshooting Scripts (removed):**
- `fix-deployment.sh` → Use `kubectl` directly
- `fix-env-vars.sh` → Use `kubectl` directly
- `quick-fix-env.sh` → Use `kubectl` directly
- `rebuild-and-fix.sh` → Use `kubectl` directly

### Remaining Utility Scripts

Specialized utility scripts remain in `devops/kubernetes/scripts/` as they are not fully replaced:

**Kubernetes Utilities:**
- `apply-healthcare-secrets.sh` - Specific secret application utility
- `apply-walg-secrets.sh` - WAL-G specific secrets
- `validate-secrets.sh` - Secret validation (can also use `k8s.sh validate-secrets`)
- `trigger-walg-backup.sh` - WAL-G backup trigger (can also use `k8s.sh backup`)
- `apply-dynamic-config.sh` - Dynamic configuration utility
- `fix-secrets.sh` - Secret troubleshooting utility
- `update-resource-quota.sh` - Resource quota management
- `deploy-direct.sh` - Alternative deployment method (no kustomize)
- `build-containerd.sh` - Containerd-specific build
- `deploy-containerd.sh` - Containerd-specific deployment
- `setup-containerd-wsl2.sh` - Containerd WSL2 setup
- `setup-buildkit-service.sh` - BuildKit service setup
- `setup-contabo-cluster.sh` - Contabo-specific cluster setup
- `calculate-cluster-config.ps1` - Cluster configuration calculator

These can be used directly or integrated into the consolidated scripts later if needed.

---

## ✅ Benefits

1. **Reduced Complexity**: From 50+ scripts to 4 main scripts
2. **Unified Interface**: Single entry point for all operations
3. **Consistent Commands**: Same command structure across platforms
4. **Easier Maintenance**: Update once, affects all
5. **Better Organization**: All scripts in one place
6. **Cross-Platform**: Works on Linux, Mac, and WSL2
7. **Less Duplication**: No more `.sh` and `.ps1` duplicates
8. **Better Documentation**: Single source of truth

---

## 🐛 Troubleshooting

### Script Not Executable

```bash
chmod +x devops/scripts/*.sh
```

### Permission Denied

```bash
# Make scripts executable
chmod +x devops/scripts/*.sh

# Or run with bash
bash devops/scripts/healthcare.sh docker start
```

### Docker Not Found

**Error**: `Docker is not running`

**Solution**:
1. Open Docker Desktop application
2. Wait for Docker Desktop to fully start
3. Ensure WSL2 integration is enabled (if using WSL)
4. Run the script again

**Check Docker Status**:
```bash
docker info
```

### Kubernetes Not Found

**Error**: `Missing prerequisites: kubectl` or `kustomize`

**Solution**:
1. Install `kubectl`: https://kubernetes.io/docs/tasks/tools/
2. Install `kustomize`: https://kustomize.io/
   - Or use `kubectl kustomize` (built-in)
3. Configure `kubectl` with your cluster credentials

**Check Prerequisites**:
```bash
kubectl version --client
kustomize version
# Or
kubectl kustomize --help
```

### Script Execution Errors

If you encounter errors:

1. **Check script permissions**:
   ```bash
   ls -la devops/scripts/*.sh
   chmod +x devops/scripts/*.sh
   ```

2. **Run with verbose output**:
   ```bash
   bash -x devops/scripts/docker.sh start
   ```

3. **Check Docker/Kubernetes status**:
   ```bash
   docker info
   kubectl cluster-info
   ```

4. **Review script logs**:
   Scripts output colored messages indicating success (✅), warnings (⚠️), or errors (❌).

---

## 📚 Related Documentation

- [Docker Deployment Guide](../docker/README.md) - Docker Compose setup and deployment
- [Kubernetes Deployment Guide](../kubernetes/README.md) - Kubernetes cluster setup
- [Nginx Configuration](../nginx/README.md) - Reverse proxy and SSL setup
- [Server Setup Guide](../../docs/SERVER_SETUP_GUIDE.md) - Complete server setup
- [GitHub Secrets Reference](../../docs/GITHUB_SECRETS_REFERENCE.md) - Environment variables

---

## 🎯 Quick Reference

### Most Common Commands

```bash
# Docker - Start services
./devops/scripts/docker.sh start

# Docker - View logs
./devops/scripts/docker.sh logs api

# Docker - Check status
./devops/scripts/docker.sh status

# Kubernetes - Deploy
./devops/scripts/k8s.sh deploy local

# Kubernetes - View status
./devops/scripts/k8s.sh status

# Kubernetes - View logs
./devops/scripts/k8s.sh logs deployment/healthcare-api
```

### Using Main Entry Point

```bash
# Docker operations
./devops/scripts/healthcare.sh docker start
./devops/scripts/healthcare.sh docker logs api
./devops/scripts/healthcare.sh docker status

# Kubernetes operations
./devops/scripts/healthcare.sh k8s deploy local
./devops/scripts/healthcare.sh k8s status
./devops/scripts/healthcare.sh k8s logs deployment/healthcare-api
```

---

## 📝 Notes

- **Old Scripts**: Old scripts in `devops/docker/` and `devops/kubernetes/scripts/` are deprecated. Please use the new consolidated scripts.
- **CI/CD**: The `deploy.sh` script is automatically executed by GitHub Actions during deployment. Do not run it manually.
- **Cross-Platform**: All scripts work on Linux, Mac, and WSL2. PowerShell versions are no longer needed.
- **Migration**: All main operational scripts have been consolidated. Migration is complete.

---

**Ready to use!** All scripts are consolidated and ready for production use.
