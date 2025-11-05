# PowerShell script to deploy Healthcare Backend to local Kubernetes (Docker Desktop)
# Prerequisites: Docker Desktop with Kubernetes enabled, kubectl, kustomize

param(
    [switch]$SkipBuild,
    [switch]$SkipSecrets,
    [switch]$SkipMigration,
    [string]$ImageTag = "local"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Join-Path $ScriptDir "..\..\.."
$K8sDir = Join-Path $ScriptDir ".."
$LocalOverlay = Join-Path $K8sDir "overlays\local"

Write-Host " Healthcare Backend - Local Kubernetes Deployment" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host " Checking prerequisites..." -ForegroundColor Yellow

# Check kubectl
$kubectlCmd = Get-Command kubectl -ErrorAction SilentlyContinue
if ($kubectlCmd) {
    $kubectlVersion = kubectl version --client 2>&1 | Select-Object -First 1
    Write-Host " kubectl found: $kubectlVersion" -ForegroundColor Green
} else {
    Write-Host " kubectl not found. Please install kubectl." -ForegroundColor Red
    Write-Host "   kubectl is usually installed with Docker Desktop." -ForegroundColor Yellow
    Write-Host "   Or install from: https://kubernetes.io/docs/tasks/tools/" -ForegroundColor Yellow
    exit 1
}

# Check kustomize
try {
    $kustomizeVersion = kustomize version 2>&1
    Write-Host " kustomize found: $kustomizeVersion" -ForegroundColor Green
} catch {
    Write-Host " kustomize not found. Installing via kubectl..." -ForegroundColor Yellow
    # kustomize is included in kubectl >= 1.14
    kubectl kustomize --help | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host " kustomize not available. Please install kustomize." -ForegroundColor Red
        exit 1
    }
}

# Check Docker Desktop Kubernetes
Write-Host " Checking Docker Desktop Kubernetes..." -ForegroundColor Yellow
$context = kubectl config current-context
if ($context -notmatch "docker-desktop|docker-for-desktop") {
    Write-Host "  Warning: Current context is '$context'. Expected docker-desktop context." -ForegroundColor Yellow
    Write-Host "   Please ensure Kubernetes is enabled in Docker Desktop settings." -ForegroundColor Yellow
    $response = Read-Host "Continue anyway? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        exit 1
    }
} else {
    Write-Host " Docker Desktop Kubernetes context detected" -ForegroundColor Green
}

# Verify containerd runtime
Write-Host " Verifying containerd runtime..." -ForegroundColor Yellow
try {
    $nodeInfo = kubectl get node docker-desktop -o jsonpath='{.status.nodeInfo.containerRuntimeVersion}' 2>&1
    if ($nodeInfo -match "containerd") {
        Write-Host " Containerd runtime detected: $nodeInfo" -ForegroundColor Green
    } else {
        Write-Host "  Runtime: $nodeInfo (may not be containerd)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Could not verify runtime (this is OK if node name differs)" -ForegroundColor Yellow
}

Write-Host ""

# Build Docker image
if (-not $SkipBuild) {
    Write-Host " Building Docker image..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    
    $imageName = "healthcare-api:$ImageTag"
    
    Write-Host "   Building $imageName..." -ForegroundColor Cyan
    docker build -f devops/docker/Dockerfile -t $imageName .
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host " Docker build failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host " Docker image built successfully" -ForegroundColor Green
    Write-Host ""
    
    # Verify image exists
    Write-Host " Verifying image is available to containerd..." -ForegroundColor Cyan
    $imageExists = docker images --format "{{.Repository}}:{{.Tag}}" | Select-String -Pattern "^${imageName}$"
    if ($imageExists) {
        Write-Host " Image '$imageName' is available" -ForegroundColor Green
        Write-Host "   Docker Desktop automatically makes images available to containerd/Kubernetes" -ForegroundColor Cyan
    } else {
        Write-Host "  Warning: Image not found in Docker images list" -ForegroundColor Yellow
    }
    Write-Host ""
    
    Pop-Location
} else {
    Write-Host "  Skipping Docker build (SkipBuild flag)" -ForegroundColor Yellow
    Write-Host ""
}

# Create namespace
Write-Host " Creating namespace..." -ForegroundColor Yellow
kubectl create namespace healthcare-backend --dry-run=client -o yaml | kubectl apply -f -
Write-Host " Namespace ready" -ForegroundColor Green
Write-Host ""

# Setup secrets
if (-not $SkipSecrets) {
    Write-Host " Setting up secrets..." -ForegroundColor Yellow
    
    # Generate default secrets for local development
    $postgresUser = "postgres"
    $postgresPassword = "postgres123"
    $redisPassword = "redis123"
    $jwtSecret = "local-dev-jwt-secret-change-in-production-$(Get-Random)"
    
    # Optional: Allow override via environment variables
    if ($env:POSTGRES_USER) { $postgresUser = $env:POSTGRES_USER }
    if ($env:POSTGRES_PASSWORD) { $postgresPassword = $env:POSTGRES_PASSWORD }
    if ($env:REDIS_PASSWORD) { $redisPassword = $env:REDIS_PASSWORD }
    if ($env:JWT_SECRET) { $jwtSecret = $env:JWT_SECRET }
    
    # Database URLs - For local dev, connect directly to postgres (bypass pgbouncer)
    $dbUrl = "postgresql://${postgresUser}:${postgresPassword}@postgres:5432/userdb?schema=public"
    $dbMigrationUrl = "postgresql://${postgresUser}:${postgresPassword}@postgres:5432/userdb?schema=public"
    # Note: In production, dbUrl would point to pgbouncer:6432, but for local we use postgres directly
    
    # Delete existing secrets if they exist (ignore errors if they don't exist)
    $ErrorActionPreference = 'SilentlyContinue'
    kubectl delete secret healthcare-secrets -n healthcare-backend 2>&1 | Out-Null
    kubectl delete secret wal-g-secrets -n healthcare-backend 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    
    # Create healthcare-secrets (include optional AWS secrets for workers)
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
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host " Failed to create healthcare-secrets" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    # Create empty wal-g-secrets for local (to avoid errors, but won't be used)
    kubectl create secret generic wal-g-secrets `
        --namespace healthcare-backend `
        --from-literal=WALG_S3_PREFIX=dummy `
        --from-literal=AWS_ACCESS_KEY_ID=dummy `
        --from-literal=AWS_SECRET_ACCESS_KEY=dummy `
        --from-literal=AWS_REGION=us-east-1 `
        --from-literal=WALG_S3_ENDPOINT=dummy `
        --dry-run=client -o yaml | kubectl apply -f - 2>&1 | Out-Null
    
    Write-Host " Secrets created successfully" -ForegroundColor Green
    Write-Host "   Note: wal-g-secrets created with dummy values (not used in local dev)" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "  Skipping secrets setup (SkipSecrets flag)" -ForegroundColor Yellow
    Write-Host ""
}

# Apply Kubernetes resources using kustomize
Write-Host " Deploying to Kubernetes..." -ForegroundColor Yellow
Push-Location $LocalOverlay

# Save kustomize output to temp file and filter warnings
$tempYaml = Join-Path $env:TEMP "kustomize-output-$(Get-Random).yaml"

# Run kustomize and capture output, filtering warnings
$ErrorActionPreference = 'SilentlyContinue'
# Redirect stderr to capture warnings separately, stdout for YAML
$kustomizeOutput = kubectl kustomize . 2>&1 | Where-Object { 
    $_ -notmatch '^# Warning:' -and 
    $_ -notmatch 'Warning:' -and 
    $_ -notmatch 'deprecated' -and
    $_ -notmatch 'error:'
}
$kustomizeExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($kustomizeExitCode -ne 0 -or ($kustomizeOutput -match 'error:')) {
    Write-Host " Kustomize failed. Attempting workaround..." -ForegroundColor Yellow
    Write-Host " Note: This may be a known kustomize issue. Trying alternative approach..." -ForegroundColor Yellow
    
    # Try applying resources directly from base directory as a workaround
    Write-Host " Applying resources directly from base directory..." -ForegroundColor Cyan
    Push-Location "../../base"
    $baseFiles = Get-ChildItem *.yaml -Exclude kustomization.yaml,namespace.yaml,pgbouncer-service.yaml
    $ErrorActionPreference = 'SilentlyContinue'
    
    foreach ($file in $baseFiles) {
        # Skip files that don't exist
        if (-not (Test-Path $file.FullName)) {
            continue
        }
        
        Write-Host "   Applying $($file.Name)..." -ForegroundColor Gray
        $applyOutput = kubectl apply -f $file.FullName -n healthcare-backend 2>&1 | Where-Object { 
            $_ -notmatch 'Warning:' -and 
            $_ -notmatch 'deprecated' -and
            $_ -notmatch 'annotation'
        }
        if ($LASTEXITCODE -ne 0) {
            $errorMsg = $applyOutput | Where-Object { $_ -match 'error|Error' }
            if ($errorMsg) {
                Write-Host "     Warning: $errorMsg" -ForegroundColor Yellow
            }
        }
    }
    
    # Apply image patches after resources are created
    Write-Host "   Patching images for local deployment..." -ForegroundColor Gray
    Start-Sleep -Seconds 5  # Wait for resources to be fully created
    
    # Scale down pgbouncer first (it's causing issues and not needed for local)
    Write-Host "     Scaling down pgbouncer (not needed for local dev)..." -ForegroundColor Gray
    kubectl scale deployment pgbouncer --replicas=0 -n healthcare-backend 2>&1 | Out-Null
    kubectl delete pods -l app=pgbouncer -n healthcare-backend --force --grace-period=0 2>&1 | Out-Null
    
    # Delete all stuck pods first to break ImagePullBackOff loops
    Write-Host "     Cleaning up stuck pods..." -ForegroundColor Gray
    kubectl delete pods -l app=healthcare-worker -n healthcare-backend --force --grace-period=0 2>&1 | Out-Null
    kubectl delete pods -l app=healthcare-api -n healthcare-backend --force --grace-period=0 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    
    # Patch API deployment
    Write-Host "     Patching healthcare-api deployment..." -ForegroundColor Gray
    kubectl set image deployment/healthcare-api api=healthcare-api:local -n healthcare-backend 2>&1 | Out-Null
    kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]' 2>&1 | Out-Null
    # Scale down replicas for local (overlay patches might not apply)
    kubectl scale deployment healthcare-api --replicas=1 -n healthcare-backend 2>&1 | Out-Null
    
    # Patch Worker deployment (force update)
    Write-Host "     Patching healthcare-worker deployment..." -ForegroundColor Gray
    # Update deployment image - use patch instead of set to ensure it sticks
    kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/image", "value": "healthcare-api:local"}]' 2>&1 | Out-Null
    kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]' 2>&1 | Out-Null
    # Scale down replicas for local
    kubectl scale deployment healthcare-worker --replicas=1 -n healthcare-backend 2>&1 | Out-Null
    # Verify the patch worked
    Start-Sleep -Seconds 2
    $workerImage = kubectl get deployment healthcare-worker -n healthcare-backend -o jsonpath='{.spec.template.spec.containers[0].image}' 2>&1
    if ($workerImage -eq "healthcare-api:local") {
        Write-Host "       Worker image updated successfully" -ForegroundColor Green
    } else {
        Write-Host "       Warning: Worker image is still '$workerImage'. Retrying with set image..." -ForegroundColor Yellow
        kubectl set image deployment/healthcare-worker worker=healthcare-api:local -n healthcare-backend 2>&1 | Out-Null
        kubectl rollout restart deployment/healthcare-worker -n healthcare-backend 2>&1 | Out-Null
    }
    
    # Patch migration job
    Write-Host "     Patching migration job..." -ForegroundColor Gray
    kubectl patch job healthcare-db-migration -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/image", "value": "healthcare-api:local"}]' 2>&1 | Out-Null
    kubectl patch job healthcare-db-migration -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]' 2>&1 | Out-Null
    
    $ErrorActionPreference = 'Stop'
    Pop-Location
    
    # Apply overlay patches manually if needed
    Write-Host " Base resources applied successfully." -ForegroundColor Green
    Write-Host " Note: Local-specific patches (replicas, resources, etc.) may need manual adjustment." -ForegroundColor Yellow
    Write-Host " You can patch deployments manually using kubectl patch if needed." -ForegroundColor Yellow
    Pop-Location  # Pop back from base directory
    Pop-Location  # Pop back from overlay directory (we're done with kustomize)
    $skipKustomize = $true
} else {
    $skipKustomize = $false
}

# Write filtered output to file and apply
if (-not $skipKustomize) {
    if ($kustomizeOutput.Count -gt 0) {
        $kustomizeOutput | Out-File -FilePath $tempYaml -Encoding utf8 -NoNewline:$false
        
        # Apply the filtered YAML file
        Write-Host " Applying Kubernetes resources..." -ForegroundColor Cyan
        kubectl apply -f $tempYaml 2>&1 | Out-Null
        
        # Cleanup temp file
        Remove-Item $tempYaml -ErrorAction SilentlyContinue
    } else {
        Write-Host " No output from kustomize (this may indicate an error)" -ForegroundColor Yellow
        Remove-Item $tempYaml -ErrorAction SilentlyContinue
        Pop-Location
        exit 1
    }
} else {
    # Cleanup temp file if it exists
    Remove-Item $tempYaml -ErrorAction SilentlyContinue
}

if ($skipKustomize) {
    Write-Host " Kubernetes resources applied (using direct file method)" -ForegroundColor Green
    Write-Host ""
} else {
    if ($LASTEXITCODE -ne 0) {
        Write-Host " Kubernetes deployment failed" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Write-Host " Kubernetes resources applied" -ForegroundColor Green
    Write-Host ""
}

# Wait for deployments
Write-Host " Waiting for deployments to be ready..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
kubectl wait --for=condition=available --timeout=300s deployment/healthcare-api -n healthcare-backend 2>&1 | Out-Null
$waitExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($waitExitCode -ne 0) {
    Write-Host " Deployment not ready yet. Checking pod status..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host " Current pod status:" -ForegroundColor Cyan
    kubectl get pods -n healthcare-backend
    Write-Host ""
    Write-Host " Checking for issues..." -ForegroundColor Cyan
    $ErrorActionPreference = 'SilentlyContinue'
    $pods = kubectl get pods -n healthcare-backend -o json 2>&1 | ConvertFrom-Json
    $ErrorActionPreference = 'Stop'
    
    # Fix stuck pods with ImagePullBackOff
    $fixApplied = $false
    if ($pods -and $pods.items) {
        foreach ($pod in $pods.items) {
            if ($pod.status.phase -ne "Running" -and $pod.status.phase -ne "Succeeded") {
                Write-Host "   Pod $($pod.metadata.name): $($pod.status.phase)" -ForegroundColor Yellow
                if ($pod.status.containerStatuses) {
                    foreach ($container in $pod.status.containerStatuses) {
                        if ($container.state.waiting) {
                            Write-Host "     Waiting: $($container.state.waiting.reason) - $($container.state.waiting.message)" -ForegroundColor Yellow
                            # Fix ImagePullBackOff for worker pods
                            if ($container.state.waiting.reason -eq "ImagePullBackOff" -and $pod.metadata.name -like "healthcare-worker-*") {
                                Write-Host "     Attempting to fix ImagePullBackOff..." -ForegroundColor Cyan
                                kubectl delete pod $pod.metadata.name -n healthcare-backend --force --grace-period=0 2>&1 | Out-Null
                                $fixApplied = $true
                            }
                        }
                        if ($container.state.terminated) {
                            Write-Host "     Terminated: $($container.state.terminated.reason) - Exit code: $($container.state.terminated.exitCode)" -ForegroundColor Red
                        }
                    }
                }
            }
        }
    }
    
    if ($fixApplied) {
        Write-Host ""
        Write-Host "   Fixed stuck worker pods. New pods should start with correct image." -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host " Note: Deployments may take time to start. Check logs with:" -ForegroundColor Yellow
    Write-Host "   kubectl logs -f deployment/healthcare-api -n healthcare-backend" -ForegroundColor White
    Write-Host "   kubectl describe deployment healthcare-api -n healthcare-backend" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host " Deployments are ready" -ForegroundColor Green
    Write-Host ""
}

# Run database migration
if (-not $SkipMigration) {
    Write-Host " Running database migration..." -ForegroundColor Yellow
    
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
    kubectl wait --for=condition=complete --timeout=300s job/healthcare-db-migration -n healthcare-backend 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host " Database migration completed" -ForegroundColor Green
    } else {
        Write-Host "Migration job may still be running. Check with: kubectl logs job/healthcare-db-migration -n healthcare-backend" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Only pop if we didn't skip kustomize (already popped in workaround)
if (-not $skipKustomize) {
    Pop-Location
}

# Display status
Write-Host " Deployment Status:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""
kubectl get pods -n healthcare-backend
Write-Host ""
kubectl get svc -n healthcare-backend
Write-Host ""

Write-Host " Access Information:" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""

# Port forwarding instructions
Write-Host "To access the API locally, run:" -ForegroundColor Yellow
Write-Host "  kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088" -ForegroundColor White
Write-Host ""
Write-Host "Then access the API at: http://localhost:8088" -ForegroundColor Green
Write-Host ""

# Show service URLs
Write-Host "Service URLs:" -ForegroundColor Yellow
$apiService = kubectl get svc healthcare-api -n healthcare-backend -o jsonpath='{.metadata.name}' 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  API Service: healthcare-api.healthcare-backend.svc.cluster.local:8088" -ForegroundColor White
}

Write-Host ''
Write-Host 'Useful Commands:' -ForegroundColor Cyan
Write-Host '===================' -ForegroundColor Cyan
Write-Host '  View logs:     kubectl logs -f deployment/healthcare-api -n healthcare-backend' -ForegroundColor White
Write-Host '  View pods:     kubectl get pods -n healthcare-backend' -ForegroundColor White
Write-Host '  Describe pod:  kubectl describe pod [pod-name] -n healthcare-backend' -ForegroundColor White
Write-Host '  Shell access:  kubectl exec -it [pod-name] -n healthcare-backend -- /bin/sh' -ForegroundColor White
Write-Host '  Delete all:    kubectl delete namespace healthcare-backend' -ForegroundColor White
Write-Host ''

Write-Host 'Local deployment complete!' -ForegroundColor Green
