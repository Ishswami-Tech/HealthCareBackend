# Storage Configuration Guide
## Contabo S3 + Local Storage Setup

This guide explains how to configure the storage service to use **Contabo S3** (S3-compatible) with automatic fallback to **local storage** (Kubernetes persistent volumes).

---

## 🎯 Overview

The storage service supports:
- **Contabo S3** (primary) - Cost-effective S3-compatible storage
- **Local Storage** (fallback) - Kubernetes persistent volumes (automatically backed up)
- **AWS S3** (optional) - Can be used instead of Contabo
- **Wasabi** (optional) - Another S3-compatible provider

---

## 📋 Environment Variables

### Required for Contabo S3

```bash
# Enable S3 storage
S3_ENABLED=true

# Provider type
S3_PROVIDER=contabo

# Contabo S3 endpoint (get from Contabo dashboard)
S3_ENDPOINT=https://eu2.contabostorage.com

# Region (usually eu-central-1 for Contabo)
S3_REGION=eu-central-1

# Bucket name (just the bucket name, not the full URL path)
S3_BUCKET=healthcaredata

# Note: Contabo bucket URL format: https://eu2.contabostorage.com/{access-key-id}:{bucket-name}
# Example: https://eu2.contabostorage.com/{your-access-key-id}:healthcaredata

# Access credentials (from Contabo dashboard)
# Access key ID is used in URL path: https://eu2.contabostorage.com/{access-key-id}:{bucket-name}
S3_ACCESS_KEY_ID=your-contabo-access-key-id
S3_SECRET_ACCESS_KEY=your-contabo-secret-access-key

# Required for S3-compatible providers
S3_FORCE_PATH_STYLE=true
```

### Optional

```bash
# CDN URL (if using CDN in front of storage)
CDN_URL=https://cdn.yourdomain.com

# Presigned URL expiration (seconds, default: 3600 = 1 hour)
S3_PUBLIC_URL_EXPIRATION=3600
```

### Local Storage Only (No S3)

```bash
# Disable S3, use local storage only
S3_ENABLED=false
```

---

## 🔧 Configuration Examples

### Example 1: Contabo S3 (Recommended)

```bash
S3_ENABLED=true
S3_PROVIDER=contabo
S3_ENDPOINT=https://eu2.contabostorage.com
S3_REGION=eu-central-1
S3_BUCKET=healthcaredata
S3_ACCESS_KEY_ID=your-contabo-access-key-id
S3_SECRET_ACCESS_KEY=your-contabo-secret-access-key
S3_FORCE_PATH_STYLE=true
```

**Note**: 
- **Bucket URL Format**: `https://eu2.contabostorage.com/{access-key-id}:{bucket-name}/{file-key}`
- **Example Bucket URL**: `https://eu2.contabostorage.com/{your-access-key-id}:healthcaredata`
- **File URL Example**: `https://eu2.contabostorage.com/{your-access-key-id}:healthcaredata/path/to/file.pdf`
- The `S3_BUCKET` value should be just `healthcaredata` (bucket name only)
- The storage service automatically includes the access key ID in public URLs when `S3_PROVIDER=contabo`

### Example 2: AWS S3

```bash
S3_ENABLED=true
S3_PROVIDER=aws
# S3_ENDPOINT not needed for AWS (uses default endpoints)
S3_REGION=us-east-1
S3_BUCKET=healthcare-assets
S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_FORCE_PATH_STYLE=false
```

### Example 3: Local Storage Only

```bash
S3_ENABLED=false
# All files stored in /storage/assets (Kubernetes persistent volume)
```

---

## 🚀 Kubernetes Configuration

### Persistent Volume for Local Storage

Since you're using Kubernetes, configure a persistent volume for local storage:

```yaml
# storage-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: healthcare-storage-pvc
  namespace: healthcare-backend
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi  # Adjust based on needs
  storageClassName: standard  # Or your preferred storage class
```

### Mount in Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: healthcare-backend
spec:
  template:
    spec:
      containers:
      - name: app
        volumeMounts:
        - name: storage
          mountPath: /app/storage
      volumes:
      - name: storage
        persistentVolumeClaim:
          claimName: healthcare-storage-pvc
```

### Backup Strategy

Kubernetes handles backups via:
1. **Persistent Volume Snapshots** - Automated snapshots of PVC
2. **Volume Backups** - Using tools like Velero
3. **Application-Level Backups** - Your existing backup system

---

## 📊 Storage Behavior

### Primary: Contabo S3
- Files uploaded to Contabo S3 bucket
- Public URLs generated automatically
- Presigned URLs for private files
- Automatic retry on failure

### Fallback: Local Storage
- If S3 fails, files stored in `/storage/assets`
- Organized by folder: `qr-codes/`, `invoices/`, `prescriptions/`, etc.
- Served via Kubernetes ingress/nginx
- Backed up by Kubernetes persistent volume snapshots

---

## 🔍 Monitoring

### Check Storage Status

The service logs storage operations:

```typescript
// Check which storage is active
const storageType = staticAssetService.getStorageType(); // 's3' or 'local'
const provider = staticAssetService.getStorageProvider(); // 'contabo', 'aws', 'local'
```

### Logs

```
[INFO] S3 storage initialized successfully (Provider: contabo, Region: eu-central-1)
[INFO] File uploaded to S3: qr-codes/uuid-qr-location-123.png
[WARN] S3 upload failed, falling back to local storage: Connection timeout
[INFO] File uploaded to local storage: /app/storage/assets/qr-codes/uuid-qr-location-123.png
```

---

## 💰 Cost Comparison

### Contabo S3 (Recommended)
- **Storage:** ~€0.005/GB/month
- **No egress fees**
- **Total (1TB):** ~€5/month

### AWS S3
- **Storage:** ~$0.023/GB/month
- **Egress:** ~$0.09/GB
- **Total (1TB):** ~$23-30/month

### Local Storage (Kubernetes)
- **Storage:** Included in Kubernetes cluster costs
- **Backups:** Handled by Kubernetes snapshots
- **Total:** Part of infrastructure costs

---

## 🔐 Security

### Credentials Management

Store credentials in Kubernetes secrets:

```yaml
# s3-secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: s3-credentials
  namespace: healthcare-backend
type: Opaque
stringData:
  S3_ACCESS_KEY_ID: your-access-key-id
  S3_SECRET_ACCESS_KEY: your-secret-access-key
```

Reference in deployment:

```yaml
env:
- name: S3_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: s3-credentials
      key: S3_ACCESS_KEY_ID
- name: S3_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: s3-credentials
      key: S3_SECRET_ACCESS_KEY
```

---

## 🧪 Testing

### Test S3 Connection

```typescript
// In your service
const isEnabled = s3StorageService.isS3Enabled();
console.log(`S3 enabled: ${isEnabled}`);
console.log(`Provider: ${s3StorageService.getStorageProvider()}`);
```

### Test Upload

```typescript
const result = await staticAssetService.uploadQRCode(
  qrCodeBuffer,
  locationId
);

if (result.success) {
  console.log(`Uploaded to: ${result.url}`);
  console.log(`Storage type: ${result.key ? 'S3' : 'Local'}`);
}
```

---

## 🔄 Migration

### From AWS S3 to Contabo S3

1. Update environment variables:
   ```bash
   S3_PROVIDER=contabo
   S3_ENDPOINT=https://eu2.contabostorage.com
   S3_FORCE_PATH_STYLE=true
   ```

2. Restart application

3. New uploads go to Contabo S3

4. Old files remain in AWS S3 (migrate separately if needed)

### From Local to S3

1. Enable S3:
   ```bash
   S3_ENABLED=true
   # ... configure credentials
   ```

2. Restart application

3. New uploads go to S3

4. Old local files remain (can be migrated manually)

---

## 📝 Notes

- **Backups:** Kubernetes persistent volumes handle local storage backups automatically
- **Scalability:** Contabo S3 scales automatically (no limits)
- **Performance:** Contabo S3 is fast enough for healthcare app needs
- **Compliance:** Verify HIPAA/GDPR compliance with Contabo if needed
- **Migration:** Easy to switch providers (same S3-compatible API)

---

## 🆘 Troubleshooting

### S3 Connection Fails

1. Check credentials are correct
2. Verify endpoint URL is correct
3. Check network connectivity
4. Verify bucket exists and is accessible
5. Check `S3_FORCE_PATH_STYLE=true` for Contabo

### Local Storage Fails

1. Check Kubernetes persistent volume is mounted
2. Verify write permissions on `/storage/assets`
3. Check disk space
4. Review Kubernetes pod logs

### Files Not Accessible

1. Check public URL generation
2. Verify CDN configuration (if using)
3. Check presigned URL expiration
4. Verify ingress/nginx routing for local files

---

## 📚 References

- [Contabo Object Storage Documentation](https://contabo.com/en/products/object-storage/)
- [AWS S3 SDK Documentation](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-examples.html)
- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
