import type { Vec3 } from '../format/vox.ts';
import type { ClientRect, Viewport } from '../render/viewport.ts';
import { childOfGroup, parentMap, rootLevel } from '../scene/scene-tree.ts';
import type { Editor } from './editor.ts';
import type { ObjectCommands } from './object-commands.ts';
import { selectionMode } from './voxel-selection.ts';
import type { SelectionMode } from './voxel-selection.ts';
import type { PointerModifiers } from './voxel-tools.ts';

type DragHandle = NonNullable<ReturnType<ObjectCommands['dragSelected']>>;
/** Horizontal drags slide over the plane at the grabbed height; upright ones (Ctrl) move along z. */
type Drag = { handle: DragHandle; origin: Vec3; upright: boolean; last: string };
type Marquee = { rect: ClientRect; mode: SelectionMode; previous: number[] };

/** A press that travels less than this (in pixels) is a click. */
const CLICK_SLOP = 3;

/**
 * World editor pointer input (MagicaVoxel `b_obj`). `move`: a click selects the object (or group) under
 * the pointer at the current level, Shift adds or removes it, and dragging moves the whole selection in
 * whole voxels (Ctrl: up and down, Ctrl+Shift: duplicates first). `msel`, and any press on empty space,
 * draws a marquee (Shift adds, Shift+Alt removes).
 */
export function createWorldTools(editor: Editor, commands: ObjectCommands, viewport: Viewport) {
  const { state } = editor;
  let drag: Drag | null = null;
  let marquee: Marquee | null = null;

  /** The node at the current level holding object `transformId`; outside it, the world goes back to the root level. */
  const levelNode = (transformId: number) => {
    const parents = parentMap(state.vox);
    const root = rootLevel(state.vox) ?? -1;
    const inLevel = childOfGroup(state.vox, parents, transformId, state.level ?? root);
    if (inLevel !== null || state.level === null) return inLevel;
    editor.setLevel(null);
    return childOfGroup(state.vox, parents, transformId, root);
  };

  const merge = (previous: number[], picked: number[], mode: SelectionMode) => {
    if (mode === 'replace') return picked;
    if (mode === 'remove') return previous.filter((id) => !picked.includes(id));
    return [...previous.filter((id) => !picked.includes(id)), ...picked];
  };

  const beginDrag = (clientX: number, clientY: number, upright: boolean) => {
    const height = editor.selectedInstance()?.pose.translation ?? null;
    const origin = height && (upright ? viewport.uprightPoint(clientX, clientY, height) : viewport.planePoint(clientX, clientY, height[2]));
    const handle = origin && commands.dragSelected();
    drag = origin && handle ? { handle, origin, upright, last: '' } : null;
  };

  return {
    begin(clientX: number, clientY: number, modifiers: PointerModifiers) {
      const hit = viewport.pick(clientX, clientY);
      const node = hit && levelNode(hit.transformId);
      const mode = selectionMode(modifiers);
      if (state.objectTool === 'msel' || node === null || modifiers.altKey) {
        marquee = { rect: { x0: clientX, y0: clientY, x1: clientX, y1: clientY }, mode, previous: state.selection };
        return viewport.showMarquee(marquee.rect);
      }
      if (modifiers.shiftKey && !modifiers.ctrlKey) {
        return editor.setSelection(state.selection.includes(node) ? state.selection.filter((id) => id !== node) : [...state.selection, node]);
      }
      if (!state.selection.includes(node)) editor.setSelection([node]);
      else editor.setSelection([...state.selection.filter((id) => id !== node), node]);
      if (modifiers.ctrlKey && modifiers.shiftKey) commands.duplicateSelected(true);
      beginDrag(clientX, clientY, modifiers.ctrlKey && !modifiers.shiftKey);
    },

    move(clientX: number, clientY: number) {
      if (marquee) {
        marquee.rect = { ...marquee.rect, x1: clientX, y1: clientY };
        return viewport.showMarquee(marquee.rect);
      }
      if (!drag) return;
      const point = drag.upright ? viewport.uprightPoint(clientX, clientY, drag.origin) : viewport.planePoint(clientX, clientY, drag.origin[2]);
      if (!point) return;
      const delta: Vec3 = drag.upright ? [0, 0, Math.round(point[2] - drag.origin[2])] : [Math.round(point[0] - drag.origin[0]), Math.round(point[1] - drag.origin[1]), 0];
      const key = delta.join(',');
      if (key === drag.last) return;
      drag.last = key;
      drag.handle.preview(delta);
    },

    end() {
      drag?.handle.commit();
      drag = null;
      const finished = marquee;
      marquee = null;
      if (!finished) return;
      viewport.showMarquee(null);
      const { x0, y0, x1, y1 } = finished.rect;
      if (Math.abs(x1 - x0) < CLICK_SLOP && Math.abs(y1 - y0) < CLICK_SLOP) {
        if (finished.mode === 'replace') editor.setSelection([]);
        return;
      }
      const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
      const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
      const inside = viewport
        .objectCenters()
        .filter(({ point: [x, y] }) => x >= left && x <= right && y >= top && y <= bottom)
        .map(({ transformId }) => levelNode(transformId))
        .filter((id): id is number => id !== null);
      editor.setSelection(merge(finished.previous, [...new Set(inside)], finished.mode));
    },
  };
}
