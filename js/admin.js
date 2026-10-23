// Owner-only page: compile, verify and deploy the RUNNER Genesis contract
// from the signed-in Privy wallet. Not linked from the app.
import { auth, shortAddress } from './auth.js';
import { NFT_CHAIN, NFT_CONTRACT, NFT_CREATION_CODE_KECCAK, NFT_BASE_URI, NFT_CONTRACT_URI, DEV_WALLET } from './config.js';
import { nativeBalance, waitForReceipt } from './nft.js';
import { formatEth } from './wallet.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let bytecode = null;
let balance = 0n;

$('#net').textContent = `${NFT_CHAIN.name} (chain ${NFT_CHAIN.id})`;
if (NFT_CONTRACT) {
  $('#deploy').innerHTML = `<span class="bad">A contract is already configured in the app: <span class="mono">${esc(NFT_CONTRACT)}</span>. Deploying again creates a second, separate collection.</span>`;
}

// ----- 1. sign in
async function refreshWho() {
  if (!auth.signedIn) { $('#who').textContent = auth.state.error || 'Not signed in.'; $('#b-signin').hidden = false; return; }
  $('#b-signin').hidden = true;
  $('#who').innerHTML = `Owner wallet: <span class="mono">${esc(auth.state.address)}</span><br>${esc(auth.state.user?.email || '')}`;
  try {
    balance = await nativeBalance(auth.state.address);
    $('#bal').innerHTML = `Test ETH balance: <b>${formatEth(balance, 6)} ETH</b> ${balance < 2n * 10n ** 15n ? '<span class="bad">— get test ETH from the faucet first (≈0.002 ETH is plenty)</span>' : '<span class="ok">✓ enough for deployment</span>'}`;
  } catch (e) { $('#bal').innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  updateDeploy();
}
auth.addEventListener('change', refreshWho);
$('#b-signin').onclick = async () => { try { await auth.login(); } catch (e) { $('#who').textContent = e.message; } };
auth.load().then(refreshWho);

// ----- 2. compile + fingerprint check
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
$('#b-compile').onclick = async () => {
  $('#b-compile').disabled = true;
  $('#compile').textContent = 'Loading the Solidity compiler (≈8 MB)…';
  try {
    const src = await (await fetch('contracts/RunnerGenesis.sol', { cache: 'no-store' })).text();
    const worker = new Worker('js/solc-worker.js');
    await new Promise((res, rej) => { worker.onmessage = (e) => (e.data.ready ? res() : null); worker.onerror = () => rej(new Error('Compiler failed to load')); });
    $('#compile').textContent = 'Compiling…';
    const input = {
      language: 'Solidity',
      sources: { 'RunnerGenesis.sol': { content: src } },
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['evm.bytecode.object'] } } },
    };
    const res = await new Promise((r) => { worker.onmessage = (e) => r(e.data); worker.postMessage(input); });
    worker.terminate();
    if (res.error) throw new Error(res.error);
    const out = JSON.parse(res.out);
    const errs = (out.errors || []).filter((e) => e.severity === 'error');
    if (errs.length) throw new Error(errs[0].formattedMessage);
    const code = out.contracts['RunnerGenesis.sol'].RunnerGenesis.evm.bytecode.object;
    const { keccak_256 } = await import('https://esm.sh/@noble/hashes@1.4.0/sha3');
    const fp = `0x${hex(keccak_256(Uint8Array.from(code.match(/../g), (h) => parseInt(h, 16))))}`;
    if (fp !== NFT_CREATION_CODE_KECCAK) throw new Error(`Fingerprint mismatch (${fp}). The contract source changed since it was tested — don't deploy.`);
    bytecode = code;
    $('#compile').innerHTML = `<span class="ok">✓ Matches the tested build</span> · ${code.length / 2} bytes · ${esc(res.version)}`;
  } catch (e) {
    $('#compile').innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    $('#b-compile').disabled = false;
  }
  updateDeploy();
};

// ----- 3. deploy
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const encAddress = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
function encStringTail(s) {
  const b = hex(new TextEncoder().encode(s));
  return word(b.length / 2) + b.padEnd(Math.ceil(b.length / 64) * 64, '0');
}
/** constructor(owner, treasury, royaltyReceiver, baseURI, contractURI) — all three roles go to the dev wallet. */
function constructorArgs() {
  const base = encStringTail(NFT_BASE_URI);
  return encAddress(DEV_WALLET) + encAddress(DEV_WALLET) + encAddress(DEV_WALLET)
    + word(5 * 32) + word(5 * 32 + base.length / 2) + base + encStringTail(NFT_CONTRACT_URI);
}
function updateDeploy() {
  $('#b-deploy').disabled = !(auth.signedIn && bytecode && balance >= 10n ** 15n);
}
$('#b-deploy').onclick = async () => {
  if (!confirm(`Deploy RUNNER Genesis to ${NFT_CHAIN.name} from ${shortAddress(auth.state.address)}?\n\nOwner, treasury and 5% royalty receiver: the dev wallet ${DEV_WALLET}. Your signed-in wallet only pays the network fee.`)) return;
  $('#b-deploy').disabled = true;
  $('#deploy').textContent = 'Confirm the transaction in the Privy window…';
  try {
    const hash = await auth.sendTx({ data: `0x${bytecode}${constructorArgs()}`, chainId: NFT_CHAIN.id });
    $('#deploy').innerHTML = `Sent — waiting for the network… <span class="mono">${esc(hash)}</span>`;
    const rcpt = await waitForReceipt(hash);
    if (rcpt.status !== '0x1' || !rcpt.contractAddress) throw new Error(`Deployment failed on-chain (tx ${hash}).`);
    $('#deploy').innerHTML = `
      <div class="result">
        <b class="ok">✓ RUNNER Genesis is live on ${esc(NFT_CHAIN.name)}</b>
        <span>Contract address — send this to Claude to open the shop:</span>
        <span class="mono" style="font-size:15px">${esc(rcpt.contractAddress)}</span>
        <button class="btn pill" id="b-copy">Copy address</button>
        <span class="muted small">Transaction: <span class="mono">${esc(hash)}</span></span>
      </div>`;
    $('#b-copy').onclick = () => navigator.clipboard.writeText(rcpt.contractAddress);
  } catch (e) {
    const m = String(e?.message || e);
    $('#deploy').innerHTML = `<span class="bad">${/reject|denied|cancel/i.test(m) ? 'Cancelled — nothing was deployed.' : esc(m.slice(0, 200))}</span>`;
    updateDeploy();
  }
};
