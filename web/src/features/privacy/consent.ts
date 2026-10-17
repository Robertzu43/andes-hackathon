/** Operational consent receipts only. Current access is always checked by the API. */
export interface SharingScope { map: boolean; incident: boolean }

export function sharingScope(value: SharingScope): SharingScope {
  if (typeof value?.map !== 'boolean' || typeof value?.incident !== 'boolean'
    || (!value.map && !value.incident)) throw new TypeError('Choose at least one operational scope');
  return { map: value.map, incident: value.incident };
}

export function narrowScope(requested: SharingScope, accepted: SharingScope): SharingScope {
  const offered = sharingScope(requested);
  const choice = sharingScope(accepted);
  if ((choice.map && !offered.map) || (choice.incident && !offered.incident)) {
    throw new TypeError('Acceptance cannot broaden the invitation');
  }
  return choice;
}

export function operationalPrivacy(input: {
  standingReceipt: 'unknown' | 'pending' | 'accepted' | 'revoked';
  tripRevoked: boolean;
}) {
  return {
    standingReceipt: input.standingReceipt,
    tripReceipt: input.tripRevoked ? 'revoked' : 'unknown',
    currentAuthorization: 'requires-server-check',
    restoreRevokedConsent: 'unsupported',
    previouslyAuthorizedWork: 'may-still-complete',
    researchReuse: 'not-implemented',
    deletion: 'unsupported',
  } as const;
}
