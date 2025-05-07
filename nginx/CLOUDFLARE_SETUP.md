# Cloudflare Setup Instructions

To properly secure your API with Cloudflare and prevent "Not secure" warnings, follow these steps:

## 1. DNS Configuration (Already Done)

- A record for `api.ishswami.in` pointing to `82.208.20.16`
- A record for `ishswami.in` pointing to `82.208.20.16`

## 2. SSL/TLS Configuration

1. Login to your Cloudflare dashboard
2. Go to the SSL/TLS section
3. Under the "Overview" tab, change the encryption mode to **Full (strict)** instead of Flexible
   - This ensures end-to-end encryption between users, Cloudflare, and your server
   - It requires your server to have a valid SSL certificate (which we've set up with Let's Encrypt)

## 3. SSL/TLS Certificate Settings

1. Go to the "Edge Certificates" tab
2. Enable "Always Use HTTPS"
3. Set minimum TLS version to TLS 1.2
4. Enable "Automatic HTTPS Rewrites"

## 4. Page Rules (Optional but Recommended)

Create these page rules for better security:

1. URL pattern: `*api.ishswami.in/*`
   - Settings: SSL = Full Strict, Cache Level = Bypass

2. URL pattern: `*api.ishswami.in/socket.io/*`
   - Settings: SSL = Full Strict, Disable Security (to allow WebSockets)

## 5. Firewall Settings

1. Go to the "Firewall" section
2. Create a rule to allow traffic to your API ports (8088, 5555, 8082)

## 6. Testing

After making these changes:
1. Clear your browser cache or use incognito mode
2. Visit https://api.ishswami.in
3. You should no longer see SSL warnings
4. The services should change from "Inactive" to "Active"

## 7. Troubleshooting

If you still see issues:
1. Check your server's SSL certificate: `certbot certificates`
2. Check Nginx configuration: `nginx -t`
3. Review Nginx logs: `tail -f /var/log/nginx/error.log`
4. Check the API container logs: `docker logs latest-api` 