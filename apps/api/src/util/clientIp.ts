/**
 * The client IP to use for abuse throttling — chosen so it CANNOT be forged.
 *
 * The problem: `cf-connecting-ip` is set by Cloudflare, but it is an ordinary
 * request header. If a request reaches the origin WITHOUT transiting Cloudflare
 * (e.g. the raw *.onrender.com host), an attacker can set it to a random value
 * per request and get a fresh rate-limit bucket every time — defeating the
 * login/forgot/promo/checkout throttles.
 *
 * The fix: only trust `cf-connecting-ip` when the request genuinely came through
 * Cloudflare — i.e. the ACTUAL connecting peer (the last hop our own edge,
 * Render, appends to x-forwarded-for) is one of Cloudflare's published IP
 * ranges. Otherwise fall back to that peer IP, which the client cannot control
 * (Render appends it based on the real TCP source, after any client-sent XFF).
 */
import type { FastifyRequest } from 'fastify';

// Cloudflare's published ranges (https://www.cloudflare.com/ips/). Stable; update
// if Cloudflare changes them. IPv4 as CIDR, IPv6 as address prefixes (/29–/32,
// so matching the leading groups is sufficient and conservative).
const CF_V4: Array<[string, number]> = [
  ['173.245.48.0', 20], ['103.21.244.0', 22], ['103.22.200.0', 22], ['103.31.4.0', 22],
  ['141.101.64.0', 18], ['108.162.192.0', 18], ['190.93.240.0', 20], ['188.114.96.0', 20],
  ['197.234.240.0', 22], ['198.41.128.0', 17], ['162.158.0.0', 15], ['104.16.0.0', 13],
  ['104.24.0.0', 14], ['172.64.0.0', 13], ['131.0.72.0', 22],
];
const CF_V6_PREFIXES = ['2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:', '2405:8100:', '2a06:98c0:', '2c0f:f248:'];

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n * 256) + o;
  }
  return n >>> 0;
}

function isCloudflareIp(ip: string): boolean {
  const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip; // IPv4-mapped IPv6
  if (addr.includes('.')) {
    const ipInt = v4ToInt(addr);
    if (ipInt === null) return false;
    for (const [net, bits] of CF_V4) {
      const netInt = v4ToInt(net);
      if (netInt === null) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((ipInt & mask) === (netInt & mask)) return true;
    }
    return false;
  }
  const lower = addr.toLowerCase();
  return CF_V6_PREFIXES.some((p) => lower.startsWith(p));
}

/** The abuse-throttle key IP for a request (see file header). */
export function clientIp(request: FastifyRequest): string {
  const xff = String(request.headers['x-forwarded-for'] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  // The last XFF hop is appended by our own edge (Render) from the real TCP peer,
  // so a client cannot forge it; fall back to the socket IP if XFF is absent.
  const peer = xff[xff.length - 1] || request.ip;
  const cfIp = request.headers['cf-connecting-ip'] as string | undefined;
  // Trust cf-connecting-ip only when the request actually came through Cloudflare.
  return (cfIp && isCloudflareIp(peer)) ? cfIp : peer;
}
