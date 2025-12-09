# Script Consolidation Migration Guide

## Overview

All DevOps scripts have been consolidated into a unified structure for easier management and maintenance.

## New Structure

```
devops/scripts/
├── healthcare.sh    # Main entry point (routes to Docker or K8s)
├── docker.sh        # All Docker operations
├── k8s.sh          # All Kubernetes operations
└── README.md       # Detailed documentation
```

## Migration Map

### Docker Scripts

| Old Script | New Command |
|------------|-------------|
| `devops/docker/start-dev.sh` | `./devops/scripts/docker.sh start` |
| `devops/docker/check-status.sh` | `./devops/scripts/docker.sh status` |
| `devops/docker/monitor-logs.sh` | `./devops/scripts/docker.sh monitor` |
| `devops/docker/monitor-app.sh` | `./devops/scripts/docker.sh monitor api` |
| `devops/docker/monitor-cache.sh` | `./devops/scripts/docker.sh monitor dragonfly` |
| `devops/docker/check-docker-wsl.sh` | `./devops/scripts/docker.sh health` |
| `devops/docker/clean-docker-wsl.sh` | `./devops/scripts/docker.sh clean` |
| `devops/docker/verify-wsl.sh` | `./devops/scripts/docker.sh health` |

### Kubernetes Scripts

| Old Script | New Command |
|------------|-------------|
| `devops/kubernetes/scripts/deploy-local.sh` | `./devops/scripts/k8s.sh deploy local` |
| `devops/kubernetes/scripts/deploy-production.sh` | `./devops/scripts/k8s.sh deploy production` |
| `devops/kubernetes/scripts/deploy-staging.sh` | `./devops/scripts/k8s.sh deploy staging` |
| `devops/kubernetes/scripts/setup-local-secrets.sh` | `./devops/scripts/k8s.sh setup-secrets local` |
| `devops/kubernetes/scripts/setup-production-secrets.sh` | `./devops/scripts/k8s.sh setup-secrets production` |
| `devops/kubernetes/scripts/generate-openvidu-secrets.sh` | `./devops/scripts/k8s.sh generate-secrets openvidu` |
| `devops/kubernetes/scripts/generate-jitsi-secrets.sh` | `./devops/scripts/k8s.sh generate-secrets jitsi` |
| `devops/kubernetes/scripts/configure-openvidu-domain.sh` | `./devops/scripts/k8s.sh configure-domain openvidu <domain>` |
| `devops/kubernetes/scripts/configure-jitsi-domain.sh` | `./devops/scripts/k8s.sh configure-domain jitsi <domain>` |
| `devops/kubernetes/scripts/teardown-local.sh` | `./devops/scripts/k8s.sh teardown local` |
| `devops/kubernetes/scripts/validate-secrets.sh` | `./devops/scripts/k8s.sh validate-secrets` |
| `devops/kubernetes/scripts/trigger-walg-backup.sh` | `./devops/scripts/k8s.sh backup` |
| `devops/kubernetes/scripts/get-logs.sh` | `./devops/scripts/k8s.sh logs <resource>` |

## Quick Reference

### Main Entry Point
```bash
# Show help
./devops/scripts/healthcare.sh help

# Docker operations
./devops/scripts/healthcare.sh docker <command>

# Kubernetes operations
./devops/scripts/healthcare.sh k8s <command>
```

### Docker Commands
```bash
./devops/scripts/docker.sh start      # Start all services
./devops/scripts/docker.sh stop       # Stop all services
./devops/scripts/docker.sh restart    # Restart services
./devops/scripts/docker.sh status     # Show status
./devops/scripts/docker.sh logs api   # Show logs
./devops/scripts/docker.sh monitor    # Monitor logs
./devops/scripts/docker.sh health     # Check health
./devops/scripts/docker.sh clean      # Clean everything
./devops/scripts/docker.sh shell api  # Open shell
```

### Kubernetes Commands
```bash
./devops/scripts/k8s.sh deploy local              # Deploy to local
./devops/scripts/k8s.sh setup-secrets production  # Setup secrets
./devops/scripts/k8s.sh generate-secrets openvidu
./devops/scripts/k8s.sh configure-domain openvidu video.example.com
./devops/scripts/k8s.sh status                    # Show status
./devops/scripts/k8s.sh logs deployment/healthcare-api
./devops/scripts/k8s.sh port-forward healthcare-api 8088
./devops/scripts/k8s.sh shell                     # Open shell
./devops/scripts/k8s.sh teardown local            # Delete resources
./devops/scripts/k8s.sh validate-secrets          # Validate secrets
./devops/scripts/k8s.sh backup                     # Trigger backup
```

## Benefits

1. **Single Entry Point**: One script to rule them all
2. **Consistent Interface**: Same command structure everywhere
3. **Less Duplication**: No more .sh and .ps1 duplicates
4. **Easier Maintenance**: Update one place, affects all
5. **Better Organization**: All scripts in one directory
6. **Cross-Platform**: Works on Linux, Mac, WSL2

## Backward Compatibility

Old scripts are still available but deprecated. They will continue to work but should be migrated to the new consolidated scripts.

## Next Steps

1. Update CI/CD pipelines to use new scripts
2. Update team documentation
3. Gradually migrate from old scripts to new ones
4. Remove old scripts after migration is complete (optional)

