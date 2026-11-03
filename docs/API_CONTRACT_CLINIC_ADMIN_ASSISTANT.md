# TestByDoctor backend API contract (clinic admin / assistant doctor / round 3)

Backend contract v1 (final). Status: NEW = added in this work, EXISTS = already
in the backend, CHANGED = existing route whose roles/behaviour changed. All
routes require a JWT and the clinic context (same headers as the existing API);
responses are plain JSON (no envelope) unless a route is documented as an
existing ServiceResponse route.

Global rules

- Base URL / auth unchanged: `Authorization: Bearer <jwt>`, clinic via the
  existing clinic header/guard. Role strings: `CLINIC_ADMIN`,
  `ASSISTANT_DOCTOR`, `DOCTOR`, `RECEPTIONIST`, `PHARMACIST`, `PATIENT`
  (UPPER_SNAKE everywhere; web `permissions.ts` `clinic_admin` is a client-side
  permission key, not the wire role).
- Billing blindness (server side): a global `BillingRedactionInterceptor` strips
  every billing/price key (amount, price, unitPrice, totalAmount, tax, discount,
  fee, revenue, earnings, mrp, ...) from ALL responses to DOCTOR and
  ASSISTANT_DOCTOR. Billing endpoints are also closed to those roles by
  `@Roles`. Do not rely on the UI hiding amounts; the fields are simply absent.
- Only DOCTOR may call a patient (`POST /queue/call-next`), start
  (`PATCH /queue/:patientId/status` -> IN_PROGRESS) and complete
  (`POST /appointments/:id/complete`, `complete/bulk`) a visit. Reception,
  assistant, clinic admin get 403
  (`Only the doctor can call a patient, start a consultation or complete a visit.`).
- ASSISTANT_DOCTOR may: create DRAFT prescriptions (via
  `POST /pharmacy/prescriptions`, stored as `DRAFT`), resubmit returned drafts,
  dispense from clinic stock, view stock, set queue priority, read queue. Never:
  billing, call/start/complete, approve Rx.
- CLINIC_ADMIN owns billing, staff, locations, QR, holidays, leave approval,
  reports, purchase orders.
- Errors: standard Nest `{statusCode, message, error}`; 403 for role, 400
  validation, 404 not found, 409 state conflicts.
- Dates: ISO strings. Day ranges use `YYYY-MM-DD` (clinic timezone
  Asia/Kolkata).

## 1. Notifications (EXISTS, all roles incl. CLINIC_ADMIN, RECEPTIONIST, PHARMACIST, DOCTOR, ASSISTANT_DOCTOR, PATIENT)

- GET `/communication/history/:userId?page&limit&unread` list; GET
  `/communication/history/:userId/unread-count`; PATCH
  `/communication/history/:id/read`; PATCH
  `/communication/history/mark-all-read`; DELETE `/communication/:id`.
- POST `/devices/me/token`, DELETE `/devices/me/token` (push token).
  Preferences: GET/PUT `/notification-preferences/me`.

## 2. Leave & holidays (NEW) `leave-requests`, `clinic-holidays`

| Method | Path                        | Roles                     | Body / query                                                                                                         | Response                                                                                                                                                          |
| ------ | --------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /leave-requests             | any staff                 | `{kind?: LEAVE\|HALF_DAY\|BREAK, startDate, endDate, startTime?, endTime?, reason?, coverUserId?, locationId?}`      | LeaveRequest                                                                                                                                                      |
| GET    | /leave-requests/mine        | any staff                 | -                                                                                                                    | LeaveRequest[]                                                                                                                                                    |
| GET    | /leave-requests             | CLINIC_ADMIN              | `status, from, to, userId`                                                                                           | LeaveRequest[]                                                                                                                                                    |
| GET    | /leave-requests/:id/impact  | CLINIC_ADMIN              | -                                                                                                                    | `{leaveRequestId, impactedAppointmentCount, appointments:[{appointmentId,date,time,type,status,patientName}]}` (the "N booked patients will be notified" preview) |
| POST   | /leave-requests/:id/approve | CLINIC_ADMIN              | `{note?, notifyPatients?=true}`                                                                                      | LeaveRequest (doctor leave blocks the calendar and notifies patients)                                                                                             |
| POST   | /leave-requests/:id/decline | CLINIC_ADMIN              | `{note?}`                                                                                                            | LeaveRequest                                                                                                                                                      |
| POST   | /leave-requests/:id/cancel  | requester or CLINIC_ADMIN | -                                                                                                                    | LeaveRequest                                                                                                                                                      |
| GET    | /clinic-holidays            | all staff + PATIENT       | `from,to,locationId`                                                                                                 | ClinicHoliday[]                                                                                                                                                   |
| POST   | /clinic-holidays            | CLINIC_ADMIN              | `{title, kind?: HOLIDAY\|CLOSURE\|DOCTOR_LEAVE, startDate, endDate, locationId?, notifyPatients?, messageTemplate?}` | ClinicHoliday                                                                                                                                                     |
| PATCH  | /clinic-holidays/:id        | CLINIC_ADMIN              | partial of above                                                                                                     | ClinicHoliday                                                                                                                                                     |
| DELETE | /clinic-holidays/:id        | CLINIC_ADMIN              | -                                                                                                                    | `{id, deleted:true}`                                                                                                                                              |

LeaveRequest =
`{id,userId,requesterName,requesterRole,locationId,kind,startDate,endDate,startTime,endTime,reason,status: PENDING|APPROVED|DECLINED|CANCELLED,coverUserId,coverName,decidedById,decidedAt,decisionNote,impactedAppointmentCount,patientsNotifiedAt,createdAt}`.
ClinicHoliday =
`{id,title,kind,locationId,startDate,endDate,notifyPatients,notifiedCount,messageTemplate,createdAt}`.

## 3. Check-in / QR scan log, failed check-ins (NEW) `check-in-log` - CLINIC_ADMIN, RECEPTIONIST, CLINIC_LOCATION_HEAD

- GET
  `/check-in-log?date|from&to&locationId&outcome=SUCCESS|FAILED&method=QR|MANUAL|WALK_IN`
  -> CheckInAttempt[]
- GET `/check-in-log/failed?date` (default today, unresolved first) ->
  CheckInAttempt[]
- GET `/check-in-log/summary?date` ->
  `{date,total,succeeded,failed,unresolvedFailures,byMethod,byFailureReason}`
- POST `/check-in-log/:id/resolve`
  `{resolution: MANUAL_CHECK_IN|CALLED|IGNORED, note?}` -> CheckInAttempt
- CheckInAttempt =
  `{id,at,locationId,appointmentId,patientId,patientName,method,outcome,failureReason,failureDetail,tokenLabel,resolution,resolvedAt,resolutionNote,needsAttention}`;
  failureReason in EXPIRED_QR | INVALID_QR | WRONG_LOCATION | NOT_BOOKED |
  TOO_EARLY | TOO_LATE | ALREADY_CHECKED_IN | LOCATION_INACTIVE | OTHER (a
  replaced poster QR is reported as EXPIRED_QR with failureDetail "QR was
  replaced...").
- Every `POST /appointments/check-in/scan-qr` outcome (success and failure) is
  now written to this log. Patient check-in window: 20 min before .. 45 min
  after the slot start (see 19.1 / 19.9; reception one-click check-in is not
  bound to it). Since 19.10 scan-qr delegates to `POST /in-person/check-in`, so
  its rows are written by that service (method `QR`). EXISTS (unchanged):
  `GET /appointments/check-in/history`.

## 4. Queue priority / no-show (priority NEW, rest CHANGED)

- POST `/queue-ops/appointments/:appointmentId/priority`
  `{priority: NORMAL|SENIOR|PREGNANT|EMERGENCY, reason?}` - RECEPTIONIST,
  CLINIC_ADMIN, CLINIC_LOCATION_HEAD, DOCTOR, ASSISTANT_DOCTOR, NURSE ->
  `{appointmentId,priority,reason,appliedToLiveQueue}` (audited; reorders the
  live queue).
- POST `/appointments/:id/mark-no-show` (EXISTS: DOCTOR, ASSISTANT_DOCTOR,
  RECEPTIONIST, CLINIC_ADMIN, CLINIC_LOCATION_HEAD, NURSE). Undo =
  `POST /in-person/appointments/:id/undo-no-show` (or
  `PATCH /appointments/:id/status` to CONFIRMED / SCHEDULED), see 18.7 - UI
  shows the undo toast.
- POST `/queue/call-next` `{doctorId, appointmentId}` - DOCTOR ONLY (CHANGED;
  reception removed).
- PATCH `/queue/:patientId/status` - IN_PROGRESS / COMPLETED require DOCTOR
  (CHANGED); others unchanged. ASSISTANT_DOCTOR added to queue
  add/reorder/position (read + reorder only).
- POST `/appointments/:id/complete`, `/appointments/complete/bulk` - DOCTOR
  (+THERAPIST/COUNSELOR) only; RECEPTIONIST/ASSISTANT_DOCTOR/NURSE removed
  (CHANGED). Video `join/start` routes: ASSISTANT_DOCTOR and RECEPTIONIST/NURSE
  removed.

## 5. Prescriptions: quick Rx, drafts, returned drafts

Create/edit (EXISTS, CHANGED): `POST /pharmacy/prescriptions`,
`PATCH /pharmacy/prescriptions/:id` - DOCTOR, ASSISTANT_DOCTOR. When the caller
is ASSISTANT_DOCTOR the prescription is stored with `status: DRAFT` (never
visible to pharmacy, never dispensable) and the assistant can only edit their
own DRAFT/RETURNED ones. Doctor-created prescriptions behave as before
(PENDING). Prices/amounts never appear for either role. New draft workflow
`rx-drafts` (NEW):

| Method                                                                                                                                                                                                                                                                                                  | Path                                   | Roles                                                         | Notes                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET                                                                                                                                                                                                                                                                                                     | /rx-drafts?status=DRAFT\|RETURNED\|... | DOCTOR (awaiting approval), ASSISTANT_DOCTOR (own + returned) | RxDraft[]                                                        |
| GET                                                                                                                                                                                                                                                                                                     | /rx-drafts/:id                         | DOCTOR, ASSISTANT_DOCTOR                                      | RxDraft                                                          |
| POST                                                                                                                                                                                                                                                                                                    | /rx-drafts/:id/approve                 | DOCTOR                                                        | draft becomes a normal PENDING prescription, visible to pharmacy |
| POST                                                                                                                                                                                                                                                                                                    | /rx-drafts/:id/return `{note}`         | DOCTOR                                                        | status RETURNED, assistant is notified                           |
| POST                                                                                                                                                                                                                                                                                                    | /rx-drafts/:id/resubmit                | ASSISTANT_DOCTOR (own)                                        | RETURNED -> DRAFT, doctor notified                               |
| POST                                                                                                                                                                                                                                                                                                    | /rx-drafts/:id/discard                 | ASSISTANT_DOCTOR (own) / DOCTOR                               | `{id,status}`                                                    |
| RxDraft = `{id,prescriptionNumber,status,patientId,patientName,diagnosis,notes,draftedByUserId,draftedByName,submittedAt,returnedAt,returnNote,approvedAt,items:[{id,medicineId,medicineName,dosage,frequency,duration,quantity,instructions}],returnedSnapshot}`. Quick Rx favourites: see section 14. |

## 6. Direct dispensing, undo/reverse, stock view (NEW) `direct-dispense`

- GET `/direct-dispense/stock?q&status=IN_STOCK|LOW|OUT&limit` - DOCTOR,
  ASSISTANT_DOCTOR, PHARMACIST, CLINIC_ADMIN, NURSE ->
  `{items:[{medicineId,name,category,unit,manufacturer,quantityOnHand,minStockThreshold,status,nearestExpiry,expiringSoon,price?}], total}`
  (`price` only for CLINIC_ADMIN/PHARMACIST/SUPER_ADMIN).
- POST `/direct-dispense`
  `{patientId? | walkInName?+walkInPhone?, prescriptionId?, locationId?, note?, items:[{medicineId, quantity}]}`
  -> DirectDispense (FEFO batch allocation, stock decremented, audited).
- GET `/direct-dispense?status&patientId&mine=true&limit` (clinical roles only
  see their own), GET `/direct-dispense/:id`.
- POST `/direct-dispense/:id/undo` (dispenser, inside the undo window (10 min);
  `canUndo`/`undoUntil` in the response) -> DirectDispense
- POST `/direct-dispense/:id/reverse` `{reason}` - CLINIC_ADMIN, PHARMACIST (any
  time; stock returned)
- POST `/direct-dispense/:id/settle` `{method: CASH|UPI|CARD|WAIVED}` -
  CLINIC_ADMIN, PHARMACIST, FINANCE_BILLING (records only, no payment
  processing)
- DirectDispense =
  `{id,status: DISPENSED|REVERSED (undo also ends as REVERSED),patientId,patientName,prescriptionId,note,dispensedByUserId,dispensedByRole,dispensedByName,createdAt,undoUntil,canUndo,reversedAt,reverseReason,items:[{medicineId,medicineName,quantity,batches:[{lotNumber,quantity,expiryDate}],unitPrice?,lineAmount?}],totalAmount?,settledAt?,settledMethod?}`
  (`unitPrice/lineAmount/totalAmount/settled*` only for billing roles).
- EXISTS (pharmacist): `POST /pharmacy/prescriptions/:id/dispense`,
  `POST /pharmacy/prescriptions/:id/reverse-dispense`.

## 7. Invoices, new invoice, reminders, refund, receipt (CLINIC_ADMIN owns; RECEPTIONIST collects at the desk)

EXISTS: GET `/billing/invoices/clinic`, GET `/billing/invoices/:id`, POST
`/billing/invoices`, PUT `/billing/invoices/:id`, POST
`/billing/invoices/:id/mark-paid`, POST `/billing/invoices/:id/record-payment`,
POST `/billing/invoices/:id/send-whatsapp`, POST
`/billing/invoices/:id/generate-pdf`, GET `/billing/invoices/:id/pdf-download`,
GET `/billing/payments/clinic`, GET `/billing/payments/ledger`, POST
`/billing/payments/:id/refund` (CLINIC_ADMIN, FINANCE_BILLING, SUPER_ADMIN),
POST `/billing/visits/:visitId/consultation-invoice` (reception collects after
the doctor completes), `/billing/dashboard/financial-stats`,
`/billing/expenses`. CHANGED: DOCTOR and ASSISTANT_DOCTOR removed from all
`/billing/*` routes and from billing RBAC permissions. NEW `billing-ops`
(CLINIC_ADMIN, FINANCE_BILLING, SUPER_ADMIN; RECEPTIONIST where noted):

- GET `/billing-ops/summary?from&to` ->
  `{from,to,billed:{amount,count},collected:{...},outstanding:{...},overdue:{...}}`
  (default this month)
- GET `/billing-ops/invoices/overdue?limit` (+RECEPTIONIST) ->
  `[{invoiceId,invoiceNumber,patientName,patientPhone,amount,dueDate,daysOverdue,billType,remindersSent,lastReminderAt}]`
- GET `/billing-ops/invoices/:id/reminders` (+RECEPTIONIST) ->
  `[{id,invoiceId,channel,language,message,status,scheduledFor,sentAt,createdAt}]`
- POST `/billing-ops/invoices/:id/reminders` (+RECEPTIONIST)
  `{channel?: WHATSAPP|SMS, language?: en|mr|hi, message?, scheduledFor?}` ->
  reminder
- GET `/billing-ops/invoices/:id/receipt` (+RECEPTIONIST) ->
  `{receiptNumber,invoiceId,status,issuedAt,clinic:{name,address,phone},patientName,billType,description,lineItems,subtotal,tax,discount,total,payments:[{method,amount,paidAt}]}`

## 8. Purchase orders & inventory (EXISTS; CLINIC_ADMIN + PHARMACIST)

`POST/GET /pharmacy/inventory/purchase-orders`,
`GET /pharmacy/inventory/purchase-orders/:id`, `POST .../:id/send`,
`POST .../:id/receive`; reorder rules `POST /pharmacy/inventory/reorder-rules`,
`GET /pharmacy/inventory/reorder-evaluation`; alerts
`GET /pharmacy/inventory/alerts`; transfers `/pharmacy/inventory/transfers`;
batches `/pharmacy/inventory/batches`; `GET /pharmacy/suppliers`,
`POST /pharmacy/suppliers`.

## 9. Staff invite / detail / leave approval (NEW) `staff-admin` - CLINIC_ADMIN, SUPER_ADMIN

- POST `/staff-admin/invites`
  `{role: RECEPTIONIST|PHARMACIST|NURSE|ASSISTANT_DOCTOR|THERAPIST|CLINIC_ADMIN, name?, phone?, email?, locationIds?}`
  -> StaffInvite (+ one-time `inviteToken`, `inviteLinkPath` on create/resend
  only)
- GET `/staff-admin/invites?status` ; POST `/staff-admin/invites/:id/resend` ;
  POST `/staff-admin/invites/:id/revoke`
- GET `/staff-admin/members?role&q` ->
  `[{userId,name,role,phone,email,isActive,lastLogin,onLeaveToday}]`
- GET `/staff-admin/members/:userId` -> member +
  `{joinedAt,pendingLeaveRequests,upcomingLeave:[{id,kind,startDate,endDate,status}]}`
- StaffInvite =
  `{id,role,name,phone,email,locationIds,status: PENDING|ACCEPTED|REVOKED|EXPIRED,expiresAt,lastSentAt,resendCount,createdAt}`
- Leave approval: section 2. EXISTS: `POST/GET /staff`, `GET /staff/:id`,
  `GET /clinics/:id/staff`, `PUT /appointments/assistant-coverage` (CLINIC_ADMIN
  assigns the assistant to the doctor).

## 10. Locations, hours, QR (EXISTS + NEW)

- EXISTS: `/clinics/:clinicId/locations` POST/GET, `/:id` GET/PUT/PATCH/DELETE,
  `PUT /:id/working-hours` (CLINIC_ADMIN, CLINIC_LOCATION_HEAD; RECEPTIONIST
  allowed for hours today), `GET /appointments/check-in/locations`,
  `GET /appointments/locations/:locationId/qr-code`.
- NEW `POST /appointments/locations/:locationId/qr-code/regenerate`
  `{reason?}` - CLINIC_ADMIN, CLINIC_LOCATION_HEAD ->
  `{locationId,locationName,qrVersion,qrCode(dataURL png),qrCodeString,rotatedAt}`.
  The old printed poster then fails scans with failureReason `EXPIRED_QR`
  (detail: QR replaced, scan the new poster).

## 11. Reports (EXISTS; CLINIC_ADMIN)

`GET /analytics/dashboard`, `/analytics/appointments`, `/analytics/patients`,
`/analytics/revenue` (CLINIC_ADMIN, FINANCE_BILLING),
`/analytics/clinics/performance`, `/analytics/earnings/split`,
`/analytics/services/utilization`, `/analytics/wait-times`,
`/analytics/satisfaction`, `/analytics/queue`,
`/appointments/analytics/check-in-patterns`,
`/appointments/analytics/no-show-correlation`, `/billing/analytics/revenue`,
`/billing/dashboard/financial-stats`. CHANGED:
`GET /analytics/doctor/me/earnings` is closed to DOCTOR (billing amounts) unless
the owner sets the `DOCTOR_SELF_EARNINGS_VISIBLE` switch (default off ->
SUPER_ADMIN only). `/analytics/revenue`, `/billing/analytics/*` are not
reachable by DOCTOR/ASSISTANT_DOCTOR.

## 12. Pharmacy counter hand-over, expiry batch actions (NEW) `pharmacy-ops`

Hand-over = verified physical hand-over on top of the existing dispense
(`POST /pharmacy/prescriptions/:id/dispense`, `.../reverse-dispense` stay the
stock movement).

| Method                                                                                                                                                         | Path                                            | Roles                                                                                                                                                                                              | Body                                                                                              | Response                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST                                                                                                                                                           | /pharmacy-ops/prescriptions/:id/handover/code   | PATIENT (own Rx)                                                                                                                                                                                   | -                                                                                                 | `{handoverId, code:"123456", qrPayload:"TBD-HO:<handoverId>:<code>", expiresAt}` (render qrPayload as QR; code valid 15 min; calling again renews) |
| GET                                                                                                                                                            | /pharmacy-ops/prescriptions/:id/handover        | PHARMACIST, CLINIC_ADMIN                                                                                                                                                                           | -                                                                                                 | Handover or `null`                                                                                                                                 |
| POST                                                                                                                                                           | /pharmacy-ops/prescriptions/:id/handover/verify | PHARMACIST, CLINIC_ADMIN                                                                                                                                                                           | `{code, method?: QR\|OTP}` (code = 6 digits or the scanned qrPayload text; 5 wrong tries lock it) | Handover (verified:true, items)                                                                                                                    |
| POST                                                                                                                                                           | /pharmacy-ops/handovers/:id/confirm             | PHARMACIST, CLINIC_ADMIN                                                                                                                                                                           | `{itemChecklist:[{prescriptionItemId, handedOver}], acknowledgedBy, signature?}`                  | Handover (status HANDED_OVER, undoUntil = +5 min)                                                                                                  |
| POST                                                                                                                                                           | /pharmacy-ops/handovers/:id/undo                | the pharmacist who handed over, or CLINIC_ADMIN                                                                                                                                                    | -                                                                                                 | Handover (status UNDONE); if stock must also go back call reverse-dispense                                                                         |
| Handover = `{id,prescriptionId,status: PENDING_VERIFICATION                                                                                                    | HANDED_OVER                                     | UNDONE,method,verified,verifiedAt,patientName,items:[{prescriptionItemId,medicineName,dosage,frequency,duration,quantity}],itemChecklist,acknowledgedBy,handedOverAt,undoUntil,canUndo,undoneAt}`. |
| Expiry screen (PhExpiry): list = EXISTS `GET /pharmacy/inventory/expiring-soon`, `GET /pharmacy/inventory/alerts`, `GET /pharmacy/audit/batches`; actions NEW: |

- GET `/pharmacy-ops/batches/:id/audit` ->
  `[{id,at,movementType,quantity,reason,referenceType,recordedById,recordedByName}]`
- POST `/pharmacy-ops/batches/:id/return-to-supplier`
  `{quantity, reason, supplierId?}` and POST `/pharmacy-ops/batches/:id/discard`
  `{quantity, reason}` (PHARMACIST, CLINIC_ADMIN) ->
  `{batchId,action,quantity,remainingQuantity,reason,movementId,at}`. Movement
  types RETURN_TO_SUPPLIER / DISCARD_WRITE_OFF.
- EXISTS: `POST /pharmacy/inventory/expired-writeoff` (CLINIC_ADMIN).

## 13. Patient round-3 (NEW)

Lab booking `lab-bookings`:

- GET `/lab-bookings/packages` (PATIENT, RECEPTIONIST, CLINIC_ADMIN) ->
  `{packages:[{code,name,tests[]}], slotWindows:["07:00-09:00","09:00-11:00","11:00-13:00","16:00-18:00"]}`
  (no prices).
- POST `/lab-bookings` (PATIENT)
  `{packageCode, packageName, tests?, addressLine, city?, zipCode?, slotDate:"YYYY-MM-DD", slotWindow, notes?}`
  -> LabBooking
- GET `/lab-bookings/mine` (PATIENT); POST `/lab-bookings/:id/cancel` (PATIENT,
  only REQUESTED/CONFIRMED)
- GET `/lab-bookings?status` and PATCH `/lab-bookings/:id/status`
  `{status: CONFIRMED|SAMPLE_COLLECTED|COMPLETED|CANCELLED}` (RECEPTIONIST,
  CLINIC_ADMIN, LAB_TECHNICIAN)
- LabBooking =
  `{id,packageCode,packageName,tests[],addressLine,city,zipCode,slotDate,slotWindow,status: REQUESTED|CONFIRMED|SAMPLE_COLLECTED|COMPLETED|CANCELLED,notes,patientName?(staff list),createdAt}`
  Help chat `support`:
- GET `/support/thread` (PATIENT) ->
  `{id,status,subject,lastMessageAt,messages:[{id,senderType: PATIENT|ASSISTANT|STAFF,body,quickReply,at}]}`
- POST `/support/messages` (PATIENT)
  `{body, quickReply?: RESCHEDULE|CHECK_IN_HELP|REPORTS|BILLING|PRESCRIPTION|TALK_TO_STAFF}`
  -> thread (a Care-assistant bubble reply is appended automatically)
- GET `/support/threads` and POST `/support/threads/:id/reply` `{body}`
  (RECEPTIONIST, CLINIC_ADMIN) Doctor investigations: POST `/investigations`
  (DOCTOR)
  `{patientId, appointmentId?, visitId?, tests:[{name,kind?: LAB|IMAGING}], urgency?: ROUTINE|URGENT|STAT, labDestination?, notes?}`;
  GET `/investigations?patientId&status` (DOCTOR, ASSISTANT_DOCTOR,
  LAB_TECHNICIAN, CLINIC_ADMIN; PATIENT sees own); PATCH
  `/investigations/:id/status`
  `{status: SAMPLE_COLLECTED|RESULT_READY|CANCELLED}` (DOCTOR, LAB_TECHNICIAN,
  CLINIC_ADMIN). Investigation =
  `{id,patientId,patientName,appointmentId,visitId,tests,urgency,labDestination,notes,status: ORDERED|SAMPLE_COLLECTED|RESULT_READY|CANCELLED,orderedAt}`.
  Family member: `allergies` (string, max 500) added to create/update/response
  of `/family-members` (EXISTS route, CHANGED DTO). Reschedule / cancel video
  visit, notifications, uploads: EXISTS (`PATCH /appointments/:id/reschedule`,
  `DELETE /appointments/:id`, `/communication/history/*`, `/patient-documents`).

## 14. Doctor favourites per account (NEW) - DOCTOR, ASSISTANT_DOCTOR

- GET
  `/doctor-favourites?kind=MEDICINE|RX_TEMPLATE|DIAGNOSIS|INVESTIGATION|PATIENT|OTHER`
  -> `[{id,kind,itemKey,label,payload,sortOrder}]` (the caller's own only)
- PUT `/doctor-favourites` `{kind,itemKey,label,payload?,sortOrder?}` ->
  favourite (idempotent on kind+itemKey)
- PUT `/doctor-favourites/bulk` `{items:[...]}` one-off import of the old
  localStorage list, returns the full list
- DELETE `/doctor-favourites/:id` -> `{id,deleted:true}`

## 15. Audit trail (NEW) - CLINIC_ADMIN

GET `/clinic-audit?entityType&entityId&from&to&limit` ->
`[{id,at,entityType,entityId,action,actorUserId,actorName,actorRole,detail}]`
(priority changes, leave decisions, QR rotations, hand-overs, dispenses, batch
actions ...).

## 16. Field-level rule for frontends

For DOCTOR / ASSISTANT_DOCTOR tokens the server removes every JSON key whose
camel/snake tokens include: amount, price, mrp, fee, cost, revenue, earning,
payout, tax, discount, subtotal, surcharge, refund, outstanding, collected,
collection, paise (plus exact keys
lineTotal/grandTotal/totalDue/balanceDue/netPayable). Code defensively: those
keys can be `undefined` for the clinical roles (e.g. stock rows have no
`price`).

## 17. Deployment notes

- Migration (NOT applied):
  `src/libs/infrastructure/database/prisma/migrations/20261020000000_clinic_admin_assistant_round3/migration.sql`
  (idempotent: IF NOT EXISTS everywhere). Adds Prescription draft columns +
  `PrescriptionStatus` DRAFT/RETURNED, CheckInLocation qrVersion/qrRotatedAt,
  family_members.allergies, leave_requests, clinic_holidays, check_in_attempts,
  staff_invites, direct_dispenses(+items), invoice_reminders,
  dispense_handovers, clinic_audit_events, lab_bookings,
  support_threads/messages, investigation_orders, doctor_favourites. Run
  `prisma generate` after pulling the schema.
- Code: `src/services/clinic-ops/**` (module registered in app.module), global
  `BillingRedactionInterceptor` (main.ts),
  `libs/core/rbac/visit-authority.util.ts`.
- Product switch: `DOCTOR_SELF_EARNINGS_VISIBLE` in
  `libs/core/interceptors/billing-redaction.util.ts` (false).
  `GET /analytics/doctor/me/earnings` is therefore SUPER_ADMIN-only; the web
  DOCTOR "Earnings" nav item should be removed.
- Unit tests: `tests/unit/clinic-ops/*` (redaction, check-in log, drafts,
  dispense, hand-over, favourites/investigations, visit authority).

## 18. Phase 3 additions (final)

Product rules: one doctor (auto-assigned, no doctor picker needed), NO vitals in
the queue / visit flow (vitals tables and
`/patient-visits/:id/vitals-examination` stay for old data but nothing requires
or emits them; queue and in-person DTOs carry no vitals field or stage), the
receptionist works at ONE location taken from the server (staff profile
`Receptionist.locationId`; an unassigned receptionist is accepted only in a
single-location clinic, else 403 `RECEPTION_WRONG_LOCATION`), reception sees no
clinical records, only the doctor calls / starts / completes.

| #     | Method | Path                                                                              | Roles                                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | ------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18.1  | GET    | `/user/profile`                                                                   | any                                                                               | CHANGED: staff responses add `locationId` (absent when unassigned) and `locationName` (`null` when unassigned / patient) - the allotted clinic location from the staff profile (DoctorClinic for DOCTOR / ASSISTANT_DOCTOR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 18.2  | GET    | `/staff-admin/members`, `/staff-admin/members/:userId`                            | CLINIC_ADMIN, SUPER_ADMIN                                                         | CHANGED: every member adds `locationId`, `locationName` (`null` when unassigned); one query, no N+1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 18.3  | GET    | `/appointments`                                                                   | RECEPTIONIST                                                                      | CHANGED: `locationId` is forced server-side to the receptionist's location (query / header ignored). `page`, `limit` (max 100) and the existing date / status / type filters unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 18.4  | GET    | `/queue`                                                                          | all queue readers                                                                 | CHANGED: RECEPTIONIST always gets its own location's queue (`meta.locationId`); NEW `page` query with `limit` (default 100, max 500) -> `meta.page`, `meta.limit`, `meta.totalPages` (`meta.total` = all matching)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 18.5  | GET    | `/check-in-log`, `/check-in-log/failed`, `/check-in-log/summary`                  | RECEPTIONIST (+ admin)                                                            | CHANGED: reception is pinned to its location; `date`, `from`, `to` are IST calendar days (were UTC days); same for `GET /clinic-audit?from&to`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 18.6  | POST   | `/in-person/walk-in`                                                              | RECEPTIONIST, CLINIC_ADMIN, CLINIC_LOCATION_HEAD                                  | NEW (CHANGED in 19.4): body `{patientId, locationId?, doctorId?, durationMinutes? (ignored, see 19.2), notes?}`. Books an IN_PERSON visit into the doctor's next free in-person slot of today (through the normal booking service). `doctorId` (Doctor.id or the doctor's User id, optional) picks the doctor in a clinic with more than one doctor; it must practise in the clinic (404 otherwise); omitted -> the clinic's single doctor (400 `doctorId is required: this clinic has more than one doctor` when it has several). The desk lists the clinic's doctors with the existing `GET /clinics/:clinicId/doctors`. The plan link is idempotent: a visit already covered by a subscription (e.g. linked by the booking service) is never cancelled at the receptionist's location (admin / location head: `locationId` or the clinic's only active location) and checks it in through the shared in-person check-in service (same as QR / one-click). Idempotent: an open in-person visit of the patient today at that location is reused (`created:false`). Response: `{result:"CHECKED_IN", alreadyCheckedIn, visit, created}`. New patients are created first with `POST /patients`. The in-person plan rule of check-in still applies: the patient's active monthly in-person plan is linked to the visit first (same rule as patient booking; no per-visit fee); without one the call answers 400 and nothing is booked |
| 18.7  | POST   | `/in-person/appointments/:id/undo-no-show`                                        | RECEPTIONIST, CLINIC_ADMIN, CLINIC_LOCATION_HEAD, DOCTOR, ASSISTANT_DOCTOR, NURSE | NEW: visit day only (400 otherwise). NO_SHOW -> CONFIRMED and back in the location's live queue when the patient had checked in (re-queued by the shared check-in service), else -> SCHEDULED. Response `{result:"RESTORED", alreadyRestored, restoredStatus, visit}`; repeat calls are no-ops, a non-no-show visit is 409. `PATCH /appointments/:id/status` with `CONFIRMED` / `SCHEDULED` on a NO_SHOW visit takes the same path (the undo toast in section 4 now works)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 18.8  | GET    | `/patients`, `/patients/:id`, `/patients/clinic/:clinicId`, `/patient-directory*` | RECEPTIONIST                                                                      | CHANGED: clinical keys removed server-side (medicalHistory/-ies, allergies, diagnosis, medications, prescriptions, vitals, healthRecords, height, weight, bloodGroup, ...). ASSISTANT_DOCTOR patient lists are no longer narrowed to "own" patients (any patient of the clinic)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 18.9  | PUT    | `/clinics/:clinicId/locations/:id/working-hours`                                  | CLINIC_ADMIN, SUPER_ADMIN, CLINIC_LOCATION_HEAD                                   | CHANGED: RECEPTIONIST removed (no web / mobile caller; the clinic admin saves hours with the location)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 18.10 | GET    | `/rx-drafts?status=APPROVED&days=30`                                              | DOCTOR, ASSISTANT_DOCTOR                                                          | CHANGED: drafts approved in the last `days` (default 30, max 90), newest first, max 100; assistant: own only; `status` is the prescription's live status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 18.11 | POST   | `/rx-drafts/:id/resubmit`                                                         | ASSISTANT_DOCTOR                                                                  | CHANGED: optional body `{note?}` (max 500) -> `resubmitNote` on every RxDraft                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 18.12 | POST   | `/appointments`, `/appointments/video/propose`                                    | booking roles                                                                     | CHANGED: `doctorId` optional - the clinic's single DOCTOR is assigned when omitted (400 if the clinic has none, or several). Reassign routes remain, nothing requires them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 18.13 | -      | read access                                                                       | ASSISTANT_DOCTOR                                                                  | CONFIRMED (no change needed): `GET /pharmacy/inventory` (the medicine list; there is no `/pharmacy/medicines` route - prices stripped), `GET /pharmacy/prescriptions/:id`, `GET /patient-directory/:patientId`, `POST /appointments/:id/mark-no-show`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 18.14 | -      | DB                                                                                | -                                                                                 | NEW migration (SQL only, NOT applied): `migrations/20261021000000_phase3_hot_filter_indexes` - `Appointment(clinicId, locationId, date, status)`, `Queue(clinicId, clinicLocationId, status)` (also in schema.prisma). The live queue is per location per day in the cache; `QueueEntry` (therapy) has no location column                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 18.15 | GET    | `/pharmacy/prescriptions`                                                         | PHARMACIST, CLINIC_ADMIN, DOCTOR (own only)                                       | ADDITIVE: without `page` unchanged (legacy array, query ignored). With `page` (int >= 1) -> `{data, total, page, limit}`, same row shape, filtered / sorted in the DB. Query: `limit` 10\|25\|50\|100 (default 25), `q` (max 100; patient name / phone, UHID, OPD number, prescription number, medicine name, diagnosis; case-insensitive contains), `status` ACTIVE (= PENDING + PARTIAL) \| COMPLETED (= FILLED) \| CANCELLED \| DRAFT \| RETURNED (+ PENDING / PARTIAL / FILLED and the M9 aliases; DRAFT / RETURNED only for DOCTOR / admin, else empty), `pharmacyStage` PAYMENT_PENDING (PENDING, payments < medicine total) \| READY_TO_DISPENSE (PENDING fully paid or zero-total, or PARTIAL) \| DISPENSED (FILLED) \| NOT_SENT (DRAFT / RETURNED), `dateFrom` / `dateTo` IST days `YYYY-MM-DD` inclusive, `patientId` (uuid), `sort` newest (default) \| oldest \| patient. Bad values -> 400 VALIDATION_ERROR. Cached per user + query; busted by every create / edit / dispense / payment / draft transition                                                                                                                                                                                                                                                                                                                                                                                                            |
| 18.16 | GET    | `/pharmacy/prescriptions/summary?dateFrom&dateTo`                                 | PHARMACIST, CLINIC_ADMIN, DOCTOR (own only)                                       | NEW: `{total, active, completed, cancelled, drafts, today, uniquePatients}` (groupBy / count, no rows loaded). No dates = all time; `today` is always today (IST); `total` excludes drafts; `drafts` = DRAFT + RETURNED (0 for PHARMACIST). DB: NEW index `Prescription(clinicId, doctorId, date)` in the same `20261021000000_phase3_hot_filter_indexes` migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Unit tests: `tests/unit/clinic-ops/role-guard-matrix.spec.ts` (6 roles x key
endpoints through the real RolesGuard + billing / clinical redaction),
`tests/unit/appointments/in-person-desk.service.spec.ts`,
`tests/unit/appointments/queue-reception-scope.spec.ts`,
`tests/unit/users/staff-location.util.spec.ts`,
`tests/unit/clinic-ops/rx-draft.service.spec.ts`.

## 19. Check-in window, clinic visit lengths, location tokens, booking guard (round 4)

| #    | Area                                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 19.1 | Check-in window                                                           | CHANGED (window end superseded by **19.9**): a patient's own check-in opens **20 min** before the slot (was 60). Reception one-click check-in (`POST /in-person/check-in` as staff, `POST /appointments/:id/check-in`) is unchanged: any time on the visit day. `visit.checkInWindow {opensAt, closesAt, state}` reflects the window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 19.2 | Visit lengths (clinic setting)                                            | NEW keys in the existing clinic settings JSON, saved with the existing `PUT /clinics/:id` body `{settings: {appointmentSettings: {inPersonDurationMinutes, videoDurationMinutes}}}` (merged key by key, other settings untouched; whole minutes 1-240, invalid values dropped, `null` = back to default). Defaults: `inPersonDurationMinutes` **3**, `videoDurationMinutes` **15**. The legacy `appointmentSettings.appointmentDuration` still counts for in-person when the new key is absent. The treatment-catalogue `defaultDurationMinutes` is now 10 (fallback / display only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 19.3 | Booking (`POST /appointments`, walk-in, video booking)                    | CHANGED: the server sets `duration` from 19.2 by appointment type (VIDEO_CALL -> video length, every other type -> in-person length). `duration` in the body is now **optional and ignored** (still validated 3-480 for older clients). Slot grid `GET /appointments/doctor/:doctorId/availability?appointmentType=` uses the same length as its step and as the occupancy of each booked visit (`slotDuration` in the response); a slot offered there always books. Overlap rule (existing, kept): video and in-person are separate kinds per clinic - one doctor may hold one video and one in-person visit in the same slot, never two of the same kind (any location: the one doctor cannot be at two locations at once). 409 `This doctor already has an in-clinic visit in that slot` / `... a video visit in that slot`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 19.4 | Walk-in (`POST /in-person/walk-in`)                                       | CHANGED: books the **next free in-person slot of today** from the same availability grid (not only now / +1 / +2 min); if that slot is taken meanwhile (409) the following free slots are tried (up to 5). No free slot left today -> 409 `No free in-person slot is left today for the doctor. Book the patient for another day.` The visit length is the clinic in-person length. The booking is tagged `metadata {isWalkIn: true, bookingSource: "WALK_IN"}` (lists already expose `isWalkIn`); the check-in log row of a walk-in has `method: WALK_IN`. Response unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 19.5 | Tokens                                                                    | CHANGED: **one token series per clinic location per day**, shared by every doctor at the location and by booked and walk-in patients. **Durable (round 6, audit P0-1/P0-2):** the database is the source of truth - table `location_token_counters(clinicId, locationId, day DATE, lastValue)` is bumped atomically inside the check-in transaction (`UPDATE ... SET lastValue = lastValue + 1 RETURNING`, first token of the day `INSERT ... ON CONFLICT DO UPDATE`, seeded above the day's tokens already handed out) and the result is stored on the appointment (`Appointment.tokenNumber`, `tokenLabel`, `tokenDay`; unique `(clinicId, locationId, tokenDay, tokenNumber)`). Safe across API replicas, cache flushes and restarts; a repeated check-in (double click, retry, undo no-show, doctor reassign) returns the stored token. `day` = the IST day of the appointment **slot**, so a 23:45 slot checked in at 00:10 keeps the previous day's series (19.14). The old cache counter `queue:token:...` is only a fallback for callers without a database client and fails (503) instead of guessing; the old "seed from one doctor's list" fallback is gone. **Live queue rebuild:** when a doctor's live list for today is missing/empty in Dragonfly while the DB has that doctor's arrivals of today (`checkedInAt` today, CONFIRMED / IN_PROGRESS), every queue read/mutation (`GET /queue`, `/queue/me`, `/in-person/*`, call / start / priority / check-in) first rebuilds it from the DB in serving order (priority, then token) with the stored tokens (one bounded query per clinic/day, re-checked at most every 20 s, short distributed lock). `GET /in-person/*` falls back to the stored token when the live entry is missing. `GET /in-person/desk` adds `total` and `truncated` (bound raised from 500 to 3000 rows; never silently drops patients). `GET /appointments` counts at most 10000 rows (`pagination.totalCapped: true` past that). Migration: section 16/17 of `20261020000000_clinic_admin_assistant_round3` (plus indexes `Prescription(patientId, date)`, `Prescription(clinicId, status, date)`, `Invoice(clinicId, createdAt)`, trigram `patient_identifiers.value` when pg_trgm exists). Display token = location prefix + number: `K-001` Kothrud, `B-001` Baner. Prefix = `ClinicLocation.settings.tokenPrefix` (1-3 letters/digits, optional, existing settings JSON) else the first letter of the location name, else `K`. The label is stored on the live queue entry at check-in (`tokenLabel`) and returned as `token` / `tokenLabel` / `nowServingToken` by `GET /in-person/*`, `GET /queue` (`tokenLabel`, plus the tags `isWalkIn`, `priorityLabel`), `GET /queue/me` (`token`; position now counted within the patient's own location), `GET /appointments` rows (`tokenLabel`). `tokenNumber` stays the number. Priority (SENIOR / PREGNANT / EMERGENCY, `POST /queue-ops/appointments/:id/priority`) is an ordering flag on the same series, not a separate series. Video visits get no token (no queue). |
| 19.6 | Double-booking guard (DB level)                                           | NEW: every booking inserts inside one Postgres transaction that takes `pg_advisory_xact_lock(hashtext('appointment-slot:<doctorId>:<IST day>'))`, re-checks the slot rule on that transaction and only then inserts. Concurrent bookings of overlapping slots of the same doctor/day therefore serialize; the loser gets the same 409. No migration needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 19.7 | Reuse / duplicate routes                                                  | Walk-in reuses the patient booking path (`AppointmentsService.createAppointment` -> slot rule, guard, events) and the availability grid; check-in from every route goes through `CheckInLocationService.processCheckIn` (window, token, queue). Location scoping, walk-in / priority tags and ordering use the existing live-queue service (`AppointmentQueueService`: `locationId` filter, `priority` / `priorityLabel` sort, new `isWalkIn` / `tokenLabel` entry fields). Duplicates kept working: `POST /appointments/:id/check-in` delegates to the same `InPersonCheckInService.checkInManually` as `POST /in-person/check-in` (staff). `POST /appointments/check-in/scan-qr` is now a thin delegate of `POST /in-person/check-in` (see 19.10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 19.8 | Token / walk-in names, patient ETA, optional `duration` (integration fix) | ADDITIVE (nothing removed, `tokenLabel` kept): every response that carries a display token now also carries **`token`** with the same value - `GET /queue` rows (`token`, plus `isWalkIn` always a boolean), `GET /queue/me` (`token`, `tokenLabel`, **`nowServingToken`** = token of the entry IN_PROGRESS at the patient's own location for the same doctor, null when nobody is with the doctor, and `isWalkIn`), `GET /appointments` rows (`token` next to `tokenLabel`; `isWalkIn` unchanged), `GET /in-person/*` visits (`token`, `nowServingToken` unchanged, plus `tokenLabel` and `isWalkIn`). **Patient ETA** (`GET /in-person/*` `etaMinutes`, `GET /queue/me` `estimatedWaitTime`) = people waiting ahead x the clinic's in-person visit length (19.2 `inPersonDurationMinutes`, default 3) + half a visit while someone is with the doctor; the fixed 15-minute constant is gone. Frontends show the server ETA and never compute one. **`duration` is optional** (ignored, server-derived from 19.2) on `POST /appointments` and `POST /billing/subscriptions/:id/book-inperson`. Clinic visit lengths are saved only with **`PUT /clinics/:id`** (there is no `PATCH /clinics/:id`), keys `settings.appointmentSettings.inPersonDurationMinutes` / `videoDurationMinutes`; other `appointmentSettings` keys are merged, not wiped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

| 19.9 | Patient QR check-in window (round 5) | CHANGED: the patient's own
check-in (QR `POST /in-person/check-in`, deprecated
`POST /appointments/check-in/scan-qr`, patient `force-check-in`,
`processCheckIn`, plugin config `checkInWindow` / `checkInWindowAfter`) opens
**20 min before** and closes **45 min after the slot start**, both edges
inclusive, **independent of the visit length** (2:00 pm slot: open 1:40 pm ..
2:45 pm; 1:39 pm too early, 2:46 pm too late). One constant pair in
`src/libs/utils/in-person-flow.util.ts`: `QR_WINDOW_OPENS_BEFORE_MINUTES = 20`,
`QR_WINDOW_CLOSES_AFTER_MINUTES = 45` (`CHECK_IN_WINDOW_BEFORE_MINUTES` /
`CHECK_IN_WINDOW_AFTER_MINUTES` alias them; the after-value was 180 / slot end).
Refusals: `TOO_EARLY` "Check-in opens at 1:40 pm, 20 minutes before your 2:00 pm
appointment. Please scan again then." / `EXPIRED` "The check-in window closed at
2:45 pm. Please go to the reception desk." (`POST /in-person/check-in`,
scan-qr); `force-check-in` keeps code `CHECKIN_TIME_WINDOW_EXPIRED` with the
same two messages. `visit.checkInWindow.closesAt` = start + 45 min. Reception
one-click check-in unchanged (any time on the visit day). | | 19.10 |
`POST /appointments/check-in/scan-qr` | **DEPRECATED** (kept working, PATIENT
only): a thin delegate of `InPersonCheckInService.checkIn` - the same QR
validation (signed poster / printed code, replaced poster, inactive location),
19.9 window, plan check via `processCheckIn`, events, check-in log and token as
`POST /in-person/check-in`. Response keeps the legacy shape
`{success, data:{appointmentId, locationId, locationName, checkedInAt, queuePosition, totalInQueue, estimatedWaitTime, doctorId, doctorName, token, alreadyCheckedIn}, message}`;
`locationId` / `locationName` are now the appointment's clinic location (was the
CheckInLocation row). Several bookings at the scanned location ->
`{success:false, data:{requiresSelection:true, eligibleAppointments:[{id,date,time,startTime,doctor,type,status}], message}}`.
Errors are the in-person ones `{statusCode, code, message}` (codes as
`POST /in-person/check-in`: `TOO_EARLY`, `EXPIRED`, `WRONG_LOCATION`,
`NOT_BOOKED` 404, `INVALID_QR`, `EXPIRED_QR`, `LOCATION_INACTIVE`,
`QR_NOT_FOR_STAFF`). Web and mobile no longer call it: every patient QR flow
posts `POST /in-person/check-in` through one hook per platform (web
`useInPersonCheckIn`, mobile `postInPersonCheckIn`). | | 19.11 | Doctor visit
lengths | CLARIFIED: in-person / video visit lengths come only from the clinic
settings (19.2, `visit-duration.util`); slot generation, booking and the patient
ETA never read the doctor profile. `Doctor.slotDurationMinutes` in the doctor
profile body is **deprecated and ignored** for slots (still accepted, so older
clients get no 400). Web and mobile doctor profile / availability screens show
the two lengths read-only from `GET /clinics/:id` `settings.appointmentSettings`
with "Set by clinic admin"; only the clinic admin changes them
(`PUT /clinics/:id`). | | 19.12 | Patient-bookable services (clinic setting) |
ADDITIVE: `GET /appointments/services/catalog` (@Public; send `X-Clinic-ID` for
the clinic's list) still returns **every** catalog entry and adds
**`bookable: boolean`** per entry = the services a patient can pick in the
booking dialog. Set per clinic in the existing settings JSON with
`PUT /clinics/:id` body
`{settings: {appointmentSettings: {bookableTreatmentTypes: ["GENERAL_CONSULTATION", ...]}}}`
(TreatmentType strings, case-insensitive, aliases resolve, unknown / inactive
values dropped, `null` = back to default; an empty / invalid list means the
default). Default: `GENERAL_CONSULTATION`, `FOLLOW_UP`, `SPECIAL_CASE`,
`GERIATRIC_CARE` (Senior Citizen). Informational only: `POST /appointments` does
not reject non-bookable types (staff flows unchanged). Clients show
`bookable === true` entries for the chosen mode and fall back to the old list
when no entry carries `bookable` (older backend). | | 19.13 | Typed desk code
needs the device position (`POST /in-person/check-in`, deprecated
`POST /appointments/check-in/scan-qr`) | CHANGED: a PATIENT who sends the
**printed desk code** (`qrCode` that is not the signed poster JSON, e.g.
`CHK-MAIN-CLINIC-TEST`) must send `coordinates {lat, lng, accuracy?}`
(`latitude`/`longitude` accepted as aliases; lat -90..90, lng -180..180, finite
numbers; `accuracy` metres >= 0). Missing / unusable -> **400
`LOCATION_REQUIRED`** "Turn on location to check in with the desk code, or scan
the QR at the desk.". Outside the CheckInLocation `radius` (metres, from its
`coordinates`) -> **403 `TOO_FAR`** "You are about 1.2 km from the clinic. Check
in when you reach the clinic." (distance in the message). GPS allowance:
accepted when `distance - min(accuracy, 1000 m) <= radius` (constant
`DESK_CODE_MAX_ACCURACY_ALLOWANCE_METERS`, `core/desk-code-presence.util.ts`). A
location without a usable geofence (no coordinates / radius <= 0) is accepted
and logged as a WARN (configuration gap). Both refusals are written to the
check-in log (`failureReason` `LOCATION_REQUIRED` / `TOO_FAR`, new values;
`OTHER` unchanged). The checked position is stored on the CheckIn row.
Unchanged: a scanned **signed poster** keeps the optional ('if-supplied')
position check, and reception one-click check-in never needs a position. DTO:
`coordinates` is now validated (nested), `deviceInfo` is capped at 20 keys / 2
KB (400 otherwise). Web and mobile read the position before sending a typed code
("Checking your location...") and do not call the API without it. | | 19.14 |
Check-in window across midnight | FIXED: "today" for a patient's bookings
(`POST /in-person/check-in`, `GET /in-person/me/today`) is today's IST slots
**plus any slot whose 19.9 window is open now**, so a 23:45 slot can be checked
in until 00:30 the next day and a 00:10 slot from 23:50 the day before (was
`NOT_BOOKED` / `NOT_TODAY` after midnight). The arrival joins the live queue of
the day the patient is at the desk. Staff check-in stays same-day. Clients base
the check-in hint on `visit.checkInWindow.state`, not the calendar day. | |
19.15 | Cache after check-in | FIXED: `POST /in-person/check-in` and
`POST /in-person/walk-in` invalidate the appointment list caches (same as
scan-qr, plus `my_appointments`), and every recorded arrival invalidates the
patient's `user:<id>` tag (`GET /appointments/my-appointments`,
`GET /patients/me/dashboard-summary`), so the patient's visit card switches to
"checked in" (token, queue place) right away instead of after the cache TTL. |
Unit tests: `tests/unit/appointments/visit-duration.util.spec.ts`,
`in-person-flow.spec.ts` (20 / 45-min window incl. the 1:39 / 1:40 / 2:45 / 2:46
pm edges, token prefix), `appointments-reschedule-and-slots.spec.ts` (clinic
visit length at booking and in the grid, advisory-lock guard incl. an
overlapping booking committed meanwhile), `in-person-desk.service.spec.ts`
(walk-in next free slot), `check-in-queue-recovery.spec.ts` (token per location,
walk-in tag, priority ordering), `appointment-state-policy.spec.ts` (overlap by
visit length), `check-in-timing.spec.ts` (45-min close, opening / closing time
in the message), `appointments-controller-checkin.spec.ts` +
`appointments-checkin-recovery.spec.ts` (scan-qr delegates to
`InPersonCheckInService`, legacy shape, 503 retry repair, 20 / 45 edges through
scan-qr). 19.13 / 19.14: `desk-code-presence.spec.ts` (LOCATION_REQUIRED,
TOO_FAR with distance, inside radius, accuracy allowance and its 1000 m cap,
poster and reception unaffected, deviceInfo cap, 23:45 slot at 00:10 and 00:10
slot at 23:55).
