#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/var/www/healthcare"
DEPLOYMENTS_DIR="$APP_DIR/deployments"
CURRENT_FILE="$APP_DIR/current_deployment"
MAX_DEPLOYMENTS=5

# Function to display usage
show_usage() {
    echo -e "${BLUE}Healthcare Backend Management Script${NC}"
    echo "Usage: ./manage.sh [environment] [command] [options]"
    echo ""
    echo "Environments:"
    echo "  dev    - Development environment"
    echo "  prod   - Production environment"
    echo ""
    echo "Commands:"
    echo "  up      - Start services"
    echo "  down    - Stop services"
    echo "  restart - Restart services"
    echo "  logs    - Show logs"
    echo "  rebuild - Rebuild and restart services"
    echo "  rollback- Rollback to previous deployment"
    echo "  backup  - Create database backup"
    echo "  restore - Restore database from backup"
    echo "  status  - Show service status"
    echo "  studio  - Start Prisma Studio (dev only)"
    echo ""
    echo "Options:"
    echo "  --force   - Force the operation"
    echo "  --volumes - Include volumes in operation"
    exit 1
}

# Function to check prerequisites
check_prerequisites() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        echo -e "${RED}Error: Docker daemon is not running${NC}"
        exit 1
    fi
}

# Function to handle database operations
handle_database() {
    local operation=$1
    local env_file=$2

    case $operation in
        "backup")
            echo -e "${YELLOW}Creating database backup...${NC}"
            timestamp=$(date +"%Y%m%d_%H%M%S")
            backup_file="backups/db_backup_${timestamp}.sql"
            mkdir -p backups
            docker compose -f docker-compose.${ENV}.yml exec -T postgres pg_dump -U postgres userdb > $backup_file
            echo -e "${GREEN}Backup created: ${backup_file}${NC}"
            ;;
        "restore")
            if [ -z "$3" ]; then
                echo -e "${RED}Error: No backup file specified${NC}"
                exit 1
            fi
            echo -e "${YELLOW}Restoring database from $3...${NC}"
            docker compose -f docker-compose.${ENV}.yml exec -T postgres psql -U postgres -d userdb < $3
            echo -e "${GREEN}Database restored successfully${NC}"
            ;;
    esac
}

# Function to handle service operations
handle_services() {
    local operation=$1
    local compose_file="docker-compose.${ENV}.yml"
    local env_file=".env.${ENV}"

    case $operation in
        "up")
            echo -e "${YELLOW}Starting services in ${ENV} mode...${NC}"
            docker compose -f $compose_file up -d
            ;;
        "down")
            echo -e "${YELLOW}Stopping services...${NC}"
            docker compose -f $compose_file down
            ;;
        "restart")
            echo -e "${YELLOW}Restarting services...${NC}"
            docker compose -f $compose_file restart
            ;;
        "rebuild")
            echo -e "${YELLOW}Rebuilding services...${NC}"
            docker compose -f $compose_file down
            docker compose -f $compose_file build
            docker compose -f $compose_file up -d
            ;;
        "logs")
            docker compose -f $compose_file logs -f
            ;;
        "status")
            docker compose -f $compose_file ps
            ;;
    esac
}

# Function to handle rollback
handle_rollback() {
    if [ "$ENV" != "prod" ]; then
        echo -e "${RED}Rollback is only available in production environment${NC}"
        exit 1
    }

    echo -e "${YELLOW}Starting rollback procedure...${NC}"
    
    # Get current deployment
    if [ ! -f "$CURRENT_FILE" ]; then
        echo -e "${RED}No current deployment file found${NC}"
        exit 1
    }

    current_deployment=$(cat "$CURRENT_FILE")
    previous_deployment=$(ls -1t "$DEPLOYMENTS_DIR" | grep -v "$current_deployment" | head -1)

    if [ -z "$previous_deployment" ]; then
        echo -e "${RED}No previous deployment found${NC}"
        exit 1
    }

    echo -e "${YELLOW}Rolling back from $current_deployment to $previous_deployment${NC}"

    # Stop current services
    docker compose -f docker-compose.prod.yml down

    # Switch to previous deployment
    ln -sf "$DEPLOYMENTS_DIR/$previous_deployment" "$APP_DIR/current"
    echo "$previous_deployment" > "$CURRENT_FILE"

    # Start previous deployment
    cd "$APP_DIR/current"
    docker compose -f docker-compose.prod.yml up -d

    echo -e "${GREEN}Rollback completed successfully${NC}"
}

# Parse arguments
if [ "$#" -lt 2 ]; then
    show_usage
fi

ENV=$1
COMMAND=$2
shift 2
OPTIONS=$@

# Validate environment
case $ENV in
    "dev"|"development")
        ENV="dev"
        ;;
    "prod"|"production")
        ENV="prod"
        ;;
    *)
        echo -e "${RED}Invalid environment: $ENV${NC}"
        show_usage
        ;;
esac

# Check prerequisites
check_prerequisites

# Execute command
case $COMMAND in
    "up"|"down"|"restart"|"rebuild"|"logs"|"status")
        handle_services $COMMAND
        ;;
    "backup"|"restore")
        handle_database $COMMAND $3
        ;;
    "rollback")
        handle_rollback
        ;;
    "studio")
        if [ "$ENV" = "prod" ]; then
            echo -e "${RED}Prisma Studio is not available in production${NC}"
            exit 1
        fi
        docker compose -f docker-compose.dev.yml exec api npx prisma studio
        ;;
    *)
        echo -e "${RED}Invalid command: $COMMAND${NC}"
        show_usage
        ;;
esac 