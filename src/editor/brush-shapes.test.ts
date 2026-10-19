import { describe, expect, it } from 'vitest';
import { alongAxes, cellsBetween, lineCells, stampCells, stampOutward, withMirrors } from './brush-shapes.ts';

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
