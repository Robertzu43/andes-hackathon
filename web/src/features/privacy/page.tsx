import type { ReactNode } from 'react';
import { useMessages } from '../../foundation/index.ts';
import { contactMessages } from '../contacts/messages.ts';

export function PrivacyContent({ children }: { children: ReactNode }) {
  const t = useMessages(contactMessages);
  return <><section className="andes-section"><h2>{t('sharedData')}</h2><p>{t('sharedDataBody')}</p><p className="andes-hint">{t('recipientLimit')}</p></section>
    {children}<section className="andes-section andes-secondary-section"><h2>{t('optional')}</h2>
      <p>{t('optionalBody')}</p><p className="andes-hint">{t('unsupported')}</p></section></>;
}
