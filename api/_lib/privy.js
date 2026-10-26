// Privy server calls for in-app account deletion (App Store rule 5.1.1(v), Play's deletion policy):
// check a user's Privy access token, then delete that Privy user.
//
// Vercel settings (Privy dashboard → your app → Settings → Basics / API keys):
//   PRIVY_VERIFICATION_KEY  the "Verification key" (public, PEM: -----BEGIN PUBLIC KEY-----…)
//   PRIVY_APP_SECRET        the app secret (private — add it in Vercel only, never share it)
const env = globalThis.process?.env || {};
const TESTING = env.VERCEL_ENV !== 'production' && env.REWARDS_STORE === 'memory';

export const privyConfigured = () => Boolean(env.PRIVY_APP_SECRET && env.PRIVY_VERIFICATION_KEY);

const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

let keyCache = null; // { pem, key }
async function verificationKey() {
  const pem = String(env.PRIVY_VERIFICATION_KEY).replace(/\\n/g, '\n');
  if (keyCache?.pem === pem) return keyCache.key;
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  keyCache = { pem, key };
  return key;
}

/**
 * Checks a Privy access token (ES256 JWT): signature, issuer, audience (our app) and expiry.
 * Returns the Privy user id (did:privy:…), or throws.
 */
export async function verifyAccessToken(token, appId) {
  const [h, p, sig] = String(token || '').split('.');
  if (!h || !p || !sig) throw new Error('Not a token');
  const header = b64urlJson(h);
  if (header.alg !== 'ES256') throw new Error('Unexpected algorithm');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await verificationKey(), b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('Bad signature');
  const claims = b64urlJson(p);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== 'privy.io' || !aud.includes(appId)) throw new Error('Token is for another app');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('Token expired');
  if (!/^did:privy:/.test(String(claims.sub))) throw new Error('No user in token');
  return claims.sub;
}

/** Deletes a Privy user (their sign-in and Privy-held wallet access). */
export async function deletePrivyUser(userId, appId) {
  if (TESTING && env.REWARDS_FAKE_PRIVY_DELETE) return; // tests don't call Privy
  const r = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${btoa(`${appId}:${env.PRIVY_APP_SECRET}`)}`, 'privy-app-id': appId },
  });
  if (!r.ok && r.status !== 404) throw new Error(`Privy couldn't delete the account (${r.status}).`);
}
