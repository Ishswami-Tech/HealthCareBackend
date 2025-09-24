@echo off
echo 🏥 Healthcare Backend Docker Startup Script
echo ==========================================

REM Check if Docker is running
docker version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not running! Please start Docker Desktop first.
    pause
    exit /b 1
)

echo ✅ Docker is running

REM Stop any existing containers
echo 🛑 Stopping existing containers...
docker-compose down

REM Build and start all services
echo 🚀 Starting Healthcare Backend services...
echo.
echo Services starting:
echo   - PostgreSQL Database (port 5432)
echo   - Redis Cache (port 6379) 
echo   - Healthcare API (port 8088)
echo   - pgAdmin (port 8080) [Development]
echo   - Redis Commander (port 8081) [Development]
echo.

docker-compose up --build -d

REM Wait for services to be healthy
echo ⏳ Waiting for services to be healthy...
timeout /t 10 /nobreak >nul

REM Check health status
echo 🔍 Checking service health...
docker-compose ps

echo.
echo 🏥 Healthcare Backend Status:
echo ============================

REM Test the main health endpoint
echo Testing main health endpoint...
curl -s http://localhost:8088/health >nul 2>&1
if errorlevel 1 (
    echo ⚠️  Backend is still starting up...
    echo    This may take up to 60 seconds for first startup
) else (
    echo ✅ Backend API is responding!
)

echo.
echo 📋 Service URLs:
echo ===============
echo   🔗 Main API:          http://localhost:8088
echo   🔗 Health Check:      http://localhost:8088/health
echo   🔗 API Documentation: http://localhost:8088/api-docs (if available)
echo   🔗 pgAdmin:           http://localhost:8080 (admin@healthcare.com / admin123)
echo   🔗 Redis Commander:   http://localhost:8081 (admin / admin)
echo.

echo 📝 Next Steps:
echo ==============
echo   1. Wait 30-60 seconds for all services to fully start
echo   2. Test health endpoints: test-health-endpoints.sh
echo   3. Start your frontend: npm run dev (in frontend directory)
echo   4. Your frontend will connect to: http://localhost:8088
echo.

echo 🔄 To view logs: docker-compose logs -f
echo 🛑 To stop:     docker-compose down
echo 📊 To monitor:  docker-compose ps

echo.
echo ✅ Backend startup initiated! Check the status above.
pause