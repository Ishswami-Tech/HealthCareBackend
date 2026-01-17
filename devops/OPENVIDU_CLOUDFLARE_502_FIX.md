# OpenVidu Cloudflare 502 Bad Gateway Fix Guide

## Problem

Cloudflare shows "502 Bad Gateway" when accessing
`backend-service-v1-video.ishswami.in`. This means Cloudflare cannot connect to
your origin server.

## Root Causes

1. **OpenVidu container not running**
2. **Port 4443 not accessible from Cloudflare**
3. **Cloudflare SSL/TLS mode mismatch**
4. **Cloudflare origin port configuration incorrect**
5. **Firewall blocking Cloudflare IPs**

## Step-by-Step Fix

### 1. Check OpenVidu Container Status

Run the diagnostic script on your server:

```bash
cd /opt/healthcare-backend/devops/scripts/docker-infra
./diagnose-openvidu.sh
```

Or manually check:

```bash
# Check if container is running
docker ps | grep openvidu-server

# Check container logs
docker logs --tail 50 openvidu-server

# Check if port is listening
netstat -tuln | grep 4443
# or
ss -tuln | grep 4443
```

**If container is not running:**

```bash
cd /opt/healthcare-backend/devops/docker
docker compose -f docker-compose.prod.yml --profile infrastructure up -d openvidu-server
```

### 2. Test Local Connectivity

Test if OpenVidu responds locally:

```bash
# Test HTTP (OpenVidu is configured with SERVER_SSL_ENABLED=false)
curl -k http://localhost:4443

# Should return "Welcome to OpenVidu" or similar
```

**If this fails:**

- Check OpenVidu logs: `docker logs openvidu-server`
- Wait 60-120 seconds for OpenVidu to fully start
- Check if Coturn (dependency) is running: `docker ps | grep coturn`

### 3. Fix Cloudflare SSL/TLS Mode

Since OpenVidu is configured with `SERVER_SSL_ENABLED=false` (HTTP), Cloudflare
must use **"Flexible"** SSL mode:

1. Go to Cloudflare Dashboard → SSL/TLS
2. Set SSL/TLS encryption mode to **"Flexible"**
   - This allows Cloudflare to accept HTTPS from users
   - But connect to your origin server via HTTP

**OR** (Recommended for production): Enable HTTPS on OpenVidu:

1. Set `SERVER_SSL_ENABLED=true` in `docker-compose.prod.yml`
2. Configure SSL certificates
3. Set Cloudflare SSL mode to **"Full"** or **"Full (strict)"**

### 4. Configure Cloudflare Origin Port

Cloudflare needs to know which port to connect to:

1. Go to Cloudflare Dashboard → DNS
2. Find `backend-service-v1-video.ishswami.in`
3. Click "Edit" (pencil icon)
4. In "Port" field, set to **4443** (not 443)
5. Or use Cloudflare Workers/Page Rules to route to port 4443

**Alternative:** Use Cloudflare's "Origin Rules" or "Transform Rules":

- Create a rule that rewrites the origin port to 4443

### 5. Allow Cloudflare IPs in Firewall

Cloudflare needs to connect to your server. Allow Cloudflare IP ranges:

```bash
# Get Cloudflare IP ranges
curl https://www.cloudflare.com/ips-v4 > /tmp/cloudflare-ips.txt

# For UFW (Ubuntu Firewall)
while read ip; do
  sudo ufw allow from $ip to any port 4443
done < /tmp/cloudflare-ips.txt

# For firewalld (CentOS/RHEL)
while read ip; do
  sudo firewall-cmd --permanent --add-rich-rule="rule family='ipv4' source address='$ip' port port='4443' protocol='tcp' accept"
done < /tmp/cloudflare-ips.txt
sudo firewall-cmd --reload
```

**Or temporarily disable firewall for testing:**

```bash
# UFW
sudo ufw allow 4443/tcp

# firewalld
sudo firewall-cmd --permanent --add-port=4443/tcp
sudo firewall-cmd --reload
```

### 6. Test from Cloudflare Network

Use Cloudflare's "Test Origin" tool or test from a Cloudflare IP:

```bash
# Test from your server (simulating Cloudflare connection)
curl -H "Host: backend-service-v1-video.ishswami.in" http://localhost:4443

# Test from external IP (if you have access)
curl http://YOUR_SERVER_IP:4443
```

### 7. Check Reverse Proxy (if using nginx/traefik)

If you're using a reverse proxy, ensure it forwards to OpenVidu:

**nginx example:**

```nginx
server {
    listen 80;
    server_name backend-service-v1-video.ishswami.in;

    location / {
        proxy_pass http://localhost:4443;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 8. Verify OpenVidu Configuration

Check that OpenVidu environment variables are correct:

```bash
docker exec openvidu-server sh -c 'env | grep OPENVIDU'
```

Key variables:

- `OPENVIDU_PUBLICURL` should be `https://backend-service-v1-video.ishswami.in`
- `OPENVIDU_DOMAIN` should be `backend-service-v1-video.ishswami.in`
- `SERVER_PORT` should be `4443`
- `SERVER_SSL_ENABLED` should match your Cloudflare SSL mode

## Quick Fix Checklist

- [ ] OpenVidu container is running: `docker ps | grep openvidu-server`
- [ ] Port 4443 is listening: `netstat -tuln | grep 4443`
- [ ] Local test works: `curl http://localhost:4443`
- [ ] Cloudflare SSL mode is "Flexible" (if OpenVidu is HTTP)
- [ ] Cloudflare origin port is set to 4443
- [ ] Firewall allows port 4443
- [ ] Cloudflare IPs are allowed in firewall
- [ ] DNS points to correct server IP

## Expected Result

After fixing, accessing `https://backend-service-v1-video.ishswami.in` should
show:

- "Welcome to OpenVidu" message (if accessing root URL)
- Or OpenVidu API responses (if accessing `/openvidu/api/*`)

## Still Not Working?

1. **Check Cloudflare logs:**
   - Go to Cloudflare Dashboard → Analytics → Logs
   - Look for 502 errors and origin connection failures

2. **Test without Cloudflare:**
   - Temporarily disable Cloudflare proxy (gray cloud)
   - Access directly via IP: `http://YOUR_SERVER_IP:4443`
   - If this works, the issue is Cloudflare configuration

3. **Check server resources:**
   - Ensure server has enough CPU/memory
   - Check disk space: `df -h`
   - Check system logs: `journalctl -xe`

4. **Contact support:**
   - Share diagnostic script output
   - Share Cloudflare error logs
   - Share OpenVidu container logs
