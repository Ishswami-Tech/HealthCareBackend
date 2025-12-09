# Removed Scripts Summary

## Overview

The following scripts have been removed as they are now consolidated into the unified scripts in `devops/scripts/`.

## Removed Docker Scripts

All removed from `devops/docker/`:
- ✅ `start-dev.sh` → Use `./devops/scripts/docker.sh start`
- ✅ `start-dev.ps1` → Use `./devops/scripts/docker.sh start`
- ✅ `check-status.sh` → Use `./devops/scripts/docker.sh status`
- ✅ `check-status.ps1` → Use `./devops/scripts/docker.sh status`
- ✅ `monitor-logs.sh` → Use `./devops/scripts/docker.sh monitor`
- ✅ `monitor-logs.ps1` → Use `./devops/scripts/docker.sh monitor`
- ✅ `monitor-app.sh` → Use `./devops/scripts/docker.sh monitor api`
- ✅ `monitor-cache.sh` → Use `./devops/scripts/docker.sh monitor dragonfly`
- ✅ `check-docker-wsl.sh` → Use `./devops/scripts/docker.sh health`
- ✅ `clean-docker-wsl.sh` → Use `./devops/scripts/docker.sh clean`
- ✅ `verify-wsl.sh` → Use `./devops/scripts/docker.sh health`

## Removed Kubernetes Scripts

All removed from `devops/kubernetes/scripts/`:
- ✅ `deploy-local.sh` → Use `./devops/scripts/k8s.sh deploy local`
- ✅ `deploy-local.ps1` → Use `./devops/scripts/k8s.sh deploy local`
- ✅ `deploy-production.sh` → Use `./devops/scripts/k8s.sh deploy production`
- ✅ `deploy-production.ps1` → Use `./devops/scripts/k8s.sh deploy production`
- ✅ `setup-local-secrets.sh` → Use `./devops/scripts/k8s.sh setup-secrets local`
- ✅ `setup-local-secrets.ps1` → Use `./devops/scripts/k8s.sh setup-secrets local`
- ✅ `setup-production-secrets.sh` → Use `./devops/scripts/k8s.sh setup-secrets production`
- ✅ `setup-production-secrets.ps1` → Use `./devops/scripts/k8s.sh setup-secrets production`
- ✅ `generate-openvidu-secrets.sh` → Use `./devops/scripts/k8s.sh generate-secrets openvidu`
- ✅ `generate-jitsi-secrets.sh` → Use `./devops/scripts/k8s.sh generate-secrets jitsi`
- ✅ `generate-jitsi-secrets.ps1` → Use `./devops/scripts/k8s.sh generate-secrets jitsi`
- ✅ `configure-openvidu-domain.sh` → Use `./devops/scripts/k8s.sh configure-domain openvidu <domain>`
- ✅ `configure-jitsi-domain.sh` → Use `./devops/scripts/k8s.sh configure-domain jitsi <domain>`
- ✅ `configure-jitsi-dns.sh` → Consolidated into domain configuration
- ✅ `configure-jitsi-firewall.sh` → Consolidated into domain configuration
- ✅ `deploy-jitsi.sh` → Use `./devops/scripts/k8s.sh deploy <env>` (Jitsi included)
- ✅ `deploy-jitsi-complete.sh` → Use `./devops/scripts/k8s.sh deploy <env>`
- ✅ `test-jitsi.sh` → Use `./devops/scripts/k8s.sh status` and manual testing
- ✅ `teardown-local.sh` → Use `./devops/scripts/k8s.sh teardown local`
- ✅ `teardown-local.ps1` → Use `./devops/scripts/k8s.sh teardown local`
- ✅ `get-logs.sh` → Use `./devops/scripts/k8s.sh logs <resource>`
- ✅ `fix-deployment.sh` → Troubleshooting - use kubectl directly
- ✅ `fix-env-vars.sh` → Troubleshooting - use kubectl directly
- ✅ `quick-fix-env.sh` → Troubleshooting - use kubectl directly
- ✅ `rebuild-and-fix.sh` → Troubleshooting - use kubectl directly

## Remaining Utility Scripts

The following scripts remain as they are specialized utilities not fully replaced:

**Kubernetes Utilities:**
- `apply-healthcare-secrets.sh` - Specific secret application utility
- `apply-walg-secrets.sh` - WAL-G specific secrets
- `validate-secrets.sh` - Secret validation (can use `k8s.sh validate-secrets`)
- `trigger-walg-backup.sh` - WAL-G backup trigger (can use `k8s.sh backup`)
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

## Files Kept

**Docker:**
- ✅ `docker-compose.dev.yml` - Development compose file
- ✅ `docker-compose.prod.yml` - Production compose file
- ✅ `Dockerfile` - Production Dockerfile
- ✅ `Dockerfile.dev` - Development Dockerfile
- ✅ `README.md` - Docker documentation

**Kubernetes:**
- ✅ All YAML files in `devops/kubernetes/base/` - Deployment manifests
- ✅ All overlays in `devops/kubernetes/overlays/` - Environment-specific configs
- ✅ Utility scripts (see above) - Specialized utilities

## Migration Complete

All main operational scripts have been consolidated. The old scripts are removed and replaced by the unified scripts in `devops/scripts/`.

