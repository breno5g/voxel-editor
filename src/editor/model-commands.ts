import { EMPTY_VOXEL } from '../format/vox.ts';
import type { VoxModel } from '../format/vox.ts';
import { chunkCounts } from '../geometry/mesher.ts';
import type { Editor } from './editor.ts';

export type ModelCommands = ReturnType<typeof createModelCommands>;

const allChunks = (model: VoxModel) => {
  const [x, y, z] = chunkCounts(model.size);
  return new Set(Array.from({ length: x * y * z }, (_unused, chunk) => chunk));
};

/** Whole-volume edits of the model being edited (MagicaVoxel's model editor actions); each is one undo step. */
export function createModelCommands(editor: Editor) {
  const { state } = editor;

  /**
   * Rewrites every voxel of the edited model in place. Undo keeps a full copy of the voxels.
   * ponytail: one snapshot per edit; switch to run-length or sparse diffs if huge models make history heavy.
   */
  const rewrite = (edit: (voxels: Uint8Array) => void, message: string) => {
    const instance = editor.selectedInstance();
    if (!instance) return editor.status('Selecione um objeto primeiro', 'error');
    const model = state.vox.models[instance.model];
    const before = model.voxels.slice();
    edit(model.voxels);
    const after = model.voxels.slice();
    const restore = (voxels: Uint8Array) => () => {
      model.voxels.set(voxels);
      editor.voxelsChanged(model, allChunks(model));
    };
    restore(after)();
    editor.history.push({ undo: restore(before), redo: restore(after) });
    editor.status(message);
  };

  return {
    /** MagicaVoxel `full` (U): fills the whole volume with the current colour. */
    full() {
      const { color } = state;
      rewrite((voxels) => voxels.fill(color), 'Volume preenchido');
    },

    /** MagicaVoxel `fill` (I): repaints every voxel with the current colour. */
    fill() {
      const { color } = state;
      rewrite((voxels) => {
        for (let index = 0; index < voxels.length; index++) if (voxels[index] !== EMPTY_VOXEL) voxels[index] = color;
      }, 'Voxels pintados com a cor atual');
    },

    /** MagicaVoxel `zero` (Delete/Backspace): clears every voxel. */
    zero() {
      rewrite((voxels) => voxels.fill(EMPTY_VOXEL), 'Voxels apagados');
    },
  };
}
