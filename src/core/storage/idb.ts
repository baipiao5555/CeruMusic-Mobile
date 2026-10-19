const DB_NAME = 'ceru-music-mobile'
const DB_VERSION = 1

let opening: Promise<IDBDatabase> | undefined

function openDB(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('plugins')) db.createObjectStore('plugins', { keyPath: 'pluginId' })
      if (!db.objectStoreNames.contains('pluginConfig')) db.createObjectStore('pluginConfig')
      if (!db.objectStoreNames.contains('pluginStorage')) db.createObjectStore('pluginStorage')
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return opening
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const request = run(transaction.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const idb = {
  get<T = any>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
  },
  set(store: string, key: IDBValidKey, value: any): Promise<IDBValidKey> {
    return tx(store, 'readwrite', (s) =>
      s.keyPath == null ? s.put(value, key) : s.put(value)
    )
  },
  del(store: string, key: IDBValidKey): Promise<undefined> {
    return tx(store, 'readwrite', (s) => s.delete(key))
  },
  all<T = any>(store: string): Promise<T[]> {
    return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
  },
  keys(store: string): Promise<IDBValidKey[]> {
    return tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>)
  },
  clear(store: string): Promise<undefined> {
    return tx(store, 'readwrite', (s) => s.clear())
  }
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
