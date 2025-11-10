#!/bin/bash

# Kubernetes Cluster Setup Script for Contabo VPS
# This script helps automate the setup process for Kubernetes on Contabo servers
# Usage: ./setup-contabo-cluster.sh [master|worker]

set -e

NODE_TYPE=${1:-""}
CONTROL_PLANE_IP=${2:-""}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then 
        log_error "Please run as root or with sudo"
        exit 1
    fi
}

prepare_system() {
    log_info "Preparing system..."
    
    # Update system
    apt update && apt upgrade -y
    
    # Disable swap
    log_info "Disabling swap..."
    swapoff -a
    sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab
    
    # Load kernel modules
    log_info "Loading kernel modules..."
    modprobe overlay
    modprobe br_netfilter
    
    # Configure sysctl
    log_info "Configuring sysctl parameters..."
    tee /etc/sysctl.d/kubernetes.conf <<EOF
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
EOF
    
    sysctl --system
    
    log_info "System preparation complete"
}

install_containerd() {
    log_info "Installing containerd..."
    
    apt install -y containerd
    
    # Configure containerd
    mkdir -p /etc/containerd
    containerd config default | tee /etc/containerd/config.toml
    
    # Enable systemd cgroup driver
    sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
    
    # Restart containerd
    systemctl restart containerd
    systemctl enable containerd
    
    log_info "Containerd installed and configured"
}

install_kubernetes() {
    log_info "Installing Kubernetes components..."
    
    # Add Kubernetes repository
    apt install -y apt-transport-https ca-certificates curl gpg
    
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' | tee /etc/apt/sources.list.d/kubernetes.list
    
    # Install kubelet, kubeadm, kubectl
    apt update
    apt install -y kubelet kubeadm kubectl
    apt-mark hold kubelet kubeadm kubectl
    
    # Enable kubelet
    systemctl enable kubelet
    
    log_info "Kubernetes components installed"
}

configure_firewall() {
    log_info "Configuring firewall..."
    
    if command -v ufw &> /dev/null; then
        ufw allow 6443/tcp    # Kubernetes API server
        ufw allow 2379:2380/tcp  # etcd server client API
        ufw allow 10250/tcp   # Kubelet API
        ufw allow 10259/tcp   # kube-scheduler
        ufw allow 10257/tcp   # kube-controller-manager
        ufw allow 30000:32767/tcp  # NodePort Services
        ufw allow 179/tcp     # Calico BGP
        ufw allow 4789/udp    # Calico VXLAN
        ufw allow 51820/udp   # Calico Wireguard
        ufw allow 51821/udp   # Calico Wireguard
        log_info "Firewall rules configured"
    else
        log_warn "UFW not found, please configure firewall manually"
    fi
}

setup_master() {
    log_info "Setting up Control Plane node..."
    
    if [ -z "$CONTROL_PLANE_IP" ]; then
        log_error "Control Plane IP is required for master setup"
        log_info "Usage: $0 master <CONTROL_PLANE_IP>"
        exit 1
    fi
    
    # Initialize cluster
    log_info "Initializing Kubernetes cluster..."
    kubeadm init \
      --pod-network-cidr=10.244.0.0/16 \
      --apiserver-advertise-address="$CONTROL_PLANE_IP" \
      --control-plane-endpoint="$CONTROL_PLANE_IP" \
      --upload-certs
    
    # Configure kubectl
    log_info "Configuring kubectl..."
    mkdir -p $HOME/.kube
    cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
    chown $(id -u):$(id -g) $HOME/.kube/config
    
    # Install Calico
    log_info "Installing Calico CNI plugin..."
    kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.4/manifests/calico.yaml
    
    log_info "Waiting for Calico to be ready..."
    kubectl wait --for=condition=ready pod -l k8s-app=calico-node -n kube-system --timeout=300s || true
    
    log_info "Control Plane setup complete!"
    log_info "Save the join command from the output above to join worker nodes"
    log_info "Or generate a new join command with: kubeadm token create --print-join-command"
}

setup_worker() {
    log_warn "Worker node setup requires the join command from the master node"
    log_info "Please run the join command provided by the master node"
    log_info "Or get a new join command from master: kubeadm token create --print-join-command"
}

main() {
    check_root
    
    log_info "Starting Kubernetes setup for Contabo VPS..."
    log_info "Node type: ${NODE_TYPE:-all}"
    
    # Common setup steps
    prepare_system
    install_containerd
    install_kubernetes
    configure_firewall
    
    # Node-specific setup
    case "$NODE_TYPE" in
        master)
            setup_master
            ;;
        worker)
            setup_worker
            ;;
        *)
            log_info "Common setup complete!"
            log_info "For master node, run: $0 master <CONTROL_PLANE_IP>"
            log_info "For worker node, use the join command from master"
            ;;
    esac
    
    log_info "Setup script completed!"
}

main "$@"

