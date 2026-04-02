# Unified Queue Production Implementation Plan

## Objective

Move HealthCareApp to a production-grade queue architecture with:

- one physical BullMQ queue
- one canonical command envelope
- one queue projection store for UI
- one worker pipeline
- role-filtered queue screens
- realtime updates through sockets

This plan is written to minimize regressions while preserving existing clinic workflows.

## Success Criteria

The implementation is complete when:

- all queue writes enter through one BullMQ queue
- operational doctor and treatment queues are represented in one projection model
- all queue UIs read the projection, not raw BullMQ jobs
- Bull Board is used only for ops
- role-based queue flows work for patient, receptionist, doctor, nurse, clinic admin, and super admin
- queue actions are auditable and clinic-scoped

## Non-Goals

This plan does not aim to:

- redesign the whole appointment product
- replace Bull Board with a custom infra UI
- remove all Redis usage

Redis remains acceptable as the projection store if it is modeled correctly.

## Phase 0: Stabilize Current Queue Layer

### Goals

- stop contract drift
- remove stale multi-path assumptions
- freeze queue payload shape

### Tasks

1. Normalize canonical envelope handling
   - ensure `addJob`, `patchJobData`, `updateJob`, and queue readers all respect `{ jobType, action, data, metadata }`
   - prohibit top-level business-field merges

2. Remove stale public contract surface
   - remove unused `domain` request fields from queue controller DTOs
   - remove stale frontend queue action arguments that no longer affect behavior

3. Confirm single queue registration
   - verify only one physical BullMQ queue remains registered
   - verify no autoscaler or ad hoc worker creation remains

4. Remove dead worker ownership ambiguity
   - keep real worker ownership in one place
   - mark `SharedWorkerService` as deprecated or convert it into health-only support

### Exit Criteria

- queue job shape is stable
- queue action contracts are explicit
- no duplicate endpoints remain
- worker ownership is unambiguous

## Phase 1: Define Projection Model

### Goals

- separate processing from UI read concerns
- provide one source of truth for live queue screens

### Projection Schema

Recommended projection record:

```ts
type QueueProjectionEntry = {
  entryId: string;
  appointmentId?: string;
  patientId: string;
  patientName?: string;
  clinicId: string;
  locationId?: string;
  queueOwnerId?: string;
  assignedDoctorId?: string;
  queueCategory: string;
  queueLane?: string;
  treatmentType?: string;
  status: "WAITING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  position: number;
  tokenNumber?: string;
  estimatedWaitTime?: number;
  estimatedDuration?: number;
  paused?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  scheduledDate?: string;
};
```

### Storage Choice

Preferred options:

1. Redis projection
   - fast ordering
   - fast queue lane filtering
   - simple realtime use

2. DB projection plus Redis cache
   - better reporting
   - durable history
   - more operational complexity

Recommended rollout:

- use Redis as the immediate projection store
- persist snapshots or history to DB later if reporting requires it

### Tasks

1. Define projection keys
   - clinic
   - location
   - doctor
   - lane
   - date

2. Define projection update helpers
   - enqueue
   - move
   - start
   - complete
   - cancel
   - pause
   - resume
   - reorder

3. Define projection query helpers
   - by clinic
   - by location
   - by doctor
   - by treatment lane
   - by status

### Exit Criteria

- projection shape is documented and implemented
- reads no longer depend on raw BullMQ job inspection

## Phase 2: Convert Queue Actions to Commands

### Goals

- all queue mutations flow through one physical BullMQ queue
- worker becomes the only mutation path

### Commands

Recommended command names:

- `queue.enqueue`
- `queue.confirm`
- `queue.start`
- `queue.complete`
- `queue.cancel`
- `queue.call_next`
- `queue.pause`
- `queue.resume`
- `queue.reorder`
- `queue.position_update`
- `notification.send`

### Tasks

1. Replace direct operational mutations
   - controller should enqueue commands instead of mutating queue state directly where possible

2. Introduce idempotency
   - use correlation ids
   - reject duplicate command application

3. Preserve audit fields
   - actor user id
   - actor role
   - clinic id
   - location id
   - correlation id

4. Define command validation layer
   - clinic scoping
   - doctor scoping
   - row existence
   - appointment eligibility
   - payment gates for video flows

### Exit Criteria

- queue mutation logic is worker-driven
- controllers become command entry points, not state-mutators

## Phase 3: Build Worker Projection Pipeline

### Goals

- worker processes commands
- worker updates projection
- worker emits events

### Tasks

1. Create command router
   - map action names to dedicated handlers

2. Implement projection-updating handlers
   - enqueue handler
   - call-next handler
   - reorder handler
   - pause and resume handler
   - notification handler

3. Emit socket events after successful projection updates
   - event payloads must include clinic and location filters

4. Add retry strategy
   - transient infrastructure errors should retry
   - business validation errors should fail fast

### Exit Criteria

- worker is the only writer to projection state
- all successful mutations produce socket events

## Phase 4: Move Frontend to Projection-Only Reads

### Goals

- frontend queue screens read one backend view model
- no page mixes stats payloads into queue row data

### Tasks

1. Standardize queue response shape
   - queue rows endpoint
   - queue stats endpoint
   - queue analytics endpoint

2. Update queue hooks
   - `useQueue`
   - `useQueueStats`
   - realtime sync hooks

3. Remove stale UI assumptions
   - no row-scoped action should call a doctor-wide operation unless labeled clearly
   - no stats endpoint should be used as row data

4. Normalize role filtering
   - patient
   - receptionist
   - doctor
   - nurse
   - clinic admin
   - super admin

### Exit Criteria

- queue pages use projection-backed APIs only
- realtime updates are coherent

## Phase 5: Role-Wise Integration

### Patient

Requirements:

- appointment and payment status
- queue visibility only if product requires it
- video payment gating before confirmation

### Receptionist

Requirements:

- clinic and location queue views
- check-in
- add to queue
- move patient
- pause and resume
- call next

### Doctor

Requirements:

- assigned queue
- call next
- start consultation
- complete
- reorder

### Nurse

Requirements:

- lane-specific readiness views
- vitals-ready workflows

### Clinic Admin

Requirements:

- clinic-wide queue monitoring
- wait times
- queue capacity
- doctor throughput

### Super Admin

Requirements:

- cross-clinic operational dashboard
- queue backlog
- worker health
- failed job visibility

### Exit Criteria

- each role has a validated queue flow
- each role reads the same projection through different filters

## Phase 6: Monitoring and Operations

### Goals

- separate ops metrics from clinical workflow

### Bull Board Should Show

- waiting jobs
- active jobs
- failed jobs
- delayed jobs
- retries
- throughput
- processing latency

### Product Queue Dashboard Should Show

- total in queue
- average wait time
- in progress
- completed today
- paused lanes
- doctor backlog
- location backlog

### Tasks

1. Add queue health metrics
2. Add projection freshness checks
3. Add dead-letter handling
4. Add queue reconciliation tooling

### Exit Criteria

- operational incidents can be diagnosed from monitoring
- clinical users do not need Bull Board

## Phase 7: Data Migration and Cutover

### Goals

- move safely from hybrid queue logic to unified command-plus-projection flow

### Steps

1. Dual-write period
   - current operational queue mutation path
   - new command/projection path

2. Projection verification
   - compare doctor queues
   - compare location stats
   - compare reorder and call-next behavior

3. Read switch
   - move UI from old operational reads to projection reads

4. Write switch
   - disable old direct mutation path

5. Cleanup
   - remove dead code
   - remove stale domain abstractions
   - remove duplicate queue infrastructure comments and services

### Exit Criteria

- old direct mutation path removed
- all queue writes go through BullMQ command flow

## Edge Cases

The implementation must explicitly handle:

- duplicate enqueue requests
- appointment already completed
- queue pause while a patient is in progress
- queue reorder with missing ids
- doctor reassignment
- clinic/location mismatch
- stale client actions
- payment-gated video appointments
- websocket disconnect and reconnect
- replay of duplicate queue commands

## Quality Gates

Before release:

1. Backend
   - `yarn type-check`
   - `yarn lint:check`
   - queue integration tests

2. Frontend
   - `npm run type-check`
   - `npm run lint`
   - queue screen role tests

3. Functional verification
   - receptionist check-in to doctor completion
   - reorder
   - pause and resume
   - call next
   - notification send and mark-read
   - video payment gate

## Recommended Delivery Phases

### Phase A

- stabilize queue contracts
- remove stale code
- fix envelope consistency

### Phase B

- build projection model
- worker updates projection

### Phase C

- move frontend queue UIs to projection APIs
- role-wise validation

### Phase D

- cut over writes
- deprecate legacy direct operational mutation paths

## Final Target State

```text
One physical BullMQ queue
One worker pipeline
One canonical envelope
One queue projection model
Many logical queues by filtering
Realtime socket updates
Bull Board for operations only
```

## Related Document

See [UNIFIED_QUEUE_README.md](./UNIFIED_QUEUE_README.md) for the architecture overview and diagrams.
