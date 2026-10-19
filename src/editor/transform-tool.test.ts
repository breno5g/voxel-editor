import { describe, expect, it } from 'vitest';
import { createDocument } from '../format/defaults.ts';
import { voxelIndex } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';
import { createEditor } from './editor.ts';
import { createTransformTool } from './transform-tool.ts';
import { selectAll } from './voxel-selection.ts';

/** A viewport whose pointer always hits the +x face of cell (2, 1, 1), with +x pointing right on screen at 10 px per cell. */
const HIT_VOXEL: Vec3 = [2, 1, 1];
const HIT_NORMAL: Vec3 = [1, 0, 0];
const fakeViewport = {
  pick: () => ({ transformId: 0, hit: { voxel: HIT_VOXEL, normal: HIT_NORMAL, distance: 1 } }),
  project: (_transformId: number, point: Vec3): [number, number] => [point[0] * 10, 0],
};

function setup() {
  const editor = createEditor();
  const vox = createDocument([8, 3, 3]);
  const model = vox.models[0];
  for (const x of [1, 2]) model.voxels[voxelIndex(model.size, x, 1, 1)] = 4;
  editor.load(vox, 'test.vox');
  editor.setVoxelSelection({ model, mask: selectAll(model) });
  const tool = createTransformTool(editor, fakeViewport);
  const object = { transformId: editor.state.selected ?? 0, model };
  const drag = (pixels: number) => {
    tool.begin(object, 0, 0, { shiftKey: false });
    tool.move(pixels, 0);
    tool.end();
  };
  const filledX = () => [...model.voxels].flatMap((color, index) => (color ? [index % 8] : []));
  return { editor, tool, drag, filledX };
}

describe('transform tool', () => {
  it('scales the selection from the grabbed face, recomputing every drag from the original', () => {
    const { editor, tool, drag, filledX } = setup();
    editor.setTransformTool('scale');
    drag(20);
    expect(filledX()).toEqual([1, 2, 3, 4]);
    drag(20);
    expect(filledX()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tool.finish()).toBe(true);
    editor.history.undo();
    expect(filledX()).toEqual([1, 2, 3, 4]);
  });

  it('wraps copies along the grabbed axis', () => {
    const { editor, drag, filledX } = setup();
    editor.setTransformTool('wrap');
    editor.setWrapSpacing(0, 1);
    drag(40);
    expect(filledX()).toEqual([1, 2, 4, 5]);
  });

  it('reverts the whole session with cancel, as one undo step', () => {
    const { editor, tool, drag, filledX } = setup();
    editor.setTransformTool('scale');
    drag(20);
    drag(10);
    expect(tool.cancel()).toBe(true);
    expect(filledX()).toEqual([1, 2]);
    editor.history.undo();
    expect(filledX()).toEqual([1, 2, 3, 4, 5]);
    expect(tool.cancel()).toBe(false);
  });
});
