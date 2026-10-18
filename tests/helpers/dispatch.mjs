import {createZavuProvider} from '../../dist/notifications/zavu.js';
import * as dispatch from '../../dist/notifications/dispatch.js';
export const qualification = {
  accountId: 'prj_fixture', senderId: 'snd_fixture', live: true,
  evidence: 'syntheticfixture: not live qualification',
  dailyLimit: 100, channelDailyLimit: 50, minuteLimit: 30, emergencyReserve: 5,
  entries: ['sms','whatsapp','voice'].map(channel => ({channel,country:'BR',locale:'pt-BR',
    evidence:'syntheticfixture: not live qualification',text:'ANDES: estado sin confirmar.',
    voiceLanguage:'pt-BR',templateId:'tpl_fixture_approved',summaryVariable:'1'}))
};
export async function runtime() { return dispatch; }
export async function sos(f) {
  const grant = await f.grant(); const trip = await f.trip([grant]);
  const incident = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  const jobs = (await f.ctx.pool.query("SELECT id,id AS \"jobId\",version,class,channel FROM jobs WHERE incident_id=$1 AND channel <> 'group' ORDER BY channel", [incident])).rows;
  return {grant,trip,incident,jobs};
}
export function provider(overrides = {}) {
  return { ...createZavuProvider(qualification,'syntheticfixture-never-live',async()=>{throw Error('synthetic transport only');}), qualification, async send() { return {state:'accepted',messageId:'msg_fixture_1',status:'queued'}; },
    async read() { return {state:'missing'}; }, ...overrides };
}
export const deferred = () => Promise.withResolvers();
