import type { Channel } from '../contracts.js';
interface AlertInput {
  truck: string; country: string; timeZone: string; now: Date; signalAt: Date | null; channel: Channel;
  incident: { id: string; trigger: string; check_reason: string | null } | null;
  location: { latitude: number; longitude: number; accuracy: number; captured_at: Date } | null;
}
function age(ms: number) {
  const minutes = Math.round(Math.max(0, ms) / 60000);
  if (minutes < 1) return `${Math.round(Math.max(0, ms) / 1000)} s`;
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
function emergencyNumber(country: string, env: NodeJS.ProcessEnv): string | null {
  try { const number = JSON.parse(env.EMERGENCY_NUMBERS ?? '{}')[country]; return typeof number === 'string' && /^\d{2,15}$/.test(number) ? number : null; }
  catch { return null; }
}
function truckLabel(truck: string, channel: Channel): string {
  // Remove unsafe tokens before truncation, which could otherwise leave part of a URL or UUID.
  if (channel === 'sms' || channel === 'voice') {
    truck = truck.replace(/(?:\b[a-z][a-z\d+.-]*:\/\/|\/\/|\bwww\.)\S+/gi, ' ');
    truck = truck.replace(/\b(?:[a-z\d-]+\.)+[a-z]{2,}(?![a-z\d-])(?:[/:?#]\S*)?/gi, ' ');
  }
  if (channel === 'voice') truck = truck.replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, ' ');
  return truck.replace(/\s+/g, ' ').trim().slice(0, 40);
}
/** Spanish-only for the demo, pt-BR trips included. ponytail: add pt-BR summaries when a Brazilian corridor is tested. */
export function alertSummary(input: AlertInput, env: NodeJS.ProcessEnv = process.env): string {
  const { incident, location, now, channel } = input;
  // The truck label is driver free text: channel-safe, one line and bounded.
  const truck = truckLabel(input.truck, channel);
  const clock = (at: Date) => new Intl.DateTimeFormat('es', { timeZone: input.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const ago = location ? age(now.getTime() - location.captured_at.getTime()) : '';
  // The capture time (trip time zone) stays true however late the message is read; the age is relative to authorization.
  const at = location ? clock(location.captured_at) : '';
  // Zavu holds SMS with unverified URLs; each alert link is unique. Voice reads neither URLs nor IDs.
  // SMS carries plain coordinates, voice gets time/age/accuracy, and WhatsApp keeps both links.
  const where = !location ? 'Última ubicación no disponible.'
    : channel === 'voice' ? `Última ubicación a las ${at}, hace ${ago}, precisión de ${Math.round(location.accuracy)} metros.`
    : `Última ubicación a las ${at} (hace ${ago}, ±${Math.round(location.accuracy)} m): ${channel === 'sms' ? `${location.latitude}, ${location.longitude}` : `https://maps.google.com/?q=${location.latitude},${location.longitude}`}.`;
  const emergency = emergencyNumber(input.country, env);
  const id = incident && channel !== 'voice' ? ` Incidente ${incident.id}.` : '';
  const view = incident && env.CONTACT_APP_URL && channel === 'whatsapp' ? ` Ver: ${env.CONTACT_APP_URL}/incidents/${incident.id}` : '';
  if (incident?.trigger === 'sos') return `ALERTA: el conductor del camión ${truck} pidió ayuda (posible robo).${id} ${where} Llámalo.${emergency ? ` Si no responde, llama al ${emergency}.` : ''}${view}`;
  const local = input.signalAt ? clock(input.signalAt) : null;
  const reason = ({ arrival_overdue: 'no llegó a la hora prevista', silence: `sin señal desde ${local ?? 'hace un rato'}`, sharing_stopped: 'dejó de compartir su ubicación' } as Record<string, string>)[incident?.check_reason ?? ''];
  return `el conductor del camión ${truck} no confirmó su estado${reason ? ` (${reason})` : ''}.${id} ${where} No sabemos qué pasó. Llámalo${emergency ? `; si no responde, llama al ${emergency}` : ''}.${view}`;
}
