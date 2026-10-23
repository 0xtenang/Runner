// Runs the official Solidity compiler (soljson 0.8.24) off the main thread for admin.html.
self.Module = { onRuntimeInitialized() { self.postMessage({ ready: true }); } };
importScripts('https://binaries.soliditylang.org/bin/soljson-v0.8.24+commit.e11b9ed9.js');
self.onmessage = (e) => {
  try {
    const cw = (self.Module.cwrap || self.cwrap);
    const version = cw('solidity_version', 'string', [])();
    const out = cw('solidity_compile', 'string', ['string', 'number', 'number'])(JSON.stringify(e.data), 0, 0);
    self.postMessage({ version, out });
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
