#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default to development if no environment specified
ENV=${1:-dev}

# Function to display help
show_help() {
  echo -e "${BLUE}Healthcare Backend Run Script${NC}"
  echo "Usage: ./run.sh [environment] [command] [options]"
  echo ""
  echo "Environments:"
  echo "  dev, development   Run in development mode with hot-reloading"
  echo "  prod, production   Run in production mode"
  echo ""
  echo "Commands:"
  echo "  start              Start services"
  echo "  stop               Stop services"
  echo "  restart            Restart services"
  echo "  rebuild            Rebuild and restart services"
  echo "  logs               Show logs"
  echo "  status             Show status of services"
  echo "  backup             Create database backup (dev mode only)"
  echo "  restore            Restore database from backup (dev mode only)"
  echo "  clean              Remove containers and volumes"
  echo "  studio             Start Prisma Studio on port 5555"
  echo ""
  echo "Options:"
  echo "  --volumes          With clean command, also removes volumes"
  echo ""
  echo "Examples:"
  echo "  ./run.sh dev start"
  echo "  ./run.sh prod start"
  echo "  ./run.sh dev logs"
  echo "  ./run.sh dev backup"
  echo "  ./run.sh dev restore backup_file.sql"
  echo "  ./run.sh dev clean --volumes"
  echo "  ./run.sh dev studio"
}

# Check if Docker is running
check_docker() {
  if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker and try again.${NC}"
    exit 1
  fi
}

# Check if docker-compose is installed
check_docker_compose() {
  if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: docker-compose is not installed. Please install docker-compose and try again.${NC}"
    exit 1
  fi
}

# Create a backup of the database
create_backup() {
  echo -e "${YELLOW}Creating database backup...${NC}"
  
  mkdir -p backups
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  BACKUP_FILE="backups/backup_${TIMESTAMP}.sql"
  
  docker-compose -f docker-compose.dev.yml exec -T postgres pg_dump -U postgres userdb > "${BACKUP_FILE}"
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Backup created successfully: ${BACKUP_FILE}${NC}"
  else
    echo -e "${RED}Failed to create backup.${NC}"
    exit 1
  fi
}

# Restore a backup of the database
restore_backup() {
  echo -e "${YELLOW}Available backups:${NC}"
  ls -1 backups/*.sql 2>/dev/null || echo "No backups found."
  
  echo -e "${YELLOW}Enter the backup file to restore (or press Enter to cancel):${NC}"
  read BACKUP_FILE
  
  if [ -z "$BACKUP_FILE" ]; then
    echo -e "${YELLOW}Restore cancelled.${NC}"
    return
  fi
  
  if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Backup file not found: ${BACKUP_FILE}${NC}"
    return
  fi
  
  echo -e "${YELLOW}Restoring backup from ${BACKUP_FILE}...${NC}"
  
  docker-compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d userdb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  cat "${BACKUP_FILE}" | docker-compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d userdb
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Backup restored successfully.${NC}"
  else
    echo -e "${RED}Failed to restore backup.${NC}"
    exit 1
  fi
}

# Create a production backup before switching to production
create_production_backup() {
  echo -e "${YELLOW}Creating backup before switching to production...${NC}"
  create_backup
  echo -e "${GREEN}Backup created successfully. Proceeding to production mode.${NC}"
}

# Add a function to start Prisma Studio
start_prisma_studio() {
  if [[ "$ENV" == "production" ]]; then
    echo -e "${RED}Prisma Studio is disabled in production mode.${NC}"
    exit 1
  else
    echo -e "${YELLOW}Starting Prisma Studio on port 5555...${NC}"
    docker-compose -f docker-compose.dev.yml exec -d api npx prisma studio --schema=src/shared/database/prisma/schema.prisma --port 5555 --hostname 0.0.0.0
    echo -e "${GREEN}Prisma Studio started! Access it at http://localhost:5555${NC}"
    echo -e "${YELLOW}Press Ctrl+C if this command doesn't return to the prompt automatically.${NC}"
  fi
}

# Main script
case "$ENV" in
  dev|development)
    check_docker
    check_docker_compose
    
    CMD=${2:-start}
    
    case "$CMD" in
      start)
        echo -e "${YELLOW}Starting Healthcare Backend in DEVELOPMENT mode with hot-reloading...${NC}"
        export NODE_ENV=development
        export APP_ENV=development
        export IS_DEV=true
        docker-compose -f docker-compose.dev.yml up -d
        echo -e "${GREEN}Development environment started successfully!${NC}"
        echo -e "${GREEN}API: http://localhost:8088${NC}"
        echo -e "${GREEN}Prisma Studio: http://localhost:5555${NC}"
        echo -e "${GREEN}PgAdmin: http://localhost:5050 (admin@admin.com/admin)${NC}"
        echo -e "${GREEN}Redis Commander: http://localhost:8082 (admin/admin)${NC}"
        echo -e "${YELLOW}Showing logs from the API container. Press Ctrl+C to exit logs (containers will keep running).${NC}"
        docker-compose -f docker-compose.dev.yml logs -f api
        ;;
      stop)
        echo -e "${YELLOW}Stopping Healthcare Backend...${NC}"
        docker-compose -f docker-compose.dev.yml down
        echo -e "${GREEN}Environment stopped successfully!${NC}"
        ;;
      restart)
        echo -e "${YELLOW}Restarting Healthcare Backend...${NC}"
        docker-compose -f docker-compose.dev.yml restart
        echo -e "${GREEN}Environment restarted successfully!${NC}"
        ;;
      rebuild)
        echo -e "${YELLOW}Rebuilding and restarting Healthcare Backend in DEVELOPMENT mode...${NC}"
        docker-compose -f docker-compose.dev.yml down
        docker-compose -f docker-compose.dev.yml build
        docker-compose -f docker-compose.dev.yml up -d
        echo -e "${GREEN}Rebuild completed!${NC}"
        docker-compose -f docker-compose.dev.yml logs -f api
        ;;
      logs)
        docker-compose -f docker-compose.dev.yml logs -f
        ;;
      logs:api)
        docker-compose -f docker-compose.dev.yml logs -f api
        ;;
      logs:db)
        docker-compose -f docker-compose.dev.yml logs -f postgres
        ;;
      logs:redis)
        docker-compose -f docker-compose.dev.yml logs -f redis
        ;;
      status)
        docker-compose -f docker-compose.dev.yml ps
        ;;
      backup)
        create_backup
        ;;
      restore)
        restore_backup
        ;;
      clean)
        if [ "$3" == "--volumes" ]; then
          docker-compose -f docker-compose.dev.yml down -v
        else
          docker-compose -f docker-compose.dev.yml down
        fi
        echo -e "${GREEN}Cleanup completed successfully!${NC}"
        ;;
      studio)
        start_prisma_studio
        ;;
      help|*)
        show_help
        ;;
    esac
    ;;
  prod|production)
    check_docker
    check_docker_compose
    
    CMD=${2:-start}
    
    case "$CMD" in
      start)
        create_production_backup
        echo -e "${YELLOW}Starting Healthcare Backend in PRODUCTION mode...${NC}"
        export NODE_ENV=production
        export APP_ENV=production
        export IS_DEV=false
        docker-compose up -d
        echo -e "${GREEN}Production environment started successfully!${NC}"
        echo -e "${GREEN}API: http://localhost:8088${NC}"
        echo -e "${YELLOW}Showing logs from the API container. Press Ctrl+C to exit logs (containers will keep running).${NC}"
        docker-compose logs -f api
        ;;
      stop)
        docker-compose down
        echo -e "${GREEN}Environment stopped successfully!${NC}"
        ;;
      restart)
        docker-compose restart
        echo -e "${GREEN}Environment restarted successfully!${NC}"
        ;;
      rebuild)
        create_production_backup
        echo -e "${YELLOW}Rebuilding and restarting Healthcare Backend in PRODUCTION mode...${NC}"
        docker-compose down
        docker-compose build
        docker-compose up -d
        echo -e "${GREEN}Rebuild completed!${NC}"
        docker-compose logs -f api
        ;;
      logs)
        docker-compose logs -f
        ;;
      logs:api)
        docker-compose logs -f api
        ;;
      logs:db)
        docker-compose logs -f postgres
        ;;
      logs:redis)
        docker-compose logs -f redis
        ;;
      status)
        docker-compose ps
        ;;
      backup)
        echo -e "${RED}Backup functionality is not available in production mode.${NC}"
        ;;
      restore)
        echo -e "${RED}Restore functionality is not available in production mode.${NC}"
        ;;
      clean)
        if [ "$3" == "--volumes" ]; then
          docker-compose down -v
        else
          docker-compose down
        fi
        echo -e "${GREEN}Cleanup completed successfully!${NC}"
        ;;
      studio)
        start_prisma_studio
        ;;
      help|*)
        show_help
        ;;
    esac
    ;;
  help|*)
    show_help
    ;;
esac
