import { parseVox } from '../format/vox-reader.ts';
import { writeVox } from '../format/vox-writer.ts';
import type { Editor } from './editor.ts';

type Snapshot = { fileName: string; bytes: Uint8Array; savedAt: number };

const DATABASE = 'voxel-editor';
const STORE = 'autosave';
const SNAPSHOT_KEY = 'current';
const DEBOUNCE_MS = 3000;

function isSnapshot(value: unknown): value is Snapshot {
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
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Keeps the latest unsaved state in IndexedDB (debounced) so a closed tab or crash
 * loses at most a few seconds of work. Cleared on an explicit save or a declined recovery.
 */
export function bindAutosave(editor: Editor) {
  const { state } = editor;
  let timer = 0;

  const save = async () => {
    try {
      await transact('readwrite', (store) => store.put({ fileName: state.fileName, bytes: writeVox(state.vox), savedAt: Date.now() } satisfies Snapshot, SNAPSHOT_KEY));
    } catch (error) {
      editor.fail('Autosave falhou', error);
    }
  };

  const clear = async () => {
    try {
      await transact('readwrite', (store) => store.delete(SNAPSHOT_KEY));
    } catch (error) {
      editor.fail('Não foi possível limpar o autosave', error);
    }
  };

  editor.subscribe((event) => {
    if (event.type === 'saved') {
      window.clearTimeout(timer);
      void clear();
      return;
    }
    if (event.type === 'status' || !state.dirty) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), DEBOUNCE_MS);
  });

  return {
    /** Offers the last unsaved snapshot, if any. Resolves true when it was restored. */
    async recover(): Promise<boolean> {
      try {
        const snapshot: unknown = await transact('readonly', (store) => store.get(SNAPSHOT_KEY));
        if (!isSnapshot(snapshot)) return false;
        const when = new Date(snapshot.savedAt).toLocaleString();
        if (!window.confirm(`Há trabalho não salvo de "${snapshot.fileName}" (${when}). Recuperar?`)) {
          await clear();
          return false;
        }
        editor.load(parseVox(snapshot.bytes), snapshot.fileName);
        editor.sceneChanged();
        editor.status(`"${snapshot.fileName}" recuperado do autosave. Salve para manter.`);
        return true;
      } catch (error) {
        editor.fail('Não foi possível ler o autosave', error);
        return false;
      }
    },
  };
}
