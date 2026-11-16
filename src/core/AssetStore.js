// IndexedDB persistence for user content: imported line JSON and MP3 announcements.
const DB = 'metrosim-assets';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('lines')) db.createObjectStore('lines');
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const AssetStore = {
  putLine: (id, json) => tx('lines', 'readwrite', (s) => s.put(json, id)),
  deleteLine: (id) => tx('lines', 'readwrite', (s) => s.delete(id)),
  async listLines() {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const out = [];
        const req = db.transaction('lines').objectStore('lines').openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (c) { out.push({ id: c.key, json: c.value }); c.continue(); } else resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
    } catch { return []; }
  },
  /** key = `${lineId}/${audioKey}` ; value = Blob (audio/mpeg) */
  putAudio: (key, blob) => tx('audio', 'readwrite', (s) => s.put(blob, key)),
  getAudio: async (key) => { try { return await tx('audio', 'readonly', (s) => s.get(key)); } catch { return undefined; } },
  deleteAudio: (key) => tx('audio', 'readwrite', (s) => s.delete(key)),
  async listAudioKeys(prefix) {
    try {
      const keys = await tx('audio', 'readonly', (s) => s.getAllKeys());
      return (keys || []).filter((k) => !prefix || String(k).startsWith(prefix));
    } catch { return []; }
  },
};
