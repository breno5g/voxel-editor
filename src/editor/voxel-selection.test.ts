import { describe, expect, it } from 'vitest';
import { createModel, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { flip } from './model-ops.ts';
import { countSelected, invertSelection, mergeMask, selectAll, selectCells, selectColor, selectedVoxels, selectionBounds, selectionMode, transformSelection } from './voxel-selection.ts';

const modelWith = (size: Vec3, cells: [Vec3, number][]): VoxModel => {
  const model = createModel(size);
  cells.forEach(([[x, y, z], color]) => (model.voxels[voxelIndex(size, x, y, z)] = color));
  return model;
};

const row = () => modelWith([4, 1, 1], [[[0, 0, 0], 1], [[1, 0, 0], 2], [[3, 0, 0], 1]]);

describe('selection modes', () => {
  it('reads Shift and Shift+Alt like MagicaVoxel', () => {
    expect(selectionMode({ shiftKey: false, altKey: false })).toBe('replace');
    expect(selectionMode({ shiftKey: true, altKey: false })).toBe('add');
    expect(selectionMode({ shiftKey: true, altKey: true })).toBe('remove');
  });

  it('only selects filled cells, adding and removing', () => {
    const model = row();
    const first = selectCells(model, null, [[0, 0, 0], [2, 0, 0]], 'replace');
    expect([...first]).toEqual([1, 0, 0, 0]);
    const added = selectCells(model, first, [[3, 0, 0]], 'add');
    expect([...added]).toEqual([1, 0, 0, 1]);
    expect([...selectCells(model, added, [[0, 0, 0]], 'remove')]).toEqual([0, 0, 0, 1]);
    expect([...mergeMask(model, added, new Uint8Array([0, 1, 1, 0]), 'add')]).toEqual([1, 1, 0, 1]);
  });

  it('selects all, inverts and selects by colour', () => {
    const model = row();
    expect([...selectAll(model)]).toEqual([1, 1, 0, 1]);
    expect([...invertSelection(model, new Uint8Array([1, 0, 0, 0]))]).toEqual([0, 1, 0, 1]);
    expect([...selectColor(model, 1)]).toEqual([1, 0, 0, 1]);
    expect(countSelected(selectColor(model, 1))).toBe(2);
  });
});

describe('selection contents', () => {
  it('extracts the selected voxels and their bounds', () => {
    const model = row();
    const mask = new Uint8Array([0, 1, 0, 1]);
    expect([...selectedVoxels(model, mask).voxels]).toEqual([0, 2, 0, 1]);
    expect(selectionBounds(model.size, mask)).toEqual([[1, 0, 0], [3, 0, 0]]);
    expect(selectionBounds(model.size, new Uint8Array(4))).toBeNull();
  });

  it('transforms only the selection inside its bounding box', () => {
    const model = row();
    const result = transformSelection(model, new Uint8Array([0, 1, 0, 1]), (part) => flip(part, 0));
    expect([...result.model.voxels]).toEqual([1, 1, 0, 2]);
    expect([...result.mask]).toEqual([0, 1, 0, 1]);
  });
});
