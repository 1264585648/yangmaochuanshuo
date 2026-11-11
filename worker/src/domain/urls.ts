/**
 * True when `value` is an https URL whose host is one of `domains` or a
 * subdomain of one. Matching is on whole labels, so `evil-example.com` and
 * `example.com.evil.com` do not match `example.com`.
 */
export function isOfficialUrl(value: string, domains: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return domains.some((d) => {
    const domain = d.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  });
}
