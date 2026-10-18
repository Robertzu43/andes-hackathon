import { randomBytes } from 'node:crypto';

// Calling-code prefixes, not numbering plans: +1 covers the entire NANP, including Canada and the Caribbean.
export const CALLING_CODES: Record<string, string> = {
  AR: '54', BR: '55', CL: '56', CO: '57', MX: '52', PE: '51', US: '1',
};

export interface DemoLimits {
  pepper: string;
  allowedCountries: string[];
  perNumberHourly: number;
  perIpHourly: number;
  smsDailyCap: number;
  alertsPerNumberDaily: number;
}

/** Live sends require both daily caps and a pepper; disabled sends allow these settings to be absent. */
export function demoLimits(env: NodeJS.ProcessEnv): DemoLimits {
  const live = env.ZAVU_LIVE_SEND === 'true';
  const count = (name: string, fallback?: number): number => {
    const raw = env[name];
    if (raw === undefined) {
      if (fallback === undefined) throw new Error(`DEMO_MODE live sends require ${name}`);
      return fallback;
    }
    if (!/^[1-9]\d{0,8}$/.test(raw)) throw new Error(`${name} must be a positive integer`);
    return Number(raw);
  };

  const allowedCountries = (env.DEMO_ALLOWED_COUNTRIES ?? 'PE').split(',').map(code => code.trim());
  if (allowedCountries.some(code => !Object.hasOwn(CALLING_CODES, code))) {
    throw new Error(`DEMO_ALLOWED_COUNTRIES may list only ${Object.keys(CALLING_CODES).join(',')}`);
  }
  // With sends disabled, a fresh throwaway pepper is sufficient.
  const pepper = env.DEMO_PHONE_PEPPER ?? (live ? '' : randomBytes(32).toString('hex'));
  if (pepper.length < 32) throw new Error('DEMO_PHONE_PEPPER must be a random secret of at least 32 characters');

  return {
    pepper,
    allowedCountries,
    perNumberHourly: count('DEMO_OTP_PER_NUMBER_HOURLY', 3),
    perIpHourly: count('DEMO_OTP_PER_IP_HOURLY', 5),
    smsDailyCap: count('DEMO_SMS_DAILY_CAP', live ? undefined : 0),
    alertsPerNumberDaily: count('DEMO_ALERTS_PER_NUMBER_DAILY', live ? undefined : 0),
  };
}
