import { describe, expect, it } from 'vitest';
import { createDocument } from '../format/defaults.ts';
import { createModel } from '../format/vox.ts';
import { createEditor } from './editor.ts';
import { createKeyCommands } from './key-commands.ts';
import { createObjectCommands } from './object-commands.ts';

/** Object 2 with position keys at 0, 10, 20 and model frames at 0 and 10. */
function setup() {
  const editor = createEditor();
  const vox = createDocument([2, 2, 2]);
  vox.models.push(createModel([2, 2, 2]));
  const [, , transform, shape] = vox.nodes;
  if (transform.kind !== 'transform' || shape.kind !== 'shape') throw new Error('unexpected default scene');
  transform.keys = [0, 10, 20].map((frame) => ({ frame, translation: [frame, 0, 1], rotation: 4 }));
  shape.keys = [{ frame: 0, model: 0 }, { frame: 10, model: 1 }];
  editor.load(vox, 'test.vox');
  return { editor, keys: createKeyCommands(editor), transform, shape };
}

const frames = (node: { keys: { frame: number }[] }) => node.keys.map((key) => key.frame);

describe('timeline keys', () => {
  it('selects keys by click, Shift and asel', () => {
    const { editor, keys } = setup();
    keys.clickKey('transform', 10, false);
    keys.clickKey('transform', 20, true);
    expect(editor.state.keySelection).toEqual({ transform: [10, 20], shape: [] });
    keys.selectKeys('inv');
    expect(editor.state.keySelection).toEqual({ transform: [0], shape: [0, 10] });
    keys.selectKeys('none');
    expect(keys.hasKeySelection()).toBe(false);
  });

  it('moves, copies, reverses and deletes the selected keys, undoably', () => {
    const { editor, keys, transform, shape } = setup();
    keys.clickKey('transform', 10, false);
    keys.moveSelectedKeys(3, false);
    expect(frames(transform)).toEqual([0, 13, 20]);
    expect(editor.state.keySelection.transform).toEqual([13]);
    keys.moveSelectedKeys(2, true);
    expect(frames(transform)).toEqual([0, 13, 15, 20]);
    keys.selectKeys('all');
    keys.reverseSelectedKeys();
    expect(shape.keys).toEqual([{ frame: 0, model: 1 }, { frame: 10, model: 0 }]);
    keys.deleteSelectedKeys();
    expect(frames(transform)).toEqual([0]);
    editor.history.undo();
    editor.history.undo();
    editor.history.undo();
    editor.history.undo();
    expect(frames(transform)).toEqual([0, 10, 20]);
  });

  it('animates only the selected object without global time', () => {
    const { editor } = setup();
    editor.setFrame(10);
    expect(editor.state.instances[0].pose.translation[0]).toBe(10);
    editor.setGlobalTime(false);
    expect(editor.state.instances[0].pose.translation[0]).toBe(10);
    editor.setSelection([]);
    expect(editor.state.instances[0].pose.translation[0]).toBe(0);
  });
});

describe('unrecorded edits', () => {
  it('keeps a move off the keys pending until F5, and drops it on a frame change', () => {
    const { editor, transform } = setup();
    const commands = createObjectCommands(editor);
    editor.setAutoKey(false);
    editor.setMode('world');
    editor.setFrame(5);
    commands.moveSelected([0, 3, 0]);
    expect(frames(transform)).toEqual([0, 5, 10, 20]);
    editor.setFrame(6);
    expect(frames(transform)).toEqual([0, 10, 20]);
    editor.history.undo();
    expect(frames(transform)).toEqual([0, 5, 10, 20]);
    editor.setFrame(5);
    commands.moveSelected([0, 1, 0]);
    commands.addKey();
    editor.setFrame(7);
    expect(frames(transform)).toEqual([0, 5, 10, 20]);
  });
});
