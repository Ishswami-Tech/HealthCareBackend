#!/usr/bin/env bash
# Automated setup script for containerd/k3s on WSL2
# This script installs k3s, nerdctl, and buildkit

set -euo pipefail

echo "🚀 Healthcare Backend - Containerd/k3s Setup for WSL2"
echo "====================================================="
echo ""

# Check if running in WSL2
if [ ! -f /proc/version ] || ! grep -q "microsoft" /proc/version; then
    echo "⚠️  Warning: This doesn't appear to be WSL2"
    echo "   Continuing anyway, but this script is designed for WSL2"
    echo ""
fi

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "❌ Please don't run this script as root"
    echo "   The script will use sudo when needed"
    exit 1
fi

echo "📋 This script will install:"
echo "   1. k3s (Kubernetes with containerd)"
echo "   2. nerdctl (containerd CLI)"
echo "   3. BuildKit (for building images)"
echo "   4. kubectl configuration"
echo ""

read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "🔍 Checking prerequisites..."

# Check for curl
if ! command -v curl &> /dev/null; then
    echo "❌ curl not found. Installing..."
    sudo apt-get update && sudo apt-get install -y curl
fi

# Check for wget
if ! command -v wget &> /dev/null; then
    echo "❌ wget not found. Installing..."
    sudo apt-get update && sudo apt-get install -y wget
fi

echo "✅ Prerequisites check complete"
echo ""

# Step 1: Install k3s
echo "📦 Step 1/4: Installing k3s..."
if command -v k3s &> /dev/null; then
    echo "   k3s is already installed: $(k3s --version 2>&1 | head -n 1)"
    read -p "   Reinstall k3s? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "   Uninstalling existing k3s..."
        /usr/local/bin/k3s-uninstall.sh 2>/dev/null || true
        echo "   Installing k3s..."
        curl -sfL https://get.k3s.io | sh -
    else
        echo "   Skipping k3s installation"
    fi
else
    curl -sfL https://get.k3s.io | sh -
fi

# Verify k3s is running
if sudo systemctl is-active --quiet k3s; then
    echo "✅ k3s installed and running"
else
    echo "⚠️  k3s installed but not running. Starting..."
    sudo systemctl start k3s
    sleep 5
    if sudo systemctl is-active --quiet k3s; then
        echo "✅ k3s is now running"
    else
        echo "❌ Failed to start k3s. Check logs: sudo journalctl -u k3s"
        exit 1
    fi
fi

echo ""

# Step 2: Install nerdctl
echo "📦 Step 2/4: Installing nerdctl..."
if command -v nerdctl &> /dev/null; then
    echo "   nerdctl is already installed: $(nerdctl version 2>&1 | head -n 1)"
else
    echo "   Downloading nerdctl..."
    NERDCTL_VERSION="1.7.0"
    wget -q https://github.com/containerd/nerdctl/releases/download/v${NERDCTL_VERSION}/nerdctl-${NERDCTL_VERSION}-linux-amd64.tar.gz
    
    echo "   Extracting nerdctl..."
    tar -xzf nerdctl-${NERDCTL_VERSION}-linux-amd64.tar.gz
    
    echo "   Installing nerdctl..."
    sudo mv nerdctl /usr/local/bin/
    sudo chmod +x /usr/local/bin/nerdctl
    
    echo "   Cleaning up..."
    rm nerdctl-${NERDCTL_VERSION}-linux-amd64.tar.gz
    
    echo "✅ nerdctl installed: $(nerdctl version 2>&1 | head -n 1)"
fi

echo ""

# Step 3: Install BuildKit
echo "📦 Step 3/4: Installing BuildKit..."
if command -v buildkitd &> /dev/null && command -v buildctl &> /dev/null; then
    echo "   BuildKit is already installed"
else
    echo "   Downloading BuildKit..."
    BUILDKIT_VERSION="0.12.0"
    wget -q https://github.com/moby/buildkit/releases/download/v${BUILDKIT_VERSION}/buildkit-v${BUILDKIT_VERSION}.linux-amd64.tar.gz
    
    echo "   Extracting BuildKit..."
    tar -xzf buildkit-v${BUILDKIT_VERSION}.linux-amd64.tar.gz
    
    echo "   Installing BuildKit..."
    sudo mv bin/buildctl /usr/local/bin/
    sudo mv bin/buildkitd /usr/local/bin/
    sudo chmod +x /usr/local/bin/buildctl
    sudo chmod +x /usr/local/bin/buildkitd
    
    echo "   Cleaning up..."
    rm -rf bin buildkit-v${BUILDKIT_VERSION}.linux-amd64.tar.gz
    
    echo "✅ BuildKit installed"
fi

echo ""

# Step 4: Configure kubectl
echo "📦 Step 4/4: Configuring kubectl..."
if [ ! -d ~/.kube ]; then
    mkdir -p ~/.kube
fi

if [ -f /etc/rancher/k3s/k3s.yaml ]; then
    echo "   Copying k3s kubeconfig..."
    sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
    sudo chown $USER:$USER ~/.kube/config
    chmod 600 ~/.kube/config
    
    # Update server URL to use localhost
    sed -i 's/127.0.0.1/localhost/g' ~/.kube/config
    
    echo "✅ kubectl configured"
else
    echo "⚠️  k3s kubeconfig not found. You may need to configure kubectl manually"
fi

echo ""

# Verify installation
echo "🔍 Verifying installation..."
echo ""

echo "   k3s status:"
if sudo systemctl is-active --quiet k3s; then
    echo "   ✅ k3s is running"
    echo "   Version: $(k3s --version 2>&1 | head -n 1)"
else
    echo "   ❌ k3s is not running"
fi

echo ""

echo "   nerdctl:"
if command -v nerdctl &> /dev/null; then
    echo "   ✅ nerdctl installed: $(nerdctl version 2>&1 | head -n 1)"
else
    echo "   ❌ nerdctl not found"
fi

echo ""

echo "   BuildKit:"
if command -v buildkitd &> /dev/null && command -v buildctl &> /dev/null; then
    echo "   ✅ BuildKit installed"
else
    echo "   ❌ BuildKit not found"
fi

echo ""

echo "   kubectl:"
if [ -f ~/.kube/config ]; then
    if command -v kubectl &> /dev/null; then
        echo "   ✅ kubectl configured"
        echo "   Cluster info:"
        kubectl cluster-info 2>&1 | head -n 1 || echo "   ⚠️  Could not connect to cluster"
        echo "   Nodes:"
        kubectl get nodes 2>&1 || echo "   ⚠️  Could not get nodes"
    else
        echo "   ⚠️  kubectl not installed. Install with: sudo apt-get install -y kubectl"
    fi
else
    echo "   ⚠️  kubeconfig not found"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Build image: ./devops/kubernetes/scripts/build-containerd.sh"
echo "   2. Deploy: ./devops/kubernetes/scripts/deploy-containerd.sh"
echo "   3. Or use npm: npm run k8s:containerd:build && npm run k8s:containerd:deploy"
echo ""
echo "💡 Useful commands:"
echo "   - Check k3s: sudo systemctl status k3s"
echo "   - View k3s logs: sudo journalctl -u k3s -f"
echo "   - List images: sudo nerdctl --namespace k8s.io images"
echo "   - Check cluster: kubectl get nodes"
echo ""


