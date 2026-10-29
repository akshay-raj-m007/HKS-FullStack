/** Local dev URLs may use the hostname or numeric loopback address Vite prints. */
export function isAllowedOrigin(
  origin: string,
  configured: string,
  development: boolean,
) {
  if (origin === configured) return true;
  if (!development) return false;
  try {
    const candidate = new URL(origin),
      expected = new URL(configured);
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return (
      candidate.origin === origin &&
      loopback.has(candidate.hostname) &&
      loopback.has(expected.hostname) &&
      candidate.protocol === expected.protocol &&
      candidate.port === expected.port
    );
  } catch {
    return false;
  }
}
