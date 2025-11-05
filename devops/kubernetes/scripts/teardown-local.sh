#!/usr/bin/env bash
# Bash script to tear down local Kubernetes deployment

set -euo pipefail

echo "🗑️  Tearing down local Healthcare Backend deployment..."
echo ""

read -p "This will delete the entire 'healthcare-backend' namespace. Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

echo "Deleting namespace..."
kubectl delete namespace healthcare-backend || echo "⚠️  Namespace may not exist or was already deleted"

echo ""
echo "✅ Local deployment torn down successfully"
echo ""
echo "💡 Note: Docker images are not deleted. To remove them:"
echo "   docker rmi healthcare-api:local"

