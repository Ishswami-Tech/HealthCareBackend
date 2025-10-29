# SSL Certificate Management

This document explains how SSL certificates are managed for the HealthCare API.

## Certificate Setup

The system uses Let's Encrypt certificates for securing HTTPS connections. The certificates are:
- Located at `/etc/letsencrypt/live/api.ishswami.in/`
- Managed by Certbot
- Valid for 90 days
- Automatically renewed

## Auto-Renewal Process

Certificates are automatically renewed through:

1. Daily Cron Job: A cron job runs every day at 3:00 AM to check and renew certificates approaching expiration:
   ```
   0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'
   ```

2. Deployment Check: During each deployment, the system:
   - Checks if certificates exist
   - Verifies the expiration date
   - Attempts renewal if less than 30 days remain
   - Reloads Nginx after successful renewal

3. Initial Setup: If certificates don't exist when deploying, the system:
   - Installs Certbot if needed
   - Generates new certificates for `api.ishswami.in`
   - Sets up the auto-renewal cron job

## Fallback Mechanism

If Let's Encrypt certificate generation fails, the system creates self-signed certificates as a fallback:
- Located at `/etc/ssl/certs/nginx/nginx-selfsigned.crt` and `/etc/ssl/certs/nginx/nginx-selfsigned.key`
- Valid for 365 days
- Nginx configuration is automatically updated to use these certificates

## Manual Renewal

To manually renew certificates:
```
sudo certbot renew
sudo systemctl reload nginx
```

## Certificate Status Check

To check certificate status:
```
sudo certbot certificates
```

## Notes

- Ensure DNS for `api.ishswami.in` and `ishswami.in` points to your server IP (82.208.20.16).
- Use Cloudflare in Full (Strict) mode for end-to-end TLS.

