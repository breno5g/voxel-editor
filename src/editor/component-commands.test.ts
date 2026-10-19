import { describe, expect, it } from 'vitest';
import { createDocument } from '../format/defaults.ts';
import { parseVox } from '../format/vox-reader.ts';
import { createComponentCommands } from './component-commands.ts';
import { createEditor } from './editor.ts';

describe('component commands', () => {
  it('imports one component from another document and undoes it', () => {
    const editor = createEditor();
    editor.load(createDocument([2, 2, 2]), 'a.vox');
    const other = createDocument([2, 2, 2]);
    other.notes = ['metal'];
    other.palette[0] = 9;
    const components = createComponentCommands(editor);
    components.importComponent('note', other);
    expect(editor.state.vox.notes).toEqual(['metal']);
    expect(editor.state.vox.palette[0]).not.toBe(9);
    editor.history.undo();
    expect(editor.state.vox.notes).toEqual([]);
  });

  it('exports a component as a file holding only it', () => {
    const editor = createEditor();
    const document = createDocument([2, 2, 2]);
    document.cameras.set(3, new Map([['_mode', 'orth']]));
    editor.load(document, 'a.vox');
    const exported = parseVox(createComponentCommands(editor).exportComponent('camera'));
    expect(exported.cameras.get(3)?.get('_mode')).toBe('orth');
    expect(exported.models).toHaveLength(0);
  });

  it('saves only the chosen components', () => {
    const editor = createEditor();
    const document = createDocument([2, 2, 2]);
    document.notes = ['pele'];
    editor.load(document, 'a.vox');
    editor.setSavedComponent('note', false);
    expect(editor.savedDocument().notes).toEqual([]);
    expect(editor.state.vox.notes).toEqual(['pele']);
  });
});
