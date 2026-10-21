// Sign in with Google / Apple / email via Privy, which also creates an
// embedded (non-custodial) Ethereum wallet for each user — no seed phrase or
// private key to import. Privy's SDK is React-based; we load React + Privy as
// ES modules from esm.sh (no build step) and mount a tiny invisible React
// "bridge" that mirrors Privy's state into this plain EventTarget.
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, ROBINHOOD_CHAIN, ROBINHOOD_TESTNET } from './config.js';

const REACT = 'https://esm.sh/react@18.3.1';
const REACT_DOM = 'https://esm.sh/react-dom@18.3.1/client';
const PRIVY = 'https://esm.sh/@privy-io/react-auth@3.50.0?deps=react@18.3.1,react-dom@18.3.1';
const READY_TIMEOUT_MS = 25000;

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
      user: null, address: null, error: null,
    };
    this._api = null;
    this._loading = null;
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event('change'));
  }

  /** Loads Privy (once). Resolves true when ready, false if unavailable. */
  load() {
    if (!this.state.configured) return Promise.resolve(false);
    this._loading ??= this._mount();
    return this._loading;
  }

  async _mount() {
    this._set({ loading: true, error: null });
    try {
      const [React, { createRoot }, Privy] = await Promise.all([import(REACT), import(REACT_DOM), import(PRIVY)]);
      const h = React.createElement;
      const auth = this;

      function Bridge() {
        const { ready, authenticated, user } = Privy.usePrivy();
        const { wallets } = Privy.useWallets();
        const { login } = Privy.useLogin({
          onError: (err) => { if (err && err !== 'exited_auth_flow') auth._set({ error: String(err) }); },
        });
        const { logout } = Privy.useLogout();
        const { exportWallet } = Privy.useExportWallet();
        const embedded = wallets.find((w) => w.walletClientType === 'privy') || null;
        const address = embedded?.address || user?.wallet?.address || null;
        React.useEffect(() => { auth._api = { login, logout, exportWallet }; });
        React.useEffect(() => {
          auth._set({ ready, authenticated, user: summarize(user), address, loading: !ready });
        }, [ready, authenticated, user?.id, address]);
        return null;
      }

      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      const host = document.createElement('div');
      host.id = 'privy-root';
      document.body.appendChild(host);
      createRoot(host).render(h(Privy.PrivyProvider, {
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
      }, h(Bridge)));

      return await new Promise((resolve) => {
        const done = () => { if (this.state.ready) { this.removeEventListener('change', done); clearTimeout(t); resolve(true); } };
        const t = setTimeout(() => {
          this.removeEventListener('change', done);
          this._set({ loading: false, error: 'Sign-in service did not respond. Check your connection and that this site is an allowed domain in Privy.' });
          this._loading = null; // allow a retry
          resolve(false);
        }, READY_TIMEOUT_MS);
        this.addEventListener('change', done);
        done();
      });
    } catch (e) {
      console.warn('Privy failed to load', e);
      this._set({ loading: false, error: 'Couldn\'t load sign-in. Check your internet connection.' });
      this._loading = null;
      return false;
    }
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

  async exportWallet() {
    if (!this._api || !this.state.address) throw new Error('Sign in first');
    await this._api.exportWallet({ address: this.state.address });
  }
}

export const auth = new Auth();
