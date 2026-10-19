import { describe, expect, it } from 'vitest';
import { createDocument } from '../format/defaults.ts';
import { voxelIndex } from '../format/vox.ts';
import { createEditor } from './editor.ts';
import { createModelCommands } from './model-commands.ts';

function setup() {
  const editor = createEditor();
  const vox = createDocument([3, 2, 2]);
  vox.models[0].voxels[voxelIndex([3, 2, 2], 0, 0, 0)] = 9;
  editor.load(vox, 'test.vox');
  editor.setColor(5);
  return { editor, models: createModelCommands(editor), voxels: () => [...editor.state.vox.models[0].voxels] };
}

describe('model commands', () => {
  it('fills the whole volume with the current colour and undoes it', () => {
    const { editor, models, voxels } = setup();
    models.full();
    expect(voxels().every((color) => color === 5)).toBe(true);
    editor.history.undo();
    expect(voxels().filter((color) => color !== 0)).toEqual([9]);
    editor.history.redo();
    expect(voxels().every((color) => color === 5)).toBe(true);
  });

  it('repaints only existing voxels', () => {
    const { models, voxels } = setup();
    models.fill();
    expect(voxels().filter((color) => color !== 0)).toEqual([5]);
  });

  it('clears every voxel', () => {
    const { models, voxels } = setup();
    models.zero();
    expect(voxels().every((color) => color === 0)).toBe(true);
  });
});
