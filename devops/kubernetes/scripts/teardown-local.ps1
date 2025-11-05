# PowerShell script to tear down local Kubernetes deployment

$ErrorActionPreference = "Stop"

Write-Host "🗑️  Tearing down local Healthcare Backend deployment..." -ForegroundColor Yellow
Write-Host ""

$response = Read-Host "This will delete the entire 'healthcare-backend' namespace. Continue? (y/N)"
if ($response -ne "y" -and $response -ne "Y") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

Write-Host "Deleting namespace..." -ForegroundColor Cyan
kubectl delete namespace healthcare-backend

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Local deployment torn down successfully" -ForegroundColor Green
} else {
    Write-Host "⚠️  Namespace may not exist or was already deleted" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "💡 Note: Docker images are not deleted. To remove them:" -ForegroundColor Cyan
Write-Host "   docker rmi healthcare-api:local" -ForegroundColor White

