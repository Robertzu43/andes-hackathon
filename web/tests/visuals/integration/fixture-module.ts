import type { VisualModule } from '../../../src/visuals/integration/contract.ts';

/** Synthetic lifecycle probe, deliberately not a substitute for Hairline or Anatomy. */
export const mountVisual: VisualModule['mountVisual'] = (host, context) => {
  const doc = host.ownerDocument;
  const view = doc.defaultView!;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 400 180');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', context.locale === 'es' ? 'Prueba de una ilustración opcional' : 'Teste de uma ilustração opcional');
  svg.innerHTML = '<rect x="126" y="12" width="148" height="154" rx="18" fill="#f2f6f6" stroke="#173139" stroke-width="2"/><rect x="140" y="28" width="120" height="110" rx="8" fill="#fcfdfd" stroke="#4d6268"/><circle cx="200" cy="152" r="5" fill="#173139"/>';
  const button = doc.createElement('button');
  button.textContent = context.locale === 'es' ? 'Cambiar ejemplo estático' : 'Mudar exemplo estático';
  host.append(svg, button);
  host.dataset.frames = '0';
  host.dataset.steps = '0';
  let frame = 0, disposed = false, frames = 0, steps = 0;
  const tick = () => {
    host.dataset.frames = String(++frames);
    frame = view.requestAnimationFrame(tick);
  };
  const step = () => { host.dataset.steps = String(++steps); };
  button.addEventListener('click', step);
  const instance = {
    setMotion(motion: 'still' | 'interactive') {
      view.cancelAnimationFrame(frame); frame = 0;
      if (!disposed && motion === 'interactive') frame = view.requestAnimationFrame(tick);
      host.dataset.motion = motion;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      view.cancelAnimationFrame(frame);
      button.removeEventListener('click', step);
      context.signal.removeEventListener('abort', instance.destroy);
      host.dataset.destroyed = 'true';
      host.replaceChildren();
    },
  };
  context.signal.addEventListener('abort', instance.destroy, { once: true });
  instance.setMotion(context.motion);
  return instance;
};
