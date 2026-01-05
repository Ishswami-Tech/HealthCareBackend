# 🛡️ Ubuntu 24 Server Setup & Security Hardening Guide

## Healthcare Backend - Complete Production Server Configuration

Complete step-by-step guide for setting up Ubuntu 24 LTS with comprehensive
security hardening for your healthcare backend application.

---

## 📋 Table of Contents

1. [Initial Server Setup](#1-initial-server-setup)
   - [1.5 Configure SSH for Easy Access](#15-configure-ssh-for-easy-access-multiple-laptops)
   - [1.5.5 Configure SSH for GitHub Actions CI/CD](#155-configure-ssh-for-github-actions-cicd)
2. [Security Hardening](#2-security-hardening)
3. [Firewall Configuration](#3-firewall-configuration)
4. [Docker Installation](#4-docker-installation)
5. [Nginx Installation & Configuration](#5-nginx-installation--configuration)
6. [Application Deployment](#6-application-deployment)
7. [Cloudflare Integration](#7-cloudflare-integration)
8. [Monitoring & Logging](#8-monitoring--logging)
9. [Backup Configuration](#9-backup-configuration)
10. [Post-Deployment Verification](#10-post-deployment-verification)
11. [Security Checklist](#11-security-checklist)
12. [Maintenance Schedule](#12-maintenance-schedule)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Initial Server Setup

### 1.1 Connect to Server

```bash
# Connect via SSH (replace with your server IP)
ssh root@YOUR_SERVER_IP

# If you have an SSH key, use:
ssh -i ~/.ssh/your_key root@YOUR_SERVER_IP
```

### 1.2 Update System

```bash
# Update package lists
apt update && apt upgrade -y

# Install essential tools
apt install -y curl wget git vim ufw fail2ban unattended-upgrades \
  apt-transport-https ca-certificates gnupg lsb-release \
  htop net-tools software-properties-common lynis rkhunter aide
```

### 1.3 Create Non-Root User

```bash
# Create admin user (replace 'admin' with your preferred username)
adduser deploy
usermod -aG sudo deploy

# Copy SSH keys to new user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true

# Test login as new user before disabling root
# Exit and login as: ssh deploy@YOUR_SERVER_IP
```

### 1.4 Setup SSH Key Authentication (Recommended)

**On your local machine:**

```bash
# Generate SSH key if you don't have one
ssh-keygen -t ed25519 -C "server-access" -f ~/.ssh/server_key

# Copy public key to server
ssh-copy-id -i ~/.ssh/server_key.pub admin@YOUR_SERVER_IP

# Or manually:
cat ~/.ssh/server_key.pub | ssh admin@YOUR_SERVER_IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

### 1.5 Configure SSH for Easy Access (Multiple Laptops)

After setting up SSH keys, configure SSH for easy access from your current
laptop and any additional laptops.

#### 1.5.1 Setup SSH Config File (Current Laptop)

**On your local machine (MobaXterm/Windows):**

```bash
# Create .ssh directory if it doesn't exist
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Move your key to default location (if not already there)
if [ ! -f ~/.ssh/id_ed25519 ]; then
    cp ~/server_key ~/.ssh/id_ed25519 2>/dev/null || true
    cp ~/server_key.pub ~/.ssh/id_ed25519.pub 2>/dev/null || true
    chmod 600 ~/.ssh/id_ed25519
    chmod 644 ~/.ssh/id_ed25519.pub
fi

# Create SSH config file for easy access
cat >> ~/.ssh/config << 'EOF'
Host myserver
    HostName YOUR_SERVER_IP
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 60
    ServerAliveCountMax 3

Host YOUR_SERVER_IP
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 60
    ServerAliveCountMax 3
EOF

# Set correct permissions
chmod 600 ~/.ssh/config

# Test connection
ssh myserver
# OR
ssh YOUR_SERVER_IP
```

**Replace `YOUR_SERVER_IP` with your actual server IP address.**

Now you can login easily with:

- `ssh myserver` (using alias)
- `ssh YOUR_SERVER_IP` (using IP directly)

#### 1.5.2 Add Additional Laptops/Computers

To allow access from additional laptops:

**Step 1: On the NEW laptop**

```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "deploy@server" -f ~/.ssh/id_ed25519

# Display the public key (copy this output)
cat ~/.ssh/id_ed25519.pub
```

**Step 2: On the SERVER**

```bash
# Add the new laptop's public key to deploy user
echo "PASTE_THE_NEW_PUBLIC_KEY_HERE" | sudo tee -a /home/deploy/.ssh/authorized_keys

# Set correct permissions
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys

# Verify it was added
sudo cat /home/deploy/.ssh/authorized_keys
```

**Step 3: On the NEW laptop**

```bash
# Create SSH config file (same as above)
mkdir -p ~/.ssh
chmod 700 ~/.ssh

cat >> ~/.ssh/config << 'EOF'
Host myserver
    HostName YOUR_SERVER_IP
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 60
    ServerAliveCountMax 3
EOF

chmod 600 ~/.ssh/config

# Test connection
ssh myserver
```

#### 1.5.3 Verify SSH Access

**On any laptop, test connection:**

```bash
# Test with alias
ssh myserver

# Test with IP
ssh YOUR_SERVER_IP

# Test root login (should FAIL - this is correct!)
ssh root@YOUR_SERVER_IP
```

**Expected results:**

- ✅ `ssh myserver` or `ssh YOUR_SERVER_IP` → Should connect successfully
- ❌ `ssh root@YOUR_SERVER_IP` → Should be rejected (root login disabled)

#### 1.5.4 Troubleshooting SSH Connection Issues

If you get "Connection timed out":

```bash
# On SERVER: Check firewall allows SSH
sudo ufw status | grep 22

# On SERVER: Check SSH is running
sudo systemctl status ssh

# On SERVER: Check SSH is listening
sudo ss -tlnp | grep :22

# On LOCAL: Test with verbose output
ssh -v deploy@YOUR_SERVER_IP

# On LOCAL: Test with explicit key
ssh -i ~/.ssh/id_ed25519 deploy@YOUR_SERVER_IP
```

If you get "Permission denied":

```bash
# On SERVER: Check authorized_keys permissions
sudo ls -la /home/deploy/.ssh/
sudo cat /home/deploy/.ssh/authorized_keys

# On LOCAL: Check key permissions
ls -la ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
```

#### 1.5.5 Configure SSH for GitHub Actions CI/CD

To enable GitHub Actions to deploy to your server, you need to add the GitHub
Actions SSH public key to your server.

**Step 1: Generate SSH Key for GitHub Actions**

On your local machine or GitHub Actions runner, generate a dedicated SSH key:

```bash
# Generate SSH key specifically for GitHub Actions
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy

# Display the public key (you'll need to add this to GitHub Secrets)
cat ~/.ssh/github_actions_deploy.pub
```

**Step 2: Add SSH Key to GitHub Secrets**

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Add the following secrets:
   - `SSH_PRIVATE_KEY`: The **private** key content
     (`~/.ssh/github_actions_deploy`)
   - `SERVER_HOST`: Your server IP address (e.g., `31.220.79.219`)
   - `SERVER_USER`: The deploy user (e.g., `deploy`)
   - `SERVER_DEPLOY_PATH`: Deployment path (e.g., `/opt/healthcare-backend`)

**Step 3: Add Public Key to Server**

On the SERVER, add the GitHub Actions public key:

```bash
# Add GitHub Actions public key to deploy user
echo "PASTE_GITHUB_ACTIONS_PUBLIC_KEY_HERE" | sudo tee -a /home/deploy/.ssh/authorized_keys

# Set correct permissions
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys

# Verify it was added
sudo cat /home/deploy/.ssh/authorized_keys
```

**Step 4: Test GitHub Actions SSH Connection**

You can test the connection manually:

```bash
# On your local machine (using the GitHub Actions private key)
ssh -i ~/.ssh/github_actions_deploy deploy@YOUR_SERVER_IP

# Or test from GitHub Actions workflow (will be done automatically)
```

**Step 5: Verify GitHub Actions Workflow**

Your GitHub Actions workflow (`.github/workflows/ci.yml`) should already be
configured to use these secrets. Verify the workflow uses:

- `${{ secrets.SSH_PRIVATE_KEY }}` for SSH authentication
- `${{ secrets.SERVER_HOST }}` for server connection
- `${{ secrets.SERVER_USER }}` for SSH user
- `${{ secrets.SERVER_DEPLOY_PATH }}` for deployment path

**Security Notes:**

- ✅ Never commit SSH private keys to the repository
- ✅ Use GitHub Secrets for all sensitive values
- ✅ The deploy user should have sudo access for deployment operations
- ✅ SSH key should only have access to the deploy user, not root

---

## 2. Security Hardening

### 2.1 SSH Hardening

```bash
# Backup original SSH config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Edit SSH configuration
vim /etc/ssh/sshd_config
```

**Add/Modify these settings:**

```bash
# Disable root login
PermitRootLogin no

# Disable password authentication (use keys only)
PasswordAuthentication no
PubkeyAuthentication yes

# Disable empty passwords
PermitEmptyPasswords no

# Limit authentication attempts
MaxAuthTries 3
MaxSessions 2

# Disable X11 forwarding
X11Forwarding no

# Use only strong ciphers
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,hmac-sha2-512,hmac-sha2-256
KexAlgorithms curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512

# Set idle timeout (10 minutes)
ClientAliveInterval 600
ClientAliveCountMax 0

# Disable DNS lookup (faster connections)
UseDNS no

# Restrict users who can SSH
AllowUsers admin

# Logging
LogLevel VERBOSE
```

**Apply changes:**

```bash
# Test SSH config
sshd -t

# Restart SSH service
systemctl restart sshd

# IMPORTANT: Keep another SSH session open while testing!
# Test login from another terminal before closing current session
```

### 2.2 Fail2Ban Configuration (Brute Force Protection)

```bash
# Create comprehensive jail.local with multiple protection layers
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
# Global settings
bantime = 86400              # Ban for 24 hours (increased from 1 hour)
findtime = 600               # Look back 10 minutes
maxretry = 3                 # Max attempts before ban
destemail = your-email@example.com
sendername = Fail2Ban
action = %(action_mwl)s      # Mail, whois, and log action
ignoreip = 127.0.0.1/8 ::1   # Never ban localhost

# SSH Brute Force Protection
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400              # 24 hour ban
findtime = 600
backend = systemd

# SSH DDoS Protection
[sshd-ddos]
enabled = true
port = 22
filter = sshd-ddos
logpath = /var/log/auth.log
maxretry = 5
bantime = 172800             # 48 hour ban for DDoS
findtime = 300

# SSH Root Login Protection (if root login is enabled)
[sshd-root]
enabled = false              # Set to true if PermitRootLogin is yes
port = 22
filter = sshd-root
logpath = /var/log/auth.log
maxretry = 1                 # Zero tolerance for root brute force
bantime = 604800             # 7 day ban

# Protection against repeated authentication failures
[sshd-repeater]
enabled = true
port = 22
filter = sshd-repeater
logpath = /var/log/auth.log
maxretry = 2
bantime = 43200              # 12 hour ban
findtime = 300

# Protection for invalid users
[sshd-invaliduser]
enabled = true
port = 22
filter = sshd-invaliduser
logpath = /var/log/auth.log
maxretry = 1                 # Zero tolerance
bantime = 604800             # 7 day ban

# Nginx/Apache Protection (if using web server)
[nginx-http-auth]
enabled = false              # Enable if using Nginx
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 3
bantime = 3600

[nginx-limit-req]
enabled = false              # Enable if using Nginx
port = http,https
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 10
findtime = 60
bantime = 3600

# PostgreSQL Protection (if exposed, should NOT be)
[postgresql]
enabled = false              # Keep disabled - PostgreSQL should be internal only
port = 5432
filter = postgresql
logpath = /var/log/postgresql/postgresql-*.log
maxretry = 3
bantime = 86400

# Coturn (TURN/STUN) Protection
# ⚠️ SECURITY: Coturn is exposed on port 3478 - monitor for attacks
[coturn]
enabled = true
port = 3478
protocol = udp,tcp
filter = coturn
logpath = /var/log/coturn.log
maxretry = 5
findtime = 300
bantime = 3600
action = %(action_)s

# Generic protection for any service
[recidive]
enabled = true
filter = recidive
logpath = /var/log/fail2ban.log
action = %(action_mwl)s
bantime = 604800             # 7 day ban for repeat offenders
findtime = 86400             # Look back 24 hours
maxretry = 3
EOF

# Create Fail2Ban filter for Coturn (TURN/STUN server)
# ⚠️ SECURITY: Coturn is exposed on port 3478 - monitor for authentication failures
cat > /etc/fail2ban/filter.d/coturn.conf << 'EOF'
[Definition]
failregex = ^.*WARNING:.*client <HOST>.*authentication failed
            ^.*ERROR:.*client <HOST>.*authentication failed
            ^.*WARNING:.*client <HOST>.*relay request failed
ignoreregex =
EOF

# Start and enable Fail2Ban
systemctl enable fail2ban
systemctl start fail2ban

# Check status
fail2ban-client status

# View banned IPs
fail2ban-client status sshd
fail2ban-client status coturn
```

### 2.2.1 Additional Brute Force Protection

```bash
# Install and configure DenyHosts (additional SSH protection)
apt install -y denyhosts

# Configure DenyHosts
cat > /etc/denyhosts.conf << 'EOF'
SECURE_LOG = /var/log/auth.log
HOSTS_DENY = /etc/hosts.deny
PURGE_DENY = 1w              # Remove bans after 1 week
BLOCK_SERVICE = sshd
DENY_THRESHOLD_INVALID = 5   # Ban after 5 invalid user attempts
DENY_THRESHOLD_VALID = 10    # Ban after 10 valid user attempts
DENY_THRESHOLD_ROOT = 1      # Zero tolerance for root
DENY_THRESHOLD_RESTRICTED = 1
WORK_DIR = /var/lib/denyhosts
SUSPICIOUS_LOGIN_REPORT_ALLOWED_HOSTS=YES
HOSTNAME_LOOKUP=YES
LOCK_FILE = /var/run/denyhosts.pid
ADMIN_EMAIL = your-email@example.com
SMTP_HOST = localhost
SMTP_PORT = 25
SMTP_FROM = DenyHosts <nobody@localhost>
AGE_RESET_VALID=10d
AGE_RESET_ROOT=25d
AGE_RESET_RESTRICTED=25d
AGE_RESET_INVALID=10d
EOF

# Start DenyHosts
systemctl enable denyhosts
systemctl start denyhosts
```

### 2.2.2 SSH Connection Rate Limiting

```bash
# Add rate limiting to SSH config
cat >> /etc/ssh/sshd_config << 'EOF'

# Connection rate limiting
MaxStartups 3:50:10          # Allow 3 unauthenticated connections, then 50% drop, max 10
MaxSessions 2                # Limit concurrent sessions per connection
LoginGraceTime 30             # Disconnect if not authenticated within 30 seconds
EOF

# Test and restart SSH
sshd -t && systemctl restart sshd
```

### 2.2.3 IP Reputation Blocking

```bash
# Install ipset for efficient IP blocking
apt install -y ipset

# Create IP sets for blocking
ipset create blacklist hash:ip timeout 86400    # 24 hour timeout
ipset create whitelist hash:ip

# Add your trusted IPs to whitelist
ipset add whitelist YOUR_TRUSTED_IP_1
ipset add whitelist YOUR_TRUSTED_IP_2

# Save IP sets
ipset save > /etc/ipset.conf

# Restore on boot
cat > /etc/systemd/system/ipset-restore.service << 'EOF'
[Unit]
Description=Restore IP sets
Before=network-pre.target
DefaultDependencies=no

[Service]
Type=oneshot
ExecStart=/sbin/ipset restore -f /etc/ipset.conf
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl enable ipset-restore.service
```

### 2.2.4 Monitor and Block Suspicious Activity

```bash
# Create monitoring script for suspicious activity
cat > /usr/local/bin/monitor-attacks.sh << 'EOF'
#!/bin/bash
# Monitor and block suspicious activity

LOG_FILE="/var/log/attack-monitor.log"
AUTH_LOG="/var/log/auth.log"
FAILED_THRESHOLD=5

# Check for multiple failed login attempts from same IP
echo "[$(date)] Checking for brute force attempts..." >> $LOG_FILE

# Find IPs with multiple failed attempts
grep "Failed password" $AUTH_LOG | \
  awk '{print $11}' | \
  sort | uniq -c | \
  sort -rn | \
  while read count ip; do
    if [ "$count" -gt "$FAILED_THRESHOLD" ]; then
      echo "[$(date)] WARNING: $ip has $count failed attempts" >> $LOG_FILE
      # Add to fail2ban manually if not already banned
      fail2ban-client set sshd banip $ip 2>/dev/null || true
    fi
  done

# Check for port scanning
netstat -an | grep SYN_RECV | awk '{print $5}' | cut -d: -f1 | \
  sort | uniq -c | sort -rn | head -10 | \
  while read count ip; do
    if [ "$count" -gt 10 ]; then
      echo "[$(date)] WARNING: Possible port scan from $ip ($count connections)" >> $LOG_FILE
      # Block the IP
      ufw deny from $ip 2>/dev/null || true
    fi
  done
EOF

chmod +x /usr/local/bin/monitor-attacks.sh

# Add to crontab (run every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/monitor-attacks.sh") | crontab -
```

### 2.3 Automatic Security Updates

```bash
# Configure automatic security updates
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "02:00";
EOF

# Enable automatic updates
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

# Enable service
systemctl enable unattended-upgrades
systemctl start unattended-upgrades
```

### 2.4 Kernel Hardening

```bash
# Add kernel parameters for security
cat >> /etc/sysctl.conf << 'EOF'

# Security Hardening
# Disable IP forwarding
net.ipv4.ip_forward = 0
net.ipv6.conf.all.forwarding = 0

# Disable source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0

# Disable ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0

# Disable send redirects
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Enable SYN flood protection
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_syn_retries = 5
net.ipv4.tcp_synack_retries = 2

# Enable IP spoofing protection
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Log martian packets
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# Ignore ICMP ping broadcasts
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Ignore bad ICMP errors
net.ipv4.icmp_ignore_bogus_error_responses = 1

# IPv6 security
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0

# TCP hardening
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_window_scaling = 1

# Connection tracking
net.netfilter.nf_conntrack_max = 1000000
net.netfilter.nf_conntrack_tcp_timeout_established = 1200
EOF

# Apply sysctl settings
sysctl -p
```

### 2.5 Disable Unnecessary Services

```bash
# List all running services
systemctl list-units --type=service --state=running

# Disable unnecessary services (adjust based on your needs)
systemctl disable bluetooth 2>/dev/null || true
systemctl disable avahi-daemon 2>/dev/null || true
systemctl disable cups 2>/dev/null || true
systemctl disable isc-dhcp-server 2>/dev/null || true
systemctl disable isc-dhcp-server6 2>/dev/null || true
```

### 2.6 DDoS and Attack Prevention

```bash
# Install and configure mod_evasive (if using Apache) or equivalent
# For Nginx, we'll use rate limiting in nginx config

# Install tools for DDoS protection
apt install -y iptables-persistent

# Configure iptables rules for DDoS protection
cat > /etc/iptables/rules.v4 << 'EOF'
# DDoS Protection Rules
*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]

# Allow loopback
-A INPUT -i lo -j ACCEPT

# Allow established and related connections
-A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow SSH (with rate limiting)
-A INPUT -p tcp --dport 22 -m state --state NEW -m recent --set --name SSH
-A INPUT -p tcp --dport 22 -m state --state NEW -m recent --update --seconds 60 --hitcount 4 --name SSH -j DROP
-A INPUT -p tcp --dport 22 -j ACCEPT

# Allow HTTP/HTTPS (with rate limiting)
-A INPUT -p tcp --dport 80 -m state --state NEW -m recent --set --name HTTP
-A INPUT -p tcp --dport 80 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name HTTP -j DROP
-A INPUT -p tcp --dport 80 -j ACCEPT

-A INPUT -p tcp --dport 443 -m state --state NEW -m recent --set --name HTTPS
-A INPUT -p tcp --dport 443 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name HTTPS -j DROP
-A INPUT -p tcp --dport 443 -j ACCEPT

# Drop invalid packets
-A INPUT -m state --state INVALID -j DROP

# Drop packets with invalid TCP flags
-A INPUT -p tcp --tcp-flags ALL NONE -j DROP
-A INPUT -p tcp --tcp-flags ALL ALL -j DROP
-A INPUT -p tcp --tcp-flags ALL FIN,URG,PSH -j DROP
-A INPUT -p tcp --tcp-flags ALL SYN,RST,ACK,FIN,URG -j DROP
-A INPUT -p tcp --tcp-flags SYN,RST SYN,RST -j DROP
-A INPUT -p tcp --tcp-flags SYN,FIN SYN,FIN -j DROP

# Limit ICMP (ping) to prevent ping floods
-A INPUT -p icmp -m limit --limit 1/s --limit-burst 3 -j ACCEPT
-A INPUT -p icmp -j DROP

# Drop fragments
-A INPUT -f -j DROP

# Drop XMAS packets
-A INPUT -p tcp --tcp-flags ALL FIN,URG,PSH -j DROP

# Drop NULL packets
-A INPUT -p tcp --tcp-flags ALL NONE -j DROP

COMMIT
EOF

# Apply iptables rules
iptables-restore < /etc/iptables/rules.v4

# Make rules persistent
netfilter-persistent save
```

### 2.7 Application-Level Attack Prevention

```bash
# Create script to configure application-level protections
cat > /usr/local/bin/setup-app-security.sh << 'EOF'
#!/bin/bash
# Application-level security configurations

# 1. SQL Injection Prevention (at application level - ensure Prisma parameterized queries)
# 2. XSS Prevention (at application level - ensure input sanitization)
# 3. CSRF Protection (at application level - ensure CSRF tokens)

# Rate limiting for API endpoints (configure in your application)
# Example: Use express-rate-limit or similar in NestJS

# File upload restrictions
# - Limit file size
# - Validate file types
# - Scan for malware
# - Store outside web root

# Session security
# - Use secure cookies
# - Set HttpOnly flag
# - Set SameSite attribute
# - Rotate session IDs

# Password policies (enforce in application)
# - Minimum 12 characters
# - Require uppercase, lowercase, numbers, special chars
# - Enforce password history
# - Account lockout after failed attempts

echo "Application-level security recommendations documented"
EOF

chmod +x /usr/local/bin/setup-app-security.sh
```

### 2.8 Network Intrusion Detection

```bash
# Install and configure AIDE (Advanced Intrusion Detection Environment)
apt install -y aide aide-common

# Initialize AIDE database
aideinit

# Create daily check script
cat > /usr/local/bin/aide-check.sh << 'EOF'
#!/bin/bash
# Daily AIDE integrity check

LOG_FILE="/var/log/aide-check.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$DATE] Starting AIDE integrity check..." >> $LOG_FILE

if aide --check >> $LOG_FILE 2>&1; then
    echo "[$DATE] AIDE check passed - no changes detected" >> $LOG_FILE
else
    echo "[$DATE] WARNING: AIDE detected file system changes!" >> $LOG_FILE
    # Send alert (configure email/webhook here)
fi
EOF

chmod +x /usr/local/bin/aide-check.sh

# Schedule daily checks (runs at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/aide-check.sh") | crontab -

# Install and configure rkhunter (Rootkit Hunter)
apt install -y rkhunter

# Update rkhunter database
rkhunter --update

# Configure rkhunter
sed -i 's/UPDATE_MIRRORS=.*/UPDATE_MIRRORS=1/' /etc/rkhunter.conf
sed -i 's/MIRRORS_MODE=.*/MIRRORS_MODE=0/' /etc/rkhunter.conf
sed -i 's/WEB_CMD=.*/WEB_CMD=""/' /etc/rkhunter.conf

# Run initial scan
rkhunter --check --skip-keypress --report-warnings-only

# Schedule weekly scans
(crontab -l 2>/dev/null; echo "0 3 * * 0 /usr/bin/rkhunter --check --skip-keypress --report-warnings-only >> /var/log/rkhunter.log 2>&1") | crontab -
```

### 2.9 Set Up Log Rotation

```bash
# Configure log rotation
cat > /etc/logrotate.d/healthcare-backend << 'EOF'
/var/log/healthcare-backend/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 admin admin
    sharedscripts
    postrotate
        systemctl reload rsyslog > /dev/null 2>&1 || true
    endscript
}
EOF
```

---

## 3. Firewall Configuration

### 3.1 Configure UFW (Uncomplicated Firewall)

**⚠️ IMPORTANT: Coturn Security**

Coturn (TURN/STUN server) is exposed on port 3478 for WebRTC. This is necessary
but requires additional security measures. See `docs/MASTER_COTURN_GUIDE.md` for
complete security setup.

```bash
# Reset UFW to defaults
ufw --force reset

# Set default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (IMPORTANT: Do this first!)
ufw allow 22/tcp comment 'SSH'

# Allow HTTP/HTTPS (for Cloudflare)
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Allow Coturn (TURN/STUN) - Required for WebRTC video calls
# ⚠️ SECURITY: Port 3478 is exposed - see docs/MASTER_COTURN_GUIDE.md for security setup
ufw allow 3478/udp comment 'Coturn TURN/STUN UDP'
ufw allow 3478/tcp comment 'Coturn TURN/STUN TCP'
ufw allow 49160:49200/udp comment 'Coturn media ports UDP'
ufw allow 49160:49200/tcp comment 'Coturn media ports TCP'

# Enable UFW
ufw --force enable

# Check status
ufw status verbose
```

### 3.2 Block Common Attack Ports

```bash
# Block common attack vectors
ufw deny 23/tcp comment 'Block Telnet'
ufw deny 135/tcp comment 'Block RPC'
ufw deny 139/tcp comment 'Block NetBIOS'
ufw deny 445/tcp comment 'Block SMB'
ufw deny 1433/tcp comment 'Block MSSQL'
ufw deny 3306/tcp comment 'Block MySQL'
ufw deny 3389/tcp comment 'Block RDP'
ufw deny 5432/tcp comment 'Block PostgreSQL (internal only)'
ufw deny 5900/tcp comment 'Block VNC'
ufw deny 8080/tcp comment 'Block alternative HTTP'
ufw deny 8443/tcp comment 'Block alternative HTTPS'
```

### 3.3 Rate Limiting and Connection Limits

```bash
# Add rate limiting rule for SSH
ufw limit 22/tcp comment 'SSH rate limit'

# Add connection limiting for HTTP/HTTPS
ufw limit 80/tcp comment 'HTTP rate limit'
ufw limit 443/tcp comment 'HTTPS rate limit'

# Block IPs that exceed rate limits (requires ufw with recent module)
# Note: UFW doesn't support advanced rate limiting, use iptables directly

# Configure advanced rate limiting with iptables
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent --set --name SSH
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent --update --seconds 60 --hitcount 4 --name SSH -j DROP

iptables -A INPUT -p tcp --dport 80 -m state --state NEW -m recent --set --name HTTP
iptables -A INPUT -p tcp --dport 80 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name HTTP -j DROP

iptables -A INPUT -p tcp --dport 443 -m state --state NEW -m recent --set --name HTTPS
iptables -A INPUT -p tcp --dport 443 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name HTTPS -j DROP

# Coturn (TURN/STUN) rate limiting - Prevent DDoS attacks
# ⚠️ SECURITY: Rate limit Coturn to prevent abuse
iptables -A INPUT -p udp --dport 3478 -m state --state NEW -m recent --set --name coturn-udp
iptables -A INPUT -p udp --dport 3478 -m state --state NEW -m recent --update --seconds 60 --hitcount 10 --name coturn-udp -j DROP
iptables -A INPUT -p tcp --dport 3478 -m state --state NEW -m recent --set --name coturn-tcp
iptables -A INPUT -p tcp --dport 3478 -m state --state NEW -m recent --update --seconds 60 --hitcount 10 --name coturn-tcp -j DROP
# Media ports rate limiting
iptables -A INPUT -p udp --dport 49160:49200 -m state --state NEW -m recent --set --name coturn-media-udp
iptables -A INPUT -p udp --dport 49160:49200 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name coturn-media-udp -j DROP
iptables -A INPUT -p tcp --dport 49160:49200 -m state --state NEW -m recent --set --name coturn-media-tcp
iptables -A INPUT -p tcp --dport 49160:49200 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name coturn-media-tcp -j DROP

# Save iptables rules
netfilter-persistent save

# Verify
ufw status | grep 22
iptables -L -n -v | grep -E "SSH|HTTP|HTTPS"
```

### 3.4 Block Known Attack Sources

```bash
# Download and block known malicious IP ranges
# Option 1: Use ipset with threat intelligence feeds
apt install -y ipset ipset-persistent

# Create ipset for malicious IPs
ipset create malicious_ips hash:net

# Add known bad IP ranges (example - update with current threat feeds)
# You can automate this with a script that downloads from threat intelligence feeds

# Block malicious IPs
iptables -I INPUT -m set --match-set malicious_ips src -j DROP

# Save ipset
ipset save > /etc/ipset.conf

# Create script to update malicious IPs
cat > /usr/local/bin/update-malicious-ips.sh << 'EOF'
#!/bin/bash
# Update malicious IP blocklist from threat intelligence feeds

# Example: Download from abuse.ch (adjust URLs as needed)
# curl -s https://feodotracker.abuse.ch/downloads/ipblocklist.txt | \
#   grep -v '^#' | \
#   while read ip; do
#     ipset add malicious_ips "$ip" 2>/dev/null || true
#   done

# Save updated ipset
ipset save > /etc/ipset.conf

echo "Malicious IP list updated"
EOF

chmod +x /usr/local/bin/update-malicious-ips.sh

# Schedule weekly updates
(crontab -l 2>/dev/null; echo "0 4 * * 0 /usr/local/bin/update-malicious-ips.sh") | crontab -
```

---

## 4. Docker Installation

### 4.1 Install Docker

```bash
# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update and install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group
usermod -aG docker admin

# Start and enable Docker
systemctl enable docker
systemctl start docker

# Verify installation
docker --version
docker compose version
```

### 4.2 Docker Security Configuration

```bash
# Configure Docker daemon security
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "userland-proxy": false,
  "no-new-privileges": true,
  "live-restore": true
}
EOF

# Restart Docker
systemctl restart docker

# Verify Docker is running
systemctl status docker
```

### 4.3 Create Application Directory

```bash
# Create directory for application
mkdir -p /opt/healthcare-backend
chown deploy:deploy /opt/healthcare-backend
chmod 755 /opt/healthcare-backend

# Create log directory
mkdir -p /var/log/healthcare-backend
chown deploy:deploy /var/log/healthcare-backend
```

---

## 5. Nginx Installation & Configuration

Nginx will act as a reverse proxy for your Docker containers, handling SSL
termination and routing traffic to the appropriate services.

> **Note:** For detailed Coturn (TURN/STUN) and OpenVidu configuration, see
> `docs/MASTER_COTURN_GUIDE.md`

### 5.1 Install Nginx

```bash
# Update package list
sudo apt update

# Install Nginx
sudo apt install -y nginx

# Check Nginx version
nginx -v

# Verify Nginx is running
sudo systemctl status nginx --no-pager | head -10
```

### 5.2 Install Certbot (Let's Encrypt SSL)

```bash
# Install Certbot and Nginx plugin
sudo apt install -y certbot python3-certbot-nginx

# Verify installation
certbot --version
```

### 5.3 Configure Nginx Sites

**Step 1: Copy Nginx Configuration Files**

```bash
# Navigate to application directory
cd /opt/healthcare-backend

# If repository is cloned, copy Nginx configs
# Otherwise, create them manually (see below)

# Copy API configuration
sudo cp devops/nginx/sites-available/api.ishswami.in /etc/nginx/sites-available/api.ishswami.in

# Copy video configuration (if using OpenVidu)
sudo cp devops/nginx/sites-available/video.ishswami.in /etc/nginx/sites-available/video.ishswami.in

# Or create basic configuration manually (see Step 2)
```

**Step 2: Create Basic Nginx Configuration (if files don't exist)**

If you don't have Nginx config files yet, create a basic one:

```bash
# Create API server configuration
sudo tee /etc/nginx/sites-available/api.ishswami.in > /dev/null << 'EOF'
# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name api.ishswami.in;

    # Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all HTTP requests to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.ishswami.in;

    # SSL certificates (will be managed by Certbot)
    # ssl_certificate /etc/letsencrypt/live/api.ishswami.in/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/api.ishswami.in/privkey.pem;
    # include /etc/letsencrypt/options-ssl-nginx.conf;
    # ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logging
    access_log /var/log/nginx/api.ishswami.in.access.log;
    error_log /var/log/nginx/api.ishswami.in.error.log;

    # Client body size (for file uploads)
    client_max_body_size 100M;

    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # Proxy to Docker container (port 8088 - adjust based on your docker-compose)
    location / {
        proxy_pass http://localhost:8088;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # WebSocket support (for Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:8088/health;
        access_log off;
    }
}
EOF

# Create Video server configuration (for OpenVidu)
# Note: Separate config needed because OpenVidu requires 86400s timeouts vs API's 60s
# See docs/MASTER_COTURN_GUIDE.md for detailed explanation
sudo tee /etc/nginx/sites-available/backend-service-v1-video.ishswami.in > /dev/null << 'EOF'
# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name backend-service-v1-video.ishswami.in;

    # Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all HTTP requests to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server for OpenVidu Video
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name backend-service-v1-video.ishswami.in;

    # SSL certificates (will be managed by Certbot)
    # ssl_certificate /etc/letsencrypt/live/backend-service-v1-video.ishswami.in/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/backend-service-v1-video.ishswami.in/privkey.pem;
    # include /etc/letsencrypt/options-ssl-nginx.conf;
    # ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logging
    access_log /var/log/nginx/backend-service-v1-video.ishswami.in.access.log;
    error_log /var/log/nginx/backend-service-v1-video.ishswami.in.error.log;

    # Client body size (for video uploads if needed)
    client_max_body_size 100M;

    # Timeouts (longer for video streaming - 24 hours for long video sessions)
    proxy_connect_timeout 60s;
    proxy_send_timeout 86400s;
    proxy_read_timeout 86400s;

    # Proxy to OpenVidu Docker container (port 4443)
    location / {
        proxy_pass http://127.0.0.1:4443;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # WebSocket support (required for OpenVidu video streaming)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Disable buffering for real-time video streaming
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # OpenVidu specific WebSocket endpoint
    location /openvidu {
        proxy_pass http://127.0.0.1:4443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }
}
EOF
```

**Step 3: Enable Nginx Sites**

```bash
# Enable API site
sudo ln -s /etc/nginx/sites-available/backend-service-v1.ishswami.in /etc/nginx/sites-enabled/backend-service-v1.ishswami.in

# Enable video site (for OpenVidu)
sudo ln -s /etc/nginx/sites-available/backend-service-v1-video.ishswami.in /etc/nginx/sites-enabled/backend-service-v1-video.ishswami.in

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t
```

### 5.4 Obtain SSL Certificates with Let's Encrypt

**Before running Certbot, ensure:**

1. DNS records point to your server IP
2. Ports 80 and 443 are open in firewall
3. Nginx configuration files are in place

```bash
# Obtain SSL certificate for API domain
sudo certbot --nginx -d backend-service-v1.ishswami.in

# Obtain SSL certificate for video domain (OpenVidu)
sudo certbot --nginx -d backend-service-v1-video.ishswami.in

# Note: You can obtain both certificates in one command:
# sudo certbot --nginx -d backend-service-v1.ishswami.in -d backend-service-v1-video.ishswami.in

# Certbot will automatically:
# - Obtain certificates
# - Update Nginx configuration with SSL settings
# - Set up automatic renewal
```

**Verify SSL certificates:**

```bash
# Check certificate status
sudo certbot certificates

# Test automatic renewal
sudo certbot renew --dry-run
```

### 5.5 Configure Automatic SSL Renewal

Certbot automatically sets up renewal, but verify it:

```bash
# Check renewal timer
sudo systemctl status certbot.timer

# View renewal schedule
sudo systemctl list-timers | grep certbot

# Certbot renewal runs twice daily and automatically reloads Nginx
```

### 5.6 Start and Enable Nginx

```bash
# Start Nginx
sudo systemctl start nginx

# Enable Nginx to start on boot
sudo systemctl enable nginx

# Check Nginx status
sudo systemctl status nginx --no-pager | head -15

# Reload Nginx (after configuration changes)
sudo systemctl reload nginx
```

### 5.7 Verify Nginx Configuration

```bash
# Test Nginx configuration syntax
sudo nginx -t

# Check Nginx is listening on ports 80 and 443
sudo ss -tlnp | grep nginx

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check Nginx access logs
sudo tail -f /var/log/nginx/api.ishswami.in.access.log
```

### 5.8 Configure Firewall for Nginx

```bash
# Ensure HTTP and HTTPS are allowed (should already be done)
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'

# Verify firewall rules
sudo ufw status | grep -E "80|443"
```

### 5.9 Nginx Security Hardening

```bash
# Hide Nginx version
sudo sed -i 's/# server_tokens off;/server_tokens off;/' /etc/nginx/nginx.conf

# Add security headers globally (optional - already in site configs)
sudo tee -a /etc/nginx/nginx.conf > /dev/null << 'EOF'

# Security Headers (if not already in site configs)
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
EOF

# Test and reload
sudo nginx -t && sudo systemctl reload nginx
```

### 5.10 Troubleshooting Nginx

**If Nginx fails to start:**

```bash
# Check configuration syntax
sudo nginx -t

# Check error logs
sudo tail -50 /var/log/nginx/error.log

# Check if ports are already in use
sudo ss -tlnp | grep -E ":80|:443"

# Check Nginx process
sudo systemctl status nginx
```

**If SSL certificate fails:**

```bash
# Check DNS resolution
dig api.ishswami.in

# Verify port 80 is accessible
curl -I http://api.ishswami.in

# Check Certbot logs
sudo tail -50 /var/log/letsencrypt/letsencrypt.log

# Retry certificate generation
sudo certbot --nginx -d api.ishswami.in --force-renewal
```

---

## 6. Application Deployment

### 5.1 Clone Repository

```bash
# Switch to admin user
su - admin

# Navigate to application directory
cd /opt/healthcare-backend

# Clone repository (use your actual repository URL)
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git .

# Or if using SSH:
# git clone git@github.com:YOUR_USERNAME/YOUR_REPO.git .
```

### 5.2 Set Up Environment Files

```bash
# Create .env.production file
cd /opt/healthcare-backend
vim .env.production

# Copy from your existing .env.production or use the template
# Ensure all secrets are properly configured

# Set secure permissions
chmod 600 .env.production
chown admin:admin .env.production
```

### 5.3 Configure Docker Compose

```bash
# Review docker-compose.prod.yml
cd /opt/healthcare-backend/devops/docker
cat docker-compose.prod.yml

# Ensure PostgreSQL port is NOT exposed publicly
# It should only be accessible from Docker network

# Verify no public port mappings for sensitive services
grep -E "5432|6379" docker-compose.prod.yml
```

### 5.4 Deploy Application

```bash
# Make scripts executable
chmod +x /opt/healthcare-backend/devops/scripts/**/*.sh

# Run deployment script
cd /opt/healthcare-backend
./devops/scripts/docker-infra/deploy.sh

# Or use docker compose directly
cd /opt/healthcare-backend/devops/docker
docker compose -f docker-compose.prod.yml --profile infrastructure up -d
docker compose -f docker-compose.prod.yml up -d
```

### 5.5 Verify Deployment

```bash
# Check container status
docker ps

# Check logs
docker logs healthcare-api
docker logs healthcare-worker

# Verify health endpoints
curl http://localhost:3000/health
```

---

## 7. Cloudflare Integration

### 6.1 Configure DNS

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your domain
3. Go to **DNS** → **Records**
4. Add/Update these records:

| Type | Name               | Content        | Proxy      | TTL  |
| ---- | ------------------ | -------------- | ---------- | ---- |
| A    | backend-service-v1 | YOUR_SERVER_IP | ✅ Proxied | Auto |
| A    | www                | YOUR_SERVER_IP | ✅ Proxied | Auto |

### 6.2 SSL/TLS Configuration

1. Go to **SSL/TLS** → **Overview**
2. Set encryption mode to **Full (strict)**
3. Enable **Always Use HTTPS**
4. Enable **Automatic HTTPS Rewrites**

### 6.3 Firewall Rules

1. Go to **Security** → **WAF** → **Custom rules**
2. Create rule: **Block all IPs except whitelisted**
   - Field: `IP Source Address`
   - Operator: `is not in`
   - Value: `YOUR_IP_1, YOUR_IP_2, YOUR_IP_3`
   - Action: `Block`

3. Create rule: **Rate limiting**
   - Field: `Request Rate`
   - Operator: `is greater than`
   - Value: `100 requests per minute`
   - Action: `Block`

### 6.4 Security Settings

1. **Security** → **Settings**:
   - Security Level: **High**
   - Challenge Passage: **30 minutes**
   - Browser Integrity Check: **On**

2. **Speed** → **Optimization**:
   - Auto Minify: Enable for JS, CSS, HTML
   - Brotli: **On**

3. **Network**:
   - HTTP/2: **On**
   - HTTP/3 (with QUIC): **On**
   - 0-RTT Connection Resumption: **On**

---

## 8. Monitoring & Logging

### 7.1 Set Up Log Monitoring

```bash
# Create log directory
mkdir -p /var/log/healthcare-backend
chown admin:admin /var/log/healthcare-backend

# Configure rsyslog for application logs
cat > /etc/rsyslog.d/30-healthcare-backend.conf << 'EOF'
# Healthcare Backend Application Logs
$ModLoad imfile
$InputFileName /opt/healthcare-backend/logs/app.log
$InputFileTag healthcare-api:
$InputFileStateFile healthcare-api-state
$InputFileSeverity info
$InputFileFacility local0
$InputRunFileMonitor

local0.*    /var/log/healthcare-backend/app.log
EOF

# Restart rsyslog
systemctl restart rsyslog
```

### 7.2 Set Up Monitoring Scripts

```bash
# Create monitoring script
cat > /opt/healthcare-backend/scripts/monitor.sh << 'EOF'
#!/bin/bash
# Health check monitoring script

LOG_FILE="/var/log/healthcare-backend/monitor.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Check Docker containers
if ! docker ps | grep -q "healthcare-api"; then
    echo "[$DATE] ERROR: healthcare-api container is down" >> $LOG_FILE
    # Add alerting here (email, webhook, etc.)
fi

# Check disk space
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
    echo "[$DATE] WARNING: Disk usage is ${DISK_USAGE}%" >> $LOG_FILE
fi

# Check memory
MEM_USAGE=$(free | grep Mem | awk '{printf("%.0f", $3/$2 * 100)}')
if [ "$MEM_USAGE" -gt 90 ]; then
    echo "[$DATE] WARNING: Memory usage is ${MEM_USAGE}%" >> $LOG_FILE
fi
EOF

chmod +x /opt/healthcare-backend/scripts/monitor.sh

# Add to crontab (run every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/healthcare-backend/scripts/monitor.sh") | crontab -
```

---

## 9. Backup Configuration

### 8.1 Configure Automated Backups

```bash
# Ensure backup script is executable
chmod +x /opt/healthcare-backend/devops/scripts/docker-infra/backup.sh

# Test backup
cd /opt/healthcare-backend
./devops/scripts/docker-infra/backup.sh test

# Set up daily backups (runs at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * cd /opt/healthcare-backend && ./devops/scripts/docker-infra/backup.sh daily") | crontab -
```

### 8.2 Verify Backup Storage

```bash
# Check backup directory
ls -lh /opt/healthcare-backend/backups/

# Verify S3 configuration (if using)
# Test S3 upload
./devops/scripts/docker-infra/backup.sh test-s3
```

---

## 10. Post-Deployment Verification

### 9.1 Security Audit

```bash
# Run security audit
lynis audit system

# Review report
cat /var/log/lynis.log
```

### 9.2 Network Security Check

```bash
# Check open ports
netstat -tulpn | grep LISTEN

# Verify firewall rules
ufw status verbose

# Check for exposed services
ss -tulpn
```

### 9.3 Application Health Check

```bash
# Check all containers are running
docker ps

# Check container health
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Test API endpoint
curl -I https://backend-service-v1.yourdomain.com/health

# Check logs for errors
docker logs healthcare-api --tail 100
docker logs healthcare-worker --tail 100
```

### 9.4 Performance Check

```bash
# Check system resources
htop

# Check disk usage
df -h

# Check memory
free -h

# Check Docker resource usage
docker stats --no-stream
```

---

## 11. Security Checklist

### ✅ Pre-Setup

- [ ] Server provisioned with Ubuntu 24 LTS
- [ ] Root SSH access available
- [ ] Current IP address noted
- [ ] Backup of any existing data (if migrating)

### ✅ Initial Setup

- [ ] Connected to server via SSH
- [ ] System updated (`apt update && apt upgrade`)
- [ ] Essential tools installed
- [ ] Admin user created
- [ ] SSH keys copied to admin user
- [ ] Tested login as admin user
- [ ] Root login disabled

### ✅ SSH Security

- [ ] Password authentication disabled
- [ ] Only key-based authentication enabled
- [ ] Strong ciphers configured
- [ ] Max authentication attempts: 3
- [ ] Idle timeout: 10 minutes
- [ ] Only authorized users can SSH
- [ ] SSH config tested (`sshd -t`)
- [ ] SSH service restarted

### ✅ Firewall (UFW)

- [ ] UFW installed
- [ ] Default deny incoming
- [ ] Default allow outgoing
- [ ] SSH port (22) allowed
- [ ] HTTP (80) allowed
- [ ] HTTPS (443) allowed
- [ ] Rate limiting enabled for SSH
- [ ] Common attack ports blocked
- [ ] PostgreSQL port (5432) NOT exposed
- [ ] UFW enabled and active

### ✅ Fail2Ban & Brute Force Protection

- [ ] Fail2Ban installed
- [ ] SSH jail configured (24 hour ban)
- [ ] SSH DDoS protection enabled
- [ ] SSH repeater protection enabled
- [ ] Invalid user protection enabled (zero tolerance)
- [ ] Recidive jail enabled (repeat offenders)
- [ ] Ban time: 24 hours (increased from 1 hour)
- [ ] Max retries: 3
- [ ] Fail2Ban service running
- [ ] Status checked
- [ ] DenyHosts installed and configured (optional)
- [ ] SSH connection rate limiting configured
- [ ] MaxStartups and MaxSessions limited
- [ ] LoginGraceTime set to 30 seconds

### ✅ Automatic Updates

- [ ] Unattended upgrades configured
- [ ] Security updates enabled
- [ ] Automatic cleanup enabled
- [ ] Service enabled and running

### ✅ Kernel Hardening

- [ ] IP forwarding disabled
- [ ] Source routing disabled
- [ ] ICMP redirects disabled
- [ ] SYN flood protection enabled
- [ ] IP spoofing protection enabled
- [ ] Sysctl parameters applied

### ✅ Attack Prevention & DDoS Protection

- [ ] Fail2Ban configured with multiple jails
- [ ] SSH brute force protection active
- [ ] Connection rate limiting configured
- [ ] IP reputation blocking set up (ipset)
- [ ] Attack monitoring script installed
- [ ] Suspicious activity detection active
- [ ] DDoS protection rules configured (iptables)
- [ ] Rate limiting for HTTP/HTTPS
- [ ] Invalid packet filtering enabled
- [ ] ICMP flood protection enabled
- [ ] Port scan detection active
- [ ] AIDE (file integrity) installed and configured
- [ ] Rkhunter (rootkit detection) installed
- [ ] Daily integrity checks scheduled
- [ ] Weekly rootkit scans scheduled
- [ ] Malicious IP blocklist updated regularly

### ✅ Docker Installation

- [ ] Docker repository added
- [ ] Docker installed
- [ ] Docker Compose installed
- [ ] Deploy user added to docker group
- [ ] Docker daemon security configured
- [ ] Docker service running
- [ ] Docker version verified

### ✅ Nginx Installation & Configuration

- [ ] Nginx installed
- [ ] Nginx configuration files created (API and Video domains)
- [ ] Nginx sites enabled (backend-service-v1.ishswami.in and
      backend-service-v1-video.ishswami.in)
- [ ] SSL certificates obtained (Let's Encrypt) for both domains
- [ ] Certbot automatic renewal configured
- [ ] Nginx security headers configured
- [ ] Nginx version hidden
- [ ] Nginx service running
- [ ] Nginx configuration tested (`nginx -t`)
- [ ] HTTP to HTTPS redirect working
- [ ] SSL certificates valid
- [ ] Firewall allows ports 80 and 443
- [ ] Video domain configured with 86400s timeouts for OpenVidu
- [ ] WebSocket support enabled for video domain

### ✅ GitHub Actions SSH Configuration

- [ ] SSH key generated for GitHub Actions
- [ ] SSH public key added to server (`authorized_keys`)
- [ ] SSH private key added to GitHub Secrets (`SSH_PRIVATE_KEY`)
- [ ] Server host added to GitHub Secrets (`SERVER_HOST`)
- [ ] Server user added to GitHub Secrets (`SERVER_USER`)
- [ ] Deployment path added to GitHub Secrets (`SERVER_DEPLOY_PATH`)
- [ ] SSH connection tested from GitHub Actions
- [ ] GitHub Actions workflow verified

### ✅ Application Deployment

- [ ] Application directory created (`/opt/healthcare-backend`)
- [ ] Repository cloned
- [ ] `.env.production` file created
- [ ] Environment file permissions: 600
- [ ] Docker Compose file reviewed
- [ ] PostgreSQL port NOT exposed in docker-compose
- [ ] Infrastructure containers started
- [ ] Application containers started
- [ ] All containers healthy
- [ ] Health endpoint accessible

### ✅ Cloudflare Configuration

- [ ] Domain added to Cloudflare
- [ ] DNS records configured (api, www, root domain)
- [ ] DNS propagation verified
- [ ] SSL/TLS mode: Full (strict)
- [ ] Always Use HTTPS: Enabled
- [ ] Automatic HTTPS Rewrites: Enabled
- [ ] IP whitelist rule created
- [ ] Block rule for non-whitelisted IPs
- [ ] Rate limiting rule configured
- [ ] Security Level: High
- [ ] Challenge Passage: 30 minutes
- [ ] Browser Integrity Check: On
- [ ] WAF enabled

### ✅ Monitoring & Logging

- [ ] Log directory created
- [ ] Log rotation configured
- [ ] Monitoring script created
- [ ] Cron jobs configured
- [ ] Log monitoring active

### ✅ Backup Configuration

- [ ] Backup script tested
- [ ] Backup directory created
- [ ] S3 configuration verified (if using)
- [ ] Automated backups scheduled
- [ ] Restore procedure tested

### ✅ Post-Deployment Verification

- [ ] Security audit completed (lynis)
- [ ] No critical vulnerabilities found
- [ ] Open ports reviewed
- [ ] No unnecessary ports exposed
- [ ] Firewall rules verified
- [ ] All containers running
- [ ] Health endpoints responding
- [ ] API accessible via HTTPS
- [ ] No errors in logs
- [ ] System resources adequate
- [ ] Disk space sufficient
- [ ] Memory usage acceptable
- [ ] Docker resource usage normal

### ✅ Documentation & Emergency Preparedness

- [ ] Server setup documented
- [ ] IP addresses recorded
- [ ] SSH keys backed up
- [ ] Passwords stored securely
- [ ] Configuration files backed up
- [ ] Backup tested and verified
- [ ] Restore procedure documented
- [ ] Emergency contacts listed
- [ ] Recovery plan documented

---

## 12. Maintenance Schedule

### Weekly Tasks

- [ ] Review security logs
- [ ] Check disk space
- [ ] Verify backups
- [ ] Check for updates

### Monthly Tasks

- [ ] Review firewall rules
- [ ] Audit user access
- [ ] Security updates
- [ ] Review Cloudflare analytics

### Quarterly Tasks

- [ ] Full security audit
- [ ] Update firewall rules
- [ ] Test disaster recovery
- [ ] Update documentation

---

## 13. Troubleshooting

### Issue: Can't connect via SSH

**Solution:**

```bash
# Check firewall
ufw status

# Verify SSH is running
systemctl status ssh

# Check if port 22 is open
netstat -tulpn | grep 22
```

### Issue: Docker Containers Won't Start

**Solution:**

```bash
# Check logs
docker compose logs

# Verify .env.production exists
ls -la /opt/healthcare-backend/.env.production

# Check disk space
df -h

# Check Docker
systemctl status docker
```

### Issue: API Not Accessible

**Solution:**

```bash
# Check containers
docker ps

# Check application logs
docker logs healthcare-api --tail 100

# Test locally
curl http://localhost:3000/health

# Check Cloudflare DNS
dig backend-service-v1.yourdomain.com
```

### Issue: PostgreSQL Connection Failed

**Solution:**

```bash
# Verify PostgreSQL is running
docker ps | grep postgres

# Check PostgreSQL logs
docker logs postgres

# Verify DATABASE_URL in .env.production
grep DATABASE_URL /opt/healthcare-backend/.env.production

# Test connection from container
docker exec -it healthcare-api ping postgres
```

### Issue: Under Brute Force Attack

**Solution:**

```bash
# Check Fail2Ban status
fail2ban-client status sshd

# View banned IPs
fail2ban-client status sshd | grep "Banned IP list"

# Manually ban an IP
fail2ban-client set sshd banip ATTACKER_IP

# Check attack logs
tail -f /var/log/auth.log | grep "Failed password"

# Check attack monitoring
tail -f /var/log/attack-monitor.log

# Temporarily block IP with UFW
ufw deny from ATTACKER_IP

# Check for port scanning
netstat -an | grep SYN_RECV | wc -l
```

### Issue: DDoS Attack

**Solution:**

```bash
# Check current connections
netstat -an | grep ESTABLISHED | wc -l

# Check for SYN flood
netstat -an | grep SYN_RECV | wc -l

# View iptables rate limiting stats
iptables -L -n -v | grep -E "SSH|HTTP|HTTPS"

# Temporarily block suspicious IPs
ufw deny from SUSPICIOUS_IP

# Check system load
htop

# Check network traffic
iftop -i eth0

# Enable emergency mode (block all except SSH from trusted IPs)
# WARNING: Only do this if you have console access!
ufw default deny incoming
ufw allow from YOUR_TRUSTED_IP to any port 22
```

### Issue: Suspicious File Changes Detected

**Solution:**

```bash
# Run AIDE check manually
aide --check

# Update AIDE database (after verifying changes are legitimate)
aideupdate

# Check rkhunter for rootkits
rkhunter --check

# Review recent file changes
find / -type f -mtime -1 -ls

# Check for unauthorized processes
ps aux | grep -v "\[.*\]"

# Check for unauthorized network connections
netstat -tulpn | grep -v "127.0.0.1"
```

---

## 🎯 Quick Commands Reference

```bash
# Check firewall status
ufw status verbose

# Check Fail2Ban status
fail2ban-client status

# Check Docker containers
docker ps

# Check system resources
htop

# Check disk space
df -h

# View application logs
docker logs healthcare-api --tail 100

# Test health endpoint
curl https://backend-service-v1.yourdomain.com/health

# Check open ports
netstat -tulpn | grep LISTEN

# Restart services
docker compose -f devops/docker/docker-compose.prod.yml restart
```

---

## 📚 Additional Resources

- [Ubuntu Security Guide](https://ubuntu.com/security)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Cloudflare Security Documentation](https://developers.cloudflare.com/security/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

## ⚠️ Important Notes

1. **Always test in staging first** before applying to production
2. **Keep SSH session open** when making SSH configuration changes
3. **Backup before major changes**
4. **Document all custom configurations**
5. **Regular security audits are essential**
6. **Monitor logs regularly**
7. **Keep software updated**

---

**Last Updated:** 2026-01-05  
**Version:** 2.0  
**Maintained by:** Healthcare Backend Team
