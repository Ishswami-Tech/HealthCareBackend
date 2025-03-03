# WhatsApp Integration for Healthcare App

This document provides instructions on how to set up and use the WhatsApp integration for sending OTPs, appointment reminders, and prescription notifications in the Healthcare App.

## Prerequisites

To use the WhatsApp Business API, you need:

1. A Meta Developer account
2. A WhatsApp Business account
3. A verified phone number for your WhatsApp Business account
4. Approved message templates for OTPs, appointment reminders, and prescriptions

## Setup Instructions

### 1. Register for WhatsApp Business API

1. Go to [Meta for Developers](https://developers.facebook.com/) and create an account
2. Create a new app and select "Business" as the app type
3. Add the "WhatsApp" product to your app
4. Follow the setup instructions to create a WhatsApp Business account

### 2. Create Message Templates

You need to create and get approval for message templates for:

1. **OTP Verification**: A template for sending one-time passwords
2. **Appointment Reminder**: A template for sending appointment reminders
3. **Prescription Notification**: A template for notifying about new prescriptions

Example OTP template:
```
Your OTP code is {{1}} and is valid for {{2}} minutes. Please do not share this code with anyone.
```

### 3. Configure Environment Variables

Update your `.env` file with the following WhatsApp configuration:

```
# WhatsApp Configuration
WHATSAPP_ENABLED=true
WHATSAPP_API_URL=https://graph.facebook.com/v17.0
WHATSAPP_API_KEY=your-whatsapp-api-key
WHATSAPP_PHONE_NUMBER_ID=your-whatsapp-phone-number-id
WHATSAPP_BUSINESS_ACCOUNT_ID=your-whatsapp-business-account-id
WHATSAPP_OTP_TEMPLATE_ID=your_otp_template_name
WHATSAPP_APPOINTMENT_TEMPLATE_ID=your_appointment_template_name
WHATSAPP_PRESCRIPTION_TEMPLATE_ID=your_prescription_template_name
```

Replace the placeholder values with your actual WhatsApp Business API credentials.

### 4. Testing the Integration

1. Set `WHATSAPP_ENABLED=true` in your `.env` file
2. Restart the application
3. Test sending an OTP via WhatsApp by making a POST request to:

```
POST /auth/request-otp
{
  "email": "user@example.com",
  "deliveryMethod": "whatsapp"
}
```

## Usage in the Application

### Sending OTPs

The application can now send OTPs via WhatsApp by specifying `"deliveryMethod": "whatsapp"` in the request to `/auth/request-otp`.

### Sending Appointment Reminders

You can send appointment reminders programmatically using the `WhatsAppService`:

```typescript
await whatsAppService.sendAppointmentReminder(
  phoneNumber,
  patientName,
  doctorName,
  appointmentDate,
  appointmentTime,
  location
);
```

### Sending Prescription Notifications

You can send prescription notifications programmatically using the `WhatsAppService`:

```typescript
await whatsAppService.sendPrescriptionNotification(
  phoneNumber,
  patientName,
  doctorName,
  medicationDetails,
  prescriptionUrl // optional
);
```

## Troubleshooting

- **Messages not being delivered**: Check that your WhatsApp Business account is properly set up and that your templates have been approved.
- **API errors**: Verify that your API key and phone number ID are correct.
- **Template errors**: Ensure that the parameters you're passing match the expected format of your approved templates.

## Best Practices

1. Always get explicit consent from users before sending them WhatsApp messages
2. Keep messages concise and relevant
3. Use templates for consistent messaging
4. Implement proper error handling for failed message deliveries
5. Monitor message delivery rates and user engagement

## Resources

- [WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp/api/reference)
- [WhatsApp Business Platform](https://business.whatsapp.com/)
- [Meta for Developers](https://developers.facebook.com/) 