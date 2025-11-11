#!/bin/bash
# Bash script to monitor Docker API logs
# Usage: ./devops/docker/monitor-logs.sh

echo "🏥 Monitoring Healthcare API Logs..."
echo "Press Ctrl+C to stop monitoring"
echo ""

docker compose -f devops/docker/docker-compose.dev.yml logs -f api

