export type VisualLocale = 'es' | 'pt-BR';
export type VisualKind = 'phone' | 'relay';
export type VisualMotion = 'still' | 'interactive';

/** A still instance remains useful to keyboard and touch users without animation. */
export interface VisualInstance {
  setMotion(motion: VisualMotion): void;
  /** Idempotent: an abort and a late mount completion may both require cleanup. */
  destroy(): void;
}

export interface VisualContext {
  locale: VisualLocale;
  motion: VisualMotion;
  /** Release listeners, timers and frames on abort, including a failed async mount. */
  signal: AbortSignal;
}

export interface VisualModule {
  mountVisual(host: HTMLElement, context: VisualContext): VisualInstance | Promise<VisualInstance>;
}

export interface VisualCopy {
  title: string;
  caption: string;
  facts: readonly string[];
  fallback: string;
  explore: string;
  enableMotion: string;
  disableMotion: string;
  retry: string;
  loading: string;
  ready: string;
  unavailable: string;
  still: string;
  moving: string;
  parked: string;
}

export interface VisualOptions {
  locale: VisualLocale;
  kind: VisualKind;
  /** A literal import callback preserves a separate production chunk. */
  load: () => Promise<VisualModule>;
  /** Feature-owned translated copy may replace the supplied local dictionary. */
  copy?: VisualCopy;
  /** Bounds a hung import/mount; default 12,000 ms. No trip timer is owned here. */
  loadTimeoutMs?: number;
}
