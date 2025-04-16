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
  echo "Usage: ./run.sh [environment] [command]"
  echo ""
  echo "Environments:"
  echo "  dev     - Run in development mode with hot-reloading (default)"
  echo "  prod    - Run in production mode"
  echo ""
  echo "Commands:"
  echo "  start       - Start the Docker containers (default)"
  echo "  stop        - Stop the Docker containers"
  echo "  restart     - Restart the Docker containers"
  echo "  logs        - Show logs from all containers"
  echo "  logs:api    - Show logs from the API container"
  echo "  logs:db     - Show logs from the database container"
  echo "  logs:redis  - Show logs from the Redis container"
  echo "  status      - Show status of all containers"
  echo "  backup      - Create a backup of the database (development only)"
  echo "  restore     - Restore a backup of the database (development only)"
  echo "  clean       - Remove all containers and volumes"
  echo "  help        - Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./run.sh dev start    - Start in development mode with hot-reloading"
  echo "  ./run.sh prod start   - Start in production mode"
  echo "  ./run.sh dev backup   - Create a backup in development mode"
  echo "  ./run.sh dev restore  - Restore a backup in development mode"
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
  
  # Create backups directory if it doesn't exist
  mkdir -p backups
  
  # Generate timestamp for backup filename
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  BACKUP_FILE="backups/backup_${TIMESTAMP}.sql"
  
  # Create backup using pg_dump
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
  
  # Restore backup using psql
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

# Main script
case "$ENV" in
  dev)
    check_docker
    check_docker_compose
    
    # Get command (default to start if not specified)
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
      logs)
        echo -e "${YELLOW}Showing logs from all containers...${NC}"
        docker-compose -f docker-compose.dev.yml logs -f
        ;;
      logs:api)
        echo -e "${YELLOW}Showing logs from the API container...${NC}"
        docker-compose -f docker-compose.dev.yml logs -f api
        ;;
      logs:db)
        echo -e "${YELLOW}Showing logs from the database container...${NC}"
        docker-compose -f docker-compose.dev.yml logs -f postgres
        ;;
      logs:redis)
        echo -e "${YELLOW}Showing logs from the Redis container...${NC}"
        docker-compose -f docker-compose.dev.yml logs -f redis
        ;;
      status)
        echo -e "${YELLOW}Container status:${NC}"
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
          echo -e "${YELLOW}Removing all containers and volumes...${NC}"
          docker-compose -f docker-compose.dev.yml down -v
        else
          echo -e "${YELLOW}Removing all containers...${NC}"
          docker-compose -f docker-compose.dev.yml down
        fi
        echo -e "${GREEN}Cleanup completed successfully!${NC}"
        ;;
      help|*)
        show_help
        ;;
    esac
    ;;
  prod)
    check_docker
    check_docker_compose
    
    # Get command (default to start if not specified)
    CMD=${2:-start}
    
    case "$CMD" in
      start)
        # Create a backup before switching to production
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
        echo -e "${YELLOW}Stopping Healthcare Backend...${NC}"
        docker-compose down
        echo -e "${GREEN}Environment stopped successfully!${NC}"
        ;;
      restart)
        echo -e "${YELLOW}Restarting Healthcare Backend...${NC}"
        docker-compose restart
        echo -e "${GREEN}Environment restarted successfully!${NC}"
        ;;
      logs)
        echo -e "${YELLOW}Showing logs from all containers...${NC}"
        docker-compose logs -f
        ;;
      logs:api)
        echo -e "${YELLOW}Showing logs from the API container...${NC}"
        docker-compose logs -f api
        ;;
      logs:db)
        echo -e "${YELLOW}Showing logs from the database container...${NC}"
        docker-compose logs -f postgres
        ;;
      logs:redis)
        echo -e "${YELLOW}Showing logs from the Redis container...${NC}"
        docker-compose logs -f redis
        ;;
      status)
        echo -e "${YELLOW}Container status:${NC}"
        docker-compose ps
        ;;
      backup)
        echo -e "${RED}Backup functionality is not available in production mode.${NC}"
        echo -e "${YELLOW}Please use development mode for backups.${NC}"
        ;;
      restore)
        echo -e "${RED}Restore functionality is not available in production mode.${NC}"
        echo -e "${YELLOW}Please use development mode for restores.${NC}"
        ;;
      clean)
        if [ "$3" == "--volumes" ]; then
          echo -e "${YELLOW}Removing all containers and volumes...${NC}"
          docker-compose down -v
        else
          echo -e "${YELLOW}Removing all containers...${NC}"
          docker-compose down
        fi
        echo -e "${GREEN}Cleanup completed successfully!${NC}"
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