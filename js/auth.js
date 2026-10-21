// Sign in with Google / Apple / email via Privy, which also creates an
// embedded (non-custodial) Ethereum wallet for each user — no seed phrase or
// private key to import. Privy's SDK is React-based; we load React + Privy as
// ES modules from esm.sh (no build step) and mount a tiny invisible React
// "bridge" that mirrors Privy's state into this plain EventTarget.
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, ROBINHOOD_CHAIN, ROBINHOOD_TESTNET } from './config.js';

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
      const embedded = wallets.find((w) => w.walletClientType === 'privy') || null;
      const address = embedded?.address || user?.wallet?.address || null;
      React.useEffect(() => { auth._api = { login, logout, exportWallet }; auth._wallet = embedded; });
      React.useEffect(() => {
        auth._set({
          ready, authenticated, user: summarize(user), address, loading: !ready,
          ...(ready ? { stage: 'ready', error: auth.state.stage === 'start-timeout' ? null : auth.state.error } : {}),
        });
      }, [ready, authenticated, user?.id, address]);
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
        loginMethods: ['google', 'apple', 'email'],
        appearance: {
          theme: dark ? 'dark' : 'light',
          accentColor: '#a3e635',
          logo: new URL('icon.svg', location.href).href,
          landingHeader: 'Sign in to RUNNER',
          loginMessage: 'Your wallet is created automatically — no seed phrase needed.',
        },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
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
    const w = this._wallet;
    if (!w) throw new Error('Wallet not ready yet — try again in a moment.');
    await w.switchChain(ROBINHOOD_CHAIN.id);
    const provider = await w.getEthereumProvider();
    return provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: w.address, to, value: `0x${valueWei.toString(16)}` }],
    });
  }

  async exportWallet() {
    if (!this._api || !this.state.address) throw new Error('Sign in first');
    await this._api.exportWallet({ address: this.state.address });
  }
}

export const auth = new Auth();
