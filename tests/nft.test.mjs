// RunnerGenesis tests: roles, prices/rarity vs the app, payments, 5% royalty, ERC-721C
// validator (incl. a malicious re-entering one), metadata, enumeration, admin.
// Run: cd tests && npm install && node nft.test.mjs
import { compile, readContract, iface, chain, u, errSel, decodeString } from './evm.mjs';
import { rarityOf as appRarity, priceOf as appPrice } from '../js/collection.js';

const DEV = '0x0f397e46e4e810313dbc782cdb0236347157f1b4';
const DEPLOYER = '0x1111111111111111111111111111111111111111';
const W = (n) => `0x${(0xa0 + n).toString(16).padStart(2, '0').repeat(20)}`;
const ZERO = '0x0000000000000000000000000000000000000000';
const BASE = 'https://runearn.fun/nft/';
const CURI = 'https://runearn.fun/nft/collection.json';
const RARITY = ['common', 'uncommon', 'rare', 'epic'];

const MOCKS = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
interface INFT { function transferFrom(address,address,uint256) external; }
contract MockValidator {
  mapping(address => bool) public blocked; uint256 public calls; address public lastCaller;
  function setBlocked(address op, bool b) external { blocked[op] = b; }
  function validateTransfer(address caller, address, address, uint256) external { calls++; lastCaller = caller; require(!blocked[caller], "blocked"); }
}
contract ReentrantValidator {
  address public nft; address public sink; bool public entered;
  constructor(address n, address s) { nft = n; sink = s; }
  function validateTransfer(address, address from, address, uint256 id) external {
    if (msg.sender == nft && !entered) { entered = true; INFT(nft).transferFrom(from, sink, id); }
  }
}
contract GoodReceiver { function onERC721Received(address,address,uint256,bytes calldata) external pure returns (bytes4) { return 0x150b7a02; } }
contract BadReceiver { function onERC721Received(address,address,uint256,bytes calldata) external pure returns (bytes4) { return 0xdeadbeef; } }
contract NoReceiver {}`;

const { contracts, warnings } = compile({ 'RunnerGenesis.sol': readContract('RunnerGenesis.sol'), 'Mocks.sol': MOCKS });
const N = iface(contracts['RunnerGenesis.sol'].RunnerGenesis);
const M = (n) => iface(contracts['Mocks.sol'][n]);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); } };
const reverts = (r, name) => !r.ok && (name ? r.error === errSel(name) : true);

const c = await chain();
const d = await c.send(DEPLOYER, null, N.ctor(DEV, DEV, DEV, BASE, CURI));
const nft = d.created;
const call = (from, name, ...args) => c.send(from, nft, N.data(name, ...args));
const pay = (from, value, name, ...args) => c.send(from, nft, N.data(name, ...args), value);
const view = (name, ...args) => c.view(nft, N.data(name, ...args));
const deploy = async (name, ...args) => (await c.send(DEPLOYER, null, M(name).ctor(...args))).created;

ok('compiles without warnings', warnings.length === 0, warnings.join('\n'));
ok('owner, treasury, royalty receiver = dev wallet', u(await view('owner')) === BigInt(DEV) && u(await view('treasury')) === BigInt(DEV) && u(await view('royaltyReceiver')) === BigInt(DEV));
ok('zero owner rejected', reverts(await c.send(DEPLOYER, null, N.ctor(ZERO, DEV, DEV, BASE, CURI)), 'ZeroAddress'));
ok('zero treasury rejected', reverts(await c.send(DEPLOYER, null, N.ctor(DEV, ZERO, DEV, BASE, CURI)), 'ZeroAddress'));
ok('deployer has no admin power', reverts(await call(DEPLOYER, 'setPaused', true), 'NotOwner'));
ok('contractURI', decodeString(await view('contractURI')) === CURI);
ok('interfaces: 165, 721, metadata, 2981, 4906, ICreatorToken', (await Promise.all(['0x01ffc9a7', '0x80ac58cd', '0x5b5e139f', '0x2a55205a', '0x49064906', '0xad0d7f6c'].map(async (id) => u(await view('supportsInterface', `${id}${'0'.repeat(56)}`)) === 1n))).every(Boolean));

// rarity + price for every token, against the app's formula
let mismatch = 0;
for (let id = 1; id <= 9999; id++) {
  const r = Number(u(await view('rarityOf', id)));
  if (RARITY[r] !== appRarity(id) || u(await view('priceOf', id)) !== appPrice(id)) mismatch++;
}
ok('all 9,999 rarities and prices match the app', mismatch === 0, `${mismatch} mismatches`);
ok('id 0 and 10000 invalid', reverts(await call(W(1), 'priceOf', 0), 'InvalidToken') && reverts(await call(W(1), 'priceOf', 10000), 'InvalidToken'));

// minting
const price = u(await view('priceOf', 146));
const devBefore = await c.ethBalance(DEV);
ok('wrong price rejected', reverts(await pay(W(1), price - 1n, 'mint', 146), 'WrongPrice'));
ok('mint pays exact price', (await pay(W(1), price, 'mint', 146)).ok);
ok('treasury receives the payment', (await c.ethBalance(DEV)) - devBefore === price);
ok('contract keeps no ETH', (await c.ethBalance(nft)) === 0n);
ok('owner of #146', u(await view('ownerOf', 146)) === BigInt(W(1)));
ok('already minted', reverts(await pay(W(2), price, 'mint', 146), 'AlreadyMinted'));
ok('tokenURI', decodeString(await view('tokenURI', 146)) === `${BASE}146`);
ok('plain ETH refused', !(await c.send(W(1), nft, '0x', 1n)).ok);
await pay(W(1), u(await view('priceOf', 3)), 'mint', 3);
await pay(W(1), u(await view('priceOf', 42)), 'mint', 42);
ok('enumeration', u(await view('balanceOf', W(1))) === 3n && u(await view('totalSupply')) === 3n);
const owned = await view('tokensOfOwner', W(1));
ok('tokensOfOwner', u(owned, 1) === 3n && [u(owned, 2), u(owned, 3), u(owned, 4)].join() === '146,3,42');
ok('mintedBatch', (await view('mintedBatch', [146, 147, 3])).slice(2 + 128).match(/.{64}/g).map((x) => BigInt(`0x${x}`)).join() === '1,0,1');

// royalties
const [rcv, amt] = [await view('royaltyInfo', 146, 10n ** 18n)].map((r) => [u(r, 0), u(r, 1)])[0];
ok('royalty 5% to dev wallet', rcv === BigInt(DEV) && amt === 5n * 10n ** 16n);
ok('royalty on 0.005 ETH = 0.00025', u(await view('royaltyInfo', 1, 5n * 10n ** 15n), 1) === 25n * 10n ** 13n);

// transfers + approvals
ok('stranger cannot transfer', reverts(await call(W(2), 'transferFrom', W(1), W(2), 146), 'NotAuthorized'));
await call(W(1), 'approve', W(2), 146);
ok('approved operator transfers', (await call(W(2), 'transferFrom', W(1), W(3), 146)).ok && u(await view('ownerOf', 146)) === BigInt(W(3)));
ok('approval cleared after transfer', u(await view('getApproved', 146)) === 0n);
ok('to zero rejected', reverts(await call(W(3), 'transferFrom', W(3), ZERO, 146), 'ZeroAddress'));
const good = await deploy('GoodReceiver'), bad = await deploy('BadReceiver'), none = await deploy('NoReceiver');
ok('safe transfer to receiver contract', (await call(W(3), 'safeTransferFrom(address,address,uint256)', W(3), good, 146)).ok);
ok('safe transfer to bad receiver blocked', reverts(await call(W(1), 'safeTransferFrom(address,address,uint256)', W(1), bad, 3), 'UnsafeRecipient'));
ok('safe transfer to non-receiver blocked', reverts(await call(W(1), 'safeTransferFrom(address,address,uint256)', W(1), none, 3), 'UnsafeRecipient'));

// ERC-721C validator
const v = await deploy('MockValidator');
ok('only owner sets validator', reverts(await call(W(1), 'setTransferValidator', v), 'NotOwner'));
await call(DEV, 'setTransferValidator', v);
ok('validator stored', u(await view('getTransferValidator')) === BigInt(v));
await call(W(1), 'setApprovalForAll', W(5), true);
await c.send(DEPLOYER, v, M('MockValidator').data('setBlocked', W(5), true));
ok('validator blocks a disallowed marketplace', !(await call(W(5), 'transferFrom', W(1), W(6), 3)).ok);
ok('owner transfers still pass the validator', (await call(W(1), 'transferFrom', W(1), W(6), 3)).ok);
ok('validator saw the right caller', u(await c.view(v, M('MockValidator').data('lastCaller'))) === BigInt(W(1)));
ok('mints are not validated', (await pay(W(7), u(await view('priceOf', 500)), 'mint', 500)).ok);
// malicious validator that moves the token during validation
const sink = W(9);
const evil = await deploy('ReentrantValidator', nft, sink);
await call(DEV, 'setTransferValidator', evil);
await call(W(1), 'setApprovalForAll', evil, true);
await pay(W(1), u(await view('priceOf', 77)), 'mint', 77);  // wallet holds several tokens
await pay(W(1), u(await view('priceOf', 78)), 'mint', 78);
const r = await call(W(1), 'transferFrom', W(1), W(4), 42);
const list = await view('tokensOfOwner', W(1));
ok('re-entering validator cannot move a token twice (transfer reverts, state intact)', !r.ok && u(await view('ownerOf', 42)) === BigInt(W(1)) && u(await view('balanceOf', W(1))) === 3n && u(list, 1) === 3n && u(await view('balanceOf', sink)) === 0n, `ok=${r.ok} owner=${u(await view('ownerOf', 42)).toString(16)}`);
await call(DEV, 'setTransferValidator', ZERO);
ok('removing validator frees transfers', (await call(W(1), 'transferFrom', W(1), W(4), 42)).ok);

// admin
await call(DEV, 'setPaused', true);
ok('paused blocks minting', reverts(await pay(W(1), u(await view('priceOf', 7)), 'mint', 7), 'MintingPaused'));
await call(DEV, 'setPaused', false);
ok('setBaseURI', (await call(DEV, 'setBaseURI', 'ipfs://x/')).ok && decodeString(await view('tokenURI', 146)) === 'ipfs://x/146');
ok('setContractURI', (await call(DEV, 'setContractURI', 'ipfs://c')).ok && decodeString(await view('contractURI')) === 'ipfs://c');
ok('setRoyaltyReceiver', (await call(DEV, 'setRoyaltyReceiver', W(8))).ok && u(await view('royaltyInfo', 1, 100n), 0) === BigInt(W(8)));
ok('setTreasury rejects zero', reverts(await call(DEV, 'setTreasury', ZERO), 'ZeroAddress'));
await call(DEV, 'transferOwnership', W(8));
ok('old owner locked out', reverts(await call(DEV, 'setPaused', true), 'NotOwner'));
ok('new owner works', (await call(W(8), 'setPaused', false)).ok);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
