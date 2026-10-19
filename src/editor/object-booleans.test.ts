import { describe, expect, it } from 'vitest';
import { buildScene, createDocument } from '../format/defaults.ts';
import { createModel, IDENTITY_ROTATION, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { createEditor } from './editor.ts';
import { createObjectCommands } from './object-commands.ts';
import { modelFromCells, worldCells } from './object-booleans.ts';

const filledModel = (size: Vec3, color: number): VoxModel => {
  const model = createModel(size);
  model.voxels.fill(color);
  return model;
};

/** Two 2×2×2 solid cubes (colours 1 and 2) overlapping by one cell along x. */
function setup() {
  const editor = createEditor();
  const vox = createDocument([2, 2, 2]);
  vox.models = [filledModel([2, 2, 2], 1), filledModel([2, 2, 2], 2)];
  vox.nodes = buildScene([vox.models[0].size, vox.models[1].size]);
  const second = vox.nodes[4];
  if (second.kind === 'transform') second.keys = [{ frame: 0, translation: [1, 0, 1], rotation: IDENTITY_ROTATION }];
  editor.load(vox, 'test.vox');
  return { editor, commands: createObjectCommands(editor) };
}

const count = (model: VoxModel, color?: number) => model.voxels.filter((value) => (color === undefined ? value !== 0 : value === color)).length;
const modelOf = (editor: ReturnType<typeof createEditor>, index: number) => editor.state.vox.models[editor.state.instances[index].model];

describe('world cells', () => {
  it('rebuilds a model from the cells of an instance', () => {
    const { editor } = setup();
    const cells = worldCells(editor.state.instances[0], editor.state.vox.models);
    expect(cells.size).toBe(8);
    const built = modelFromCells(cells);
    expect(built?.model.size).toEqual([2, 2, 2]);
    expect(built?.low).toEqual([-1, -1, 0]);
  });
});

describe('object booleans', () => {
  it('unites the selection into one object', () => {
    const { editor, commands } = setup();
    editor.setSelection([2, 4]);
    commands.unionSelected();
    expect(editor.state.instances).toHaveLength(1);
    const merged = modelOf(editor, 0);
    expect(merged.size).toEqual([3, 2, 2]);
    expect(count(merged, 1)).toBe(4);
    expect(count(merged, 2)).toBe(8);
    editor.history.undo();
    expect(editor.state.instances).toHaveLength(2);
  });

  it('keeps only the shared voxels on intersection', () => {
    const { editor, commands } = setup();
    editor.setSelection([2, 4]);
    commands.intersectSelected();
    const shared = modelOf(editor, 0);
    expect(shared.size).toEqual([1, 2, 2]);
    expect(count(shared, 1)).toBe(4);
  });

  it('subtracts and replaces with the picked operands', () => {
    const { editor, commands } = setup();
    editor.setSelection([4]);
    commands.pickOperands();
    editor.setSelection([2]);
    commands.subtractSelected();
    expect(count(modelOf(editor, 0))).toBe(4);
    expect(modelOf(editor, 0).voxels[voxelIndex([2, 2, 2], 1, 0, 0)]).toBe(0);
    editor.history.undo();
    commands.replaceSelected();
    expect(count(modelOf(editor, 0), 2)).toBe(4);
    expect(count(modelOf(editor, 1))).toBe(8);
  });
});
