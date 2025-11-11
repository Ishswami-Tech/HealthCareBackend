# Quick Start Script for Docker Development Environment (PowerShell)
# This script helps you start the Healthcare Backend in Docker

Write-Host "🏥 Healthcare Backend - Docker Development Setup" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
try {
    docker info | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop and try again." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Navigate to project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
Set-Location $ProjectRoot

Write-Host "📁 Project root: $ProjectRoot" -ForegroundColor Yellow
Write-Host ""

# Check if docker-compose file exists
$ComposeFile = "devops/docker/docker-compose.dev.yml"
if (-not (Test-Path $ComposeFile)) {
    Write-Host "❌ Docker compose file not found: $ComposeFile" -ForegroundColor Red
    exit 1
}

Write-Host "📋 Starting services..." -ForegroundColor Yellow
Write-Host ""

# Stop any existing containers
Write-Host "🛑 Stopping existing containers (if any)..." -ForegroundColor Yellow
docker-compose -f $ComposeFile down 2>$null

# Build and start containers
Write-Host "🔨 Building and starting containers..." -ForegroundColor Yellow
docker-compose -f $ComposeFile up -d --build

Write-Host ""
Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check service status
Write-Host ""
Write-Host "📊 Service Status:" -ForegroundColor Cyan
docker-compose -f $ComposeFile ps

Write-Host ""
Write-Host "✅ Services started successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 Access Points:" -ForegroundColor Cyan
Write-Host "   - API:              http://localhost:8088"
Write-Host "   - Swagger Docs:     http://localhost:8088/docs"
Write-Host "   - Health Check:     http://localhost:8088/health"
Write-Host "   - Queue Dashboard:  http://localhost:8088/queue-dashboard"
Write-Host "   - Prisma Studio:    http://localhost:5555"
Write-Host "   - PgAdmin:          http://localhost:5050 (admin@admin.com / admin)"
Write-Host "   - Redis Commander:  http://localhost:8082 (admin / admin)"
Write-Host ""
Write-Host "📝 Useful Commands:" -ForegroundColor Cyan
Write-Host "   - View logs:        docker-compose -f $ComposeFile logs -f api"
Write-Host "   - Stop services:    docker-compose -f $ComposeFile down"
Write-Host "   - Restart API:      docker-compose -f $ComposeFile restart api"
Write-Host "   - Shell access:     docker exec -it healthcare-api sh"
Write-Host ""
Write-Host "🔍 Viewing API logs..." -ForegroundColor Yellow
Write-Host "   (Press Ctrl+C to stop viewing logs, containers will continue running)"
Write-Host ""
Start-Sleep -Seconds 2

# Follow API logs
docker-compose -f $ComposeFile logs -f api

