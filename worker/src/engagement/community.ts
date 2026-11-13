/* The community (私域) group shown on the site: a title, a short note, an
 * optional https invite link and an optional QR image. WeChat group QR codes
 * expire after 7 days, so the image carries an expiry and is hidden after it. */
import { z } from 'zod';
import { COMMUNITY_QR_MAX_BYTES } from '../config';

type DB = Env['DB'];
type Statement = ReturnType<DB['prepare']>;

const SETTING_KEY = 'community';
const QR_KEY = 'community-qr';

const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(500)
  .refine((v) => new URL(v).protocol === 'https:', 'must be an https URL');

const qrUpload = z.strictObject({
  // Base64 without a data: prefix; the type is sniffed from the bytes, not trusted.
  base64: z
    .string()
    .min(8)
    .max(Math.ceil((COMMUNITY_QR_MAX_BYTES * 4) / 3) + 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const communityUpdateSchema = z.strictObject({
  enabled: z.boolean(),
  title: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).default(''),
  link: httpsUrl.nullable().default(null),
  linkLabel: z.string().trim().max(20).default(''),
  qrExpiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
  /** Omit to keep the current image, null to remove it. */
  qr: qrUpload.nullable().optional(),
});

export type CommunityUpdate = z.infer<typeof communityUpdateSchema>;

export interface CommunitySettings {
  enabled: boolean;
  title: string;
  description: string;
  link: string | null;
  linkLabel: string;
  qrExpiresAt: string | null;
  updatedAt: string;
}

/** Admin view: the settings plus a fingerprint of the stored image. */
export interface ManagedCommunity extends CommunitySettings {
  qr: { sha256: string; contentType: string } | null;
}

/** Public view. `qr` is null when there is no image or it has expired. */
export interface PublicCommunity {
  title: string;
  description: string;
  link: string | null;
  linkLabel: string;
  qr: { src: string; expiresAt: string | null } | null;
}

export type QrType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Content type from magic bytes. SVG and anything else are refused. */
export function sniffImage(bytes: Uint8Array): QrType | null {
  const at = (i: number, ...expected: number[]) => expected.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const settingsShape = z.object({
  enabled: z.boolean(),
  title: z.string(),
  description: z.string(),
  link: z.string().nullable(),
  linkLabel: z.string(),
  qrExpiresAt: z.string().nullable(),
});

interface AssetRow {
  content_type: string;
  sha256: string;
}

export async function readCommunity(db: DB): Promise<ManagedCommunity | null> {
  const [setting, asset] = await db.batch([
    db.prepare('SELECT value, updated_at FROM site_settings WHERE key = ?').bind(SETTING_KEY),
    db.prepare('SELECT content_type, sha256 FROM site_assets WHERE key = ?').bind(QR_KEY),
  ]);
  const row = setting?.results?.[0] as { value: string; updated_at: string } | undefined;
  if (!row) return null;
  let parsed: z.infer<typeof settingsShape>;
  try {
    parsed = settingsShape.parse(JSON.parse(row.value));
  } catch (error: unknown) {
    console.error('community_settings_corrupt', { error: String(error) });
    return null;
  }
  const image = asset?.results?.[0] as AssetRow | undefined;
  return {
    ...parsed,
    updatedAt: row.updated_at,
    qr: image ? { sha256: image.sha256, contentType: image.content_type } : null,
  };
}

const QR_PATH = '/api/community/qr';

/** True while the QR image may be shown. */
export const qrIsCurrent = (c: ManagedCommunity, now: Date): boolean =>
  c.qr !== null && (c.qrExpiresAt === null || Date.parse(c.qrExpiresAt) > now.getTime());

export function toPublicCommunity(c: ManagedCommunity, now: Date): PublicCommunity | null {
  if (!c.enabled) return null;
  const qr =
    c.qr && qrIsCurrent(c, now)
      ? { src: `${QR_PATH}?v=${c.qr.sha256.slice(0, 12)}`, expiresAt: c.qrExpiresAt }
      : null;
  if (!qr && !c.link) return null;
  return { title: c.title, description: c.description, link: c.link, linkLabel: c.linkLabel, qr };
}

export async function readQrImage(
  db: DB,
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  const row = await db
    .prepare('SELECT content_type, data FROM site_assets WHERE key = ?')
    .bind(QR_KEY)
    .first<{ content_type: string; data: string }>();
  const bytes = row ? decodeBase64(row.data) : null;
  return row && bytes ? { contentType: row.content_type, bytes } : null;
}

export interface PreparedQr {
  base64: string;
  contentType: QrType;
  sha256: string;
}

/** Validate an upload: real base64, within the size cap, and a known raster type. */
export async function prepareQr(
  base64: string,
): Promise<{ ok: true; qr: PreparedQr } | { ok: false; message: string }> {
  const bytes = decodeBase64(base64);
  if (!bytes) return { ok: false, message: 'qr.base64 is not valid base64' };
  if (bytes.byteLength > COMMUNITY_QR_MAX_BYTES) {
    return { ok: false, message: `QR image must not exceed ${COMMUNITY_QR_MAX_BYTES} bytes` };
  }
  const contentType = sniffImage(bytes);
  if (!contentType) return { ok: false, message: 'QR image must be PNG, JPEG or WebP' };
  return { ok: true, qr: { base64, contentType, sha256: await sha256Hex(bytes) } };
}

/** Statements that store the settings and apply the image change, if any. */
export function communityWrites(
  db: DB,
  settings: CommunitySettings,
  qr: PreparedQr | null | undefined,
): Statement[] {
  const { updatedAt, ...value } = settings;
  const statements = [
    db
      .prepare(
        `INSERT INTO site_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3`,
      )
      .bind(SETTING_KEY, JSON.stringify(value), updatedAt),
  ];
  if (qr === null) {
    statements.push(db.prepare('DELETE FROM site_assets WHERE key = ?').bind(QR_KEY));
  } else if (qr) {
    statements.push(
      db
        .prepare(
          `INSERT INTO site_assets (key, content_type, data, sha256, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (key) DO UPDATE SET content_type = ?2, data = ?3, sha256 = ?4, updated_at = ?5`,
        )
        .bind(QR_KEY, qr.contentType, qr.base64, qr.sha256, updatedAt),
    );
  }
  return statements;
}
