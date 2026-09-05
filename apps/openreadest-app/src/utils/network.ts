export const isLanAddress = (url: string) => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    // Check for IPv4 private ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);

    if (match) {
      const [, a, b, c, d] = match.map(Number);
      if (a === undefined || b === undefined || c === undefined || d === undefined) {
        return false;
      }

      // Validate IP format
      if (a > 255 || b > 255 || c > 255 || d > 255) {
        return false;
      }

      // Check private IP ranges:
      // 10.0.0.0/8 (10.0.0.0 to 10.255.255.255)
      if (a === 10) return true;

      // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
      if (a === 172 && b >= 16 && b <= 31) return true;

      // 192.168.0.0/16 (192.168.0.0 to 192.168.255.255)
      if (a === 192 && b === 168) return true;

      // 169.254.0.0/16 (link-local addresses)
      if (a === 169 && b === 254) return true;

      // Tailscale IPv4 range: 100.64.0.0/10 (100.64.0.0 to 100.127.255.255)
      if (a === 100 && b >= 64 && b <= 127) return true;
    }

    // Check for IPv6 private addresses (simplified check)
    if (hostname.includes(':')) {
      if (
        hostname.startsWith('::1') ||
        hostname.startsWith('fe80:') ||
        hostname.startsWith('fc00:') ||
        hostname.startsWith('fd00:')
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// OPDS proxy SSRF blocklist（从 route.ts 抽出，供路由与测试共用真身）。
// ---------------------------------------------------------------------------

/** Whether a dotted-decimal IPv4 address falls in a private / reserved range. */
export function isBlockedV4(a: number, b: number, c: number, _d: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * SSRF host blocklist: loopback, private, link-local, CGNAT, benchmarking,
 * multicast ranges, internal hostname suffixes, and bare single-label names.
 *
 * Input is a hostname as the WHATWG URL parser serializes it (decimal/hex/octal
 * IPv4 already normalized to dotted-quad). This is a string check — a hostname
 * that DNS-resolves to a private address (DNS rebinding) is a documented
 * residual risk for deployments with a reachable internal network.
 */
export function isBlockedHost(hostname: string): boolean {
  // 尾点（trailing dot）FQDN 与无尾点名字一样被 DNS 解析：http://localhost./
  // 仍解析到回环。WHATWG URL 对点分十进制 IP 会归一化，但保留域名的尾点，
  // 所以先剥掉再检查，否则 isBlockedHost('localhost.') 会放行。
  // 剥掉全部尾点（localhost.. 等双尾点同样存在解析器折叠风险）。
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  // Bare single-label hostnames (e.g. `intranet`, `metadata`) — never public.
  if (!h.includes('.') && !h.includes(':')) return true;

  // IPv4 — the WHATWG URL parser already normalized decimal/hex/octal forms.
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    return isBlockedV4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  }

  // IPv6, including IPv4-mapped / -compatible forms.
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true; // unspecified, loopback
    if (/^(fc|fd)/.test(h)) return true; // unique-local
    if (/^fe[89ab]/.test(h)) return true; // link-local
    const mapped = h.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (mapped) {
      return isBlockedV4(
        Number(mapped[1]),
        Number(mapped[2]),
        Number(mapped[3]),
        Number(mapped[4]),
      );
    }
    const hexMapped = h.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1] ?? '0', 16);
      const lo = parseInt(hexMapped[2] ?? '0', 16);
      return isBlockedV4((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }
    return false;
  }
  return false;
}
