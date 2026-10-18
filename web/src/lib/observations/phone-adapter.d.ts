declare module '@phone-observations/trip-sharing.mjs' {
  export interface CaptureOptions {
    mode?: 'device' | 'synthetic-test';
    platform?: object;
    clock?: { now(): { wallMs: number; monoMs: number } };
  }
  export interface ReviewedContext {
    key: string;
    qualification: Record<string, unknown>;
    budget?: Record<string, unknown>;
  }
  export interface ObservationEvent {
    type: string;
    data?: Record<string, unknown>;
  }
  export interface Capture {
    startSharing(event: Event): { ok: boolean; reason?: string };
    stopSharing(): void;
  }
  export function createQueuedTripPhoneObservations(options: CaptureOptions & {
    trip: { tripId: string; revision: string };
    reviewedContext: ReviewedContext | null;
    locationConsent: { granted: true; tripId: string; reference: string };
    pipeline: {
      sink(event: ObservationEvent): void;
      drain(): Promise<void>;
      flush(): Promise<unknown>;
      revokeTrip(tripId: string): Promise<unknown>;
      tripStatus(tripId: string): Promise<unknown>;
    };
  }): Capture;
}

declare module '*observations/index.mjs' {
  import type { ObservationEvent } from '@phone-observations/trip-sharing.mjs';
  export interface ObservationStores { records: object; meta: object; close(): void }
  export function openObservationStores(): Promise<
    { ok: true; stores: ObservationStores } | { ok: false; reason: string }>;
  export interface ObservationQueue { wipeUser(subject: string): Promise<number> }
  export function openObservationQueue(stores: ObservationStores): Promise<ObservationQueue>;
  export interface LocationUploader {
    flush(options: { userId: string }): Promise<unknown>;
    stop(): void;
  }
  export function createLocationUploader(options: {
    queue: object; baseUrl: string; getAccessToken(): Promise<string | null>;
    fetchImpl: typeof fetch;
  }): LocationUploader;
  export interface ObservationPipeline {
    sink(event: ObservationEvent): void;
    drain(): Promise<void>;
    flush(): Promise<unknown>;
    revokeTrip(tripId: string): Promise<unknown>;
    tripStatus(tripId: string): Promise<unknown>;
    stop(): Promise<void>;
    signOut(): Promise<number>;
  }
  export function createObservationPipeline(options: {
    queue: object; uploader: LocationUploader; ownerSubject: string; onError(): void;
  }): ObservationPipeline;
}
