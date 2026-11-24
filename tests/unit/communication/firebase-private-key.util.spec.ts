import { describe, expect, it } from '@jest/globals';
import { createPrivateKey, generateKeyPairSync } from 'crypto';
import { parseServiceAccountPrivateKey } from '@communication/channels/firebase/private-key.util';

/** A throwaway key generated per run: the same PEM shape as a Google service-account key. */
const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

function expectUsable(raw: string): void {
  const parsed = parseServiceAccountPrivateKey(raw);
  expect(parsed.problem).toBeUndefined();
  expect(parsed.key).toBeDefined();
  expect(() => createPrivateKey(parsed.key ?? '')).not.toThrow();
}

describe('parseServiceAccountPrivateKey', () => {
  it('accepts a well-formed PEM as it is', () => {
    expectUsable(PEM);
  });

  it('repairs the shapes env editors produce', () => {
    const escaped = PEM.replace(/\n/g, '\\n');
    expectUsable(escaped); // "\n" escaped once (the usual .env form)
    expectUsable(PEM.replace(/\n/g, '\\\\n')); // escaped twice
    expectUsable(`"${escaped}"`); // wrapped in quotes
    expectUsable(`'${PEM}'`);
    expectUsable(PEM.replace(/\n/g, '\r\n')); // Windows line ends
    expectUsable(`  ${PEM}  `);
    expectUsable(PEM.replace(/\n/g, ' ')); // pasted into a one-line field
    expectUsable(Buffer.from(PEM).toString('base64')); // base64-encoded PEM
  });

  it('reports an unusable value by shape, never by content', () => {
    const placeholder = parseServiceAccountPrivateKey('***');
    expect(placeholder.key).toBeUndefined();
    expect(placeholder.problem).toMatch(/too short.*placeholder/);
    expect(placeholder.problem).not.toContain('***');

    const noMarkers = parseServiceAccountPrivateKey('x'.repeat(400));
    expect(noMarkers.problem).toMatch(/no "-----BEGIN/);

    const body = PEM.split('\n').slice(1, -2).join('\n');
    const truncated = `-----BEGIN PRIVATE KEY-----\n${body.slice(0, 200)}\n-----END PRIVATE KEY-----\n`;
    const corrupt = parseServiceAccountPrivateKey(truncated);
    expect(corrupt.key).toBeUndefined();
    expect(corrupt.problem).toMatch(/OpenSSL cannot load/);
    expect(corrupt.problem).not.toContain(body.slice(0, 20));
  });

  it('treats a missing or blank value as not set', () => {
    expect(parseServiceAccountPrivateKey(undefined)).toEqual({ problem: 'not set' });
    expect(parseServiceAccountPrivateKey('   ')).toEqual({ problem: 'not set' });
  });
});
