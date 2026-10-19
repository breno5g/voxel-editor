import { parseVox } from '../format/vox-reader.ts';
import { writeVox } from '../format/vox-writer.ts';
import { locale, t } from '../i18n/i18n.ts';
import { isSnapshot, STORES, transact } from './browser-store.ts';
import type { Snapshot } from './browser-store.ts';
import type { Editor } from './editor.ts';

const SNAPSHOT_KEY = 'current';
const DEBOUNCE_MS = 3000;

/**
 * Keeps the latest unsaved state in IndexedDB (debounced) so a closed tab or crash
 * loses at most a few seconds of work. Cleared on an explicit save or a declined recovery.
 */
export function bindAutosave(editor: Editor) {
  const { state } = editor;
  let timer = 0;

  const save = async () => {
    try {
      await transact(STORES.autosave, 'readwrite', (store) => store.put({ fileName: state.fileName, bytes: writeVox(state.vox), savedAt: Date.now() } satisfies Snapshot, SNAPSHOT_KEY));
    } catch (error) {
      editor.fail(t('Autosave falhou'), error);
    }
  };

  const clear = async () => {
    try {
      await transact(STORES.autosave, 'readwrite', (store) => store.delete(SNAPSHOT_KEY));
    } catch (error) {
      editor.fail(t('Não foi possível limpar o autosave'), error);
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
        const snapshot: unknown = await transact(STORES.autosave, 'readonly', (store) => store.get(SNAPSHOT_KEY));
        if (!isSnapshot(snapshot)) return false;
        const when = new Date(snapshot.savedAt).toLocaleString(locale);
        if (!window.confirm(t('Há trabalho não salvo de "{file}" ({date}). Recuperar?', { file: snapshot.fileName, date: when }))) {
          await clear();
          return false;
        }
        editor.load(parseVox(snapshot.bytes), snapshot.fileName);
        editor.sceneChanged();
        editor.status(t('"{file}" recuperado do autosave. Salve para manter.', { file: snapshot.fileName }));
        return true;
      } catch (error) {
        editor.fail(t('Não foi possível ler o autosave'), error);
        return false;
      }
    },
  };
}
