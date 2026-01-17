# Kubernetes Production Scripts

This directory contains Kubernetes-specific production deployment scripts.

## Planned Scripts

- **`deploy.sh`** - Kubernetes deployment orchestrator (similar to Docker's
  deploy.sh)
- **`health-check.sh`** - Kubernetes infrastructure health monitoring (uses
  kubectl)
- **`backup.sh`** - Kubernetes backup system (for persistent volumes)
- **`restore.sh`** - Kubernetes restore system
- **`diagnose.sh`** - Kubernetes diagnostics (uses kubectl)
- **`verify.sh`** - Kubernetes post-deployment verification
- **`setup-secrets.sh`** - Setup Kubernetes secrets
- **`setup-namespace.sh`** - Setup Kubernetes namespace and RBAC

## Differences from Docker Scripts

- Uses `kubectl` instead of `docker` commands
- Works with Kubernetes resources (pods, services, deployments, statefulsets)
- Handles Kubernetes-specific concerns (configmaps, secrets, persistent volumes)
- Uses Kubernetes health checks (readiness/liveness probes)
- Manages Kubernetes namespaces and RBAC

## Usage

Once implemented, scripts will be accessible via:

```bash
./healthcare.sh k8s deploy production
./healthcare.sh k8s health-check
./healthcare.sh k8s backup
```

## See Also

- [Docker Infrastructure Scripts](../docker-infra/)
- [Development Scripts](../dev/)
