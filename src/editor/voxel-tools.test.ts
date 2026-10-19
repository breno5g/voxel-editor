import { describe, expect, it } from 'vitest';
import { withMirrors } from './voxel-tools.ts';

describe('brush mirror', () => {
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
