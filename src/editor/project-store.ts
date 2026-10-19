import { parseVox } from '../format/vox-reader.ts';
import { writeVox } from '../format/vox-writer.ts';
import { t } from '../i18n/i18n.ts';
import { isSnapshot, STORES, transact } from './browser-store.ts';
import type { Editor } from './editor.ts';

export type ProjectEntry = { name: string; savedAt: number; bytes: number };

/** MagicaVoxel's project list (`saveas`, `dup`, `open`, `del`), kept in the browser's IndexedDB. */
export function createProjectStore(editor: Editor) {
  const { state } = editor;
  const keyOf = (name: string) => (/\.vox$/i.test(name.trim()) ? name.trim() : `${name.trim()}.vox`);

  const put = (name: string, bytes: Uint8Array) => transact(STORES.projects, 'readwrite', (store) => store.put({ fileName: name, bytes, savedAt: Date.now() }, name));

  return {
    async list(): Promise<ProjectEntry[]> {
      const values: unknown[] = await transact(STORES.projects, 'readonly', (store) => store.getAll());
      return values.filter(isSnapshot).map(({ fileName, savedAt, bytes }) => ({ name: fileName, savedAt, bytes: bytes.length })).sort((a, b) => b.savedAt - a.savedAt);
    },

    /** Saves the document under `name` (the current file name by default) and makes it the document's name. */
    async save(name = state.fileName) {
      const key = keyOf(name);
      await put(key, writeVox(editor.savedDocument()));
      editor.markSaved(key);
      editor.status(t('{file} salvo no navegador', { file: key }));
    },

    async open(name: string) {
      const snapshot: unknown = await transact(STORES.projects, 'readonly', (store) => store.get(name));
      if (!isSnapshot(snapshot)) return editor.status(t('Projeto {name} não encontrado', { name }), 'error');
      editor.load(parseVox(snapshot.bytes), snapshot.fileName);
      editor.status(t('{file} aberto', { file: snapshot.fileName }));
    },

    /** MagicaVoxel `dup`: a copy of project `name` as `name-copia`. */
    async duplicate(name: string) {
      const snapshot: unknown = await transact(STORES.projects, 'readonly', (store) => store.get(name));
      if (!isSnapshot(snapshot)) return;
      const copy = keyOf(`${name.replace(/\.vox$/i, '')}-copia`);
      await put(copy, snapshot.bytes);
      editor.status(t('{file} criado', { file: copy }));
    },

    async remove(name: string) {
      await transact(STORES.projects, 'readwrite', (store) => store.delete(name));
      editor.status(t('{file} apagado do navegador', { file: name }));
    },
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
