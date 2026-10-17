/* Local synthetic previews only. Measurements support review; they never grant acceptance. */
(() => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new Error('Use this probe only on an isolated localhost synthetic preview');
  }
  window.andesVisualProbe?.destroy();
  const nativeRaf = window.requestAnimationFrame;
  const nativeCancel = window.cancelAnimationFrame;
  const pending = new Set();
  let callbacks = 0;
  let callbackMs = 0;
  let mutations = 0;
  let observer;
  let root;
  let scope;
  let destroyed = false;
  const wrappedRaf = function (callback) {
    const id = nativeRaf.call(window, (time) => {
      pending.delete(id);
      callbacks++;
      const start = performance.now();
      try { callback(time); } finally { callbackMs += performance.now() - start; }
    });
    pending.add(id);
    return id;
  };
  const wrappedCancel = function (id) {
    pending.delete(id);
    return nativeCancel.call(window, id);
  };
  window.requestAnimationFrame = wrappedRaf;
  window.cancelAnimationFrame = wrappedCancel;
  const rect = (element) => {
    const r = element.getBoundingClientRect();
    return Object.fromEntries(['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']
      .map((key) => [key, Math.round(r[key] * 100) / 100]));
  };
  const rendered = (element) => {
    if (!element.getClientRects().length) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const identity = (element) => element.id ? `#${element.id}` : element.tagName.toLowerCase();
  const viewportBounds = () => {
    const v = window.visualViewport;
    const left = v?.offsetLeft ?? 0;
    const top = v?.offsetTop ?? 0;
    return { left, top, right: left + (v?.width ?? innerWidth), bottom: top + (v?.height ?? innerHeight) };
  };
  // A naming hint, not the browser accessibility tree or the accessible-name algorithm.
  const nameHint = (element) => {
    const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    return (labelled || element.getAttribute('aria-label') ||
      [...(element.labels || [])].map((label) => label.textContent).join(' ').trim() ||
      element.textContent?.trim() || element.getAttribute('alt') || '').slice(0, 120);
  };
  const controlData = (element) => {
    const box = rect(element);
    const style = getComputedStyle(element);
    const visible = rendered(element);
    const view = viewportBounds();
    const fullyInViewport = visible && box.width > 0 && box.height > 0 && box.left >= view.left && box.top >= view.top &&
      box.right <= view.right && box.bottom <= view.bottom;
    const points = [[.5, .5], [.1, .1], [.9, .1], [.1, .9], [.9, .9]];
    const hitPoints = fullyInViewport ? points.map(([x, y]) => {
      const hit = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
      return !!hit && (element === hit || element.contains(hit));
    }) : [];
    return {
      element: identity(element), nameHint: nameHint(element), box, rendered: visible,
      fullyInViewport, hitPoints, target44: box.width >= 44 && box.height >= 44,
      target56: box.width >= 56 && box.height >= 56,
      disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
      tabIndex: element.tabIndex, touchAction: style.touchAction,
      focused: document.activeElement === element,
      focusStyle: { outline: style.outline, outlineOffset: style.outlineOffset, boxShadow: style.boxShadow },
    };
  };
  function observe(selector) {
    const nextRoot = document.querySelector(selector);
    if (!nextRoot) throw new Error(`Missing review scope: ${selector}`);
    observer?.disconnect();
    root = nextRoot;
    scope = selector;
    mutations = 0;
    observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
  }
  function snapshot({ primarySelector } = {}) {
    if (destroyed || !root?.isConnected) throw new Error('Observe a connected review scope first');
    const primary = primarySelector ? document.querySelector(primarySelector) : null;
    const controlSelector = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=slider],[tabindex]';
    const controls = [...(root.matches(controlSelector) ? [root] : []), ...root.querySelectorAll(controlSelector)];
    const box = rect(root);
    const view = viewportBounds();
    return {
      schemaVersion: 1, observedAt: new Date().toISOString(), scope,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      layoutViewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      visualViewport: window.visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale } : null,
      geometryMeasurable: view.right > view.left && view.bottom > view.top,
      lang: document.documentElement.lang,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      visibility: document.visibilityState,
      pageOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      scopeBox: box, scopeRendered: rendered(root),
      scopeInViewport: rendered(root) && box.bottom > view.top && box.top < view.bottom && box.right > view.left && box.left < view.right,
      scopeOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
      controls: controls.filter(rendered).map(controlData),
      primary: primary ? controlData(primary) : null,
      primaryMissing: !!primarySelector && !primary,
      runningAnimations: root.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').map((a) => ({
        target: a.effect?.target ? identity(a.effect.target) : null,
        duration: a.effect?.getTiming().duration, iterations: String(a.effect?.getTiming().iterations),
      })),
      frames: { callbacks, callbackMs: Math.round(callbackMs * 100) / 100, pending: pending.size },
      mutations,
      limitations: [
        'RAF counters are page-wide and only include calls made after installation; pre-bound schedulers can escape them',
        'Zero callbacks/mutations does not prove zero CPU, timers, listeners, memory leaks or GPU work',
        'Name hints and focus CSS require accessibility-tree and visual inspection; hit points are samples',
        'CSS clipping, content truth, source provenance and keyboard/touch outcomes require independent review',
      ],
    };
  }
  async function sample(options = {}) {
    const durationMs = options.durationMs ?? 800;
    if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 5000) throw new Error('Sample duration must be 100–5000 ms');
    const before = snapshot(options);
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const after = snapshot(options);
    return { before, after, delta: {
      elapsedMs: Math.round(performance.now() - start), callbacks: after.frames.callbacks - before.frames.callbacks,
      callbackMs: Math.round((after.frames.callbackMs - before.frames.callbackMs) * 100) / 100,
      mutations: after.mutations - before.mutations,
    } };
  }
  window.andesVisualProbe = {
    observe, snapshot, sample,
    destroy() {
      destroyed = true;
      observer?.disconnect();
      // Never cancel application work. Pending wrappers drain normally after restoration.
      if (window.requestAnimationFrame === wrappedRaf) window.requestAnimationFrame = nativeRaf;
      if (window.cancelAnimationFrame === wrappedCancel) window.cancelAnimationFrame = nativeCancel;
    },
  };
})();
