/**
 * Public suffixes and shared hosting platforms where anyone can publish under
 * the domain. Registering one as a provider domain would let arbitrary pages
 * pass the official-domain check, so only exact hosts beneath them are
 * accepted (e.g. `vendor.github.io`, not `github.io`).
 *
 * Not a full Public Suffix List; it covers common cases. Provider domains are
 * admin-managed, so this guards against mistakes rather than attackers.
 */
const SHARED_SUFFIXES = [
  // Multi-part country suffixes
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.cn',
  'net.cn',
  'org.cn',
  'edu.cn',
  'gov.cn',
  'com.hk',
  'com.tw',
  'co.jp',
  'ne.jp',
  'or.jp',
  'co.kr',
  'com.au',
  'net.au',
  'com.br',
  'co.in',
  'com.sg',
  'co.nz',
  // Shared hosting and user-content platforms
  'github.io',
  'githubusercontent.com',
  'gitlab.io',
  'pages.dev',
  'workers.dev',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'web.app',
  'firebaseapp.com',
  'appspot.com',
  'googleusercontent.com',
  'blogspot.com',
  'azurewebsites.net',
  'cloudfront.net',
  'amazonaws.com',
  'surge.sh',
  'glitch.me',
  'repl.co',
  'notion.site',
  'wordpress.com',
  'substack.com',
  'medium.com',
];

/** True when `domain` is itself a shared suffix (not a host beneath one). */
export function isSharedHost(domain: string): boolean {
  const d = domain.toLowerCase();
  return SHARED_SUFFIXES.includes(d);
}
