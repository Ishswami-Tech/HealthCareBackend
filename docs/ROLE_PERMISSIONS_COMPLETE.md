# 🏥 Healthcare System - Complete Role Permissions & Capabilities Guide

**Last Updated**: 2024  
**Status**: ✅ Complete Documentation

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Reference](#quick-reference)
3. [Role Hierarchy](#role-hierarchy)
4. [Permission System](#permission-system)
5. [Role Capabilities](#role-capabilities)
6. [Permission Matrices](#permission-matrices)
7. [Endpoint Access by Role](#endpoint-access-by-role)
8. [Role-Based Workflows](#role-based-workflows)
9. [Security & Best Practices](#security--best-practices)

---

## Overview

This healthcare system implements a comprehensive **Role-Based Access Control (RBAC)** system with **12 distinct roles**, each with specific permissions and capabilities. The system ensures:

- **Multi-tenant isolation** - Clinic-based data separation
- **Ownership validation** - Users can only access their own data (where applicable)
- **Granular permissions** - Resource:Action based permission model
- **HIPAA compliance** - Audit trails and PHI protection

### Key Concepts

- **Roles**: Define who a user is (DOCTOR, PATIENT, etc.)
- **Permissions**: Define what actions can be performed (read, create, update, delete)
- **Resources**: Define what entities are being accessed (appointments, patients, medical-records)
- **Ownership**: Some permissions require ownership (e.g., patients can only update their own appointments)

---

## Quick Reference

### Role Summary

| Role | Primary Function | Key Permissions |
|------|------------------|-----------------|
| **SUPER_ADMIN** | System administrator | All permissions (`*`) |
| **CLINIC_ADMIN** | Clinic manager | Users, appointments, clinics, reports, settings |
| **DOCTOR** | Healthcare provider | Appointments, patients, medical records, prescriptions |
| **PATIENT** | End-user | Own appointments, own medical records, billing |
| **RECEPTIONIST** | Front desk | Appointments, patient registration, scheduling |
| **NURSE** | Clinical support | Appointments (read), patients, vitals, medical records (read) |
| **PHARMACIST** | Pharmacy | Prescriptions, inventory, medications |
| **THERAPIST** | Therapy services | Appointments, therapy records, patients |
| **LAB_TECHNICIAN** | Laboratory | Lab reports, patients (read) |
| **FINANCE_BILLING** | Finance | Billing, invoices, payments, reports |
| **SUPPORT_STAFF** | General support | Appointments (read), patients (read), queue (read) |
| **COUNSELOR** | Counseling | Appointments, counseling records, patients |

### Common Actions Quick Look

| Action | SUPER_ADMIN | CLINIC_ADMIN | DOCTOR | PATIENT | RECEPTIONIST |
|--------|-------------|--------------|--------|---------|--------------|
| Create Clinic | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete Clinic | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create Appointment | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cancel Appointment | ✅ | ✅ | ❌ | ✅ | ✅ |
| Create Prescription | ✅ | ✅ | ✅ | ❌ | ❌ |
| View Medical Records | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Create Medical Records | ✅ | ✅ | ✅ | ❌ | ❌ |
| Process Payment | ✅ | ✅ | ❌ | ✅ | ❌ |
| View Analytics | ✅ | ✅ | ⚠️ | ❌ | ⚠️ |
| Manage Users | ✅ | ✅ | ❌ | ❌ | ❌ |

**Legend**: ✅ = Yes, ⚠️ = Limited (ownership-restricted), ❌ = No

---

## Role Hierarchy

```
SUPER_ADMIN (System-wide access)
    │
    ├── CLINIC_ADMIN (Clinic-level management)
    │       │
    │       ├── DOCTOR (Clinical operations)
    │       ├── NURSE (Clinical support)
    │       ├── RECEPTIONIST (Administrative)
    │       ├── PHARMACIST (Pharmacy operations)
    │       ├── THERAPIST (Therapy services)
    │       ├── LAB_TECHNICIAN (Lab operations)
    │       ├── FINANCE_BILLING (Financial operations)
    │       ├── SUPPORT_STAFF (General support)
    │       └── COUNSELOR (Counseling services)
    │
    └── PATIENT (End-user, clinic-independent)
```

---

## Permission System

### Permission Format

Permissions follow the pattern: `resource:action`

- **Resource**: The entity being accessed (e.g., `appointments`, `patients`, `medical-records`)
- **Action**: The operation being performed (e.g., `read`, `create`, `update`, `delete`, `*` for all)

### Wildcard Permissions

- `*` - All resources and actions
- `resource:*` - All actions on a specific resource
- `resource:action` - Specific action on a specific resource

### Example Permissions

```typescript
'appointments:read'     // Can read appointments
'appointments:create'   // Can create appointments
'appointments:*'        // Can perform all actions on appointments
'*'                     // Can perform all actions on all resources
```

---

## Role Capabilities

### SUPER_ADMIN

**Permission Level**: `*` (All permissions)

**Description**: System-wide administrator with unrestricted access to all features and data across all clinics.

#### Capabilities

✅ **System Management**
- Create, read, update, delete any clinic
- Manage all users across all clinics
- Assign/revoke roles for any user
- Access system-wide analytics and reports
- Configure system settings
- Manage all appointments across all clinics

✅ **User Management**
- View all users in the system
- Update any user's profile
- Delete users
- Change user roles
- View all user roles (patients, doctors, receptionists, clinic admins)

✅ **Clinic Management**
- Create new clinics
- View all clinics
- Update any clinic
- Delete clinics
- Assign clinic admins

✅ **Appointments**
- View all appointments (all clinics)
- Create appointments for any user
- Update any appointment
- Delete appointments
- Access appointment analytics
- Manage check-in locations

✅ **EHR & Medical Records**
- View all medical records
- Create/update/delete medical records
- Access comprehensive EHR data
- View all lab reports, radiology reports, surgical records
- Manage vitals, allergies, medications, immunizations

✅ **Billing & Finance**
- View all billing data
- Manage subscriptions, invoices, payments
- Access revenue analytics
- View financial reports

✅ **Video Consultations**
- Access all video consultation data
- View consultation history
- Manage video sessions

#### Key Endpoints

- `GET /user/all` - Get all users
- `PUT /user/:id/role` - Update user role
- `POST /clinics` - Create clinic
- `GET /clinics` - Get all clinics
- `PUT /clinics/:id` - Update clinic
- `DELETE /clinics/:id` - Delete clinic
- `GET /appointments` - Get all appointments
- `GET /ehr/comprehensive/:userId` - Get comprehensive EHR

---

### CLINIC_ADMIN

**Permission Level**: Clinic-level administrator

**Permissions**:
- `users:*` - Full user management within clinic
- `appointments:*` - Full appointment management
- `clinics:read` - Read clinic information
- `clinics:update` - Update clinic information
- `reports:*` - Access all reports
- `settings:*` - Manage clinic settings

**Description**: Manages all operations within their assigned clinic(s). Has full control over clinic staff, appointments, and settings.

#### Capabilities

✅ **Clinic Management**
- View clinic details
- Update clinic information (name, address, settings)
- View clinic doctors and patients
- Manage clinic locations
- Validate app names

✅ **User Management (Clinic Scope)**
- View all users in their clinic
- View users by role (patients, doctors, receptionists)
- Update user profiles (within clinic context)
- Associate users with clinic

✅ **Appointment Management**
- View all appointments in clinic
- Create appointments for any patient
- Update any appointment
- Cancel appointments
- Access appointment analytics
- Manage check-in locations
- View wait time analytics
- Create recurring appointment series
- Manage follow-up plans

✅ **Reports & Analytics**
- View clinic analytics
- Access appointment reports
- View revenue reports
- Access health analytics
- View subscription analytics

✅ **Settings**
- Manage clinic settings
- Configure clinic preferences
- Update clinic branding

#### Key Endpoints

- `GET /user/all` - Get all users (clinic-scoped)
- `GET /user/role/patient` - Get clinic patients
- `GET /user/role/doctors` - Get clinic doctors
- `GET /clinics/my-clinic` - Get my clinic
- `PUT /clinics/:id` - Update clinic
- `GET /appointments` - Get all clinic appointments
- `GET /appointments/analytics/*` - Appointment analytics
- `POST /appointments/check-in-locations` - Manage check-in locations
- `GET /billing/analytics/*` - Billing analytics

#### Restrictions

❌ Cannot delete clinics  
❌ Cannot create new clinics (unless also SUPER_ADMIN)  
❌ Cannot access other clinics' data  
❌ Cannot change user roles (SUPER_ADMIN only)

---

### DOCTOR

**Permission Level**: Clinical operations

**Permissions**:
- `appointments:read` - View appointments
- `appointments:create` - Create appointments
- `appointments:update` - Update appointments
- `patients:read` - View patient information
- `patients:update` - Update patient information
- `medical-records:*` - Full medical records access
- `prescriptions:*` - Full prescription management

**Description**: Healthcare providers who diagnose, treat patients, and manage medical records.

#### Capabilities

✅ **Appointment Management**
- View assigned appointments
- View appointment details
- Start consultations
- Complete consultations
- Create follow-up appointments
- View appointment chains
- Access appointment analytics (own appointments)
- Join video consultations
- Report technical issues

✅ **Patient Management**
- View patient profiles
- View patient medical history
- Update patient information
- Search patients

✅ **Medical Records (Full Access)**
- Create medical history entries
- Update medical records
- Delete medical records
- View comprehensive EHR
- Create lab reports
- Update lab reports
- Create radiology reports
- Update radiology reports
- Create surgical records
- Update surgical records

✅ **Vitals Management**
- Create vitals records
- Update vitals
- View patient vitals

✅ **Allergies & Medications**
- Create allergy records
- Update allergies
- Delete allergies
- Create medication records
- Update medications
- Delete medications

✅ **Immunizations**
- Create immunization records
- Update immunizations
- Delete immunizations

✅ **Prescriptions**
- Create prescriptions
- View prescriptions
- Update prescriptions
- Delete prescriptions

✅ **Video Consultations**
- Start video consultations
- End video consultations
- View consultation status
- Report technical issues
- View consultation history

#### Key Endpoints

- `GET /appointments` - Get assigned appointments
- `GET /appointments/:id` - Get appointment details
- `POST /appointments/:id/start` - Start consultation
- `POST /appointments/:id/complete` - Complete appointment
- `POST /appointments/:id/follow-up` - Create follow-up
- `GET /ehr/comprehensive/:userId` - Get comprehensive EHR
- `POST /ehr/medical-history` - Create medical history
- `POST /ehr/lab-reports` - Create lab report
- `POST /ehr/prescriptions` - Create prescription
- `POST /video/consultation/start` - Start video consultation

#### Restrictions

❌ Cannot delete appointments (only cancel)  
❌ Cannot access other doctors' appointments  
❌ Cannot view clinic-wide analytics (only own)  
❌ Cannot manage clinic settings  
❌ Cannot create/delete clinics

---

### PATIENT

**Permission Level**: End-user, self-service

**Permissions**:
- `appointments:read` - View own appointments
- `appointments:create` - Create appointments
- `appointments:update` - Update own appointments
- `profile:read` - View own profile
- `profile:update` - Update own profile
- `medical-records:read` - View own medical records
- `billing:read` - View own billing
- `subscriptions:read` - View own subscriptions
- `invoices:read` - View own invoices
- `payments:read` - View own payments
- `payments:create` - Make payments

**Description**: End-users who book appointments, view their medical records, and manage their healthcare.

#### Capabilities

✅ **Appointment Management (Own Only)**
- View own appointments
- Create new appointments
- Update own appointments
- Cancel own appointments
- Check in for appointments
- View appointment details
- View appointment chains
- View follow-up plans
- Scan QR codes for check-in

✅ **Video Consultations**
- Join video consultations
- Start video consultations (for own appointments)
- End video consultations
- View consultation status
- Report technical issues
- View consultation history

✅ **Medical Records (Read Only - Own)**
- View own comprehensive EHR
- View own medical history
- View own lab reports
- View own radiology reports
- View own surgical records
- View own vitals
- View own allergies
- View own medications
- View own immunizations
- Access health analytics (own data)

✅ **Profile Management**
- View own profile
- Update own profile
- Change password
- Manage sessions

✅ **Billing & Payments**
- View own subscriptions
- View own invoices
- View own payments
- Make payments
- View billing history

✅ **Clinic Information**
- View clinic details
- Search clinics
- Register with clinics
- View clinic doctors

#### Key Endpoints

- `GET /appointments/my-appointments` - Get my appointments
- `POST /appointments` - Create appointment
- `PUT /appointments/:id` - Update my appointment
- `DELETE /appointments/:id` - Cancel my appointment
- `POST /appointments/:id/check-in` - Check in
- `GET /ehr/comprehensive/:userId` - Get my EHR (own data only)
- `GET /user/profile` - Get my profile
- `PUT /user/profile` - Update my profile
- `GET /billing/subscriptions` - Get my subscriptions
- `GET /billing/invoices` - Get my invoices
- `POST /billing/payments` - Make payment
- `POST /clinics/register` - Register with clinic

#### Restrictions

❌ Cannot view other patients' data  
❌ Cannot create/update medical records  
❌ Cannot create prescriptions  
❌ Cannot view clinic staff information  
❌ Cannot access clinic analytics  
❌ Cannot manage appointments for others  
❌ Cannot update appointments after completion

---

### RECEPTIONIST

**Permission Level**: Administrative operations

**Permissions**:
- `appointments:*` - Full appointment management
- `patients:read` - View patient information
- `patients:create` - Register new patients
- `billing:read` - View billing information
- `scheduling:*` - Full scheduling access

**Description**: Front-desk staff who manage appointments, patient registration, and scheduling.

#### Capabilities

✅ **Appointment Management (Full)**
- View all clinic appointments
- Create appointments for any patient
- Update any appointment
- Cancel appointments
- Force check-in patients
- Create video consultation rooms
- Manage appointment queue
- View appointment analytics
- Create recurring appointment series
- Manage follow-up plans

✅ **Patient Management**
- View patient profiles
- Register new patients
- Search patients
- View patient lists

✅ **Scheduling**
- Check doctor availability
- Manage schedules
- View scheduling conflicts
- Create appointment slots

✅ **Check-in Management**
- Process patient check-ins
- Force check-in (override)
- Scan QR codes
- Manage check-in locations
- View check-in queue

✅ **Billing (Read Only)**
- View billing information
- View invoices
- View payment history

✅ **Clinic Information**
- View clinic details
- View clinic doctors
- View clinic patients

#### Key Endpoints

- `POST /appointments` - Create appointment
- `GET /appointments` - Get all appointments
- `PUT /appointments/:id` - Update appointment
- `POST /appointments/:id/force-check-in` - Force check-in
- `POST /appointments/video/create-room` - Create video room
- `GET /clinics/:id/patients` - Get clinic patients
- `GET /clinics/:id/doctors` - Get clinic doctors
- `POST /ehr/vitals` - Create vitals (during check-in)

#### Restrictions

❌ Cannot create/update medical records  
❌ Cannot create prescriptions  
❌ Cannot access detailed medical history  
❌ Cannot update clinic settings  
❌ Cannot delete appointments (only cancel)  
❌ Cannot access financial analytics

---

### NURSE

**Permission Level**: Clinical support

**Permissions**:
- `appointments:read` - View appointments
- `patients:read` - View patient information
- `patients:update` - Update patient information
- `medical-records:read` - View medical records
- `vitals:*` - Full vitals management

**Description**: Clinical support staff who assist doctors, manage vitals, and support patient care.

#### Capabilities

✅ **Appointment Management (Read Only)**
- View appointments
- View appointment details
- Check appointment status

✅ **Patient Management**
- View patient profiles
- Update patient information
- Search patients

✅ **Vitals Management (Full)**
- Create vitals records
- Update vitals
- Delete vitals
- View patient vitals history

✅ **Medical Records (Read Only)**
- View medical records
- View medical history
- View lab reports
- View allergies
- View medications

✅ **Check-in Support**
- Process check-ins
- Assist with patient registration

#### Key Endpoints

- `GET /appointments` - Get appointments
- `GET /appointments/:id` - Get appointment details
- `POST /ehr/vitals` - Create vitals
- `PUT /ehr/vitals/:id` - Update vitals
- `GET /ehr/medical-history/:userId` - View medical history
- `POST /appointments/:id/check-in` - Process check-in

#### Restrictions

❌ Cannot create appointments  
❌ Cannot update appointments  
❌ Cannot create medical records  
❌ Cannot create prescriptions  
❌ Cannot access billing data  
❌ Cannot manage clinic settings

---

### PHARMACIST

**Permission Level**: Pharmacy operations

**Permissions**:
- `prescriptions:read` - View prescriptions
- `patients:read` - View patient information
- `inventory:*` - Full inventory management
- `medications:*` - Full medication management
- `profile:read` - View own profile
- `profile:update` - Update own profile

**Description**: Pharmacy staff who manage prescriptions, medications, and inventory.

#### Capabilities

✅ **Prescription Management**
- View prescriptions
- Process prescriptions
- Update prescription status
- View prescription history

✅ **Patient Management (Read Only)**
- View patient profiles
- View patient medication history
- Search patients

✅ **Inventory Management (Full)**
- Manage medication inventory
- Track stock levels
- Update inventory
- View inventory reports

✅ **Medications Management (Full)**
- View medication database
- Add medications
- Update medication information
- Manage medication interactions

#### Key Endpoints

- `GET /ehr/prescriptions` - Get prescriptions
- `GET /ehr/prescriptions/:id` - Get prescription details
- `GET /ehr/medications` - Get medications
- `POST /ehr/medications` - Add medication
- `GET /inventory/*` - Inventory management

#### Restrictions

❌ Cannot create prescriptions (doctors only)  
❌ Cannot create appointments  
❌ Cannot access medical records (except medications)  
❌ Cannot access billing data  
❌ Cannot manage clinic settings

---

### THERAPIST

**Permission Level**: Therapy services

**Permissions**:
- `appointments:read` - View appointments
- `appointments:update` - Update appointments
- `patients:read` - View patient information
- `therapy:*` - Full therapy management
- `medical-records:read` - View medical records
- `profile:read` - View own profile
- `profile:update` - Update own profile

**Description**: Therapy specialists who provide therapy services and manage therapy sessions.

#### Capabilities

✅ **Appointment Management**
- View assigned appointments
- Update appointments
- Start therapy sessions
- Complete therapy sessions
- Create follow-up appointments

✅ **Patient Management**
- View patient profiles
- View patient therapy history

✅ **Therapy Management (Full)**
- Create therapy records
- Update therapy plans
- Track therapy progress
- View therapy analytics

✅ **Medical Records (Read Only)**
- View relevant medical records
- View patient history related to therapy

#### Key Endpoints

- `GET /appointments` - Get assigned appointments
- `PUT /appointments/:id` - Update appointment
- `POST /therapy/*` - Therapy management endpoints
- `GET /ehr/medical-history/:userId` - View patient history

#### Restrictions

❌ Cannot create appointments (only update)  
❌ Cannot create prescriptions  
❌ Cannot access billing data  
❌ Cannot manage clinic settings

---

### LAB_TECHNICIAN

**Permission Level**: Laboratory operations

**Permissions**:
- `lab-reports:*` - Full lab report management
- `patients:read` - View patient information
- `medical-records:read` - View medical records
- `vitals:read` - View vitals
- `profile:read` - View own profile
- `profile:update` - Update own profile

**Description**: Laboratory staff who manage lab tests, results, and reports.

#### Capabilities

✅ **Lab Reports Management (Full)**
- Create lab reports
- Update lab reports
- Delete lab reports
- View lab report history
- Upload lab results
- Generate lab reports

✅ **Patient Management (Read Only)**
- View patient profiles
- Search patients by lab orders

✅ **Medical Records (Read Only)**
- View relevant medical records
- View patient history

✅ **Vitals (Read Only)**
- View patient vitals (for context)

#### Key Endpoints

- `POST /ehr/lab-reports` - Create lab report
- `PUT /ehr/lab-reports/:id` - Update lab report
- `DELETE /ehr/lab-reports/:id` - Delete lab report
- `GET /ehr/lab-reports/:userId` - Get patient lab reports
- `GET /ehr/vitals/:userId` - View patient vitals

#### Restrictions

❌ Cannot create appointments  
❌ Cannot create prescriptions  
❌ Cannot access billing data  
❌ Cannot update medical records (except lab reports)  
❌ Cannot manage clinic settings

---

### FINANCE_BILLING

**Permission Level**: Financial operations

**Permissions**:
- `billing:*` - Full billing management
- `invoices:*` - Full invoice management
- `payments:*` - Full payment management
- `reports:read` - View financial reports
- `patients:read` - View patient information
- `profile:read` - View own profile
- `profile:update` - Update own profile

**Description**: Finance staff who manage billing, invoices, payments, and financial reporting.

#### Capabilities

✅ **Billing Management (Full)**
- View all billing data
- Create billing records
- Update billing information
- Process refunds
- Manage billing disputes

✅ **Invoice Management (Full)**
- Create invoices
- Update invoices
- Delete invoices
- Generate invoice PDFs
- Send invoices via WhatsApp/Email
- View invoice history

✅ **Payment Management (Full)**
- Process payments
- View payment history
- Refund payments
- Manage payment methods
- View payment analytics

✅ **Financial Reports**
- View revenue reports
- Access subscription analytics
- View payment analytics
- Generate financial statements

✅ **Subscription Management**
- View subscriptions
- Manage subscription plans
- Process subscription renewals
- Handle subscription cancellations

#### Key Endpoints

- `GET /billing/*` - All billing endpoints
- `POST /billing/invoices` - Create invoice
- `PUT /billing/invoices/:id` - Update invoice
- `GET /billing/analytics/revenue` - Revenue analytics
- `GET /billing/subscriptions` - View subscriptions
- `POST /billing/payments` - Process payment

#### Restrictions

❌ Cannot create appointments  
❌ Cannot access medical records  
❌ Cannot create prescriptions  
❌ Cannot manage clinic settings  
❌ Cannot view detailed patient medical history

---

### SUPPORT_STAFF

**Permission Level**: General support

**Permissions**:
- `appointments:read` - View appointments
- `patients:read` - View patient information
- `queue:read` - View queue information
- `profile:read` - View own profile
- `profile:update` - Update own profile

**Description**: General support staff who assist with basic operations and queue management.

#### Capabilities

✅ **Appointment Management (Read Only)**
- View appointments
- View appointment status
- Check appointment details

✅ **Patient Management (Read Only)**
- View patient profiles
- Search patients
- View patient lists

✅ **Queue Management (Read Only)**
- View appointment queue
- Check queue status
- View wait times

✅ **Basic Support**
- Assist with check-ins
- Provide general information
- Support patient inquiries

#### Key Endpoints

- `GET /appointments` - Get appointments
- `GET /appointments/:id` - Get appointment details
- `GET /appointments/queue` - View queue
- `GET /clinics/:id/patients` - View patients

#### Restrictions

❌ Cannot create/update appointments  
❌ Cannot access medical records  
❌ Cannot access billing data  
❌ Cannot create prescriptions  
❌ Cannot manage clinic settings  
❌ Very limited permissions (read-only support role)

---

### COUNSELOR

**Permission Level**: Counseling services

**Permissions**:
- `appointments:read` - View appointments
- `appointments:update` - Update appointments
- `patients:read` - View patient information
- `counseling:*` - Full counseling management
- `medical-records:read` - View medical records
- `profile:read` - View own profile
- `profile:update` - Update own profile

**Description**: Counseling specialists who provide counseling services and manage counseling sessions.

#### Capabilities

✅ **Appointment Management**
- View assigned appointments
- Update appointments
- Start counseling sessions
- Complete counseling sessions
- Create follow-up appointments

✅ **Patient Management**
- View patient profiles
- View patient counseling history

✅ **Counseling Management (Full)**
- Create counseling records
- Update counseling plans
- Track counseling progress
- View counseling analytics
- Manage counseling sessions

✅ **Medical Records (Read Only)**
- View relevant medical records
- View patient history related to counseling

#### Key Endpoints

- `GET /appointments` - Get assigned appointments
- `PUT /appointments/:id` - Update appointment
- `POST /counseling/*` - Counseling management endpoints
- `GET /ehr/medical-history/:userId` - View patient history

#### Restrictions

❌ Cannot create appointments (only update)  
❌ Cannot create prescriptions  
❌ Cannot access billing data  
❌ Cannot manage clinic settings

---

## Permission Matrices

### Quick Reference Table

| Resource | Action | SUPER_ADMIN | CLINIC_ADMIN | DOCTOR | PATIENT | RECEPTIONIST | NURSE | PHARMACIST | THERAPIST | LAB_TECH | FINANCE | SUPPORT | COUNSELOR |
|----------|--------|-------------|--------------|--------|---------|--------------|-------|------------|-----------|----------|---------|---------|-----------|
| **Users** | * | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Appointments** | * | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ |
| **Patients** | * | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **Medical Records** | * | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ |
| **Prescriptions** | * | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Clinics** | * | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Billing** | * | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Reports** | * | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| **Settings** | * | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Legend**:
- ✅ = Full access (all actions)
- ⚠️ = Limited access (specific actions, may be ownership-restricted)
- ❌ = No access

### Detailed Permission Breakdown

#### Appointments

| Role | Read | Create | Update | Delete | Notes |
|------|------|--------|--------|--------|-------|
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | All appointments, all clinics |
| CLINIC_ADMIN | ✅ | ✅ | ✅ | ✅ | All appointments in clinic |
| DOCTOR | ✅ | ✅ | ✅ | ❌ | Own appointments only (update), assigned appointments (read) |
| PATIENT | ✅ | ✅ | ✅ | ✅ | Own appointments only |
| RECEPTIONIST | ✅ | ✅ | ✅ | ❌ | All appointments in clinic |
| NURSE | ✅ | ❌ | ❌ | ❌ | Read only |
| PHARMACIST | ❌ | ❌ | ❌ | ❌ | No access |
| THERAPIST | ✅ | ❌ | ✅ | ❌ | Assigned appointments only |
| LAB_TECHNICIAN | ❌ | ❌ | ❌ | ❌ | No access |
| FINANCE_BILLING | ❌ | ❌ | ❌ | ❌ | No access |
| SUPPORT_STAFF | ✅ | ❌ | ❌ | ❌ | Read only |
| COUNSELOR | ✅ | ❌ | ✅ | ❌ | Assigned appointments only |

#### Medical Records

| Role | Read | Create | Update | Delete | Notes |
|------|------|--------|--------|--------|-------|
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | All records |
| CLINIC_ADMIN | ✅ | ✅ | ✅ | ✅ | Clinic records |
| DOCTOR | ✅ | ✅ | ✅ | ✅ | Full access |
| PATIENT | ✅ | ❌ | ❌ | ❌ | Own records only |
| RECEPTIONIST | ❌ | ❌ | ❌ | ❌ | No access |
| NURSE | ✅ | ❌ | ❌ | ❌ | Read only |
| PHARMACIST | ❌ | ❌ | ❌ | ❌ | No access |
| THERAPIST | ✅ | ❌ | ❌ | ❌ | Read only |
| LAB_TECHNICIAN | ✅ | ✅ | ✅ | ✅ | Lab reports only |
| FINANCE_BILLING | ❌ | ❌ | ❌ | ❌ | No access |
| SUPPORT_STAFF | ❌ | ❌ | ❌ | ❌ | No access |
| COUNSELOR | ✅ | ❌ | ❌ | ❌ | Read only |

#### Patients

| Role | Read | Create | Update | Delete | Notes |
|------|------|--------|--------|--------|-------|
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | All patients |
| CLINIC_ADMIN | ✅ | ✅ | ✅ | ✅ | Clinic patients |
| DOCTOR | ✅ | ❌ | ✅ | ❌ | Can update patient info |
| PATIENT | ✅ | ❌ | ✅ | ❌ | Own profile only |
| RECEPTIONIST | ✅ | ✅ | ❌ | ❌ | Can register patients |
| NURSE | ✅ | ❌ | ✅ | ❌ | Can update patient info |
| PHARMACIST | ✅ | ❌ | ❌ | ❌ | Read only |
| THERAPIST | ✅ | ❌ | ❌ | ❌ | Read only |
| LAB_TECHNICIAN | ✅ | ❌ | ❌ | ❌ | Read only |
| FINANCE_BILLING | ✅ | ❌ | ❌ | ❌ | Read only |
| SUPPORT_STAFF | ✅ | ❌ | ❌ | ❌ | Read only |
| COUNSELOR | ✅ | ❌ | ❌ | ❌ | Read only |

---

## Endpoint Access by Role

### Authentication Endpoints (`/auth`)

| Endpoint | Method | SUPER_ADMIN | CLINIC_ADMIN | DOCTOR | PATIENT | Others |
|----------|--------|-------------|--------------|--------|---------|--------|
| `/auth/register` | POST | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/auth/login` | POST | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/auth/logout` | POST | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/auth/refresh` | POST | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/auth/change-password` | POST | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/auth/sessions` | GET | ✅ | ✅ | ✅ | ✅ | ✅ |

**Note**: All authenticated users have access to auth endpoints.

### User Management (`/user`)

| Endpoint | Method | SUPER_ADMIN | CLINIC_ADMIN | DOCTOR | PATIENT | Others |
|----------|--------|-------------|--------------|--------|---------|--------|
| `/user/all` | GET | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/user/profile` | GET | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/user/profile` | PUT | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/user/:id` | GET | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| `/user/:id` | PATCH | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| `/user/:id` | DELETE | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/user/:id/role` | PUT | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/user/role/patient` | GET | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| `/user/role/doctors` | GET | ✅ | ✅ | ✅ | ❌ | ⚠️ |

**Note**: ⚠️ = Ownership-restricted or role-specific access

### Appointments (`/appointments`)

| Endpoint | Method | SUPER_ADMIN | CLINIC_ADMIN | DOCTOR | PATIENT | RECEPTIONIST |
|----------|--------|-------------|--------------|--------|---------|--------------|
| `/appointments` | GET | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| `/appointments` | POST | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/appointments/:id` | GET | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| `/appointments/:id` | PUT | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| `/appointments/:id` | DELETE | ✅ | ✅ | ❌ | ✅ | ❌ |
| `/appointments/my-appointments` | GET | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/appointments/:id/check-in` | POST | ✅ | ✅ | ❌ | ✅ | ✅ |
| `/appointments/:id/start` | POST | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/appointments/:id/complete` | POST | ✅ | ✅ | ✅ | ❌ | ❌ |
| `/appointments/analytics/*` | GET | ✅ | ✅ | ⚠️ | ❌ | ⚠️ |

**Note**: ⚠️ = Ownership-restricted (own/assigned appointments only)

### EHR (`/ehr`)

| Endpoint | Method | SUPER_ADMIN | CLINIC_ADMIN | DOCTOR | PATIENT | Others |
|----------|--------|-------------|--------------|--------|---------|--------|
| `/ehr/comprehensive/:userId` | GET | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| `/ehr/medical-history` | POST | ✅ | ✅ | ✅ | ❌ | ❌ |
| `/ehr/medical-history/:id` | GET | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| `/ehr/lab-reports` | POST | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| `/ehr/prescriptions` | POST | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| `/ehr/vitals` | POST | ✅ | ✅ | ✅ | ❌ | ⚠️ |

**Note**: ⚠️ = Ownership-restricted (own records only) or role-specific (LAB_TECHNICIAN for lab reports, NURSE for vitals)

### Billing (`/billing`)

| Endpoint | Method | SUPER_ADMIN | CLINIC_ADMIN | DOCTOR | PATIENT | FINANCE |
|----------|--------|-------------|--------------|--------|---------|---------|
| `/billing/subscriptions` | GET | ✅ | ✅ | ❌ | ⚠️ | ✅ |
| `/billing/invoices` | GET | ✅ | ✅ | ❌ | ⚠️ | ✅ |
| `/billing/invoices` | POST | ✅ | ✅ | ❌ | ❌ | ✅ |
| `/billing/payments` | GET | ✅ | ✅ | ❌ | ⚠️ | ✅ |
| `/billing/payments` | POST | ✅ | ✅ | ❌ | ⚠️ | ✅ |
| `/billing/analytics/*` | GET | ✅ | ✅ | ❌ | ❌ | ✅ |

**Note**: ⚠️ = Ownership-restricted (own billing data only)

### Clinics (`/clinics`)

| Endpoint | Method | SUPER_ADMIN | CLINIC_ADMIN | DOCTOR | PATIENT | Others |
|----------|--------|-------------|--------------|--------|---------|--------|
| `/clinics` | POST | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/clinics` | GET | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/clinics/:id` | GET | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| `/clinics/:id` | PUT | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/clinics/:id` | DELETE | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/clinics/my-clinic` | GET | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| `/clinics/:id/doctors` | GET | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| `/clinics/:id/patients` | GET | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| `/clinics/register` | POST | ✅ | ✅ | ❌ | ✅ | ❌ |

---

## Role-Based Workflows

### Patient Workflow

#### 1. Registration & Setup
```
┌─────────────────────────────────────────┐
│ 1. Register Account                     │
│    POST /auth/register                  │
│    - Email, password, basic info         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. Login                                 │
│    POST /auth/login                      │
│    - Get JWT token                      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. Search & Select Clinic                │
│    GET /clinics                          │
│    GET /clinics/:id                      │
│    - View clinic details                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 4. Register with Clinic                 │
│    POST /clinics/register                │
│    - Associate with clinic              │
└─────────────────────────────────────────┘
```

#### 2. Appointment Booking
```
┌─────────────────────────────────────────┐
│ 1. View Available Doctors               │
│    GET /clinics/:id/doctors             │
│    - See doctor profiles                │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. Check Doctor Availability            │
│    GET /appointments/doctor/:id/        │
│       availability                      │
│    - See available time slots           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. Book Appointment                     │
│    POST /appointments                    │
│    - Select date, time, doctor          │
│    - Add reason/notes                   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 4. View My Appointments                 │
│    GET /appointments/my-appointments    │
│    - See upcoming appointments          │
└─────────────────────────────────────────┘
```

#### 3. Appointment Day
```
┌─────────────────────────────────────────┐
│ 1. Check In                             │
│    POST /appointments/:id/check-in      │
│    - Scan QR code or manual check-in    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. Join Video Consultation              │
│    POST /video/consultation/start       │
│    - Get video token                    │
│    - Join video room                    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. During Consultation                  │
│    GET /video/consultation/:id/status   │
│    - Check connection status            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 4. End Consultation                     │
│    POST /video/consultation/end         │
│    - End video session                  │
└─────────────────────────────────────────┘
```

#### 4. Post-Appointment
```
┌─────────────────────────────────────────┐
│ 1. View Medical Records                 │
│    GET /ehr/comprehensive/:userId       │
│    - See consultation notes            │
│    - View prescriptions                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. View Prescriptions                   │
│    GET /ehr/prescriptions               │
│    - See prescribed medications         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. View Invoice                         │
│    GET /billing/invoices                │
│    - See billing details                │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 4. Make Payment                         │
│    POST /billing/payments               │
│    - Pay invoice                        │
└─────────────────────────────────────────┘
```

---

### Doctor Workflow

#### 1. Daily Setup
```
┌─────────────────────────────────────────┐
│ 1. Login                                │
│    POST /auth/login                     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. View My Clinic                       │
│    GET /clinics/my-clinic               │
│    - See clinic details                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. View Today's Schedule                │
│    GET /appointments                     │
│    - See assigned appointments          │
│    - Filter by date/status             │
└─────────────────────────────────────────┘
```

#### 2. Consultation Process
```
┌─────────────────────────────────────────┐
│ 1. View Appointment Details             │
│    GET /appointments/:id                │
│    - Patient info, reason, history      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. View Patient EHR                     │
│    GET /ehr/comprehensive/:userId       │
│    - Medical history                    │
│    - Previous prescriptions            │
│    - Allergies, medications             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. Start Consultation                   │
│    POST /appointments/:id/start          │
│    - Mark consultation as started       │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 4. During Consultation                  │
│    - Review patient                     │
│    - Take notes                         │
│    - Check vitals (if needed)           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 5. Create Medical Record                │
│    POST /ehr/medical-history            │
│    - Add consultation notes             │
│    - Diagnosis, observations            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 6. Create Prescription                  │
│    POST /ehr/prescriptions              │
│    - Prescribe medications              │
│    - Add dosage, instructions           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 7. Complete Appointment                 │
│    POST /appointments/:id/complete       │
│    - Mark as completed                  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 8. Create Follow-up (if needed)         │
│    POST /appointments/:id/follow-up     │
│    - Schedule next visit                │
└─────────────────────────────────────────┘
```

---

### Receptionist Workflow

#### 1. Patient Registration
```
┌─────────────────────────────────────────┐
│ 1. Register New Patient                │
│    POST /clinics/register               │
│    OR                                  │
│    POST /user (if user exists)         │
│    - Collect patient information       │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. Associate with Clinic               │
│    POST /clinics/associate-user         │
│    - Link patient to clinic            │
└─────────────────────────────────────────┘
```

#### 2. Appointment Management
```
┌─────────────────────────────────────────┐
│ 1. View All Appointments               │
│    GET /appointments                    │
│    - See clinic's appointments         │
│    - Filter by date, doctor, status   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. Create Appointment                  │
│    POST /appointments                   │
│    - Select patient, doctor, time       │
│    - Add appointment details            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. Update Appointment                   │
│    PUT /appointments/:id                │
│    - Reschedule, change details        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 4. Manage Check-ins                    │
│    POST /appointments/:id/force-check-in│
│    - Force check-in if needed          │
└─────────────────────────────────────────┘
```

---

### Clinic Admin Workflow

#### 1. Clinic Management
```
┌─────────────────────────────────────────┐
│ 1. View Clinic Details                 │
│    GET /clinics/my-clinic               │
│    - See clinic information             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. Update Clinic                       │
│    PUT /clinics/:id                     │
│    - Update name, address, settings     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. View Clinic Staff                   │
│    GET /user/role/doctors               │
│    GET /user/role/receptionists         │
│    - See all staff members              │
└─────────────────────────────────────────┘
```

#### 2. Analytics & Reports
```
┌─────────────────────────────────────────┐
│ 1. View Appointment Analytics          │
│    GET /appointments/analytics/*       │
│    - Wait times, completion rates      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. View Revenue Analytics               │
│    GET /billing/analytics/revenue       │
│    - Revenue trends, payments          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. View Health Analytics                │
│    GET /ehr/analytics/*                │
│    - Patient health trends              │
└─────────────────────────────────────────┘
```

---

### Other Role Workflows

#### Nurse Workflow
1. View appointments → View patient info → Record vitals → View medical records → Process check-in

#### Pharmacist Workflow
1. View prescriptions → View patient info → Check medication history → Process prescription → Manage inventory

#### Lab Technician Workflow
1. View lab orders → View patient info → Perform lab test → Create lab report → Update lab report

#### Finance/Billing Workflow
1. View invoices → Create invoice → Send invoice → Process payment → View revenue analytics

---

## Security & Best Practices

### Ownership Validation

Many endpoints enforce **ownership validation**:
- Patients can only access their own data
- Doctors can only access their assigned appointments
- Clinic admins can only access their clinic's data

### Multi-Tenant Isolation

All data is **clinic-scoped**:
- Users belong to specific clinics
- Appointments are clinic-specific
- Medical records are clinic-specific
- Billing is clinic-specific

### Permission Enforcement

Permissions are enforced at **multiple layers**:
1. **Route Level**: `@Roles()` decorator
2. **Permission Level**: `@RequireResourcePermission()` decorator
3. **Service Level**: Business logic validation
4. **Database Level**: Query filtering by clinic/ownership

### Common Restrictions

| Action | Who Can't Do It |
|--------|----------------|
| Delete Clinic | Everyone except SUPER_ADMIN |
| Delete Appointment | DOCTOR, RECEPTIONIST (can only cancel) |
| Create Prescription | Everyone except DOCTOR, SUPER_ADMIN, CLINIC_ADMIN |
| Create Medical Records | PATIENT, RECEPTIONIST, NURSE, etc. |
| View Other Patients' Data | PATIENT (own only), most staff (clinic-scoped) |
| Access Analytics | PATIENT, most staff (clinic admins only) |
| Manage Clinic Settings | Everyone except SUPER_ADMIN, CLINIC_ADMIN |

### Best Practices

- ✅ Always check permissions before operations
- ✅ Validate clinic context for multi-tenant operations
- ✅ Use appropriate endpoints for each role
- ✅ Handle errors and edge cases
- ✅ Log important actions for audit trails
- ✅ Enforce ownership validation at service level
- ✅ Use clinic-scoped queries in database layer

---

## 10. API Endpoints Verification

This section verifies that all API endpoints have proper role-based access control and location support.

### Appointments Controller

| Endpoint | Method | Allowed Roles | RBAC Permission | Location Support | Status |
|----------|--------|---------------|-----------------|------------------|--------|
| `/appointments` | POST | PATIENT, RECEPTIONIST, DOCTOR | `appointments:create` | ✅ locationId in body | ✅ |
| `/appointments/my-appointments` | GET | PATIENT | `appointments:read` | ✅ Filters by user location | ✅ |
| `/appointments` | GET | CLINIC_ADMIN, DOCTOR, RECEPTIONIST, THERAPIST, COUNSELOR, SUPPORT_STAFF | `appointments:read` | ✅ locationId in query | ✅ |
| `/appointments/:id` | GET | PATIENT, RECEPTIONIST, DOCTOR, CLINIC_ADMIN, THERAPIST, COUNSELOR, SUPPORT_STAFF | `appointments:read` | ✅ Returns locationId | ✅ |
| `/appointments/:id` | PUT | PATIENT, RECEPTIONIST, DOCTOR, CLINIC_ADMIN | `appointments:update` | ✅ locationId in body | ✅ |
| `/appointments/:id` | DELETE | PATIENT, RECEPTIONIST, CLINIC_ADMIN | `appointments:delete` | ✅ Validates location | ✅ |
| `/appointments/:id/check-in` | POST | PATIENT, RECEPTIONIST, DOCTOR, CLINIC_ADMIN, NURSE, THERAPIST, COUNSELOR, SUPPORT_STAFF | `appointments:update` | ✅ Validates location matches | ✅ |

**File**: `src/services/appointments/appointments.controller.ts`

### Users Controller

| Endpoint | Method | Allowed Roles | RBAC Permission | Location Support | Status |
|----------|--------|---------------|-----------------|------------------|--------|
| `/users` | GET | CLINIC_ADMIN, SUPER_ADMIN | `users:read` | ✅ Filters by locationId | ✅ |
| `/users` | POST | CLINIC_ADMIN, SUPER_ADMIN | `users:create` | ✅ locationId in body | ✅ |
| `/users/:id` | GET | CLINIC_ADMIN, SUPER_ADMIN, PATIENT (own) | `users:read` | ✅ Returns locationId | ✅ |
| `/users/:id` | PUT | CLINIC_ADMIN, SUPER_ADMIN, PATIENT (own) | `users:update` | ✅ locationId in body | ✅ |
| `/users/:id/change-location` | POST | CLINIC_ADMIN, SUPER_ADMIN | `users:change-location` | ✅ Changes user location | ✅ |

**File**: `src/services/users/controllers/users.controller.ts`

### Guards and Middleware Verification

#### ClinicGuard
- ✅ Extracts `clinicId` from headers, query, JWT, route params, body
- ✅ Extracts `locationId` from headers, query, JWT, route params, body (optional)
- ✅ Validates clinic access
- ✅ Sets `request.clinicId` and `request.locationId` for downstream use

**File**: `src/libs/core/guards/clinic.guard.ts`

#### JwtAuthGuard
- ✅ Validates JWT tokens
- ✅ Extracts user info including `clinicId`
- ✅ Sets `request.user` with user context

**File**: `src/libs/core/guards/jwt-auth.guard.ts`

#### RbacGuard
- ✅ Validates RBAC permissions
- ✅ Works with `@RequireResourcePermission()` decorator
- ✅ Extracts `clinicId` from request

**File**: `src/libs/core/rbac/rbac.guard.ts`

### Location Support in APIs

#### Headers
- ✅ `X-Clinic-ID` - Extracted by ClinicGuard (COMPULSORY)
- ✅ `X-Location-ID` - Extracted by ClinicGuard (OPTIONAL)

#### Query Parameters
- ✅ `clinicId` - Extracted by ClinicGuard (COMPULSORY)
- ✅ `locationId` - Extracted by ClinicGuard (OPTIONAL)

#### Request Body
- ✅ `clinicId` - Extracted by ClinicGuard (COMPULSORY)
- ✅ `locationId` - Extracted by ClinicGuard (OPTIONAL)

#### JWT Token
- ✅ `clinicId` - Extracted from JWT payload
- ✅ `locationId` - Can be extracted from JWT payload (if added)

### Verification Checklist

#### Role Permissions
- [x] All 12 roles have permissions defined
- [x] SUPER_ADMIN has `*` (all permissions)
- [x] Each role has appropriate permissions for their function
- [x] PATIENT has permissions for own data access
- [x] Staff roles have permissions for clinic operations

#### API Endpoints
- [x] All endpoints have `@Roles()` decorator
- [x] All endpoints have `@RequireResourcePermission()` decorator
- [x] All endpoints use `@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)`
- [x] Location-based endpoints support `locationId`
- [x] Check-in endpoints validate location matches appointment

#### Guards
- [x] ClinicGuard extracts `clinicId` (COMPULSORY)
- [x] ClinicGuard extracts `locationId` (OPTIONAL)
- [x] JwtAuthGuard validates tokens
- [x] RolesGuard validates roles
- [x] RbacGuard validates permissions

#### Location Support
- [x] `locationId` extracted from headers (`X-Location-ID`)
- [x] `locationId` extracted from query parameters
- [x] `locationId` extracted from request body
- [x] `locationId` can be extracted from JWT token
- [x] Location validation in check-in flow
- [x] Location filtering in queries

**Status**: ✅ Complete - All roles and APIs verified

---

## Additional Resources

- [RBAC Implementation Details](./features/RBAC_COMPLETE_IMPLEMENTATION.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Security Guidelines](../.ai-rules/security.md)
- [System Architecture](./architecture/SYSTEM_ARCHITECTURE.md)

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Maintained By**: Healthcare Backend Team

