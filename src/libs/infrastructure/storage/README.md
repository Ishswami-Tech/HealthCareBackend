# Storage Service

**Purpose:** File storage abstraction (S3, local storage)
**Location:** `src/libs/infrastructure/storage`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { StorageService } from '@infrastructure/storage';

@Injectable()
export class MyService {
  constructor(private readonly storageService: StorageService) {}

  async uploadFile(file: Express.Multer.File) {
    const result = await this.storageService.upload({
      file: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      bucket: 'medical-records',
      path: 'ehr/lab-reports',
    });

    return result.url;  // https://s3.amazonaws.com/bucket/path/filename
  }

  async downloadFile(key: string) {
    const stream = await this.storageService.download(key);
    return stream;
  }
}
```

---

## Key Features

- ✅ **S3 Integration** - AWS S3 compatible storage
- ✅ **Local Storage** - Development/testing support
- ✅ **Streaming Uploads** - Memory-efficient large file uploads
- ✅ **Pre-signed URLs** - Secure temporary access
- ✅ **Multi-bucket Support** - Separate buckets for different data types
- ✅ **CDN Integration** - CloudFront for static assets

---

## Configuration

```env
# Storage Configuration
STORAGE_PROVIDER=s3              # s3, local
AWS_S3_BUCKET=healthcare-files
AWS_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret

# Local Storage (development)
STORAGE_LOCAL_PATH=./uploads
```

[Full configuration guide](../../../docs/guides/STORAGE_CONFIGURATION.md)

---

## Usage Examples

### Example 1: Upload Medical Record

```typescript
const { url, key } = await this.storageService.upload({
  file: pdfBuffer,
  filename: 'lab-report-123.pdf',
  mimetype: 'application/pdf',
  bucket: 'medical-records',
  path: `clinic-${clinicId}/ehr/lab-reports`,
  metadata: {
    patientId: 'patient123',
    clinicId: 'clinic456',
    recordType: 'lab_report',
  },
});
```

### Example 2: Generate Pre-signed URL

```typescript
// Generate temporary download URL (expires in 1 hour)
const downloadUrl = await this.storageService.getSignedUrl(
  fileKey,
  3600  // 1 hour expiration
);

// Share with patient
return { downloadUrl };
```

### Example 3: Private documents served via presigned URLs

Patient documents (`documents/`) and medical-record files (`medical-records/`) are
uploaded **private** (`uploadFile(..., isPublic = false)`, no public-read ACL). The
stored `fileUrl` is never handed to clients directly; resolve it first:

```typescript
// own-bucket object -> presigned GET URL, valid 15 minutes (PRIVATE_ASSET_URL_TTL_SECONDS)
// local-disk URL (/storage/...), S3 off, foreign host, other folder -> returned unchanged
// presign failure -> stored URL + a warning (the URL itself is never logged); never throws
const url = await this.staticAssetService.resolveSignedUrl(record.fileUrl);

// Lower-level: presign a known object key (throws when S3 is disabled)
const signed = await this.staticAssetService.getSignedDownloadUrl(key, 300);
```

Only URLs that point into the configured bucket under `documents/` or
`medical-records/` are ever presigned (`S3StorageService.resolveOwnedObjectKey`);
a tampered or client-supplied URL cannot make the API sign an arbitrary object.
Objects uploaded before this change are still `public-read` until their ACL is reset
to private (`aws s3api put-object-acl --acl private --bucket <bucket> --key <key>
--endpoint-url <S3_ENDPOINT>`); presigned URLs work for them too. Private uploads send
no ACL, so they work with or without the bucket's "Block public ACLs" setting; only
genuinely public assets (e.g. QR codes) need public ACLs to be allowed.

---

## Related Documentation

- [Storage Configuration Guide](../../../docs/guides/STORAGE_CONFIGURATION.md)
- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#storage)

---

## Troubleshooting

**Issue 1: Upload fails**
- Check AWS credentials
- Verify bucket permissions
- Check file size limits

**Issue 2: Pre-signed URLs not working**
- Verify AWS_S3_REGION is correct
- Check bucket CORS configuration

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
