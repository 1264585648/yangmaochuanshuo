import { fail } from './respond';

export const MAX_BODY_BYTES = 16 * 1024;

export type BodyResult =
  { ok: true; value: unknown; raw: string } | { ok: false; response: Response };

const tooLarge = (maxBytes: number) =>
  fail(413, 'payload_too_large', `Request body must not exceed ${maxBytes} bytes`);

/**
 * Read at most `maxBytes` from the body stream, so a chunked or mislabelled
 * upload is cut off early instead of being buffered whole. Returns null when
 * the body is larger than the cap.
 */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Read a JSON body with a size cap. An empty body is treated as `{}` so
 * action endpoints can be called without one.
 */
export async function readJsonBody(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<BodyResult> {
  const declared = request.headers.get('content-length');
  if (declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= maxBytes)) {
    return { ok: false, response: tooLarge(maxBytes) };
  }
  const raw = await readCapped(request, maxBytes);
  if (raw === null) return { ok: false, response: tooLarge(maxBytes) };
  if (raw.trim() === '') return { ok: true, value: {}, raw: '' };

  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) {
    return {
      ok: false,
      response: fail(415, 'unsupported_media_type', 'Content-Type must be application/json'),
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw), raw };
  } catch {
    return { ok: false, response: fail(400, 'invalid_json', 'Request body is not valid JSON') };
  }
}
