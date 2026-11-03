/**
 * Fastify answers 400 FST_ERR_CTP_EMPTY_JSON_BODY to a request that says
 * `Content-Type: application/json` but sends no body (`Content-Length: 0`, or no length at all).
 * Many clients do that for action routes without a payload
 * (POST /in-person/appointments/:id/undo-no-show, ...), so the action failed before it reached
 * its guard or handler.
 *
 * For such a request the content type is dropped before parsing: there is no body to parse, so the
 * route sees `body === undefined`, exactly as if the client had sent no content type. A request
 * with a body (or a chunked one, whose length is unknown) is left as it is.
 */
export type RequestHeaderBag = Record<string, string | string[] | undefined>;

function headerText(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? '';
}

/**
 * True when the request declares JSON but carries no body: `Content-Length: 0`, or neither a
 * length nor a transfer encoding (HTTP/1.1: no message body; Fastify uses the same rule).
 */
export function isEmptyJsonBodyRequest(headers: RequestHeaderBag): boolean {
  const contentType = headerText(headers['content-type']);
  if (!contentType.startsWith('application/json')) return false;
  if (headerText(headers['transfer-encoding'])) return false;
  const length = headerText(headers['content-length']);
  return length === '' || length === '0';
}

/**
 * Removes the JSON content type of an empty-body request (in place: Fastify reads the request's
 * own header object). Returns true when it did.
 */
export function dropEmptyJsonContentType(headers: RequestHeaderBag): boolean {
  if (!isEmptyJsonBodyRequest(headers)) return false;
  delete headers['content-type'];
  return true;
}
