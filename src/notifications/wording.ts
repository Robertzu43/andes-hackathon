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
  const clock = (at: Date) => new Intl.DateTimeFormat('es', { timeZone: input.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const ago = location ? age(now.getTime() - location.captured_at.getTime()) : '';
  // The capture time (trip time zone) stays true however late the message is read; the age is relative to authorization.
  const at = location ? clock(location.captured_at) : '';
  // Calls would read coordinates aloud, so voice gets time, age and accuracy and points to the SMS.
  // SMS carries plain coordinates, no link: Zavu's one-way sender refuses unverified URLs. ponytail: restore a maps link once its URL is verified.
  const where = !location ? 'Última ubicación no disponible.' : input.voice ? `Última ubicación a las ${at}, hace ${ago}, precisión de ${Math.round(location.accuracy)} metros. Te enviamos las coordenadas por mensaje de texto.`
    : `Última ubicación a las ${at} (hace ${ago}, ±${Math.round(location.accuracy)} m): ${location.latitude.toFixed(5)},${location.longitude.toFixed(5)} (pégalo en Google Maps).`;
  const emergency = emergencyNumber(input.country, env);
  const view = incident && env.CONTACT_APP_URL && !input.voice ? ` Ver: ${env.CONTACT_APP_URL}/incidents/${incident.id}` : '';
  const ref = incident && !input.voice ? ` Incidente ${incident.id}.` : '';
  if (incident?.trigger === 'sos') return `SOS: el conductor del camión ${truck} activó el botón SOS y pidió ayuda (posible robo).${ref} ${where} Llámalo.${emergency ? ` Si no responde, llama al ${emergency}.` : ''}${view}`;
  const local = input.signalAt ? clock(input.signalAt) : null;
  const reason = ({ arrival_overdue: 'no llegó a la hora prevista', silence: `sin señal desde ${local ?? 'hace un rato'}`, sharing_stopped: 'dejó de compartir su ubicación' } as Record<string, string>)[incident?.check_reason ?? ''];
  return `el conductor del camión ${truck} no confirmó su estado${reason ? ` (${reason})` : ''}.${ref} ${where} No sabemos qué pasó. Llámalo${emergency ? `; si no responde, llama al ${emergency}` : ''}.${view}`;
}
