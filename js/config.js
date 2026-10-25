// App-wide settings that change per deployment.

// Privy (sign in with Google / Apple / email + embedded wallets).
// The App ID is public — it's safe to commit. Get it from dashboard.privy.io →
// your app → Settings. Leave it empty to hide sign-in (guest-only mode).
export const PRIVY_APP_ID = 'cmvi422kz004c0hjjmtt56ut4';
// Optional app client ID (Dashboard → App clients). Leave empty if unused.
export const PRIVY_CLIENT_ID = '';
// Phone app only: where Google/Apple sign-in returns to. That page hands the
// result back to the app. Must be listed in Privy → Settings → Advanced →
// Allowed OAuth redirect URLs.
export const NATIVE_OAUTH_REDIRECT = 'https://www.runearn.fun/redirect';
// Phone app's ID and link scheme (also in capacitor.config.json).
export const NATIVE_APP_ID = 'fun.runearn.app';
// Google Cloud project number (digits, not secret) linked to Play Integrity in the
// Play Console. The Android app needs it to ask Google for device proofs. See README.
export const PLAY_CLOUD_PROJECT_NUMBER = '';

// Local testing only: on localhost, localStorage 'runner.devChain' can point the app at a test chain
// (e.g. a local anvil chain with the contracts deployed): {"rpc":"http://127.0.0.1:8545","token":"0x…","hook":"0x…","imd":"0x…"}.
// Never applies on runearn.fun, in the phone apps or on the server.
const DEV_CHAIN = (() => {
  try {
    if (typeof location === 'undefined' || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
    if (globalThis.Capacitor?.isNativePlatform?.()) return null; // the phone apps are served from https://localhost too
    return JSON.parse(localStorage.getItem('runner.devChain') || 'null');
  } catch { return null; }
})();

// Robinhood Chain (Arbitrum L2, ETH for gas). Values from docs.robinhood.com/chain.
export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood-chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  // dRPC first: robinhood.com domains are blocked by some ISPs (e.g. in Indonesia),
  // so the official endpoint is only a fallback.
  rpcUrls: { default: { http: DEV_CHAIN?.rpc ? [DEV_CHAIN.rpc] : ['https://robinhood.drpc.org', 'https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
};
export const BLOCKSCOUT_API = 'https://robinhoodchain.blockscout.com/api/v2';

export const ROBINHOOD_TESTNET = {
  id: 46630,
  name: 'Robinhood Chain Testnet',
  network: 'robinhood-chain-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://robinhood-testnet.drpc.org', 'https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
};

// RUNNER Genesis sneaker NFTs (contracts/RunnerGenesis.sol).
// Mainnet, same network as the RUNNER token (test NFTs must never earn real
// RUNNER). After deploying from /admin.html, paste the contract address here.
// Empty address = shop shows "sales open soon".
export const NFT_CHAIN = ROBINHOOD_CHAIN;
export const NFT_CONTRACT = '';
// Fingerprint of the audited build (solc 0.8.24, optimizer 200 runs, evm "paris").
// /admin.html refuses to deploy bytecode that doesn't match.
export const NFT_CREATION_CODE_KECCAK = '0x270c71d725f5555873c1391b02799879056d7d4923759ab75fe6cd3d9c32ed9e';
export const NFT_BASE_URI = 'https://runearn.fun/nft/';
// Collection page for OpenSea (ERC-7572 contractURI): name, images, website, 5% fee.
export const NFT_CONTRACT_URI = 'https://runearn.fun/nft/collection.json';
// Project dev wallet: owner of the NFT contract, receives mint payments and the
// 5% resale royalty. Also owns the RUNNER token and receives its liquidity share.
export const DEV_WALLET = '0x0f397E46e4e810313dBC782CDb0236347157f1B4';

// RUNNER token (contracts/RunnerToken.sol) — ERC-20, fixed 1,000,000,000 supply, no transfer tax:
// 80% run-reward pool (inside the contract, paid only via server-verified claims),
// 10% liquidity → the RunnerHook, which locks it forever in the RUNNER/IMD Uniswap v4 pool,
// 10% team → TEAM_WALLET. Owner = DEV_WALLET. The hook charges 4% of every trade in IMD:
// 2% to the protocol (DEV_WALLET) and 2% to RUNNER holders (paid out by the token, in IMD).
export const TOKEN_CHAIN = ROBINHOOD_CHAIN;
export const TOKEN_CONTRACT = DEV_CHAIN?.token || '';
export const TEAM_WALLET = '0x0f4FE718eb8492533E600b30F3287E2f04087332';
export const TOKEN_CREATION_CODE_KECCAK = '0x75d8d27c4c1220ebabaf525493933771ca45bab43110bb52f09fa74ce0d226d5';

// RUNNER/IMD pool on Robinhood Chain's Uniswap v4 (the same PoolManager, IMD and IMD/ETH pool
// PepesFamily uses). The RunnerHook (contracts/RunnerHook.sol) is deployed first, through the
// standard CREATE2 deployer at an address carrying its hook flags; then the token; then
// hook.openPool(token) adds the 100M RUNNER liquidity (locked forever).
export const IMD_TOKEN = DEV_CHAIN?.imd || '0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127';
export const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const IMD_ETH_POOL = { fee: 10_000, tickSpacing: 100, hooks: '0x0000000000000000000000000000000000000000' };
export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
export const HOOK_FLAGS = 0x28ec; // beforeInitialize, beforeAddLiquidity, before/afterSwap (+ return deltas), beforeDonate
export const HOOK_START_TICK = 142_600; // tick of RUNNER-per-IMD: about 642 IMD starting market cap (635 IMD rounded to the tick spacing)
export const HOOK_CONTRACT = DEV_CHAIN?.hook || '';
// Fingerprint of contracts/build/RunnerHook.json (solc 0.8.26, via-IR, optimizer 200, cancun).
export const HOOK_CREATION_CODE_KECCAK = '0xddf207aa61c7b1007ccd63352897f2233604cb48ca3cdbeace1e26d6e5eb4c2c';
