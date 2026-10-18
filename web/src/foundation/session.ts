// UI bridge only. Token storage/verification remains exclusively in lane45's adapter.
export type SessionSnapshot = Readonly<{
  state: 'unconfigured' | 'signed-out' | 'connecting' | 'authenticated' | 'expired' | 'error';
  mode: 'external' | 'demo';
}>;
export interface SessionGateway {
  // Return a stable snapshot. authenticated requires actual server identity verification.
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  begin?(): Promise<void>;
  end?(): void;
}
export const unconfiguredSession: SessionSnapshot = Object.freeze({ state: 'unconfigured', mode: 'external' });
