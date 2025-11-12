# 📧 AWS SES (Simple Email Service) Integration Guide

## Step-by-Step Integration for HIPAA-Compliant Email Delivery

This guide will walk you through integrating AWS SES as your email provider for the healthcare application. SES provides HIPAA-compliant, reliable email delivery.

---

## 📋 Prerequisites

- AWS account
- AWS IAM user with SES permissions
- Domain name (for production)
- Node.js backend (already set up)

---

## 🚀 Step 1: Create AWS Account & IAM User

### 1.1 Create AWS Account
1. Go to [AWS Console](https://console.aws.amazon.com/)
2. Sign up or sign in to your AWS account
3. Complete account verification if required

### 1.2 Create IAM User for SES
1. Go to **IAM** → **Users** → **Add users**
2. Enter username: `healthcare-ses-user`
3. Select **"Programmatic access"**
4. Click **"Next: Permissions"**

### 1.3 Attach SES Permissions
1. Click **"Attach existing policies directly"**
2. Search for and select:
   - `AmazonSESFullAccess` (or create custom policy with minimal permissions)
3. Click **"Next: Tags"** (optional)
4. Click **"Next: Review"**
5. Click **"Create user"**

### 1.4 Save Access Keys
1. **IMPORTANT**: Copy the **Access Key ID** and **Secret Access Key**
2. Save them securely (you won't be able to see the secret key again)
3. These will be your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

---

## 📧 Step 2: Configure AWS SES

### 2.1 Choose AWS Region
1. Select your preferred AWS region (e.g., `us-east-1`, `us-west-2`, `eu-west-1`)
2. **Important**: SES is region-specific. Choose a region close to your users
3. This will be your `AWS_REGION`

### 2.2 Verify Email Address (Development/Testing)

**For development/testing**, you can verify individual email addresses:

1. Go to **SES** → **Verified identities**
2. Click **"Create identity"**
3. Select **"Email address"**
4. Enter email address (e.g., `noreply@healthcare.com`)
5. Click **"Create identity"**
6. Check your email inbox for verification email
7. Click the verification link

**Note**: In sandbox mode, you can only send to verified email addresses.

### 2.3 Verify Domain (Production - Recommended)

**For production**, verify your entire domain:

1. Go to **SES** → **Verified identities**
2. Click **"Create identity"**
3. Select **"Domain"**
4. Enter your domain (e.g., `healthcare.com`)
5. Click **"Create identity"**

#### 2.3.1 Add DNS Records
SES will provide DNS records to add:

1. **SPF Record** (TXT):
   ```
   v=spf1 include:amazonses.com ~all
   ```

2. **DKIM Records** (CNAME):
   - Multiple CNAME records for DKIM signing
   - Add all provided CNAME records

3. **DMARC Record** (TXT) - Optional but recommended:
   ```
   v=DMARC1; p=quarantine; rua=mailto:dmarc@healthcare.com
   ```

4. Add these records to your domain's DNS:
   - Go to your domain registrar or DNS provider
   - Add the TXT and CNAME records
   - Wait for DNS propagation (5-60 minutes)

5. **Verify Domain**:
   - Go back to SES console
   - Click **"Verify"** next to your domain
   - Wait for verification (can take up to 72 hours)

### 2.4 Request Production Access (Exit Sandbox)

**By default, SES is in sandbox mode**:
- Can only send to verified email addresses
- Limited to 200 emails per day
- 1 email per second

**To exit sandbox**:

1. Go to **SES** → **Account dashboard**
2. Click **"Request production access"**
3. Fill out the form:
   - **Mail Type**: Transactional
   - **Website URL**: Your application URL
   - **Use case description**: Describe your healthcare email use case
   - **Expected sending volume**: Estimate your monthly volume
   - **Compliance**: Mention HIPAA compliance requirements
4. Submit the request
5. Wait for approval (usually 24-48 hours)

---

## ⚙️ Step 3: Configure Environment Variables

### 3.1 Add to `.env` File

Add these environment variables:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# AWS SES Email Configuration
AWS_SES_FROM_EMAIL=noreply@healthcare.com
AWS_SES_FROM_NAME=Healthcare App
```

### 3.2 Email Provider Configuration

Update your email provider setting:

```bash
# Set email provider to 'ses' for AWS SES
EMAIL_PROVIDER=ses
```

**Or keep SMTP as fallback**:
```bash
EMAIL_PROVIDER=smtp  # Will use SES if configured, fallback to SMTP
```

### 3.3 Important Notes

- **AWS_REGION**: Must match the region where you verified your domain/email
- **AWS_ACCESS_KEY_ID**: From Step 1.4
- **AWS_SECRET_ACCESS_KEY**: From Step 1.4 (keep secure!)
- **AWS_SES_FROM_EMAIL**: Must be a verified email address or domain
- **AWS_SES_FROM_NAME**: Display name for emails

---

## 🏥 Step 4: HIPAA Compliance Setup

### 4.1 Sign Business Associate Agreement (BAA)

**Required for HIPAA compliance**:

1. Go to [AWS Artifact](https://console.aws.amazon.com/artifact/)
2. Navigate to **"Agreements"**
3. Request **"AWS Business Associate Addendum (BAA)"**
4. Review and accept the BAA
5. This enables HIPAA-eligible services including SES

### 4.2 Verify HIPAA Eligibility

1. Go to **SES** → **Configuration** → **Account dashboard**
2. Verify your account shows HIPAA-eligible status
3. Ensure you're using HIPAA-eligible regions:
   - `us-east-1` (N. Virginia)
   - `us-west-2` (Oregon)
   - `us-gov-west-1` (GovCloud)

### 4.3 Configure Email Encryption

**For PHI emails**, ensure:
- ✅ TLS encryption in transit (SES default)
- ✅ No PHI in email subject lines
- ✅ Use encrypted deep links instead of PHI in body
- ✅ Implement email encryption at rest (if required)

---

## 🧪 Step 5: Test the Integration

### 5.1 Check Service Initialization

1. Start your backend server:
   ```bash
   npm run start:dev
   ```

2. Check logs for SES initialization:
   ```
   [INFO] AWS SES email service initialized successfully
   ```

3. If you see a warning:
   ```
   [WARN] AWS credentials not provided, SES email service will be disabled
   ```
   → Check your environment variables

### 5.2 Test Email Sending

**Using Swagger UI**:
1. Go to `http://localhost:8088/api/docs`
2. Navigate to **Email** endpoints
3. Use the **"Send Test Email"** endpoint

**Using cURL**:
```bash
curl -X POST http://localhost:8088/api/email/test-custom \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "template": "WELCOME"
  }'
```

**Note**: In sandbox mode, `test@example.com` must be verified first.

### 5.3 Verify Email Delivery

1. Check the recipient's inbox (and spam folder)
2. Verify email content is correct
3. Check email headers for SES information
4. Review SES sending statistics in AWS Console

---

## 📊 Step 6: Monitor Email Delivery

### 6.1 SES Sending Statistics

1. Go to **SES** → **Account dashboard**
2. View:
   - **Sending quota**: Daily sending limit
   - **Sending rate**: Emails per second
   - **Reputation metrics**: Bounce and complaint rates
   - **Sending statistics**: Success/failure rates

### 6.2 Set Up CloudWatch Metrics

Monitor SES metrics:
- `Send` - Number of emails sent
- `Bounce` - Number of bounces
- `Complaint` - Number of spam complaints
- `Delivery` - Number of successful deliveries
- `Reject` - Number of rejected emails

### 6.3 Configure Bounce and Complaint Handling

1. Go to **SES** → **Configuration** → **Event publishing**
2. Create SNS topics for:
   - **Bounces**: Handle bounced emails
   - **Complaints**: Handle spam complaints
   - **Deliveries**: Track successful deliveries
3. Subscribe to topics (email or SQS queue)
4. Implement handlers in your application

---

## 🔒 Step 7: Email Security Best Practices

### 7.1 SPF, DKIM, and DMARC

**Already configured in Step 2.3.1**, but verify:

1. **SPF**: Prevents email spoofing
2. **DKIM**: Signs emails for authentication
3. **DMARC**: Policy for handling failed authentication

**Verify configuration**:
```bash
# Check SPF
dig TXT healthcare.com

# Check DKIM
dig TXT selector1._domainkey.healthcare.com

# Check DMARC
dig TXT _dmarc.healthcare.com
```

### 7.2 Sender Policy Framework (SPF)

Ensure SPF record includes:
```
v=spf1 include:amazonses.com ~all
```

### 7.3 DomainKeys Identified Mail (DKIM)

SES automatically signs emails with DKIM when domain is verified.

### 7.4 Domain-based Message Authentication (DMARC)

Recommended DMARC policy:
```
v=DMARC1; p=quarantine; rua=mailto:dmarc@healthcare.com; pct=100
```

---

## 💰 Step 8: Cost Management

### 8.1 SES Pricing

- **First 62,000 emails/month**: Free (if sent from EC2)
- **After free tier**: $0.10 per 1,000 emails
- **Data transfer**: $0.12 per GB (after free tier)

### 8.2 Cost Optimization

**Tips to reduce costs**:
- Use EC2/ECS to send emails (free tier applies)
- Batch emails when possible
- Use email templates to reduce size
- Monitor and remove invalid email addresses

**Example**:
- 100,000 emails/month
- Cost: ~$3.80/month (after free tier)

### 8.3 Set Up Billing Alerts

1. Go to **AWS Billing** → **Budgets**
2. Create budget for SES costs
3. Set alert threshold (e.g., $50/month)
4. Get notified if costs exceed threshold

---

## 🐛 Troubleshooting

### Issue: "AWS credentials not provided"

**Solution**:
1. Check `.env` file has all AWS variables
2. Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are correct
3. Restart server after changing `.env`

### Issue: "Email address is not verified"

**Solution**:
1. Verify the email address in SES console
2. Check spam folder for verification email
3. For production, verify the entire domain

### Issue: "Account is in sandbox mode"

**Solution**:
1. Request production access (Step 2.4)
2. Wait for AWS approval
3. Or verify recipient email addresses for testing

### Issue: "Message rejected: Email address not verified"

**Solution**:
1. In sandbox mode, recipient must be verified
2. Verify recipient email in SES console
3. Or request production access

### Issue: "Sending quota exceeded"

**Solution**:
1. Check your sending quota in SES dashboard
2. Request quota increase if needed
3. Implement rate limiting in your application

### Issue: "High bounce rate"

**Solution**:
1. Verify email addresses before sending
2. Remove invalid addresses from your list
3. Implement double opt-in for subscriptions
4. Monitor bounce notifications

### Issue: "High complaint rate"

**Solution**:
1. Ensure recipients opted in
2. Include unsubscribe links
3. Send relevant content only
4. Monitor complaint notifications
5. Remove complainers from your list

---

## 📈 Step 9: Advanced Configuration

### 9.1 Configuration Sets

Create configuration sets for different email types:

1. Go to **SES** → **Configuration** → **Configuration sets**
2. Create sets:
   - `transactional` - For transactional emails
   - `marketing` - For marketing emails
   - `notifications` - For notifications
3. Configure:
   - Event publishing (bounces, complaints)
   - Reputation metrics
   - Delivery options

### 9.2 Email Templates

Use SES templates for consistent emails:

1. Go to **SES** → **Email templates**
2. Create templates for:
   - Welcome emails
   - Password reset
   - Appointment reminders
   - Prescription notifications
3. Use templates in your application

### 9.3 Dedicated IP Addresses

For high-volume sending:

1. Go to **SES** → **Configuration** → **Dedicated IPs**
2. Request dedicated IP pool
3. Warm up IP addresses gradually
4. Monitor IP reputation

---

## ✅ Integration Checklist

- [ ] AWS account created
- [ ] IAM user created with SES permissions
- [ ] Access keys saved securely
- [ ] Email address verified (development)
- [ ] Domain verified (production)
- [ ] DNS records added (SPF, DKIM, DMARC)
- [ ] Production access requested (if needed)
- [ ] Environment variables configured
- [ ] BAA signed (for HIPAA compliance)
- [ ] Service initialized successfully
- [ ] Test email sent successfully
- [ ] Email delivery verified
- [ ] Monitoring set up
- [ ] Bounce/complaint handling configured

---

## 🎯 Next Steps

1. **Production Deployment**:
   - Use separate AWS accounts for dev/staging/prod
   - Set up proper IAM roles (not users) for production
   - Configure CloudWatch alarms
   - Set up dedicated IP addresses (if high volume)

2. **Email Templates**:
   - Create SES email templates
   - Implement template rendering
   - Test all email templates

3. **Monitoring**:
   - Set up CloudWatch dashboards
   - Configure SNS notifications for bounces/complaints
   - Implement email analytics

4. **Security**:
   - Rotate access keys regularly
   - Use IAM roles instead of access keys (for EC2/ECS)
   - Enable MFA for AWS account
   - Set up CloudTrail for audit logging

---

## 📚 Additional Resources

- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [SES Best Practices](https://docs.aws.amazon.com/ses/latest/dg/best-practices.html)
- [HIPAA Compliance with AWS](https://aws.amazon.com/compliance/hipaa-compliance/)
- [SES Pricing](https://aws.amazon.com/ses/pricing/)
- [Email Authentication Guide](https://docs.aws.amazon.com/ses/latest/dg/email-authentication.html)

---

## 🆘 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review AWS CloudWatch logs
3. Check backend application logs
4. Verify environment variables are set correctly
5. Ensure email addresses/domains are verified
6. Check SES sending statistics and reputation

---

**Last Updated**: January 2025

