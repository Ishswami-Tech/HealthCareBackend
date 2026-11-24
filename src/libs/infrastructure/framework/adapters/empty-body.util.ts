/**
 * A request without a body must never fail on its Content-Type.
 *
 * Fastify runs its content-type parser whenever the headers allow a body, and then answers
 * 415 FST_ERR_CTP_INVALID_MEDIA_TYPE (no or unknown Content-Type) or 400
 * FST_ERR_CTP_EMPTY_JSON_BODY (`application/json`) before any guard or handler runs, so nothing
 * of ours is even logged. Two shapes reach it without a body:
 *
 * - a client that declares a content type but sends nothing (`Content-Length: 0`, or no length):
 *   many clients do that for action routes without a payload;
 * - the Temps proxy, which forwards every request with `Transfer-Encoding: chunked`, even a
 *   bodyless DELETE whose client sent `Content-Length: 0`. The headers then say "a body of unknown
 *   length follows" and Fastify parses it: `DELETE /auth/admin/review-login` from the web portal
 *   (no Content-Type) got 415.
 *
 * The first is settled from the headers (onRequest); the second only by reading the stream, which
 * is done before parsing (preParsing): when it ends without a byte, the request is rewritten as the
 * bodyless request it is. The route then sees `body === undefined`. A request with a body is left
 * exactly as it was, so its parsing, JSON validation and 415 for an unsupported type are unchanged.
 */
import type { Readable } from 'stream';

export type RequestHeaderBag = Record<string, string | string[] | undefined>;

type StreamError = Error & { statusCode?: number };

function headerText(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? '';
}

/**
 * True when the headers alone prove there is no body: no transfer encoding, and a
 * `Content-Length` of 0 or none at all (HTTP/1.1: no message body; Fastify uses the same rule).
 */
export function headersDeclareNoBody(headers: RequestHeaderBag): boolean {
  if (headerText(headers['transfer-encoding'])) return false;
  const length = headerText(headers['content-length']);
  return length === '' || length === '0';
}

/**
 * Removes the content type of a request whose headers prove it has no body (in place: Fastify
 * reads the request's own header object). Returns true when it did.
 */
export function dropContentTypeOfEmptyBody(headers: RequestHeaderBag): boolean {
  if (headers['content-type'] === undefined || !headersDeclareNoBody(headers)) return false;
  delete headers['content-type'];
  return true;
}

/**
 * Resolves true as soon as the stream yields data (which is put back, so the parser still reads
 * the whole body), false when it ends without any.
 */
export function streamHasData(stream: Readable): Promise<boolean> {
  if (stream.readableEnded) return Promise.resolve(false);
  return new Promise<boolean>((resolve, reject) => {
    const cleanup = (): void => {
      stream.off('readable', onReadable);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    function onReadable(): void {
      const chunk = stream.read() as Buffer | string | null;
      // null: the stream has ended ('end' follows) or nothing is buffered yet.
      if (chunk === null) return;
      cleanup();
      stream.unshift(chunk);
      resolve(true);
    }
    function onEnd(): void {
      cleanup();
      resolve(false);
    }
    function onError(error: StreamError): void {
      cleanup();
      // A broken request stream is the client's fault, as in Fastify's own body reader.
      if (!(typeof error.statusCode === 'number' && error.statusCode >= 400)) {
        error.statusCode = 400;
      }
      reject(error);
    }
    stream.on('readable', onReadable);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

/**
 * For a request whose length the headers leave open (`Transfer-Encoding`), waits for the first
 * byte of the body. When the body turns out to be empty, the request is rewritten as bodyless
 * (no transfer encoding, length or content type) so Fastify skips the parser. Returns true when it
 * did.
 */
export async function settleEmptyChunkedBody(
  headers: RequestHeaderBag,
  payload: Readable
): Promise<boolean> {
  if (!headerText(headers['transfer-encoding'])) return false;
  if (await streamHasData(payload)) return false;
  delete headers['transfer-encoding'];
  delete headers['content-length'];
  delete headers['content-type'];
  return true;
}
