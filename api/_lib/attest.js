// Device attestation for the rewards server: proof that a run was uploaded by the
// genuine RUNNER phone app on an unmodified phone.
//
//   Android: Google Play Integrity. The app asks Google for a token whose nonce is
//            the run's digest; the server has Google decrypt it and checks the
//            verdict (app installed from Play and unmodified, device passes integrity).
//   iPhone:  Apple App Attest. On first use the app creates a key in the Secure
//            Enclave and Apple certifies it (attestation); the server checks Apple's
//            certificate chain and stores the key. Every later run is signed with that
//            key (assertion) over the run's digest.
//
// Both bind the proof to the exact run (runPayload in js/rules.js), so a proof can't
// be reused for another run.
//
// Vercel env vars (see README "Device attestation"):
//   PLAY_INTEGRITY_SA    Google service-account JSON (plain or base64) with Play Integrity access
//   APPLE_TEAM_ID        10-character Apple Developer Team ID
//   APP_ATTEST_ALLOW_DEV=1  also accept development keys (Xcode debug builds), for testing only
import { createHash, createSign, createPublicKey, verify as verifySig, X509Certificate } from 'node:crypto';

export const APP_ID = 'fun.runearn.app';
const env = globalThis.process?.env || {};
const TESTING = env.VERCEL_ENV !== 'production' && env.REWARDS_STORE === 'memory';
const MAX_TOKEN_AGE_MS = 15 * 60e3;

const sha256 = (...parts) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };
const b64url = (s) => String(s || '').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
/** Digest the app signs for a run: base64url(sha256(runPayload)). */
export const runDigest = (payload) => sha256(payload).toString('base64url');

const playAccount = () => {
  const raw = (env.PLAY_INTEGRITY_SA || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString()); } catch { return null; }
};
const teamId = () => (env.APPLE_TEAM_ID || '').trim();
export const androidConfigured = () => Boolean((TESTING && env.REWARDS_FAKE_INTEGRITY) || playAccount()?.private_key);
export const iosConfigured = () => /^[A-Z0-9]{10}$/.test(teamId());

// ------------------------------------------------------------------ Android: Play Integrity
let googleToken = null; // { value, exp }
async function googleAccessToken() {
  if (googleToken && googleToken.exp > Date.now() + 60e3) return googleToken.value;
  const sa = playAccount();
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/playintegrity',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description || j.error || r.status}`);
  googleToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return googleToken.value;
}

async function decodePlayToken(token) {
  if (TESTING && env.REWARDS_FAKE_INTEGRITY) {
    const fake = JSON.parse(env.REWARDS_FAKE_INTEGRITY)[token];
    if (!fake) throw Object.assign(new Error('bad token'), { invalid: true });
    return fake;
  }
  const r = await fetch(`https://playintegrity.googleapis.com/v1/${APP_ID}:decodeIntegrityToken`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await googleAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ integrity_token: token }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 400) throw Object.assign(new Error('bad token'), { invalid: true });
  if (!r.ok || !j.tokenPayloadExternal) throw new Error(`Play Integrity error: ${j.error?.message || r.status}`);
  return j.tokenPayloadExternal;
}

/** Checks a decoded Play Integrity verdict for this run. Returns null if fine, else the reason. */
export function playVerdictProblem(v, digest, now = Date.now()) {
  const req = v?.requestDetails || {};
  if (req.requestPackageName !== APP_ID) return 'The proof is for a different app.';
  if (b64url(req.nonce) !== digest) return "The proof doesn't belong to this run.";
  if (!(Math.abs(now - Number(req.timestampMillis)) < MAX_TOKEN_AGE_MS)) return 'The proof is too old — try uploading again.';
  if (v.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') return 'This copy of RUNNER is not the one from Google Play. Install RUNNER from Google Play to earn.';
  if (!(v.deviceIntegrity?.deviceRecognitionVerdict || []).includes('MEETS_DEVICE_INTEGRITY')) return 'This phone failed Google’s integrity check (rooted, modified or an emulator).';
  return null;
}

// ------------------------------------------------------------------ iPhone: App Attest
const APPLE_ROOT = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`; // Apple App Attestation Root CA, SHA-256 1C:B9:82:3B:…:42:C9:32
const appleRoot = () => new X509Certificate(TESTING && env.REWARDS_TEST_APPLE_ROOT ? env.REWARDS_TEST_APPLE_ROOT : APPLE_ROOT);
const AAGUID_PROD = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
const AAGUID_DEV = Buffer.from('appattestdevelop');
const NONCE_OID = Buffer.from('06092a864886f763640802', 'hex'); // 1.2.840.113635.100.8.2

/** Minimal CBOR decoder (maps, arrays, byte/text strings, integers) for App Attest objects. */
export function cbor(buf) {
  let i = 0;
  const len = (info) => {
    if (info < 24) return info;
    const n = 1 << (info - 24);
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + buf[i++];
    return v;
  };
  const item = () => {
    const b = buf[i++], major = b >> 5, n = len(b & 31);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2) { const v = buf.subarray(i, i + n); i += n; return Buffer.from(v); }
    if (major === 3) { const v = buf.subarray(i, i + n).toString('utf8'); i += n; return v; }
    if (major === 4) return Array.from({ length: n }, item);
    if (major === 5) { const o = {}; for (let k = 0; k < n; k++) { const key = item(); o[key] = item(); } return o; }
    throw new Error('Unsupported CBOR');
  };
  return item();
}

// DER: read one tag-length-value at `o` → { tag, start, end } (content bounds).
function tlv(buf, o) {
  const tag = buf[o];
  let l = buf[o + 1], start = o + 2;
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let k = 0; k < n; k++) l = l * 256 + buf[start + k]; start += n; }
  return { tag, start, end: start + l };
}
/** The nonce Apple put in the credential certificate (extension 1.2.840.113635.100.8.2). */
function certNonce(raw) {
  const at = raw.indexOf(NONCE_OID);
  if (at < 0) return null;
  let x = tlv(raw, at + NONCE_OID.length);
  if (x.tag === 0x01) x = tlv(raw, x.end);       // "critical" flag
  if (x.tag !== 0x04) return null;                // OCTET STRING wrapping the value
  const seq = tlv(raw, x.start);                  // SEQUENCE
  const tagged = tlv(raw, seq.start);             // [1]
  const oct = tlv(raw, tagged.start);             // OCTET STRING nonce
  return seq.tag === 0x30 && tagged.tag === 0xa1 && oct.tag === 0x04 ? raw.subarray(oct.start, oct.end) : null;
}

/**
 * Verifies an App Attest attestation (first upload from a new install).
 * Returns { key: { pub, counter } } or { problem }.
 */
export function verifyAppleAttestation({ keyId, attestation }, clientDataHash, now = Date.now()) {
  let obj;
  try { obj = cbor(Buffer.from(String(attestation || ''), 'base64')); } catch { return { problem: 'Unreadable App Attest attestation.' }; }
  const x5c = obj?.attStmt?.x5c, authData = obj?.authData;
  if (obj?.fmt !== 'apple-appattest' || !Array.isArray(x5c) || x5c.length < 2 || !Buffer.isBuffer(authData) || authData.length < 55) return { problem: 'Unreadable App Attest attestation.' };
  let certs;
  try { certs = x5c.map((c) => new X509Certificate(c)); } catch { return { problem: 'Unreadable App Attest certificate.' }; }
  const chain = [...certs, appleRoot()];
  for (let k = 0; k < chain.length - 1; k++) {
    if (!chain[k].verify(chain[k + 1].publicKey)) return { problem: 'App Attest certificate is not from Apple.' };
  }
  for (const c of certs) if (!(Date.parse(c.validFrom) <= now && now <= Date.parse(c.validTo))) return { problem: 'App Attest certificate has expired.' };
  const leaf = certs[0];
  const nonce = certNonce(leaf.raw);
  if (!nonce || !nonce.equals(sha256(authData, clientDataHash))) return { problem: "The proof doesn't belong to this run." };
  const spki = leaf.publicKey.export({ type: 'spki', format: 'der' });
  const point = spki.subarray(spki.length - 65);
  const id = Buffer.from(String(keyId || ''), 'base64');
  if (!sha256(point).equals(id)) return { problem: 'App Attest key mismatch.' };
  if (!authData.subarray(0, 32).equals(sha256(`${teamId()}.${APP_ID}`))) return { problem: 'The proof is for a different app.' };
  if (authData.readUInt32BE(33) !== 0) return { problem: 'App Attest key was used before.' };
  const aaguid = authData.subarray(37, 53);
  if (!aaguid.equals(AAGUID_PROD) && !(env.APP_ATTEST_ALLOW_DEV === '1' && aaguid.equals(AAGUID_DEV))) return { problem: 'This is a development build of RUNNER. Install RUNNER from the App Store or TestFlight to earn.' };
  const credLen = authData.readUInt16BE(53);
  if (!authData.subarray(55, 55 + credLen).equals(id)) return { problem: 'App Attest key mismatch.' };
  return { key: { pub: spki.toString('base64'), counter: 0 } };
}

/** Verifies an App Attest assertion with a stored key. Returns { counter } or { problem }. */
export function verifyAppleAssertion({ assertion }, key, clientDataHash) {
  let obj;
  try { obj = cbor(Buffer.from(String(assertion || ''), 'base64')); } catch { return { problem: 'Unreadable App Attest assertion.' }; }
  const sig = obj?.signature, authData = obj?.authenticatorData;
  if (!Buffer.isBuffer(sig) || !Buffer.isBuffer(authData) || authData.length < 37) return { problem: 'Unreadable App Attest assertion.' };
  const pub = createPublicKey({ key: Buffer.from(key.pub, 'base64'), format: 'der', type: 'spki' });
  let valid = false;
  try { valid = verifySig('sha256', Buffer.concat([authData, clientDataHash]), pub, sig); } catch { /* malformed signature */ }
  if (!valid) return { problem: "The proof doesn't belong to this run." };
  if (!authData.subarray(0, 32).equals(sha256(`${teamId()}.${APP_ID}`))) return { problem: 'The proof is for a different app.' };
  const counter = authData.readUInt32BE(33);
  if (!(counter > key.counter)) return { problem: 'This proof was already used.' };
  return { counter };
}

// ------------------------------------------------------------------ entry point
/**
 * Checks the device proof that came with a run. `store` is api/_lib/store.js.
 * Returns { verified, platform, reason } — or { retry, reason } when Google/Apple
 * couldn't be reached (try again later), or { unknownKey } when an iPhone key isn't
 * registered (the app then creates a new one).
 */
export async function checkDevice(att, payload, store) {
  const platform = att?.platform === 'android' || att?.platform === 'ios' ? att.platform : null;
  if (!platform) return { verified: false, platform: null, reason: 'Real RUNNER is earned only with the RUNNER phone app (iPhone or Android).' };
  if (att.error) return { verified: false, platform, reason: `The phone couldn't prove it's running the genuine RUNNER app (${String(att.error).slice(0, 80)}).` };
  const digest = runDigest(payload);
  if (platform === 'android') {
    if (!androidConfigured()) return { verified: false, platform, reason: 'Android verification is not set up on the server yet.' };
    const token = String(att.token || '');
    if (!token || token.length > 20000) return { verified: false, platform, reason: 'Missing Play Integrity token.' };
    let verdict;
    try { verdict = await decodePlayToken(token); } catch (e) {
      return e.invalid ? { verified: false, platform, reason: 'Invalid Play Integrity token.' } : { retry: true, platform, reason: "Couldn't reach Google to verify the phone — your run will be retried." };
    }
    const problem = playVerdictProblem(verdict, digest);
    if (problem) return { verified: false, platform, reason: problem };
    if (!(await store.setNX(`rw:att:${sha256(token).toString('hex').slice(0, 32)}`, 1, 864e5))) return { verified: false, platform, reason: 'This proof was already used.' };
    return { verified: true, platform };
  }
  if (!iosConfigured()) return { verified: false, platform, reason: 'iPhone verification is not set up on the server yet.' };
  const keyId = String(att.keyId || '');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(keyId)) return { verified: false, platform, reason: 'Missing App Attest key.' };
  const clientDataHash = sha256(digest);
  const storeKey = `rw:aa:${keyId}`;
  if (att.attestation) {
    const out = verifyAppleAttestation(att, clientDataHash);
    if (out.problem) return { verified: false, platform, reason: out.problem };
    if (!(await store.setNX(storeKey, { ...out.key, at: Date.now() }, 10 * 365 * 864e5))) return { verified: false, platform, reason: 'App Attest key was registered before.' };
    return { verified: true, platform };
  }
  const key = await store.get(storeKey);
  if (!key) return { unknownKey: true, platform, reason: 'This iPhone needs to verify the app again.' };
  const out = verifyAppleAssertion(att, key, clientDataHash);
  if (out.problem) return { verified: false, platform, reason: out.problem };
  await store.set(storeKey, { ...key, counter: out.counter });
  return { verified: true, platform };
}
