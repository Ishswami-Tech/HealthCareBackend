# API Endpoint Inventory

**Last Updated**: 2026-01-23  
**Total Endpoints**: 80+

---

## Active Endpoints (Used by Frontend)

### Authentication (`/auth`)

| Method | Endpoint                | Access        | Frontend File    | Status    |
| ------ | ----------------------- | ------------- | ---------------- | --------- |
| POST   | `/auth/login`           | PUBLIC        | `auth.server.ts` | ✅ ACTIVE |
| POST   | `/auth/register`        | PUBLIC        | `auth.server.ts` | ✅ ACTIVE |
| POST   | `/auth/logout`          | AUTHENTICATED | `auth.server.ts` | ✅ ACTIVE |
| POST   | `/auth/refresh`         | AUTHENTICATED | `auth.server.ts` | ✅ ACTIVE |
| POST   | `/auth/verify-otp`      | PUBLIC        | `auth.server.ts` | ✅ ACTIVE |
| POST   | `/auth/forgot-password` | PUBLIC        | `auth.server.ts` | ✅ ACTIVE |

---

### Users (`/user`)

| Method | Endpoint             | Access        | Frontend File     | Status    |
| ------ | -------------------- | ------------- | ----------------- | --------- |
| POST   | `/user`              | ADMIN         | `users.server.ts` | ✅ ACTIVE |
| GET    | `/user/all`          | ADMIN         | `users.server.ts` | ✅ ACTIVE |
| GET    | `/user/profile`      | AUTHENTICATED | `users.server.ts` | ✅ ACTIVE |
| GET    | `/user/:id`          | AUTHENTICATED | `users.server.ts` | ✅ ACTIVE |
| PATCH  | `/user/:id`          | AUTHENTICATED | `users.server.ts` | ✅ ACTIVE |
| DELETE | `/user/:id`          | ADMIN         | `users.server.ts` | ✅ ACTIVE |
| GET    | `/user/role/patient` | ADMIN         | `users.server.ts` | ✅ ACTIVE |
| GET    | `/user/role/doctors` | ADMIN         | `users.server.ts` | ✅ ACTIVE |
| PUT    | `/user/:id/role`     | ADMIN         | `users.server.ts` | ✅ ACTIVE |

---

### Patients (`/patients`)

| Method | Endpoint                     | Access          | Frontend File        | Status    |
| ------ | ---------------------------- | --------------- | -------------------- | --------- |
| POST   | `/patients`                  | DOCTOR, ADMIN   | `patients.server.ts` | ✅ ACTIVE |
| GET    | `/patients`                  | DOCTOR, ADMIN   | `patients.server.ts` | ✅ ACTIVE |
| GET    | `/patients/clinic/:clinicId` | CLINIC_ADMIN    | `patients.server.ts` | ✅ ACTIVE |
| GET    | `/patients/:id`              | DOCTOR, PATIENT | `patients.server.ts` | ✅ ACTIVE |
| PUT    | `/patients/:id`              | DOCTOR, PATIENT | `patients.server.ts` | ✅ ACTIVE |
| DELETE | `/patients/:id`              | ADMIN           | `patients.server.ts` | ✅ ACTIVE |

---

### Doctors (`/doctors`)

| Method | Endpoint       | Access | Frontend File       | Status    |
| ------ | -------------- | ------ | ------------------- | --------- |
| GET    | `/doctors`     | ALL    | `doctors.server.ts` | ✅ ACTIVE |
| GET    | `/doctors/:id` | ALL    | `doctors.server.ts` | ✅ ACTIVE |

---

### Staff (`/staff`)

| Method | Endpoint     | Access | Frontend File     | Status    |
| ------ | ------------ | ------ | ----------------- | --------- |
| POST   | `/staff`     | ADMIN  | `staff.server.ts` | ✅ ACTIVE |
| GET    | `/staff`     | ADMIN  | `staff.server.ts` | ✅ ACTIVE |
| GET    | `/staff/:id` | ADMIN  | `staff.server.ts` | ✅ ACTIVE |

---

### Appointments (`/appointments`)

| Method | Endpoint                                      | Access                 | Frontend File                     | Status            |
| ------ | --------------------------------------------- | ---------------------- | --------------------------------- | ----------------- |
| POST   | `/appointments`                               | PATIENT, DOCTOR        | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| GET    | `/appointments/my-appointments`               | PATIENT                | `enhanced-appointments.server.ts` | ✅ ACTIVE (FIXED) |
| GET    | `/appointments`                               | DOCTOR, ADMIN          | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| GET    | `/appointments/doctor/:doctorId/availability` | ALL                    | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| GET    | `/appointments/user/:userId/upcoming`         | AUTHENTICATED          | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| GET    | `/appointments/:id`                           | AUTHENTICATED          | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| PUT    | `/appointments/:id`                           | PATIENT, DOCTOR        | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| DELETE | `/appointments/:id`                           | PATIENT, DOCTOR, ADMIN | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| POST   | `/appointments/:id/complete`                  | DOCTOR                 | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| POST   | `/appointments/:id/check-in`                  | PATIENT                | `enhanced-appointments.server.ts` | ✅ ACTIVE         |
| POST   | `/appointments/:id/start`                     | DOCTOR                 | `enhanced-appointments.server.ts` | ✅ ACTIVE         |

---

### Pharmacy (`/pharmacy`)

| Method | Endpoint                                  | Access          | Frontend File               | Status          |
| ------ | ----------------------------------------- | --------------- | --------------------------- | --------------- |
| GET    | `/pharmacy/inventory`                     | PHARMACIST      | `pharmacy.server.ts`        | ✅ ACTIVE       |
| POST   | `/pharmacy/inventory`                     | PHARMACIST      | `pharmacy.server.ts`        | ✅ ACTIVE       |
| GET    | `/pharmacy/prescriptions`                 | PHARMACIST      | `pharmacy.server.ts`        | ✅ ACTIVE       |
| POST   | `/pharmacy/prescriptions`                 | DOCTOR          | `pharmacy.server.ts`        | ✅ ACTIVE       |
| GET    | `/pharmacy/prescriptions/patient/:userId` | PATIENT, DOCTOR | `medical-records.server.ts` | ✅ ACTIVE (NEW) |

---

### EHR (`/ehr`)

| Method | Endpoint                     | Access           | Frontend File   | Status    |
| ------ | ---------------------------- | ---------------- | --------------- | --------- |
| GET    | `/ehr/comprehensive/:userId` | PATIENT, DOCTOR  | `ehr.server.ts` | ✅ ACTIVE |
| GET    | `/ehr/vitals/:userId`        | PATIENT, DOCTOR  | `ehr.server.ts` | ✅ ACTIVE |
| GET    | `/ehr/lab-reports/:userId`   | PATIENT, DOCTOR  | `ehr.server.ts` | ✅ ACTIVE |
| GET    | `/ehr/medications/:userId`   | PATIENT, DOCTOR  | `ehr.server.ts` | ✅ ACTIVE |
| POST   | `/ehr/vitals`                | DOCTOR, NURSE    | `ehr.server.ts` | ✅ ACTIVE |
| POST   | `/ehr/lab-reports`           | DOCTOR, LAB_TECH | `ehr.server.ts` | ✅ ACTIVE |

---

### Billing (`/billing`)

| Method | Endpoint            | Access         | Frontend File       | Status    |
| ------ | ------------------- | -------------- | ------------------- | --------- |
| GET    | `/billing/invoices` | PATIENT, ADMIN | `billing.server.ts` | ✅ ACTIVE |
| POST   | `/billing/invoices` | ADMIN          | `billing.server.ts` | ✅ ACTIVE |
| GET    | `/billing/payments` | PATIENT, ADMIN | `billing.server.ts` | ✅ ACTIVE |
| POST   | `/billing/payments` | PATIENT        | `billing.server.ts` | ✅ ACTIVE |

---

### Communication (`/communication`)

| Method | Endpoint                              | Access        | Frontend File             | Status    |
| ------ | ------------------------------------- | ------------- | ------------------------- | --------- |
| GET    | `/communication/chat/history/:userId` | AUTHENTICATED | `communication.server.ts` | ✅ ACTIVE |
| POST   | `/communication/messages`             | AUTHENTICATED | `communication.server.ts` | ✅ ACTIVE |
| GET    | `/communication/notifications`        | AUTHENTICATED | `notifications.server.ts` | ✅ ACTIVE |

---

### Video (`/video`)

| Method | Endpoint                         | Access        | Frontend File     | Status    |
| ------ | -------------------------------- | ------------- | ----------------- | --------- |
| POST   | `/video/token`                   | AUTHENTICATED | `video.server.ts` | ✅ ACTIVE |
| POST   | `/video/consultation/start`      | DOCTOR        | `video.server.ts` | ✅ ACTIVE |
| POST   | `/video/consultation/end`        | DOCTOR        | `video.server.ts` | ✅ ACTIVE |
| GET    | `/video/consultation/status/:id` | AUTHENTICATED | `video.server.ts` | ✅ ACTIVE |
| POST   | `/video/recording/start`         | DOCTOR        | `video.server.ts` | ✅ ACTIVE |
| POST   | `/video/recording/stop`          | DOCTOR        | `video.server.ts` | ✅ ACTIVE |
| GET    | `/video/recording/:id`           | AUTHENTICATED | `video.server.ts` | ✅ ACTIVE |

---

### Queue (`/queue`)

| Method | Endpoint           | Access               | Frontend File     | Status    |
| ------ | ------------------ | -------------------- | ----------------- | --------- |
| POST   | `/queue/call-next` | DOCTOR, RECEPTIONIST | `queue.server.ts` | ✅ ACTIVE |
| POST   | `/queue/reorder`   | RECEPTIONIST         | `queue.server.ts` | ✅ ACTIVE |
| GET    | `/queue/stats`     | DOCTOR, RECEPTIONIST | `queue.server.ts` | ✅ ACTIVE |
| POST   | `/queue/pause`     | DOCTOR               | `queue.server.ts` | ✅ ACTIVE |
| POST   | `/queue/resume`    | DOCTOR               | `queue.server.ts` | ✅ ACTIVE |

---

## Admin-Only Endpoints (Not in Main App)

### Users

| Method | Endpoint                    | Purpose              | Status        |
| ------ | --------------------------- | -------------------- | ------------- |
| GET    | `/user/role/receptionists`  | List receptionists   | 🔧 ADMIN_ONLY |
| POST   | `/user/:id/change-location` | Change user location | 🔧 ADMIN_ONLY |

### Pharmacy

| Method | Endpoint                    | Purpose             | Status        |
| ------ | --------------------------- | ------------------- | ------------- |
| PATCH  | `/pharmacy/inventory/:id`   | Update inventory    | 🔧 ADMIN_ONLY |
| GET    | `/pharmacy/dashboard/stats` | Pharmacy statistics | 🔧 ADMIN_ONLY |

### Appointments

| Method | Endpoint                                            | Purpose                      | Status        |
| ------ | --------------------------------------------------- | ---------------------------- | ------------- |
| GET    | `/appointments/patients/:patientId/follow-up-plans` | Follow-up management         | 🔧 ADMIN_ONLY |
| POST   | `/appointments/follow-up-plans/:id/schedule`        | Schedule follow-up           | 🔧 ADMIN_ONLY |
| PUT    | `/appointments/follow-up-plans/:id`                 | Update follow-up plan        | 🔧 ADMIN_ONLY |
| DELETE | `/appointments/follow-up-plans/:id`                 | Delete follow-up plan        | 🔧 ADMIN_ONLY |
| POST   | `/appointments/recurring`                           | Create recurring appointment | 🔧 ADMIN_ONLY |
| GET    | `/appointments/series/:id`                          | Get appointment series       | 🔧 ADMIN_ONLY |

---

## Deprecated Endpoints

### Video (Old Structure)

| Method | Endpoint                             | Replacement                | Status        |
| ------ | ------------------------------------ | -------------------------- | ------------- |
| -      | `video.server.ts` functions          | `video-sessions.server.ts` | ⚠️ DEPRECATED |
| -      | `video-enhanced.server.ts` functions | `video-sessions.server.ts` | ⚠️ DEPRECATED |

**Migration**: Use `video-sessions.server.ts` for session management

---

## Future/Planned Endpoints

### Analytics

| Method | Endpoint               | Purpose             | Status     |
| ------ | ---------------------- | ------------------- | ---------- |
| GET    | `/analytics/dashboard` | Dashboard analytics | 📅 PLANNED |
| GET    | `/analytics/reports`   | Generate reports    | 📅 PLANNED |

### Telemedicine

| Method | Endpoint                      | Purpose              | Status     |
| ------ | ----------------------------- | -------------------- | ---------- |
| POST   | `/telemedicine/prescribe`     | E-prescriptions      | 📅 PLANNED |
| GET    | `/telemedicine/consultations` | Consultation history | 📅 PLANNED |

---

## Endpoint Statistics

- **Total Active**: 65+
- **Admin-Only**: 12
- **Deprecated**: 2 files
- **Planned**: 4

---

## Notes

1. **RBAC**: All endpoints enforce role-based access control
2. **Ownership**: Some endpoints check resource ownership (e.g., patients
   viewing own records)
3. **Clinic Scoping**: Most endpoints are scoped to clinic context
4. **API Versioning**: To be implemented in Phase 4

---

## Maintenance

- Review quarterly for unused endpoints
- Mark deprecated endpoints 30 days before removal
- Document all new endpoints in this inventory
- Update frontend integration status

---

**Maintained by**: Backend Team  
**Review Frequency**: Quarterly  
**Last Review**: 2026-01-23
