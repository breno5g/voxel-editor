import { describe, expect, it } from 'vitest';
import { buildScene, createDocument } from '../format/defaults.ts';
import { createModel, IDENTITY_ROTATION } from '../format/vox.ts';
import { parseMove } from '../ui/world-panel.ts';
import { createEditor } from './editor.ts';
import { createObjectCommands } from './object-commands.ts';

/** Two objects: transform 2 (model 0) at the origin and transform 4 (model 1) at x = 10, the first selected. */
function setup() {
  const editor = createEditor();
  const vox = createDocument([2, 2, 2]);
  vox.models.push(createModel([2, 2, 2]));
  vox.nodes = buildScene([vox.models[0].size, vox.models[1].size]);
  const second = vox.nodes[4];
  if (second.kind === 'transform') second.keys = [{ frame: 0, translation: [10, 0, 1], rotation: IDENTITY_ROTATION }];
  editor.load(vox, 'test.vox');
  editor.setSelection([2]);
  return { editor, commands: createObjectCommands(editor) };
}

const shapeModels = (editor: ReturnType<typeof createEditor>) => editor.state.instances.map((instance) => instance.model);

describe('object clipboard', () => {
  it('pastes own copies in place and selects them', () => {
    const { editor, commands } = setup();
    commands.copy('copy');
    commands.paste();
    expect(editor.state.instances).toHaveLength(3);
    expect(shapeModels(editor)).toEqual([0, 1, 2]);
    expect(editor.state.instances[2].pose.translation).toEqual(editor.state.instances[0].pose.translation);
    expect(editor.state.selection).toEqual([editor.state.instances[2].transformId]);
    editor.history.undo();
    expect(editor.state.instances).toHaveLength(2);
    expect(editor.state.vox.models).toHaveLength(2);
  });

  it('shares the voxels when copying as reference, until converted', () => {
    const { editor, commands } = setup();
    commands.copy('ref');
    commands.paste();
    expect(shapeModels(editor)).toEqual([0, 1, 0]);
    commands.referencesToObjects(false);
    expect(shapeModels(editor)).toEqual([0, 1, 2]);
  });

  it('moves objects with cut and paste', () => {
    const { editor, commands } = setup();
    commands.cut();
    expect(editor.state.instances).toHaveLength(1);
    commands.paste();
    expect(shapeModels(editor)).toEqual([1, 0]);
  });

  it('copies only the current frame', () => {
    const { editor, commands } = setup();
    const shape = editor.state.vox.nodes[3];
    if (shape.kind === 'shape') shape.keys = [{ frame: 0, model: 0 }, { frame: 5, model: 1 }];
    editor.setFrame(6);
    commands.copy('frame');
    commands.paste();
    const pasted = editor.state.vox.nodes[editor.state.vox.nodes.length - 1];
    expect(pasted.kind === 'shape' && pasted.keys).toEqual([{ frame: 0, model: 2 }]);
  });

  it('copies and pastes transforms in world space', () => {
    const { editor, commands } = setup();
    editor.setSelection([4]);
    commands.copyTransform();
    editor.setSelection([2]);
    commands.pasteTransform('t');
    expect(editor.state.instances[0].pose.translation).toEqual([10, 0, 1]);
  });
});

describe('omove text', () => {
  it('reads axis steps and ground', () => {
    expect(parseMove('x 4 z -2')).toEqual([4, 0, -2]);
    expect(parseMove('g')).toBe('ground');
    expect(parseMove('x')).toBeNull();
    expect(parseMove('w 2')).toBeNull();
  });
});
