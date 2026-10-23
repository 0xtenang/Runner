// Test helpers: compile with the official Solidity compiler and run contracts in a
// local EVM (same settings as /admin.html: solc 0.8.24, optimizer 200, evm "paris").
import fs from 'node:fs';
import solc from 'solc';
import { EVM } from '@ethereumjs/evm';
import { Common } from '@ethereumjs/common';
import { Block } from '@ethereumjs/block';
import { Address, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { keccak_256 } from '@noble/hashes/sha3';

export const SETTINGS = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] } } };
export const toHex = (u8) => Buffer.from(u8).toString('hex');
export const keccakHex = (data) => toHex(keccak_256(typeof data === 'string' ? new TextEncoder().encode(data) : data));

export function compile(sources) {
  const input = { language: 'Solidity', sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { content: v }])), settings: SETTINGS };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  return { contracts: out.contracts, warnings: (out.errors || []).filter((e) => e.severity !== 'error').map((e) => e.formattedMessage) };
}
export const readContract = (path) => fs.readFileSync(process.env.TOKEN_SRC && path === 'RunnerToken.sol' ? process.env.TOKEN_SRC : process.env.NFT_SRC && path === 'RunnerGenesis.sol' ? process.env.NFT_SRC : new URL(`../contracts/${path}`, import.meta.url), 'utf8');

// ---- ABI (static types only: address, uint*, bool, bytes32)
export const word = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
export const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
function encArg(type, v) {
  if (type === 'address') return addrWord(v);
  if (type === 'bool') return word(v ? 1 : 0);
  if (type === 'bytes32') return String(v).replace(/^0x/, '').padStart(64, '0');
  return word(v);
}
const isDynamic = (t) => t === 'string' || t === 'bytes' || t.endsWith('[]');
function encTail(type, v) {
  if (type === 'string' || type === 'bytes') {
    const b = type === 'string' ? Buffer.from(String(v)).toString('hex') : String(v).replace(/^0x/, '');
    return word(b.length / 2) + b.padEnd(Math.ceil(b.length / 64) * 64, '0');
  }
  return word(v.length) + v.map((x) => encArg(type.slice(0, -2), x)).join('');
}
/** ABI-encodes values (static types, string, bytes, static arrays of one level). */
export function encode(types, values) {
  let head = '', tail = '';
  for (let i = 0; i < types.length; i++) {
    if (isDynamic(types[i])) { head += word(types.length * 32 + tail.length / 2); tail += encTail(types[i], values[i]); } else head += encArg(types[i], values[i]);
  }
  return head + tail;
}
/** Decodes a single returned string. */
export const decodeString = (ret) => { const h = ret.slice(2); const off = Number(BigInt(`0x${h.slice(0, 64)}`)) * 2; const len = Number(BigInt(`0x${h.slice(off, off + 64)}`)); return Buffer.from(h.slice(off + 64, off + 64 + len * 2), 'hex').toString(); };
export function iface(compiled) {
  const ids = compiled.evm.methodIdentifiers;
  const fns = Object.fromEntries(compiled.abi.filter((x) => x.type === 'function').map((f) => [f.name, f]));
  return {
    bytecode: compiled.evm.bytecode.object,
    data(name, ...args) {
      // name may be a bare name or a full signature (for overloads)
      const sig = name.includes('(') ? name : (() => { const f = fns[name]; return `${name}(${f.inputs.map((i) => i.type).join(',')})`; })();
      const types = sig.slice(sig.indexOf('(') + 1, -1).split(',').filter(Boolean);
      if (!ids[sig]) throw new Error(`no function ${sig}`);
      return `0x${ids[sig]}${encode(types, args)}`;
    },
    ctor(...args) {
      const c = compiled.abi.find((x) => x.type === 'constructor');
      return `0x${compiled.evm.bytecode.object}${encode((c?.inputs || []).map((i) => i.type), args)}`;
    },
    selectors: Object.keys(ids),
    writes: compiled.abi.filter((x) => x.type === 'function' && !['view', 'pure'].includes(x.stateMutability)).map((f) => f.name).sort(),
  };
}
export const errSel = (name) => keccakHex(`${name}()`).slice(0, 8);

// ---- chain
export async function chain({ chainId = 4663 } = {}) {
  const common = Common.custom({ chainId, networkId: chainId }, { hardfork: 'shanghai' });
  const evm = await EVM.create({ common });
  let now = 1_771_200_000n;
  const run = async (from, to, data, value = 0n) => {
    const block = Block.fromBlockData({ header: { timestamp: now, number: 100n, gasLimit: 30_000_000n } }, { common });
    const r = await evm.runCall({ caller: new Address(hexToBytes(from)), to: to ? new Address(hexToBytes(to)) : undefined, data: hexToBytes(data), value: BigInt(value), gasLimit: 15_000_000n, skipBalance: true, block });
    const ex = r.execResult;
    const ret = bytesToHex(ex.returnValue);
    return { ok: !ex.exceptionError, ret, gas: ex.executionGasUsed, created: r.createdAddress?.toString(), error: ex.exceptionError ? ret.slice(2, 10) : null };
  };
  return {
    common,
    get now() { return now; },
    setTime(t) { now = BigInt(t); },
    addTime(s) { now += BigInt(Math.floor(s)); },
    send: run,
    async ethBalance(a) { return (await evm.stateManager.getAccount(new Address(hexToBytes(a))))?.balance ?? 0n; },
    async view(to, data) { const r = await run('0x00000000000000000000000000000000000000aa', to, data); if (!r.ok) throw new Error(`view reverted ${r.error}`); return r.ret; },
  };
}
export const u = (ret, i = 0) => BigInt(`0x${ret.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'}`);
