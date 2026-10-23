// Phone-app-only fair-play helpers (the website returns nothing here):
//  - the step counter during a recording (Android step sensor / iPhone CMPedometer),
//    which the rewards server compares with the GPS pace;
//  - a device proof for each run upload (Google Play Integrity / Apple App Attest),
//    signed over the run's digest, so the server knows the run came from the
//    genuine RUNNER app on an unmodified phone.
// Native side: RunnerNativePlugin (android/…/RunnerNativePlugin.java, ios/App/App/RunnerNativePlugin.swift).
import { Native, platform } from './geo.js';
import { PLAY_CLOUD_PROJECT_NUMBER } from './config.js';

let stepsStarted = null;

/** Starts counting steps (asks for the motion / physical-activity permission the first time). */
export function startSteps() {
  if (!Native) return;
  stepsStarted = Native.startSteps().catch(() => ({ unavailable: true }));
}

/**
 * Stops counting. Resolves with what the server expects in run.steps:
 * { samples: [[t, steps since start], …] } or { denied | unavailable | lost: true };
 * null on the website.
 */
export function stopSteps() {
  if (!Native || !stepsStarted) return Promise.resolve(null);
  const started = stepsStarted;
  stepsStarted = null;
  return started.then(async () => {
    const r = await Native.stopSteps();
    if (r?.denied) return { denied: true };
    if (r?.unavailable) return { unavailable: true };
    const samples = (r?.samples || []).map(([t, n]) => [Math.round(t), Math.round(n)]);
    return samples.length >= 2 ? { samples } : { lost: true };
  }).catch(() => ({ lost: true }));
}

/** base64url(sha256(text)) — the digest the device proof signs (api/_lib/attest.js runDigest). */
export async function runDigest(text) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...h)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Device proof for a run digest, or null on the website. Never throws. */
export async function deviceProof(digest) {
  if (!Native) return null;
  try {
    if (platform === 'android') {
      if (!PLAY_CLOUD_PROJECT_NUMBER) return { platform, error: 'Play Integrity not set up in the app' };
      const { token } = await Native.integrityToken({ nonce: digest, cloudProjectNumber: PLAY_CLOUD_PROJECT_NUMBER });
      return { platform, token };
    }
    return { platform, ...(await Native.appAttest({ challenge: digest })) }; // { keyId, attestation | assertion }
  } catch (e) {
    return { platform, error: String(e?.message || e).slice(0, 80) };
  }
}

/** iPhone: forget the App Attest key so the next upload creates and certifies a new one. */
export const resetDeviceProof = () => (platform === 'ios' ? Native.resetAppAttest().catch(() => {}) : Promise.resolve());
