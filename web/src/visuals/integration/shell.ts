import type { VisualCopy, VisualKind, VisualLocale } from './contract.ts';
import { visualCopy } from './copy.ts';

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));

/** Render before enhancement so explanations survive disabled or failed JavaScript. */
export function visualShell(options: {
  id: string; locale: VisualLocale; kind: VisualKind; copy?: VisualCopy;
}): string {
  const { id, locale, kind } = options;
  if (!/^[A-Za-z][\w-]*$/.test(id)) throw new Error('Use a unique simple visual id');
  const copy = options.copy ?? visualCopy[locale][kind];
  return `<figure class="andes-visual" lang="${locale}" data-visual="${kind}"
    aria-labelledby="${id}-title" aria-describedby="${id}-caption">
    <h3 id="${id}-title">${escape(copy.title)}</h3>
    <div data-visual-stage hidden></div>
    <p data-visual-fallback>${escape(copy.fallback)}</p>
    <figcaption>
      <p id="${id}-caption">${escape(copy.caption)}</p>
      <ul>${copy.facts.map(fact => `<li>${escape(fact)}</li>`).join('')}</ul>
      <p class="andes-visual__parked">${escape(copy.parked)}</p>
    </figcaption>
    <div class="andes-visual__controls" data-visual-controls hidden>
      <button type="button" data-visual-explore>${escape(copy.explore)}</button>
      <button type="button" data-visual-motion hidden>${escape(copy.enableMotion)}</button>
    </div>
    <p class="andes-visual__status" data-visual-status role="status" aria-atomic="true"></p>
  </figure>`;
}
