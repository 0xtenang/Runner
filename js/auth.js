// Sign in with Google / Apple / email via Privy, which also creates an
// embedded (non-custodial) Ethereum wallet for each user — no seed phrase or
// private key to import. Privy's SDK is React-based; we load React + Privy as
// ES modules from esm.sh (no build step) and mount a tiny invisible React
// "bridge" that mirrors Privy's state into this plain EventTarget.
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, WALLETCONNECT_PROJECT_ID, ROBINHOOD_CHAIN, ROBINHOOD_TESTNET, NATIVE_OAUTH_REDIRECT } from './config.js';
import { isNative, registerPlugin } from './geo.js';

const REACT = 'https://esm.sh/react@18.3.1';
const REACT_DOM = 'https://esm.sh/react-dom@18.3.1/client';
// `bundle` packs Privy's dependencies into a few files (≈67 requests instead of
// ≈250), which matters a lot on phones over mobile data.
const PRIVY = 'https://esm.sh/@privy-io/react-auth@3.50.0?bundle&deps=react@18.3.1,react-dom@18.3.1';
const START_TIMEOUT_MS = 45000;

export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const explorerUrl = (a) => `${ROBINHOOD_CHAIN.blockExplorers.default.url}/address/${a}`;
export const CHAIN_NAME = ROBINHOOD_CHAIN.name;

function summarize(user) {
  if (!user) return null;
  const method = user.google ? 'Google' : user.apple ? 'Apple' : user.email ? 'Email' : 'Wallet';
  return {
    id: user.id,
    method,
    email: user.google?.email || user.apple?.email || user.email?.address || null,
    name: user.google?.name || null,
  };
}

class Auth extends EventTarget {
  constructor() {
    super();
    this.state = {
      configured: Boolean(PRIVY_APP_ID),
      loading: false, ready: false, authenticated: false,
      user: null, address: null, error: null, stage: 'idle',
      externalWallets: [], // wallets connected with "Connect wallet" (WalletConnect, MetaMask…): [{ address, name }]
      walletKind: null, // 'embedded' (created by Privy at sign-in) or 'external' (signed in with MetaMask, Phantom…)
      walletName: null,
    };
    this._api = null;
    this._mounted = false;
    this._downloading = null;
    this._diag = { downloadSec: null, firstError: null };
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event('change'));
  }

  /**
   * Loads and starts Privy. Downloading/mounting happens once; if Privy is slow
   * to start, later calls just wait again (never mount a second copy).
   * Resolves true when ready, false if unavailable.
   */
  async load() {
    if (!this.state.configured) return false;
    if (this.state.ready) return true;
    if (!this._mounted) {
      this._downloading ??= this._download();
      if (!(await this._downloading)) return false;
    }
    return this._waitReady();
  }

  async _download() {
    this._set({ loading: true, error: null, stage: 'download' });
    this._watchErrors();
    const t0 = performance.now();
    try {
      const mods = await Promise.all([import(REACT), import(REACT_DOM), import(PRIVY)]);
      this._diag.downloadSec = +((performance.now() - t0) / 1000).toFixed(1);
      this._mountPrivy(...mods);
      this._mounted = true;
      this._set({ stage: 'start' });
      return true;
    } catch (e) {
      console.warn('Privy failed to download', e);
      this._downloading = null; // a later tap can retry the download
      this._set({ loading: false, stage: 'download-failed', error: `Couldn't download the sign-in service. Check your internet connection, or turn off any ad/tracker blocker for runearn.fun. (${e.message})` });
      return false;
    }
  }

  /** Remembers the first script error while Privy starts, so we can show the real cause. */
  _watchErrors() {
    if (this._watching) return;
    this._watching = true;
    this._diag = { downloadSec: null, firstError: null };
    const note = (msg) => { if (!this.state.ready && msg && !this._diag.firstError) this._diag.firstError = String(msg).slice(0, 160); };
    addEventListener('error', (e) => note(e.message));
    addEventListener('unhandledrejection', (e) => note(e.reason?.message || e.reason));
  }

  _waitReady() {
    if (this.state.ready) return Promise.resolve(true);
    this._set({ loading: true, error: null });
    return new Promise((resolve) => {
      const onChange = () => {
        if (this.state.ready) { cleanup(); resolve(true); }
        else if (this.state.stage === 'crashed') { cleanup(); resolve(false); }
      };
      const t = setTimeout(() => {
        cleanup();
        const cause = this._diag.firstError
          ? `Error: ${this._diag.firstError}`
          : 'It may be blocked by an ad/tracker blocker, a private DNS (AdGuard, NextDNS), or an in-app browser — try opening runearn.fun directly in Safari or Chrome.';
        // Privy keeps starting in the background; if it gets ready later, the error clears itself.
        this._set({ loading: false, stage: 'start-timeout', error: `Sign-in is taking too long to start. ${cause}` });
        resolve(false);
      }, START_TIMEOUT_MS);
      const cleanup = () => { clearTimeout(t); this.removeEventListener('change', onChange); };
      this.addEventListener('change', onChange);
      onChange();
    });
  }

  _mountPrivy(React, { createRoot }, Privy) {
    const h = React.createElement;
    const auth = this;

    function Bridge() {
      const { ready, authenticated, user } = Privy.usePrivy();
      const { wallets } = Privy.useWallets();
      const { login } = Privy.useLogin({
        onError: (err) => { if (err && err !== 'exited_auth_flow') auth._set({ error: `Sign-in failed: ${err}` }); },
      });
      const { logout } = Privy.useLogout();
      const { exportWallet } = Privy.useExportWallet();
      const { connectWallet } = Privy.useConnectWallet({
        onError: (err) => { if (err && err !== 'generic_connect_wallet_error' && err !== 'exited_auth_flow') auth._set({ error: `Couldn't connect the wallet: ${err}` }); },
      });
      const embedded = wallets.find((w) => w.walletClientType === 'privy') || null;
      // Signed in with an own wallet (MetaMask, Phantom, WalletConnect…): no Privy wallet is created, so that wallet is
      // the account's wallet for every transaction and signature.
      const linked = !embedded && user?.wallet?.walletClientType !== 'privy' ? (user?.wallet?.address || '').toLowerCase() : '';
      const own = linked ? wallets.find((w) => w.address.toLowerCase() === linked) || null : null;
      const primary = embedded || own;
      const address = embedded?.address || user?.wallet?.address || null;
      const walletKind = !authenticated || !address ? null : embedded ? 'embedded' : 'external';
      const walletName = walletKind === 'external' ? (own?.meta?.name || user?.wallet?.walletClientType || 'Wallet') : null;
      const external = wallets.filter((w) => w !== primary && w.walletClientType !== 'privy');
      const externalKey = external.map((w) => w.address).join(',');
      React.useEffect(() => { auth._api = { login, logout, exportWallet, connectWallet }; auth._wallet = primary; auth._external = external; });
      React.useEffect(() => {
        auth._set({ externalWallets: external.map((w) => ({ address: w.address, name: w.meta?.name || w.walletClientType || 'Wallet' })) });
      }, [externalKey]);
      React.useEffect(() => {
        auth._set({
          ready, authenticated, user: summarize(user), address, walletKind, walletName, loading: !ready,
          ...(ready ? { stage: 'ready', error: auth.state.stage === 'start-timeout' ? null : auth.state.error } : {}),
        });
      }, [ready, authenticated, user?.id, address, walletKind, walletName, Boolean(primary)]);
      return null;
    }

    // If Privy throws while rendering, show that error instead of silently waiting.
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch(err) {
        console.warn('Privy crashed', err);
        auth._set({ loading: false, stage: 'crashed', error: `Sign-in couldn't start on this browser. Error: ${String(err?.message || err).slice(0, 160)}` });
      }
      render() { return this.state.failed ? null : this.props.children; }
    }

    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const host = document.createElement('div');
    host.id = 'privy-root';
    document.body.appendChild(host);
    createRoot(host).render(h(Boundary, null, h(Privy.PrivyProvider, {
      appId: PRIVY_APP_ID,
      ...(PRIVY_CLIENT_ID ? { clientId: PRIVY_CLIENT_ID } : {}),
      config: {
        // Own wallets (MetaMask, Phantom, WalletConnect…) on the website; the phone app keeps Google/Apple/email
        // (wallet apps can't hand a connection back into the app reliably yet).
        loginMethods: isNative ? ['google', 'apple', 'email'] : ['email', 'google', 'apple', 'wallet'],
        appearance: {
          theme: dark ? 'dark' : 'light',
          accentColor: '#E8483B',
          logo: isNative ? 'https://www.runearn.fun/icon.svg' : new URL('icon.svg', location.href).href,
          landingHeader: 'Sign in to RUNNER',
          loginMessage: isNative ? 'Your wallet is created automatically — no seed phrase needed.' : 'Email, Google or Apple creates a wallet for you — or connect your own.',
          walletChainType: 'ethereum-only',
          walletList: ['detected_ethereum_wallets', 'metamask', 'phantom', 'wallet_connect_qr', 'coinbase_wallet', 'rainbow', 'okx_wallet', 'rabby_wallet'],
        },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        // "Connect wallet" (Rewards tab, admin page): WalletConnect shows a QR code on a computer and opens
        // the wallet app on a phone; browser wallets (MetaMask etc.) are listed when installed.
        ...(WALLETCONNECT_PROJECT_ID ? { walletConnectCloudProjectId: WALLETCONNECT_PROJECT_ID } : {}),
        // The phone app opens Google/Apple in the system browser, which Google allows.
        ...(isNative ? { customOAuthRedirectUrl: NATIVE_OAUTH_REDIRECT, allowOAuthInEmbeddedBrowsers: true } : {}),
        defaultChain: ROBINHOOD_CHAIN,
        supportedChains: [ROBINHOOD_CHAIN, ROBINHOOD_TESTNET],
      },
    }, h(Bridge))));
  }

  /**
   * Opens Privy's sign-in sheet (Google / Apple / email). Sign-in finishes
   * asynchronously — listen for 'change' and check state.authenticated/address.
   */
  async login() {
    if (!(await this.load())) throw new Error(this.state.error || 'Sign-in isn\'t set up yet.');
    if (this.state.authenticated && this.state.address) return;
    this._set({ error: null });
    this._api.login();
  }

  get signedIn() { return this.state.authenticated && Boolean(this.state.address); }

  async logout() {
    if (this._api) await this._api.logout();
    this._set({ authenticated: false, user: null, address: null });
  }

  /**
   * Sends ETH on Robinhood Chain from the embedded wallet. Privy shows its own
   * confirmation screen with the amount and fee before anything is signed.
   * Resolves with the transaction hash.
   */
  async sendEth(to, valueWei) {
    return this.sendTx({ to, value: valueWei });
  }

  /**
   * Sends any transaction from the embedded wallet (Privy shows a confirmation
   * screen first). Omit `to` to deploy a contract. Resolves with the tx hash.
   */
  async sendTx({ to, value = 0n, data, chainId = ROBINHOOD_CHAIN.id }) {
    const w = this._wallet;
    if (!w) throw new Error(this._noWallet());
    await w.switchChain(chainId);
    const provider = await w.getEthereumProvider();
    const tx = { from: w.address, value: `0x${BigInt(value).toString(16)}` };
    if (to) tx.to = to;
    if (data) tx.data = data;
    return provider.request({ method: 'eth_sendTransaction', params: [tx] });
  }

  /** personal_sign a text message with the embedded wallet (Privy asks the user first). */
  async signMessage(message) {
    const w = this._wallet;
    if (!w) throw new Error(this._noWallet());
    const provider = await w.getEthereumProvider();
    const hexMsg = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    return provider.request({ method: 'personal_sign', params: [hexMsg, w.address] });
  }

  _noWallet() {
    return this.state.walletKind === 'external'
      ? `Your ${this.state.walletName || 'wallet'} isn't connected right now — unlock it (or open the wallet app) and try again.`
      : 'Wallet not ready yet — try again in a moment.';
  }

  /**
   * Opens Privy's "Connect wallet" sheet (WalletConnect, MetaMask, Coinbase Wallet…) without
   * signing in. The connected wallet shows up in state.externalWallets.
   */
  async connectWallet() {
    if (!(await this.load())) throw new Error(this.state.error || 'Wallet connect isn\'t available right now.');
    this._set({ error: null });
    this._api.connectWallet();
  }

  /** Disconnects a wallet connected with connectWallet(). */
  async disconnectWallet(address) {
    const w = this._externalWallet(address);
    try { await w?.disconnect?.(); } catch (e) { console.warn(e); }
    this._set({ externalWallets: this.state.externalWallets.filter((x) => x.address.toLowerCase() !== String(address).toLowerCase()) });
  }

  _externalWallet(address) {
    const a = String(address || '').toLowerCase();
    return (this._external || []).find((w) => w.address.toLowerCase() === a) || null;
  }

  /** Sends a transaction from a connected external wallet (it asks the user to confirm). */
  async sendTxFrom(address, { to, value = 0n, data, chainId = ROBINHOOD_CHAIN.id }) {
    const w = this._externalWallet(address);
    if (!w) throw new Error('That wallet isn\'t connected any more — connect it again.');
    await w.switchChain(chainId);
    const provider = await w.getEthereumProvider();
    const tx = { from: w.address, value: `0x${BigInt(value).toString(16)}` };
    if (to) tx.to = to;
    if (data) tx.data = data;
    return provider.request({ method: 'eth_sendTransaction', params: [tx] });
  }

  /** personal_sign with a connected external wallet (it asks the user first). */
  async signMessageFrom(address, message) {
    const w = this._externalWallet(address);
    if (!w) throw new Error('That wallet isn\'t connected any more — connect it again.');
    const provider = await w.getEthereumProvider();
    const hexMsg = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    return provider.request({ method: 'personal_sign', params: [hexMsg, w.address] });
  }

  async exportWallet() {
    if (!this._api || !this.state.address) throw new Error('Sign in first');
    if (this.state.walletKind === 'external') throw new Error(`This is your own ${this.state.walletName || 'wallet'} — its keys stay in that wallet.`);
    await this._api.exportWallet({ address: this.state.address });
  }
}

export const auth = new Auth();

// In the phone app, Google/Apple sign-in opens in Safari/Chrome (Google blocks
// sign-in inside apps). Afterwards runearn.fun/redirect sends the browser back
// into the app with a one-time code in the link; reloading the app with that
// code lets Privy finish signing in.
if (isNative) {
  const App = registerPlugin('App');
  const finishOAuth = (url) => {
    if (!url) return;
    try {
      const q = new URL(url).searchParams;
      if (!(q.has('privy_oauth_code') && q.has('privy_oauth_state') && q.has('privy_oauth_provider'))) return;
      if (location.search === `?${q}`) return;
      location.assign(`${location.pathname}?${q}${location.hash}`);
    } catch (e) { console.warn('Bad sign-in link', e); }
  };
  App.addListener('appUrlOpen', ({ url }) => finishOAuth(url));
  App.getLaunchUrl().then((r) => finishOAuth(r?.url)).catch(() => {});
}
