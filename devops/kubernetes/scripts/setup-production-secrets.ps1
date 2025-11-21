# PowerShell script to setup production secrets from .env.production
# This reads .env.production and creates Kubernetes secrets

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Join-Path $ScriptDir "..\..\.."
$EnvFile = Join-Path $ProjectRoot ".env.production"

Write-Host "🔐 Setting up production secrets from .env.production..." -ForegroundColor Yellow

# Check if .env.production exists
if (-not (Test-Path $EnvFile)) {
    Write-Host "❌ .env.production file not found at: $EnvFile" -ForegroundColor Red
    Write-Host "   Please create .env.production file with production values." -ForegroundColor Yellow
    exit 1
}

# Check if namespace exists
$namespace = kubectl get namespace healthcare-backend 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Creating namespace..." -ForegroundColor Cyan
    kubectl create namespace healthcare-backend
}

# Read .env.production
Write-Host "   Reading .env.production..." -ForegroundColor Cyan
$envContent = Get-Content $EnvFile -Raw

# Parse environment variables (simple parser)
$envVars = @{}
$envContent -split "`n" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        # Remove quotes if present
        $value = $value -replace '^["''](.*)["'']$', '$1'
        # Expand variables
        $value = $value -replace '\$\{([^}]+)\}', { $envVars[$matches[1]] -or $matches[0] }
        $envVars[$key] = $value
    }
}

# Extract required values
$POSTGRES_USER = $envVars["DATABASE_URL"] -replace ".*://([^:]+):.*", '$1'
if (-not $POSTGRES_USER -or $POSTGRES_USER -eq $envVars["DATABASE_URL"]) {
    $POSTGRES_USER = "postgres"
}

$POSTGRES_PASSWORD = $envVars["DATABASE_URL"] -replace ".*://[^:]+:([^@]+)@.*", '$1'
if (-not $POSTGRES_PASSWORD -or $POSTGRES_PASSWORD -eq $envVars["DATABASE_URL"]) {
    # Try to get from separate variable
    $POSTGRES_PASSWORD = $envVars["POSTGRES_PASSWORD"] -or "postgres"
}

$DATABASE_URL = $envVars["DATABASE_URL"]
if (-not $DATABASE_URL) {
    Write-Host "❌ DATABASE_URL not found in .env.production" -ForegroundColor Red
    exit 1
}

# Replace host with Kubernetes service name if needed
$DATABASE_URL = $DATABASE_URL -replace "postgres://", "postgresql://"
$DATABASE_URL = $DATABASE_URL -replace "@postgres:", "@postgres:"
$DATABASE_URL = $DATABASE_URL -replace "@localhost:", "@postgres:"
$DATABASE_URL = $DATABASE_URL -replace "@127\.0\.0\.1:", "@postgres:"

$DB_MIGRATION_URL = $DATABASE_URL  # Same for now, can be different for direct connection

$REDIS_PASSWORD = $envVars["REDIS_PASSWORD"] -or ""
$REDIS_HOST = $envVars["REDIS_HOST"] -or "redis"
$REDIS_PORT = $envVars["REDIS_PORT"] -or "6379"

# Update Redis URL if needed
if ($DATABASE_URL -like "*localhost*" -or $DATABASE_URL -like "*127.0.0.1*") {
    Write-Host "⚠️  Warning: DATABASE_URL contains localhost. Updating to use Kubernetes service name..." -ForegroundColor Yellow
}

$JWT_SECRET = $envVars["JWT_SECRET"]
if (-not $JWT_SECRET -or $JWT_SECRET -like "*CHANGE_THIS*") {
    Write-Host "❌ JWT_SECRET not set or still using default value in .env.production" -ForegroundColor Red
    Write-Host "   Please set a secure JWT_SECRET in .env.production" -ForegroundColor Yellow
    exit 1
}

# Session secrets (required for Fastify session with CacheService/Dragonfly)
$SESSION_SECRET = $envVars["SESSION_SECRET"] -or ""
if (-not $SESSION_SECRET -or $SESSION_SECRET.Length -lt 32) {
    Write-Host "⚠️  SESSION_SECRET not set or too short (min 32 chars). Generating one..." -ForegroundColor Yellow
    $SESSION_SECRET = (New-Guid).ToString().Replace('-', '') + (Get-Random -Minimum 100000 -Maximum 999999).ToString()
    while ($SESSION_SECRET.Length -lt 32) {
        $SESSION_SECRET += (New-Guid).ToString().Replace('-', '')
    }
}

$COOKIE_SECRET = $envVars["COOKIE_SECRET"] -or ""
if (-not $COOKIE_SECRET -or $COOKIE_SECRET.Length -lt 32) {
    Write-Host "⚠️  COOKIE_SECRET not set or too short (min 32 chars). Generating one..." -ForegroundColor Yellow
    $COOKIE_SECRET = (New-Guid).ToString().Replace('-', '') + (Get-Random -Minimum 100000 -Maximum 999999).ToString()
    while ($COOKIE_SECRET.Length -lt 32) {
        $COOKIE_SECRET += (New-Guid).ToString().Replace('-', '')
    }
}

# Optional secrets
$GOOGLE_CLIENT_ID = $envVars["GOOGLE_CLIENT_ID"] -or ""
$GOOGLE_CLIENT_SECRET = $envVars["GOOGLE_CLIENT_SECRET"] -or ""
$AWS_ACCESS_KEY_ID = $envVars["AWS_ACCESS_KEY_ID"] -or ""
$AWS_SECRET_ACCESS_KEY = $envVars["AWS_SECRET_ACCESS_KEY"] -or ""
$AWS_REGION = $envVars["AWS_REGION"] -or "us-east-1"

Write-Host "   Creating healthcare-secrets..." -ForegroundColor Cyan

# Delete existing secret if it exists
kubectl delete secret healthcare-secrets -n healthcare-backend 2>&1 | Out-Null

# Build secret command
$secretArgs = @(
    "create", "secret", "generic", "healthcare-secrets",
    "--namespace", "healthcare-backend",
    "--from-literal=postgres-user=$POSTGRES_USER",
    "--from-literal=postgres-password=$POSTGRES_PASSWORD",
    "--from-literal=database-url=$DATABASE_URL",
    "--from-literal=database-migration-url=$DB_MIGRATION_URL",
    "--from-literal=redis-password=$REDIS_PASSWORD",
    "--from-literal=jwt-secret=$JWT_SECRET",
    "--from-literal=session-secret=$SESSION_SECRET",
    "--from-literal=cookie-secret=$COOKIE_SECRET"
)

# Add optional secrets if provided
if ($GOOGLE_CLIENT_ID) {
    $secretArgs += "--from-literal=google-client-id=$GOOGLE_CLIENT_ID"
}
if ($GOOGLE_CLIENT_SECRET) {
    $secretArgs += "--from-literal=google-client-secret=$GOOGLE_CLIENT_SECRET"
}
if ($AWS_ACCESS_KEY_ID) {
    $secretArgs += "--from-literal=aws-access-key-id=$AWS_ACCESS_KEY_ID"
}
if ($AWS_SECRET_ACCESS_KEY) {
    $secretArgs += "--from-literal=aws-secret-access-key=$AWS_SECRET_ACCESS_KEY"
}
if ($AWS_REGION) {
    $secretArgs += "--from-literal=aws-region=$AWS_REGION"
}

# Create secret
& kubectl $secretArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Production secrets created successfully" -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 Secrets created:" -ForegroundColor Yellow
    Write-Host "   ✅ postgres-user: $POSTGRES_USER" -ForegroundColor White
    Write-Host "   ✅ postgres-password: ****" -ForegroundColor White
    Write-Host "   ✅ database-url: $($DATABASE_URL.Substring(0, [Math]::Min(50, $DATABASE_URL.Length)))..." -ForegroundColor White
    Write-Host "   ✅ redis-password: $(if ($REDIS_PASSWORD) { '****' } else { '(empty)' })" -ForegroundColor White
    Write-Host "   ✅ jwt-secret: ****" -ForegroundColor White
    
    if ($GOOGLE_CLIENT_ID) {
        Write-Host "   ✅ google-client-id: ****" -ForegroundColor White
    }
    if ($AWS_ACCESS_KEY_ID) {
        Write-Host "   ✅ aws-access-key-id: ****" -ForegroundColor White
    }
} else {
    Write-Host "❌ Failed to create secrets" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "⚠️  Make sure your .env.production file:" -ForegroundColor Yellow
Write-Host "   1. Has secure passwords (not defaults)" -ForegroundColor White
Write-Host "   2. Uses Kubernetes service names (postgres, redis) for hosts" -ForegroundColor White
Write-Host "   3. Has a strong JWT_SECRET" -ForegroundColor White

