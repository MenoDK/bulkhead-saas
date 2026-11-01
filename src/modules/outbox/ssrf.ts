import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';

/**
 * Outbound webhooks let a tenant make OUR server issue requests: the classic SSRF primitive.
 * Targets must be http(s) and must not resolve to loopback, private, link-local (cloud metadata!),
 * carrier-grade NAT or otherwise non-public addresses.
 */
export class UnsafeTargetError extends Error {}

/** The host name does not resolve (typo, or a domain that does not exist). A client mistake, not a server fault. */
export class UnresolvableTargetError extends Error {}

const DNS_MISS = new Set(['ENOTFOUND', 'ENODATA', 'EAI_AGAIN', 'ESERVFAIL', 'ETIMEOUT']);

export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || //            link-local, includes 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || //              192.0.0.0/24 IETF protocol assignments
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 //                               multicast + reserved
    );
  }
  if (v === 6) {
    const a = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return (
      a === '::' ||
      a === '::1' ||
      a.startsWith('fc') ||
      a.startsWith('fd') || //  unique local
      /^fe[89ab]/.test(a) || //                        link-local
      a.startsWith('ff') //                            multicast
    );
  }
  return true; // not an IP at all: refuse
}

export function parseTargetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTargetError('Invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new UnsafeTargetError('Only http(s) targets are allowed');
  if (url.username || url.password) throw new UnsafeTargetError('Credentials in the URL are not allowed');
  return url;
}

/**
 * Resolves the host and rejects non-public addresses. Called at *delivery* time as well as at
 * registration: a hostname that was public yesterday can point at 169.254.169.254 today (DNS rebinding).
 */
export async function assertPublicTarget(raw: string, allowPrivate = false): Promise<URL> {
  const url = parseTargetUrl(raw);
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true })).map((r) => r.address);
    } catch (error) {
      if (DNS_MISS.has((error as NodeJS.ErrnoException).code ?? ''))
        throw new UnresolvableTargetError('The host name could not be resolved');
      throw error;
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeTargetError('Target resolves to a non-public address');
  }
  return url;
}

/**
 * DNS resolver for the actual outbound connection. Validating a hostname and then letting the HTTP
 * client resolve it again leaves a gap an attacker can use (DNS rebinding); validating the very
 * addresses the socket is about to connect to closes it.
 */
export const guardedLookup =
  (allowPrivate: boolean): LookupFunction =>
  (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '', 0);
      const list = addresses as LookupAddress[];
      if (!allowPrivate && (list.length === 0 || list.some((a) => isPrivateAddress(a.address)))) {
        return callback(
          new UnsafeTargetError('Target resolves to a non-public address') as NodeJS.ErrnoException,
          '',
          0,
        );
      }
      if (options.all) return callback(null, list);
      const first = list[0];
      return first
        ? callback(null, first.address, first.family)
        : callback(new Error('No address') as NodeJS.ErrnoException, '', 0);
    });
  };
