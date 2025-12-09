# Healthcare Backend - Consolidated DevOps Scripts

## Overview

This directory contains consolidated scripts for managing the Healthcare Backend infrastructure. All scripts are unified into a single entry point with consistent interfaces.

## Quick Start

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

## Script Structure

### `healthcare.sh` - Main Entry Point
Unified entry point that routes to Docker or Kubernetes scripts.

**Usage:**
```bash
./devops/scripts/healthcare.sh <platform> <command> [options]
```

**Platforms:**
- `docker` or `d` - Docker Compose operations
- `k8s` or `k` or `kubernetes` - Kubernetes operations

### `docker.sh` - Docker Management
Consolidated Docker Compose operations.

**Commands:**
- `start` - Start all services
- `stop` - Stop all services
- `restart` - Restart all services
- `status` - Show service status
- `logs [service]` - Show logs (default: api)
- `monitor [service]` - Monitor logs (default: api)
- `health` - Check service health
- `clean` - Clean all Docker resources (WARNING: deletes data)
- `shell [service]` - Open shell in container (default: api)
- `help` - Show help

**Examples:**
```bash
./devops/scripts/docker.sh start
./devops/scripts/docker.sh logs postgres
./devops/scripts/docker.sh monitor api
./devops/scripts/docker.sh shell api
./devops/scripts/docker.sh clean
```

### `k8s.sh` - Kubernetes Management
Consolidated Kubernetes operations.

**Commands:**
- `deploy <env>` - Deploy to environment (local/staging/production)
- `setup-secrets <env>` - Setup secrets for environment
- `generate-secrets <type>` - Generate secrets (openvidu/jitsi)
- `configure-domain <type> [domain]` - Configure domain (openvidu/jitsi)
- `status` - Show cluster status
- `logs <resource>` - Show logs (e.g., deployment/healthcare-api)
- `port-forward [svc] [port]` - Port forward service (default: healthcare-api:8088)
- `shell [pod]` - Open shell in pod
- `teardown [env]` - Delete all resources
- `validate-secrets` - Validate required secrets
- `backup` - Trigger database backup
- `help` - Show help

**Examples:**
```bash
./devops/scripts/k8s.sh deploy local
./devops/scripts/k8s.sh setup-secrets production
./devops/scripts/k8s.sh generate-secrets openvidu
./devops/scripts/k8s.sh configure-domain openvidu video.example.com
./devops/scripts/k8s.sh logs deployment/healthcare-api
./devops/scripts/k8s.sh port-forward healthcare-api 8088
./devops/scripts/k8s.sh shell
```

## Migration from Old Scripts

### Docker Scripts

**Old scripts (now consolidated):**
- `devops/docker/start-dev.sh` → `./devops/scripts/docker.sh start`
- `devops/docker/check-status.sh` → `./devops/scripts/docker.sh status`
- `devops/docker/monitor-logs.sh` → `./devops/scripts/docker.sh monitor`
- `devops/docker/check-docker-wsl.sh` → `./devops/scripts/docker.sh health`
- `devops/docker/clean-docker-wsl.sh` → `./devops/scripts/docker.sh clean`

### Kubernetes Scripts

**Old scripts (now consolidated):**
- `devops/kubernetes/scripts/deploy-local.sh` → `./devops/scripts/k8s.sh deploy local`
- `devops/kubernetes/scripts/deploy-production.sh` → `./devops/scripts/k8s.sh deploy production`
- `devops/kubernetes/scripts/setup-local-secrets.sh` → `./devops/scripts/k8s.sh setup-secrets local`
- `devops/kubernetes/scripts/generate-openvidu-secrets.sh` → `./devops/scripts/k8s.sh generate-secrets openvidu`
- `devops/kubernetes/scripts/configure-openvidu-domain.sh` → `./devops/scripts/k8s.sh configure-domain openvidu <domain>`

## Benefits

1. **Unified Interface**: Single entry point for all operations
2. **Consistent Commands**: Same command structure across platforms
3. **Better Organization**: All scripts in one place
4. **Easier Maintenance**: Less duplication, easier to update
5. **Cross-Platform**: Works on Linux, Mac, and WSL2

## Old Scripts

The old scripts in `devops/docker/` and `devops/kubernetes/scripts/` are still available for backward compatibility but are deprecated. Please use the new consolidated scripts.

## Troubleshooting

### Script not executable
```bash
chmod +x devops/scripts/*.sh
```

### Docker not found
Ensure Docker Desktop is running and WSL2 integration is enabled.

### Kubernetes not found
Ensure kubectl and kustomize are installed and configured.

### Permission denied
```bash
# Make scripts executable
chmod +x devops/scripts/*.sh

# Or run with bash
bash devops/scripts/healthcare.sh docker start
```

