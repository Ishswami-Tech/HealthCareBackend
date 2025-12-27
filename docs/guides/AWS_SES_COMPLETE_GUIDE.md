# 📧 AWS SES Complete Integration Guide

> **Comprehensive guide for AWS SES setup, multi-tenant configuration, and best practices**

This guide covers everything you need to set up AWS SES for your healthcare application, from initial configuration to multi-tenant support.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Domain Verification](#domain-verification)
4. [Production Access](#production-access)
5. [Multi-Tenant Configuration](#multi-tenant-configuration)
6. [SNS Topic Setup](#sns-topic-setup)
7. [Clinic Configuration](#clinic-configuration)
8. [Testing](#testing)
9. [Security & Compliance](#security--compliance)
10. [Troubleshooting](#troubleshooting)
11. [Cost Management](#cost-management)

---

## Prerequisites

- AWS account
- AWS IAM user with SES permissions
- Domain name (for production)
- Node.js backend (already set up)

---

## Initial Setup

### Step 1: Create AWS Account & IAM User

#### 1.1 Create AWS Account
1. Go to [AWS Console](https://console.aws.amazon.com/)
2. Sign up or sign in to your AWS account
3. Complete account verification if required

#### 1.2 Create IAM User for SES
1. Go to **IAM** → **Users** → **Add users**
2. Enter username: `healthcare-ses-user`
3. Select **"Programmatic access"**
4. Click **"Next: Permissions"**

#### 1.3 Attach SES Permissions
1. Click **"Attach existing policies directly"**
2. Search for and select:
   - `AmazonSESFullAccess` (or create custom policy with minimal permissions)
3. Click **"Next: Tags"** (optional)
4. Click **"Next: Review"**
5. Click **"Create user"**

#### 1.4 Save Access Keys
1. **IMPORTANT**: Copy the **Access Key ID** and **Secret Access Key**
2. Save them securely (you won't be able to see the secret key again)
3. These will be your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

### Step 2: Choose AWS Region

1. Select your preferred AWS region (e.g., `us-east-1`, `us-west-2`, `eu-west-1`)
2. **Important**: SES is region-specific. Choose a region close to your users
3. This will be your `AWS_REGION`

### Step 3: Configure Environment Variables

Add to your `.env` file:

```env
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# AWS SES Email Configuration
AWS_SES_FROM_EMAIL=noreply@healthcare.com
AWS_SES_FROM_NAME=Healthcare App

# AWS SES SNS Configuration (for webhooks)
AWS_SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:healthcare-ses-events
AWS_SNS_REGION=us-east-1
```

---

## Domain Verification

### Option 1: Verify Email Address (Development/Testing)

**For development/testing**, you can verify individual email addresses:

1. Go to **SES** → **Verified identities**
2. Click **"Create identity"**
3. Select **"Email address"**
4. Enter email address (e.g., `noreply@healthcare.com`)
5. Click **"Create identity"**
6. Check your email inbox for verification email
7. Click the verification link

**Note**: In sandbox mode, you can only send to verified email addresses.

### Option 2: Verify Domain (Production - Recommended)

**For production**, verify your entire domain:

1. Go to **SES** → **Verified identities**
2. Click **"Create identity"**
3. Select **"Domain"**
4. Enter your domain (e.g., `healthcare.com`)
5. Click **"Create identity"**

#### Add DNS Records

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

---

## Production Access

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

## Multi-Tenant Configuration

For multi-tenant support, you have two options:

1. **Shared SNS Topic (Recommended)**: One SNS topic for all clinics, with email-based routing
2. **Per-Clinic SNS Topics**: Separate SNS topic for each clinic

The shared topic approach is recommended because:
- Simpler to manage
- Lower AWS costs
- Our system automatically identifies clinics from source email addresses
- Easier to maintain

---

## SNS Topic Setup

> **Important**: SNS Topics and Configuration Sets are **different**:
> - **SNS Topics** (AWS SNS service): Used to receive notifications/events from SES (bounces, complaints, deliveries). You subscribe your webhook endpoint to these topics.
> - **Configuration Sets** (AWS SES service): Used to group email sending configurations, event publishing settings, and reputation tracking. You can assign a configuration set to emails when sending.

**Key Point**: SNS Topics are created in the **AWS SNS Console** (not SES console). Then you configure SES to send events to those topics.

**Process Flow**:
1. Create SNS Topic in **SNS Console** → Get Topic ARN
2. Configure SES in **SES Console** → Select the SNS Topic for event publishing
3. Subscribe your webhook to the SNS Topic → Receive events

### Option 1: Shared SNS Topic (Recommended)

#### Step 1: Create SNS Topic

1. Go to AWS SNS Console: https://console.aws.amazon.com/sns/
2. Click **"Topics"** → **"Create topic"**
3. Choose **"Standard"** topic type
4. Configure:
   - **Name**: `healthcare-ses-events` (or your preferred name)
   - **Display name**: `Healthcare SES Events`
5. Click **"Create topic"**
6. Copy the **Topic ARN** (you'll need this later)

#### Step 2: Configure SES Event Publishing

**Important**: You must create the SNS topic first (Step 1) before you can select it in SES.

1. Go to AWS SES Console: https://console.aws.amazon.com/ses/
2. Click **"Verified identities"** (or **"Identities"** in some regions)
3. For each verified domain/email:
   - Click on the identity name
   - Go to the **"Notifications"** tab
   - You'll see a section called **"Feedback notifications"** with a table showing:
     - **Feedback type**: Bounce, Complaint, Delivery
     - **SNS topic**: Currently showing "No SNS Topic" for all
     - **Include original headers**: Currently showing "-"
   - Click the **"Edit"** button on the right side of the "Feedback notifications" section
   - In the edit dialog, you'll see options for each feedback type:
     - **Bounce notifications**: 
       - Select **"SNS topic"** (not "Email" or "SQS queue")
       - Choose your topic from the dropdown (the topic you created in Step 1)
       - If you don't see your topic, make sure you're in the same AWS region
     - **Complaint notifications**: 
       - Select **"SNS topic"**
       - Choose the same topic
     - **Delivery notifications** (optional): 
       - Select **"SNS topic"**
       - Choose the same topic
   - Click **"Save changes"** or **"Save"**

**What you'll see after saving**:
- The table will update to show your SNS topic ARN for each feedback type
- Instead of "No SNS Topic", you'll see your topic name or ARN

**Note**: If you don't see a dropdown with topics in the edit dialog, you can:
- Click **"Create SNS topic"** link (if available) - this will create a new topic
- Or manually enter the Topic ARN: `arn:aws:sns:us-east-1:123456789012:healthcare-ses-events`

#### Step 3: Subscribe Your Webhook Endpoint

1. Go back to SNS Console → Your topic
2. Click **"Create subscription"**
3. Configure:
   - **Protocol**: `HTTPS`
   - **Endpoint**: `https://your-domain.com/api/v1/webhooks/ses`
   - **Enable raw message delivery**: Unchecked (default)
4. Click **"Create subscription"**
5. AWS will send a confirmation request to your endpoint
6. Your webhook controller will automatically confirm the subscription

#### Step 4: Update Environment Variables

Add to your `.env` file:

```env
# AWS SES SNS Configuration (Shared Topic)
AWS_SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:healthcare-ses-events
AWS_SNS_REGION=us-east-1
```

### Option 2: Per-Clinic SNS Topics

If you prefer separate topics for each clinic:

1. For each clinic, create a separate SNS topic:
   - Name: `healthcare-ses-events-clinic-{clinicId}`
   - Copy the Topic ARN
2. For each clinic's verified identity in SES:
   - Configure notifications to use that clinic's specific SNS topic
3. Subscribe your webhook endpoint to each topic
4. Store the topic ARN in each clinic's communication settings

### Automated Setup Scripts

**Option A: Use Script (Recommended)**

```bash
# Linux/Mac
chmod +x scripts/setup-aws-ses-sns.sh
./scripts/setup-aws-ses-sns.sh

# Windows PowerShell
.\scripts\setup-aws-ses-sns.ps1
```

**Option B: AWS CLI**

```bash
# Create shared topic
aws sns create-topic --name healthcare-ses-events --region us-east-1

# Subscribe webhook endpoint
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:healthcare-ses-events \
  --protocol https \
  --notification-endpoint https://your-domain.com/api/v1/webhooks/ses \
  --region us-east-1
```

---

## Clinic Configuration

### Method 1: Via API (Recommended)

#### Quick SES Configuration

```bash
# Update clinic SES configuration
PUT /api/v1/clinics/{clinicId}/communication/ses
Authorization: Bearer <token>

{
  "region": "us-east-1",
  "accessKeyId": "AKIA...",
  "secretAccessKey": "...",
  "fromEmail": "noreply@clinic-domain.com",
  "fromName": "Clinic Name",
  "enabled": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "SES configuration updated successfully"
}
```

#### Full Communication Configuration

```bash
PUT /api/v1/clinics/{clinicId}/communication/config
Authorization: Bearer <token>

{
  "email": {
    "primary": {
      "provider": "aws_ses",
      "enabled": true,
      "credentials": {
        "region": "us-east-1",
        "accessKeyId": "AKIA...",
        "secretAccessKey": "...",
        "fromEmail": "noreply@clinic-domain.com",
        "fromName": "Clinic Name"
      },
      "priority": 1
    },
    "defaultFrom": "noreply@clinic-domain.com",
    "defaultFromName": "Clinic Name"
  }
}
```

### Method 2: Via Database (Direct Update)

```sql
-- Update clinic communication settings
UPDATE clinics
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{communicationSettings,email,primary}',
  '{
    "provider": "aws_ses",
    "enabled": true,
    "credentials": {
      "region": "us-east-1",
      "accessKeyId": "AKIA...",
      "secretAccessKey": "...",
      "fromEmail": "noreply@clinic-domain.com",
      "fromName": "Clinic Name"
    },
    "priority": 1
  }'::jsonb
)
WHERE id = 'clinic-id-here';
```

### Method 3: Using the Service (Programmatic)

```typescript
import { CommunicationConfigService } from '@communication/config';

// In your service
await this.communicationConfigService.saveClinicConfig({
  clinicId: 'clinic-123',
  email: {
    primary: {
      provider: EmailProvider.AWS_SES,
      enabled: true,
      credentials: {
        region: 'us-east-1',
        accessKeyId: 'AKIA...',
        secretAccessKey: '...',
        fromEmail: 'noreply@clinic-domain.com',
        fromName: 'Clinic Name',
      },
      priority: 1,
    },
    defaultFrom: 'noreply@clinic-domain.com',
    defaultFromName: 'Clinic Name',
  },
  whatsapp: { primary: undefined, fallback: [] },
  sms: { primary: undefined, fallback: [] },
  createdAt: new Date(),
  updatedAt: new Date(),
});
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/clinics/{clinicId}/communication/config` | GET | Get clinic communication config |
| `/api/v1/clinics/{clinicId}/communication/config` | PUT | Update full communication config |
| `/api/v1/clinics/{clinicId}/communication/ses` | PUT | Update SES config only (quick) |
| `/api/v1/clinics/{clinicId}/communication/test-email` | POST | Test email configuration |

### Required Permissions

- **View Config**: `SUPER_ADMIN`, `CLINIC_ADMIN`, `LOCATION_HEAD`
- **Update/Test**: `SUPER_ADMIN`, `CLINIC_ADMIN`

---

## Testing

### 1. Test Email Sending

```bash
# Use the test endpoint
POST /api/v1/clinics/{clinicId}/communication/test-email
Authorization: Bearer <token>

{
  "testEmail": "your-email@example.com"
}
```

### 2. Test Webhook Reception

1. Send a test email from your clinic's SES account
2. Check your application logs for webhook events
3. Verify suppression list is updated on bounces/complaints

### 3. Verify SNS Subscription

```bash
# Check subscription status
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:123456789012:healthcare-ses-events \
  --region us-east-1
```

### 4. Test Bounce Handling

1. Send email to a known invalid address (e.g., `invalid@example.com`)
2. Wait for bounce notification
3. Check suppression list: Email should be suppressed
4. Try sending to same email: Should be blocked

### 5. Check Service Initialization

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

---

## Security & Compliance

### HIPAA Compliance Setup

#### Sign Business Associate Agreement (BAA)

**Required for HIPAA compliance**:

1. Go to [AWS Artifact](https://console.aws.amazon.com/artifact/)
2. Navigate to **"Agreements"**
3. Request **"AWS Business Associate Addendum (BAA)"**
4. Review and accept the BAA
5. This enables HIPAA-eligible services including SES

#### Verify HIPAA Eligibility

1. Go to **SES** → **Configuration** → **Account dashboard**
2. Verify your account shows HIPAA-eligible status
3. Ensure you're using HIPAA-eligible regions:
   - `us-east-1` (N. Virginia)
   - `us-west-2` (Oregon)
   - `us-gov-west-1` (GovCloud)

#### Configure Email Encryption

**For PHI emails**, ensure:
- ✅ TLS encryption in transit (SES default)
- ✅ No PHI in email subject lines
- ✅ Use encrypted deep links instead of PHI in body
- ✅ Implement email encryption at rest (if required)

### Security Best Practices

1. **Encrypt Credentials**: The system automatically encrypts credentials before storing
2. **Use IAM Roles**: Prefer IAM roles over access keys when possible
3. **Rotate Keys**: Regularly rotate AWS access keys
4. **Limit Permissions**: Use IAM policies with minimal required permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:GetSendQuota",
        "ses:GetSendStatistics"
      ],
      "Resource": "*"
    }
  ]
}
```

5. **HTTPS Only**: Ensure webhook endpoint uses HTTPS
6. **Verify Signatures**: The webhook service verifies SNS message signatures

### Email Authentication (SPF, DKIM, DMARC)

**SPF (Sender Policy Framework)**:
```
v=spf1 include:amazonses.com ~all
```

**DKIM (DomainKeys Identified Mail)**:
- SES automatically signs emails with DKIM when domain is verified
- Add all provided CNAME records to your DNS

**DMARC (Domain-based Message Authentication)**:
```
v=DMARC1; p=quarantine; rua=mailto:dmarc@healthcare.com; pct=100
```

**Verify configuration**:
```bash
# Check SPF
dig TXT healthcare.com

# Check DKIM
dig TXT selector1._domainkey.healthcare.com

# Check DMARC
dig TXT _dmarc.healthcare.com
```

---

## Troubleshooting

### Webhook Not Receiving Events

1. Check SNS subscription status (should be "Confirmed")
2. Verify endpoint URL is accessible
3. Check application logs for subscription confirmation
4. Verify SES event publishing is enabled

### Cannot Identify Clinic from Email

1. Ensure `fromEmail` in clinic config matches SES source email
2. Check `ClinicEmailMapperService` logs
3. Verify clinic configuration is saved correctly
4. Clear cache if configuration was recently updated

### Suppression List Not Working

1. Verify `clinicId` is being passed correctly
2. Check database for suppression entries
3. Verify unique constraint allows null `clinicId`
4. Check cache invalidation

### "AWS credentials not provided"

**Solution**:
1. Check `.env` file has all AWS variables
2. Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are correct
3. Restart server after changing `.env`

### "Email address is not verified"

**Solution**:
1. Verify the email address in SES console
2. Check spam folder for verification email
3. For production, verify the entire domain

### "Account is in sandbox mode"

**Solution**:
1. Request production access (see Production Access section)
2. Wait for AWS approval
3. Or verify recipient email addresses for testing

### "Message rejected: Email address not verified"

**Solution**:
1. In sandbox mode, recipient must be verified
2. Verify recipient email in SES console
3. Or request production access

### "Sending quota exceeded"

**Solution**:
1. Check your sending quota in SES dashboard
2. Request quota increase if needed
3. Implement rate limiting in your application

### "High bounce rate"

**Solution**:
1. Verify email addresses before sending
2. Remove invalid addresses from your list
3. Implement double opt-in for subscriptions
4. Monitor bounce notifications

### "High complaint rate"

**Solution**:
1. Ensure recipients opted in
2. Include unsubscribe links
3. Send relevant content only
4. Monitor complaint notifications
5. Remove complainers from your list

### "Failed to update SES configuration"

**Solution**:
1. Check that all required fields are provided
2. Verify AWS credentials are valid
3. Ensure IAM user has SES permissions

### "Test email failed"

**Solution**:
1. Verify SES identity (domain/email) is verified
2. Check SES is out of sandbox mode (if needed)
3. Verify fromEmail matches verified identity
4. Check suppression list for test email

### "Cannot find SNS topic option in SES Notifications"

**Solution**:
1. **Make sure you created the SNS topic first**:
   - Go to AWS SNS Console (NOT SES console)
   - Create the topic there first
   - Copy the Topic ARN
2. **Check you're in the same AWS region**:
   - SNS topic must be in the same region as your SES identity
   - Verify both are in the same region (e.g., both in `us-east-1`)
3. **If dropdown is empty**:
   - Try refreshing the page
   - Or manually enter the Topic ARN: `arn:aws:sns:region:account-id:topic-name`
4. **Alternative: Create topic from SES console**:
   - In the Notifications tab, look for "Create SNS topic" link
   - This will create a new topic and automatically select it
5. **Check IAM permissions**:
   - Your IAM user needs `sns:ListTopics` permission to see topics in dropdown

---

## Cost Management

### SES Pricing

- **First 62,000 emails/month**: Free (if sent from EC2)
- **After free tier**: $0.10 per 1,000 emails
- **Data transfer**: $0.12 per GB (after free tier)

### Cost Optimization

**Tips to reduce costs**:
- Use EC2/ECS to send emails (free tier applies)
- Batch emails when possible
- Use email templates to reduce size
- Monitor and remove invalid email addresses

**Example**:
- 100,000 emails/month
- Cost: ~$3.80/month (after free tier)

### Set Up Billing Alerts

1. Go to **AWS Billing** → **Budgets**
2. Create budget for SES costs
3. Set alert threshold (e.g., $50/month)
4. Get notified if costs exceed threshold

---

## Advanced Configuration

### Configuration Sets

**Configuration Sets** are different from SNS Topics:

- **Configuration Sets**: Part of AWS SES. Used to group email sending configurations, event publishing settings, and reputation tracking.
- **SNS Topics**: Part of AWS SNS. Used to receive and route notifications (bounces, complaints, deliveries) to your application.

**How they work together**:
1. Create a **Configuration Set** in SES
2. Configure the Configuration Set to publish events to an **SNS Topic**
3. Subscribe your webhook endpoint to the **SNS Topic**
4. When sending emails, specify the **Configuration Set** name

**Create configuration sets for different email types**:

1. Go to **SES** → **Configuration** → **Configuration sets**
2. Click **"Create set"**
3. Create sets:
   - `transactional` - For transactional emails
   - `marketing` - For marketing emails
   - `notifications` - For notifications
4. Configure each set:
   - **Event publishing**: Select your SNS topic for bounces, complaints, deliveries
   - **Reputation metrics**: Enable tracking
   - **Delivery options**: Configure delivery settings
5. **Use in your code**: When sending emails, include `ConfigurationSetName`:

```typescript
const command = new SendEmailCommand({
  Source: 'noreply@example.com',
  Destination: { ToAddresses: ['user@example.com'] },
  Message: { /* ... */ },
  ConfigurationSetName: 'transactional', // ← Use the configuration set
});
```

### Email Templates

Use SES templates for consistent emails:

1. Go to **SES** → **Email templates**
2. Create templates for:
   - Welcome emails
   - Password reset
   - Appointment reminders
   - Prescription notifications
3. Use templates in your application

### Dedicated IP Addresses

For high-volume sending:

1. Go to **SES** → **Configuration** → **Dedicated IPs**
2. Request dedicated IP pool
3. Warm up IP addresses gradually
4. Monitor IP reputation

---

## Monitoring

### SES Sending Statistics

1. Go to **SES** → **Account dashboard**
2. View:
   - **Sending quota**: Daily sending limit
   - **Sending rate**: Emails per second
   - **Reputation metrics**: Bounce and complaint rates
   - **Sending statistics**: Success/failure rates

### Set Up CloudWatch Metrics

Monitor SES metrics:
- `Send` - Number of emails sent
- `Bounce` - Number of bounces
- `Complaint` - Number of spam complaints
- `Delivery` - Number of successful deliveries
- `Reject` - Number of rejected emails

### Configure Bounce and Complaint Handling

**Method 1: Via Verified Identity (Simpler - Recommended)**

1. Go to **SES** → **Verified identities**
2. Click on your verified identity (domain or email)
3. Go to **"Notifications"** tab
4. Configure event publishing to your SNS topic (see Step 2 in SNS Topic Setup section)

**Method 2: Via Configuration Sets (Advanced)**

1. Go to **SES** → **Configuration** → **Configuration sets**
2. Create or select a configuration set
3. Go to **"Event publishing"** tab
4. Configure:
   - **Bounces**: Select your SNS topic
   - **Complaints**: Select your SNS topic
   - **Deliveries**: Select your SNS topic (optional)
5. When sending emails, include `ConfigurationSetName` in your SendEmailCommand

**Note**: For most use cases, Method 1 (via Verified Identity) is simpler and sufficient.

---

## Quick Reference

### Complete Setup Checklist

- [ ] AWS account created
- [ ] IAM user created with SES permissions
- [ ] Access keys saved securely
- [ ] Email address verified (development)
- [ ] Domain verified (production)
- [ ] DNS records added (SPF, DKIM, DMARC)
- [ ] Production access requested (if needed)
- [ ] Environment variables configured
- [ ] BAA signed (for HIPAA compliance)
- [ ] SNS topic created and subscribed
- [ ] SES event publishing configured
- [ ] Service initialized successfully
- [ ] Test email sent successfully
- [ ] Email delivery verified
- [ ] Monitoring set up
- [ ] Bounce/complaint handling configured
- [ ] Clinic configurations updated

### Example: Complete Setup for a Clinic

```bash
# 1. Get clinic ID
CLINIC_ID="clinic-123"

# 2. Update SES configuration
curl -X PUT "https://api.your-domain.com/api/v1/clinics/$CLINIC_ID/communication/ses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "region": "us-east-1",
    "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
    "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "fromEmail": "noreply@clinic-domain.com",
    "fromName": "My Clinic",
    "enabled": true
  }'

# 3. Test configuration
curl -X POST "https://api.your-domain.com/api/v1/clinics/$CLINIC_ID/communication/test-email" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "testEmail": "your-email@example.com"
  }'

# 4. Verify configuration
curl -X GET "https://api.your-domain.com/api/v1/clinics/$CLINIC_ID/communication/config" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Next Steps

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

## Additional Resources

- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [SES Best Practices](https://docs.aws.amazon.com/ses/latest/dg/best-practices.html)
- [HIPAA Compliance with AWS](https://aws.amazon.com/compliance/hipaa-compliance/)
- [SES Pricing](https://aws.amazon.com/ses/pricing/)
- [Email Authentication Guide](https://docs.aws.amazon.com/ses/latest/dg/email-authentication.html)
- [Multi-Tenant Communication Guide](../features/MULTI_TENANT_COMMUNICATION.md)

---

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review AWS CloudWatch logs
3. Check backend application logs
4. Verify environment variables are set correctly
5. Ensure email addresses/domains are verified
6. Check SES sending statistics and reputation

---

**Last Updated**: January 2025

