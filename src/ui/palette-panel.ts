import type { Editor } from '../editor/editor.ts';
import { PALETTE_SIZE, paletteColor } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';
import { element } from './dom.ts';

const toHex = (rgb: Vec3) => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

function fromHex(hex: string): Vec3 {
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

/** 255 swatches (index 0 means "empty" in .vox and is not paintable) plus a native colour picker. */
export function bindPalettePanel(editor: Editor): void {
  const container = element('palette', HTMLDivElement);
  const picker = element('palette-color', HTMLInputElement);

  const swatches = Array.from({ length: PALETTE_SIZE - 1 }, (_unused, slot) => {
    const index = slot + 1;
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.title = `Cor ${index}`;
    swatch.setAttribute('aria-label', `Cor ${index}`);
    swatch.addEventListener('click', () => editor.setColor(index));
    return swatch;
  });
  container.replaceChildren(...swatches);

  const paintSwatches = () =>
    swatches.forEach((swatch, slot) => {
      swatch.style.background = toHex(paletteColor(editor.state.vox.palette, slot + 1));
    });

  const markSelected = () => {
    swatches.forEach((swatch, slot) => swatch.setAttribute('aria-pressed', String(slot + 1 === editor.state.color)));
    picker.value = toHex(paletteColor(editor.state.vox.palette, editor.state.color));
  };

  const setColorAt = (index: number, rgb: Vec3) => () => {
    editor.state.vox.palette.set(rgb, (index - 1) * 4);
    editor.paletteChanged();
  };

  /** Live preview while the picker is open; the whole picking session becomes one undo step. */
  let original: Vec3 | null = null;
  picker.addEventListener('input', () => {
    original ??= paletteColor(editor.state.vox.palette, editor.state.color);
    setColorAt(editor.state.color, fromHex(picker.value))();
  });
  picker.addEventListener('change', () => {
    if (!original) return;
    const index = editor.state.color;
    editor.history.push({ undo: setColorAt(index, original), redo: setColorAt(index, fromHex(picker.value)) });
    original = null;
  });

  editor.subscribe((event) => {
    if (event.type === 'document' || event.type === 'palette') paintSwatches();
    if (event.type === 'document' || event.type === 'palette' || event.type === 'color') markSelected();
  });
}
