// Tiny key-value store for the rewards server: Upstash Redis over its REST API
// (added from the Vercel Marketplace, which sets KV_REST_API_URL / _TOKEN or
// UPSTASH_REDIS_REST_URL / _TOKEN). REWARDS_STORE=memory keeps data in memory
// for local tests.
const env = globalThis.process?.env || {};
const URL_ = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
const memory = env.REWARDS_STORE === 'memory' && env.VERCEL_ENV !== 'production' ? new Map() : null;

export const storeConfigured = () => Boolean(memory || (URL_ && TOKEN));

async function redis(...args) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Store error: ${j.error || r.status}`);
  return j.result;
}

export async function get(key) {
  if (memory) { const e = memory.get(key); return e && (!e.exp || e.exp > Date.now()) ? JSON.parse(e.v) : null; }
  const v = await redis('GET', key);
  return v == null ? null : JSON.parse(v);
}

export async function set(key, value) {
  if (memory) { memory.set(key, { v: JSON.stringify(value) }); return; }
  await redis('SET', key, JSON.stringify(value));
}

/** Sets only if missing, expiring after `ms`. Returns true if it was set (a lock). */
export async function setNX(key, value, ms) {
  if (memory) {
    const e = memory.get(key);
    if (e && (!e.exp || e.exp > Date.now())) return false;
    memory.set(key, { v: JSON.stringify(value), exp: Date.now() + ms });
    return true;
  }
  return (await redis('SET', key, JSON.stringify(value), 'NX', 'PX', String(ms))) === 'OK';
}

export async function del(key) {
  if (memory) { memory.delete(key); return; }
  await redis('DEL', key);
}

/** Atomically adds `n` (integer) to a counter and returns the new value. */
export async function incrBy(key, n) {
  if (memory) { const v = (memory.get(key) ? JSON.parse(memory.get(key).v) : 0) + n; memory.set(key, { v: JSON.stringify(v) }); return v; }
  return Number(await redis('INCRBY', key, String(n)));
}

/** Counter that expires `ms` after its first increment (rate limits). Returns the new value. */
export async function incrTtl(key, ms) {
  if (memory) {
    const e = memory.get(key);
    const live = e && (!e.exp || e.exp > Date.now());
    const v = (live ? JSON.parse(e.v) : 0) + 1;
    memory.set(key, { v: JSON.stringify(v), exp: live ? e.exp : Date.now() + ms });
    return v;
  }
  const v = Number(await redis('INCR', key));
  if (v === 1) await redis('PEXPIRE', key, String(ms));
  return v;
}

// Small string lists (review queue, ban list): newest first, trimmed to `max`.
export async function listPush(key, value, max = 1000) {
  if (memory) {
    const list = memory.get(key) ? JSON.parse(memory.get(key).v) : [];
    memory.set(key, { v: JSON.stringify([value, ...list.filter((x) => x !== value)].slice(0, max)) });
    return;
  }
  await redis('LREM', key, '0', value);
  await redis('LPUSH', key, value);
  await redis('LTRIM', key, '0', String(max - 1));
}

export async function listRange(key, n = 200) {
  if (memory) return (memory.get(key) ? JSON.parse(memory.get(key).v) : []).slice(0, n);
  return (await redis('LRANGE', key, '0', String(n - 1))) || [];
}

export async function listRemove(key, value) {
  if (memory) {
    const list = memory.get(key) ? JSON.parse(memory.get(key).v) : [];
    memory.set(key, { v: JSON.stringify(list.filter((x) => x !== value)) });
    return;
  }
  await redis('LREM', key, '0', value);
}
