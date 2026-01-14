# SSH Tunnel Setup Guide for Database Access

## 🎯 Quick Start

This guide will help you create a secure SSH tunnel to access your PostgreSQL
database from DBeaver.

---

## 📋 Prerequisites

### 1. Check if SSH is Available

**Windows 10/11 (Built-in SSH):**

- Open PowerShell or Command Prompt
- Type: `ssh -V`
- If you see version info, SSH is installed ✅
- If not, see "Install SSH" section below

**Windows 7/8:**

- Need to install OpenSSH or use PuTTY
- See "Install SSH" section below

### 2. Get Your Server Details

You'll need:

- **Server Domain/IP:** `backend-service-v1.ishswami.in`
- **SSH Username:** (usually `root`, `deploy`, `ubuntu`, or your username)
- **SSH Port:** (usually `22`, but may be different)
- **SSH Key/Password:** (your authentication method)

---

## 🚀 Method 1: Windows Built-in SSH (Windows 10/11)

### Step 1: Open PowerShell or Command Prompt

Press `Win + X` and select "Windows PowerShell" or "Terminal"

### Step 2: Create SSH Tunnel

**Basic command:**

```bash
ssh -L 5432:localhost:5432 username@backend-service-v1.ishswami.in
```

**With SSH key:**

```bash
ssh -L 5432:localhost:5432 -i "C:\path\to\your\private_key" username@backend-service-v1.ishswami.in
```

**With custom SSH port (if not 22):**

```bash
ssh -L 5432:localhost:5432 -p 2222 username@backend-service-v1.ishswami.in
```

**Example (with password authentication):**

```bash
ssh -L 5432:localhost:5432 deploy@backend-service-v1.ishswami.in
```

### Step 3: Authenticate

- If using password: Enter your SSH password when prompted
- If using SSH key: Enter passphrase if key is encrypted
- You should see: `Welcome to...` or similar server message

### Step 4: Keep Terminal Open

**IMPORTANT:** Keep the terminal window open! The tunnel stays active as long as
the SSH connection is open.

**You'll see something like:**

```
Welcome to Ubuntu 22.04 LTS
Last login: ...
deploy@server:~$
```

**This means the tunnel is active!** ✅

---

## 🔧 Method 2: PuTTY (Windows 7/8 or Alternative)

### Step 1: Download PuTTY

1. Download from: https://www.putty.org/
2. Install PuTTY

### Step 2: Configure SSH Tunnel in PuTTY

1. **Open PuTTY**

2. **Session Settings:**
   - **Host Name:** `backend-service-v1.ishswami.in`
   - **Port:** `22` (or your SSH port)
   - **Connection Type:** SSH

3. **Configure Tunnel:**
   - Go to: **Connection → SSH → Tunnels**
   - **Source port:** `5432`
   - **Destination:** `localhost:5432`
   - Click **"Add"**
   - You should see: `L5432 localhost:5432` in the list

4. **Save Session (Optional):**
   - Go back to **Session**
   - Enter name: `Database Tunnel`
   - Click **"Save"**

5. **Connect:**
   - Click **"Open"**
   - Enter username and password when prompted
   - Keep PuTTY window open (tunnel stays active)

---

## ✅ Verify Tunnel is Working

### Test 1: Check if Port is Listening

**In a NEW PowerShell window:**

```powershell
netstat -an | findstr :5432
```

**You should see:**

```
TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING
```

### Test 2: Test Connection with psql (if installed)

```bash
psql -h localhost -p 5432 -U postgres -d userdb
```

**Or test with telnet:**

```bash
telnet localhost 5432
```

If connection succeeds, tunnel is working! ✅

---

## 🗄️ Connect DBeaver to Tunnel

### Step 1: Open DBeaver

1. Open DBeaver
2. Click **"New Database Connection"** (plug icon)
3. Select **PostgreSQL**

### Step 2: Configure Connection

**Main Tab:**

- **Host:** `localhost` (NOT the server IP!)
- **Port:** `5432`
- **Database:** `userdb`
- **Username:** `postgres`
- **Password:** `postgres`

**Advanced Settings (Optional):**

- **Connection timeout:** `10`
- **Keep-alive:** `30`

### Step 3: Test Connection

1. Click **"Test Connection"**
2. If prompted, download PostgreSQL driver
3. Should see: **"Connected"** ✅

### Step 4: Save and Connect

1. Click **"Finish"**
2. Connection appears in Database Navigator
3. Expand to see tables

---

## 🔐 Using SSH Keys (More Secure)

### Step 1: Generate SSH Key (if you don't have one)

**In PowerShell:**

```powershell
ssh-keygen -t ed25519 -C "your_email@example.com"
```

**Or RSA (if ed25519 not supported):**

```powershell
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
```

**Follow prompts:**

- Save location: Press Enter (default: `C:\Users\YourName\.ssh\id_ed25519`)
- Passphrase: Enter a strong passphrase (or press Enter for no passphrase)

### Step 2: Copy Public Key to Server

**Option A: Using ssh-copy-id (if available):**

```bash
ssh-copy-id username@backend-service-v1.ishswami.in
```

**Option B: Manual copy:**

1. **Get your public key:**

   ```powershell
   type C:\Users\YourName\.ssh\id_ed25519.pub
   ```

2. **Copy the output** (starts with `ssh-ed25519` or `ssh-rsa`)

3. **SSH to server and add key:**
   ```bash
   ssh username@backend-service-v1.ishswami.in
   mkdir -p ~/.ssh
   echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   chmod 700 ~/.ssh
   ```

### Step 3: Use Key for Tunnel

**In PowerShell:**

```bash
ssh -L 5432:localhost:5432 -i "C:\Users\YourName\.ssh\id_ed25519" username@backend-service-v1.ishswami.in
```

---

## 🛠️ Troubleshooting

### Problem: "Connection refused" or "Connection timed out"

**Solutions:**

1. **Check SSH is accessible:**

   ```bash
   ssh username@backend-service-v1.ishswami.in
   ```

   If this fails, SSH is not accessible

2. **Check SSH port:**
   - Try different ports: `-p 2222`, `-p 2200`
   - Contact server admin for correct port

3. **Check firewall:**
   - Server firewall may block SSH
   - Contact server admin

### Problem: "Port 5432 already in use"

**Solution:**

1. **Find what's using port 5432:**

   ```powershell
   netstat -ano | findstr :5432
   ```

2. **Kill the process** (replace PID with actual process ID):

   ```powershell
   taskkill /PID <PID> /F
   ```

3. **Or use different local port:**
   ```bash
   ssh -L 5433:localhost:5432 username@backend-service-v1.ishswami.in
   ```
   Then in DBeaver, use port `5433` instead of `5432`

### Problem: "Permission denied (publickey)"

**Solutions:**

1. **Use password authentication:**

   ```bash
   ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -L 5432:localhost:5432 username@backend-service-v1.ishswami.in
   ```

2. **Check SSH key path:**
   - Ensure path is correct
   - Use forward slashes or escaped backslashes: `C:/Users/...` or
     `C:\\Users\\...`

3. **Check key permissions (if on WSL/Linux):**
   ```bash
   chmod 600 ~/.ssh/id_ed25519
   ```

### Problem: Tunnel disconnects frequently

**Solutions:**

1. **Add keep-alive:**

   ```bash
   ssh -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -L 5432:localhost:5432 username@backend-service-v1.ishswami.in
   ```

2. **Use PuTTY** (has better connection management)

3. **Check network stability**

### Problem: DBeaver can't connect through tunnel

**Solutions:**

1. **Verify tunnel is active:**

   ```powershell
   netstat -an | findstr :5432
   ```

   Should show `LISTENING`

2. **Check DBeaver settings:**
   - Host: Must be `localhost` (not server IP)
   - Port: Must be `5432` (or your tunnel port)

3. **Test with psql:**
   ```bash
   psql -h localhost -p 5432 -U postgres -d userdb
   ```

---

## 📝 Quick Reference Commands

### Create Tunnel (Password Auth)

```bash
ssh -L 5432:localhost:5432 username@backend-service-v1.ishswami.in
```

### Create Tunnel (SSH Key)

```bash
ssh -L 5432:localhost:5432 -i "C:\path\to\key" username@backend-service-v1.ishswami.in
```

### Create Tunnel (Custom Port + Keep-Alive)

```bash
ssh -o ServerAliveInterval=60 -L 5432:localhost:5432 -p 2222 username@backend-service-v1.ishswami.in
```

### Check if Tunnel is Active

```powershell
netstat -an | findstr :5432
```

### Test Database Connection

```bash
psql -h localhost -p 5432 -U postgres -d userdb
```

---

## 🔄 Making Tunnel Persistent (Optional)

### Option 1: Windows Task Scheduler

1. **Create batch file** (`tunnel.bat`):

   ```batch
   @echo off
   ssh -L 5432:localhost:5432 -o ServerAliveInterval=60 username@backend-service-v1.ishswami.in
   ```

2. **Schedule task:**
   - Open Task Scheduler
   - Create Basic Task
   - Trigger: "When I log on"
   - Action: "Start a program"
   - Program: `C:\path\to\tunnel.bat`

### Option 2: AutoSSH (Linux/WSL)

If using WSL:

```bash
autossh -M 20000 -L 5432:localhost:5432 username@backend-service-v1.ishswami.in
```

---

## ✅ Success Checklist

- [ ] SSH client installed/available
- [ ] Can SSH to server: `ssh username@backend-service-v1.ishswami.in`
- [ ] Tunnel created: `ssh -L 5432:localhost:5432 ...`
- [ ] Terminal shows server prompt (tunnel active)
- [ ] Port 5432 listening: `netstat -an | findstr :5432`
- [ ] DBeaver connects to `localhost:5432`
- [ ] Can see database tables in DBeaver

---

## 🆘 Still Having Issues?

1. **Check server SSH access:**

   ```bash
   ssh -v username@backend-service-v1.ishswami.in
   ```

   The `-v` flag shows detailed connection info

2. **Contact server administrator** for:
   - Correct SSH username
   - SSH port number
   - SSH key setup
   - Firewall rules

3. **Verify database is running:**
   ```bash
   ssh username@backend-service-v1.ishswami.in
   docker ps | grep postgres
   ```

---

## 📚 Additional Resources

- **SSH Tunnel Guide:** https://www.ssh.com/academy/ssh/tunneling
- **PuTTY Documentation:** https://www.chiark.greenend.org.uk/~sgtatham/putty/
- **DBeaver Documentation:** https://dbeaver.com/docs/

---

**Need help?** Check the troubleshooting section or verify each step in the
success checklist!
