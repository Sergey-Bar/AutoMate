import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import he from '../locales/he.json';

const LANGUAGE_STORAGE_KEY = 'automate_lang';

function getStoredLanguage() {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? 'en';
  } catch {
    return 'en';
  }
}

function applyDocumentLanguage(lng: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.dir = lng === 'he' ? 'rtl' : 'ltr';
  document.documentElement.lang = lng;
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
  },
  lng: getStoredLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

applyDocumentLanguage(i18n.language);

i18n.on('languageChanged', (lng) => {
  applyDocumentLanguage(lng);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // ignore storage failures in private mode/tests
  }
});

export default i18n;
