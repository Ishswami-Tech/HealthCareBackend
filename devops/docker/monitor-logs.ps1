# PowerShell script to monitor Docker API logs
# Usage: .\devops\docker\monitor-logs.ps1

Write-Host "🏥 Monitoring Healthcare API Logs..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Yellow
Write-Host ""

docker compose -f devops/docker/docker-compose.dev.yml logs -f api

