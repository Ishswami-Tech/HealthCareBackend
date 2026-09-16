import {
  AppointmentType,
  TreatmentType,
  AppointmentServiceCategory,
  AppointmentQueueCategory,
  AppointmentBillingMode,
} from './enums.types';

export type TreatmentFamily = 'GENERAL' | 'AYURVEDA';

export interface TreatmentCatalogEntry {
  treatmentType: TreatmentType;
  label: string;
  description: string;
  treatmentFamily: TreatmentFamily;
  category: AppointmentServiceCategory;
  defaultDurationMinutes: number;
  appointmentModes: AppointmentType[];
  queueCategory: AppointmentQueueCategory;
  serviceBucket: string;
  billingMode: AppointmentBillingMode;
  assistantDoctorEligible: boolean;
  active: boolean;
  videoConsultationFee?: number;
  aliasTreatmentTypes?: TreatmentType[];
}

export interface TreatmentCatalogFilter {
  value: string;
  label: string;
  description: string;
  aliases?: string[];
}

export interface TreatmentCatalogGroup {
  key: string;
  label: string;
  description: string;
  filters: TreatmentCatalogFilter[];
}

const CATEGORY_LABELS: Record<AppointmentServiceCategory, string> = {
  [AppointmentServiceCategory.CONSULTATION]: 'Consultation',
  [AppointmentServiceCategory.DIAGNOSIS]: 'Diagnosis',
  [AppointmentServiceCategory.TREATMENT]: 'Treatment',
  [AppointmentServiceCategory.SURGERY]: 'Surgery',
  [AppointmentServiceCategory.COUNSELING]: 'Counseling',
  [AppointmentServiceCategory.THERAPY]: 'Therapy',
};

export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;

export const APPOINTMENT_SERVICE_CATALOG: readonly TreatmentCatalogEntry[] = [
  {
    treatmentType: TreatmentType.GENERAL_CONSULTATION,
    label: 'General Consultation',
    description: 'Comprehensive health assessment and treatment planning',
    treatmentFamily: 'GENERAL',
    category: AppointmentServiceCategory.CONSULTATION,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'GENERAL',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
    videoConsultationFee: 1251,
  },
  {
    treatmentType: TreatmentType.FOLLOW_UP,
    label: 'Follow-up Consultation',
    description: 'Progress review and treatment adjustments',
    treatmentFamily: 'GENERAL',
    category: AppointmentServiceCategory.CONSULTATION,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'FOLLOW_UP',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
    videoConsultationFee: 1251,
  },
  {
    treatmentType: TreatmentType.THERAPY,
    aliasTreatmentTypes: [TreatmentType.SURGERY],
    label: 'Procedural Care',
    description: 'Combined therapeutic and surgical procedure workflow',
    treatmentFamily: 'GENERAL',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PROCEDURAL_CARE',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.LAB_TEST,
    label: 'Diagnostic',
    description: 'Combined diagnostic, imaging, and preventive care workflow',
    treatmentFamily: 'GENERAL',
    category: AppointmentServiceCategory.DIAGNOSIS,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'DIAGNOSTIC',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.SPECIAL_CASE,
    label: 'Special Case',
    description: 'Complex, sensitive, or unusual consultation that needs tailored handling',
    treatmentFamily: 'GENERAL',
    category: AppointmentServiceCategory.CONSULTATION,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'SPECIAL_CASE',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
    videoConsultationFee: 1251,
  },
  {
    treatmentType: TreatmentType.GERIATRIC_CARE,
    label: 'Senior Citizen',
    description: 'Care pathway tailored for senior citizens and older adults',
    treatmentFamily: 'GENERAL',
    category: AppointmentServiceCategory.CONSULTATION,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'SENIOR_CITIZEN',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
    videoConsultationFee: 1251,
  },
  {
    treatmentType: TreatmentType.VIDDHAKARMA,
    label: 'Viddhakarma',
    description: 'Therapeutic puncture-based Ayurvedic procedural care',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.SURGERY,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'VIDDHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.AGNIKARMA,
    label: 'Agnikarma',
    description: 'Therapeutic heat procedure for musculoskeletal pain relief',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.SURGERY,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'AGNIKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.PANCHAKARMA,
    label: 'Panchakarma Therapy',
    description: 'Traditional detoxification and rejuvenation treatment',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PANCHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.NADI_PARIKSHA,
    label: 'Nadi Pariksha',
    description: 'Traditional pulse diagnosis to assess dosha imbalances',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.DIAGNOSIS,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'DIAGNOSIS',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
  },
  {
    treatmentType: TreatmentType.DOSHA_ANALYSIS,
    label: 'Dosha Analysis',
    description: 'Combined Ayurvedic procedure workflow including dosha analysis',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.DIAGNOSIS,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'AYURVEDIC_PROCEDURES',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
    videoConsultationFee: 1200,
  },
  {
    treatmentType: TreatmentType.SHIRODHARA,
    label: 'Shirodhara',
    description: 'Continuous oil flow on the forehead for stress and anxiety care',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'SHIRODHARA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.VIRECHANA,
    label: 'Virechana',
    description: 'Therapeutic purgation as part of Panchakarma care',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PANCHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.ABHYANGA,
    label: 'Abhyanga',
    description: 'Full-body Ayurvedic therapeutic oil massage',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'ABHYANGA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.SWEDANA,
    label: 'Swedana',
    description: 'Herbal steam therapy for detoxification and relaxation',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'SWEDANA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.BASTI,
    label: 'Basti',
    description: 'Therapeutic medicated enema under Ayurvedic care plan',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PANCHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.NASYA,
    label: 'Nasya',
    description: 'Nasal administration therapy as part of Ayurvedic treatment',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PANCHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.RAKTAMOKSHANA,
    label: 'Raktamokshana',
    description: 'Therapeutic bloodletting procedure under supervised care',
    treatmentFamily: 'AYURVEDA',
    category: AppointmentServiceCategory.SURGERY,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'SURGICAL',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
] as const;

export function cloneTreatmentCatalogEntry(entry: TreatmentCatalogEntry): TreatmentCatalogEntry {
  return {
    ...entry,
    appointmentModes: [...entry.appointmentModes],
    ...(entry.aliasTreatmentTypes ? { aliasTreatmentTypes: [...entry.aliasTreatmentTypes] } : {}),
  };
}

export function resolveCatalogTreatmentType(
  treatmentType?: TreatmentType | string | null
): string | null {
  const normalized = String(treatmentType || '')
    .trim()
    .toUpperCase();

  if (!normalized) {
    return treatmentType ?? null;
  }

  // SURGERY is intentionally NOT remapped to THERAPY here.
  // The THERAPY catalog entry carries aliasTreatmentTypes: [SURGERY] so the
  // lookup functions below resolve SURGERY via the alias chain. Removing this
  // remap prevents a dedicated SURGERY entry from being silently swallowed
  // if one is ever added to the catalog.
  return normalized;
}

export function findTreatmentCatalogEntry(
  treatmentType?: TreatmentType | string | null
): TreatmentCatalogEntry {
  const normalizedTreatmentType = resolveCatalogTreatmentType(treatmentType);

  return (
    APPOINTMENT_SERVICE_CATALOG.find(
      service =>
        String(service.treatmentType) === String(normalizedTreatmentType) ||
        service.aliasTreatmentTypes?.some(
          alias => String(alias) === String(normalizedTreatmentType)
        )
    ) || APPOINTMENT_SERVICE_CATALOG[0]!
  );
}

export function findTreatmentCatalogEntryOrUndefined(
  treatmentType?: TreatmentType | string | null
): TreatmentCatalogEntry | undefined {
  const normalizedTreatmentType = resolveCatalogTreatmentType(treatmentType);
  return APPOINTMENT_SERVICE_CATALOG.find(
    service =>
      String(service.treatmentType) === String(normalizedTreatmentType) ||
      service.aliasTreatmentTypes?.some(alias => String(alias) === String(normalizedTreatmentType))
  );
}

export function isAyurvedaTreatmentType(treatmentType?: TreatmentType | string | null): boolean {
  return findTreatmentCatalogEntryOrUndefined(treatmentType)?.treatmentFamily === 'AYURVEDA';
}

export function getAppointmentTreatmentCatalog(): TreatmentCatalogEntry[] {
  return APPOINTMENT_SERVICE_CATALOG.map(cloneTreatmentCatalogEntry);
}

export function buildAppointmentTreatmentCategoryGroups(): TreatmentCatalogGroup[] {
  const categoryOrder: AppointmentServiceCategory[] = [
    AppointmentServiceCategory.CONSULTATION,
    AppointmentServiceCategory.DIAGNOSIS,
    AppointmentServiceCategory.TREATMENT,
    AppointmentServiceCategory.SURGERY,
    AppointmentServiceCategory.THERAPY,
    AppointmentServiceCategory.COUNSELING,
  ];

  return categoryOrder
    .map(category => {
      const filters = APPOINTMENT_SERVICE_CATALOG.filter(
        service => service.category === category
      ).map(service => ({
        value: service.treatmentType,
        label: service.label,
        description: service.description,
        ...(service.aliasTreatmentTypes ? { aliases: [...service.aliasTreatmentTypes] } : {}),
      }));

      if (!filters.length) {
        return undefined;
      }

      return {
        key: `category:${String(category).toLowerCase()}`,
        label: CATEGORY_LABELS[category],
        description: `${CATEGORY_LABELS[category]} services across the unified appointment taxonomy.`,
        filters,
      } as TreatmentCatalogGroup;
    })
    .filter((group): group is TreatmentCatalogGroup => !!group);
}

export function buildAppointmentTreatmentFilterGroup(): TreatmentCatalogGroup {
  return {
    key: 'treatments',
    label: 'Treatments',
    description: 'Clinical and Ayurvedic treatment intent for appointments.',
    filters: APPOINTMENT_SERVICE_CATALOG.map(service => ({
      value: service.treatmentType,
      label: service.label,
      description: service.description,
      ...(service.aliasTreatmentTypes ? { aliases: [...service.aliasTreatmentTypes] } : {}),
    })),
  };
}

const FOLLOW_UP_TEMPLATE_GROUP_MATCHERS: readonly {
  key: string;
  label: string;
  description: string;
  matches: (entry: TreatmentCatalogEntry) => boolean;
}[] = [
  {
    key: 'followup:routine',
    label: 'Routine Follow-up',
    description: 'Follow-up workflow for consultation and review appointments.',
    matches: entry => entry.category === AppointmentServiceCategory.CONSULTATION,
  },
  {
    key: 'followup:procedure',
    label: 'Post-Procedure Follow-up',
    description: 'Follow-up workflow for surgical and procedural recovery.',
    matches: entry => entry.category === AppointmentServiceCategory.SURGERY,
  },
  {
    key: 'followup:therapy',
    label: 'Therapy Follow-up',
    description: 'Follow-up workflow for general therapy and treatment-based care plans.',
    matches: entry =>
      entry.category === AppointmentServiceCategory.TREATMENT &&
      entry.treatmentFamily === 'GENERAL',
  },
  {
    key: 'followup:ayurveda',
    label: 'Ayurvedic Recovery Follow-up',
    description: 'Follow-up workflow for Ayurvedic treatment programs and Panchakarma recovery.',
    matches: entry =>
      entry.treatmentFamily === 'AYURVEDA' &&
      entry.category === AppointmentServiceCategory.TREATMENT,
  },
  {
    key: 'followup:ayurvedic-procedures',
    label: 'Ayurvedic Procedure Follow-up',
    description: 'Follow-up workflow for Ayurvedic diagnostic and procedural sessions.',
    matches: entry =>
      entry.treatmentFamily === 'AYURVEDA' &&
      entry.category !== AppointmentServiceCategory.TREATMENT,
  },
];

export function buildFollowUpTemplateTreatmentGroups(): TreatmentCatalogGroup[] {
  return FOLLOW_UP_TEMPLATE_GROUP_MATCHERS.map(group => {
    const filters = APPOINTMENT_SERVICE_CATALOG.filter(group.matches).map(entry => ({
      value: entry.treatmentType,
      label: entry.label,
      description: entry.description,
      ...(entry.aliasTreatmentTypes ? { aliases: [...entry.aliasTreatmentTypes] } : {}),
    }));

    return {
      key: group.key,
      label: group.label,
      description: group.description,
      filters,
    };
  });
}
