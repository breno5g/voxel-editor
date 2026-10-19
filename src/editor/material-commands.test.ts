import { describe, expect, it } from 'vitest';
import { createDocument } from '../format/defaults.ts';
import { parseVox } from '../format/vox-reader.ts';
import { writeVox } from '../format/vox-writer.ts';
import { createEditor } from './editor.ts';
import { createMaterialCommands, materialParam, materialType } from './material-commands.ts';

function setup() {
  const editor = createEditor();
  editor.load(createDocument([2, 2, 2]), 'test.vox');
  editor.setColor(9);
  return { editor, materials: createMaterialCommands(editor) };
}

describe('materials', () => {
  it('sets type and parameters with MagicaVoxel keys, and saves them as MATL', () => {
    const { editor, materials } = setup();
    materials.setMaterialType('_glass');
    materials.setMaterialParam('_trans', 0.75);
    materials.setMaterialParam('_ri', 9);
    const attrs = editor.state.vox.materials.get(9);
    expect(materialType(attrs)).toBe('_glass');
    expect(attrs?.get('_trans')).toBe('0.75');
    expect(materialParam(attrs, '_ri')).toBe(3);
    expect(parseVox(writeVox(editor.state.vox)).materials.get(9)).toEqual(attrs);
  });

  it('copies, pastes onto the palette selection and resets, undoably', () => {
    const { editor, materials } = setup();
    materials.setMaterialType('_emit');
    materials.copyMaterial();
    editor.setPaletteSelection([20, 21]);
    materials.pasteMaterial();
    expect(materialType(editor.state.vox.materials.get(21))).toBe('_emit');
    materials.resetMaterial();
    expect(editor.state.vox.materials.has(20)).toBe(false);
    editor.history.undo();
    expect(materialType(editor.state.vox.materials.get(20))).toBe('_emit');
  });
});
