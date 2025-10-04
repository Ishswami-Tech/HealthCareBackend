# DevOps Resources

This directory contains all DevOps, infrastructure, and deployment related files.

## 📁 Folder Structure

```
devops/
├── docker/                          # Docker configuration
│   ├── Dockerfile                   # Production Dockerfile
│   ├── Dockerfile.dev               # Development Dockerfile
│   ├── .dockerignore                # Docker ignore patterns
│   ├── docker-compose.dev.yml       # Development compose
│   ├── docker-compose.prod.yml      # Production compose
│   ├── docker-compose.prod.yml.bak  # Production compose backup
│   └── haproxy/                     # HAProxy load balancer config
│       └── haproxy.cfg
│
├── nginx/                           # Nginx reverse proxy
│   ├── conf.d/
│   │   └── server.conf              # Nginx server configuration
│   ├── CLOUDFLARE_SETUP.md          # Cloudflare integration guide
│   └── SSL_CERTIFICATES.md          # SSL setup documentation
│
├── scripts/                         # Automation scripts
│   ├── backup/                      # Backup scripts
│   │   ├── backup-config.sh         # Configuration backup
│   │   ├── backup-database.sh       # Database backup
│   │   ├── offsite-backup.sh        # Offsite backup
│   │   └── windows-backup.ps1       # Windows backup script
│   │
│   ├── deployment/                  # Deployment scripts
│   │   ├── deploy-production.sh     # Production deployment
│   │   └── rollback.sh              # Deployment rollback
│   │
│   ├── monitoring/                  # Monitoring & health checks
│   │   ├── database-health-check.sh
│   │   ├── database-performance-monitor.sh
│   │   └── server-maintenance.sh
│   │
│   └── ci/                          # CI/CD scripts
│       ├── backup-maintenance.sh
│       ├── configure-optimize.sh
│       ├── deployment-health-check.sh
│       ├── health-check.sh
│       ├── post-deploy-health-check.sh
│       ├── setup-deployment.sh
│       └── start-containers.sh
│
└── docs/                            # DevOps documentation
    ├── PRODUCTION_OPTIMIZATION_GUIDE.md
    └── run.sh                       # Quick start script
```

## 🚀 Quick Start

### Development Environment
```bash
cd devops/docker
docker-compose -f docker-compose.dev.yml up -d
```

### Production Deployment
```bash
cd devops/scripts/deployment
./deploy-production.sh
```

### Database Backup
```bash
cd devops/scripts/backup
./backup-database.sh
```

### Health Check
```bash
cd devops/scripts/monitoring
./database-health-check.sh
```

## 📝 Documentation

- [Production Optimization Guide](./docs/PRODUCTION_OPTIMIZATION_GUIDE.md)

## 🔧 Maintenance

- **Backup Scripts**: Located in `scripts/backup/`
- **Monitoring**: Located in `scripts/monitoring/`
- **Deployment**: Located in `scripts/deployment/`
- **CI/CD**: Located in `scripts/ci/`
