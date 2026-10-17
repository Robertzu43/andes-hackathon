import { useEffect, useId, useMemo, useRef } from 'react';
import type { VisualCopy, VisualKind, VisualLocale, VisualModule } from './contract.ts';
import { mountVisualHost } from './host.ts';
import { visualShell } from './shell.ts';
import './visual.css';

export interface OptionalVisualProps {
  locale: VisualLocale;
  kind: VisualKind;
  /** Keep this callback stable; use a literal import of a reviewed figure module. */
  load: () => Promise<VisualModule>;
  copy?: VisualCopy;
  id?: string;
  loadTimeoutMs?: number;
}

/** Render the text shell first, then enhance it within the owning React lifecycle. */
export function OptionalVisual({ locale, kind, load, copy, id, loadTimeoutMs }: OptionalVisualProps) {
  const generated = useId();
  const identifier = id ?? `visual-${generated.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const wrapper = useRef<HTMLDivElement>(null);
  const markup = useMemo(() => visualShell({ id: identifier, locale, kind, copy }), [identifier, locale, kind, copy]);
  // Keep React from replacing imperative artwork on unrelated parent renders.
  const content = useMemo(() => ({ __html: markup }), [markup]);

  useEffect(() => {
    const root = wrapper.current?.firstElementChild as HTMLElement | null;
    if (!root) return;
    const host = mountVisualHost(root, { locale, kind, load, copy, loadTimeoutMs });
    return () => host.destroy();
  }, [markup, locale, kind, load, copy, loadTimeoutMs]);

  return <div ref={wrapper} dangerouslySetInnerHTML={content} />;
}
