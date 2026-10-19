import { describe, expect, it } from 'vitest';
import { createDocument } from '../format/defaults.ts';
import { applyRows } from '../format/rotation.ts';
import { modelPivot, voxelIndex } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';
import { parseVox } from '../format/vox-reader.ts';
import { writeVox } from '../format/vox-writer.ts';
import { listObjects } from '../scene/scene-graph.ts';
import { createEditor } from './editor.ts';
import { createObjectCommands } from './object-commands.ts';

const OBJECT = 2;

function setup() {
  const editor = createEditor();
  const vox = createDocument([4, 4, 3]);
  vox.models[0].voxels[voxelIndex([4, 4, 3], 3, 0, 2)] = 9;
  editor.load(vox, 'test.vox');
  return { editor, commands: createObjectCommands(editor) };
}

/** World-space centre of model cell `cell` for the first visible instance. */
function worldCenter(editor: ReturnType<typeof createEditor>, cell: Vec3): Vec3 {
  const [instance] = editor.state.instances;
  const pivot = modelPivot(editor.state.vox.models[instance.model].size);
  const local = applyRows(instance.pose.rows, [cell[0] + 0.5 - pivot[0], cell[1] + 0.5 - pivot[1], cell[2] + 0.5 - pivot[2]]);
  return [local[0] + instance.pose.translation[0], local[1] + instance.pose.translation[1], local[2] + instance.pose.translation[2]];
}

const transformKeys = (editor: ReturnType<typeof createEditor>) => {
  const node = editor.state.vox.nodes[OBJECT];
  return node.kind === 'transform' ? node.keys : [];
};

describe('object commands', () => {
  it('rotates a static object in place and undoes it', () => {
    const { editor, commands } = setup();
    commands.rotateSelected(2, 1);
    expect(transformKeys(editor)).toHaveLength(1);
    expect(transformKeys(editor)[0].rotation).toBe(17);
    editor.history.undo();
    expect(transformKeys(editor)[0].rotation).toBe(4);
  });

  it('keys a rotation at the current frame once the object is animated', () => {
    const { editor, commands } = setup();
    editor.setFrame(10);
    commands.addTransformKey();
    commands.rotateSelected(0, 1);
    // Quarter turn about X: rows [[1,0,0],[0,0,-1],[0,1,0]] -> column bits 0 | 2 << 2, row-1 sign 0x20 = 40.
    expect(transformKeys(editor).map((key) => [key.frame, key.rotation])).toEqual([[0, 4], [10, 40]]);
  });

  it('resizes every frame of the object without moving its voxels in the world', () => {
    const { editor, commands } = setup();
    commands.rotateSelected(2, 1);
    const before = worldCenter(editor, [3, 0, 2]);
    commands.resizeSelected([7, 5, 3]);
    expect(editor.state.vox.models[0].size).toEqual([7, 5, 3]);
    expect(worldCenter(editor, [3, 0, 2])).toEqual(before);
    editor.history.undo();
    expect(editor.state.vox.models[0].size).toEqual([4, 4, 3]);
  });

  it('grounds an object on z = 0 using the height of its rotated model box', () => {
    const { editor, commands } = setup();
    commands.moveSelected([0, 0, 5]);
    commands.groundSelected();
    expect(transformKeys(editor)[0].translation).toEqual([0, 0, 1]);
    commands.rotateSelected(0, 1);
    commands.groundSelected();
    // Quarter turn about X stands the model on its Y extent: 4 deep, pivot 2.
    expect(transformKeys(editor)[0].translation).toEqual([0, 0, 2]);
  });

  it('records a pointer drag as a single undo step', () => {
    const { editor, commands } = setup();
    const drag = commands.dragSelected();
    drag?.preview([1, 0, 0]);
    drag?.preview([3, -2, 0]);
    drag?.commit();
    expect(transformKeys(editor)[0].translation).toEqual([3, -2, 1]);
    editor.history.undo();
    expect(transformKeys(editor)[0].translation).toEqual([0, 0, 1]);
  });

  it('rejects sizes outside 1..256', () => {
    const { editor, commands } = setup();
    commands.resizeSelected([0, 4, 4]);
    commands.resizeSelected([300, 4, 4]);
    expect(editor.state.vox.models[0].size).toEqual([4, 4, 3]);
  });

  it('deletes an object so it is neither drawn nor saved, and undo restores it', () => {
    const { editor, commands } = setup();
    commands.addObject();
    commands.deleteSelected();
    expect(editor.state.instances).toHaveLength(1);
    expect(parseVox(writeVox(editor.state.vox)).models).toHaveLength(1);
    editor.history.undo();
    expect(editor.state.instances).toHaveLength(2);
  });

  it('duplicates an object with its own copy of the voxels', () => {
    const { editor, commands } = setup();
    commands.duplicateSelected();
    const [original, copy] = editor.state.instances;
    expect(copy.model).not.toBe(original.model);
    editor.state.vox.models[copy.model].voxels.fill(0);
    expect(editor.state.vox.models[original.model].voxels.some((color) => color !== 0)).toBe(true);
    editor.history.undo();
    expect(editor.state.instances).toHaveLength(1);
  });

  it('hides an object from the viewport but keeps it in the object list', () => {
    const { editor, commands } = setup();
    commands.toggleHidden(OBJECT);
    expect(editor.state.instances).toHaveLength(0);
    expect(listObjects(editor.state.vox)).toEqual([{ transformId: OBJECT, shapeId: 3, hidden: true }]);
  });

  it('gives each new model frame an independent copy of the model on screen', () => {
    const { editor, commands } = setup();
    editor.setFrame(5);
    commands.addModelFrame();
    const frameModel = editor.state.instances[0].model;
    editor.state.vox.models[frameModel].voxels.fill(0);
    editor.setFrame(0);
    expect(editor.state.vox.models[editor.state.instances[0].model].voxels.some((color) => color !== 0)).toBe(true);
  });
});

describe('editor-dependent keys', () => {
  const shapeKeys = (editor: ReturnType<typeof createEditor>) => {
    const node = editor.state.vox.nodes[OBJECT + 1];
    return node.kind === 'shape' ? node.keys : [];
  };

  it('adds a model frame in model mode and a transform key in world mode', () => {
    const { editor, commands } = setup();
    editor.setFrame(4);
    commands.addKey();
    expect(shapeKeys(editor).map((key) => key.frame)).toEqual([0, 4]);
    expect(transformKeys(editor).map((key) => key.frame)).toEqual([0]);
    editor.setMode('world');
    editor.setFrame(8);
    commands.addKey();
    expect(transformKeys(editor).map((key) => key.frame)).toEqual([0, 8]);
    commands.removeKey();
    expect(transformKeys(editor).map((key) => key.frame)).toEqual([0]);
  });

  it('steps through the keys of the current editor only', () => {
    const { editor, commands } = setup();
    editor.setFrame(4);
    commands.addModelFrame();
    editor.setFrame(9);
    commands.addTransformKey();
    editor.setFrame(0);
    commands.stepKey(1);
    expect(editor.state.frame).toBe(4);
    editor.setMode('world');
    editor.setFrame(0);
    commands.stepKey(1);
    expect(editor.state.frame).toBe(9);
  });

  it('leaves model mode when nothing is selected', () => {
    const { editor } = setup();
    expect(editor.state.mode).toBe('model');
    editor.select(null);
    expect(editor.state.mode).toBe('world');
    editor.setMode('model');
    expect(editor.state.mode).toBe('world');
  });
});
