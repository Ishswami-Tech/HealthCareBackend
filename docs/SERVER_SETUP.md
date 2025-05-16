# Healthcare API Server Setup Guide

This guide outlines the steps needed to set up and maintain the Healthcare API server in a production environment.

## Server Requirements

- Ubuntu 20.04 LTS or newer
- At least 2GB RAM (4GB recommended)
- 20GB+ disk space
- Docker and Docker Compose installed
- Nginx for reverse proxy
- Valid domain name with DNS configured

## Initial Server Setup

1. **Update System Packages**
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y curl wget git vim htop
   ```

2. **Install Docker**
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   sudo usermod -aG docker $USER
   sudo systemctl enable docker
   sudo systemctl start docker
   ```

3. **Install Docker Compose**
   ```bash
   sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

4. **Install Nginx**
   ```bash
   sudo apt install -y nginx
   sudo systemctl enable nginx
   sudo systemctl start nginx
   ```

5. **Install Certbot for SSL**
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   ```

6. **Create Application Directories**
   ```bash
   sudo mkdir -p /var/www/healthcare/backend/{current,releases,backups,logs}
   sudo chown -R $USER:$USER /var/www/healthcare
   ```

7. **Set Up Docker Network**
   ```bash
   docker network create app-network --subnet=172.18.0.0/16
   ```

## Scheduled Maintenance Tasks

Add the following cron jobs to automate maintenance tasks:

```bash
sudo crontab -e
```

Add these lines:

```
# Run server maintenance every Sunday at 2:00 AM
0 2 * * 0 /var/www/healthcare/backend/current/scripts/server-maintenance.sh >> /var/log/cron.log 2>&1

# Daily database backup at 1:00 AM
0 1 * * * /var/www/healthcare/backend/current/scripts/backup-database.sh >> /var/log/cron.log 2>&1

# Check SSL certificate renewal daily
0 0 * * * certbot renew --quiet --post-hook "systemctl reload nginx" >> /var/log/letsencrypt/renew.log 2>&1
```

Make the scripts executable:

```bash
chmod +x /var/www/healthcare/backend/current/scripts/server-maintenance.sh
chmod +x /var/www/healthcare/backend/current/scripts/backup-database.sh
```

## Resource Optimization Settings

### Nginx Optimization

Edit `/etc/nginx/nginx.conf`:

```bash
sudo nano /etc/nginx/nginx.conf
```

Add or modify the following settings:

```nginx
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 4096;
    multi_accept on;
    use epoll;
}

http {
    # Basic settings
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;
    
    # Buffer size optimization
    client_body_buffer_size 10K;
    client_header_buffer_size 1k;
    client_max_body_size 8m;
    large_client_header_buffers 2 1k;
    
    # File cache settings
    open_file_cache max=1000 inactive=20s;
    open_file_cache_valid 30s;
    open_file_cache_min_uses 2;
    open_file_cache_errors on;
    
    # Compression
    gzip on;
    gzip_comp_level 4;
    gzip_min_length 1000;
    gzip_proxied any;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

### System Limits

Edit `/etc/security/limits.conf`:

```bash
sudo nano /etc/security/limits.conf
```

Add:

```
*               soft    nofile          65535
*               hard    nofile          65535
```

Edit `/etc/sysctl.conf`:

```bash
sudo nano /etc/sysctl.conf
```

Add:

```
# Network tuning
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 10000 65535
```

Apply changes:

```bash
sudo sysctl -p
```

## Monitoring Setup

Install and configure a basic monitoring system:

```bash
sudo apt install -y prometheus node-exporter
```

For a more comprehensive monitoring solution, consider setting up Grafana with Prometheus.

## Backup Strategy

1. **Database Backups**
   - Daily automatic database backups using the provided script
   - Backups stored in `/var/www/healthcare/backend/backups/db/`
   - Configure offsite backup storage (S3, etc.) for disaster recovery

2. **Application Backups**
   - Deployment system already creates backups before each deploy
   - Configure offsite backup copies for critical data

## Security Best Practices

1. **Firewall Configuration**
   ```bash
   sudo ufw allow ssh
   sudo ufw allow http
   sudo ufw allow https
   sudo ufw enable
   ```

2. **Secure SSH**
   Edit `/etc/ssh/sshd_config`:
   ```
   PermitRootLogin no
   PasswordAuthentication no
   ```

3. **Automatic Security Updates**
   ```bash
   sudo apt install -y unattended-upgrades
   dpkg-reconfigure -plow unattended-upgrades
   ```

## Regular Maintenance Checklist

1. **Weekly Tasks**
   - Review system logs for errors
   - Check disk usage
   - Monitor database performance

2. **Monthly Tasks**
   - Review and apply non-critical updates
   - Verify backup integrity
   - Check SSL certificate expiration

3. **Quarterly Tasks**
   - Review application logs for optimization opportunities
   - Perform database maintenance (index optimization, etc.)
   - Review security settings and update as needed

## Troubleshooting

### Common Issues

1. **Docker Containers Not Starting**
   ```bash
   # Check logs
   docker logs <container_name>
   
   # Restart container
   docker restart <container_name>
   ```

2. **Database Connection Issues**
   ```bash
   # Check database container status
   docker ps | grep postgres
   
   # Check database logs
   docker logs latest-postgres
   ```

3. **Nginx Issues**
   ```bash
   # Test configuration
   sudo nginx -t
   
   # Check logs
   sudo tail -f /var/log/nginx/error.log
   ```

4. **SSL Certificate Issues**
   ```bash
   # Check certificate status
   certbot certificates
   
   # Force renewal
   certbot renew --force-renewal
   ```

## Health Checks

Set up a monitoring endpoint to periodically check your application's health:

```bash
# Check API health
curl -I https://api.ishswami.in/health

# Set up a cron job for monitoring
*/5 * * * * curl -s https://api.ishswami.in/health > /dev/null || echo "API down at $(date)" | mail -s "API Health Alert" admin@example.com
``` 