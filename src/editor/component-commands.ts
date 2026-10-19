import { copyComponent, emptyDocument } from '../format/components.ts';
import type { Component } from '../format/components.ts';
import { writeVox } from '../format/vox-writer.ts';
import type { VoxDocument } from '../format/vox.ts';
import type { Editor } from './editor.ts';

export const COMPONENT_LABELS: Record<Component, string> = { palette: 'Paleta', material: 'Materiais', render: 'Render', camera: 'Câmeras', note: 'Notas' };

/** MagicaVoxel `i_comp`/`o_comp`: bring one component in from another file, or write it alone to a file. */
export function createComponentCommands(editor: Editor) {
  const { state } = editor;
  /** Palette and materials redraw; cameras, notes and render settings only change what is saved. */
  const changed = (component: Component) => (component === 'palette' || component === 'material' || component === 'note' ? editor.paletteChanged() : editor.sceneChanged());

  return {
    importComponent(component: Component, source: VoxDocument) {
      const before = emptyDocument();
      copyComponent[component](state.vox, before);
      const apply = (from: VoxDocument) => () => {
        copyComponent[component](from, state.vox);
        changed(component);
      };
      apply(source)();
      editor.history.push({ undo: apply(before), redo: apply(source) });
      editor.status(`${COMPONENT_LABELS[component]}: importado de outro arquivo`);
    },

    /** A .vox holding only `component` (and the default palette, unless it is the palette). */
    exportComponent(component: Component): Uint8Array<ArrayBuffer> {
      const document = emptyDocument();
      copyComponent[component](state.vox, document);
      return writeVox(document);
    },
  };
}

export type ComponentCommands = ReturnType<typeof createComponentCommands>;
