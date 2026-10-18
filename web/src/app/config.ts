export function webPort(raw: string | undefined): number {
  const port = raw === undefined ? 0 : Number(raw);
  if (!Number.isInteger(port) || (port !== 0 && port < 1024) || port > 65535) throw new Error('Invalid web port');
  return port;
}

export function localApiTarget(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid development API origin'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.port) {
    throw new Error('The development API target must be an explicit credential-free loopback origin');
  }
  return url.origin;
}
