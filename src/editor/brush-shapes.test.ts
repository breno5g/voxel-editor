import { describe, expect, it } from 'vitest';
import { createModel, voxelIndex } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';
import { alongAxes, cellsBetween, centeredShape, colorRegion, faceRegion, lineCells, stampCells, stampOutward, withMirrors } from './brush-shapes.ts';

describe('stampCells', () => {
  it('is the centre cell at size 1', () => {
    expect(stampCells([4, 4, 4], 1, 'sphere', null)).toEqual([[4, 4, 4]]);
  });

  it('fills a cube or rounds off its corners as a ball', () => {
    expect(stampCells([4, 4, 4], 3, 'cube', null)).toHaveLength(27);
    const ball = stampCells([4, 4, 4], 3, 'sphere', null);
    expect(ball).toHaveLength(19);
    expect(ball).not.toContainEqual([3, 3, 3]);
  });

  it('grows even sizes toward +axis', () => {
    expect(stampCells([4, 4, 4], 2, 'cube', null)).toContainEqual([5, 5, 5]);
    expect(stampCells([4, 4, 4], 2, 'cube', null)).not.toContainEqual([3, 4, 4]);
  });

  it('keeps a 2D stamp on the layer of the centre', () => {
    const flat = stampCells([4, 4, 4], 3, 'cube', 2);
    expect(flat).toHaveLength(9);
    expect(flat.every((cell) => cell[2] === 4)).toBe(true);
  });
});

describe('faceRegion', () => {
  /** A 3x3 slab at z = 0 with one red voxel, plus a voxel stacked on a corner. */
  const slab = () => {
    const model = createModel([5, 5, 3]);
    const set = ([x, y, z]: Vec3, color: number) => (model.voxels[voxelIndex(model.size, x, y, z)] = color);
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) set([x, y, 0], 1);
    set([1, 1, 0], 2);
    set([2, 2, 1], 1);
    return model;
  };

  it('collects the exposed faces on the clicked plane, around what covers them', () => {
    const region = faceRegion(slab(), [0, 0, 0], [0, 0, 1], { byColor: false, neighbors: 4 });
    expect(region).toHaveLength(8);
    expect(region).not.toContainEqual([2, 2, 0]);
  });

  it('only crosses voxels of the starting colour when connecting by colour', () => {
    const region = faceRegion(slab(), [0, 0, 0], [0, 0, 1], { byColor: true, neighbors: 4 });
    expect(region).toHaveLength(7);
    expect(region).not.toContainEqual([1, 1, 0]);
  });

  it('is empty when the clicked face is covered', () => {
    expect(faceRegion(slab(), [2, 2, 0], [0, 0, 1], { byColor: false, neighbors: 4 })).toEqual([]);
  });
});

describe('colorRegion', () => {
  /** Two red runs (one touching blue, one apart) and a diagonal red voxel. */
  const scene = () => {
    const model = createModel([6, 3, 3]);
    const set = ([x, y, z]: Vec3, color: number) => (model.voxels[voxelIndex(model.size, x, y, z)] = color);
    const reds: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [4, 0, 0],
    ];
    reds.forEach((cell) => set(cell, 1));
    set([2, 0, 0], 2);
    set([2, 1, 1], 1);
    return model;
  };

  it('takes every voxel of the colour when not connected', () => {
    expect(colorRegion(scene(), [0, 0, 0], { connected: false, byColor: true, neighbors: 6 })).toHaveLength(4);
  });

  it('follows face neighbours of the same colour', () => {
    expect(colorRegion(scene(), [0, 0, 0], { connected: true, byColor: true, neighbors: 6 })).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
  });

  it('crosses other colours by geometry and reaches diagonals with 26 neighbours', () => {
    expect(colorRegion(scene(), [0, 0, 0], { connected: true, byColor: false, neighbors: 6 })).toHaveLength(3);
    expect(colorRegion(scene(), [0, 0, 0], { connected: true, byColor: false, neighbors: 26 })).toHaveLength(4);
  });
});

describe('centeredShape', () => {
  it('draws a filled square or its outline on the face plane', () => {
    const filled = centeredShape('square', [5, 5, 2], [7, 4, 2], 2, { fill: true, even: false });
    expect(filled).toHaveLength(25);
    expect(filled.every((cell) => cell[2] === 2)).toBe(true);
    expect(centeredShape('square', [5, 5, 2], [7, 4, 2], 2, { fill: false, even: false })).toHaveLength(16);
  });

  it('makes even-width squares when centred on a corner', () => {
    const square = centeredShape('square', [5, 5, 0], [6, 5, 0], 2, { fill: true, even: true });
    expect(square).toHaveLength(4);
    expect(square).toContainEqual([6, 6, 0]);
  });

  it('draws a circle reaching the edge cell, rounder than the square', () => {
    const circle = centeredShape('circle', [5, 5, 0], [8, 5, 0], 2, { fill: true, even: false });
    expect(circle).toContainEqual([8, 5, 0]);
    expect(circle).not.toContainEqual([8, 8, 0]);
    expect(circle.length).toBeLessThan(49);
  });
});

describe('stampOutward', () => {
  it('rests the stamp on the face it attaches to, on either side', () => {
    const above = stampCells(stampOutward([4, 4, 0], 5, 2, 1), 5, 'cube', null).map((cell) => cell[2]);
    expect([Math.min(...above), Math.max(...above)]).toEqual([0, 4]);
    const below = stampCells(stampOutward([4, 4, 9], 4, 2, -1), 4, 'cube', null).map((cell) => cell[2]);
    expect([Math.min(...below), Math.max(...below)]).toEqual([6, 9]);
  });
});

describe('lineCells', () => {
  it('steps one cell at a time along the longest axis', () => {
    expect(lineCells([0, 0, 0], [4, 2, 0])).toEqual([
      [0, 0, 0],
      [1, 1, 0],
      [2, 1, 0],
      [3, 2, 0],
      [4, 2, 0],
    ]);
    expect(lineCells([2, 2, 2], [2, 2, 2])).toEqual([[2, 2, 2]]);
  });
});

describe('alongAxes', () => {
  it('runs a cell through the whole model on each enabled axis', () => {
    expect([...alongAxes([[1, 2, 3]], [4, 5, 3], [false, false, true])]).toEqual([
      [1, 2, 0],
      [1, 2, 1],
      [1, 2, 2],
    ]);
    expect([...alongAxes([[1, 2, 3]], [4, 5, 3], [true, true, false])]).toHaveLength(20);
  });
});

describe('withMirrors', () => {
  it('reflects each cell across the model centre on every enabled axis', () => {
    expect([...withMirrors([[0, 1, 2]], [4, 4, 4], [true, false, true])]).toEqual([
      [0, 1, 2],
      [0, 1, 1],
      [3, 1, 2],
      [3, 1, 1],
    ]);
  });

  it('keeps cells untouched when no axis is mirrored', () => {
    expect([...withMirrors([[2, 0, 1]], [5, 5, 5], [false, false, false])]).toEqual([[2, 0, 1]]);
  });
});

describe('cellsBetween', () => {
  it('spans the box between two corners in any order', () => {
    expect([...cellsBetween([1, 0, 0], [0, 1, 0])]).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ]);
  });
});
