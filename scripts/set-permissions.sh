#!/bin/bash
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Base directories
DEPLOY_PATH="/var/www/healthcare/backend"
NGINX_PATH="${DEPLOY_PATH}/nginx"
SSL_PATH="${NGINX_PATH}/ssl"
CONF_PATH="${NGINX_PATH}/conf.d"

echo -e "${YELLOW}Setting permissions for all files and directories...${NC}"

# Function to set permissions with error handling
set_permission() {
    local path=$1
    local permission=$2
    local owner=${3:-"root:root"}
    
    if [ -e "$path" ]; then
        echo "Setting $permission on $path"
        sudo chmod $permission "$path" || echo -e "${RED}Failed to set permission on $path${NC}"
        sudo chown $owner "$path" || echo -e "${RED}Failed to set owner on $path${NC}"
    fi
}

# Set directory permissions
echo -e "${YELLOW}Setting directory permissions...${NC}"
set_permission "$DEPLOY_PATH" "755"
set_permission "$NGINX_PATH" "755"
set_permission "$SSL_PATH" "700"
set_permission "$CONF_PATH" "755"

# Set Nginx configuration file permissions
echo -e "${YELLOW}Setting Nginx configuration permissions...${NC}"
for conf in "$CONF_PATH"/*.conf; do
    if [ -f "$conf" ]; then
        set_permission "$conf" "644"
    fi
done

# Set SSL file permissions
echo -e "${YELLOW}Setting SSL file permissions...${NC}"
for key in "$SSL_PATH"/*.key; do
    if [ -f "$key" ]; then
        set_permission "$key" "600"
    fi
done

for cert in "$SSL_PATH"/*.{crt,pem,chain.crt}; do
    if [ -f "$cert" ]; then
        set_permission "$cert" "644"
    fi
done

# Set script permissions
echo -e "${YELLOW}Setting script permissions...${NC}"
for script in "$DEPLOY_PATH"/*.sh "$NGINX_PATH"/*.sh; do
    if [ -f "$script" ]; then
        set_permission "$script" "755"
    fi
done

echo -e "${GREEN}All permissions set successfully${NC}" 