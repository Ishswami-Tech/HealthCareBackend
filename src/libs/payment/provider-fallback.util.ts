/**
 * Which payment providers may open an order for a clinic.
 *
 * Only providers the clinic itself configured (its primary, then its own fallbacks, in that
 * order) and that are enabled with usable credentials are eligible. Providers that are merely
 * enabled in the server environment (`source: 'environment'`, appended by PaymentConfigService
 * so existing orders on them can still be verified) are never used to open a NEW order: an order
 * on a provider the clinic has not configured is not settled to the clinic and its callback names
 * a different order id.
 */
import type {
  ClinicPaymentConfig,
  PaymentProvider,
  PaymentProviderConfig,
} from '@core/types/payment.types';

export type ProviderExclusionReason =
  'not_configured_for_clinic' | 'environment_only' | 'disabled' | 'missing_credentials';

export interface ProviderExclusion {
  provider: PaymentProvider;
  reason: ProviderExclusionReason;
}

export interface ProviderCandidateSelection {
  /** Eligible providers, in the order they are tried. */
  candidates: PaymentProviderConfig[];
  /** Providers not tried, and why (for logs / the error message). */
  excluded: ProviderExclusion[];
}

/** At least one non-empty plain credential, or an encrypted blob. */
export function hasUsableCredentials(config: PaymentProviderConfig): boolean {
  const credentials = (config.credentials || {}) as Record<string, unknown>;
  return Object.values(credentials).some(
    value => typeof value === 'string' && value.trim().length > 0
  );
}

/** The provider entry came from the server environment, not from the clinic's own config. */
export function isEnvironmentOnlyProvider(config: PaymentProviderConfig): boolean {
  return config.source === 'environment';
}

function orderedEntries(config: ClinicPaymentConfig): PaymentProviderConfig[] {
  const seen = new Set<PaymentProvider>();
  return [config.payment.primary, ...(config.payment.fallback || [])].flatMap(entry => {
    if (!entry || seen.has(entry.provider)) {
      return [];
    }
    seen.add(entry.provider);
    return [entry];
  });
}

/**
 * The providers to try, in order, when opening an order for the clinic. With `requested` only
 * that provider is considered (strict: never swapped for another one).
 */
export function selectPaymentProviderCandidates(
  config: ClinicPaymentConfig,
  requested?: PaymentProvider
): ProviderCandidateSelection {
  const entries = orderedEntries(config);
  const considered = requested ? entries.filter(entry => entry.provider === requested) : entries;
  const excluded: ProviderExclusion[] = [];
  if (requested && considered.length === 0) {
    excluded.push({ provider: requested, reason: 'not_configured_for_clinic' });
  }

  const candidates = considered.filter(entry => {
    const reason: ProviderExclusionReason | null = isEnvironmentOnlyProvider(entry)
      ? 'environment_only'
      : !entry.enabled
        ? 'disabled'
        : !hasUsableCredentials(entry)
          ? 'missing_credentials'
          : null;
    if (reason) {
      excluded.push({ provider: entry.provider, reason });
      return false;
    }
    return true;
  });

  return { candidates, excluded };
}

/** One readable line for an empty selection, safe to return to the caller (no ids). */
export function describeNoEligibleProvider(
  selection: ProviderCandidateSelection,
  requested?: PaymentProvider
): string {
  const details = selection.excluded.map(item => `${item.provider}: ${item.reason}`).join(', ');
  const subject = requested
    ? `The requested payment provider "${requested}" is not available for this clinic`
    : 'No payment provider is enabled for this clinic';
  return `${subject}${details ? ` (${details})` : ''}. Configure and enable a provider in the clinic payment settings.`;
}
