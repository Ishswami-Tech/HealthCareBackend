# PowerShell script to setup local development secrets
# This creates secrets with default values suitable for local development

$ErrorActionPreference = "Stop"

Write-Host "🔐 Setting up local development secrets..." -ForegroundColor Yellow

# Check if namespace exists
$namespace = kubectl get namespace healthcare-backend 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Creating namespace..." -ForegroundColor Cyan
    kubectl create namespace healthcare-backend
}

# Default values for local development
$POSTGRES_USER = "postgres"
$POSTGRES_PASSWORD = "postgres123"
$REDIS_PASSWORD = "redis123"
$JWT_SECRET = "local-dev-jwt-secret-change-in-production-$(Get-Random)"
$SESSION_SECRET = "local-dev-session-secret-$(New-Guid).ToString().Replace('-', '')$(Get-Random -Minimum 1000 -Maximum 9999)"
$COOKIE_SECRET = "local-dev-cookie-secret-$(New-Guid).ToString().Replace('-', '')$(Get-Random -Minimum 1000 -Maximum 9999)"

# Database URLs
$DB_URL = "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/userdb?schema=public"
$DB_MIGRATION_URL = "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/userdb?schema=public"

# Optional: Allow override via environment variables
if ($env:POSTGRES_PASSWORD) { $POSTGRES_PASSWORD = $env:POSTGRES_PASSWORD }
if ($env:REDIS_PASSWORD) { $REDIS_PASSWORD = $env:REDIS_PASSWORD }
if ($env:JWT_SECRET) { $JWT_SECRET = $env:JWT_SECRET }
if ($env:SESSION_SECRET) { $SESSION_SECRET = $env:SESSION_SECRET }
if ($env:COOKIE_SECRET) { $COOKIE_SECRET = $env:COOKIE_SECRET }
if ($env:DB_URL) { $DB_URL = $env:DB_URL }
if ($env:DB_MIGRATION_URL) { $DB_MIGRATION_URL = $env:DB_MIGRATION_URL }

# Ensure secrets are set (fallback if somehow null)
if (-not $JWT_SECRET) {
    $JWT_SECRET = "local-dev-jwt-secret-change-in-production-$(Get-Random)"
}
if (-not $SESSION_SECRET -or $SESSION_SECRET.Length -lt 32) {
    $SESSION_SECRET = "local-dev-session-secret-$(New-Guid).ToString().Replace('-', '')$(Get-Random -Minimum 1000 -Maximum 9999)"
}
if (-not $COOKIE_SECRET -or $COOKIE_SECRET.Length -lt 32) {
    $COOKIE_SECRET = "local-dev-cookie-secret-$(New-Guid).ToString().Replace('-', '')$(Get-Random -Minimum 1000 -Maximum 9999)"
}

Write-Host "   Creating healthcare-secrets..." -ForegroundColor Cyan

# Delete existing secret if it exists
kubectl delete secret healthcare-secrets -n healthcare-backend 2>&1 | Out-Null

# Create secret
kubectl create secret generic healthcare-secrets `
    --namespace healthcare-backend `
    --from-literal=postgres-user=$POSTGRES_USER `
    --from-literal=postgres-password=$POSTGRES_PASSWORD `
    --from-literal=database-url=$DB_URL `
    --from-literal=database-migration-url=$DB_MIGRATION_URL `
    --from-literal=redis-password=$REDIS_PASSWORD `
    --from-literal=jwt-secret=$JWT_SECRET `
    --from-literal=session-secret=$SESSION_SECRET `
    --from-literal=cookie-secret=$COOKIE_SECRET

Write-Host "✅ Secrets created successfully" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Default values used (override with environment variables):" -ForegroundColor Yellow
Write-Host "   POSTGRES_USER: $POSTGRES_USER" -ForegroundColor White
Write-Host "   POSTGRES_PASSWORD: $POSTGRES_PASSWORD" -ForegroundColor White
Write-Host "   REDIS_PASSWORD: $REDIS_PASSWORD" -ForegroundColor White
if ($JWT_SECRET) {
    $jwtPreview = if ($JWT_SECRET.Length -gt 20) { $JWT_SECRET.Substring(0, 20) + "..." } else { $JWT_SECRET }
    Write-Host "   JWT_SECRET: $jwtPreview" -ForegroundColor White
} else {
    Write-Host "   JWT_SECRET: (not set)" -ForegroundColor White
}
Write-Host ""
Write-Host "⚠️  These are default values for local development only!" -ForegroundColor Yellow
Write-Host "   Use strong, unique values in production." -ForegroundColor Yellow
