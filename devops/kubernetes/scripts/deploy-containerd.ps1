# PowerShell script to deploy Healthcare Backend to Kubernetes using containerd
# This script works with k3s or any containerd-based Kubernetes setup
# Prerequisites: kubectl, kustomize, nerdctl (for image import)

param(
    [switch]$SkipBuild,
    [switch]$SkipSecrets,
    [switch]$SkipMigration,
    [switch]$SkipImageImport,
    [string]$ImageTag = "local"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Join-Path $ScriptDir "..\..\.."
$K8sDir = Join-Path $ScriptDir ".."
$LocalOverlay = Join-Path $K8sDir "overlays\local"

Write-Host "🚀 Healthcare Backend - Containerd/Kubernetes Deployment" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow

# Check kubectl
$kubectlCmd = Get-Command kubectl -ErrorAction SilentlyContinue
if ($kubectlCmd) {
    $kubectlVersion = kubectl version --client --short 2>&1 | Select-Object -First 1
    Write-Host "✅ kubectl found: $kubectlVersion" -ForegroundColor Green
} else {
    Write-Host "❌ kubectl not found. Please install kubectl." -ForegroundColor Red
    Write-Host "   Install from: https://kubernetes.io/docs/tasks/tools/" -ForegroundColor Yellow
    exit 1
}

# Check kustomize
try {
    $kustomizeVersion = kubectl kustomize --help 2>&1 | Select-Object -First 1
    Write-Host "✅ kustomize found (via kubectl)" -ForegroundColor Green
} catch {
    Write-Host "❌ kustomize not available. Please ensure kubectl >= 1.14" -ForegroundColor Red
    exit 1
}

# Check Kubernetes cluster
Write-Host "🔍 Checking Kubernetes cluster..." -ForegroundColor Yellow
$context = kubectl config current-context 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ No Kubernetes cluster found. Please set up k3s or minikube." -ForegroundColor Red
    Write-Host "   See: devops/kubernetes/CONTAINERD_SETUP.md" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Kubernetes context: $context" -ForegroundColor Green

# Verify cluster is accessible
$clusterInfo = kubectl cluster-info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Cannot connect to Kubernetes cluster" -ForegroundColor Red
    Write-Host "   Please ensure your cluster is running and kubeconfig is correct" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Cluster is accessible" -ForegroundColor Green
Write-Host ""

# Build and import image
if (-not $SkipBuild) {
    Write-Host "🔨 Building image..." -ForegroundColor Yellow
    & "$ScriptDir\build-containerd.ps1" -ImageTag $ImageTag
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# Import image to k3s namespace (if using k3s)
if (-not $SkipImageImport) {
    Write-Host "📦 Importing image to Kubernetes..." -ForegroundColor Yellow
    
    # Check if we're using k3s
    $isK3s = $false
    if ($context -match "k3s|default") {
        $isK3s = $true
    }
    
    if ($isK3s) {
        Write-Host "   Detected k3s, importing image to k3s namespace..." -ForegroundColor Cyan
        
        # Check if WSL2 is available
        $wslCheck = wsl --status 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   Using WSL2 for nerdctl..." -ForegroundColor Cyan
            
            # Save image and import to k3s namespace
            $importCmd = "nerdctl save healthcare-api:$ImageTag | sudo nerdctl --namespace k8s.io load -i -"
            $importOutput = wsl bash -c $importCmd 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Image imported to k3s namespace" -ForegroundColor Green
            } else {
                Write-Host "⚠️  Image import failed. Trying alternative method..." -ForegroundColor Yellow
                Write-Host "   You may need to manually import:" -ForegroundColor Yellow
                Write-Host "   wsl sudo nerdctl --namespace k8s.io load -i `$(wsl nerdctl save healthcare-api:$ImageTag)" -ForegroundColor Gray
            }
        } else {
            Write-Host "⚠️  WSL2 not available. Skipping automatic import." -ForegroundColor Yellow
            Write-Host "   Please manually import the image:" -ForegroundColor Yellow
            Write-Host "   sudo nerdctl --namespace k8s.io load -i <(nerdctl save healthcare-api:$ImageTag)" -ForegroundColor Gray
        }
    } else {
        Write-Host "   Not using k3s. Image should be available via your container runtime." -ForegroundColor Cyan
        Write-Host "   If using minikube, you may need to use: minikube image load healthcare-api:$ImageTag" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Create namespace
Write-Host "📦 Creating namespace..." -ForegroundColor Yellow
kubectl create namespace healthcare-backend --dry-run=client -o yaml | kubectl apply -f - 2>&1 | Out-Null
Write-Host "✅ Namespace ready" -ForegroundColor Green
Write-Host ""

# Setup secrets
if (-not $SkipSecrets) {
    Write-Host "🔐 Setting up secrets..." -ForegroundColor Yellow
    
    $postgresUser = "postgres"
    $postgresPassword = "postgres123"
    $redisPassword = "redis123"
    $jwtSecret = "local-dev-jwt-secret-change-in-production-$(Get-Random)"
    
    # Allow override via environment variables
    if ($env:POSTGRES_USER) { $postgresUser = $env:POSTGRES_USER }
    if ($env:POSTGRES_PASSWORD) { $postgresPassword = $env:POSTGRES_PASSWORD }
    if ($env:REDIS_PASSWORD) { $redisPassword = $env:REDIS_PASSWORD }
    if ($env:JWT_SECRET) { $jwtSecret = $env:JWT_SECRET }
    
    $dbUrl = "postgresql://${postgresUser}:${postgresPassword}@postgres:5432/userdb?schema=public"
    $dbMigrationUrl = "postgresql://${postgresUser}:${postgresPassword}@postgres:5432/userdb?schema=public"
    
    # Delete existing secrets
    $ErrorActionPreference = 'SilentlyContinue'
    kubectl delete secret healthcare-secrets -n healthcare-backend 2>&1 | Out-Null
    kubectl delete secret wal-g-secrets -n healthcare-backend 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    
    # Create secrets
    kubectl create secret generic healthcare-secrets `
        --namespace healthcare-backend `
        --from-literal=postgres-user=$postgresUser `
        --from-literal=postgres-password=$postgresPassword `
        --from-literal=database-url=$dbUrl `
        --from-literal=database-migration-url=$dbMigrationUrl `
        --from-literal=redis-password=$redisPassword `
        --from-literal=jwt-secret=$jwtSecret `
        --from-literal=aws-access-key-id=dummy `
        --from-literal=aws-secret-access-key=dummy `
        --from-literal=aws-region=us-east-1 `
        --dry-run=client -o yaml | kubectl apply -f - 2>&1 | Out-Null
    
    kubectl create secret generic wal-g-secrets `
        --namespace healthcare-backend `
        --from-literal=WALG_S3_PREFIX=dummy `
        --from-literal=AWS_ACCESS_KEY_ID=dummy `
        --from-literal=AWS_SECRET_ACCESS_KEY=dummy `
        --from-literal=AWS_REGION=us-east-1 `
        --from-literal=WALG_S3_ENDPOINT=dummy `
        --dry-run=client -o yaml | kubectl apply -f - 2>&1 | Out-Null
    
    Write-Host "✅ Secrets created" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "⏭️  Skipping secrets setup" -ForegroundColor Yellow
    Write-Host ""
}

# Apply Kubernetes resources
Write-Host "🚀 Deploying to Kubernetes..." -ForegroundColor Yellow
Push-Location $LocalOverlay

# Use kustomize to build and apply
$tempYaml = Join-Path $env:TEMP "kustomize-containerd-$(Get-Random).yaml"

$kustomizeOutput = kubectl kustomize . 2>&1 | Where-Object { 
    $_ -notmatch '^# Warning:' -and 
    $_ -notmatch 'Warning:' -and 
    $_ -notmatch 'deprecated'
}

if ($kustomizeOutput.Count -gt 0) {
    $kustomizeOutput | Out-File -FilePath $tempYaml -Encoding utf8 -NoNewline:$false
    
    Write-Host "   Applying resources..." -ForegroundColor Cyan
    kubectl apply -f $tempYaml 2>&1 | Out-Null
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Deployment failed" -ForegroundColor Red
        Remove-Item $tempYaml -ErrorAction SilentlyContinue
        Pop-Location
        exit 1
    }
    
    Remove-Item $tempYaml -ErrorAction SilentlyContinue
    Write-Host "✅ Resources applied" -ForegroundColor Green
} else {
    Write-Host "❌ Kustomize produced no output" -ForegroundColor Red
    Remove-Item $tempYaml -ErrorAction SilentlyContinue
    Pop-Location
    exit 1
}

Pop-Location
Write-Host ""

# Wait for deployments
Write-Host "⏳ Waiting for deployments..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
kubectl wait --for=condition=available --timeout=300s deployment/healthcare-api -n healthcare-backend 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'

Write-Host "✅ Deployments ready" -ForegroundColor Green
Write-Host ""

# Run migration
if (-not $SkipMigration) {
    Write-Host "🗄️  Running database migration..." -ForegroundColor Yellow
    
    $existingJob = kubectl get job healthcare-db-migration -n healthcare-backend 2>&1
    if ($LASTEXITCODE -eq 0) {
        kubectl delete job healthcare-db-migration -n healthcare-backend
        Start-Sleep -Seconds 2
    }
    
    kubectl apply -f (Join-Path $K8sDir "base\init-job.yaml") 2>&1 | Out-Null
    
    Write-Host "   Waiting for migration..." -ForegroundColor Cyan
    kubectl wait --for=condition=complete --timeout=300s job/healthcare-db-migration -n healthcare-backend 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Migration completed" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Migration may still be running. Check logs:" -ForegroundColor Yellow
        Write-Host "   kubectl logs job/healthcare-db-migration -n healthcare-backend" -ForegroundColor Gray
    }
    Write-Host ""
}

# Display status
Write-Host "📊 Deployment Status:" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan
Write-Host ""
kubectl get pods -n healthcare-backend
Write-Host ""
kubectl get svc -n healthcare-backend
Write-Host ""

Write-Host "🌐 Access Information:" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To access the API, run:" -ForegroundColor Yellow
Write-Host "  kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088" -ForegroundColor White
Write-Host ""
Write-Host "Then access at: http://localhost:8088" -ForegroundColor Green
Write-Host ""

Write-Host "💡 Useful Commands:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host "  View logs:     kubectl logs -f deployment/healthcare-api -n healthcare-backend" -ForegroundColor White
Write-Host "  View pods:     kubectl get pods -n healthcare-backend" -ForegroundColor White
Write-Host "  Shell access:  kubectl exec -it deployment/healthcare-api -n healthcare-backend -- /bin/sh" -ForegroundColor White
Write-Host "  Clean up:      kubectl delete namespace healthcare-backend" -ForegroundColor White
Write-Host ""

Write-Host "✅ Deployment complete!" -ForegroundColor Green



