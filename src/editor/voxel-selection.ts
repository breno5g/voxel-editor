import { cellOf, createModel, EMPTY_VOXEL, isInside, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';

/** Selected voxels of one model: `mask[i]` is 1 for a selected, filled cell (MagicaVoxel's `tex_s` layer). */
export type VoxelSelection = { model: VoxModel; mask: Uint8Array };

/** Shift adds to the selection, Shift+Alt removes from it, otherwise it is replaced. */
export type SelectionMode = 'replace' | 'add' | 'remove';
export const selectionMode = ({ shiftKey, altKey }: { shiftKey: boolean; altKey: boolean }): SelectionMode =>
  shiftKey ? (altKey ? 'remove' : 'add') : 'replace';

const isFilled = (model: VoxModel, index: number) => model.voxels[index] !== EMPTY_VOXEL;

/** Merges the filled cells among `cells` into `previous` (or an empty mask). */
export function selectCells(model: VoxModel, previous: Uint8Array | null, cells: Iterable<Vec3>, mode: SelectionMode): Uint8Array {
  const mask = mode === 'replace' || !previous ? new Uint8Array(model.voxels.length) : previous.slice();
  const value = mode === 'remove' ? 0 : 1;
  for (const cell of cells) {
    if (!isInside(model.size, cell)) continue;
    const index = voxelIndex(model.size, cell[0], cell[1], cell[2]);
    if (isFilled(model, index)) mask[index] = value;
  }
  return mask;
}

/** Merges a whole mask, e.g. one computed from a screen rectangle. */
export function mergeMask(model: VoxModel, previous: Uint8Array | null, picked: Uint8Array, mode: SelectionMode): Uint8Array {
  const mask = mode === 'replace' || !previous ? new Uint8Array(model.voxels.length) : previous.slice();
  picked.forEach((chosen, index) => {
    if (chosen && isFilled(model, index)) mask[index] = mode === 'remove' ? 0 : 1;
  });
  return mask;
}

/** `sel_all`: every filled voxel. */
export const selectAll = (model: VoxModel) => model.voxels.map((color) => (color === EMPTY_VOXEL ? 0 : 1));

/** `sel_inv`: the filled voxels outside the selection. */
export const invertSelection = (model: VoxModel, mask: Uint8Array | null) =>
  model.voxels.map((color, index) => (color !== EMPTY_VOXEL && !mask?.[index] ? 1 : 0));

/** `sel_col`: every voxel of one palette colour. */
export const selectColor = (model: VoxModel, color: number) => model.voxels.map((current) => (current === color ? 1 : 0));

export const countSelected = (mask: Uint8Array) => mask.reduce((total, selected) => total + selected, 0);

/** The selected voxels alone, on a model of the same size (for highlighting and the clipboard). */
export function selectedVoxels(model: VoxModel, mask: Uint8Array | null): VoxModel {
  const result = createModel(model.size);
  model.voxels.forEach((color, index) => {
    if (!mask || mask[index]) result.voxels[index] = color;
  });
  return result;
}

/** Inclusive bounds of the selected cells, or null when nothing is selected. */
export function selectionBounds(size: Vec3, mask: Uint8Array): [Vec3, Vec3] | null {
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  mask.forEach((selected, index) => {
    if (!selected) return;
    const cell = cellOf(size, index);
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], cell[axis]);
      high[axis] = Math.max(high[axis], cell[axis]);
    }
  });
  return low[0] === Infinity ? null : [low, high];
}

/** Where a transformed selection sits on an axis: kept at the box's low side, centred, or kept at its high side. */
export type Anchor = 'low' | 'center' | 'high';
const CENTERED: Anchor[] = ['center', 'center', 'center'];

/**
 * Runs a whole-model operation on the selection only: its bounding box is cut out (selected voxels
 * alone), transformed, and written back on the same box (centred unless `anchors` says otherwise),
 * replacing the selected voxels. The result's filled cells become the new selection. MagicaVoxel's
 * `map()` passes do the same through their `src_bound` / `dst_bound` uniforms.
 */
export function transformSelection(model: VoxModel, mask: Uint8Array, operation: (part: VoxModel) => VoxModel, anchors: readonly Anchor[] = CENTERED): VoxelSelection {
  const bounds = selectionBounds(model.size, mask);
  if (!bounds) return { model, mask };
  const [low, high] = bounds;
  const part = createModel([high[0] - low[0] + 1, high[1] - low[1] + 1, high[2] - low[2] + 1]);
  for (let z = low[2]; z <= high[2]; z++) {
    for (let y = low[1]; y <= high[1]; y++) {
      for (let x = low[0]; x <= high[0]; x++) {
        const index = voxelIndex(model.size, x, y, z);
        if (mask[index]) part.voxels[voxelIndex(part.size, x - low[0], y - low[1], z - low[2])] = model.voxels[index];
      }
    }
  }
  const transformed = operation(part);
  const result = createModel(model.size);
  model.voxels.forEach((color, index) => (result.voxels[index] = mask[index] ? EMPTY_VOXEL : color));
  const nextMask = new Uint8Array(model.voxels.length);
  const origin = [0, 1, 2].map((axis) => {
    if (anchors[axis] === 'low') return low[axis];
    if (anchors[axis] === 'high') return high[axis] + 1 - transformed.size[axis];
    return Math.floor((low[axis] + high[axis] + 1) / 2 - transformed.size[axis] / 2);
  });
  transformed.voxels.forEach((color, partIndex) => {
    if (color === EMPTY_VOXEL) return;
    const [x, y, z] = cellOf(transformed.size, partIndex);
    const cell: Vec3 = [x + origin[0], y + origin[1], z + origin[2]];
    if (!isInside(model.size, cell)) return;
    const index = voxelIndex(model.size, cell[0], cell[1], cell[2]);
    result.voxels[index] = color;
    nextMask[index] = 1;
  });
  return { model: result, mask: nextMask };
}
