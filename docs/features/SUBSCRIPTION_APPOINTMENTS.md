# Subscription-Based Appointments

This document explains how the subscription-based appointments system works in the healthcare backend.

## Overview

The system allows patients to subscribe to billing plans that include appointment quotas. Patients can book appointments using their subscription instead of paying per appointment.

## Database Schema

### Enhanced Models

#### BillingPlan
- `appointmentsIncluded`: Number of appointments included per billing period (nullable)
- `isUnlimitedAppointments`: Boolean flag for unlimited appointments
- `appointmentTypes`: JSON field to specify which appointment types are covered

#### Subscription
- `appointmentsUsed`: Counter for appointments used in current period
- `appointmentsRemaining`: Remaining appointments in current period (null for unlimited)
- Links to `Appointment` records

#### Appointment
- `subscriptionId`: Reference to subscription (nullable)
- `isSubscriptionBased`: Boolean flag indicating if appointment uses subscription
- Links to `Subscription` model

## API Endpoints

### Billing Plans

#### Create Billing Plan with Appointments
```http
POST /billing/plans
```

**Request Body:**
```json
{
  "name": "Premium Monthly",
  "description": "Premium plan with 10 appointments per month",
  "amount": 2999.00,
  "currency": "INR",
  "interval": "MONTHLY",
  "appointmentsIncluded": 10,
  "isUnlimitedAppointments": false,
  "appointmentTypes": {
    "IN_PERSON": true,
    "VIDEO_CALL": true,
    "HOME_VISIT": false
  }
}
```

**Example: Unlimited Plan**
```json
{
  "name": "Enterprise Unlimited",
  "amount": 9999.00,
  "interval": "MONTHLY",
  "isUnlimitedAppointments": true
}
```

### Subscriptions

#### Check if User Can Book Appointment
```http
GET /billing/subscriptions/:subscriptionId/can-book-appointment
```

**Response:**
```json
{
  "allowed": true
}
```

**Error Response:**
```json
{
  "allowed": false,
  "reason": "Appointment quota exceeded for this period"
}
```

#### Get Active User Subscription
```http
GET /billing/subscriptions/user/:userId/active?clinicId=xxx
```

**Response:**
```json
{
  "id": "sub_123",
  "userId": "user_456",
  "planId": "plan_789",
  "status": "ACTIVE",
  "appointmentsUsed": 3,
  "appointmentsRemaining": 7,
  "currentPeriodStart": "2025-01-01T00:00:00Z",
  "currentPeriodEnd": "2025-02-01T00:00:00Z",
  "plan": {
    "name": "Premium Monthly",
    "appointmentsIncluded": 10,
    "isUnlimitedAppointments": false
  }
}
```

#### Book Appointment with Subscription
```http
POST /billing/subscriptions/:subscriptionId/book-appointment/:appointmentId
```

**Response:**
```json
{
  "message": "Appointment booked with subscription"
}
```

This endpoint:
1. Validates subscription status and quota
2. Links appointment to subscription
3. Decrements available quota
4. Updates usage tracking

#### Cancel Subscription Appointment
```http
POST /billing/appointments/:appointmentId/cancel-subscription
```

**Response:**
```json
{
  "message": "Subscription appointment cancelled, quota restored"
}
```

This endpoint restores the appointment quota when a subscription-based appointment is cancelled.

#### Get Subscription Usage Stats
```http
GET /billing/subscriptions/:subscriptionId/usage-stats
```

**Response:**
```json
{
  "subscriptionId": "sub_123",
  "planName": "Premium Monthly",
  "appointmentsIncluded": 10,
  "isUnlimited": false,
  "appointmentsUsed": 3,
  "appointmentsRemaining": 7,
  "actualAppointmentCount": 3,
  "periodStart": "2025-01-01T00:00:00Z",
  "periodEnd": "2025-02-01T00:00:00Z",
  "status": "ACTIVE"
}
```

#### Reset Subscription Quota (Admin Only)
```http
POST /billing/subscriptions/:subscriptionId/reset-quota
```

Manually resets the quota for a new billing period. Usually done automatically.

## Usage Flow

### 1. Create Billing Plan
Admin creates a billing plan with appointment quotas:
```javascript
const plan = await createBillingPlan({
  name: "Standard Monthly",
  amount: 1999.00,
  interval: "MONTHLY",
  appointmentsIncluded: 5
});
```

### 2. User Subscribes
Patient subscribes to the plan:
```javascript
const subscription = await createSubscription({
  userId: "user_123",
  planId: plan.id,
  clinicId: "clinic_456"
});
```

### 3. Check Quota Before Booking
Before booking, check if user has available quota:
```javascript
const canBook = await canBookAppointment(subscription.id);
if (!canBook.allowed) {
  throw new Error(canBook.reason);
}
```

### 4. Book Appointment
Create appointment and link to subscription:
```javascript
// First create the appointment
const appointment = await createAppointment({
  patientId: "user_123",
  doctorId: "doc_789",
  date: "2025-01-15",
  // ... other fields
});

// Then book with subscription
await bookAppointmentWithSubscription(
  subscription.id,
  appointment.id
);
```

### 5. Cancel if Needed
If appointment is cancelled, quota is automatically restored:
```javascript
await cancelSubscriptionAppointment(appointment.id);
```

## Business Rules

### Quota Validation
- **Active/Trialing Status**: Subscription must be ACTIVE or TRIALING
- **Period Check**: Current date must be within subscription period
- **Quota Check**: For limited plans, remaining appointments must be > 0
- **Unlimited Plans**: Always allowed if subscription is active

### Quota Management
- **On Booking**: Decrements `appointmentsRemaining` and increments `appointmentsUsed`
- **On Cancel**: Restores quota (increments remaining, decrements used)
- **Period Reset**: At period end, resets counters for new period
- **Unlimited Plans**: No quota tracking, always available

### Subscription States
- **ACTIVE**: Can book appointments
- **TRIALING**: Can book appointments (during trial period)
- **PAST_DUE**: Cannot book (payment failed)
- **CANCELLED**: Cannot book
- **PAUSED**: Cannot book

## Integration with Appointments Service

When creating appointments, check if user has an active subscription:

```typescript
// In your appointments service
async function bookAppointment(data) {
  const subscription = await billingService.getActiveUserSubscription(
    data.patientId,
    data.clinicId
  );

  if (subscription) {
    const canBook = await billingService.canBookAppointment(subscription.id);

    if (canBook.allowed) {
      // Create appointment
      const appointment = await createAppointment(data);

      // Link to subscription
      await billingService.bookAppointmentWithSubscription(
        subscription.id,
        appointment.id
      );

      return appointment;
    } else {
      // User needs to pay or upgrade subscription
      throw new Error(canBook.reason);
    }
  } else {
    // No subscription, proceed with regular payment
    return await createAppointment(data);
  }
}
```

## Example Plans

### Basic Plan
- **Price**: ₹999/month
- **Appointments**: 3 per month
- **Types**: In-person only

### Standard Plan
- **Price**: ₹1999/month
- **Appointments**: 5 per month
- **Types**: In-person + Video call

### Premium Plan
- **Price**: ₹2999/month
- **Appointments**: 10 per month
- **Types**: All types including home visits

### Enterprise Plan
- **Price**: ₹9999/month
- **Appointments**: Unlimited
- **Types**: All types with priority booking

## Events Emitted

The billing service emits the following events:

- `billing.subscription.created`: When subscription is created
- `billing.appointment.booked`: When appointment is booked with subscription
- `billing.appointment.cancelled`: When subscription appointment is cancelled
- `billing.subscription.quota_reset`: When quota is reset for new period

## Migration Guide

To apply the database changes:

```bash
npx prisma migrate dev --name add_subscription_appointments
```

This will:
1. Add appointment quota fields to BillingPlan
2. Add usage tracking to Subscription
3. Add subscription reference to Appointment
4. Create necessary indexes

## Role-Based Access Control

### Permissions by Role

**PATIENT**
- View own subscriptions
- Check own quota
- Book appointments with subscription
- Cancel own appointments

**DOCTOR**
- View patient subscriptions (for their patients)
- See appointment quota status

**RECEPTIONIST**
- Book appointments for patients using their subscription
- View patient quota status

**CLINIC_ADMIN**
- Create/manage billing plans
- View all clinic subscriptions
- Reset quotas
- Access analytics

**SUPER_ADMIN**
- Full access to all features
- Manage global billing plans
- Access all analytics

## Analytics

### Subscription Metrics
```http
GET /billing/analytics/subscriptions?clinicId=xxx
```

Returns:
- Total subscriptions
- Active/Trialing/Cancelled counts
- Monthly Recurring Revenue (MRR)
- Churn rate
- Appointment utilization

### Revenue Analytics
```http
GET /billing/analytics/revenue?clinicId=xxx&startDate=2025-01-01&endDate=2025-01-31
```

Returns:
- Total revenue
- Subscription revenue vs one-time payments
- Average payment amount
- Payment trends
