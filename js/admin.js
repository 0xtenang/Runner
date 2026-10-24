// Owner-only page: compile, verify and deploy RUNNER's contracts from the
// signed-in Privy wallet. Not linked from the app. Whoever deploys only pays
// the network fee — every role goes to the wallets fixed in config.js.
import { auth, shortAddress } from './auth.js';
import {
  NFT_CHAIN, NFT_CONTRACT, NFT_CREATION_CODE_KECCAK, NFT_BASE_URI, NFT_CONTRACT_URI, DEV_WALLET,
  TOKEN_CHAIN, TOKEN_CONTRACT, TOKEN_CREATION_CODE_KECCAK, TEAM_WALLET,
  IMD_TOKEN, POOL_MANAGER, IMD_ETH_POOL, CREATE2_DEPLOYER, HOOK_FLAGS, HOOK_START_TICK, HOOK_CONTRACT, HOOK_CREATION_CODE_KECCAK,
} from './config.js';
import { formatEth } from './wallet.js';
import { DEFAULT_SETTINGS } from './rules.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const encAddress = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const encInt = (n) => (BigInt(n) < 0n ? (1n << 256n) + BigInt(n) : BigInt(n)).toString(16).padStart(64, '0');
const fromHex = (h) => Uint8Array.from(h.replace(/^0x/, '').match(/../g) || [], (x) => parseInt(x, 16));
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
  hook: {
    title: 'RUNNER pool hook',
    file: 'build/RunnerHook.json', contract: 'RunnerHook', artifact: true,
    chain: TOKEN_CHAIN, configured: HOOK_CONTRACT, fingerprint: HOOK_CREATION_CODE_KECCAK,
    minBalance: 2n * 10n ** 15n, goodBalance: 4n * 10n ** 15n,
    about: `Step 1 of the token launch. The Uniswap v4 hook that owns the RUNNER/IMD pool: every trade pays 4% of its IMD side — 2% to the protocol wallet (the dev wallet <span class="mono">${shortAddress(DEV_WALLET)}</span>) and 2% to RUNNER holders, in IMD. It locks the 100M RUNNER liquidity in the pool forever. Deployed through the standard CREATE2 deployer at an address carrying its hook flags (found in your browser).`,
    roles: `Owner and fee recipient: dev wallet ${DEV_WALLET}\nPool: RUNNER/IMD on Uniswap v4 (${POOL_MANAGER})\nStarting market cap: about 635 IMD`,
    next: 'send this to Claude, then deploy the token',
    /** constructor(poolManager, imd, owner, feeRecipient, startTick, (fee, tickSpacing, hooks)) */
    args: () => encAddress(POOL_MANAGER) + encAddress(IMD_TOKEN) + encAddress(DEV_WALLET) + encAddress(DEV_WALLET)
      + encInt(HOOK_START_TICK) + word(IMD_ETH_POOL.fee) + encInt(IMD_ETH_POOL.tickSpacing) + encAddress(IMD_ETH_POOL.hooks),
  },
  token: {
    title: 'RUNNER token',
    file: 'RunnerToken.sol', contract: 'RunnerToken',
    chain: TOKEN_CHAIN, configured: TOKEN_CONTRACT, fingerprint: TOKEN_CREATION_CODE_KECCAK,
    minBalance: 5n * 10n ** 14n, goodBalance: 10n ** 15n,
    needs: () => (HOOK_CONTRACT ? '' : 'Deploy the pool hook first (step 1) and send its address to Claude.'),
    about: `Step 2 of the token launch. The ERC-20 token, fixed supply of 1,000,000,000 RUNNER, no transfer tax: 800M run-reward pool (locked in the contract, paid only through verified claims), 100M liquidity to the pool hook <span class="mono">${HOOK_CONTRACT ? shortAddress(HOOK_CONTRACT) : '(not deployed yet)'}</span>, which locks it in the RUNNER/IMD pool forever, 100M team to <span class="mono">${shortAddress(TEAM_WALLET)}</span>. Holder rewards are paid in IMD. Run rewards: 10M/day from launch, halving every 30 days, floor 100k/day. The dev wallet becomes owner. No more tokens can ever be created. <a href="https://github.com/0xtenang/Runner/blob/main/AUDIT.md" target="_blank" rel="noopener">Read the audit report first.</a>`,
    roles: `Owner: dev wallet ${DEV_WALLET}\n100M liquidity: pool hook ${HOOK_CONTRACT}\n100M team: ${TEAM_WALLET}\n800M run rewards: locked in the contract\nHolder rewards paid in IMD (${IMD_TOKEN})`,
    next: 'send this to Claude to connect the app and the claim server, then open the pool',
    /** constructor(owner, hook, teamWallet, rewardToken, poolManager) */
    args: () => encAddress(DEV_WALLET) + encAddress(HOOK_CONTRACT) + encAddress(TEAM_WALLET) + encAddress(IMD_TOKEN) + encAddress(POOL_MANAGER),
  },
};

let kind = ['token', 'hook'].includes(new URLSearchParams(location.search).get('c')) ? new URLSearchParams(location.search).get('c') : 'nft';
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
  $('#compile-note').textContent = c.artifact
    ? 'Loads the committed build (made with Foundry: solc 0.8.26, via-IR, optimizer 200, cancun) and checks it matches the tested build exactly.'
    : 'Compiles it with Solidity 0.8.24 and checks it matches the tested build exactly.';
  $('#fee').textContent = c.chain.testnet
    ? 'Costs a small network fee in test ETH. Get free test ETH from the Robinhood Chain Testnet faucet first (it may need a VPN in Indonesia).'
    : `Costs a small network fee in real ETH on ${c.chain.name} (well under 0.001 ETH). This cannot be undone — the supply and wallets above are permanent.`;
  $('#b-deploy').textContent = `Deploy ${c.title}`;
  $('#compile').textContent = '';
  $('#b-compile').disabled = false;
  const blocked = c.needs?.();
  $('#deploy').innerHTML = blocked ? `<span class="bad">${esc(blocked)}</span>` : c.configured
    ? `<span class="bad">A ${esc(c.title)} contract is already configured in the app: <span class="mono">${esc(c.configured)}</span>. Deploying again creates a second, separate contract.</span>`
    : '';
  bytecode = null;
  $('#server').hidden = kind !== 'token';
  $('#launch').hidden = kind !== 'token' || !TOKEN_CONTRACT || !HOOK_CONTRACT;
  $('#controls').hidden = kind !== 'token';
  $('#review').hidden = kind !== 'token';
  if (kind === 'token') refreshServer();
  refreshWho();
}

$('#pick').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]');
  if (!b || b.dataset.c === kind) return;
  kind = b.dataset.c;
  history.replaceState(null, '', kind === 'nft' ? location.pathname : `?c=${kind}`);
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
  $('#compile').textContent = c.artifact ? 'Loading the build…' : 'Loading the Solidity compiler (≈8 MB)…';
  try {
    if (c.artifact) {
      const art = await (await fetch(`contracts/${c.file}`, { cache: 'no-store' })).json();
      const code = String(art.bytecode).replace(/^0x/, '');
      const { keccak_256 } = await import('https://esm.sh/@noble/hashes@1.4.0/sha3');
      const fp = `0x${hex(keccak_256(fromHex(code)))}`;
      if (!c.fingerprint || fp !== c.fingerprint) throw new Error(`Fingerprint mismatch (${fp}). The build changed since it was tested — don't deploy.`);
      if (c !== C()) return;
      bytecode = code;
      $('#compile').innerHTML = `<span class="ok">✓ Matches the tested build</span> · ${code.length / 2} bytes · solc ${esc(art.solc)}`;
      updateDeploy();
      return;
    }
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
  $('#b-deploy').disabled = !(auth.signedIn && bytecode && balance >= C().minBalance && !C().needs?.());
}
$('#b-deploy').onclick = async () => {
  const c = C();
  if (!confirm(`Deploy ${c.title} to ${c.chain.name}${c.chain.testnet ? '' : ' (REAL network)'} from ${shortAddress(auth.state.address)}?\n\n${c.roles}\n\nYour signed-in wallet only pays the network fee.`)) return;
  $('#b-deploy').disabled = true;
  $('#deploy').textContent = 'Confirm the transaction in the Privy window…';
  try {
    let hash, address;
    if (c.artifact) {
      // CREATE2 through the standard deployer, at an address whose low 14 bits are the hook flags.
      $('#deploy').textContent = 'Finding a hook address (a few seconds)…';
      const initCode = `${bytecode}${c.args()}`;
      const { salt, predicted } = await mineHookSalt(initCode);
      $('#deploy').innerHTML = `Hook address: <span class="mono">${esc(predicted)}</span><br>Confirm the transaction in the Privy window…`;
      hash = await auth.sendTx({ to: CREATE2_DEPLOYER, data: `0x${salt}${initCode}`, chainId: c.chain.id });
      address = predicted;
    } else {
      hash = await auth.sendTx({ data: `0x${bytecode}${c.args()}`, chainId: c.chain.id });
    }
    $('#deploy').innerHTML = `Sent — waiting for the network… <span class="mono">${esc(hash)}</span>`;
    const rcpt = await waitForReceipt(hash);
    if (rcpt.status !== '0x1') throw new Error(`Deployment failed on-chain (tx ${hash}).`);
    if (address) {
      const code = await rpc('eth_getCode', [address, 'latest']);
      if (!code || code === '0x') throw new Error(`No contract at ${address} after the transaction (tx ${hash}).`);
      rcpt.contractAddress = address;
    }
    if (!rcpt.contractAddress) throw new Error(`Deployment failed on-chain (tx ${hash}).`);
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

/** Finds a CREATE2 salt whose deployed address carries exactly HOOK_FLAGS in its low 14 bits. */
async function mineHookSalt(initCodeHex) {
  const { keccak_256 } = await import('https://esm.sh/@noble/hashes@1.4.0/sha3');
  const initHash = keccak_256(fromHex(initCodeHex));
  const buf = new Uint8Array(85);
  buf[0] = 0xff;
  buf.set(fromHex(CREATE2_DEPLOYER), 1);
  buf.set(initHash, 53);
  const start = Math.floor(Math.random() * 2 ** 32);
  for (let i = 0; i < 2_000_000; i++) {
    const salt = (BigInt(start) * 2n ** 32n + BigInt(i)).toString(16).padStart(64, '0');
    buf.set(fromHex(salt), 21);
    const h = keccak_256(buf);
    if ((((h[30] << 8) | h[31]) & 0x3fff) === HOOK_FLAGS) return { salt, predicted: `0x${hex(h.slice(12))}` };
    if (i % 20000 === 0) await new Promise((r) => setTimeout(r)); // keep the page responsive
  }
  throw new Error('No hook address found — try again.');
}

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
  fillControls(s);
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

// ----- 6. controls after launch
const fmtN = (n) => Math.round(n).toLocaleString();
function fillControls(s) {
  const em = s?.emission;
  $('#em-now').innerHTML = em
    ? `Now: ${fmtN(em.limit)} RUNNER today (earn rate ${Math.round(em.factor * 100)}%)${em.nextHalving ? `, next halving ${new Date(em.nextHalving).toLocaleDateString()}` : ''}.${em.change ? ` Scheduled from ${new Date(em.change.fromDay * 864e5).toLocaleDateString()}: ${fmtN(em.change.dailyStart)}/day, halving every ${em.change.halvingDays} days, floor ${fmtN(em.change.floor)}.` : ''}`
    : 'Emission not started — a schedule set now replaces the launch schedule (10M/day, 30 days, floor 100k).';
  const st = s?.settings || DEFAULT_SETTINGS;
  if (!$('#st-base').dataset.filled) {
    $('#st-base').value = st.levelCostBase;
    $('#st-exp').value = st.levelCostExp;
    $('#st-max').value = st.perRunnerDailyMax;
    const fp = { ...DEFAULT_SETTINGS.fairPlay, ...(st.fairPlay || {}) };
    $('#fp-full').value = fp.fullPayTrust;
    $('#fp-void').value = fp.voidBelowTrust;
    $('#fp-pct').value = fp.partialPayPct;
    $('#fp-limit').value = fp.strikeLimit;
    $('#fp-window').value = fp.strikeWindowDays;
    $('#fp-susp').value = fp.suspensionDays.join(', ');
    $('#st-attest').checked = Boolean(st.requireAttestation);
    $('#st-boosts').value = (st.boosts || []).map((b) => `${b.contract}, ${b.label}, ${b.boostBps / 100}`).join('\n');
    $('#st-base').dataset.filled = '1';
    const at = s?.attestation;
    if (at) $('#st-attest-status').textContent = `Server set up for: Android ${at.android ? '✓' : '✗ (PLAY_INTEGRITY_SA missing)'} · iPhone ${at.ios ? '✓' : '✗ (APPLE_TEAM_ID missing)'}`;
    previewLevels();
  }
}
function previewLevels() {
  const base = Number($('#st-base').value), exp = Number($('#st-exp').value);
  if (!(base > 0 && exp > 0)) { $('#st-preview').textContent = ''; return; }
  const cost = (l) => Math.round(base * l ** exp);
  let total = 0; for (let l = 1; l <= 30; l++) total += cost(l);
  $('#st-preview').textContent = `Level 1: ${fmtN(cost(1))} · level 10: ${fmtN(cost(10))} · level 30: ${fmtN(cost(30))} · total to 30: ${fmtN(total)} RUNNER (at a 10M/day emission; halves with emission)`;
}
['#st-base', '#st-exp'].forEach((id) => $(id).addEventListener('input', previewLevels));

/** personal_sign as the dev wallet (browser wallet if present, else Privy when signed in as it). */
async function signAsDev(message) {
  const injected = window.ethereum;
  if (injected) {
    const [from] = await injected.request({ method: 'eth_requestAccounts' });
    if (from.toLowerCase() !== DEV_WALLET.toLowerCase()) throw new Error(`Switch your browser wallet to the dev wallet ${DEV_WALLET}.`);
    const hexMsg = `0x${hex(new TextEncoder().encode(message))}`;
    return injected.request({ method: 'personal_sign', params: [hexMsg, from] });
  }
  if (!auth.signedIn || auth.state.address.toLowerCase() !== DEV_WALLET.toLowerCase()) throw new Error(`Sign in as the dev wallet ${DEV_WALLET} to change settings.`);
  return auth.signMessage(message);
}

$('#b-schedule').onclick = async () => {
  const start = Number($('#em-start').value), halving = Number($('#em-halving').value), floor = Number($('#em-floor').value);
  if (!(start >= 0 && start <= 20_000_000 && floor >= 0 && floor <= start && halving >= 7 && halving <= 3650)) { $('#schedule').innerHTML = '<span class="bad">Daily amount 0–20,000,000, floor ≤ daily amount, halving 7–3650 days.</span>'; return; }
  if (!confirm(`New emission schedule from tomorrow (UTC):\n${fmtN(start)} RUNNER/day, halving every ${halving} days, never below ${fmtN(floor)}/day.\n\nEarn rates follow it. Continue?`)) return;
  const wei = (n) => word(BigInt(Math.round(n)) * 10n ** 18n);
  await runTx($('#b-schedule'), $('#schedule'), () => sendAsDev(TOKEN_CONTRACT, `0x81947a26${wei(start)}${word(halving)}${wei(floor)}`), '✓ Schedule set — it starts tomorrow (UTC).'); // setEmissionSchedule(uint256,uint256,uint256)
  refreshServer();
};

$('#b-settings').onclick = async () => {
  try {
    const boosts = $('#st-boosts').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [contract, label, pct] = l.split(',').map((x) => x.trim());
      if (!/^0x[0-9a-fA-F]{40}$/.test(contract || '') || !(Number(pct) >= 0 && Number(pct) <= 100)) throw new Error(`Bad boost line: ${l}`);
      return { contract: contract.toLowerCase(), label: label || 'NFT boost', boostBps: Math.round(Number(pct) * 100) };
    });
    const settings = { levelCostBase: Number($('#st-base').value), levelCostExp: Number($('#st-exp').value), perRunnerDailyMax: Number($('#st-max').value) || 0, boosts, requireAttestation: $('#st-attest').checked,
      fairPlay: {
        fullPayTrust: Number($('#fp-full').value), voidBelowTrust: Number($('#fp-void').value), partialPayPct: Number($('#fp-pct').value),
        strikeLimit: Number($('#fp-limit').value), strikeWindowDays: Number($('#fp-window').value),
        suspensionDays: $('#fp-susp').value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0),
      } };
    const message = `RUNNER settings\n${JSON.stringify(settings)}\nIssued: ${new Date().toISOString()}`;
    $('#b-settings').disabled = true;
    $('#settings').textContent = 'Sign the settings message in your wallet…';
    const signature = await signAsDev(message);
    const r = await fetch('/api/rewards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings-set', settings, message, signature }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
    $('#settings').innerHTML = '<span class="ok">✓ Game settings saved — the app uses them right away.</span>';
  } catch (e) {
    const m = String(e?.message || e);
    $('#settings').innerHTML = `<span class="bad">${/reject|denied|cancel/i.test(m) ? 'Cancelled.' : esc(m.slice(0, 300))}</span>`;
  } finally { $('#b-settings').disabled = false; }
};

// ----- 7. fair play: automatic decisions log, manual bans
let adminSession = null;
try { adminSession = sessionStorage.getItem('runner.admin.session'); } catch { /* storage blocked */ }
async function adminCall(body, retried = false) {
  if (!adminSession) {
    const address = window.ethereum ? (await window.ethereum.request({ method: 'eth_requestAccounts' }))[0] : auth.state.address;
    if (!address) throw new Error('Sign in as the dev wallet first.');
    const message = `RUNNER admin sign-in\nWallet: ${address.toLowerCase()}\nIssued: ${new Date().toISOString()}`;
    const signature = await signAsDev(message);
    const r = await fetch('/api/rewards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'admin-session', address, message, signature }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
    adminSession = j.session;
    try { sessionStorage.setItem('runner.admin.session', adminSession); } catch { /* fine */ }
  }
  const r = await fetch('/api/rewards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'admin', session: adminSession, ...body }) });
  const j = await r.json();
  if (r.status === 401 && !retried) { adminSession = null; return adminCall(body, true); }
  if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
  return j;
}

async function loadLog() {
  const { log, bans } = await adminCall({ op: 'log' });
  const when = (t) => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const label = { partial: 'Partly paid', voided: 'Not paid + strike', suspended: 'Suspended' };
  $('#review-list').innerHTML = `
    ${bans.length ? `<p style="margin:8px 0 4px"><b>Suspended now (${bans.length})</b></p>${bans.slice(0, 50).map((b) => `<div class="mono">${esc(b.address)} <span class="muted">— ${b.until ? `until ${when(b.until)}` : 'permanent'} · ${esc(b.reason)}${b.auto ? ' (automatic)' : ''}</span></div>`).join('')}` : '<p class="ok" style="margin:8px 0 0">No wallets suspended.</p>'}
    <p style="margin:10px 0 4px"><b>Recent automatic decisions</b></p>
    ${log.length ? log.slice(0, 100).map((x) => `
      <div style="margin-bottom:6px"><b class="${x.outcome === 'partial' ? '' : 'bad'}">${label[x.outcome] || esc(x.outcome)}</b> · ${when(x.at)} · <span class="mono">${esc(x.address)}</span>
        ${x.trust != null ? ` · trust ${x.trust}` : ''}${x.coins ? ` · paid ${fmtN(x.coins)}` : ''}${x.forfeited ? ` · forfeited ${fmtN(x.forfeited)} on hold` : ''}${x.until !== undefined ? ` · ${x.until ? `until ${when(x.until)}` : 'permanent'}` : ''}
        <div class="muted">${esc((x.reasons || [x.reason]).filter(Boolean).join(' · '))}</div></div>`).join('') : '<p class="muted" style="margin:0">Nothing yet — every run so far was paid in full.</p>'}`;
}

$('#b-review').onclick = async () => {
  $('#b-review').disabled = true;
  try { $('#review-list').textContent = 'Loading…'; await loadLog(); } catch (e) { $('#review-list').innerHTML = `<span class="bad">${esc(String(e.message).slice(0, 300))}</span>`; } finally { $('#b-review').disabled = false; }
};
for (const op of ['ban', 'unban']) {
  $(`#b-${op}`).onclick = async () => {
    const address = $('#ban-addr').value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { $('#ban-out').innerHTML = '<span class="bad">Paste a wallet address.</span>'; return; }
    try {
      await adminCall({ op, address, reason: $('#ban-reason').value, days: Number($('#ban-days').value) || 0 });
      $('#ban-out').innerHTML = `<span class="ok">✓ ${op === 'ban' ? 'Banned' : 'Unbanned'} ${esc(address)}</span>`;
    } catch (err) { $('#ban-out').innerHTML = `<span class="bad">${esc(String(err.message).slice(0, 300))}</span>`; }
  };
}

$('#b-emission').onclick = async () => {
  if (!confirm('Start the RUNNER run-reward emission today?\n\n10,000,000 RUNNER/day, halving every 30 days, never below 100,000/day. This can only be done once and can\'t be undone.')) return;
  await runTx($('#b-emission'), $('#emission'), () => sendAsDev(TOKEN_CONTRACT, '0xbcccf888'), '✓ Emission started.'); // startEmission()
  refreshServer();
};

$('#b-openpool').onclick = async () => {
  if (!confirm(`Open the RUNNER/IMD pool now?\n\nThe hook adds the 100,000,000 RUNNER liquidity allocation at a starting market cap of about 635 IMD and locks it forever. Trading starts immediately. This can only be done once.`)) return;
  await runTx($('#b-openpool'), $('#openpool'), () => sendAsDev(HOOK_CONTRACT, `0x109fda53${encAddress(TOKEN_CONTRACT)}`), '✓ Pool open — RUNNER is tradable against IMD, liquidity locked forever.'); // openPool(address)
};

$('#b-exclude').onclick = async () => {
  const pool = $('#pool-addr').value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool)) { $('#exclude').innerHTML = '<span class="bad">Paste the pool contract address (0x… 40 hex characters).</span>'; return; }
  if (!confirm(`Exclude ${pool} from holder rewards?\n\nUse this for another RUNNER pool someone created elsewhere, so its balance doesn't dilute holders. It doesn't affect trading. This can't be undone.`)) return;
  await runTx($('#b-exclude'), $('#exclude'), () => sendAsDev(TOKEN_CONTRACT, `0xb6ae9c93${encAddress(pool)}`), '✓ Pool excluded from holder rewards.'); // excludePool(address)
};

$('#b-fees').onclick = async () => {
  // Anyone may do both: send pending holder IMD to the token, and the protocol's IMD to the fee recipient.
  const send = (data) => (window.ethereum ? sendAsDev(HOOK_CONTRACT, data) : auth.sendTx({ to: HOOK_CONTRACT, data, chainId: TOKEN_CHAIN.id }));
  await runTx($('#b-fees'), $('#fees'), async () => { await send(`0x79c76e1a${encAddress(TOKEN_CONTRACT)}`); return send(`0x2a54db01${encAddress(IMD_TOKEN)}`); }, '✓ Holder IMD booked and protocol IMD sent.'); // flush(token), collectProtocolFees(IMD)
};

$('#b-sweep').onclick = async () => {
  // Anyone may sweep; use whichever wallet is available.
  const data = `0x98bc402d${word(60)}`; // sweepExpired(60 days)
  await runTx($('#b-sweep'), $('#sweep'), () => (window.ethereum ? sendAsDev(TOKEN_CONTRACT, data) : auth.sendTx({ to: TOKEN_CONTRACT, data, chainId: TOKEN_CHAIN.id })), '✓ Expired holder rewards sent to the protocol wallet.');
};

render();
