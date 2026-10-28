// بيئة متصفح مصغّرة لتشغيل اختبار الدخان على Node
const mem = new Map();

globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const dbStores = new Map();

function makeRequest() {
  return { onsuccess: null, onerror: null, result: undefined, error: null };
}

class FakeObjectStore {
  constructor(data) {
    this.data = data;
  }
  put(value, key) {
    const req = makeRequest();
    setImmediate(() => {
      this.data.set(key, value);
      req.result = key;
      req.onsuccess?.({ target: req });
    });
    return req;
  }
  get(key) {
    const req = makeRequest();
    setImmediate(() => {
      req.result = this.data.get(key);
      req.onsuccess?.({ target: req });
    });
    return req;
  }
  delete(key) {
    const req = makeRequest();
    setImmediate(() => {
      this.data.delete(key);
      req.onsuccess?.({ target: req });
    });
    return req;
  }
  clear() {
    const req = makeRequest();
    setImmediate(() => {
      this.data.clear();
      req.onsuccess?.({ target: req });
    });
    return req;
  }
}

globalThis.indexedDB = {
  open(name) {
    const req = makeRequest();
    const db = {
      objectStoreNames: {
        contains: (n) => dbStores.has(`${name}:${n}`),
        add: () => {},
      },
      createObjectStore: (n) => {
        dbStores.set(`${name}:${n}`, new Map());
        return new FakeObjectStore(dbStores.get(`${name}:${n}`));
      },
      transaction: (_store, _mode) => ({
        objectStore: (n) => {
          const key = `${name}:${n}`;
          if (!dbStores.has(key)) dbStores.set(key, new Map());
          return new FakeObjectStore(dbStores.get(key));
        },
      }),
      close: () => {},
    };
    setImmediate(() => {
      req.result = db;
      req.onupgradeneeded?.({ target: req });
      req.onsuccess?.({ target: req });
    });
    return req;
  },
};

globalThis.FileReader = class {
  readAsDataURL(blob) {
    setImmediate(async () => {
      const text = typeof blob.text === "function" ? await blob.text() : "";
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(text).toString("base64")}`;
      this.onload?.();
    });
  }
};

await import("./.smoke/smoke.bundle.mjs");
