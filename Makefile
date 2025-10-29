.PHONY: help install build start stop restart clean logs test lint format prisma docker-up docker-down docker-clean dev prod

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

## help: Show this help message
help:
	@echo "$(BLUE)Healthcare Backend - Development Commands$(NC)"
	@echo ""
	@echo "$(GREEN)Available commands:$(NC)"
	@sed -n 's/^##//p' ${MAKEFILE_LIST} | column -t -s ':' |  sed -e 's/^/ /'

## install: Install dependencies with pnpm
install:
	@echo "$(BLUE)Installing dependencies...$(NC)"
	pnpm install

## build: Build the application
build:
	@echo "$(BLUE)Building application...$(NC)"
	pnpm build

## dev: Start development server
dev:
	@echo "$(BLUE)Starting development server...$(NC)"
	pnpm start:dev

## prod: Start production server
prod:
	@echo "$(BLUE)Starting production server...$(NC)"
	pnpm start:prod

## start: Start all services with Docker Compose
start:
	@echo "$(BLUE)Starting Docker services...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)✓ Services started$(NC)"
	@echo "$(YELLOW)API:            http://localhost:8088$(NC)"
	@echo "$(YELLOW)Prisma Studio:  http://localhost:5555$(NC)"
	@echo "$(YELLOW)PgAdmin:        http://localhost:5050 (admin@admin.com / admin)$(NC)"
	@echo "$(YELLOW)Redis Commander: http://localhost:8082 (admin / admin)$(NC)"

## stop: Stop all Docker services
stop:
	@echo "$(BLUE)Stopping Docker services...$(NC)"
	docker-compose down
	@echo "$(GREEN)✓ Services stopped$(NC)"

## restart: Restart all Docker services
restart: stop start

## clean: Clean Docker volumes and containers
clean:
	@echo "$(RED)Cleaning Docker resources...$(NC)"
	docker-compose down -v
	docker system prune -f
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

## logs: Show Docker logs
logs:
	docker-compose logs -f

## logs-api: Show API logs only
logs-api:
	docker-compose logs -f api

## test: Run tests
test:
	@echo "$(BLUE)Running tests...$(NC)"
	pnpm test

## lint: Run linter
lint:
	@echo "$(BLUE)Running linter...$(NC)"
	pnpm lint

## format: Format code
format:
	@echo "$(BLUE)Formatting code...$(NC)"
	pnpm format

## prisma-generate: Generate Prisma client
prisma-generate:
	@echo "$(BLUE)Generating Prisma client...$(NC)"
	pnpm prisma:generate

## prisma-studio: Open Prisma Studio
prisma-studio:
	@echo "$(BLUE)Opening Prisma Studio...$(NC)"
	pnpm prisma:studio

## prisma-migrate: Run Prisma migrations
prisma-migrate:
	@echo "$(BLUE)Running Prisma migrations...$(NC)"
	pnpm prisma:migrate

## prisma-reset: Reset Prisma database
prisma-reset:
	@echo "$(RED)Resetting Prisma database...$(NC)"
	pnpm prisma:reset

## docker-up: Start Docker services (detached)
docker-up:
	docker-compose up -d

## docker-down: Stop and remove Docker containers
docker-down:
	docker-compose down

## docker-clean: Clean all Docker resources
docker-clean:
	docker-compose down -v --remove-orphans
	docker system prune -af --volumes

## docker-build: Rebuild Docker images
docker-build:
	docker-compose build --no-cache

## health: Check health of all services
health:
	@echo "$(BLUE)Checking service health...$(NC)"
	@curl -s http://localhost:8088/health | jq . || echo "$(RED)API not responding$(NC)"
	@docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

## db-backup: Backup database
db-backup:
	@echo "$(BLUE)Creating database backup...$(NC)"
	docker exec healthcare-postgres pg_dump -U postgres userdb > backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo "$(GREEN)✓ Backup created$(NC)"

## db-restore: Restore database from latest backup
db-restore:
	@echo "$(RED)Restoring database from backup...$(NC)"
	@echo "Available backups:"
	@ls -lh backup_*.sql
	@read -p "Enter backup filename: " backup; \
	docker exec -i healthcare-postgres psql -U postgres userdb < $$backup
	@echo "$(GREEN)✓ Database restored$(NC)"

## setup: Initial project setup
setup: install prisma-generate
	@echo "$(GREEN)✓ Project setup complete!$(NC)"
	@echo "$(YELLOW)Run 'make start' to start the application$(NC)"

## ci: Run CI checks
ci: lint test build
	@echo "$(GREEN)✓ All CI checks passed$(NC)"

## deploy-dev: Deploy to development environment
deploy-dev:
	@echo "$(BLUE)Deploying to development...$(NC)"
	cd devops/docker && docker-compose -f docker-compose.dev.yml up -d --build

## deploy-prod: Deploy to production environment
deploy-prod:
	@echo "$(BLUE)Deploying to production...$(NC)"
	cd devops/docker && docker-compose -f docker-compose.prod.yml up -d --build

## status: Show status of all services
status:
	@echo "$(BLUE)Service Status:$(NC)"
	@docker-compose ps

## shell-api: Open shell in API container
shell-api:
	docker-compose exec api sh

## shell-db: Open PostgreSQL shell
shell-db:
	docker-compose exec postgres psql -U postgres -d userdb

## shell-redis: Open Redis CLI
shell-redis:
	docker-compose exec redis redis-cli

## k8s-local-start: Start local Kubernetes cluster
k8s-local-start:
	@echo "$(BLUE)Starting local Kubernetes...$(NC)"
	@command -v minikube >/dev/null 2>&1 && minikube start --cpus=4 --memory=8192 || \
	 echo "$(YELLOW)Using Docker Desktop Kubernetes (already running)$(NC)"

## k8s-local-build: Build and load local image
k8s-local-build:
	@echo "$(BLUE)Building local Kubernetes image...$(NC)"
	@command -v nerdctl >/dev/null 2>&1 && \
	  nerdctl build -t healthcare-api:local -f devops/docker/Dockerfile . || \
	  docker build -t healthcare-api:local -f devops/docker/Dockerfile .
	@echo "$(GREEN)✓ Image built successfully$(NC)"

## k8s-local-deploy: Deploy to local Kubernetes
k8s-local-deploy:
	@echo "$(BLUE)Deploying to local Kubernetes...$(NC)"
	kubectl apply -f devops/kubernetes/base/namespace.yaml
	@kubectl get secret healthcare-secrets -n healthcare-backend >/dev/null 2>&1 || \
	 kubectl create secret generic healthcare-secrets \
	  --from-literal=database-url='postgresql://postgres:postgres@postgres:5432/userdb' \
	  --from-literal=jwt-secret='local-dev-secret-key-change-in-production' \
	  --from-literal=postgres-user='postgres' \
	  --from-literal=postgres-password='postgres' \
	  --namespace=healthcare-backend
	kubectl apply -k devops/kubernetes/overlays/local/
	@echo "$(GREEN)✓ Deployed to local Kubernetes$(NC)"
	@echo "$(YELLOW)Waiting for pods to be ready...$(NC)"
	kubectl wait --for=condition=ready pod -l app=healthcare-api -n healthcare-backend --timeout=300s
	@echo "$(GREEN)✓ All pods ready!$(NC)"
	@echo "$(YELLOW)Run 'make k8s-local-access' to access services$(NC)"

## k8s-local-access: Port forward services for local access
k8s-local-access:
	@echo "$(BLUE)Port forwarding services...$(NC)"
	@echo "$(YELLOW)API will be available at: http://localhost:8088$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to stop$(NC)"
	kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088

## k8s-prod-deploy: Deploy to production overlay
k8s-prod-deploy:
	@echo "$(BLUE)Deploying to Kubernetes (production overlay)...$(NC)"
	kubectl apply -k devops/kubernetes/overlays/production/

## k8s-set-image: Set image for deployments in production namespace
# Usage: make k8s-set-image IMAGE=ghcr.io/owner/healthcare-api:TAG
k8s-set-image:
	@if [ -z "$(IMAGE)" ]; then echo "$(RED)IMAGE is required (e.g., IMAGE=ghcr.io/org/healthcare-api:tag)$(NC)"; exit 1; fi
	kubectl -n healthcare-backend set image deployment/healthcare-api api=$(IMAGE)
	- kubectl -n healthcare-backend set image deployment/healthcare-worker worker=$(IMAGE)

## k8s-rollout-status: Wait for rollout of API and Worker
k8s-rollout-status:
	kubectl rollout status deploy/healthcare-api -n healthcare-backend --timeout=300s
	- kubectl rollout status deploy/healthcare-worker -n healthcare-backend --timeout=300s

## k8s-local-status: Check local Kubernetes status
k8s-local-status:
	@echo "$(BLUE)Local Kubernetes Status:$(NC)"
	kubectl get all -n healthcare-backend
	@echo ""
	@echo "$(BLUE)HPA Status:$(NC)"
	kubectl get hpa -n healthcare-backend 2>/dev/null || echo "HPA not available"
	@echo ""
	@echo "$(BLUE)Resource Usage:$(NC)"
	kubectl top pods -n healthcare-backend 2>/dev/null || echo "Metrics server not available (run: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml)"

## k8s-local-logs: View API logs
k8s-local-logs:
	kubectl logs -f -l app=healthcare-api -n healthcare-backend

## k8s-secrets-validate: Validate required secrets and keys
k8s-secrets-validate:
	@bash devops/kubernetes/scripts/validate-secrets.sh

## k8s-secrets-apply: Apply healthcare and WAL-G secrets from env vars
# Required env: DB_URL, DB_MIGRATION_URL, POSTGRES_USER, POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET
# And: WALG_S3_PREFIX, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, WALG_S3_ENDPOINT
k8s-secrets-apply:
	@bash devops/kubernetes/scripts/apply-healthcare-secrets.sh
	@bash devops/kubernetes/scripts/apply-walg-secrets.sh

## k8s-walg-backup: Trigger immediate WAL-G base backup and prune
k8s-walg-backup:
	@bash devops/kubernetes/scripts/trigger-walg-backup.sh

## k8s-local-shell: Shell into API pod
k8s-local-shell:
	kubectl exec -it deployment/healthcare-api -n healthcare-backend -- /bin/sh

## k8s-local-stop: Stop and cleanup local Kubernetes
k8s-local-stop:
	@echo "$(RED)Cleaning up local Kubernetes...$(NC)"
	kubectl delete namespace healthcare-backend --ignore-not-found=true
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

## k8s-local-restart: Restart deployment
k8s-local-restart:
	@echo "$(BLUE)Restarting API deployment...$(NC)"
	kubectl rollout restart deployment/healthcare-api -n healthcare-backend
	kubectl rollout status deployment/healthcare-api -n healthcare-backend
	@echo "$(GREEN)✓ Deployment restarted$(NC)"

## k8s-kind-create: Create kind cluster for local K8s
k8s-kind-create:
	@echo "$(BLUE)Creating kind cluster...$(NC)"
	kind create cluster --name healthcare-local --config devops/kubernetes/kind-config.yaml
	@echo "$(GREEN)✓ Kind cluster created$(NC)"
	kubectl cluster-info --context kind-healthcare-local

## k8s-kind-delete: Delete kind cluster
k8s-kind-delete:
	@echo "$(RED)Deleting kind cluster...$(NC)"
	kind delete cluster --name healthcare-local
	@echo "$(GREEN)✓ Kind cluster deleted$(NC)"
