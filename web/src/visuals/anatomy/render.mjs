import { COPY, SCENARIOS, exampleOf, factsOf } from './model.mjs';
import { ART } from './art.mjs';
import { CSS } from './styles.mjs';

export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Static fallback is complete before JavaScript: all four sourced explanations.
export function renderRelay(locale = 'es') {
  const c = COPY[locale];
  if (!c) throw new RangeError('Unsupported relay locale');
  const facts = factsOf(exampleOf('local'), c);
  return `<section class="andes-relay" lang="${locale}" aria-label="${escape(c.title)}">
    <style>${CSS}</style>
    <p class="ar-kicker">${escape(c.demo)}</p><h2>${escape(c.title)}</h2>
    <p>${escape(c.intro)}</p><p class="ar-muted">${escape(c.parked)}</p>
    <figure><div class="iso-plate">
      <div class="ar-corners"><span>${c.figure}</span><span>${c.instrument}</span></div>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="${escape(c.svg)}">${ART.body}</svg>
      <div class="ar-corners"><span>${c.hint}</span><span data-readout>${c.headings[0]}</span></div>
    </div><figcaption>${escape(c.legend)}</figcaption></figure>
    <div class="ar-controls" data-relay-controls role="group" aria-label="${escape(c.group)}" hidden>
      ${SCENARIOS.map((key, i) => `<button type="button" data-example="${key}" aria-pressed="${i === 0}"><span class="ar-number" aria-hidden="true">0${i + 1}</span>${escape(c.controls[i])}</button>`).join('')}
    </div>
    <div class="ar-explanation" data-relay-explanation hidden>
      <strong data-relay-heading>${escape(c.headings[0])}</strong><p data-relay-detail>${escape(c.details[0])}</p><p class="ar-muted" data-relay-source>${escape(c.sources[0])}</p>
    </div>
    <dl>${c.facts.map((label, i) => `<div class="ar-fact"><dt>${escape(label)}</dt><dd data-relay-fact="${i}">${escape(facts[i])}</dd></div>`).join('')}</dl>
    <ol data-relay-static>${SCENARIOS.map((_, i) => `<li><strong>${escape(c.headings[i])}</strong>${escape(c.details[i])} <span class="ar-muted">${escape(c.sources[i])}</span></li>`).join('')}</ol>
    <p class="ar-muted">${escape(c.caveat)}</p>
    <span data-relay-announcement role="status" aria-live="polite" aria-atomic="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)"></span>
  </section>`;
}
