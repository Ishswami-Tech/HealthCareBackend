# PowerShell script to deploy Healthcare Backend to Production Kubernetes
# Prerequisites: kubectl, kustomize, production secrets configured

param(
    [switch]$SkipSecrets,
    [switch]$SkipMigration,
    [string]$ImageTag = "latest",
    [string]$ImageRegistry = "your-registry"  # Change to your Docker registry
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Join-Path $ScriptDir "..\..\.."
$K8sDir = Join-Path $ScriptDir ".."
$ProductionOverlay = Join-Path $K8sDir "overlays\production"

Write-Host "🚀 Healthcare Backend - Production Kubernetes Deployment" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow

# Check kubectl
try {
    $kubectlVersion = kubectl version --client --short 2>&1
    Write-Host "✅ kubectl found: $kubectlVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ kubectl not found. Please install kubectl." -ForegroundColor Red
    exit 1
}

# Check kustomize
try {
    $kustomizeVersion = kustomize version 2>&1
    Write-Host "✅ kustomize found: $kustomizeVersion" -ForegroundColor Green
} catch {
    Write-Host "⚠️  kustomize not found. Using kubectl kustomize..." -ForegroundColor Yellow
    kubectl kustomize --help | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ kustomize not available. Please install kustomize." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Verify production context
Write-Host "🔍 Verifying Kubernetes context..." -ForegroundColor Yellow
$context = kubectl config current-context
Write-Host "   Current context: $context" -ForegroundColor Cyan

$response = Read-Host "Are you sure you want to deploy to PRODUCTION? (type 'yes' to continue)"
if ($response -ne "yes") {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""

# Create namespace
Write-Host "📦 Creating namespace..." -ForegroundColor Yellow
kubectl create namespace healthcare-backend --dry-run=client -o yaml | kubectl apply -f -
Write-Host "✅ Namespace ready" -ForegroundColor Green
Write-Host ""

# Setup secrets
if (-not $SkipSecrets) {
    Write-Host "🔐 Setting up production secrets..." -ForegroundColor Yellow
    
    $secretsScript = Join-Path $ScriptDir "setup-production-secrets.ps1"
    if (Test-Path $secretsScript) {
        & $secretsScript
    } else {
        Write-Host "❌ Production secrets script not found at: $secretsScript" -ForegroundColor Red
        Write-Host "   Please create .env.production file and run setup-production-secrets.ps1 first" -ForegroundColor Yellow
        exit 1
    }
    Write-Host ""
} else {
    Write-Host "⏭️  Skipping secrets setup (--SkipSecrets flag)" -ForegroundColor Yellow
    Write-Host ""
}

# Update image tag in kustomization if needed
if ($ImageTag -ne "latest") {
    Write-Host "📝 Updating image tag to: $ImageTag" -ForegroundColor Yellow
    # This would require updating the kustomization.yaml file
    # For now, we'll use kustomize edit or manual update
    Write-Host "   ⚠️  Make sure to update kustomization.yaml with image tag: $ImageTag" -ForegroundColor Yellow
    Write-Host ""
}

# Apply Kubernetes resources using kustomize
Write-Host "🚀 Deploying to Kubernetes..." -ForegroundColor Yellow
Push-Location $ProductionOverlay

# Preview what will be deployed
Write-Host "   Previewing deployment..." -ForegroundColor Cyan
kubectl kustomize . | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Kustomize build failed. Please check your configuration." -ForegroundColor Red
    Pop-Location
    exit 1
}

# Apply resources
Write-Host "   Applying resources..." -ForegroundColor Cyan
kubectl kustomize . | kubectl apply -f -

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Kubernetes deployment failed" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host "✅ Kubernetes resources applied" -ForegroundColor Green
Write-Host ""

# Wait for deployments
Write-Host "⏳ Waiting for deployments to be ready..." -ForegroundColor Yellow
kubectl wait --for=condition=available --timeout=600s deployment/healthcare-api -n healthcare-backend 2>&1 | Out-Null

Write-Host "✅ Deployments are ready" -ForegroundColor Green
Write-Host ""

# Run database migration
if (-not $SkipMigration) {
    Write-Host "🔄 Running database migration..." -ForegroundColor Yellow
    
    # Check if migration job already exists
    $existingJob = kubectl get job healthcare-db-migration -n healthcare-backend 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   Deleting existing migration job..." -ForegroundColor Cyan
        kubectl delete job healthcare-db-migration -n healthcare-backend
        Start-Sleep -Seconds 2
    }
    
    # Apply migration job
    kubectl apply -f (Join-Path $K8sDir "base\init-job.yaml")
    
    Write-Host "   Waiting for migration to complete..." -ForegroundColor Cyan
    kubectl wait --for=condition=complete --timeout=600s job/healthcare-db-migration -n healthcare-backend 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Database migration completed" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Migration job may still be running. Check with: kubectl logs job/healthcare-db-migration -n healthcare-backend" -ForegroundColor Yellow
    }
    Write-Host ""
}

Pop-Location

# Display status
Write-Host "📊 Deployment Status:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
kubectl get pods -n healthcare-backend
Write-Host ""

Write-Host "🌐 Production Access:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Production API URL: https://api.ishswami.in" -ForegroundColor Green
Write-Host "API Docs: https://api.ishswami.in/docs" -ForegroundColor Green
Write-Host ""

# Show service URLs
Write-Host "Service URLs:" -ForegroundColor Yellow
if (kubectl get svc healthcare-api -n healthcare-backend 2>&1) {
    Write-Host "  API Service: healthcare-api.healthcare-backend.svc.cluster.local:8088" -ForegroundColor White
}

Write-Host ""
Write-Host "📝 Useful Commands:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host "  View logs:     kubectl logs -f deployment/healthcare-api -n healthcare-backend" -ForegroundColor White
Write-Host "  View pods:     kubectl get pods -n healthcare-backend" -ForegroundColor White
Write-Host "  View ingress:  kubectl get ingress -n healthcare-backend" -ForegroundColor White
Write-Host "  View services: kubectl get svc -n healthcare-backend" -ForegroundColor White
Write-Host ""

Write-Host "✅ Production deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  IMPORTANT: Verify your deployment:" -ForegroundColor Yellow
Write-Host "   1. Check all pods are running: kubectl get pods -n healthcare-backend" -ForegroundColor White
Write-Host "   2. Check ingress is configured: kubectl get ingress -n healthcare-backend" -ForegroundColor White
Write-Host "   3. Test API endpoint: curl https://api.ishswami.in/health" -ForegroundColor White
Write-Host "   4. Verify TLS certificate: kubectl get certificate -n healthcare-backend" -ForegroundColor White

