import { mountVisualHost } from '../../../src/visuals/integration/host.ts';
import { visualShell } from '../../../src/visuals/integration/shell.ts';
import type { VisualContext, VisualInstance, VisualModule, VisualMotion, VisualOptions } from '../../../src/visuals/integration/contract.ts';

const pause = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Deterministic browser DOM tests for callback batching and races, not device proof. */
export async function runLifecycleTests() {
  const cases: { name: string; passed: boolean; error?: string }[] = [];
  async function check(name: string, exercise: (env: ReturnType<typeof environment>) => Promise<void>) {
    const env = environment();
    try { await exercise(env); cases.push({ name, passed: true }); }
    catch (error) { cases.push({ name, passed: false, error: String(error) }); }
    finally { env.close(); }
  }

  function environment() {
    const originalIO = window.IntersectionObserver;
    const originalMedia = window.matchMedia;
    const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    let hidden = false, reduced = false, disconnected = false;
    let observer: { callback: IntersectionObserverCallback; target?: Element } | undefined;
    const query = new EventTarget();
    Object.defineProperty(query, 'matches', { get: () => reduced });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    class Observer {
      constructor(callback: IntersectionObserverCallback) { observer = { callback }; }
      observe(target: Element) { observer!.target = target; }
      disconnect() { disconnected = true; }
    }
    window.IntersectionObserver = Observer as unknown as typeof IntersectionObserver;
    window.matchMedia = () => query as MediaQueryList;
    const box = document.createElement('div');
    box.innerHTML = visualShell({ id: 'race-test', locale: 'es', kind: 'phone' });
    document.body.append(box);
    const root = box.firstElementChild as HTMLElement;
    let handle: ReturnType<typeof mountVisualHost> | undefined;
    const contexts: VisualContext[] = [];
    const motions: VisualMotion[] = [];
    let imports = 0, destroyed = 0;
    const instance: VisualInstance = { setMotion: motion => { motions.push(motion); }, destroy: () => { destroyed++; } };
    const module: VisualModule = { mountVisual: (_node, context) => { contexts.push(context); return instance; } };
    const start = (override: Partial<VisualOptions> = {}) => {
      handle = mountVisualHost(root, { locale: 'es', kind: 'phone', load: async () => { imports++; return module; }, ...override });
      return handle;
    };
    const button = (name: string) => root.querySelector<HTMLButtonElement>(`[data-visual-${name}]`)!;
    return {
      root, start, button, module, instance, contexts, motions,
      get imports() { return imports; }, get destroyed() { return destroyed; }, get disconnected() { return disconnected; },
      emit(...values: boolean[]) {
        observer?.callback(values.map(visible => ({ target: root, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
      },
      hide(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
      reduce(value: boolean) { reduced = value; query.dispatchEvent(new Event('change')); },
      noObservation() { window.IntersectionObserver = undefined as unknown as typeof IntersectionObserver; },
      noPreference() { window.matchMedia = undefined as unknown as typeof matchMedia; },
      close() {
        handle?.destroy(); box.remove(); window.IntersectionObserver = originalIO; window.matchMedia = originalMedia;
        if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden); else Reflect.deleteProperty(document, 'hidden');
      },
    };
  }

  await check('lazy import uses newest observer entry and never autoplays', async e => {
    e.start(); assert(e.imports === 0, 'offscreen import');
    e.emit(true, false); await pause(); assert(e.imports === 0, 'stale first observer entry used');
    e.emit(false, true); await pause();
    assert(e.root.dataset.visualState === 'ready' && e.contexts[0]?.motion === 'still', 'missing still mount');
    assert(e.motions.length === 0, 'autoplay');
    e.emit(true); assert(Number(e.imports) === 1, 'duplicate import');
  });
  await check('explicit motion stops offscreen and does not resume on return', async e => {
    e.start(); e.emit(true); await pause(); e.button('motion').click();
    assert(e.motions.at(-1) === 'interactive', 'motion was not enabled');
    e.emit(false); assert(e.motions.at(-1) === 'still', 'offscreen motion');
    e.emit(true); assert(e.motions.at(-1) === 'still', 'motion resumed without input');
  });
  await check('reduced-motion changes stop and discard animation intent', async e => {
    e.start(); e.emit(true); await pause(); e.button('motion').click(); e.reduce(true);
    assert(e.motions.at(-1) === 'still' && e.button('motion').hidden, 'reduced-motion not applied');
    e.reduce(false); assert(e.motions.at(-1) === 'still' && !e.button('motion').hidden, 'preference removal autoplays');
  });
  await check('hidden tab defers import and stops motion without automatic restart', async e => {
    e.hide(true); e.start(); e.emit(true); await pause(); assert(e.imports === 0, 'hidden import');
    e.hide(false); await pause(); assert(Number(e.imports) === 1, 'visible tab never loaded');
    e.button('motion').click(); e.hide(true); assert(e.motions.at(-1) === 'still', 'hidden motion');
    e.hide(false); assert(e.motions.at(-1) === 'still', 'tab return autoplays');
  });
  await check('failed import preserves captions and supports an explicit retry', async e => {
    let calls = 0;
    e.start({ load: async () => { if (++calls === 1) throw new Error('network'); return e.module; } });
    e.emit(true); await pause();
    assert(e.root.dataset.visualState === 'fallback', 'failure escaped');
    assert(!e.root.querySelector<HTMLElement>('[data-visual-fallback]')!.hidden, 'fallback missing');
    assert(e.root.querySelector('figcaption')!.textContent!.includes('silencio'), 'caption lost');
    e.emit(true); await pause(); assert(calls === 1, 'failure auto-retried');
    e.button('explore').click(); await pause(); assert(String(e.root.dataset.visualState) === 'ready', 'retry failed');
  });
  await check('unmount during import prevents a late mount', async e => {
    const pending = deferred<VisualModule>();
    const handle = e.start({ load: () => pending.promise }); e.emit(true); handle.destroy();
    pending.resolve(e.module); await pause(); assert(e.contexts.length === 0, 'mounted after unmount');
    assert(e.disconnected, 'observer leaked');
  });
  await check('unmount during async mount aborts immediately and destroys late result', async e => {
    const pending = deferred<VisualInstance>(); let signal: AbortSignal | undefined;
    const handle = e.start({ load: async () => ({ mountVisual: (_node, ctx) => { signal = ctx.signal; return pending.promise; } }) });
    e.emit(true); await pause(); handle.destroy(); assert(signal?.aborted, 'mount not aborted');
    pending.resolve(e.instance); await pause(); assert(e.destroyed === 1, 'late mounted result leaked');
    handle.destroy(); assert(e.destroyed === 1, 'host destroy not idempotent');
  });
  await check('timeout disposes an eventual mount and leaves a retry', async e => {
    const pending = deferred<VisualInstance>();
    e.start({ loadTimeoutMs: 5, load: async () => ({ mountVisual: () => pending.promise }) });
    e.emit(true); await pause(25); assert(e.root.dataset.visualState === 'fallback', 'timeout left loading');
    pending.resolve(e.instance); await pause(); assert(e.destroyed === 1, 'timeout result leaked');
    assert(!e.button('explore').disabled, 'retry disabled');
  });
  await check('async mount rejection aborts resources and removes partial markup', async e => {
    let signal: AbortSignal | undefined;
    e.start({ load: async () => ({ mountVisual: async (node, ctx) => {
      signal = ctx.signal; node.textContent = 'partial'; throw new Error('mount');
    } }) });
    e.emit(true); await pause(); assert(signal?.aborted, 'failed mount not aborted');
    assert(!e.root.textContent!.includes('partial'), 'partial markup leaked');
  });
  await check('remount while loading restores enabled controls and invalidates old callbacks', async e => {
    const pending = deferred<VisualModule>();
    e.start({ load: () => pending.promise }); e.emit(true); e.start();
    assert(!e.button('explore').disabled, 'remount inherited disabled control');
    pending.resolve(e.module); await pause(); assert(e.contexts.length === 0, 'old attempt mounted');
    e.emit(true); await pause(); assert(Number(e.contexts.length) === 1, 'new attempt failed');
  });
  await check('missing observer keeps an explicit static-only path', async e => {
    e.noObservation(); e.start(); await pause(); assert(e.imports === 0, 'no-observer auto import');
    e.button('explore').click(); await pause();
    assert(e.root.dataset.visualState === 'ready' && e.button('motion').hidden, 'no static fallback');
  });
  await check('missing motion preference capability fails closed to stillness', async e => {
    e.noPreference(); e.start(); e.emit(true); await pause();
    assert(e.button('motion').hidden && e.contexts[0]?.motion === 'still', 'unsafe motion default');
  });
  await check('figure motion failures stay local and retain readable fallback', async e => {
    e.instance.setMotion = () => { throw new Error('broken animation'); };
    e.start(); e.emit(true); await pause(); e.button('motion').click();
    assert(e.root.dataset.visualState === 'fallback' && e.destroyed === 1, 'animation failure escaped');
    assert(e.root.dataset.visualMotion === 'still', 'stale motion state after failure');
  });
  await check('a failed focused figure returns keyboard focus to retry', async e => {
    e.start({ load: async () => ({ mountVisual: (node) => {
      const focused = document.createElement('button'); focused.textContent = 'Example'; node.append(focused);
      return { setMotion: () => { throw new Error('figure'); }, destroy() {} };
    } }) });
    e.emit(true); await pause();
    e.root.querySelector<HTMLButtonElement>('[data-visual-stage] button')!.focus();
    e.button('motion').click();
    assert(document.activeElement === e.button('explore'), 'retry lost keyboard focus');
  });
  await check('destroy releases observation, listeners, signal and artwork', async e => {
    const handle = e.start(); e.emit(true); await pause(); handle.destroy();
    assert(e.contexts[0]?.signal.aborted && e.disconnected && e.destroyed === 1, 'cleanup incomplete');
    e.hide(true); e.hide(false); e.reduce(true); e.emit(true); e.button('explore').click(); await pause();
    assert(e.imports === 1 && !e.root.querySelector('[data-visual-stage]')!.hasChildNodes(), 'work continued after destroy');
  });
  return { passed: cases.every(row => row.passed), cases };
}
