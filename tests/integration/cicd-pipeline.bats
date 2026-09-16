# Integration Test Suite — CI/CD Pipeline
# ----------------------------------------------------------------------------
# Validates the multi-environment CI/CD pipeline using bats.
#
# Usage:
#   bats tests/integration/cicd-pipeline.bats
#   bats tests/integration/cicd-pipeline.bats --filter-tags "docker"
#
# Requires: bats, curl, jq, docker (for local compose tests)
# ----------------------------------------------------------------------------

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
setup() {
    export TEST_TMPDIR="${BATS_TEST_TMPDIR:-/tmp/bats-cicd-$$}"
    mkdir -p "$TEST_TMPDIR"
}

teardown() {
    rm -rf "$TEST_TMPDIR" 2>/dev/null || true
}

# ----------------------------------------------------------------------------
# Docker Compose tests (local)
# ----------------------------------------------------------------------------
@test "docker-compose.prod.yml is valid" {
    run docker compose -f devops/docker/docker-compose.prod.yml config --quiet 2>&1
    [ "$status" -eq 0 ]
    [[ "$output" != *"services have both an image and build"* ]]
}

@test "docker-compose.preprod.yml is valid" {
    run docker compose -f devops/docker/docker-compose.preprod.yml config --quiet 2>&1
    [ "$status" -eq 0 ]
    [[ "$output" != *"services have both an image and build"* ]]
}

@test "both compose files reference valid images" {
    run bash -c 'grep -E "^\s+image:" devops/docker/docker-compose.prod.yml devops/docker/docker-compose.preprod.yml'
    [ "$status" -eq 0 ]
    [[ "$output" == *"healthcare-api"* ]]
}

# ----------------------------------------------------------------------------
# Nginx configuration tests
# ----------------------------------------------------------------------------
@test "nginx.conf has expected upstream block" {
    [ -f devops/docker/nginx/nginx.conf ]
    run grep -q "upstream backend" devops/docker/nginx/nginx.conf
    [ "$status" -eq 0 ]
}

@test "nginx.preprod.conf has expected upstream block" {
    [ -f devops/docker/nginx/nginx.preprod.conf ]
    run grep -q "upstream backend" devops/docker/nginx/nginx.preprod.conf
    [ "$status" -eq 0 ]
}

@test "nginx.conf includes expected subdomain location blocks" {
    run grep -q "server_name api.ishswami.in" devops/docker/nginx/nginx.conf
    [ "$status" -eq 0 ]
}

@test "nginx.preprod.conf includes preprod subdomain" {
    run grep -q "server_name api-preprod.ishswami.in" devops/docker/nginx/nginx.preprod.conf
    [ "$status" -eq 0 ]
}

# ----------------------------------------------------------------------------
# GitHub Actions workflow tests
# ----------------------------------------------------------------------------
@test "ci.yml workflow exists and is parseable YAML" {
    [ -f .github/workflows/ci.yml ]
    run python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
    [ "$status" -eq 0 ]
}

@test "ci.yml has validate-pr job" {
    run grep -q "validate-pr:" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

@test "ci.yml has deploy job with environment-aware conditions" {
    run grep -q "environment:" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
    run grep -q "github.ref == 'refs/heads/main' && 'production' || 'preprod'" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

@test "ci.yml has blue-green deploy via SSH" {
    run grep -q "blue-green-deploy.sh" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

@test "ci.yml has Portainer sync as non-blocking" {
    run grep -q "portainer-sync" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
    # Verify continue-on-error
    run grep -A 5 "portainer-sync:" .github/workflows/ci.yml | grep -q "continue-on-error: true"
    [ "$status" -eq 0 ]
}

@test "ci.yml has prisma-migrate job before deploy" {
    run grep -q "prisma-migrate" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

@test "ci.yml has post-deployment-verification job" {
    run grep -q "post-deployment-verification:" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

@test "ci.yml has success-backup job for production" {
    run grep -q "success-backup:" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

@test "ci.yml uses GitHub Environments for secret scoping" {
    run grep -q "environment:" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
    run grep -q "'production'" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
    run grep -q "'preprod'" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

# ----------------------------------------------------------------------------
# Deploy script tests
# ----------------------------------------------------------------------------
@test "deploy.sh supports --env parameter" {
    [ -f devops/scripts/docker-infra/deploy.sh ]
    run bash -c 'grep -q "\-\-env" devops/scripts/docker-infra/deploy.sh'
    [ "$status" -eq 0 ]
}

@test "deploy.sh auto-configures for production" {
    run bash -c 'source devops/scripts/docker-infra/deploy.sh --env production 2>&1 && [[ "${CONTAINER_PREFIX}" == "latest-" ]] && [[ "${COMPOSE_FILE}" == "docker-compose.prod.yml" ]]'
    [ "$status" -eq 0 ]
}

@test "deploy.sh auto-configures for preprod" {
    run bash -c 'source devops/scripts/docker-infra/deploy.sh --env preprod 2>&1 && [[ "${CONTAINER_PREFIX}" == "preprod-" ]] && [[ "${COMPOSE_FILE}" == "docker-compose.preprod.yml" ]]'
    [ "$status" -eq 0 ]
}

@test "blue-green-deploy.sh is executable and valid bash" {
    [ -f devops/scripts/docker-infra/blue-green-deploy.sh ]
    run bash -n devops/scripts/docker-infra/blue-green-deploy.sh
    [ "$status" -eq 0 ]
}

@test "validate-resources.sh is executable and valid bash" {
    [ -f devops/scripts/docker-infra/validate-resources.sh ]
    run bash -n devops/scripts/docker-infra/validate-resources.sh
    [ "$status" -eq 0 ]
}

@test "network-isolation-verify.sh is executable and valid bash" {
    [ -f devops/scripts/docker-infra/network-isolation-verify.sh ]
    run bash -n devops/scripts/docker-infra/network-isolation-verify.sh
    [ "$status" -eq 0 ]
}

@test "portainer-sync.sh is executable and valid bash" {
    [ -f devops/scripts/docker-infra/portainer-sync.sh ]
    run bash -n devops/scripts/docker-infra/portainer-sync.sh
    [ "$status" -eq 0 ]
}

# ----------------------------------------------------------------------------
# Environment configuration tests
# ----------------------------------------------------------------------------
@test "ci.yml has distinct container prefixes for each environment" {
    run grep -q "latest-" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
    run grep -q "preprod-" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

@test "ci.yml has distinct Docker networks for each environment" {
    run grep -q "app-network" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
    run grep -q "preprod-network" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

@test "ci.yml has distinct subdomains for each environment" {
    run grep -q "api.ishswami.in" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
    run grep -q "api-preprod.ishswami.in" .github/workflows/ci.yml
    [ "$status" -eq 0 ]
}

# ----------------------------------------------------------------------------
# Blue-green deploy script tests
# ----------------------------------------------------------------------------
@test "blue-green-deploy.sh detects active color from upstream.conf" {
    run bash -c 'grep -q "detect_active_color" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
}

@test "blue-green-deploy.sh starts inactive color container" {
    run bash -c 'grep -q "INACTIVE_COLOR" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
}

@test "blue-green-deploy.sh polls /infra-health endpoint" {
    run bash -c 'grep -q "infra-health" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
}

@test "blue-green-deploy.sh writes upstream.conf" {
    run bash -c 'grep -q "upstream.conf" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
}

@test "blue-green-deploy.sh reloads Nginx" {
    run bash -c 'grep -q "reload" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
}

@test "blue-green-deploy.sh drains old container" {
    run bash -c 'grep -q "drain" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
}

@test "blue-green-deploy.sh rolls back on failure" {
    run bash -c 'grep -q "rollback\|revert\|ORIGINAL_UPSTREAM" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
}

@test "blue-green-deploy.sh accepts required parameters" {
    run bash -c 'grep -q "container-prefix" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
    run bash -c 'grep -q "service" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
    run bash -c 'grep -q "image" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
    run bash -c 'grep -q "network" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
    run bash -c 'grep -q "upstream-conf" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
    run bash -c 'grep -q "nginx-container" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
    run bash -c 'grep -q "health-timeout" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
    run bash -c 'grep -q "drain-timeout" devops/scripts/docker-infra/blue-green-deploy.sh'
    [ "$status" -eq 0 ]
}

# ----------------------------------------------------------------------------
# Network isolation tests
# ----------------------------------------------------------------------------
@test "network-isolation-verify.sh has --env parameter" {
    run bash -c 'grep -q "\-\-env" devops/scripts/docker-infra/network-isolation-verify.sh'
    [ "$status" -eq 0 ]
}

@test "network-isolation-verify.sh uses distinct networks" {
    run bash -c 'grep -q "app-network" devops/scripts/docker-infra/network-isolation-verify.sh'
    [ "$status" -eq 0 ]
    run bash -c 'grep -q "preprod-network" devops/scripts/docker-infra/network-isolation-verify.sh'
    [ "$status" -eq 0 ]
}
