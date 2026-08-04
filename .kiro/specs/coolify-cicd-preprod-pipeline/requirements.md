# Requirements Document

## Introduction

This specification defines the CI/CD pipeline for a `preprod` (pre-production/staging) environment for the Healthcare Backend application. The system already has a production pipeline deploying from the `main` branch using GitHub Actions, Coolify (Traefik SSL), Nginx blue-green routing, and Docker Compose on a Contabo VPS. This spec adds an isolated preprod environment with its own blue-green deployment, triggered by the `preprod` branch, enabling a `develop → preprod → main` promotion flow.

## Glossary

- **Pipeline**: The GitHub Actions CI/CD workflow that builds, tests, and deploys the application
- **Preprod_Environment**: An isolated staging environment on the same Contabo VPS, running separate containers with distinct ports and env files from production
- **Blue_Green_Deploy**: A deployment strategy where a new container (green) starts alongside the current (blue), passes health checks, then traffic is switched via Nginx upstream rewrite with zero dropped connections
- **Promotion_Workflow**: The controlled process of moving a validated preprod image to production by merging preprod into mainon
- **Nginx_Router**: The Nginx reverse proxy that handles zero-downtime traffic switching via upstream.conf hot-swap
- **Coolify**: The self-hosted PaaS that manages Traefik for SSL/HTTPS termination and routes external traffic to internal Nginx routers
- **GHCR**: GitHub Container Registry where Docker images are published
- **Contabo_VPS**: The single Virtual Private Server hosting both production and preprod environments
- **Health_Gate**: The deployment gate that validates infrastructure and application health before switching traffic
- **Upstream_Conf**: The Nginx configuration file that defines which backend container receives traffic, hot-swapped during blue-green deploys

## Requirements

### Requirement 1: Preprod Branch Trigger

**User Story:** As a developer, I want pushes to the `preprod` branch to trigger a separate CI/CD pipeline, so that I can validate changes in a staging environment before promoting to production.

#### Acceptance Criteria

1. WHEN a push event occurs on the `preprod` branch, THE Pipeline SHALL execute the lint, type-check, security scan, Docker image build, and deploy-to-staging steps in sequence
2. WHEN a pull request targets the `preprod` branch, THE Pipeline SHALL execute lint, type-check, security scan, and build validation steps without deploying, and SHALL report a failing check status if any step fails
3. THE Pipeline SHALL use the same Dockerfile (devops/docker/Dockerfile) and GHCR registry as production to build the Docker image for preprod
4. WHEN a push event occurs on the `preprod` branch, THE Pipeline SHALL tag the Docker image with `preprod-<7-character-short-sha>` and `preprod-latest`, pushing both tags to the GHCR registry
5. WHEN a push event occurs on the `preprod` branch, THE Pipeline SHALL NOT execute production deployment jobs, production infrastructure health checks, or production recovery workflows

### Requirement 2: Environment Isolation

**User Story:** As a DevOps engineer, I want the preprod environment to be fully isolated from production on the same server, so that preprod deployments cannot interfere with live traffic.

#### Acceptance Criteria

1. THE Preprod_Environment SHALL use separate Docker containers with a `preprod-` prefix (preprod-api, preprod-worker, preprod-nginx)
2. THE Preprod_Environment SHALL use a separate Docker network (`preprod-network`, subnet 172.19.0.0/16) from production (`app-network`, subnet 172.18.0.0/16) with no inter-network connectivity between the two networks
3. THE Preprod_Environment SHALL use a separate environment file (`.env.preprod`) for all application configuration, including distinct values for DATABASE_URL, DRAGONFLY_KEY_PREFIX, JWT_SECRET, and SESSION_SECRET
4. THE Preprod_Environment SHALL expose the Nginx router on port 8089 (distinct from production port 8088)
5. THE Preprod_Environment SHALL use a separate PostgreSQL database (`preprod_userdb`) within the shared PostgreSQL instance, accessed via dedicated database credentials distinct from production credentials
6. THE Preprod_Environment SHALL use a separate DragonflyDB key prefix (`healthcare-preprod:`) to isolate cache data from production (`healthcare:`)
7. THE Preprod_Environment SHALL use a separate BullMQ queue prefix (`bull-preprod:`) to prevent job processing interference with production workers (`bull:`)
8. THE Preprod_Environment SHALL enforce container resource limits (CPU and memory) that cap preprod total resource usage to no more than 50% of available server resources, ensuring production containers are not starved of CPU or memory
9. IF a preprod container is configured with a network, database name, key prefix, or queue prefix that matches a production value, THEN THE Pipeline SHALL reject the deployment and report a configuration isolation violation error

### Requirement 3: Blue-Green Deployment for Preprod

**User Story:** As a developer, I want zero-downtime blue-green deployments on the preprod environment, so that I can test deployment procedures before applying them to production.

#### Acceptance Criteria

1. WHEN a preprod deployment is triggered, THE Pipeline SHALL start a new container (`preprod-api-next`) alongside the current preprod API container within 120 seconds
2. WHEN `preprod-api-next` returns an HTTP 200 response to a GET request on the `/infra-health` endpoint, THE Nginx_Router SHALL rewrite the preprod upstream.conf to route all preprod traffic to the new container
3. WHEN the upstream.conf is rewritten, THE Nginx_Router SHALL reload configuration using a graceful reload signal that completes in-flight requests on existing connections before switching
4. WHEN traffic is switched to the new container, THE Pipeline SHALL stop and remove the old preprod API container after a 30-second drain period
5. IF the new preprod API container does not return an HTTP 200 response on `/infra-health` within 120 seconds of starting, THEN THE Pipeline SHALL remove the failed container, retain the current running container unchanged, and report the failure in the pipeline summary
6. WHEN the preprod API blue-green switch completes successfully, THE Pipeline SHALL deploy a new preprod worker container (`preprod-worker-next`) using the same image, verify it passes its health check command within 120 seconds, wait a 30-second warm standby period, and then stop and remove the old preprod worker container with a 120-second graceful shutdown period for in-flight job completion
7. IF the new preprod worker container fails its health check within 120 seconds of starting, THEN THE Pipeline SHALL remove the failed worker container and retain the current running worker container unchanged

### Requirement 4: Coolify Integration for Preprod

**User Story:** As a DevOps engineer, I want Coolify to manage SSL termination and routing for the preprod domain, so that the preprod environment is accessible over HTTPS with proper certificates.

#### Acceptance Criteria

1. THE Coolify SHALL configure Traefik to route the preprod subdomain (`preprod-backend.ishswami.in`) to the preprod Nginx router on port 8089, accepting traffic on both HTTP and HTTPS entrypoints and redirecting HTTP requests to HTTPS
2. THE Coolify SHALL provision and auto-renew TLS certificates for the preprod subdomain such that the certificate is renewed before expiry and HTTPS remains continuously available without manual intervention
3. THE Preprod_Environment SHALL include the following Traefik labels on the preprod-nginx container: `traefik.enable=true`, a Host rule matching `preprod-backend.ishswami.in`, a unique router name distinct from production (e.g., `preprod-healthcare-api`), TLS enabled, load balancer server port set to 8089, and `traefik.docker.network=coolify`
4. THE Preprod_Environment SHALL connect the preprod-nginx container to the `coolify` external Docker network for Traefik visibility
5. IF TLS certificate provisioning or renewal fails for the preprod subdomain, THEN THE Coolify SHALL continue serving traffic using the existing valid certificate and surface a certificate error status visible in the Coolify dashboard

### Requirement 5: Preprod Docker Compose Configuration

**User Story:** As a DevOps engineer, I want a dedicated Docker Compose file for the preprod environment, so that infrastructure-as-code clearly defines the preprod topology.

#### Acceptance Criteria

1. THE Preprod_Environment SHALL have a dedicated `docker-compose.preprod.yml` file defining all preprod services (preprod-api, preprod-worker, preprod-nginx)
2. THE `docker-compose.preprod.yml` SHALL reference the shared PostgreSQL and DragonflyDB containers from the production compose network via an external network declaration
3. THE `docker-compose.preprod.yml` SHALL assign static IP addresses within the preprod network (preprod-nginx: 172.19.0.7, preprod-api: 172.19.0.5, preprod-worker: 172.19.0.6)
4. THE `docker-compose.preprod.yml` SHALL use the `preprod-latest` image tag as default, overridable via `DOCKER_IMAGE` environment variable
5. THE Preprod_Environment SHALL have a dedicated Nginx configuration file and upstream.conf at `/opt/healthcare-backend/preprod/nginx/`
6. THE `docker-compose.preprod.yml` SHALL define resource limits for all preprod services consistent with the isolation constraints in Requirement 2

### Requirement 6: Infrastructure Health Gate for Preprod

**User Story:** As a developer, I want the preprod pipeline to verify infrastructure health before deploying, so that deployments only proceed when the environment is ready.

#### Acceptance Criteria

1. WHEN the preprod deployment workflow starts, THE Pipeline SHALL verify that PostgreSQL is healthy by confirming the container is running and `pg_isready` returns success for the preprod database within 60 seconds, retrying every 2 seconds
2. WHEN the preprod deployment workflow starts, THE Pipeline SHALL verify that DragonflyDB is healthy by confirming the container is running and a PING command on port 6379 returns a successful response within 40 seconds, retrying every 2 seconds
3. IF any infrastructure health check fails after exhausting all retries, THEN THE Pipeline SHALL log an error message indicating which service (PostgreSQL or DragonflyDB) failed and its last observed status, and abort the deployment with a non-zero exit code
4. WHEN all infrastructure health checks pass, THE Pipeline SHALL run Prisma migrations against the preprod database within 5 minutes before starting the new application container
5. IF a Prisma migration fails, THEN THE Pipeline SHALL abort the deployment and log an error message indicating the migration failure, without starting the new application container

### Requirement 7: Promotion Workflow from Preprod to Production

**User Story:** As a team lead, I want a controlled promotion flow from preprod to production, so that only validated changes reach production.

#### Acceptance Criteria

1. WHEN a merge from `preprod` to `main` occurs, THE Pipeline SHALL deploy to production using the Docker image tagged `preprod-<commit-sha>` from GHCR, where `<commit-sha>` is the HEAD commit of the `preprod` branch at merge time, without rebuilding the image
2. WHEN the production deployment workflow runs, THE Pipeline SHALL include a GitHub Actions workflow summary showing the image SHA being promoted and the timestamp at which that image was pushed to GHCR from the `preprod` branch
3. THE Promotion_Workflow SHALL support the branch flow `develop → preprod → main` where feature branches merge into develop, develop merges into preprod, and preprod merges into main
4. IF the preprod image SHA does not exist in GHCR, THEN THE Pipeline SHALL fail the production deployment with an error message indicating the expected image tag was not found and that the image must be built and pushed from the `preprod` branch before promotion
5. IF a push or merge to `main` originates from a branch other than `preprod`, THEN THE Pipeline SHALL fail the production deployment with an error message indicating that only merges from `preprod` are permitted for production promotion

### Requirement 8: Preprod Deploy Scripts

**User Story:** As a DevOps engineer, I want reusable deploy scripts for the preprod environment, so that deployment logic is consistent and maintainable across environments.

#### Acceptance Criteria

1. THE Pipeline SHALL use parameterized deploy scripts that accept environment-specific configuration as input arguments: container prefix, Docker network name, host port, and compose file path
2. THE Pipeline SHALL store preprod deployment logs at `/opt/healthcare-backend/preprod/logs/` and retain logs for the most recent 10 deployments, removing older log files automatically
3. WHEN a preprod deployment completes successfully, THE Pipeline SHALL output a GitHub Actions step summary containing the container name and running state, the deployed image SHA digest, and the `/infra-health` endpoint response status
4. IF a preprod deployment fails due to health check timeout (180 seconds) or container exit, THEN THE Pipeline SHALL execute rollback by stopping the failed container and restarting the most recently successful preprod image tag recorded from the prior deployment
5. IF the rollback container does not become healthy within 180 seconds, THEN THE Pipeline SHALL mark the workflow run as failed and annotate it with an error message indicating rollback failure

### Requirement 9: Security and Access Controls

**User Story:** As a security engineer, I want the preprod pipeline to maintain the same security standards as production, so that security issues are caught before reaching production.

#### Acceptance Criteria

1. THE Pipeline SHALL run Trivy vulnerability scanning on the Docker image built for preprod, reporting vulnerabilities of HIGH or CRITICAL severity, before preprod deployment
2. THE Pipeline SHALL run dependency audit checks at moderate severity level or above before preprod deployment
3. IF Trivy scanning detects HIGH or CRITICAL vulnerabilities, or dependency audit detects moderate or higher vulnerabilities, THEN THE Pipeline SHALL fail the preprod deployment and annotate the workflow run with the scan findings
4. THE Preprod_Environment SHALL use a separate GitHub Actions environment (`preprod`) with its own secrets and variables, isolated from the `production` environment secrets
5. THE Pipeline SHALL require SSH key-based authentication for preprod server access, using a dedicated SSH key stored in the `preprod` environment secrets (separate from the production SSH key)
6. THE Preprod_Environment SHALL enforce the same rate limiting rules and security response headers (including Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options) as Production_Environment, configured via the preprod Internal_Nginx instance
