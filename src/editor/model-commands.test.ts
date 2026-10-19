import { describe, expect, it } from 'vitest';
import { createDocument } from '../format/defaults.ts';
import { voxelIndex } from '../format/vox.ts';
import { createEditor } from './editor.ts';
import { createModelCommands, parseAxisArgs, parseReach } from './model-commands.ts';

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

describe('model command lines', () => {
  it('runs MagicaVoxel commands with arguments and undoes size changes', () => {
    const { editor, models } = setup();
    models.run('x2');
    expect(editor.state.vox.models[0].size).toEqual([6, 4, 4]);
    models.run('rot90 z');
    expect(editor.state.vox.models[0].size).toEqual([4, 6, 4]);
    editor.history.undo();
    editor.history.undo();
    expect(editor.state.vox.models[0].size).toEqual([3, 2, 2]);
  });

  it('reports bad arguments without editing', () => {
    const { editor, models } = setup();
    const messages: string[] = [];
    editor.subscribe((event) => event.type === 'status' && messages.push(event.message));
    models.run('scale q 2');
    models.run('nope');
    expect(messages).toEqual(['scale: use eixos escala, ex.: xyz 2', 'Comando desconhecido: nope']);
    expect(editor.state.vox.models[0].size).toEqual([3, 2, 2]);
  });
});

describe('argument parsing', () => {
  it('reads axes and values', () => {
    expect(parseAxisArgs(['xyz', '2'])).toEqual({ axes: [0, 1, 2], values: [2] });
    expect(parseAxisArgs(['z', '0.2', '0.2'])).toEqual({ axes: [2], values: [0.2, 0.2] });
    expect(parseAxisArgs(['z'])).toBeNull();
    expect(parseAxisArgs(['w', '1'])).toBeNull();
  });

  it('reads the dilation and erosion reach', () => {
    expect(parseReach([])).toEqual(['both', 'both', 'both']);
    expect(parseReach(['x', '+z'])).toEqual(['both', 'none', 'positive']);
    expect(parseReach(['-y'])).toEqual(['none', 'negative', 'none']);
    expect(parseReach(['q'])).toBeNull();
  });
});

describe('selection-aware commands', () => {
  const twoVoxels = () => {
    const context = setup();
    const model = context.editor.state.vox.models[0];
    model.voxels[voxelIndex([3, 2, 2], 2, 1, 1)] = 7;
    return { ...context, model };
  };

  it('selects all, inverts and clears the selection', () => {
    const { editor, models, model } = twoVoxels();
    models.run('sel_all');
    expect(editor.selectionOf(model)?.reduce((total, value) => total + value, 0)).toBe(2);
    models.run('sel_col');
    expect([...(editor.selectionOf(model) ?? [])].filter(Boolean)).toHaveLength(0);
    editor.setColor(9);
    models.run('sel_col');
    models.run('sel_inv');
    const mask = editor.selectionOf(model);
    expect(mask?.[voxelIndex([3, 2, 2], 2, 1, 1)]).toBe(1);
    expect(mask?.[voxelIndex([3, 2, 2], 0, 0, 0)]).toBe(0);
    models.run('sel_none');
    expect(editor.state.voxelSelection).toBeNull();
  });

  it('limits fill and zero to the selection', () => {
    const { editor, models, voxels } = twoVoxels();
    editor.setColor(9);
    models.run('sel_col');
    editor.setColor(5);
    models.fill();
    expect(voxels().filter((color) => color !== 0).sort()).toEqual([5, 7]);
    models.zero();
    expect(voxels().filter((color) => color !== 0)).toEqual([7]);
  });

  it('copies the selection and pastes it back as the new selection', () => {
    const { editor, models, voxels } = twoVoxels();
    editor.setColor(7);
    models.run('sel_col');
    models.run('cut');
    expect(voxels().filter((color) => color !== 0)).toEqual([9]);
    models.run('paste');
    expect(voxels().filter((color) => color !== 0).sort()).toEqual([7, 9]);
    const model = editor.state.vox.models[0];
    expect(editor.selectionOf(model)?.[voxelIndex([3, 2, 2], 2, 1, 1)]).toBe(1);
  });

  it('transforms only the selected voxels and keeps them selected', () => {
    const { editor, models, voxels } = twoVoxels();
    editor.setColor(7);
    models.run('sel_col');
    models.run('x2');
    expect(editor.state.vox.models[0].size).toEqual([3, 2, 2]);
    expect(voxels().filter((color) => color === 7)).toHaveLength(8);
    expect(voxels().filter((color) => color === 9)).toHaveLength(1);
    editor.history.undo();
    expect(voxels().filter((color) => color === 7)).toHaveLength(1);
  });
  it('runs an operation inside a brush region without leaving a selection', () => {
    const { editor, models, voxels } = twoVoxels();
    const region = new Uint8Array(12);
    region[voxelIndex([3, 2, 2], 2, 1, 1)] = 1;
    models.apply((part) => ({ size: part.size, voxels: part.voxels.map(() => 3) }), 'pintado', region);
    expect(voxels().filter((color) => color !== 0).sort()).toEqual([3, 9]);
    expect(editor.state.voxelSelection).toBeNull();
    editor.history.undo();
    expect(voxels().filter((color) => color !== 0).sort()).toEqual([7, 9]);
  });
});
