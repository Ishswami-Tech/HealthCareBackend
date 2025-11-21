<!-- 531c4ce3-6faa-409e-afe2-dfbea37b29c1 7a2ddaa2-851b-4770-86e0-026336456870 -->
# Enterprise Scale Architecture - Pharmacy & Inventory Services

## Current Architecture Strengths

- ✅ Read replica routing (ReadReplicaRouterService)
- ✅ Advanced caching with SWR (Stale-While-Revalidate)
- ✅ Connection pooling (ConnectionPoolManager)
- ✅ Query caching (QueryCacheService)
- ✅ Event-driven architecture (EventService)
- ✅ Clinic-based multi-tenancy

## Architecture Enhancements for 10M Concurrent Users

### 1. Service Separation Strategy

**Inventory Service** (Location-Level Stock Management)

- Core responsibility: Stock tracking, transfers, movements
- Location-scoped: Each ClinicLocation has independent stock
- Write-heavy: Stock updates, transfers, adjustments
- Read-heavy: Stock queries, availability checks

**Pharmacy Service** (Business Operations)

- Core responsibility: Prescriptions, dispensing, sales
- Uses Inventory Service for stock operations
- Event-driven: Emits events for billing, notifications
- Read-heavy: Prescription history, patient medications

### 2. Database Architecture

#### 2.1 Sharding Strategy

```
Shard by ClinicId (Hash-based)
├── Shard 1: Clinic IDs 0-999
├── Shard 2: Clinic IDs 1000-1999
└── Shard N: Clinic IDs N*1000 to (N+1)*1000-1

Location-level partitioning within shards:
- LocationStock partitioned by locationId
- StockTransfer partitioned by fromLocationId
```

#### 2.2 Database Models

```prisma
// Location-level stock (partitioned by locationId)
model LocationStock {
  id          String   @id @default(uuid())
  locationId  String   // Partition key
  medicineId  String
  quantity    Int      @default(0)
  reservedQty Int     @default(0) // For pending prescriptions
  minStock    Int      @default(10)
  maxStock    Int?
  reorderLevel Int?
  clinicId    String   // Shard key
  lastUpdated DateTime @default(now())
  
  @@unique([locationId, medicineId])
  @@index([clinicId, locationId])
  @@index([medicineId]) // For cross-location queries
  @@partitionedBy([locationId])
}

// Inter-location transfers (partitioned by fromClinicLocationId)
model StockTransfer {
  id                  String   @id @default(uuid())
  transferNumber      String   @unique
  fromClinicLocationId String  // Partition key - REQUIRED (source location)
  toClinicLocationId   String  // REQUIRED (destination location)
  medicineId          String
  quantity            Int
  status              TransferStatus
  requestedBy         String
  approvedBy          String?
  clinicId            String   // Shard key - REQUIRED (both locations must be same clinic)
  createdAt           DateTime @default(now())
  completedAt         DateTime?
  
  // Validation: Both locations must belong to same clinic
  @@index([clinicId, fromClinicLocationId]) // Clinic + Source location
  @@index([clinicId, toClinicLocationId]) // Clinic + Destination location
  @@index([status, createdAt])
  @@index([fromClinicLocationId, toClinicLocationId]) // Transfer tracking
  @@partitionedBy([fromClinicLocationId])
}

// Stock movements (audit trail)
model StockMovement {
  id          String   @id @default(uuid())
  locationId  String   // Partition key
  medicineId  String
  movementType MovementType
  quantity    Int
  reason      String?
  referenceId String? // Link to transfer/dispensing
  clinicId    String   // Shard key
  createdBy   String
  createdAt   DateTime @default(now())
  
  @@index([clinicId, locationId, createdAt])
  @@partitionedBy([locationId])
}

// Pharmacy dispensing
model Dispensing {
  id            String   @id @default(uuid())
  dispensingNumber String @unique
  prescriptionId String?
  locationId    String   // Partition key
  medicineId   String
  quantity      Int
  patientId     String
  pharmacistId  String
  clinicId     String   // Shard key
  status        DispensingStatus
  createdAt     DateTime @default(now())
  
  @@index([clinicId, locationId])
  @@index([patientId, createdAt])
  @@partitionedBy([locationId])
}
```

### 3. CQRS Pattern Implementation

#### 3.1 Command Side (Write)

```
Inventory Commands:
- ReserveStockCommand
- ReleaseStockCommand
- TransferStockCommand
- AdjustStockCommand
- UpdateStockLevelsCommand

Pharmacy Commands:
- CreatePrescriptionCommand
- DispenseMedicineCommand
- CancelDispensingCommand
```

#### 3.2 Query Side (Read)

```
Materialized Views:
- location_stock_summary (refreshed every 5 min)
- clinic_stock_aggregate (refreshed every 15 min)
- low_stock_alerts (refreshed every 1 min)
- transfer_pending_queue (real-time via events)

Read Models:
- StockAvailabilityReadModel
- PrescriptionHistoryReadModel
- DispensingReportReadModel
```

### 4. Event Sourcing for Audit Trail

```
Events:
- StockReserved
- StockReleased
- StockTransferred
- StockAdjusted
- PrescriptionCreated
- MedicineDispensed
- TransferApproved
- TransferRejected

Event Store:
- Separate event store per clinic (sharded)
- Events stored with clinicId, locationId, timestamp
- Replay capability for audit/reconciliation
```

### 5. Caching Strategy

#### 5.1 Multi-Layer Caching

```
L1: In-Memory Cache (Node.js)
- Stock availability checks (5 min TTL)
- Medicine catalog (1 hour TTL)
- Location info (4 hours TTL)

L2: Redis Cache (Distributed)
- Stock levels (1 min TTL, SWR)
- Prescription templates (1 hour TTL)
- Patient medication history (30 min TTL)

L3: CDN/Edge Cache
- Medicine catalog (static data)
- Location details
- Pricing information
```

#### 5.2 Cache Keys Pattern

```
inventory:stock:{clinicId}:{locationId}:{medicineId}
inventory:availability:{clinicId}:{locationId}
pharmacy:prescription:{prescriptionId}
pharmacy:patient:{patientId}:medications
```

### 6. Queue-Based Processing

#### 6.1 Async Operations

```
High Priority Queue:
- Stock reservations
- Critical transfers
- Emergency dispensing

Normal Priority Queue:
- Stock adjustments
- Transfer approvals
- Prescription processing

Low Priority Queue:
- Stock reports generation
- Analytics aggregation
- Audit log processing
```

#### 6.2 Batch Processing

```
Nightly Jobs:
- Stock reconciliation
- Transfer completion
- Expiry date checks
- Low stock alerts
```

### 7. Horizontal Scaling Strategy

#### 7.1 Service Scaling

```
Inventory Service:
- Stateless design (all state in DB)
- Auto-scale based on queue depth
- Health checks every 30s
- Graceful shutdown (drain queues)

Pharmacy Service:
- Stateless design
- Auto-scale based on request rate
- Circuit breaker for Inventory calls
- Retry with exponential backoff
```

#### 7.2 Database Scaling

```
Read Scaling:
- 10+ read replicas per shard
- Geographic distribution
- Read replica lag monitoring (<100ms)

Write Scaling:
- Primary DB per shard
- Connection pooling (500 connections)
- Write batching for bulk operations
```

### 8. Performance Optimizations

#### 8.1 Database Indexes

```
Critical Indexes:
- [clinicId, locationId, medicineId] - Stock queries
- [locationId, status, createdAt] - Transfer queries
- [patientId, createdAt DESC] - Prescription history
- [medicineId, locationId] - Cross-location availability
```

#### 8.2 Query Optimization

```
- Use read replicas for all SELECT queries
- Batch operations for bulk updates
- Prepared statements for repeated queries
- Connection pooling per clinic tier
```

### 9. Monitoring & Observability

```
Metrics:
- Stock check latency (p50, p95, p99)
- Transfer processing time
- Prescription processing rate
- Cache hit ratio
- Database connection pool usage
- Queue depth

Alerts:
- Stock check latency > 100ms
- Transfer queue depth > 1000
- Cache hit ratio < 80%
- Database connection pool > 80%
- Read replica lag > 500ms
```

### 10. Module Dependencies & Imports

**Module Import Structure:**

```typescript
// InventoryModule
@Module({
  imports: [
    DatabaseModule,        // For database operations
    ClinicModule,          // To validate clinicId/clinicLocationId
    CacheModule,           // For caching stock levels
    EventsModule,          // For stock events
    LoggingModule,         // For audit logging
    GuardsModule,          // For RBAC
    RbacModule,            // For permissions
  ],
  providers: [InventoryService, StockManagementService, TransferService],
  controllers: [InventoryController],
  exports: [InventoryService], // Export for PharmacyModule
})
export class InventoryModule {}

// PharmacyModule
@Module({
  imports: [
    DatabaseModule,        // For database operations
    InventoryModule,       // For stock operations (IMPORTANT)
    ClinicModule,          // To validate clinicId/clinicLocationId
    BillingModule,         // For prescription billing
    EventsModule,          // For prescription events
    CacheModule,           // For caching prescriptions
    LoggingModule,         // For audit logging
    GuardsModule,          // For RBAC
    RbacModule,            // For permissions
  ],
  providers: [PharmacyService, PrescriptionService, DispensingService],
  controllers: [PharmacyController],
  exports: [PharmacyService],
})
export class PharmacyModule {}
```

**Service Dependencies Flow:**

```
PharmacyService
├── → InventoryService (stock checks/updates)
├── → ClinicService (validate clinicId/clinicLocationId)
├── → BillingService (prescription billing)
└── → EventService (prescription events)

InventoryService
├── → ClinicService (validate clinicId/clinicLocationId)
├── → EventService (stock events)
└── → NotificationService (low stock alerts)
```

**No Domain Module Needed:**

- `clinicId` and `clinicLocationId` come from `ClinicModule`
- All services use these IDs directly
- No abstraction layer needed

### 11. Implementation Phases

**Phase 1: Core Services (Week 1-2)**

- Basic Inventory service with location-level stock
- Basic Pharmacy service with prescription management
- Database models and migrations
- Basic caching

**Phase 2: Scaling (Week 3-4)**

- Read replica integration
- Advanced caching (SWR)
- Queue-based processing
- Batch operations

**Phase 3: Enterprise Features (Week 5-6)**

- CQRS implementation
- Event sourcing
- Materialized views
- Sharding strategy

**Phase 4: Optimization (Week 7-8)**

- Performance tuning
- Monitoring & alerts
- Load testing
- Documentation

## Key Design Decisions

1. **Location-Level Partitioning**: Stock partitioned by locationId for optimal query performance
2. **Clinic-Level Sharding**: Database sharded by clinicId for horizontal scaling
3. **CQRS Pattern**: Separate read/write models for optimal performance
4. **Event Sourcing**: Complete audit trail for HIPAA compliance
5. **Multi-Layer Caching**: L1 (memory) → L2 (Redis) → L3 (CDN)
6. **Queue-Based Processing**: Async processing for non-critical operations
7. **Stateless Services**: All services stateless for easy horizontal scaling
8. **Read Replica Routing**: All reads go to replicas, writes to primary

## Expected Performance

- **Stock Check**: < 50ms (p95) with caching
- **Prescription Creation**: < 200ms (p95)
- **Stock Transfer**: < 500ms (p95) async processing
- **Throughput**: 100K+ requests/second (with horizontal scaling)
- **Availability**: 99.99% uptime (with failover)