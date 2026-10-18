import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLocale, message, readLanguageChoice, saveLanguageChoice, type Locale, type MessageKey } from './messages.ts';

type Language = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey) => string };
const Context = createContext<Language | null>(null);
function storedChoice(): Locale {
  try { return readLanguageChoice(window.localStorage); } catch { return 'es'; }
}
export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setValue] = useState<Locale>(initialLocale ?? storedChoice);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo<Language>(() => ({ locale, t: key => message(locale, key), setLocale(next) {
    if (!isLocale(next)) return;
    setValue(next);
    try { saveLanguageChoice(next, window.localStorage); } catch { /* Private browsing may deny storage. */ }
  } }), [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n(): Language {
  const context = useContext(Context);
  if (!context) throw new Error('I18nProvider is required');
  return context;
}
export function useMessages<K extends string>(dictionary: Record<Locale, Readonly<Record<K, string>>>) {
  const { locale } = useI18n();
  return (key: K): string => dictionary[locale][key];
}
export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return <label className="andes-language"><span>{t('language')}</span>
    <select value={locale} onChange={e => { if (isLocale(e.target.value)) setLocale(e.target.value); }}>
      <option value="es">Español</option><option value="pt-BR">Português (BR)</option>
    </select>
  </label>;
}
