import { describe, expect, it } from 'vitest';
import { copyComponent, emptyDocument, withComponents } from './components.ts';
import { createDocument } from './defaults.ts';

function richDocument() {
  const document = createDocument([2, 2, 2]);
  document.palette[0] = 7;
  document.materials.set(3, new Map([['_type', '_metal']]));
  document.cameras.set(1, new Map([['_mode', 'iso']]));
  document.notes = ['pele'];
  document.renderObjects.push(new Map([['_type', '_inf']]));
  document.extras.push({ id: 'IMAP', content: Uint8Array.of(2), children: new Uint8Array(0) });
  return document;
}

describe('file components', () => {
  it('copies one component without touching the rest', () => {
    const source = richDocument();
    const target = emptyDocument();
    copyComponent.render(source, target);
    copyComponent.material(source, target);
    expect(target.renderObjects.map((attrs) => attrs.get('_type'))).toEqual(['_inf']);
    expect(target.extras).toEqual([]);
    expect(target.materials.get(3)?.get('_type')).toBe('_metal');
    expect(target.notes).toEqual([]);
    source.materials.get(3)?.set('_type', '_glass');
    expect(target.materials.get(3)?.get('_type')).toBe('_metal');
  });

  it('leaves out the components that are not saved', () => {
    const document = richDocument();
    const written = withComponents(document, { palette: true, material: false, render: false, camera: true, note: false });
    expect(written.palette[0]).toBe(7);
    expect(written.materials.size).toBe(0);
    expect(written.renderObjects).toEqual([]);
    expect(written.extras.map(({ id }) => id)).toEqual(['IMAP']);
    expect(written.cameras.size).toBe(1);
    expect(written.notes).toEqual([]);
    expect(document.notes).toEqual(['pele']);
  });
});
