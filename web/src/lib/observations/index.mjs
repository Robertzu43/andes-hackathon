// Integration exports for the durable observation queue lane.
//
// Browser wiring:
//   const opened = await openObservationStores();
//   if (!opened.ok) -> render an explicit storage-unavailable state
//   const queue = await openObservationQueue(opened.stores);
//   const uploader = createLocationUploader({ queue, baseUrl, getAccessToken, onlineTarget: window });
//   const pipeline = createObservationPipeline({ queue, uploader, ownerSubject });
//   const adapter = createPhoneObservationAdapter({ sink: pipeline.sink, ... });
//
// The adapter is intentionally NOT imported here: web/ consumes its event
// shape structurally and does not couple to the tools/src tree.

export { StorageUnavailableError } from './store.mjs';
export { openIdbStores, openObservationStores } from './idb-store.mjs';
export { QUEUE_LIMITS, validateSample, openObservationQueue } from './queue.mjs';
export { createLocationUploader } from './upload.mjs';
export { createObservationPipeline } from './pipeline.mjs';
