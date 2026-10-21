// App-wide settings that change per deployment.

// Privy (sign in with Google / Apple / email + embedded wallets).
// The App ID is public — it's safe to commit. Get it from dashboard.privy.io →
// your app → Settings. Leave it empty to hide sign-in (guest-only mode).
export const PRIVY_APP_ID = 'cmvi422kz004c0hjjmtt56ut4';
// Optional app client ID (Dashboard → App clients). Leave empty if unused.
export const PRIVY_CLIENT_ID = '';

// Robinhood Chain (Arbitrum L2, ETH for gas). Values from docs.robinhood.com/chain.
export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood-chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
};

export const ROBINHOOD_TESTNET = {
  id: 46630,
  name: 'Robinhood Chain Testnet',
  network: 'robinhood-chain-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
};
