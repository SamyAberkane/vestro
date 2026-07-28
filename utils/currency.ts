import type { Language } from '@/i18n/translations';

// English speakers on this app are assumed to be US-based, so they see
// dollars ($49.99) instead of the euro formatting (49,99 €) everyone else
// gets — a display choice only, the underlying stored number is unchanged.
function isUSD(language: Language): boolean {
  return language === 'en';
}

export function formatPrice(amount: number, language: Language): string {
  return isUSD(language) ? `$${amount.toFixed(2)}` : `${amount.toFixed(2).replace('.', ',')} €`;
}

export function formatPriceInput(amount: number | undefined, language: Language): string {
  if (amount === undefined) return '';
  return isUSD(language) ? amount.toString() : amount.toString().replace('.', ',');
}

export function currencySymbol(language: Language): string {
  return isUSD(language) ? '$' : '€';
}

export { isUSD };
