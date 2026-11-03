-- Audit item P0-3 (docs/DEPLOY_MIGRATIONS.md): these 20 tables and 8 enum
-- types exist in the running database(s) but have no CREATE statement
-- anywhere in migration history - they were added via `prisma db push` or by
-- hand, never captured as a migration. Idempotent: every statement below is
-- safe to re-run and a no-op if the object already exists, so this applies
-- cleanly both to a database that already has these objects (dev, and
-- probably production - see the runbook) and to a genuinely fresh one.

DO $$ BEGIN
  CREATE TYPE "DietaryGoal" AS ENUM ('WEIGHT_LOSS', 'WEIGHT_GAIN', 'DETOX', 'BALANCE', 'REJUVENATION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DietPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MealSlot" AS ENUM ('BREAKFAST', 'MID_MORNING', 'LUNCH', 'EVENING', 'DINNER', 'BEDTIME');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CompatibilitySeverity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CONTRAINDICATED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FoodCategory" AS ENUM ('SUKHA_AHARA', 'ASUKHA_AHARA', 'SATMYA_ASATMYA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "Rasa" AS ENUM ('MADHURA', 'AMLA', 'LAVANA', 'KATU', 'TIKTA', 'KASHAYA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "Virya" AS ENUM ('USHNA', 'SHEETA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "Vipaka" AS ENUM ('MADHURA', 'AMLA', 'KATU');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Name: ClinicExpense; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "ClinicExpense" (
    id text NOT NULL,
    "clinicId" text NOT NULL,
    "userId" text NOT NULL,
    amount double precision NOT NULL,
    category text NOT NULL,
    description text,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status text DEFAULT 'PAID'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CommunicationTemplate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "CommunicationTemplate" (
    id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    category text NOT NULL,
    subject text,
    content text NOT NULL,
    metadata jsonb,
    "clinicId" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "userId" text
);


--
-- Name: DietPlan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "DietPlan" (
    id text NOT NULL,
    "patientId" text NOT NULL,
    "clinicId" text NOT NULL,
    title text NOT NULL,
    goal "DietaryGoal" NOT NULL,
    status "DietPlanStatus" DEFAULT 'DRAFT'::"DietPlanStatus" NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    summary text,
    "prakritiAnalysisId" text,
    "createdBy" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DietPlanItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "DietPlanItem" (
    id text NOT NULL,
    "dietPlanId" text NOT NULL,
    "foodItemId" text NOT NULL,
    "mealSlot" "MealSlot" NOT NULL,
    "quantityGrams" integer NOT NULL,
    "preparationNotes" text,
    rationale text,
    "dayNumber" integer DEFAULT 1 NOT NULL
);


--
-- Name: FoodCompatibilityRule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "FoodCompatibilityRule" (
    id text NOT NULL,
    "foodItemIdA" text NOT NULL,
    "foodItemIdB" text NOT NULL,
    severity "CompatibilitySeverity" NOT NULL,
    description text NOT NULL,
    "classicalReference" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: FoodItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "FoodItem" (
    id text NOT NULL,
    name text NOT NULL,
    "sanskritName" text,
    category "FoodCategory" NOT NULL,
    "primaryRasa" "Rasa" NOT NULL,
    "secondaryRasas" "Rasa"[],
    virya "Virya" NOT NULL,
    vipaka "Vipaka" NOT NULL,
    pacifies "Dosha"[],
    aggravates "Dosha"[],
    description text,
    "defaultPortionGrams" integer,
    tags text[],
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: InsuranceClaim; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "InsuranceClaim" (
    id text NOT NULL,
    "patientId" text NOT NULL,
    "appointmentId" text,
    "invoiceId" text,
    "clinicId" text NOT NULL,
    "claimNumber" text NOT NULL,
    provider text NOT NULL,
    amount double precision NOT NULL,
    status text DEFAULT 'SUBMITTED'::text NOT NULL,
    "submittedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "responseAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: InsuranceDocument; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "InsuranceDocument" (
    id text NOT NULL,
    "claimId" text NOT NULL,
    "fileUrl" text NOT NULL,
    "fileKey" text NOT NULL,
    "documentType" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: LocationHead; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "LocationHead" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "clinicId" text NOT NULL,
    "locationId" text,
    "assignedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "assignedBy" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: NotificationPreference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "emailEnabled" boolean DEFAULT true NOT NULL,
    "smsEnabled" boolean DEFAULT true NOT NULL,
    "pushEnabled" boolean DEFAULT true NOT NULL,
    "socketEnabled" boolean DEFAULT true NOT NULL,
    "whatsappEnabled" boolean DEFAULT false NOT NULL,
    "appointmentEnabled" boolean DEFAULT true NOT NULL,
    "ehrEnabled" boolean DEFAULT true NOT NULL,
    "billingEnabled" boolean DEFAULT true NOT NULL,
    "systemEnabled" boolean DEFAULT true NOT NULL,
    "quietHoursStart" text,
    "quietHoursEnd" text,
    "quietHoursTimezone" text DEFAULT 'UTC'::text,
    "categoryPreferences" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: admissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS admissions (
    id text NOT NULL,
    "admissionNumber" text NOT NULL,
    "patientId" text NOT NULL,
    "clinicId" text NOT NULL,
    "clinicLocationId" text NOT NULL,
    "wardId" text NOT NULL,
    "bedId" text NOT NULL,
    "admittingDoctorId" text NOT NULL,
    status text DEFAULT 'ADMITTED'::text NOT NULL,
    "admittedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "primaryDiagnosis" text,
    "secondaryDiagnoses" jsonb,
    "admissionReason" text NOT NULL,
    "expectedDischargeDate" timestamp(3) without time zone,
    "referringDoctor" text,
    "attendantName" text,
    "attendantPhone" text,
    "insuranceDetails" jsonb,
    notes text,
    "dischargedAt" timestamp(3) without time zone,
    "dischargeType" text,
    "dischargedById" text,
    "finalDiagnosis" text,
    "treatmentSummary" text,
    "followUpInstructions" text,
    "followUpDate" timestamp(3) without time zone,
    "dischargeMedications" jsonb,
    "dischargeAdvice" text,
    "createdBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: bed_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS bed_assignments (
    id text NOT NULL,
    "admissionId" text NOT NULL,
    "bedId" text NOT NULL,
    "wardId" text NOT NULL,
    "assignedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "releasedAt" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "transferReason" text,
    "authorizedBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: bed_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS bed_charges (
    id text NOT NULL,
    "admissionId" text NOT NULL,
    "patientId" text NOT NULL,
    "clinicId" text NOT NULL,
    "clinicLocationId" text NOT NULL,
    "chargeDate" timestamp(3) without time zone NOT NULL,
    days integer NOT NULL,
    "bedRate" double precision NOT NULL,
    "bedCharges" double precision NOT NULL,
    "totalCharges" double precision NOT NULL,
    "isBilled" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: beds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS beds (
    id text NOT NULL,
    "clinicId" text NOT NULL,
    "clinicLocationId" text NOT NULL,
    "wardId" text NOT NULL,
    "bedNumber" text NOT NULL,
    "roomNumber" text,
    "bedType" text,
    "dailyRate" double precision,
    "hasOxygen" boolean DEFAULT false NOT NULL,
    "hasVentilator" boolean DEFAULT false NOT NULL,
    features jsonb,
    status text DEFAULT 'AVAILABLE'::text NOT NULL,
    notes text,
    "createdBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: bedside_medications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS bedside_medications (
    id text NOT NULL,
    "admissionId" text NOT NULL,
    "patientId" text NOT NULL,
    "clinicId" text NOT NULL,
    "clinicLocationId" text NOT NULL,
    "medicationName" text NOT NULL,
    dosage text NOT NULL,
    route text NOT NULL,
    frequency text,
    "administeredBy" text NOT NULL,
    "verifiedById" text,
    "administeredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "batchNumber" text,
    "adverseReactions" text,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: discharge_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS discharge_summaries (
    id text NOT NULL,
    "admissionId" text NOT NULL,
    "patientId" text NOT NULL,
    "clinicId" text NOT NULL,
    "clinicLocationId" text NOT NULL,
    "finalDiagnosis" text,
    "treatmentSummary" text,
    "dischargeType" text NOT NULL,
    "dischargedAt" timestamp(3) without time zone NOT NULL,
    "dischargedById" text,
    "followUpInstructions" text,
    "followUpDate" timestamp(3) without time zone,
    "dischargeMedications" jsonb,
    "dischargeAdvice" text,
    notes text,
    "nursingNotesCount" integer DEFAULT 0 NOT NULL,
    "vitalsEntriesCount" integer DEFAULT 0 NOT NULL,
    "medicationsAdministered" integer DEFAULT 0 NOT NULL,
    "pdfGenerated" boolean DEFAULT false NOT NULL,
    "pdfUrl" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: nursing_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS nursing_notes (
    id text NOT NULL,
    "admissionId" text NOT NULL,
    "patientId" text NOT NULL,
    "clinicId" text NOT NULL,
    "clinicLocationId" text NOT NULL,
    severity text NOT NULL,
    content text NOT NULL,
    "recordedBy" text,
    "recordedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: vitals_flowsheets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS vitals_flowsheets (
    id text NOT NULL,
    "admissionId" text NOT NULL,
    "patientId" text NOT NULL,
    "clinicId" text NOT NULL,
    "clinicLocationId" text NOT NULL,
    "bpSystolic" integer,
    "bpDiastolic" integer,
    "heartRate" integer,
    temperature double precision,
    "respiratoryRate" integer,
    "oxygenSaturation" integer,
    "bloodGlucose" double precision,
    weight double precision,
    height double precision,
    bmi double precision,
    "painScore" integer,
    "recordedBy" text NOT NULL,
    notes text,
    "recordedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: wards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS wards (
    id text NOT NULL,
    "clinicId" text NOT NULL,
    "clinicLocationId" text NOT NULL,
    name text NOT NULL,
    "wardType" text NOT NULL,
    location text,
    "totalBeds" integer DEFAULT 0 NOT NULL,
    "defaultDailyRate" double precision,
    "isActive" boolean DEFAULT true NOT NULL,
    notes text,
    "createdBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: whatsapp_suppression_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS whatsapp_suppression_list (
    id text NOT NULL,
    "phoneNumber" text NOT NULL,
    reason "SuppressionReason" NOT NULL,
    source "SuppressionSource" NOT NULL,
    "userId" text,
    "clinicId" text,
    "messageId" text,
    description text,
    metadata jsonb,
    "suppressedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: ClinicExpense ClinicExpense_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "ClinicExpense" ADD CONSTRAINT "ClinicExpense_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: CommunicationTemplate CommunicationTemplate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "CommunicationTemplate" ADD CONSTRAINT "CommunicationTemplate_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: DietPlanItem DietPlanItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "DietPlanItem" ADD CONSTRAINT "DietPlanItem_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: DietPlan DietPlan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "DietPlan" ADD CONSTRAINT "DietPlan_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: FoodCompatibilityRule FoodCompatibilityRule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "FoodCompatibilityRule" ADD CONSTRAINT "FoodCompatibilityRule_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: FoodItem FoodItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "FoodItem" ADD CONSTRAINT "FoodItem_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: InsuranceClaim InsuranceClaim_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: InsuranceDocument InsuranceDocument_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "InsuranceDocument" ADD CONSTRAINT "InsuranceDocument_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: LocationHead LocationHead_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "LocationHead" ADD CONSTRAINT "LocationHead_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: NotificationPreference NotificationPreference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: admissions admissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE admissions ADD CONSTRAINT admissions_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_assignments bed_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_assignments ADD CONSTRAINT bed_assignments_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_charges bed_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_charges ADD CONSTRAINT bed_charges_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: beds beds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE beds ADD CONSTRAINT beds_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bedside_medications bedside_medications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bedside_medications ADD CONSTRAINT bedside_medications_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: discharge_summaries discharge_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE discharge_summaries ADD CONSTRAINT discharge_summaries_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: nursing_notes nursing_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE nursing_notes ADD CONSTRAINT nursing_notes_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: vitals_flowsheets vitals_flowsheets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE vitals_flowsheets ADD CONSTRAINT vitals_flowsheets_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: wards wards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE wards ADD CONSTRAINT wards_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: whatsapp_suppression_list whatsapp_suppression_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE whatsapp_suppression_list ADD CONSTRAINT whatsapp_suppression_list_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: ClinicExpense_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "ClinicExpense_category_idx" ON "ClinicExpense" USING btree (category);


--
-- Name: ClinicExpense_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "ClinicExpense_clinicId_idx" ON "ClinicExpense" USING btree ("clinicId");


--
-- Name: ClinicExpense_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "ClinicExpense_date_idx" ON "ClinicExpense" USING btree (date);


--
-- Name: ClinicExpense_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "ClinicExpense_userId_idx" ON "ClinicExpense" USING btree ("userId");


--
-- Name: CommunicationTemplate_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "CommunicationTemplate_category_idx" ON "CommunicationTemplate" USING btree (category);


--
-- Name: CommunicationTemplate_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "CommunicationTemplate_clinicId_idx" ON "CommunicationTemplate" USING btree ("clinicId");


--
-- Name: CommunicationTemplate_name_type_clinicId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationTemplate_name_type_clinicId_key" ON "CommunicationTemplate" USING btree (name, type, "clinicId");


--
-- Name: CommunicationTemplate_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "CommunicationTemplate_type_idx" ON "CommunicationTemplate" USING btree (type);


--
-- Name: DietPlanItem_dietPlanId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "DietPlanItem_dietPlanId_idx" ON "DietPlanItem" USING btree ("dietPlanId");


--
-- Name: DietPlanItem_foodItemId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "DietPlanItem_foodItemId_idx" ON "DietPlanItem" USING btree ("foodItemId");


--
-- Name: DietPlan_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "DietPlan_clinicId_idx" ON "DietPlan" USING btree ("clinicId");


--
-- Name: DietPlan_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "DietPlan_patientId_idx" ON "DietPlan" USING btree ("patientId");


--
-- Name: DietPlan_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "DietPlan_status_idx" ON "DietPlan" USING btree (status);


--
-- Name: FoodCompatibilityRule_foodItemIdA_foodItemIdB_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "FoodCompatibilityRule_foodItemIdA_foodItemIdB_key" ON "FoodCompatibilityRule" USING btree ("foodItemIdA", "foodItemIdB");


--
-- Name: FoodCompatibilityRule_foodItemIdA_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "FoodCompatibilityRule_foodItemIdA_idx" ON "FoodCompatibilityRule" USING btree ("foodItemIdA");


--
-- Name: FoodCompatibilityRule_foodItemIdB_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "FoodCompatibilityRule_foodItemIdB_idx" ON "FoodCompatibilityRule" USING btree ("foodItemIdB");


--
-- Name: FoodItem_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "FoodItem_category_idx" ON "FoodItem" USING btree (category);


--
-- Name: FoodItem_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "FoodItem_isActive_idx" ON "FoodItem" USING btree ("isActive");


--
-- Name: InsuranceClaim_claimNumber_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "InsuranceClaim_claimNumber_idx" ON "InsuranceClaim" USING btree ("claimNumber");


--
-- Name: InsuranceClaim_claimNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "InsuranceClaim_claimNumber_key" ON "InsuranceClaim" USING btree ("claimNumber");


--
-- Name: InsuranceClaim_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "InsuranceClaim_clinicId_idx" ON "InsuranceClaim" USING btree ("clinicId");


--
-- Name: InsuranceClaim_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "InsuranceClaim_patientId_idx" ON "InsuranceClaim" USING btree ("patientId");


--
-- Name: InsuranceClaim_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "InsuranceClaim_status_idx" ON "InsuranceClaim" USING btree (status);


--
-- Name: InsuranceDocument_claimId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "InsuranceDocument_claimId_idx" ON "InsuranceDocument" USING btree ("claimId");


--
-- Name: LocationHead_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "LocationHead_clinicId_idx" ON "LocationHead" USING btree ("clinicId");


--
-- Name: LocationHead_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "LocationHead_isActive_idx" ON "LocationHead" USING btree ("isActive");


--
-- Name: LocationHead_locationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "LocationHead_locationId_idx" ON "LocationHead" USING btree ("locationId");


--
-- Name: LocationHead_userId_clinicId_locationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "LocationHead_userId_clinicId_locationId_key" ON "LocationHead" USING btree ("userId", "clinicId", "locationId");


--
-- Name: LocationHead_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "LocationHead_userId_key" ON "LocationHead" USING btree ("userId");


--
-- Name: NotificationPreference_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "NotificationPreference_userId_idx" ON "NotificationPreference" USING btree ("userId");


--
-- Name: NotificationPreference_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_key" ON "NotificationPreference" USING btree ("userId");


--
-- Name: admissions_admissionNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "admissions_admissionNumber_key" ON admissions USING btree ("admissionNumber");


--
-- Name: admissions_bedId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "admissions_bedId_idx" ON admissions USING btree ("bedId");


--
-- Name: admissions_clinicId_admissionNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "admissions_clinicId_admissionNumber_key" ON admissions USING btree ("clinicId", "admissionNumber");


--
-- Name: admissions_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "admissions_clinicId_idx" ON admissions USING btree ("clinicId");


--
-- Name: admissions_clinicLocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "admissions_clinicLocationId_idx" ON admissions USING btree ("clinicLocationId");


--
-- Name: admissions_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "admissions_patientId_idx" ON admissions USING btree ("patientId");


--
-- Name: admissions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS admissions_status_idx ON admissions USING btree (status);


--
-- Name: admissions_wardId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "admissions_wardId_idx" ON admissions USING btree ("wardId");


--
-- Name: bed_assignments_admissionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bed_assignments_admissionId_idx" ON bed_assignments USING btree ("admissionId");


--
-- Name: bed_assignments_bedId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bed_assignments_bedId_idx" ON bed_assignments USING btree ("bedId");


--
-- Name: bed_assignments_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bed_assignments_isActive_idx" ON bed_assignments USING btree ("isActive");


--
-- Name: bed_assignments_wardId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bed_assignments_wardId_idx" ON bed_assignments USING btree ("wardId");


--
-- Name: bed_charges_admissionId_chargeDate_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "bed_charges_admissionId_chargeDate_key" ON bed_charges USING btree ("admissionId", "chargeDate");


--
-- Name: bed_charges_chargeDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bed_charges_chargeDate_idx" ON bed_charges USING btree ("chargeDate");


--
-- Name: bed_charges_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bed_charges_clinicId_idx" ON bed_charges USING btree ("clinicId");


--
-- Name: bed_charges_clinicLocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bed_charges_clinicLocationId_idx" ON bed_charges USING btree ("clinicLocationId");


--
-- Name: bed_charges_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bed_charges_patientId_idx" ON bed_charges USING btree ("patientId");


--
-- Name: beds_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "beds_clinicId_idx" ON beds USING btree ("clinicId");


--
-- Name: beds_clinicLocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "beds_clinicLocationId_idx" ON beds USING btree ("clinicLocationId");


--
-- Name: beds_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS beds_status_idx ON beds USING btree (status);


--
-- Name: beds_wardId_bedNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "beds_wardId_bedNumber_key" ON beds USING btree ("wardId", "bedNumber");


--
-- Name: beds_wardId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "beds_wardId_idx" ON beds USING btree ("wardId");


--
-- Name: bedside_medications_administeredAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bedside_medications_administeredAt_idx" ON bedside_medications USING btree ("administeredAt");


--
-- Name: bedside_medications_admissionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bedside_medications_admissionId_idx" ON bedside_medications USING btree ("admissionId");


--
-- Name: bedside_medications_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bedside_medications_clinicId_idx" ON bedside_medications USING btree ("clinicId");


--
-- Name: bedside_medications_clinicLocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "bedside_medications_clinicLocationId_idx" ON bedside_medications USING btree ("clinicLocationId");


--
-- Name: discharge_summaries_admissionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "discharge_summaries_admissionId_key" ON discharge_summaries USING btree ("admissionId");


--
-- Name: discharge_summaries_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "discharge_summaries_clinicId_idx" ON discharge_summaries USING btree ("clinicId");


--
-- Name: discharge_summaries_clinicLocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "discharge_summaries_clinicLocationId_idx" ON discharge_summaries USING btree ("clinicLocationId");


--
-- Name: nursing_notes_admissionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "nursing_notes_admissionId_idx" ON nursing_notes USING btree ("admissionId");


--
-- Name: nursing_notes_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "nursing_notes_clinicId_idx" ON nursing_notes USING btree ("clinicId");


--
-- Name: nursing_notes_clinicLocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "nursing_notes_clinicLocationId_idx" ON nursing_notes USING btree ("clinicLocationId");


--
-- Name: nursing_notes_recordedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "nursing_notes_recordedAt_idx" ON nursing_notes USING btree ("recordedAt");


--
-- Name: vitals_flowsheets_admissionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "vitals_flowsheets_admissionId_idx" ON vitals_flowsheets USING btree ("admissionId");


--
-- Name: vitals_flowsheets_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "vitals_flowsheets_clinicId_idx" ON vitals_flowsheets USING btree ("clinicId");


--
-- Name: vitals_flowsheets_clinicLocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "vitals_flowsheets_clinicLocationId_idx" ON vitals_flowsheets USING btree ("clinicLocationId");


--
-- Name: vitals_flowsheets_recordedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "vitals_flowsheets_recordedAt_idx" ON vitals_flowsheets USING btree ("recordedAt");


--
-- Name: wards_clinicId_clinicLocationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "wards_clinicId_clinicLocationId_name_key" ON wards USING btree ("clinicId", "clinicLocationId", name);


--
-- Name: wards_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "wards_clinicId_idx" ON wards USING btree ("clinicId");


--
-- Name: wards_clinicLocationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "wards_clinicLocationId_idx" ON wards USING btree ("clinicLocationId");


--
-- Name: wards_wardType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "wards_wardType_idx" ON wards USING btree ("wardType");


--
-- Name: whatsapp_suppression_list_clinicId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "whatsapp_suppression_list_clinicId_idx" ON whatsapp_suppression_list USING btree ("clinicId");


--
-- Name: whatsapp_suppression_list_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "whatsapp_suppression_list_isActive_idx" ON whatsapp_suppression_list USING btree ("isActive");


--
-- Name: whatsapp_suppression_list_phoneNumber_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "whatsapp_suppression_list_phoneNumber_idx" ON whatsapp_suppression_list USING btree ("phoneNumber");


--
-- Name: whatsapp_suppression_list_phoneNumber_reason_clinicId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_suppression_list_phoneNumber_reason_clinicId_key" ON whatsapp_suppression_list USING btree ("phoneNumber", reason, "clinicId");


--
-- Name: whatsapp_suppression_list_reason_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS whatsapp_suppression_list_reason_idx ON whatsapp_suppression_list USING btree (reason);


--
-- Name: whatsapp_suppression_list_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS whatsapp_suppression_list_source_idx ON whatsapp_suppression_list USING btree (source);


--
-- Name: whatsapp_suppression_list_suppressedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "whatsapp_suppression_list_suppressedAt_idx" ON whatsapp_suppression_list USING btree ("suppressedAt");


--
-- Name: whatsapp_suppression_list_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "whatsapp_suppression_list_userId_idx" ON whatsapp_suppression_list USING btree ("userId");


--
-- Name: ClinicExpense ClinicExpense_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "ClinicExpense" ADD CONSTRAINT "ClinicExpense_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: ClinicExpense ClinicExpense_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "ClinicExpense" ADD CONSTRAINT "ClinicExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: CommunicationTemplate CommunicationTemplate_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "CommunicationTemplate" ADD CONSTRAINT "CommunicationTemplate_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: CommunicationTemplate CommunicationTemplate_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "CommunicationTemplate" ADD CONSTRAINT "CommunicationTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: DietPlanItem DietPlanItem_dietPlanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "DietPlanItem" ADD CONSTRAINT "DietPlanItem_dietPlanId_fkey" FOREIGN KEY ("dietPlanId") REFERENCES "DietPlan"(id) ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: DietPlanItem DietPlanItem_foodItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "DietPlanItem" ADD CONSTRAINT "DietPlanItem_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: FoodCompatibilityRule FoodCompatibilityRule_foodItemIdA_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "FoodCompatibilityRule" ADD CONSTRAINT "FoodCompatibilityRule_foodItemIdA_fkey" FOREIGN KEY ("foodItemIdA") REFERENCES "FoodItem"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: FoodCompatibilityRule FoodCompatibilityRule_foodItemIdB_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "FoodCompatibilityRule" ADD CONSTRAINT "FoodCompatibilityRule_foodItemIdB_fkey" FOREIGN KEY ("foodItemIdB") REFERENCES "FoodItem"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: InsuranceClaim InsuranceClaim_appointmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: InsuranceClaim InsuranceClaim_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: InsuranceClaim InsuranceClaim_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: InsuranceClaim InsuranceClaim_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: InsuranceDocument InsuranceDocument_claimId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "InsuranceDocument" ADD CONSTRAINT "InsuranceDocument_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InsuranceClaim"(id) ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: LocationHead LocationHead_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "LocationHead" ADD CONSTRAINT "LocationHead_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: LocationHead LocationHead_locationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "LocationHead" ADD CONSTRAINT "LocationHead_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: LocationHead LocationHead_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "LocationHead" ADD CONSTRAINT "LocationHead_userId_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: NotificationPreference NotificationPreference_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: admissions admissions_bedId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE admissions ADD CONSTRAINT "admissions_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES beds(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: admissions admissions_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE admissions ADD CONSTRAINT "admissions_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: admissions admissions_clinicLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE admissions ADD CONSTRAINT "admissions_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: admissions admissions_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE admissions ADD CONSTRAINT "admissions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: admissions admissions_wardId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE admissions ADD CONSTRAINT "admissions_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES wards(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_assignments bed_assignments_admissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_assignments ADD CONSTRAINT "bed_assignments_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES admissions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_assignments bed_assignments_bedId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_assignments ADD CONSTRAINT "bed_assignments_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES beds(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_assignments bed_assignments_wardId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_assignments ADD CONSTRAINT "bed_assignments_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES wards(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_charges bed_charges_admissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_charges ADD CONSTRAINT "bed_charges_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES admissions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_charges bed_charges_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_charges ADD CONSTRAINT "bed_charges_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_charges bed_charges_clinicLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_charges ADD CONSTRAINT "bed_charges_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bed_charges bed_charges_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bed_charges ADD CONSTRAINT "bed_charges_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: beds beds_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE beds ADD CONSTRAINT "beds_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: beds beds_clinicLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE beds ADD CONSTRAINT "beds_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: beds beds_wardId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE beds ADD CONSTRAINT "beds_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES wards(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bedside_medications bedside_medications_administeredBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bedside_medications ADD CONSTRAINT "bedside_medications_administeredBy_fkey" FOREIGN KEY ("administeredBy") REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bedside_medications bedside_medications_admissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bedside_medications ADD CONSTRAINT "bedside_medications_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES admissions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bedside_medications bedside_medications_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bedside_medications ADD CONSTRAINT "bedside_medications_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bedside_medications bedside_medications_clinicLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bedside_medications ADD CONSTRAINT "bedside_medications_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bedside_medications bedside_medications_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bedside_medications ADD CONSTRAINT "bedside_medications_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: bedside_medications bedside_medications_verifiedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE bedside_medications ADD CONSTRAINT "bedside_medications_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: discharge_summaries discharge_summaries_admissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE discharge_summaries ADD CONSTRAINT "discharge_summaries_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES admissions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: discharge_summaries discharge_summaries_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE discharge_summaries ADD CONSTRAINT "discharge_summaries_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: discharge_summaries discharge_summaries_clinicLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE discharge_summaries ADD CONSTRAINT "discharge_summaries_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: nursing_notes nursing_notes_admissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE nursing_notes ADD CONSTRAINT "nursing_notes_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES admissions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: nursing_notes nursing_notes_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE nursing_notes ADD CONSTRAINT "nursing_notes_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: nursing_notes nursing_notes_clinicLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE nursing_notes ADD CONSTRAINT "nursing_notes_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: nursing_notes nursing_notes_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE nursing_notes ADD CONSTRAINT "nursing_notes_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: vitals_flowsheets vitals_flowsheets_admissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE vitals_flowsheets ADD CONSTRAINT "vitals_flowsheets_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES admissions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: vitals_flowsheets vitals_flowsheets_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE vitals_flowsheets ADD CONSTRAINT "vitals_flowsheets_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: vitals_flowsheets vitals_flowsheets_clinicLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE vitals_flowsheets ADD CONSTRAINT "vitals_flowsheets_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: vitals_flowsheets vitals_flowsheets_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE vitals_flowsheets ADD CONSTRAINT "vitals_flowsheets_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: vitals_flowsheets vitals_flowsheets_recordedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE vitals_flowsheets ADD CONSTRAINT "vitals_flowsheets_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: wards wards_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE wards ADD CONSTRAINT "wards_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: wards wards_clinicLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE wards ADD CONSTRAINT "wards_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: whatsapp_suppression_list whatsapp_suppression_list_clinicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE whatsapp_suppression_list ADD CONSTRAINT "whatsapp_suppression_list_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


--
-- Name: whatsapp_suppression_list whatsapp_suppression_list_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$ BEGIN
  ALTER TABLE whatsapp_suppression_list ADD CONSTRAINT "whatsapp_suppression_list_userId_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- "Queue"."clinicLocationId" - same gap as the 20 tables above, but on a column of a table that
-- already has a migration (the table itself came from the init migration). The composite index
-- that needs it is added later by 20261021000000_phase3_hot_filter_indexes.
ALTER TABLE "Queue" ADD COLUMN IF NOT EXISTS "clinicLocationId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Queue" ADD CONSTRAINT "Queue_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES clinic_locations(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

