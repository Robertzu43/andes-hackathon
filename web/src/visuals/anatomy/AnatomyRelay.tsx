import { useEffect, useRef } from 'react';
import { mountVisual, renderRelay } from './index.mjs';

export interface AnatomyRelayProps {
  locale: 'es' | 'pt-BR';
  motion?: 'still' | 'interactive';
}

/** Lazy-load this optional help figure after primary trip actions. */
export function AnatomyRelay({ locale, motion = 'still' }: AnatomyRelayProps) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<ReturnType<typeof mountVisual> | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const controller = new AbortController();
    instance.current = mountVisual(host.current, { locale, motion: 'still', signal: controller.signal });
    return () => { controller.abort(); instance.current = null; };
  }, [locale]);
  useEffect(() => { instance.current?.setMotion(motion); }, [motion, locale]);
  return <div ref={host} dangerouslySetInnerHTML={{ __html: renderRelay(locale) }} />;
}

export default AnatomyRelay;
