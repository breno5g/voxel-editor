import { t } from '../i18n/i18n.ts';
import { moveKeys, removeKeys, reverseKeys } from '../scene/keyframes.ts';
import type { Editor, KeyTrack } from './editor.ts';
import { sceneChange } from './scene-change.ts';

/** The keyed nodes of the primary selection: its transform (position keys) and, for an object, its shape (model frames). */
function trackNodes(editor: Editor) {
  const { state } = editor;
  const transform = state.selected === null ? undefined : state.vox.nodes[state.selected];
  if (transform?.kind !== 'transform') return null;
  const shape = state.vox.nodes[transform.child];
  return { transform, shape: shape?.kind === 'shape' ? shape : undefined };
}

/** MagicaVoxel's timeline key commands: `asel`, dragging selected keys (Ctrl copies), `adel` on the selection, `arev`. */
export function createKeyCommands(editor: Editor) {
  const { state } = editor;
  const change = sceneChange(editor);

  const framesOf = (track: KeyTrack) => {
    const nodes = trackNodes(editor);
    const node = nodes?.[track];
    return node ? node.keys.map((key) => key.frame) : [];
  };

  /** Applies `edit` to the selected keys of each track as one undo step, then selects `select(track)` frames. */
  const editSelected = (edit: <K extends { frame: number }>(keys: K[], frames: number[]) => K[], select: (frames: number[]) => number[], message: string) => {
    const nodes = trackNodes(editor);
    if (!nodes) return editor.status(t('Selecione um objeto primeiro'), 'error');
    const tracks = (['transform', 'shape'] as const).filter((track) => state.keySelection[track].length > 0);
    if (tracks.length === 0) return editor.status(t('Selecione keys na timeline (clique, Shift soma)'), 'error');
    const { transform, shape } = nodes;
    const before = { transform: transform.keys, shape: shape?.keys };
    const after = {
      transform: tracks.includes('transform') ? edit(transform.keys, state.keySelection.transform) : transform.keys,
      shape: shape && tracks.includes('shape') ? edit(shape.keys, state.keySelection.shape) : shape?.keys,
    };
    const previous = state.keySelection;
    const next = { transform: tracks.includes('transform') ? select(previous.transform) : [], shape: tracks.includes('shape') ? select(previous.shape) : [] };
    change(
      () => {
        transform.keys = after.transform;
        if (shape && after.shape) shape.keys = after.shape;
        editor.setKeySelection(next);
      },
      () => {
        transform.keys = before.transform;
        if (shape && before.shape) shape.keys = before.shape;
        editor.setKeySelection(previous);
      },
      message,
    );
  };

  return {
    /** A click on a key: selects it alone, or with `toggle` (Shift) adds or removes it. */
    clickKey(track: KeyTrack, frame: number, toggle: boolean) {
      const current = state.keySelection[track];
      const frames = toggle ? (current.includes(frame) ? current.filter((value) => value !== frame) : [...current, frame]) : current.includes(frame) ? current : [frame];
      editor.setKeySelection(toggle ? { ...state.keySelection, [track]: frames } : { transform: [], shape: [], [track]: frames });
    },

    /** MagicaVoxel `asel all|inv|none`, on both tracks. */
    selectKeys(which: 'all' | 'inv' | 'none') {
      const pick = (track: KeyTrack) => {
        const frames = framesOf(track);
        if (which === 'all') return frames;
        if (which === 'none') return [];
        return frames.filter((frame) => !state.keySelection[track].includes(frame));
      };
      editor.setKeySelection({ transform: pick('transform'), shape: pick('shape') });
    },

    /** Dragging selected keys `delta` frames along the timeline; `copy` (Ctrl) leaves the originals. */
    moveSelectedKeys(delta: number, copy: boolean) {
      if (delta === 0) return;
      editSelected(
        (keys, frames) => moveKeys(keys, frames, delta, copy),
        (frames) => frames.map((frame) => frame + delta),
        copy ? t('Keys duplicadas') : t('Keys movidas'),
      );
    },

    /** MagicaVoxel `adel` on the key selection. */
    deleteSelectedKeys() {
      editSelected((keys, frames) => removeKeys(keys, frames), () => [], t('Keys apagadas'));
    },

    /** MagicaVoxel `arev`. */
    reverseSelectedKeys() {
      editSelected((keys, frames) => reverseKeys(keys, frames), (frames) => frames.map((frame) => Math.min(...frames) + Math.max(...frames) - frame), t('Keys invertidas'));
    },

    hasKeySelection: () => state.keySelection.transform.length + state.keySelection.shape.length > 0,
  };
}

export type KeyCommands = ReturnType<typeof createKeyCommands>;
