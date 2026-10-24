// Minimal Ethereum helpers for the rewards server: keccak, addresses,
// EIP-712 claim signatures (must match RunnerToken.claim) and personal_sign checks.
import { keccak_256 } from './noble/sha3.js';
import { getPublicKey, signAsync, Signature } from './noble/secp256k1.js';

const enc = new TextEncoder();
export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export function fromHex(h) {
  const s = String(h).replace(/^0x/, '');
  if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error('Bad hex');
  return Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16));
}
export const keccak = (data) => keccak_256(typeof data === 'string' ? enc.encode(data) : data);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));

export function addressOfKey(privHex) {
  return `0x${toHex(keccak(getPublicKey(fromHex(privHex), false).slice(1)).slice(12))}`;
}

const DOMAIN_TYPEHASH = toHex(keccak('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
const CLAIM_TYPEHASH = toHex(keccak('Claim(address account,uint256 totalEarned,uint256 deadline,bool instant)'));

export function claimDigest({ token, chainId, account, totalWei, deadline, instant = false }) {
  const domain = keccak(fromHex(DOMAIN_TYPEHASH + toHex(keccak('RUNNER')) + toHex(keccak('1')) + word(chainId) + addrWord(token)));
  const struct = keccak(fromHex(CLAIM_TYPEHASH + addrWord(account) + word(totalWei) + word(deadline) + word(instant ? 1 : 0)));
  return keccak(fromHex(`1901${toHex(domain)}${toHex(struct)}`));
}

/** Signs a 32-byte digest. Returns Solidity-style { v, r, s } (low-s, v = 27/28). */
export async function signDigest(digest, privHex) {
  const sig = await signAsync(digest, fromHex(privHex));
  return { v: 27 + sig.recovery, r: `0x${sig.r.toString(16).padStart(64, '0')}`, s: `0x${sig.s.toString(16).padStart(64, '0')}` };
}

/** Address that produced a 65-byte signature (r‖s‖v) over `digest`, or null. */
export function recoverAddress(digest, sigHex) {
  try {
    const b = fromHex(sigHex);
    if (b.length !== 65) return null;
    let v = b[64];
    if (v >= 27) v -= 27;
    if (v !== 0 && v !== 1) return null;
    const sig = Signature.fromCompact(b.slice(0, 64)).addRecoveryBit(v);
    if (sig.hasHighS()) return null;
    const pub = sig.recoverPublicKey(digest).toRawBytes(false);
    return `0x${toHex(keccak(pub.slice(1)).slice(12))}`;
  } catch {
    return null;
  }
}

/** EIP-191 personal_sign digest, as wallets compute it for a text message. */
export function personalDigest(message) {
  const m = enc.encode(message);
  const prefix = enc.encode(`\x19Ethereum Signed Message:\n${m.length}`);
  const all = new Uint8Array(prefix.length + m.length);
  all.set(prefix); all.set(m, prefix.length);
  return keccak(all);
}
