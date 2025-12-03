# 🚀 Appointment & Follow-Up Flow - Quick Reference

## 📋 Quick Navigation

- [Regular Appointment](#regular-appointment)
- [Follow-Up Appointment](#follow-up-appointment)
- [Recurring Appointments](#recurring-appointments)
- [API Endpoints](#api-endpoints)
- [Status Transitions](#status-transitions)

---

## 🔄 Regular Appointment

### Creation Flow
```
Client Request → Validation → Conflict Check → Create → Notify → Response
```

### Key Endpoints
- `POST /appointments` - Create appointment
- `GET /appointments/:id` - Get appointment
- `PUT /appointments/:id` - Update appointment
- `POST /appointments/:id/complete` - Complete appointment

### Status Flow
```
PENDING → SCHEDULED → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED
```

---

## 🔁 Follow-Up Appointment

### Auto-Schedule Flow
```
Complete Appointment (with followUpRequired) 
  → Create FollowUpPlan 
  → Create FollowUpAppointment (if date provided)
  → Link & Notify
```

### Manual Schedule Flow
```
Get FollowUpPlans → Select Plan → Schedule Appointment → Link Plan → Notify
```

### Key Endpoints
- `POST /appointments/:id/complete` - Complete with follow-up
- `GET /patients/:id/follow-up-plans` - Get pending plans
- `POST /follow-up-plans/:id/schedule` - Schedule from plan
- `GET /appointments/:id/chain` - Get appointment chain

### Follow-Up Plan States
```
scheduled → completed (when appointment created)
         → cancelled
         → overdue
```

---

## 🔂 Recurring Appointments

### Creation Flow
```
Create Series → Generate Dates → Create Appointments → Link Series → Notify All
```

### Key Endpoints
- `POST /appointments/recurring` - Create recurring series
- `GET /appointments/series/:id` - Get series details

### Series Structure
```
RecurringAppointmentSeries
  ├── Appointment 1 (seriesSequence: 1)
  ├── Appointment 2 (seriesSequence: 2)
  └── Appointment N (seriesSequence: N)
```

---

## 🔌 API Endpoints

### Appointment Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/appointments` | Create appointment |
| GET | `/appointments/:id` | Get appointment |
| PUT | `/appointments/:id` | Update appointment |
| DELETE | `/appointments/:id` | Cancel appointment |
| POST | `/appointments/:id/complete` | Complete appointment |
| POST | `/appointments/:id/check-in` | Check in patient |
| POST | `/appointments/:id/start` | Start consultation |

### Follow-Up Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/appointments/:id/follow-up` | Create follow-up from appointment |
| GET | `/appointments/:id/follow-ups` | Get all follow-ups |
| GET | `/appointments/:id/chain` | Get appointment chain |
| GET | `/patients/:id/follow-up-plans` | Get patient's follow-up plans |
| POST | `/follow-up-plans/:id/schedule` | Schedule appointment from plan |
| PUT | `/follow-up-plans/:id` | Update follow-up plan |
| DELETE | `/follow-up-plans/:id` | Cancel follow-up plan |

### Recurring Appointments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/appointments/recurring` | Create recurring series |
| GET | `/appointments/series/:id` | Get series details |
| PUT | `/appointments/series/:id` | Update series |
| DELETE | `/appointments/series/:id` | Cancel series |

---

## 📊 Status Transitions

### Regular Appointment
```
PENDING
  ↓
SCHEDULED
  ↓
CONFIRMED
  ↓
CHECKED_IN
  ↓
IN_PROGRESS
  ↓
COMPLETED
```

### Follow-Up Appointment
```
FOLLOW_UP_SCHEDULED (plan exists)
  ↓
SCHEDULED (appointment created)
  ↓
CONFIRMED
  ↓
CHECKED_IN
  ↓
IN_PROGRESS
  ↓
COMPLETED
```

### Follow-Up Plan
```
scheduled → completed (appointment created)
         → cancelled
         → overdue
```

---

## 🗄️ Database Relationships

### Appointment Relationships
```
Appointment
  ├── parentAppointmentId → Appointment (parent)
  ├── followUpAppointments[] → Appointment[] (children)
  ├── seriesId → RecurringAppointmentSeries
  └── followUpPlan → FollowUpPlan
```

### Follow-Up Plan Relationships
```
FollowUpPlan
  ├── appointmentId → Appointment (original)
  └── followUpAppointmentId → Appointment (scheduled)
```

---

## 🔑 Key Fields

### Appointment Fields
- `parentAppointmentId`: Links to parent appointment
- `isFollowUp`: Boolean flag for follow-up
- `followUpReason`: Why follow-up was created
- `originalAppointmentId`: Original appointment reference
- `seriesId`: Recurring series ID
- `seriesSequence`: Position in series

### Follow-Up Plan Fields
- `appointmentId`: Original appointment
- `scheduledFor`: Recommended date
- `followUpType`: routine, urgent, specialist, therapy, surgery
- `status`: scheduled, completed, cancelled, overdue
- `followUpAppointmentId`: Linked appointment (when created)

---

## 📝 Common Use Cases

### Use Case 1: Doctor Completes Consultation with Follow-Up
```typescript
POST /appointments/:id/complete
{
  followUpRequired: true,
  followUpDate: "2024-02-15",
  followUpType: "routine",
  followUpInstructions: "Monitor progress"
}
```

### Use Case 2: Patient Schedules Follow-Up from Plan
```typescript
// 1. Get pending plans
GET /patients/:patientId/follow-up-plans?status=scheduled

// 2. Schedule from plan
POST /follow-up-plans/:planId/schedule
{
  appointmentDate: "2024-02-15T10:00:00Z",
  doctorId: "doctor-uuid",
  locationId: "location-uuid"
}
```

### Use Case 3: View Appointment History
```typescript
// Get complete chain
GET /appointments/:id/chain

// Response includes:
// - Original appointment
// - All follow-up appointments
// - Follow-up plans
```

---

## ⚡ Quick Tips

1. **Always check appointment status** before operations
2. **Validate follow-up dates** are >= plan.scheduledFor
3. **Link appointments** when creating follow-ups
4. **Update follow-up plan status** when converting to appointment
5. **Use indexes** for parentAppointmentId queries
6. **Cache appointment chains** for performance
7. **Emit events** for all state changes
8. **Log HIPAA audit trail** for all operations

---

## 🚨 Common Errors

| Error Code | Description | Solution |
|------------|-------------|----------|
| `FOLLOWUP_PLAN_NOT_FOUND` | Plan doesn't exist | Verify plan ID |
| `FOLLOWUP_PLAN_ALREADY_CONVERTED` | Plan already has appointment | Check plan status |
| `INVALID_FOLLOWUP_DATE` | Date < plan.scheduledFor | Use valid date |
| `SCHEDULING_CONFLICT` | Time slot unavailable | Suggest alternatives |
| `APPOINTMENT_NOT_FOUND` | Appointment doesn't exist | Verify appointment ID |

---

## 📚 Related Docs

- [Complete Flow Documentation](./APPOINTMENT_FOLLOWUP_FLOW.md)
- [API Documentation](../../api/APPOINTMENTS_API.md)
- [Database Schema](../../../src/libs/infrastructure/database/prisma/README.md)

---

**Last Updated**: 2024-01-15


