// Tiny IndexedDB wrapper. Activity summaries and GPS streams live in separate
// stores so the feed can load quickly without pulling every track point.
const DB_NAME = 'runearn';
const VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('activities', { keyPath: 'id' }).createIndex('startTime', 'startTime');
        d.createObjectStore('streams');
        d.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  async listActivities() {
    const all = await tx(['activities'], 'readonly', (t) => t.objectStore('activities').getAll());
    return all.sort((a, b) => b.startTime - a.startTime);
  },
  getActivity: (id) => tx(['activities'], 'readonly', (t) => t.objectStore('activities').get(id)),
  getStream: (id) => tx(['streams'], 'readonly', (t) => t.objectStore('streams').get(id)),
  saveActivity: (act, points) =>
    tx(['activities', 'streams'], 'readwrite', (t) => {
      t.objectStore('activities').put(act);
      if (points) t.objectStore('streams').put(points, act.id);
    }),
  updateActivity: (act) => tx(['activities'], 'readwrite', (t) => t.objectStore('activities').put(act)),
  deleteActivity: (id) =>
    tx(['activities', 'streams'], 'readwrite', (t) => {
      t.objectStore('activities').delete(id);
      t.objectStore('streams').delete(id);
    }),
  kvGet: (k) => tx(['kv'], 'readonly', (t) => t.objectStore('kv').get(k)),
  kvSet: (k, v) => tx(['kv'], 'readwrite', (t) => t.objectStore('kv').put(v, k)),
  kvDel: (k) => tx(['kv'], 'readwrite', (t) => t.objectStore('kv').delete(k)),
  clearAll: () =>
    tx(['activities', 'streams', 'kv'], 'readwrite', (t) => {
      ['activities', 'streams', 'kv'].forEach((s) => t.objectStore(s).clear());
    }),
};
