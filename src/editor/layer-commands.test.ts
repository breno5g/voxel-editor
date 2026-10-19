import { describe, expect, it } from 'vitest';
import { buildScene, createDocument } from '../format/defaults.ts';
import { createModel } from '../format/vox.ts';
import { createEditor } from './editor.ts';
import { isLayerHidden, layerColor, layerName } from './layer-commands.ts';
import { createObjectCommands } from './object-commands.ts';

function setup() {
  const editor = createEditor();
  const vox = createDocument([2, 2, 2]);
  vox.models.push(createModel([2, 2, 2]));
  vox.nodes = buildScene([vox.models[0].size, vox.models[1].size]);
  editor.load(vox, 'test.vox');
  return { editor, commands: createObjectCommands(editor) };
}

const layerOf = (editor: ReturnType<typeof createEditor>, id: number) => {
  const node = editor.state.vox.nodes[id];
  return node.kind === 'transform' ? node.layer : null;
};

describe('layers', () => {
  it('moves the selection onto the clicked layer and hides it with the layer', () => {
    const { editor, commands } = setup();
    editor.setSelection([4]);
    commands.useLayer(3);
    expect(editor.state.layer).toBe(3);
    expect(layerOf(editor, 4)).toBe(3);
    commands.toggleLayerVisible(3);
    expect(isLayerHidden(editor.state.vox, 3)).toBe(true);
    expect(editor.state.instances.map((instance) => instance.transformId)).toEqual([2]);
    editor.history.undo();
    editor.history.undo();
    expect(layerOf(editor, 4)).toBe(0);
  });

  it('names, colours, selects and sorts layers', () => {
    const { editor, commands } = setup();
    editor.setSelection([2]);
    commands.useLayer(1);
    commands.renameLayer(1, 'Árvores');
    commands.setLayerColor(1, '#ff8000');
    expect(layerName(editor.state.vox, 1)).toBe('Árvores');
    expect(layerColor(editor.state.vox, 1)).toBe('#ff8000');
    editor.setSelection([]);
    commands.selectLayer(1);
    expect(editor.state.selection).toEqual([2]);
    commands.sortLayers();
    expect(layerName(editor.state.vox, 0)).toBe('Árvores');
    expect(layerOf(editor, 2)).toBe(0);
    expect(layerOf(editor, 4)).toBe(1);
  });

  it('puts new objects on the current layer', () => {
    const { editor, commands } = setup();
    editor.setSelection([]);
    commands.useLayer(5);
    commands.addObject();
    expect(layerOf(editor, editor.state.selected ?? -1)).toBe(5);
  });
});
