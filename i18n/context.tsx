import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, useContext, useEffect, useState } from 'react';

import { FALLBACK_LANGUAGE, Language, translations } from './translations';

const STORAGE_KEY = 'vestro-language';

// No saved preference yet (first launch): match the phone's language when
// Vestro supports it, otherwise fall back to English rather than assuming
// French — e.g. a Portuguese-speaking phone should land on English, not French.
function detectDeviceLanguage(): Language {
  const deviceCode = getLocales()[0]?.languageCode;
  return deviceCode && deviceCode in translations ? (deviceCode as Language) : FALLBACK_LANGUAGE;
}

type TranslationVars = Record<string, string | number>;

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  );
}

export type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: keyof (typeof translations)['fr'], vars?: TranslationVars) => string;
  /** For plural-sensitive strings: picks `${key}_one` below 2, else `${key}_other`. */
  tPlural: (key: string, count: number, vars?: TranslationVars) => string;
  /** Category values are runtime strings (stored data), not statically known keys. */
  tCategory: (category: string) => string;
  /** Color palette labels are runtime strings (stored data) too. */
  tColor: (label: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectDeviceLanguage);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved && saved in translations) setLanguageState(saved as Language);
    });
  }, []);

  function setLanguage(next: Language) {
    setLanguageState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }

  function t(key: keyof (typeof translations)['fr'], vars?: TranslationVars): string {
    const template = translations[language][key];
    return interpolate(template, vars);
  }

  function tPlural(key: string, count: number, vars?: TranslationVars): string {
    const suffix = count < 2 ? '_one' : '_other';
    const dict = translations[language] as Record<string, string>;
    const template = dict[`${key}${suffix}`] ?? dict[`${key}_other`] ?? key;
    return interpolate(template, { count, ...vars });
  }

  function tCategory(category: string): string {
    const dict = translations[language] as Record<string, string>;
    return dict[`categories.${category}`] ?? category;
  }

  function tColor(label: string): string {
    const dict = translations[language] as Record<string, string>;
    return dict[`colors.${label}`] ?? label;
  }

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, tPlural, tCategory, tColor }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within an I18nProvider');
  return context;
}
