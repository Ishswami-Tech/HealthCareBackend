# Kubernetes Addons

This directory contains optional Kubernetes addons that are not automatically deployed with the base configuration.

## Addons

### 1. ClusterIssuer (cert-manager)

**File:** `clusterissuer-cloudflare.yaml`

Creates a cert-manager ClusterIssuer for Let's Encrypt certificates using Cloudflare DNS-01 challenge.

**Installation:**
1. Ensure cert-manager is installed in your cluster
2. Create the Cloudflare API token secret:
   ```bash
   kubectl create secret generic cloudflare-api-token \
     --from-literal=api-token=YOUR_CLOUDFLARE_API_TOKEN \
     -n cert-manager
   ```
3. Update the email in `clusterissuer-cloudflare.yaml`
4. Apply:
   ```bash
   kubectl apply -f clusterissuer-cloudflare.yaml
   ```

**Usage:**
Referenced in `overlays/production/kustomization.yaml` via annotation:
```yaml
cert-manager.io/cluster-issuer: letsencrypt-dns01
```

### 2. MetalLB Load Balancer

**File:** `metallb-ip-pool.yaml`

Creates an IP address pool for MetalLB to provide LoadBalancer services.

**Installation:**
1. Ensure MetalLB is installed in your cluster
2. Update the IP address range in `metallb-ip-pool.yaml` to match your network
3. Apply:
   ```bash
   kubectl apply -f metallb-ip-pool.yaml
   ```

**Note:** The IP range `203.0.113.50-203.0.113.60` is a placeholder. Replace with your actual IP range.

## Integration with Production Overlay

To automatically include these addons in production deployments, add to `overlays/production/kustomization.yaml`:

```yaml
resources:
  - ../../base
  - ../../addons/clusterissuer-cloudflare.yaml
  - ../../addons/metallb-ip-pool.yaml
```

Or keep them separate for manual installation if they're cluster-wide resources that should be managed independently.

