/** IndexedDB stores of this editor: the autosave snapshot and the projects saved in the browser. */
const DATABASE = 'voxel-editor';
const VERSION = 2;
export const STORES = { autosave: 'autosave', projects: 'projects' } as const;
type StoreName = (typeof STORES)[keyof typeof STORES];

/** A saved document: its name, `.vox` bytes and when it was written. */
export type Snapshot = { fileName: string; bytes: Uint8Array; savedAt: number };

export function isSnapshot(value: unknown): value is Snapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fileName' in value &&
    typeof value.fileName === 'string' &&
    'savedAt' in value &&
    typeof value.savedAt === 'number' &&
    'bytes' in value &&
    value.bytes instanceof Uint8Array
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      for (const store of Object.values(STORES)) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function transact<T>(storeName: StoreName, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
