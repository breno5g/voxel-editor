import { describe, expect, it } from 'vitest';
import { createDefaultPalette } from './defaults.ts';
import { decodeQb, decodeSlab, decodeXraw, encodeQb, encodeSlab, encodeXraw } from './grid-formats.ts';
import { createModel, paletteColor, voxelIndex } from './vox.ts';
import type { VoxDocument } from './vox.ts';

/** A 3×2×4 model with three coloured voxels on different axes. */
function sample() {
  const model = createModel([3, 2, 4]);
  model.voxels[voxelIndex(model.size, 0, 0, 0)] = 17;
  model.voxels[voxelIndex(model.size, 2, 1, 0)] = 1;
  model.voxels[voxelIndex(model.size, 1, 0, 3)] = 216;
  return model;
}

/** Filled cells with their RGB, so palettes rebuilt on import still compare equal. */
const coloured = (document: VoxDocument) => {
  const [model] = document.models;
  return [...model.voxels].flatMap((color, index) => (color ? [[index, paletteColor(document.palette, color).join(',')]] : []));
};

describe('grid formats', () => {
  const palette = createDefaultPalette();
  const expected = coloured({ ...decodeXraw(encodeXraw(sample(), palette)) });

  it('round-trips XRAW', () => {
    const document = decodeXraw(encodeXraw(sample(), palette));
    expect(document.models[0].size).toEqual([3, 2, 4]);
    expect(coloured(document)).toEqual(expected);
    expect(expected).toHaveLength(3);
  });

  it('round-trips Slab6 .vox (6-bit palette)', () => {
    const document = decodeSlab(encodeSlab(sample(), palette));
    expect(document.models[0].size).toEqual([3, 2, 4]);
    expect([...document.models[0].voxels]).toEqual([...sample().voxels]);
  });

  it('round-trips Qubicle .qb with matrix positions', () => {
    const document = decodeQb(encodeQb([{ name: 'a', model: sample(), position: [5, -2, 1] }], palette));
    expect(document.models[0].size).toEqual([3, 2, 4]);
    expect(coloured(document)).toEqual(expected);
    const transform = document.nodes[2];
    expect(transform.kind === 'transform' && transform.keys[0].translation).toEqual([5 + 1, -2 + 1, 1 + 2]);
  });
});
