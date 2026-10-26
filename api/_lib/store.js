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

/** Values of several keys in one round trip (null where missing). */
export async function mget(keys) {
  if (!keys.length) return [];
  if (memory) return Promise.all(keys.map(get));
  const vs = await redis('MGET', ...keys);
  return vs.map((v) => (v == null ? null : JSON.parse(v)));
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

// Sorted sets (leaderboards): member → score.
const zmem = (key) => { const e = memory.get(key); return e ? new Map(JSON.parse(e.v)) : new Map(); };
const zsave = (key, m) => memory.set(key, { v: JSON.stringify([...m]) });

/** Adds `n` to a member's score; the set expires `ms` after this write when `ms` is given. */
export async function zIncrBy(key, member, n, ms = 0) {
  if (memory) { const m = zmem(key); m.set(member, (m.get(member) || 0) + n); zsave(key, m); return; }
  await redis('ZINCRBY', key, String(n), member);
  if (ms) await redis('PEXPIRE', key, String(ms));
}

/** Highest scores first: [[member, score], …]. */
export async function zTop(key, n) {
  if (memory) return [...zmem(key)].sort((a, b) => b[1] - a[1]).slice(0, n);
  const flat = (await redis('ZREVRANGE', key, '0', String(n - 1), 'WITHSCORES')) || [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], Number(flat[i + 1])]);
  return out;
}

/** Scores of several members (null where missing). */
export async function zScores(key, members) {
  if (!members.length) return [];
  if (memory) { const m = zmem(key); return members.map((x) => (m.has(x) ? m.get(x) : null)); }
  return ((await redis('ZMSCORE', key, ...members)) || []).map((v) => (v == null ? null : Number(v)));
}

/** A member's place (0 = first) and score, or null. */
export async function zRank(key, member) {
  if (memory) {
    const sorted = [...zmem(key)].sort((a, b) => b[1] - a[1]);
    const i = sorted.findIndex(([x]) => x === member);
    return i < 0 ? null : { rank: i, score: sorted[i][1] };
  }
  const [rank, score] = await Promise.all([redis('ZREVRANK', key, member), redis('ZSCORE', key, member)]);
  return rank == null ? null : { rank: Number(rank), score: Number(score) };
}

export async function zRem(key, member) {
  if (memory) { const m = zmem(key); m.delete(member); zsave(key, m); return; }
  await redis('ZREM', key, member);
}
