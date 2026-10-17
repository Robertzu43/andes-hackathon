export type RelayLocale = 'es' | 'pt-BR';
export type RelayMotion = 'still' | 'interactive';
export function renderRelay(locale?: RelayLocale): string;
export function mountVisual(host: HTMLElement, options?: {
  locale?: RelayLocale; motion?: RelayMotion; signal?: AbortSignal;
}): { setMotion(motion: RelayMotion): void; destroy(): void };
