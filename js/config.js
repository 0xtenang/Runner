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

// Robinhood Chain (Arbitrum L2, ETH for gas). Values from docs.robinhood.com/chain.
export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood-chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  // dRPC first: robinhood.com domains are blocked by some ISPs (e.g. in Indonesia),
  // so the official endpoint is only a fallback.
  rpcUrls: { default: { http: ['https://robinhood.drpc.org', 'https://rpc.mainnet.chain.robinhood.com'] } },
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
export const NFT_CREATION_CODE_KECCAK = '0x1c55e9cf65a7def63fa7bc19d49e3b89330b967c964fdba4e63d83a13c00b446';
export const NFT_BASE_URI = 'https://runearn.fun/nft/';
// Collection page for OpenSea (ERC-7572 contractURI): name, images, website, 5% fee.
export const NFT_CONTRACT_URI = 'https://runearn.fun/nft/collection.json';
// Project dev wallet: owner of the NFT contract, receives mint payments and the
// 5% resale royalty. Also owns the RUNNER token and receives its liquidity share.
export const DEV_WALLET = '0x0f397E46e4e810313dBC782CDb0236347157f1B4';

// RUNNER token (contracts/RunnerToken.sol) — ERC-20, fixed 1,000,000,000 supply:
// 80% run-reward pool (inside the contract, paid only via server-verified claims),
// 10% liquidity → DEV_WALLET, 10% team → TEAM_WALLET. Owner = DEV_WALLET.
export const TOKEN_CHAIN = ROBINHOOD_CHAIN;
export const TOKEN_CONTRACT = '';
export const TEAM_WALLET = '0x0f4FE718eb8492533E600b30F3287E2f04087332';
export const TOKEN_CREATION_CODE_KECCAK = '0x56b86374daef492b5034060bd22303acd9474669b2686c54cf5166a38f3c973a';
