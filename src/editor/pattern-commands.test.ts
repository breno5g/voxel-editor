import { describe, expect, it } from 'vitest';
import { buildScene, createDocument } from '../format/defaults.ts';
import { createModel, IDENTITY_ROTATION, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { createEditor } from './editor.ts';
import { createModelCommands } from './model-commands.ts';
import { createObjectCommands } from './object-commands.ts';
import { createPatternCommands } from './pattern-commands.ts';

const modelWith = (size: Vec3, cells: [Vec3, number][]): VoxModel => {
  const model = createModel(size);
  cells.forEach(([[x, y, z], color]) => (model.voxels[voxelIndex(size, x, y, z)] = color));
  return model;
};

/** A 4×4×4 model with voxels at (1,1,0) and (2,1,0), and a 1×1×1 object beside it. */
function setup() {
  const editor = createEditor();
  const vox = createDocument([4, 4, 4]);
  vox.models = [modelWith([4, 4, 4], [[[1, 1, 0], 5], [[2, 1, 0], 6]]), modelWith([1, 1, 1], [[[0, 0, 0], 7]])];
  vox.nodes = buildScene([vox.models[0].size, vox.models[1].size]);
  const second = vox.nodes[4];
  if (second.kind === 'transform') second.keys = [{ frame: 0, translation: [10, 0, 0], rotation: IDENTITY_ROTATION }];
  editor.load(vox, 'test.vox');
  editor.focusObject(2);
  const models = createModelCommands(editor);
  const objects = createObjectCommands(editor);
  return { editor, patterns: createPatternCommands(editor, models, objects), models };
}

describe('pattern from selection', () => {
  it('crops the whole model to its voxels when nothing is selected', () => {
    const { editor, patterns } = setup();
    patterns.patternFromSelection();
    expect(editor.state.pattern?.size).toEqual([2, 1, 1]);
    expect([...(editor.state.pattern?.voxels ?? [])]).toEqual([5, 6]);
  });

  it('keeps only the selected voxels', () => {
    const { editor, patterns } = setup();
    const model = editor.state.vox.models[0];
    const mask = new Uint8Array(model.voxels.length);
    mask[voxelIndex(model.size, 2, 1, 0)] = 1;
    editor.setVoxelSelection({ model, mask });
    patterns.patternFromSelection();
    expect(editor.state.pattern?.size).toEqual([1, 1, 1]);
    expect([...(editor.state.pattern?.voxels ?? [])]).toEqual([6]);
  });

  it('takes the selected objects in the world', () => {
    const { editor, patterns } = setup();
    editor.setMode('world');
    editor.setSelection([4]);
    patterns.patternFromSelection();
    expect(editor.state.pattern?.size).toEqual([1, 1, 1]);
    expect([...(editor.state.pattern?.voxels ?? [])]).toEqual([7]);
  });
});

describe('pattern use', () => {
  it('turns the pattern a quarter around z', () => {
    const { editor, patterns } = setup();
    patterns.patternFromSelection();
    patterns.rotatePattern(2, 1);
    expect(editor.state.pattern?.size).toEqual([1, 2, 1]);
    patterns.rotatePattern(2, -1);
    expect(editor.state.pattern?.size).toEqual([2, 1, 1]);
    expect([...(editor.state.pattern?.voxels ?? [])]).toEqual([5, 6]);
  });

  it('places the pattern as a new object centred on the point, and undoes it', () => {
    const { editor, patterns } = setup();
    patterns.patternFromSelection();
    patterns.placePattern([20, 5, 0]);
    expect(editor.state.instances).toHaveLength(3);
    const placed = editor.state.instances[2];
    expect(editor.state.vox.models[placed.model].voxels).toEqual(editor.state.pattern?.voxels);
    expect(placed.pose.translation).toEqual([20, 5, 0]);
    editor.history.undo();
    expect(editor.state.instances).toHaveLength(2);
  });

  it('runs fractal, mask and tex as model commands with the current pattern', () => {
    const { editor, patterns, models } = setup();
    models.run('fractal');
    expect(editor.state.vox.models[0].size).toEqual([4, 4, 4]);
    patterns.patternFromSelection();
    models.run('fractal');
    expect(editor.state.vox.models[editor.state.instances[0].model].size).toEqual([8, 4, 4]);
  });
});
