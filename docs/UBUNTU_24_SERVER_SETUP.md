# Ubuntu 24 Server Setup

Current production notes for the Healthcare Backend server.

## Keep Installed

- Docker
- Docker Compose plugin
- Nginx
- Certbot
- Fail2Ban

## Ports

- `8088` for the backend API/video service
- `5432` for PostgreSQL internally
- `6379` for Dragonfly internally
- `9000` for Portainer

## Notes

- The current video stack is handled by the backend `video` service.
