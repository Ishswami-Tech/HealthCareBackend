# Secure Database Access Guide

## ⚠️ Security Warning

**NEVER expose PostgreSQL port 5432 directly to the internet!** This is a
critical security risk that can lead to:

- Brute force attacks
- Data breaches
- Unauthorized access
- Database compromise

## 🔒 Secure Access Methods (Ranked by Security)

### ✅ Method 1: SSH Tunnel (MOST SECURE - Recommended)

**Best for:** Remote access from your local machine

**How it works:**

- SSH tunnel encrypts all traffic
- Database port is never exposed to internet
- Only accessible through authenticated SSH connection

**Setup:**

1. **Create SSH tunnel:**

   ```bash
   ssh -L 5432:localhost:5432 user@backend-service-v1.ishswami.in
   ```

   Or if SSH uses a different port:

   ```bash
   ssh -L 5432:localhost:5432 -p SSH_PORT user@backend-service-v1.ishswami.in
   ```

2. **Keep SSH session open** (the tunnel stays active while SSH is connected)

3. **In DBeaver, connect to:**
   - **Host:** `localhost`
   - **Port:** `5432`
   - **Database:** `userdb`
   - **Username:** `postgres`
   - **Password:** `postgres`

**Security Benefits:**

- ✅ No port exposure to internet
- ✅ Encrypted connection (SSH)
- ✅ Requires SSH authentication
- ✅ No firewall changes needed
- ✅ Works through Cloudflare/domain

**Requirements:**

- SSH access to server
- SSH key or password authentication

---

### ✅ Method 2: VPN Access (VERY SECURE)

**Best for:** Team access, multiple users

**How it works:**

- Connect to VPN first
- Then access database as if on local network
- Database only accessible from VPN network

**Setup:**

1. **Set up VPN** (WireGuard, OpenVPN, or cloud VPN)
2. **Configure firewall** to allow VPN network only:

   ```bash
   # Allow only VPN network (example: 10.8.0.0/24)
   sudo ufw allow from 10.8.0.0/24 to any port 5432
   ```

3. **Expose port 5432** in `docker-compose.prod.yml`:

   ```yaml
   ports:
     - '5432:5432'
   ```

4. **Restart PostgreSQL:**

   ```bash
   docker compose -f docker-compose.prod.yml restart postgres
   ```

5. **In DBeaver, connect to:**
   - **Host:** `VPN_SERVER_IP` or `backend-service-v1.ishswami.in` (if VPN
     routes through domain)
   - **Port:** `5432`
   - **Database:** `userdb`
   - **Username:** `postgres`
   - **Password:** `postgres`

**Security Benefits:**

- ✅ Encrypted VPN connection
- ✅ Access control (only VPN users)
- ✅ No direct internet exposure
- ✅ Audit trail possible

---

### ⚠️ Method 3: IP Whitelist + Firewall (MODERATE SECURITY)

**Best for:** Specific IP addresses only (your office, home)

**How it works:**

- Expose port 5432
- Restrict access to specific IP addresses only
- Use strong password

**Setup:**

1. **Expose port 5432** in `docker-compose.prod.yml`:

   ```yaml
   ports:
     - '5432:5432'
   ```

2. **Configure firewall to allow only your IP:**

   ```bash
   # Replace YOUR_IP with your actual IP address
   sudo ufw allow from YOUR_IP to any port 5432

   # Or allow multiple IPs
   sudo ufw allow from 123.45.67.89 to any port 5432
   sudo ufw allow from 98.76.54.32 to any port 5432
   ```

3. **Change PostgreSQL password** (if using default):

   ```bash
   # Inside PostgreSQL container
   docker exec -it postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'STRONG_PASSWORD_HERE';"
   ```

4. **Update DATABASE_URL** in docker-compose with new password

5. **Restart PostgreSQL:**

   ```bash
   docker compose -f docker-compose.prod.yml restart postgres
   ```

6. **In DBeaver, connect to:**
   - **Host:** `YOUR_SERVER_IP` (not domain - direct IP)
   - **Port:** `5432`
   - **Database:** `userdb`
   - **Username:** `postgres`
   - **Password:** `STRONG_PASSWORD_HERE`

**Security Benefits:**

- ✅ IP-based access control
- ✅ Firewall protection
- ⚠️ Still exposed to whitelisted IPs
- ⚠️ Requires static IP or frequent updates

**Security Risks:**

- ⚠️ If IP changes, access is lost
- ⚠️ If IP is compromised, database is accessible
- ⚠️ Password-based authentication (use strong password!)

---

### ❌ Method 4: Public Access (NOT RECOMMENDED)

**⚠️ NEVER DO THIS IN PRODUCTION!**

If you absolutely must (development only):

1. **Use strong password:**

   ```bash
   docker exec -it postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'VERY_STRONG_RANDOM_PASSWORD';"
   ```

2. **Enable SSL/TLS:**
   - Configure PostgreSQL SSL certificates
   - Require SSL connections only

3. **Monitor access logs:**

   ```bash
   # Check for brute force attempts
   docker logs postgres | grep "authentication failed"
   ```

4. **Set up fail2ban:**
   ```bash
   # Block IPs after failed login attempts
   sudo apt install fail2ban
   ```

**Security Risks:**

- ❌ Exposed to entire internet
- ❌ Brute force attacks
- ❌ Data breach risk
- ❌ Compliance violations (HIPAA, GDPR)

---

## 🔐 Additional Security Best Practices

### 1. Change Default Password

**Current default:** `postgres:postgres`

**Change it:**

```bash
# Generate strong password
openssl rand -base64 32

# Update in PostgreSQL
docker exec -it postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'GENERATED_PASSWORD';"

# Update in docker-compose.prod.yml
# Change: postgres:postgres@postgres:5432/userdb
# To: postgres:GENERATED_PASSWORD@postgres:5432/userdb
```

### 2. Use Read-Only User for DBeaver

**Create read-only user:**

```sql
-- Connect as postgres user
CREATE USER dbeaver_readonly WITH PASSWORD 'STRONG_PASSWORD';

-- Grant read-only access
GRANT CONNECT ON DATABASE userdb TO dbeaver_readonly;
GRANT USAGE ON SCHEMA public TO dbeaver_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbeaver_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dbeaver_readonly;
```

### 3. Enable PostgreSQL SSL

**Configure SSL in PostgreSQL:**

```yaml
# In docker-compose.prod.yml, add to postgres service:
environment:
  POSTGRES_SSL_MODE: require
  POSTGRES_SSL_CERT: /etc/ssl/certs/postgres.crt
  POSTGRES_SSL_KEY: /etc/ssl/private/postgres.key
```

### 4. Set Up Connection Logging

**Monitor database access:**

```sql
-- Enable connection logging
ALTER SYSTEM SET log_connections = 'on';
ALTER SYSTEM SET log_disconnections = 'on';
SELECT pg_reload_conf();
```

### 5. Use Connection Timeouts

**Limit connection duration:**

```sql
-- Set idle connection timeout
ALTER SYSTEM SET idle_in_transaction_session_timeout = '10min';
SELECT pg_reload_conf();
```

---

## 📊 Security Comparison

| Method        | Security Level | Ease of Setup | Best For                    |
| ------------- | -------------- | ------------- | --------------------------- |
| SSH Tunnel    | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐      | Single user, remote access  |
| VPN           | ⭐⭐⭐⭐⭐     | ⭐⭐⭐        | Team access, multiple users |
| IP Whitelist  | ⭐⭐⭐         | ⭐⭐⭐⭐      | Specific IPs, office access |
| Public Access | ⭐             | ⭐⭐⭐⭐⭐    | ❌ Never in production      |

---

## 🚀 Quick Start: SSH Tunnel (Recommended)

**For immediate secure access:**

1. **Open terminal and create tunnel:**

   ```bash
   ssh -L 5432:localhost:5432 user@backend-service-v1.ishswami.in
   ```

2. **Keep terminal open** (tunnel stays active)

3. **In DBeaver:**
   - New Database Connection
   - PostgreSQL
   - Host: `localhost`
   - Port: `5432`
   - Database: `userdb`
   - Username: `postgres`
   - Password: `postgres`
   - Test Connection → ✅

**That's it!** No port exposure, fully encrypted, secure.

---

## 🔍 Verify Security

**Check if port is exposed:**

```bash
# Should show nothing (port not exposed)
sudo netstat -tuln | grep 5432

# Or
sudo ss -tuln | grep 5432
```

**Check firewall rules:**

```bash
# UFW
sudo ufw status numbered

# firewalld
sudo firewall-cmd --list-all
```

**Check PostgreSQL connections:**

```bash
# See active connections
docker exec -it postgres psql -U postgres -c "SELECT * FROM pg_stat_activity;"
```

---

## 📝 Summary

**For secure database access:**

1. ✅ **Use SSH Tunnel** (Method 1) - Most secure, easiest
2. ✅ **Use VPN** (Method 2) - Best for teams
3. ⚠️ **IP Whitelist** (Method 3) - If you have static IP
4. ❌ **Never expose publicly** (Method 4) - Security risk

**Current setup:** Port 5432 is **NOT exposed** (secure by default) ✅

**Recommended:** Use SSH tunnel for DBeaver access - no configuration changes
needed!
