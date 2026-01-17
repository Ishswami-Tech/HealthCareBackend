# Complete setup and test script
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Healthcare Backend - Setup & Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Step 1: Create clinic
Write-Host "`n[1/3] Creating clinic..." -ForegroundColor Yellow
yarn exec dotenv -e .env.development -- ts-node -r tsconfig-paths/register create-clinic.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: Clinic creation may have failed (clinic might already exist)" -ForegroundColor Yellow
}

# Step 2: Create test users
Write-Host "`n[2/3] Creating test users..." -ForegroundColor Yellow
yarn exec dotenv -e .env.development -- ts-node -r tsconfig-paths/register quick-seed.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: User creation may have failed (users might already exist)" -ForegroundColor Yellow
}

# Step 3: Test endpoints
Write-Host "`n[3/3] Testing appointment endpoints (role-based)..." -ForegroundColor Yellow
node test-scripts/appointments/test-all-appointments-sequential.js

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Setup and Test Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

