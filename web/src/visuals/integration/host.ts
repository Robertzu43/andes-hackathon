import type { VisualInstance, VisualMotion, VisualOptions } from './contract.ts';
import { visualCopy } from './copy.ts';

const hosts = new WeakMap<HTMLElement, { destroy(): void }>();

/** Enhance a pre-rendered shell. Never attach this optional host to a trip action. */
export function mountVisualHost(root: HTMLElement, options: VisualOptions): { destroy(): void } {
  hosts.get(root)?.destroy();
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) throw new Error('Visual host needs a browser document');
  const find = <T extends HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing visual shell element: ${selector}`);
    return node;
  };
  const stage = find('[data-visual-stage]');
  const fallback = find('[data-visual-fallback]');
  const controls = find('[data-visual-controls]');
  const explore = find<HTMLButtonElement>('[data-visual-explore]');
  const motionButton = find<HTMLButtonElement>('[data-visual-motion]');
  const status = find('[data-visual-status]');
  const copy = options.copy ?? visualCopy[options.locale][options.kind];
  const query = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const timeout = Math.max(1, options.loadTimeoutMs ?? 12_000);
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let visible = false;
  let enabled = false;
  let instance: VisualInstance | undefined;
  let appliedMotion: VisualMotion = 'still';
  let attempt: { controller: AbortController; timer: number; node: HTMLElement } | undefined;

  function disposeInstance(candidate: VisualInstance | undefined) {
    try { candidate?.destroy(); } catch { /* Text remains usable if figure cleanup fails. */ }
  }

  function resetAttempt() {
    if (!attempt) return;
    attempt.controller.abort();
    view!.clearTimeout(attempt.timer);
    attempt = undefined;
  }

  function fail() {
    if (disposed) return;
    const restoreFocus = stage.contains(doc.activeElement);
    resetAttempt();
    disposeInstance(instance);
    instance = undefined;
    enabled = false;
    appliedMotion = 'still';
    stage.replaceChildren();
    stage.hidden = true;
    stage.removeAttribute('aria-busy');
    fallback.hidden = false;
    motionButton.hidden = true;
    explore.disabled = false;
    explore.textContent = copy.retry;
    status.textContent = copy.unavailable;
    root.dataset.visualState = 'fallback';
    root.dataset.visualMotion = 'still';
    if (restoreFocus) explore.focus();
  }

  function syncMotion() {
    if (disposed || !instance) return;
    // Forget intent when leaving the screen/tab: returning never starts motion by itself.
    if (!visible || doc.hidden || !query || query.matches) enabled = false;
    const next: VisualMotion = enabled ? 'interactive' : 'still';
    if (appliedMotion !== next) {
      try { instance.setMotion(next); } catch { fail(); return; }
      appliedMotion = next;
    }
    motionButton.hidden = !view!.IntersectionObserver || !query || query.matches;
    motionButton.textContent = enabled ? copy.disableMotion : copy.enableMotion;
    root.dataset.visualMotion = next;
    status.textContent = enabled ? copy.moving : copy.still;
  }

  async function load() {
    if (disposed || instance || attempt || doc.hidden) return;
    const controller = new AbortController();
    const node = doc.createElement('div');
    node.className = 'andes-visual__art';
    stage.replaceChildren(node);
    const current = { controller, node, timer: view!.setTimeout(fail, timeout) };
    attempt = current;
    stage.setAttribute('aria-busy', 'true');
    explore.disabled = true;
    status.textContent = copy.loading;
    root.dataset.visualState = 'loading';
    let candidate: VisualInstance | undefined;
    try {
      const module = await options.load();
      if (disposed || attempt !== current) return;
      candidate = await module.mountVisual(node, {
        locale: options.locale, motion: 'still', signal: controller.signal,
      });
      if (disposed || attempt !== current) { disposeInstance(candidate); return; }
      if (!candidate || typeof candidate.setMotion !== 'function' || typeof candidate.destroy !== 'function') {
        throw new Error('Invalid visual lifecycle');
      }
      instance = candidate;
      view!.clearTimeout(current.timer);
      // Keep the successful attempt's signal alive until teardown, not just until import.
      stage.removeAttribute('aria-busy');
      stage.hidden = false;
      fallback.hidden = true;
      explore.disabled = false;
      explore.textContent = copy.explore;
      root.dataset.visualState = 'ready';
      syncMotion();
    } catch {
      if (disposed || attempt !== current) { disposeInstance(candidate); return; }
      if (candidate !== instance) disposeInstance(candidate);
      fail();
    }
  }

  const onExplore = () => {
    if (instance) {
      // The module owns meaningful static keyboard/touch steps, even with reduced motion.
      stage.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')?.focus();
    } else void load();
  };
  const onMotion = () => { enabled = !enabled; syncMotion(); };
  const onVisibility = () => {
    syncMotion();
    if (!doc.hidden && visible && !attempt && !instance && root.dataset.visualState !== 'fallback') void load();
  };
  controls.hidden = false;
  explore.disabled = false;
  explore.textContent = copy.explore;
  motionButton.hidden = true;
  explore.addEventListener('click', onExplore);
  motionButton.addEventListener('click', onMotion);
  doc.addEventListener('visibilitychange', onVisibility);
  query?.addEventListener('change', syncMotion);
  cleanups.push(() => explore.removeEventListener('click', onExplore),
    () => motionButton.removeEventListener('click', onMotion),
    () => doc.removeEventListener('visibilitychange', onVisibility),
    () => query?.removeEventListener('change', syncMotion));

  if (view.IntersectionObserver) {
    const observer = new view.IntersectionObserver(entries => {
      if (disposed) return;
      const latest = entries.filter(entry => entry.target === root).at(-1);
      if (!latest) return;
      visible = latest.isIntersecting && latest.intersectionRatio > 0;
      syncMotion();
      if (visible && !doc.hidden && !instance && !attempt && root.dataset.visualState !== 'fallback') void load();
    }, { rootMargin: '0px', threshold: 0 });
    observer.observe(root);
    cleanups.push(() => observer.disconnect());
  } else {
    // Without observation load only on demand and keep movement disabled.
    motionButton.hidden = true;
  }

  const handle = {
    destroy() {
      if (disposed) return;
      disposed = true;
      cleanups.forEach(cleanup => cleanup());
      resetAttempt();
      disposeInstance(instance);
      instance = undefined;
      stage.replaceChildren();
      stage.hidden = true;
      stage.removeAttribute('aria-busy');
      fallback.hidden = false;
      controls.hidden = true;
      status.textContent = '';
      delete root.dataset.visualState;
      delete root.dataset.visualMotion;
      if (hosts.get(root) === handle) hosts.delete(root);
    },
  };
  hosts.set(root, handle);
  return handle;
}
