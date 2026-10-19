import { describe, expect, it } from 'vitest';
import { cellOf, createModel, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { tile, DEFAULT_NOISE, diagonal, dilate, double, erode, flip, flood, half, hull, loop, maze, mirror, neighborOffsets, noise, perlin, primitive, repeat, reverse, rotate, rotate90, scale, shear } from './model-ops.ts';

const modelWith = (size: Vec3, cells: [Vec3, number][]): VoxModel => {
  const model = createModel(size);
  cells.forEach(([[x, y, z], color]) => (model.voxels[voxelIndex(size, x, y, z)] = color));
  return model;
};

/** Filled cells as "x,y,z=color", sorted, for readable comparisons. */
const filled = (model: VoxModel) =>
  [...model.voxels].flatMap((color, index) => (color ? [`${cellOf(model.size, index).join(',')}=${color}`] : [])).sort();

const count = (model: VoxModel) => model.voxels.reduce((total, color) => total + (color ? 1 : 0), 0);

describe('reverse', () => {
  it('swaps filled and empty cells', () => {
    const result = reverse(modelWith([2, 1, 1], [[[0, 0, 0], 5]]), 9);
    expect(filled(result)).toEqual(['1,0,0=9']);
  });
});

describe('double and half', () => {
  it('doubles each voxel into a 2×2×2 block', () => {
    const result = double(modelWith([2, 1, 1], [[[1, 0, 0], 3]]));
    expect(result.size).toEqual([4, 2, 2]);
    expect(count(result)).toBe(8);
    expect(filled(result)).toContain('3,1,1=3');
  });

  it('halves by keeping the first filled voxel of each block, rounding odd sizes up', () => {
    const result = half(modelWith([3, 2, 2], [[[1, 1, 1], 4], [[0, 1, 0], 2], [[2, 0, 0], 7]]));
    expect(result.size).toEqual([2, 1, 1]);
    expect(filled(result)).toEqual(['0,0,0=2', '1,0,0=7']);
  });

  it('round-trips through double and half', () => {
    const model = modelWith([3, 2, 1], [[[0, 0, 0], 1], [[2, 1, 0], 2]]);
    expect(filled(half(double(model)))).toEqual(filled(model));
  });
});

describe('flip, loop and mirror', () => {
  const model = modelWith([4, 1, 1], [[[0, 0, 0], 1], [[1, 0, 0], 2]]);

  it('flips along an axis', () => {
    expect(filled(flip(model, 0))).toEqual(['2,0,0=2', '3,0,0=1']);
  });

  it('loops content around the volume', () => {
    expect(filled(loop(model, [-1, 0, 0]))).toEqual(['0,0,0=2', '3,0,0=1']);
  });

  it('mirrors the lower half onto the upper half', () => {
    expect(filled(mirror(model, 0))).toEqual(['0,0,0=1', '1,0,0=2', '2,0,0=2', '3,0,0=1']);
  });
});

describe('rotate90', () => {
  it('turns a quarter around the axis and swaps the cross sizes', () => {
    const result = rotate90(modelWith([3, 2, 1], [[[2, 0, 0], 1]]), 2);
    expect(result.size).toEqual([2, 3, 1]);
    expect(filled(result)).toEqual(['1,2,0=1']);
  });

  it('comes back after four turns', () => {
    const model = modelWith([3, 2, 4], [[[2, 0, 1], 1], [[0, 1, 3], 2]]);
    for (const axis of [0, 1, 2] as const) {
      const turned = rotate90(rotate90(rotate90(rotate90(model, axis), axis), axis), axis);
      expect(turned.size).toEqual(model.size);
      expect(filled(turned)).toEqual(filled(model));
    }
  });
});

describe('diagonal', () => {
  it('copies the transposed half across the diagonal of the cross axes', () => {
    const result = diagonal(modelWith([2, 2, 1], [[[1, 0, 0], 3]]), 2);
    expect(filled(result)).toEqual(['0,1,0=3', '1,0,0=3']);
  });
});

describe('scale, shear, rotate and repeat', () => {
  it('scales per axis with nearest sampling', () => {
    const result = scale(modelWith([2, 1, 1], [[[1, 0, 0], 1]]), [2, 1, 3]);
    expect(result.size).toEqual([4, 1, 3]);
    expect(count(result)).toBe(6);
  });

  it('shears layers by their depth', () => {
    const result = shear(modelWith([4, 1, 3], [[[0, 0, 0], 1], [[0, 0, 2], 2]]), 2, [1, 0]);
    expect(filled(result)).toEqual(['0,0,0=1', '2,0,2=2']);
  });

  it('rotates 90 degrees like a quarter turn of the same size', () => {
    const model = modelWith([3, 3, 1], [[[2, 0, 0], 1]]);
    const result = rotate(model, 2, 90);
    expect(result.size).toEqual([3, 3, 1]);
    expect(count(result)).toBe(1);
  });

  it('grows the volume to fit a 45 degree turn', () => {
    const result = rotate(modelWith([10, 10, 1], []), 2, 45);
    expect(result.size[0]).toBe(15);
  });

  it('tiles the model', () => {
    const result = repeat(modelWith([2, 1, 1], [[[0, 0, 0], 1]]), [3, 2, 1]);
    expect(result.size).toEqual([6, 2, 1]);
    expect(count(result)).toBe(6);
  });
});

describe('dilate and erode', () => {
  it('grows into all 26 neighbours in the given colour', () => {
    const result = dilate(modelWith([3, 3, 3], [[[1, 1, 1], 1]]), 5);
    expect(count(result)).toBe(27);
    expect(filled(result)).toContain('1,1,1=1');
  });

  it('limits the neighbourhood per axis', () => {
    expect(neighborOffsets(['both', 'none', 'none'])).toEqual([[-1, 0, 0], [1, 0, 0]]);
    expect(neighborOffsets(['positive', 'positive', 'none'])).toHaveLength(3);
    expect(count(dilate(modelWith([3, 3, 3], [[[1, 1, 1], 1]]), 5, ['none', 'none', 'positive']))).toBe(2);
  });

  it('removes voxels exposed to empty space', () => {
    const full = createModel([3, 3, 3]);
    full.voxels.fill(1);
    expect(filled(erode(full))).toEqual(['1,1,1=1']);
  });
});

describe('hull and flood', () => {
  const shell = () => {
    const model = createModel([3, 3, 3]);
    model.voxels.fill(1);
    model.voxels[voxelIndex(model.size, 1, 1, 1)] = 0;
    return model;
  };

  it('fills enclosed empty space only', () => {
    expect(count(flood(shell(), 4))).toBe(27);
    expect(count(flood(modelWith([3, 1, 1], [[[0, 0, 0], 1]]), 4))).toBe(1);
  });

  it('removes voxels hidden from the outside', () => {
    const solid = createModel([3, 3, 3]);
    solid.voxels.fill(1);
    expect(count(hull(solid))).toBe(26);
  });
});

describe('primitive', () => {
  it('inscribes each shape in the volume', () => {
    const empty = createModel([8, 8, 8]);
    const volumes = Object.fromEntries((['elli', 'cyli', 'pyra', 'cone'] as const).map((shape) => [shape, count(primitive(empty, shape, 1))]));
    expect(volumes.cyli).toBeGreaterThan(volumes.elli);
    expect(volumes.elli).toBeGreaterThan(volumes.cone);
    expect(volumes.cyli).toBeLessThan(512);
  });
});

describe('noise', () => {
  it('is zero on lattice points and continuous', () => {
    expect(perlin(3, 4, 5)).toBe(0);
    expect(Math.abs(perlin(1.5, 2.5, 3.5) - perlin(1.501, 2.5, 3.5))).toBeLessThan(0.01);
  });

  it('fills the band of the sine of the noise, deterministically per seed', () => {
    const empty = createModel([32, 32, 8]);
    const first = noise(empty, 3, { seed: 7, ...DEFAULT_NOISE });
    expect(count(first)).toBeGreaterThan(0);
    expect(count(first)).toBeLessThan(32 * 32 * 8);
    expect(filled(noise(empty, 3, { seed: 7, ...DEFAULT_NOISE }))).toEqual(filled(first));
  });
});

describe('maze', () => {
  /** Deterministic stand-in for Math.random. */
  const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  it('connects every lattice node with one-voxel corridors', () => {
    const result = maze(createModel([13, 13, 1]), 2, 1, seeded(42));
    for (let y = 0; y < 13; y += 3) for (let x = 0; x < 13; x += 3) expect(result.voxels[voxelIndex(result.size, x, y, 0)]).toBe(2);
    // A spanning tree of 25 nodes has 24 corridors of 3 voxels each, plus the start node.
    expect(count(result)).toBe(24 * 3 + 1);
  });
});

describe('tile', () => {
  it('repeats along an axis with spacing and phase', () => {
    const model = modelWith([2, 1, 1], [[[0, 0, 0], 1], [[1, 0, 0], 2]]);
    expect(filled(tile(model, 0, 7, 1))).toEqual(['0,0,0=1', '1,0,0=2', '3,0,0=1', '4,0,0=2', '6,0,0=1']);
    expect(filled(tile(model, 0, 4, 0, 1))).toEqual(['0,0,0=2', '1,0,0=1', '2,0,0=2', '3,0,0=1']);
  });
});
