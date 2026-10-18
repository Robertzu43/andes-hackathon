import { normalizeDate } from './responses.ts';

export interface DemoPhoneStart { expiresAt: string }
export interface DemoPhoneVerification { verified: true }
export const demoPhoneCodes = ['invalid_phone', 'country_not_allowed', 'rate_limited',
  'demo_budget_exhausted', 'demo_sms_disabled', 'invalid_code', 'code_expired', 'too_many_attempts'] as const;

export function decodeDemoPhoneStart(value: unknown): DemoPhoneStart {
  if (!value || typeof value !== 'object' || !('expiresAt' in value)
    || typeof value.expiresAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.expiresAt)) {
    throw new Error('Unexpected API response');
  }
  normalizeDate(value.expiresAt); // Validate the calendar without changing the source instant.
  return { expiresAt: value.expiresAt };
}
export function decodeDemoPhoneVerification(value: unknown): DemoPhoneVerification {
  if (!value || typeof value !== 'object' || !('verified' in value) || value.verified !== true) {
    throw new Error('Unexpected API response');
  }
  return { verified: true };
}
