import test from 'node:test';
import assert from 'node:assert/strict';
import { narrowScope, operationalPrivacy, sharingScope } from '../../src/features/privacy/consent.ts';

test('contact can narrow either requested scope without broadening or accepting nothing', () => {
  for (const accepted of [{ map: true, incident: false }, { map: false, incident: true }, { map: true, incident: true }]) {
    assert.deepEqual(narrowScope({ map: true, incident: true }, accepted), accepted);
  }
  assert.throws(() => narrowScope({ map: false, incident: true }, { map: true, incident: true }));
  for (const scope of [{ map: false, incident: false }, { map: 'true', incident: true }, null, {}]) {
    assert.throws(() => sharingScope(scope), TypeError);
  }
});

test('operational receipts never authorize research reuse, restore consent or promise cancellation of in-flight work', () => {
  for (const standingReceipt of ['unknown', 'pending', 'accepted', 'revoked']) {
    const out = operationalPrivacy({ standingReceipt, tripRevoked: true });
    assert.equal(out.standingReceipt, standingReceipt);
    assert.equal(out.tripReceipt, 'revoked');
    assert.equal(out.currentAuthorization, 'requires-server-check');
    assert.equal(out.researchReuse, 'not-implemented');
    assert.equal(out.restoreRevokedConsent, 'unsupported');
    assert.equal(out.previouslyAuthorizedWork, 'may-still-complete');
    assert.equal(out.deletion, 'unsupported');
  }
});
