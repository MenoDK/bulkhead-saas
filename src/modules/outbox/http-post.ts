import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { guardedLookup, isPrivateAddress, parseTargetUrl, UnsafeTargetError } from './ssrf';

export interface PostResult {
  status: number;
}

/**
 * POSTs a JSON body and resolves with the status code. Deliberately small:
 * - redirects are NOT followed (a 302 to an internal address would bypass the SSRF guard);
 * - the connection goes through `guardedLookup`, which re-checks the resolved IPs;
 * - the response body is drained but never read into memory.
 */
export function postJson(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  options: { timeoutMs: number; allowPrivate: boolean },
): Promise<PostResult> {
  const url = parseTargetUrl(rawUrl);
  // Node never calls `lookup` for a literal IP ("http://127.0.0.1/"), so literals must be vetted here, not only in guardedLookup.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (!options.allowPrivate && isIP(literal) && isPrivateAddress(literal)) {
    return Promise.reject(new UnsafeTargetError('Target resolves to a non-public address'));
  }
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<PostResult>((resolve, reject) => {
    const req = send(
      url,
      {
        method: 'POST',
        lookup: guardedLookup(options.allowPrivate),
        timeout: options.timeoutMs,
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Timed out after ${options.timeoutMs}ms`)));
    req.on('error', reject);
    req.end(body);
  });
}
