const dns = require('dns').promises;
const net = require('net');

/**
 * Checks if an IPv4 or IPv6 address belongs to a private, loopback, link-local, or reserved range.
 * @param {string} ip
 * @returns {boolean} True if IP is internal/private/reserved
 */
function isPrivateOrReservedIP(ip) {
  if (!ip) return true;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;

    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private)
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local & Cloud metadata e.g. AWS/GCP 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (Reserved)
    if (parts[0] >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (ip === '255.255.255.255') return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // Loopback (::1)
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // Unspecified (::)
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
    // Link-local (fe80::/10)
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    // Unique local (fc00::/7 - fc00:: and fd00::)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    if (normalized.startsWith('::ffff:') || normalized.startsWith('0:0:0:0:0:ffff:')) {
      const ipv4Part = ip.split(':').pop();
      return isPrivateOrReservedIP(ipv4Part);
    }
    return false;
  }

  return true;
}

/**
 * Validates a destination URL against SSRF vulnerabilities.
 * Ensures URL uses http/https and does NOT resolve to internal/private IP ranges or cloud metadata endpoints.
 * @param {string} urlString
 * @returns {Promise<{ valid: boolean, reason?: string, parsedUrl?: URL }>}
 */
async function validateSSRFUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, reason: 'URL is required.' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlString.trim());
  } catch (err) {
    return { valid: false, reason: 'Invalid URL format.' };
  }

  // Only allow http and https protocols
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTP and HTTPS protocols are permitted.' };
  }

  const rawHostname = parsedUrl.hostname.toLowerCase();
  const cleanHostname = rawHostname.replace(/^\[|\]$/g, '');

  // Block localhost and common local/cloud metadata hostnames
  if (
    cleanHostname === 'localhost' ||
    cleanHostname.endsWith('.localhost') ||
    cleanHostname.endsWith('.local') ||
    cleanHostname.endsWith('.internal') ||
    cleanHostname === 'metadata.google.internal' ||
    cleanHostname === 'instance-data' ||
    cleanHostname === '0.0.0.0' ||
    cleanHostname === '::' ||
    cleanHostname === '::1'
  ) {
    return { valid: false, reason: 'Localhost and internal cloud metadata hostnames are restricted.' };
  }

  // If hostname is direct IP address (IPv4 or IPv6)
  if (net.isIP(cleanHostname)) {
    if (isPrivateOrReservedIP(cleanHostname)) {
      return { valid: false, reason: 'Requests to private or reserved IP ranges are blocked.' };
    }
    return { valid: true, parsedUrl };
  }

  // Resolve hostname via DNS
  try {
    const lookupResults = await dns.lookup(cleanHostname, { all: true });
    if (!lookupResults || lookupResults.length === 0) {
      return { valid: false, reason: 'Could not resolve hostname via DNS.' };
    }

    for (const record of lookupResults) {
      if (isPrivateOrReservedIP(record.address)) {
        return {
          valid: false,
          reason: `Hostname ${rawHostname} resolves to restricted private IP (${record.address}).`
        };
      }
    }
  } catch (dnsErr) {
    return { valid: false, reason: `DNS lookup failed for hostname: ${dnsErr.message}` };
  }

  return { valid: true, parsedUrl };
}

module.exports = {
  isPrivateOrReservedIP,
  validateSSRFUrl
};
