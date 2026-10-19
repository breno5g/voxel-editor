import { describe, expect, it } from 'vitest';
import { buildScene, createDocument } from '../format/defaults.ts';
import { createModel } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';
import { instanceBounds } from '../scene/scene-tree.ts';
import { createEditor } from './editor.ts';
import { createWorldCommands } from './world-commands.ts';

/** Two 2×2×2 objects (transforms 2 and 4) standing at x = 0 and x = 10. */
function setup() {
  const editor = createEditor();
  const vox = createDocument([2, 2, 2]);
  vox.models.push(createModel([2, 2, 2]));
  vox.nodes = buildScene([vox.models[0].size, vox.models[1].size]);
  const second = vox.nodes[4];
  if (second.kind === 'transform') second.keys = [{ frame: 0, translation: [10, 0, 1], rotation: 4 }];
  editor.load(vox, 'test.vox');
  editor.setSelection([2, 4]);
  return { editor, commands: createWorldCommands(editor) };
}

const boxes = (editor: ReturnType<typeof createEditor>) => editor.state.instances.map((instance) => instanceBounds(instance, editor.state.vox.models));
const translations = (editor: ReturnType<typeof createEditor>): Vec3[] => editor.state.instances.map((instance) => instance.pose.translation);

describe('world selection', () => {
  it('selects all, none and the inverse at the current level', () => {
    const { editor, commands } = setup();
    commands.selectNone();
    expect(editor.state.selection).toEqual([]);
    commands.invertSelection();
    expect(editor.state.selection).toEqual([2, 4]);
    editor.setSelection([4]);
    commands.invertSelection();
    expect(editor.state.selection).toEqual([2]);
    expect(editor.state.selected).toBe(2);
  });
});

describe('world commands on several objects', () => {
  it('moves the whole selection as one undo step', () => {
    const { editor, commands } = setup();
    commands.moveSelected([1, 2, 0]);
    expect(translations(editor)).toEqual([[1, 2, 1], [11, 2, 1]]);
    editor.history.undo();
    expect(translations(editor)).toEqual([[0, 0, 1], [10, 0, 1]]);
  });

  it('turns several objects together about the centre of their box', () => {
    const { editor, commands } = setup();
    commands.rotateSelected(2, 1);
    // Box x 0..12 (centre 5), y 0..2: a quarter turn about z swaps the row onto the y axis.
    const [first, second] = boxes(editor);
    expect(first.low[0]).toBe(second.low[0]);
    expect(Math.abs(second.low[1] - first.low[1])).toBe(10);
  });

  it('aligns each box to the selection minimum', () => {
    const { editor, commands } = setup();
    commands.moveSelected([0, 0, 0]);
    editor.setSelection([4]);
    commands.moveSelected([0, 0, 5]);
    editor.setSelection([2, 4]);
    commands.alignSelected(2, -1);
    expect(boxes(editor).map((box) => box.low[2])).toEqual([0, 0]);
  });

  it('deletes and restores the selection', () => {
    const { editor, commands } = setup();
    commands.deleteSelected();
    expect(editor.state.instances).toHaveLength(0);
    expect(editor.state.selection).toEqual([]);
    editor.history.undo();
    expect(editor.state.instances).toHaveLength(2);
    expect(editor.state.selection).toEqual([2, 4]);
  });

  it('duplicates every selected object beside the selection and selects the copies', () => {
    const { editor, commands } = setup();
    commands.duplicateSelected();
    expect(editor.state.instances).toHaveLength(4);
    expect(editor.state.selection).toHaveLength(2);
    const copyModels = editor.state.instances.slice(2).map((instance) => instance.model);
    expect(new Set(copyModels).size).toBe(2);
    expect(copyModels.every((model) => model >= 2)).toBe(true);
    expect(translations(editor).slice(2)).toEqual([[13, 0, 1], [23, 0, 1]]);
  });

  it('hides and shows the selection', () => {
    const { editor, commands } = setup();
    commands.hideSelected();
    expect(editor.state.instances).toHaveLength(0);
    commands.hideSelected();
    expect(editor.state.instances).toHaveLength(2);
  });
});

describe('groups', () => {
  it('groups the selection in place and ungroups it back, keeping world poses', () => {
    const { editor, commands } = setup();
    const before = boxes(editor);
    commands.groupSelected();
    const [holder] = editor.state.selection;
    expect(editor.state.vox.nodes[holder]?.kind).toBe('transform');
    expect(boxes(editor)).toEqual(before);
    const moved = before.map((box) => box.low[1] + 3);
    commands.moveSelected([0, 3, 0]);
    expect(boxes(editor).map((box) => box.low[1])).toEqual(moved);
    commands.ungroupSelected();
    expect(editor.state.selection).toEqual([2, 4]);
    expect(boxes(editor).map((box) => box.low[1])).toEqual(moved);
    editor.history.undo();
    editor.history.undo();
    editor.history.undo();
    expect(boxes(editor)).toEqual(before);
    expect(editor.state.selection).toEqual([2, 4]);
  });

  it('enters a group with Tab and climbs out with Shift+Tab', () => {
    const { editor, commands } = setup();
    commands.groupSelected();
    const [holder] = editor.state.selection;
    commands.enterLevel();
    expect(editor.state.level).not.toBeNull();
    expect(editor.state.selection).toEqual([2]);
    commands.selectAll();
    expect(editor.state.selection).toEqual([2, 4]);
    commands.exitLevel();
    expect(editor.state.level).toBeNull();
    expect(editor.state.selection).toEqual([holder]);
  });

  it('brings the selection to the first or last render place', () => {
    const { editor, commands } = setup();
    editor.setSelection([4]);
    commands.orderSelected(2);
    expect(editor.state.instances.map((instance) => instance.transformId)).toEqual([4, 2]);
    commands.orderSelected(-2);
    expect(editor.state.instances.map((instance) => instance.transformId)).toEqual([2, 4]);
  });
});
