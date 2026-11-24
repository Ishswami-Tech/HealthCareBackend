/**
 * Service-account private keys arrive through env vars in many mangled shapes: wrapped in quotes,
 * with "\n" escaped once or twice, with Windows line ends, base64-encoded, or pasted into a
 * one-line field that turned the newlines into spaces. Google's auth library hands the string
 * straight to OpenSSL, which then fails on every request with the unhelpful
 * "error:1E08010C:DECODER routines::unsupported" (production, 2026-11-24: every FCM push from
 * the API failed this way while the worker, holding a well-formed key, sent fine).
 *
 * `parseServiceAccountPrivateKey` repairs those shapes and proves the result loads, so a bad key
 * is reported once at startup, by variable name and without its value, instead of on each push.
 */
import { createPrivateKey } from 'crypto';

const PEM_PATTERN = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/;

export interface ParsedPrivateKey {
  /** The PEM key, present only when OpenSSL can load it. */
  readonly key?: string;
  /** Why the value is unusable (never contains the value itself). */
  readonly problem?: string;
}

function stripWrappingQuotes(value: string): string {
  let text = value.trim();
  while (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.endsWith(text[0])) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function unescapeNewlines(value: string): string {
  return value
    .replace(/\\\\n/g, '\n')
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\r\n?/g, '\n');
}

/** A base64-encoded PEM (some deploy UIs only accept one-line values). */
function decodeBase64Pem(value: string): string | null {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value) || value.length < 100) return null;
  const decoded = Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8');
  return PEM_PATTERN.test(decoded) ? decoded : null;
}

/** Rebuilds the PEM with its body in 64-character lines (fixes newlines turned into spaces). */
function rewrapPem(value: string): string | null {
  const match = PEM_PATTERN.exec(value);
  if (!match) return null;
  const label = match[1] ?? 'PRIVATE KEY';
  const body = (match[2] ?? '').replace(/\s+/g, '');
  if (!body) return null;
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function loads(pem: string): boolean {
  try {
    createPrivateKey(pem);
    return true;
  } catch {
    return false;
  }
}

export function parseServiceAccountPrivateKey(raw: string | undefined): ParsedPrivateKey {
  if (raw === undefined || raw.trim() === '') return { problem: 'not set' };

  let text = unescapeNewlines(stripWrappingQuotes(raw));
  if (!PEM_PATTERN.test(text)) {
    const decoded = decodeBase64Pem(text);
    if (!decoded) {
      return {
        problem:
          text.length < 100
            ? `too short to be a key (${text.length} characters; a placeholder?)`
            : 'no "-----BEGIN ... PRIVATE KEY-----" / "-----END ... PRIVATE KEY-----" block',
      };
    }
    text = unescapeNewlines(decoded);
  }

  const pem = PEM_PATTERN.exec(text)?.[0] ?? text;
  if (loads(pem)) return { key: pem.endsWith('\n') ? pem : `${pem}\n` };

  const rewrapped = rewrapPem(pem);
  if (rewrapped && loads(rewrapped)) return { key: rewrapped };

  return { problem: 'has PEM markers, but OpenSSL cannot load the key (truncated or corrupted?)' };
}
