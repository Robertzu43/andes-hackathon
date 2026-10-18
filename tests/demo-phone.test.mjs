import test from 'node:test';
import assert from 'node:assert/strict';

const pepper = 'syntheticfixture-pepper-not-a-secret-000';
const live = {
  ZAVU_LIVE_SEND: 'true',
  DEMO_SMS_DAILY_CAP: '40',
  DEMO_ALERTS_PER_NUMBER_DAILY: '6',
  DEMO_PHONE_PEPPER: pepper,
};

test('demo phone settings default to Peru and hourly limits of three per number and five per IP', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  assert.deepEqual(demoLimits(live), {
    pepper, allowedCountries: ['PE'], perNumberHourly: 3, perIpHourly: 5,
    smsDailyCap: 40, alertsPerNumberDaily: 6,
  });
  assert.deepEqual(demoLimits({...live, DEMO_ALLOWED_COUNTRIES: 'PE,BR,CL,CO,MX,AR',
    DEMO_OTP_PER_NUMBER_HOURLY: '1', DEMO_OTP_PER_IP_HOURLY: '2'}), {
    pepper, allowedCountries: ['PE', 'BR', 'CL', 'CO', 'MX', 'AR'],
    perNumberHourly: 1, perIpHourly: 2, smsDailyCap: 40, alertsPerNumberDaily: 6,
  });
});

test('live demo phone settings require both daily caps and a pepper', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  for (const name of ['DEMO_SMS_DAILY_CAP', 'DEMO_ALERTS_PER_NUMBER_DAILY', 'DEMO_PHONE_PEPPER']) {
    assert.throws(() => demoLimits({...live, [name]: undefined}), new RegExp(name), `${name} missing`);
  }
});

test('demo phone limits accept positive integers and reject malformed or oversized counts even with sends off', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  const fields = [
    ['DEMO_OTP_PER_NUMBER_HOURLY', 'perNumberHourly'],
    ['DEMO_OTP_PER_IP_HOURLY', 'perIpHourly'],
    ['DEMO_SMS_DAILY_CAP', 'smsDailyCap'],
    ['DEMO_ALERTS_PER_NUMBER_DAILY', 'alertsPerNumberDaily'],
  ];
  for (const [name, field] of fields) {
    for (const [raw, expected] of [['1', 1], ['999999999', 999999999]]) {
      assert.equal(demoLimits({...live, [name]: raw})[field], expected, `${name}=${raw}`);
    }
    for (const raw of ['0', '-1', '1.5', 'five', '', ' ', ' 1', '1 ', '01', '1e2', '1000000000']) {
      for (const mode of ['true', 'false']) {
        assert.throws(() => demoLimits({...live, ZAVU_LIVE_SEND: mode, [name]: raw}),
          new RegExp(name), `${name}=${JSON.stringify(raw)}, live=${mode}`);
      }
    }
  }
});

test('demo phone countries accept supported uppercase codes with trimming and reject unknown or inherited names', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  assert.deepEqual(demoLimits({...live, DEMO_ALLOWED_COUNTRIES: ' AR, BR , CL,CO, MX, PE, US '}).allowedCountries,
    ['AR', 'BR', 'CL', 'CO', 'MX', 'PE', 'US']);
  for (const raw of ['PE,XX', 'pe', '', ' ', 'PE,', ',PE', 'PE,,BR', 'toString', 'constructor', '__proto__']) {
    assert.throws(() => demoLimits({...live, DEMO_ALLOWED_COUNTRIES: raw}), /DEMO_ALLOWED_COUNTRIES/, raw);
  }
});

test('sends off allow missing caps and generate a fresh pepper while supplied peppers need at least 32 characters', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  const off = demoLimits({});
  assert.deepEqual(off, {
    pepper: off.pepper, allowedCountries: ['PE'], perNumberHourly: 3, perIpHourly: 5,
    smsDailyCap: 0, alertsPerNumberDaily: 0,
  });
  assert.match(off.pepper, /^[0-9a-f]{64}$/);
  for (const mode of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
    const next = demoLimits({ZAVU_LIVE_SEND: mode});
    assert.deepEqual([next.smsDailyCap, next.alertsPerNumberDaily], [0, 0]);
    assert.match(next.pepper, /^[0-9a-f]{64}$/);
    assert.notEqual(next.pepper, off.pepper);
  }
  for (const mode of ['true', 'false']) {
    for (const raw of ['', 'too-short', 's'.repeat(31)]) {
      assert.throws(() => demoLimits({...live, ZAVU_LIVE_SEND: mode, DEMO_PHONE_PEPPER: raw}), /DEMO_PHONE_PEPPER/);
    }
    const minimum = 'syntheticfixture-'.padEnd(32, '0');
    assert.equal(demoLimits({...live, ZAVU_LIVE_SEND: mode, DEMO_PHONE_PEPPER: minimum}).pepper, minimum);
  }
});

test('demo phone settings never read or return a fixed code from the environment', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  assert.equal('code' in demoLimits({...live, DEMO_OTP_CODE: '123456'}), false);
  const env = {...live};
  Object.defineProperty(env, 'DEMO_OTP_CODE', {get() { throw new Error('fixed OTP must never be read'); }});
  assert.deepEqual(demoLimits(env), demoLimits(live));
});
