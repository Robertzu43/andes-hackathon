import { ART } from './art.mjs';
import { COPY, SCENARIOS, exampleOf, factsOf } from './model.mjs';
import { renderRelay } from './render.mjs';
export { renderRelay } from './render.mjs';

/** Mount only into a dedicated owned host. Never accepts live trip state. */
export function mountVisual(host, { locale = 'es', motion = 'still', signal } = {}) {
  const copy = COPY[locale];
  if (!copy) throw new RangeError('Unsupported relay locale');
  if (!['still', 'interactive'].includes(motion)) throw new RangeError('Unsupported relay motion');
  if (signal?.aborted) return { setMotion() {}, destroy() {} };
  host.innerHTML = renderRelay(locale);
  const root = host.querySelector('.andes-relay');
  // Keep the complete, unenhanced explanation when visibility or motion
  // preferences cannot be observed. Acquire no listeners in this fallback.
  if (typeof globalThis.matchMedia !== 'function' || typeof globalThis.IntersectionObserver !== 'function') {
    return { setMotion() {}, destroy() {} };
  }
  const own = new AbortController();
  const listen = { signal: own.signal };
  let media = null, observer = null;
  let mode = motion, selected = 'local', visible = false, frame = 0, last = 0, destroyed = false;
  const pose = { dispatch: 0, carriage: 0, flag: 0 };
  const moving = [...root.querySelectorAll('[data-relay-motion]')].filter(n => n.dataset.relayMotion !== 'fixed');
  const artNodes = new Map([...root.querySelectorAll('[data-relay-part]')].map(node => [node.dataset.relayPart, node]));
  let order = ART.order.map(part => part.name).join(',');
  const buttons = [...root.querySelectorAll('[data-example]')];
  const paint = () => {
    for (const node of moving) {
      const part = node.dataset.relayMotion, [x, y] = ART.vectors[part], share = pose[part];
      node.setAttribute('transform', `translate(${x * share} ${y * share})`);
    }
    const sorted = [...ART.order].sort((a, b) => (a.key + a.lift * (pose[a.piece] ?? 0)) - (b.key + b.lift * (pose[b.piece] ?? 0)));
    const next = sorted.map(part => part.name).join(',');
    if (next !== order) {
      const fragment = document.createDocumentFragment();
      for (const part of sorted) fragment.append(artNodes.get(part.name));
      root.querySelector('svg').append(fragment); order = next;
    }
  };
  const cancel = () => { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; };
  const snap = () => { const target = exampleOf(selected); for (const key of Object.keys(pose)) pose[key] = target[key]; paint(); cancel(); };
  const canMove = () => !destroyed && mode === 'interactive' && visible && !document.hidden && media && !media.matches;
  function tick(now) {
    frame = 0;
    if (!canMove()) { snap(); return; }
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    const target = exampleOf(selected);
    let settled = true;
    for (const key of Object.keys(pose)) {
      pose[key] += (target[key] - pose[key]) * (1 - Math.exp(-dt / .055));
      if (Math.abs(target[key] - pose[key]) < .005) pose[key] = target[key]; else settled = false;
    }
    paint();
    if (!settled) frame = requestAnimationFrame(tick); else last = 0;
  }
  function choose(name) {
    const example = exampleOf(name), i = SCENARIOS.indexOf(name);
    selected = name;
    root.dataset.relayExample = name;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.example === name)));
    root.querySelector('[data-readout]').textContent = copy.headings[i];
    root.querySelector('[data-relay-heading]').textContent = copy.headings[i];
    root.querySelector('[data-relay-detail]').textContent = copy.details[i];
    root.querySelector('[data-relay-source]').textContent = copy.sources[i];
    factsOf(example, copy).forEach((value, index) => { root.querySelector(`[data-relay-fact="${index}"]`).textContent = value; });
    root.querySelector('[data-relay-announcement]').textContent = `${copy.demo}. ${copy.headings[i]}. ${copy.details[i]}`;
    if (!canMove()) snap(); else if (!frame) frame = requestAnimationFrame(tick);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; cancel(); own.abort();
    signal?.removeEventListener('abort', destroy);
    try { observer?.disconnect(); } finally {
      snap();
      root.querySelector('[data-relay-controls]').hidden = true;
      root.querySelector('[data-relay-explanation]').hidden = true;
      root.querySelector('[data-relay-static]').hidden = false;
    }
  }
  const handle = {
    setMotion(next) {
      if (!['still', 'interactive'].includes(next)) throw new RangeError('Unsupported relay motion');
      if (destroyed) return;
      mode = next; if (mode === 'still') snap();
    },
    destroy,
  };
  try {
    // Install the caller's cleanup before any module listener or observer.
    signal?.addEventListener('abort', destroy, { once: true });
    media = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    for (const button of buttons) button.addEventListener('click', () => choose(button.dataset.example), listen);
    root.querySelector('[data-relay-controls]').addEventListener('keydown', event => {
      const here = buttons.indexOf(document.activeElement);
      if (here < 0) return;
      const next = { ArrowRight: (here + 1) % 4, ArrowDown: (here + 1) % 4, ArrowLeft: (here + 3) % 4, ArrowUp: (here + 3) % 4, Home: 0, End: 3 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); buttons[next].focus(); choose(buttons[next].dataset.example);
    }, listen);
    const visibility = () => { if (!canMove()) snap(); };
    document.addEventListener('visibilitychange', visibility, listen);
    media.addEventListener('change', visibility, listen);
    observer = new globalThis.IntersectionObserver(entries => {
      visible = entries[entries.length - 1].isIntersecting;
      if (!visible) snap();
    });
    observer.observe(root.querySelector('svg'));
    // An instrumented host may abort synchronously while setup is running.
    if (destroyed || signal?.aborted) { observer.disconnect(); destroy(); return handle; }
    root.querySelector('[data-relay-controls]').hidden = false;
    root.querySelector('[data-relay-explanation]').hidden = false;
    root.querySelector('[data-relay-static]').hidden = true;
    root.dataset.relayExample = selected;
  } catch {
    destroy();
  }
  return handle;
}
