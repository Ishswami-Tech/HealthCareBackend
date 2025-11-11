# PowerShell script to check API status
Write-Host "Checking Healthcare API Status..." -ForegroundColor Cyan
Write-Host ""

# Check container status
Write-Host "Container Status:" -ForegroundColor Yellow
docker compose -f devops/docker/docker-compose.dev.yml ps api

Write-Host ""
Write-Host "Recent Logs (last 50 lines):" -ForegroundColor Yellow
docker compose -f devops/docker/docker-compose.dev.yml logs api --tail=50

Write-Host ""
Write-Host "Testing Health Endpoint:" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8088/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✅ SUCCESS: App is running!" -ForegroundColor Green
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "❌ App not responding yet" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

