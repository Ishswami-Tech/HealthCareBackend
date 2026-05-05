export function formatCurrencyFromMinorUnits(
  amount: number,
  currency = 'INR',
  locale = 'en-IN'
): string {
  const normalizedAmount = Number.isFinite(amount) ? amount / 100 : 0;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalizedAmount);
}
