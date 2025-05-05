# SSL Certificate Setup

This directory contains SSL certificates for the application. Follow these steps to set up the certificates:

1. Go to Cloudflare Dashboard > SSL/TLS > Origin Server
2. Create new Origin Certificates for:
   - `ishswami.in`
   - `api.ishswami.in`

3. Save the certificates in this directory:
   ```
   ssl/
   ├── api.ishswami.in.crt          # API domain certificate
   ├── api.ishswami.in.key          # API domain private key
   ├── ishswami.in.crt              # Frontend domain certificate
   ├── ishswami.in.key              # Frontend domain private key
   ├── origin_ca_root.pem           # Cloudflare Root CA certificate
   ├── api.ishswami.in.chain.crt    # API certificate chain (created during deployment)
   └── ishswami.in.chain.crt        # Frontend certificate chain (created during deployment)
   ```

4. The deployment script will automatically:
   - Download the Cloudflare Root CA certificate if not present
   - Create certificate chains by combining domain certificates with the root CA
   - Configure Nginx to use the chain certificates

## Security Notes

- Keep private keys secure and never commit them to version control
- Ensure all certificate files have correct permissions (644 for certificates, 600 for private keys)
- The deployment script will handle permission settings automatically

## Troubleshooting

If you see SSL-related errors:
1. Verify that all required certificate files are present
2. Check that certificate chains are properly created
3. Ensure Nginx is using the chain certificates (*.chain.crt) instead of individual certificates
4. Verify that SSL stapling is working by checking Nginx error logs 