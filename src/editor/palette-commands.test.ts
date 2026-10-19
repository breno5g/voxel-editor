import { describe, expect, it } from 'vitest';
import { createDocument } from '../format/defaults.ts';
import { paletteColor } from '../format/vox.ts';
import { createEditor } from './editor.ts';
import { createPaletteCommands } from './palette-commands.ts';

function setup() {
  const editor = createEditor();
  const vox = createDocument([2, 1, 1]);
  vox.models[0].voxels.set([1, 2]);
  editor.load(vox, 'test.vox');
  return { editor, palette: createPaletteCommands(editor), model: vox.models[0] };
}

describe('palette commands', () => {
  it('swaps two colours and remaps the voxels, undoably', () => {
    const { editor, palette, model } = setup();
    const [first, second] = [paletteColor(editor.state.vox.palette, 1), paletteColor(editor.state.vox.palette, 2)];
    palette.swapColors(1, 2);
    expect(paletteColor(editor.state.vox.palette, 1)).toEqual(second);
    expect([...model.voxels]).toEqual([2, 1]);
    editor.history.undo();
    expect(paletteColor(editor.state.vox.palette, 1)).toEqual(first);
    expect([...model.voxels]).toEqual([1, 2]);
  });

  it('adjusts every selected colour and flags the colours in use', () => {
    const { editor, palette } = setup();
    editor.setPaletteSelection([200, 201]);
    palette.setColor([10, 20, 30]);
    palette.adjustColors('r', 5);
    expect(paletteColor(editor.state.vox.palette, 201)).toEqual([15, 20, 30]);
    palette.flagUsedColors();
    expect(editor.state.paletteSelection).toEqual([1, 2]);
  });

  it('paints random selected colours on the edited model', () => {
    const { editor, palette, model } = setup();
    editor.setPaletteSelection([7, 9]);
    let turn = 0;
    palette.randomColors(() => (turn++ % 2) * 0.9);
    expect([...model.voxels]).toEqual([7, 9]);
    editor.history.undo();
    expect([...model.voxels]).toEqual([1, 2]);
  });
});
