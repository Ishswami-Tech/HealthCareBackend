# PowerShell script to build Docker image using containerd (nerdctl)
# This script works with k3s or any containerd-based Kubernetes setup
# Prerequisites: nerdctl installed and accessible (via WSL2 or native Linux)

param(
    [string]$ImageTag = "local",
    [string]$Dockerfile = "devops/docker/Dockerfile"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Join-Path $ScriptDir "..\..\.."

Write-Host "🔨 Healthcare Backend - Build Image with Containerd" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in WSL2 or have nerdctl available
$isWSL = $false
$nerdctlPath = "nerdctl"

# Check if WSL2 is available
$wslCheck = wsl --status 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ WSL2 detected" -ForegroundColor Green
    $isWSL = $true
} else {
    Write-Host "⚠️  WSL2 not detected. This script requires WSL2 or native Linux." -ForegroundColor Yellow
    Write-Host "   Please run this script in WSL2 or install nerdctl natively." -ForegroundColor Yellow
    exit 1
}

# Convert Windows path to WSL path
$wslProjectRoot = wsl wslpath -a $ProjectRoot
$wslDockerfile = wsl wslpath -a (Join-Path $ProjectRoot $Dockerfile)

Write-Host "📋 Build Configuration:" -ForegroundColor Yellow
Write-Host "   Image Tag: healthcare-api:$ImageTag" -ForegroundColor White
Write-Host "   Dockerfile: $Dockerfile" -ForegroundColor White
Write-Host "   Project Root: $ProjectRoot" -ForegroundColor White
Write-Host "   WSL Path: $wslProjectRoot" -ForegroundColor White
Write-Host ""

# Check nerdctl in WSL
Write-Host "🔍 Checking nerdctl..." -ForegroundColor Yellow
$nerdctlCheck = wsl which nerdctl 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ nerdctl not found in WSL2" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install nerdctl:" -ForegroundColor Yellow
    Write-Host "  wsl" -ForegroundColor White
    Write-Host "  wget https://github.com/containerd/nerdctl/releases/download/v1.7.0/nerdctl-1.7.0-linux-amd64.tar.gz" -ForegroundColor White
    Write-Host "  tar -xzf nerdctl-1.7.0-linux-amd64.tar.gz" -ForegroundColor White
    Write-Host "  sudo mv nerdctl /usr/local/bin/" -ForegroundColor White
    Write-Host "  sudo chmod +x /usr/local/bin/nerdctl" -ForegroundColor White
    exit 1
}

$nerdctlVersion = wsl nerdctl version 2>&1
Write-Host "✅ nerdctl found: $nerdctlVersion" -ForegroundColor Green
Write-Host ""

# Build image using nerdctl
Write-Host "🔨 Building image with nerdctl..." -ForegroundColor Yellow
Write-Host "   This may take several minutes..." -ForegroundColor Cyan
Write-Host ""

$buildCmd = "cd '$wslProjectRoot' && nerdctl build -f '$wslDockerfile' -t healthcare-api:$ImageTag ."
$buildOutput = wsl bash -c $buildCmd 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    Write-Host $buildOutput -ForegroundColor Red
    exit 1
}

Write-Host "✅ Image built successfully!" -ForegroundColor Green
Write-Host ""

# Verify image exists
Write-Host "📦 Verifying image..." -ForegroundColor Yellow
$imageCheck = wsl nerdctl images healthcare-api:$ImageTag 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Image verified:" -ForegroundColor Green
    Write-Host $imageCheck -ForegroundColor White
} else {
    Write-Host "⚠️  Could not verify image" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📝 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Import image to k3s namespace (if using k3s):" -ForegroundColor White
Write-Host "      wsl sudo nerdctl --namespace k8s.io load -i `$(nerdctl save healthcare-api:$ImageTag)" -ForegroundColor Gray
Write-Host ""
Write-Host "   2. Or deploy directly:" -ForegroundColor White
Write-Host "      .\devops\kubernetes\scripts\deploy-containerd.ps1" -ForegroundColor Gray
Write-Host ""

Write-Host "✅ Build complete!" -ForegroundColor Green



