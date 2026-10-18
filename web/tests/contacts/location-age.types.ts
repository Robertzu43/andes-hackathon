import { locationAge, type Snapshot } from '../../src/features/contacts/journey.ts';

declare const snapshot: Snapshot;
const sourceAge = locationAge(snapshot);
const asOf: 'server-read' = sourceAge.asOf;
void asOf;
// @ts-expect-error Client wall time is not an exported clock anchor for server source age.
locationAge(snapshot, Date.now());
