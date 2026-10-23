// Owner-only page: compile, verify and deploy RUNNER's contracts from the
// signed-in Privy wallet. Not linked from the app. Whoever deploys only pays
// the network fee — every role goes to the wallets fixed in config.js.
import { auth, shortAddress } from './auth.js';
import {
  NFT_CHAIN, NFT_CONTRACT, NFT_CREATION_CODE_KECCAK, NFT_BASE_URI, NFT_CONTRACT_URI, DEV_WALLET,
  TOKEN_CHAIN, TOKEN_CONTRACT, TOKEN_CREATION_CODE_KECCAK, TEAM_WALLET,
} from './config.js';
import { formatEth } from './wallet.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const encAddress = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
function encStringTail(s) {
  const b = hex(new TextEncoder().encode(s));
  return word(b.length / 2) + b.padEnd(Math.ceil(b.length / 64) * 64, '0');
}

const CONTRACTS = {
  nft: {
    title: 'RUNNER Genesis',
    file: 'RunnerGenesis.sol', contract: 'RunnerGenesis',
    chain: NFT_CHAIN, configured: NFT_CONTRACT, fingerprint: NFT_CREATION_CODE_KECCAK,
    minBalance: 10n ** 15n, goodBalance: 2n * 10n ** 15n,
    about: `The sneaker NFT collection. The dev wallet <span class="mono">${shortAddress(DEV_WALLET)}</span> becomes its owner, treasury (mint payments) and 5% royalty receiver — and can edit the collection on OpenSea.`,
    roles: `Owner, treasury and 5% royalty receiver: the dev wallet ${DEV_WALLET}.`,
    next: 'send this to Claude to open the shop',
    /** constructor(owner, treasury, royaltyReceiver, baseURI, contractURI) */
    args() {
      const base = encStringTail(NFT_BASE_URI);
      return encAddress(DEV_WALLET) + encAddress(DEV_WALLET) + encAddress(DEV_WALLET)
        + word(5 * 32) + word(5 * 32 + base.length / 2) + base + encStringTail(NFT_CONTRACT_URI);
    },
  },
  token: {
    title: 'RUNNER token',
    file: 'RunnerToken.sol', contract: 'RunnerToken',
    chain: TOKEN_CHAIN, configured: TOKEN_CONTRACT, fingerprint: TOKEN_CREATION_CODE_KECCAK,
    minBalance: 5n * 10n ** 14n, goodBalance: 10n ** 15n,
    about: `The ERC-20 token, fixed supply of 1,000,000,000 RUNNER: 800M run-reward pool (locked in the contract, paid only through verified claims), 100M liquidity to the dev wallet <span class="mono">${shortAddress(DEV_WALLET)}</span>, 100M team to <span class="mono">${shortAddress(TEAM_WALLET)}</span>. 4% tax on buys/sells (2% protocol, 2% to holders of 300k+), fixed forever. Run rewards: 10M/day from launch, halving every 30 days, floor 100k/day. The dev wallet becomes owner. No more tokens can ever be created. <a href="https://github.com/0xtenang/Runner/blob/main/AUDIT.md" target="_blank" rel="noopener">Read the audit report first.</a>`,
    roles: `Owner + 100M liquidity: dev wallet ${DEV_WALLET}\n100M team: ${TEAM_WALLET}\n800M run rewards: locked in the contract`,
    next: 'send this to Claude to connect the app and the claim server',
    /** constructor(owner, liquidityWallet, teamWallet) */
    args: () => encAddress(DEV_WALLET) + encAddress(DEV_WALLET) + encAddress(TEAM_WALLET),
  },
};

let kind = new URLSearchParams(location.search).get('c') === 'token' ? 'token' : 'nft';
let bytecode = null;
let balance = 0n;
const C = () => CONTRACTS[kind];

async function rpc(method, params) {
  let last;
  for (const url of C().chain.rpcUrls.default.http) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw new Error(`Couldn't reach ${C().chain.name} (${last?.message || 'network error'})`);
}
async function waitForReceipt(hash, timeoutMs = 180000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (r) return r;
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  throw new Error(`Still waiting after ${timeoutMs / 1000}s — check the transaction ${hash} in the explorer.`);
}

function render() {
  const c = C();
  const ethName = c.chain.testnet ? 'test ETH' : 'ETH';
  document.querySelectorAll('#pick button').forEach((b) => b.classList.toggle('on', b.dataset.c === kind));
  $('#about').innerHTML = `${c.about} Any funded wallet can send the deployment; it gets no control.`;
  $('#net').textContent = `${c.chain.name} (chain ${c.chain.id})${c.chain.testnet ? '' : ' — real network, real ETH'}`;
  $('#net').className = c.chain.testnet ? 'mono' : 'mono bad';
  $('#s1').textContent = `Sign in with a wallet that has ${ethName}`;
  $('#src').textContent = `contracts/${c.file}`;
  $('#fee').textContent = c.chain.testnet
    ? 'Costs a small network fee in test ETH. Get free test ETH from the Robinhood Chain Testnet faucet first (it may need a VPN in Indonesia).'
    : `Costs a small network fee in real ETH on ${c.chain.name} (well under 0.001 ETH). This cannot be undone — the supply and wallets above are permanent.`;
  $('#b-deploy').textContent = `Deploy ${c.title}`;
  $('#compile').textContent = '';
  $('#b-compile').disabled = false;
  $('#deploy').innerHTML = c.configured
    ? `<span class="bad">A ${esc(c.title)} contract is already configured in the app: <span class="mono">${esc(c.configured)}</span>. Deploying again creates a second, separate contract.</span>`
    : '';
  bytecode = null;
  $('#server').hidden = kind !== 'token';
  $('#launch').hidden = kind !== 'token' || !TOKEN_CONTRACT;
  if (kind === 'token') refreshServer();
  refreshWho();
}

$('#pick').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]');
  if (!b || b.dataset.c === kind) return;
  kind = b.dataset.c;
  history.replaceState(null, '', kind === 'token' ? '?c=token' : location.pathname);
  render();
});

// ----- 1. sign in
async function refreshWho() {
  if (!auth.signedIn) { $('#who').textContent = auth.state.error || 'Not signed in.'; $('#b-signin').hidden = false; $('#bal').textContent = ''; updateDeploy(); return; }
  $('#b-signin').hidden = true;
  $('#who').innerHTML = `Deploying wallet: <span class="mono">${esc(auth.state.address)}</span><br>${esc(auth.state.user?.email || '')}`;
  const c = C();
  const ethName = c.chain.testnet ? 'Test ETH' : 'ETH';
  try {
    const forKind = kind;
    const b = BigInt(await rpc('eth_getBalance', [auth.state.address, 'latest']));
    if (forKind !== kind) return;
    balance = b;
    $('#bal').innerHTML = `${ethName} balance on ${esc(c.chain.name)}: <b>${formatEth(balance, 6)} ETH</b> ${balance < c.goodBalance ? `<span class="bad">— top up first (≈${formatEth(c.goodBalance, 4)} ETH is plenty)</span>` : '<span class="ok">✓ enough for deployment</span>'}`;
  } catch (e) { $('#bal').innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  updateDeploy();
}
auth.addEventListener('change', refreshWho);
$('#b-signin').onclick = async () => { try { await auth.login(); } catch (e) { $('#who').textContent = e.message; } };
auth.load().then(refreshWho);

// ----- 2. compile + fingerprint check
$('#b-compile').onclick = async () => {
  const c = C();
  $('#b-compile').disabled = true;
  $('#compile').textContent = 'Loading the Solidity compiler (≈8 MB)…';
  try {
    const src = await (await fetch(`contracts/${c.file}`, { cache: 'no-store' })).text();
    const worker = new Worker('js/solc-worker.js');
    await new Promise((res, rej) => { worker.onmessage = (e) => (e.data.ready ? res() : null); worker.onerror = () => rej(new Error('Compiler failed to load')); });
    $('#compile').textContent = 'Compiling…';
    const input = {
      language: 'Solidity',
      sources: { [c.file]: { content: src } },
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['evm.bytecode.object'] } } },
    };
    const res = await new Promise((r) => { worker.onmessage = (e) => r(e.data); worker.postMessage(input); });
    worker.terminate();
    if (res.error) throw new Error(res.error);
    const out = JSON.parse(res.out);
    const errs = (out.errors || []).filter((e) => e.severity === 'error');
    if (errs.length) throw new Error(errs[0].formattedMessage);
    const code = out.contracts[c.file][c.contract].evm.bytecode.object;
    const { keccak_256 } = await import('https://esm.sh/@noble/hashes@1.4.0/sha3');
    const fp = `0x${hex(keccak_256(Uint8Array.from(code.match(/../g), (h) => parseInt(h, 16))))}`;
    if (fp !== c.fingerprint) throw new Error(`Fingerprint mismatch (${fp}). The contract source changed since it was tested — don't deploy.`);
    if (c !== C()) return;
    bytecode = code;
    $('#compile').innerHTML = `<span class="ok">✓ Matches the tested build</span> · ${code.length / 2} bytes · ${esc(res.version)}`;
  } catch (e) {
    $('#compile').innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    $('#b-compile').disabled = false;
  }
  updateDeploy();
};

// ----- 3. deploy
function updateDeploy() {
  $('#b-deploy').disabled = !(auth.signedIn && bytecode && balance >= C().minBalance);
}
$('#b-deploy').onclick = async () => {
  const c = C();
  if (!confirm(`Deploy ${c.title} to ${c.chain.name}${c.chain.testnet ? '' : ' (REAL network)'} from ${shortAddress(auth.state.address)}?\n\n${c.roles}\n\nYour signed-in wallet only pays the network fee.`)) return;
  $('#b-deploy').disabled = true;
  $('#deploy').textContent = 'Confirm the transaction in the Privy window…';
  try {
    const hash = await auth.sendTx({ data: `0x${bytecode}${c.args()}`, chainId: c.chain.id });
    $('#deploy').innerHTML = `Sent — waiting for the network… <span class="mono">${esc(hash)}</span>`;
    const rcpt = await waitForReceipt(hash);
    if (rcpt.status !== '0x1' || !rcpt.contractAddress) throw new Error(`Deployment failed on-chain (tx ${hash}).`);
    const explorer = c.chain.blockExplorers.default.url;
    $('#deploy').innerHTML = `
      <div class="result">
        <b class="ok">✓ ${esc(c.title)} is live on ${esc(c.chain.name)}</b>
        <span>Contract address — ${esc(c.next)}:</span>
        <span class="mono" style="font-size:15px">${esc(rcpt.contractAddress)}</span>
        <button class="btn pill" id="b-copy">Copy address</button>
        <span class="muted small">Transaction: <a class="mono" href="${esc(explorer)}/tx/${esc(hash)}" target="_blank" rel="noopener">${esc(hash)}</a></span>
      </div>`;
    $('#b-copy').onclick = () => navigator.clipboard.writeText(rcpt.contractAddress);
  } catch (e) {
    const m = String(e?.message || e);
    $('#deploy').innerHTML = `<span class="bad">${/reject|denied|cancel/i.test(m) ? 'Cancelled — nothing was deployed.' : esc(m.slice(0, 200))}</span>`;
    updateDeploy();
  }
};

// ----- 4. claim server (token only)
let serverStatus = null;
let onChainSigner = null;
async function refreshServer() {
  try {
    serverStatus = await (await fetch('/api/rewards?action=status', { cache: 'no-store' })).json();
  } catch { serverStatus = null; }
  onChainSigner = null;
  if (TOKEN_CONTRACT) {
    const r = await rpc('eth_call', [{ to: TOKEN_CONTRACT, data: '0x238ac933' }, 'latest']).catch(() => null); // signer()
    if (r) onChainSigner = `0x${r.slice(-40)}`;
  }
  const s = serverStatus;
  const row = (good, text) => `<div>${good ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} ${text}</div>`;
  $('#srv-status').innerHTML = !s ? '<span class="bad">Couldn\'t reach /api/rewards.</span>' : [
    row(Boolean(TOKEN_CONTRACT), TOKEN_CONTRACT ? `Token configured: <span class="mono">${esc(TOKEN_CONTRACT)}</span>` : 'Token address not set in the app yet (deploy, then send it to Claude)'),
    row(Boolean(s.nft), s.nft ? 'Sneaker NFT configured' : 'Sneaker NFT address not set in the app yet'),
    row(Boolean(s.signer), s.signer ? `Server key set — address <span class="mono">${esc(s.signer)}</span>` : 'Server key missing (step a)'),
    row(s.store, s.store ? 'Database connected' : 'Database missing (step b)'),
    row(Boolean(s.signer && onChainSigner && onChainSigner.toLowerCase() === s.signer.toLowerCase()), onChainSigner && BigInt(onChainSigner) ? `Token's server address: <span class="mono">${esc(onChainSigner)}</span>` : 'Server address not authorized on the token yet (step c)'),
    row(Boolean(s.emission), s.emission ? `Emission started (UTC day ${s.emission.startDay}) — today ${Math.round(s.emission.limit).toLocaleString()} RUNNER, rate ${Math.round(s.emission.factor * 100)}%` : 'Emission not started yet (step d)'),
    s.live ? '<div class="ok">Rewards server is live.</div>' : '',
  ].join('');
  $('#b-setsigner').disabled = !(TOKEN_CONTRACT && s?.signer && (!onChainSigner || onChainSigner.toLowerCase() !== s.signer.toLowerCase()));
  $('#b-emission').disabled = !(TOKEN_CONTRACT && s && !s.emission);
}

$('#b-genkey').onclick = async () => {
  const secp = await import('https://esm.sh/@noble/secp256k1@2.1.0');
  const { keccak_256 } = await import('https://esm.sh/@noble/hashes@1.4.0/sha3');
  const key = secp.utils.randomPrivateKey();
  const address = `0x${hex(keccak_256(secp.getPublicKey(key, false).slice(1)).slice(12))}`;
  $('#genkey').innerHTML = `
    <div class="result">
      <span><b>SIGNER_PRIVATE_KEY</b> (secret — paste into Vercel):</span>
      <span class="mono">${hex(key)}</span>
      <button class="btn pill" id="b-copykey">Copy key</button>
      <span>Server address (public): <span class="mono">${address}</span></span>
      <span class="muted small">Closing this page forgets the key. If it's lost, generate a new one and set it again.</span>
    </div>`;
  $('#b-copykey').onclick = () => navigator.clipboard.writeText(hex(key));
};

/** Sends a transaction from the dev wallet: a browser wallet (MetaMask) if present, else Privy. */
async function sendAsDev(to, data, chainId = TOKEN_CHAIN.id) {
  const injected = window.ethereum;
  if (injected) {
    const [from] = await injected.request({ method: 'eth_requestAccounts' });
    if (from.toLowerCase() !== DEV_WALLET.toLowerCase()) throw new Error(`Switch your browser wallet to the dev wallet ${DEV_WALLET} (it's on ${from}).`);
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] });
    return injected.request({ method: 'eth_sendTransaction', params: [{ from, to, data }] });
  }
  if (!auth.signedIn || auth.state.address.toLowerCase() !== DEV_WALLET.toLowerCase()) {
    throw new Error(`Only the dev wallet ${DEV_WALLET} can do this. Open this page in a browser with that wallet installed, or use Blockscout → the token → Write contract.`);
  }
  return auth.sendTx({ to, data, chainId });
}

async function runTx(button, out, makeTx, done) {
  button.disabled = true;
  try {
    const hash = await makeTx();
    out.textContent = 'Sent — waiting for the network…';
    const r = await waitForReceipt(hash);
    if (r.status !== '0x1') throw new Error('The transaction failed on-chain.');
    out.innerHTML = `<span class="ok">${done}</span>`;
  } catch (e) {
    const m = String(e?.message || e);
    out.innerHTML = `<span class="bad">${/reject|denied|cancel/i.test(m) ? 'Cancelled.' : esc(m.slice(0, 300))}</span>`;
  } finally {
    button.disabled = false;
  }
}

$('#b-setsigner').onclick = async () => {
  const signer = serverStatus?.signer;
  if (!signer) return;
  await runTx($('#b-setsigner'), $('#setsigner'), () => sendAsDev(TOKEN_CONTRACT, `0x6c19e783${encAddress(signer)}`), '✓ Server address set — claims are on.'); // setSigner(address)
  refreshServer();
};

$('#b-emission').onclick = async () => {
  if (!confirm('Start the RUNNER run-reward emission today?\n\n10,000,000 RUNNER/day, halving every 30 days, never below 100,000/day. This can only be done once and can\'t be undone.')) return;
  await runTx($('#b-emission'), $('#emission'), () => sendAsDev(TOKEN_CONTRACT, '0xbcccf888'), '✓ Emission started.'); // startEmission()
  refreshServer();
};

$('#b-addpair').onclick = async () => {
  const pair = $('#pair-addr').value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(pair)) { $('#addpair').innerHTML = '<span class="bad">Paste the pool contract address (0x… 40 hex characters).</span>'; return; }
  if (!confirm(`Register ${pair} as a RUNNER exchange pool?\n\nTrades through it will pay the 4% tax. This can't be undone.`)) return;
  await runTx($('#b-addpair'), $('#addpair'), () => sendAsDev(TOKEN_CONTRACT, `0xc2b7bbb6${encAddress(pair)}`), '✓ Pool registered — trades through it are now taxed.'); // addPair(address)
};

$('#b-sweep').onclick = async () => {
  // Anyone may sweep; use whichever wallet is available.
  const data = `0x98bc402d${word(60)}`; // sweepExpired(60 days)
  await runTx($('#b-sweep'), $('#sweep'), () => (window.ethereum ? sendAsDev(TOKEN_CONTRACT, data) : auth.sendTx({ to: TOKEN_CONTRACT, data, chainId: TOKEN_CHAIN.id })), '✓ Expired holder rewards sent to the protocol wallet.');
};

render();
