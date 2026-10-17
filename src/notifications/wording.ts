interface AlertInput {
  truck: string; country: string; timeZone: string; now: Date; signalAt: Date | null; voice?: boolean;
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
/** Spanish-only for the demo. ponytail: add pt-BR summaries when a Brazilian corridor is tested. */
export function alertSummary(input: AlertInput, env: NodeJS.ProcessEnv = process.env): string {
  const { incident, location, now } = input;
  // The truck label is driver free text: one line, bounded, so templates and SMS stay valid.
  const truck = input.truck.replace(/\s+/g, ' ').trim().slice(0, 40);
  const ago = location ? age(now.getTime() - location.captured_at.getTime()) : '';
  // Calls would read a URL aloud, so voice gets age and accuracy only.
  const where = !location ? 'Última ubicación no disponible.' : input.voice ? `Última ubicación hace ${ago}, precisión de ${Math.round(location.accuracy)} metros.`
    : `Última ubicación hace ${ago} (±${Math.round(location.accuracy)} m): https://maps.google.com/?q=${location.latitude},${location.longitude}.`;
  const emergency = emergencyNumber(input.country, env);
  const view = incident && env.CONTACT_APP_URL && !input.voice ? ` Ver: ${env.CONTACT_APP_URL}/incidents/${incident.id}` : '';
  if (incident?.trigger === 'sos') return `ALERTA: el conductor del camión ${truck} pidió ayuda (posible robo). Incidente ${incident.id}. ${where} Llámalo.${emergency ? ` Si no responde, llama al ${emergency}.` : ''}${view}`;
  const local = input.signalAt ? new Intl.DateTimeFormat('es', { timeZone: input.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(input.signalAt) : null;
  const reason = ({ arrival_overdue: 'no llegó a la hora prevista', silence: `sin señal desde ${local ?? 'hace un rato'}`, sharing_stopped: 'dejó de compartir su ubicación' } as Record<string, string>)[incident?.check_reason ?? ''];
  return `el conductor del camión ${truck} no confirmó su estado${reason ? ` (${reason})` : ''}.${incident ? ` Incidente ${incident.id}.` : ''} ${where} No sabemos qué pasó. Llámalo${emergency ? `; si no responde, llama al ${emergency}` : ''}.${view}`;
}
