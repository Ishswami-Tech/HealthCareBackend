import { describe, expect, it } from '@jest/globals';
import {
  PaymentProvider,
  type ClinicPaymentConfig,
  type PaymentProviderConfig,
} from '../../../src/libs/core/types/payment.types';
import {
  describeNoEligibleProvider,
  selectPaymentProviderCandidates,
  type ProviderCandidateSelection,
} from '../../../src/libs/payment/provider-fallback.util';

function entry(
  provider: PaymentProvider,
  overrides: Partial<PaymentProviderConfig> = {}
): PaymentProviderConfig {
  return { provider, enabled: true, credentials: { key: 'k' }, ...overrides };
}

function config(
  primary: PaymentProviderConfig,
  fallback: PaymentProviderConfig[] = []
): ClinicPaymentConfig {
  return {
    clinicId: 'clinic-1',
    payment: { primary, fallback },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const providers = (selection: ProviderCandidateSelection): PaymentProvider[] =>
  selection.candidates.map(candidate => candidate.provider);

describe('selectPaymentProviderCandidates', () => {
  it('never falls back to a provider that is only enabled in the server environment', () => {
    const selection = selectPaymentProviderCandidates(
      config(entry(PaymentProvider.CASHFREE), [
        entry(PaymentProvider.PAYU, { source: 'environment' }),
      ])
    );
    expect(providers(selection)).toEqual([PaymentProvider.CASHFREE]);
    expect(selection.excluded).toEqual([
      { provider: PaymentProvider.PAYU, reason: 'environment_only' },
    ]);
  });

  it('keeps the clinic order: primary, then its own enabled fallbacks', () => {
    const selection = selectPaymentProviderCandidates(
      config(entry(PaymentProvider.CASHFREE), [
        entry(PaymentProvider.RAZORPAY),
        entry(PaymentProvider.PHONEPE, { enabled: false }),
        entry(PaymentProvider.ZOHO, { credentials: { key: '  ' } }),
      ])
    );
    expect(providers(selection)).toEqual([PaymentProvider.CASHFREE, PaymentProvider.RAZORPAY]);
    expect(selection.excluded).toEqual([
      { provider: PaymentProvider.PHONEPE, reason: 'disabled' },
      { provider: PaymentProvider.ZOHO, reason: 'missing_credentials' },
    ]);
  });

  it('skips a disabled primary and uses the clinic fallback', () => {
    const selection = selectPaymentProviderCandidates(
      config(entry(PaymentProvider.CASHFREE, { enabled: false }), [entry(PaymentProvider.RAZORPAY)])
    );
    expect(providers(selection)).toEqual([PaymentProvider.RAZORPAY]);
  });

  it('is strict for a requested provider and never swaps it', () => {
    const cfg = config(entry(PaymentProvider.CASHFREE), [entry(PaymentProvider.RAZORPAY)]);
    expect(providers(selectPaymentProviderCandidates(cfg, PaymentProvider.RAZORPAY))).toEqual([
      PaymentProvider.RAZORPAY,
    ]);
    const missing = selectPaymentProviderCandidates(cfg, PaymentProvider.PAYU);
    expect(missing.candidates).toEqual([]);
    expect(missing.excluded).toEqual([
      { provider: PaymentProvider.PAYU, reason: 'not_configured_for_clinic' },
    ]);
    expect(describeNoEligibleProvider(missing, PaymentProvider.PAYU)).toContain(
      'The requested payment provider "payu" is not available for this clinic'
    );
  });

  it('returns no candidate (and a clear message) when nothing is enabled for the clinic', () => {
    const selection = selectPaymentProviderCandidates(
      config(entry(PaymentProvider.CASHFREE, { enabled: false }), [
        entry(PaymentProvider.PAYU, { source: 'environment' }),
      ])
    );
    expect(selection.candidates).toEqual([]);
    const message = describeNoEligibleProvider(selection);
    expect(message).toContain('No payment provider is enabled for this clinic');
    expect(message).toContain('cashfree: disabled');
    expect(message).toContain('payu: environment_only');
  });

  it('dedupes a provider listed as primary and fallback', () => {
    const selection = selectPaymentProviderCandidates(
      config(entry(PaymentProvider.CASHFREE), [entry(PaymentProvider.CASHFREE)])
    );
    expect(providers(selection)).toEqual([PaymentProvider.CASHFREE]);
  });
});
