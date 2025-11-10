#!/usr/bin/env bash
# Bash script to build Docker image using containerd (nerdctl)
# This script works with k3s or any containerd-based Kubernetes setup
# Prerequisites: nerdctl installed

set -uo pipefail

IMAGE_TAG="local"
DOCKERFILE="devops/docker/Dockerfile"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --image-tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        --dockerfile)
            DOCKERFILE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "🔨 Healthcare Backend - Build Image with Containerd"
echo "===================================================="
echo ""

# Check nerdctl
if ! command -v nerdctl &> /dev/null; then
    echo "❌ nerdctl not found. Please install nerdctl:"
    echo "   wget https://github.com/containerd/nerdctl/releases/download/v1.7.0/nerdctl-1.7.0-linux-amd64.tar.gz"
    echo "   tar -xzf nerdctl-1.7.0-linux-amd64.tar.gz"
    echo "   sudo mv nerdctl /usr/local/bin/"
    echo "   sudo chmod +x /usr/local/bin/nerdctl"
    exit 1
fi

NERDCTL_VERSION=$(nerdctl version 2>&1 | head -n 1)
echo "✅ nerdctl found: $NERDCTL_VERSION"
echo ""

echo "📋 Build Configuration:"
echo "   Image Tag: healthcare-api:$IMAGE_TAG"
echo "   Dockerfile: $DOCKERFILE"
echo "   Project Root: $PROJECT_ROOT"
echo ""

# Check if nerdctl config exists, if not create it
if [ ! -f ~/.config/nerdctl/nerdctl.toml ]; then
    echo "📝 Creating nerdctl configuration for k3s..."
    mkdir -p ~/.config/nerdctl
    cat > ~/.config/nerdctl/nerdctl.toml <<EOF
address = "/run/k3s/containerd/containerd.sock"
namespace = "k8s.io"
EOF
    echo "✅ nerdctl configured to use k3s containerd"
    echo ""
fi

# Verify k3s containerd socket exists
if [ ! -S /run/k3s/containerd/containerd.sock ]; then
    echo "⚠️  Warning: k3s containerd socket not found"
    echo "   Checking if k3s is running..."
    if sudo systemctl is-active --quiet k3s; then
        echo "   k3s is running, but socket not found. This might be a permission issue."
        echo "   Trying with sudo..."
        USE_SUDO=true
    else
        echo "❌ k3s is not running. Please start it:"
        echo "   sudo systemctl start k3s"
        exit 1
    fi
else
    USE_SUDO=false
fi

# Check and start BuildKit if needed
echo "🔧 Checking BuildKit daemon..."
BUILDKIT_RUNNING=false

# Check if BuildKit is running (check multiple possible socket locations)
if pgrep -f buildkitd > /dev/null 2>&1; then
    BUILDKIT_RUNNING=true
elif [ -S /run/buildkit/buildkitd.sock ] 2>/dev/null; then
    BUILDKIT_RUNNING=true
elif [ -S /run/user/$(id -u)/buildkit/buildkitd.sock ] 2>/dev/null; then
    BUILDKIT_RUNNING=true
fi

if [ "$BUILDKIT_RUNNING" = false ]; then
    echo "   BuildKit not running, starting it..."
    echo "   Creating BuildKit directories..."
    sudo mkdir -p /run/buildkit /var/lib/buildkit
    sudo chmod 755 /run/buildkit /var/lib/buildkit
    
    # Start BuildKit daemon with proper socket location
    echo "   Starting BuildKit daemon..."
    if [ "$USE_SUDO" = true ]; then
        sudo nohup buildkitd \
            --addr unix:///run/buildkit/buildkitd.sock \
            --root /var/lib/buildkit \
            --group root \
            > /tmp/buildkitd.log 2>&1 &
        BUILDKIT_PID=$!
        echo "   BuildKit PID: $BUILDKIT_PID"
    else
        nohup buildkitd \
            --addr unix:///run/user/$(id -u)/buildkit/buildkitd.sock \
            --root ~/.local/share/buildkit \
            > /tmp/buildkitd.log 2>&1 &
        BUILDKIT_PID=$!
        echo "   BuildKit PID: $BUILDKIT_PID"
    fi
    
    # Wait for BuildKit to start
    echo "   Waiting for BuildKit to start..."
    for i in {1..10}; do
        sleep 1
        if pgrep -f buildkitd > /dev/null 2>&1; then
            if [ "$USE_SUDO" = true ]; then
                if [ -S /run/buildkit/buildkitd.sock ] 2>/dev/null; then
                    echo "   ✅ BuildKit started successfully"
                    BUILDKIT_RUNNING=true
                    break
                fi
            else
                if [ -S /run/user/$(id -u)/buildkit/buildkitd.sock ] 2>/dev/null; then
                    echo "   ✅ BuildKit started successfully"
                    BUILDKIT_RUNNING=true
                    break
                fi
            fi
        fi
        echo "   Waiting... ($i/10)"
    done
    
    if [ "$BUILDKIT_RUNNING" = false ]; then
        echo "   ⚠️  BuildKit may not have started properly"
        echo "   Check /tmp/buildkitd.log for errors:"
        echo "   tail -20 /tmp/buildkitd.log"
        echo "   Continuing anyway - nerdctl may use k3s's built-in BuildKit..."
    fi
else
    echo "   ✅ BuildKit is already running"
fi
echo ""

# Build image
echo "🔨 Building image with nerdctl..."
echo "   This may take several minutes..."
echo "   (Live build logs will appear below)"
echo ""

cd "$PROJECT_ROOT"

# Build with progress output (unbuffered for live logs)
# Using --progress=plain to show live build logs in real-time
echo "Starting build process..."
echo "   BuildKit should show live progress below..."
echo "   (You should see build steps as they complete)"
echo ""
echo "Build command: nerdctl build --progress=plain -f $DOCKERFILE -t healthcare-api:$IMAGE_TAG ."
echo ""

# Disable buffering for Python if used, and ensure direct output
export PYTHONUNBUFFERED=1

# Build command - run directly to see live output
# Always use k3s containerd socket for consistency
# The key is to not buffer output and let BuildKit show progress directly
echo "Running nerdctl build with k3s containerd..."
echo ""
echo "⚠️  Note: Using k3s containerd socket: /run/k3s/containerd/containerd.sock"
echo ""

# Always use k3s socket, but check if we need sudo for socket access
if [ "$USE_SUDO" = true ] || [ ! -r /run/k3s/containerd/containerd.sock ]; then
    echo "Using sudo (k3s socket requires root access)..."
    echo ""
    # Use script command to ensure output is visible through sudo
    # This creates a pseudo-terminal that ensures output is shown
    if command -v script > /dev/null 2>&1; then
        script -q -c "sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io build --progress=plain -f '$DOCKERFILE' -t 'healthcare-api:$IMAGE_TAG' '$PROJECT_ROOT'" /dev/null
    else
        # Fallback: direct sudo (output may be buffered)
        sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io build \
            --progress=plain \
            -f "$DOCKERFILE" \
            -t "healthcare-api:$IMAGE_TAG" \
            "$PROJECT_ROOT"
    fi
else
    echo "Running nerdctl build (socket is readable)..."
    echo ""
    # Direct execution - output should appear in real-time
    # Always use k3s socket
    if command -v script > /dev/null 2>&1; then
        script -q -c "nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io build --progress=plain -f '$DOCKERFILE' -t 'healthcare-api:$IMAGE_TAG' '$PROJECT_ROOT'" /dev/null
    else
        nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io build \
            --progress=plain \
            -f "$DOCKERFILE" \
            -t "healthcare-api:$IMAGE_TAG" \
            "$PROJECT_ROOT"
    fi
fi

BUILD_EXIT_CODE=$?

if [ $BUILD_EXIT_CODE -ne 0 ]; then
    echo ""
    echo "❌ Build failed with exit code: $BUILD_EXIT_CODE"
    exit 1
fi

echo "✅ Image built successfully!"
echo ""

# Verify image (always check k3s namespace)
echo "📦 Verifying image in k3s namespace..."
if [ "$USE_SUDO" = true ] || [ ! -r /run/k3s/containerd/containerd.sock ]; then
    if sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io images "healthcare-api:$IMAGE_TAG" 2>/dev/null | grep -q "healthcare-api"; then
        echo "✅ Image verified in k3s namespace:"
        sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io images "healthcare-api:$IMAGE_TAG"
    else
        echo "⚠️  Could not verify image (may still be available)"
    fi
else
    if nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io images "healthcare-api:$IMAGE_TAG" 2>/dev/null | grep -q "healthcare-api"; then
        echo "✅ Image verified in k3s namespace:"
        nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io images "healthcare-api:$IMAGE_TAG"
    else
        echo "⚠️  Could not verify image (may still be available)"
    fi
fi

echo ""
echo "📝 Next Steps:"
echo "   1. Import image to k3s namespace (if using k3s):"
echo "      sudo nerdctl --namespace k8s.io load -i <(nerdctl save healthcare-api:$IMAGE_TAG)"
echo ""
echo "   2. Or deploy directly:"
echo "      ./devops/kubernetes/scripts/deploy-containerd.sh"
echo ""

echo "✅ Build complete!"



