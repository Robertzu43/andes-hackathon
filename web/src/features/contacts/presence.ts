interface ScreenLock { release(): Promise<void> }
export interface ContactPresenceOptions {
  /** Existing view work: it captures SDK authority and owns read/state/abort handling. */
  refreshStatus(): Promise<void>;
  /** Abort and conceal view-owned reads. Call the returned stop on logout/expiry/revocation. */
  suspend(): void;
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  navigator: { wakeLock?: { request(type: 'screen'): Promise<ScreenLock> } };
}

/** Schedule the existing authenticated view; no second session, read store, or writes. */
export function startContactPresence({ refreshStatus, suspend, document, navigator }: ContactPresenceOptions): () => void {
  let stopped = false;
  let visible = document.visibilityState === 'visible';
  let generation = 0;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lock: ScreenLock | null = null;
  function release(held: ScreenLock | null) {
    if (held) { try { void held.release().catch(() => {}); } catch { /* Wake lock is optional. */ } }
  }
  function releaseLock() { const held = lock; lock = null; release(held); }
  async function acquireLock() {
    const started = generation;
    try {
      const next = await navigator.wakeLock?.request('screen');
      if (!next) return;
      if (stopped || !visible || started !== generation) release(next);
      else { releaseLock(); lock = next; }
    } catch { /* Permission/refusal does not stop visible authenticated reads. */ }
  }
  async function cycle() {
    if (stopped || !visible || inFlight) return;
    inFlight = true;
    const started = generation;
    try { await refreshStatus(); }
    catch { /* The existing view owns read errors and authority handling. */ }
    finally {
      inFlight = false;
      if (!stopped && visible) {
        if (started !== generation) void cycle(); // Resume after an aborted old callback settles.
        else timer = setTimeout(() => { timer = undefined; void cycle(); }, 5000);
      }
    }
  }
  function conceal() {
    generation += 1;
    clearTimeout(timer); timer = undefined;
    releaseLock();
    suspend();
  }
  function visibilityChanged() {
    if (stopped) return;
    const next = document.visibilityState === 'visible';
    if (next === visible) return;
    visible = next;
    if (!visible) conceal();
    else { void acquireLock(); void cycle(); }
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  if (visible) { void acquireLock(); void cycle(); }
  else suspend();
  return () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', visibilityChanged);
    conceal();
  };
}
