import type { Editor } from '../editor/editor.ts';
import { COLOR_CHANNELS, fromHex, hsvToRgb, indexRange, rgbToHsv, toHex } from '../editor/palette-ops.ts';
import type { PaletteCommands } from '../editor/palette-commands.ts';
import { PALETTE_SIZE, paletteColor } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';
import { bindButtonGroup, downloadBlob, element } from './dom.ts';
import { createDefaultPalette, createHuePalette } from '../format/defaults.ts';
import { encodeAct, paletteFromPixels, parseAct } from '../format/palette-file.ts';

/** Palette files open from the palette tools or by dropping them on the window. */
export const isPaletteFile = (name: string) => /\.(png|act)$/i.test(name);

type ColorSpace = 'hsv' | 'rgb';
const SPACE_LABELS: Record<ColorSpace, string[]> = { hsv: ['H', 'S', 'V'], rgb: ['R', 'G', 'B'] };
const SPACE_MAX: Record<ColorSpace, number[]> = { hsv: [359, 255, 255], rgb: [255, 255, 255] };

/** Chromium's screen colour picker (MagicaVoxel: Alt picks a screen colour). */
type EyeDropperResult = { sRGBHex: string };
const eyeDropper = (): { open: () => Promise<EyeDropperResult> } | null => {
  const constructor: unknown = Reflect.get(window, 'EyeDropper');
  return typeof constructor === 'function' ? Reflect.construct(constructor, []) : null;
};

/**
 * MagicaVoxel's palette: 255 swatches (index 0 means empty), Shift+click range selection, drag to copy
 * a colour, Ctrl+drag to swap, Ctrl+Alt+drag for a gradient, Alt+click for a screen colour; then the
 * colour editor (HSV/RGB sliders, hex, deltas on the selection) and the palette tools.
 */
export function bindPalettePanel(editor: Editor, palette: PaletteCommands): void {
  const { state } = editor;
  const container = element('palette', HTMLDivElement);
  const picker = element('palette-color', HTMLInputElement);
  const hex = element('palette-hex', HTMLInputElement);
  const sliders = [...document.querySelectorAll<HTMLInputElement>('[data-channel]')];
  const sliderLabels = [...document.querySelectorAll<HTMLElement>('[data-channel-label]')];
  const deltas = [...document.querySelectorAll<HTMLInputElement>('[data-delta]')];
  const maskButton = element('palette-mask', HTMLButtonElement);
  const tools = element('palette-tools', HTMLElement);
  const toolsToggle = element('palette-tools-toggle', HTMLButtonElement);
  toolsToggle.addEventListener('click', () => {
    tools.hidden = !tools.hidden;
    toolsToggle.setAttribute('aria-expanded', String(!tools.hidden));
    toolsToggle.setAttribute('aria-pressed', String(!tools.hidden));
  });
  let space: ColorSpace = 'hsv';
  let masked = false;

  const swatches = Array.from({ length: PALETTE_SIZE - 1 }, (_unused, slot) => {
    const swatch = Object.assign(document.createElement('button'), { type: 'button', title: `Cor ${slot + 1}` });
    swatch.dataset.index = String(slot + 1);
    swatch.setAttribute('aria-label', `Cor ${slot + 1}`);
    return swatch;
  });
  container.replaceChildren(...swatches);

  const indexOf = (target: EventTarget | null) => (target instanceof HTMLElement && target.dataset.index ? Number(target.dataset.index) : null);
  let press: { index: number; ctrlKey: boolean; altKey: boolean; shiftKey: boolean } | null = null;
  container.addEventListener('pointerdown', (event) => {
    const index = indexOf(event.target);
    if (index !== null) press = { index, ctrlKey: event.ctrlKey || event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey };
  });
  container.addEventListener('pointerup', async (event) => {
    const started = press;
    press = null;
    const index = indexOf(event.target);
    if (!started || index === null) return;
    if (index !== started.index) {
      if (started.ctrlKey && started.altKey) return palette.gradient(started.index, index);
      if (started.ctrlKey) return palette.swapColors(started.index, index);
      return palette.copyColorTo(started.index, index);
    }
    if (started.shiftKey) return editor.setPaletteSelection(indexRange(state.color, index));
    editor.setColor(index);
    editor.setPaletteSelection([]);
    if (!started.altKey) return;
    const dropper = eyeDropper();
    if (!dropper) return editor.status('Este navegador não pega cores da tela', 'error');
    const rgb = fromHex((await dropper.open().catch(() => ({ sRGBHex: '' }))).sRGBHex);
    if (rgb) palette.setColor(rgb);
  });
  container.addEventListener('pointerleave', () => (press = null));

  /** Live preview while the native picker or a slider moves; the release is one undo step. */
  let original: Uint8Array | null = null;
  const preview = (rgb: Vec3) => {
    original ??= state.vox.palette.slice();
    state.vox.palette.set(rgb, (state.color - 1) * 4);
    editor.paletteChanged();
  };
  const commit = () => {
    if (!original) return;
    const rgb = paletteColor(state.vox.palette, state.color);
    state.vox.palette.set(original);
    original = null;
    palette.setColor(rgb);
  };
  picker.addEventListener('input', () => {
    const rgb = fromHex(picker.value);
    if (rgb) preview(rgb);
  });
  picker.addEventListener('change', commit);
  const sliderColor = (): Vec3 => {
    const [a, b, c] = sliders.map((slider) => slider.valueAsNumber);
    return space === 'hsv' ? hsvToRgb([a, b, c]) : [a, b, c];
  };
  sliders.forEach((slider) => {
    slider.addEventListener('input', () => preview(sliderColor()));
    slider.addEventListener('change', commit);
  });
  hex.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') palette.pasteColorCode(hex.value);
  });
  deltas.forEach((input, position) =>
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      palette.adjustColors(COLOR_CHANNELS[position + (space === 'hsv' ? 0 : 3)], Math.round(input.valueAsNumber) || 0);
    }),
  );

  const showSpace = bindButtonGroup('color-space', (raw) => (raw === 'hsv' || raw === 'rgb' ? raw : undefined), (next) => {
    space = next;
    syncEditor();
  });

  const note = element('palette-note', HTMLInputElement);
  note.addEventListener('change', () => palette.setNote(state.color, note.value));
  const fileInput = element('palette-input', HTMLInputElement);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void importPalette(file);
  });
  /** MagicaVoxel: a palette file dropped on the palette opens as the palette (elsewhere a .png imports as a sprite). */
  const paletteSection = container.closest('section') ?? container;
  window.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files[0];
    const onPalette = event.target instanceof Node && paletteSection.contains(event.target);
    if (file && (/\.act$/i.test(file.name) || (onPalette && isPaletteFile(file.name)))) void importPalette(file);
  });

  const importPalette = async (file: File) => {
    try {
      if (/\.act$/i.test(file.name)) return palette.loadPalette(parseAct(new Uint8Array(await file.arrayBuffer()), state.vox.palette), `Paleta ${file.name} aberta`);
      const bitmap = await createImageBitmap(file);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D indisponível');
      context.drawImage(bitmap, 0, 0);
      palette.loadPalette(paletteFromPixels(context.getImageData(0, 0, bitmap.width, bitmap.height).data, state.vox.palette), `Paleta ${file.name} aberta`);
    } catch (error) {
      editor.fail(`Não foi possível abrir a paleta ${file.name}`, error);
    }
  };

  const savePng = async () => {
    const canvas = new OffscreenCanvas(PALETTE_SIZE, 1);
    const context = canvas.getContext('2d');
    if (!context) return editor.status('Canvas 2D indisponível', 'error');
    context.putImageData(new ImageData(Uint8ClampedArray.from(state.vox.palette), PALETTE_SIZE, 1), 0, 0);
    downloadBlob(await canvas.convertToBlob({ type: 'image/png' }), `${baseName()}-paleta.png`);
  };
  const baseName = () => state.fileName.replace(/\.vox$/i, '');

  const actions: Record<string, () => void> = {
    open: () => fileInput.click(),
    savePng: () => void savePng(),
    saveAct: () => downloadBlob(new Blob([encodeAct(state.vox.palette)], { type: 'application/octet-stream' }), `${baseName()}-paleta.act`),
    presetMv: () => palette.loadPalette(createDefaultPalette(), 'Paleta padrão do MagicaVoxel'),
    presetHue: () => palette.loadPalette(createHuePalette(), 'Paleta de tons'),
    all: () => palette.selectPalette('all'),
    inv: () => palette.selectPalette('inv'),
    none: () => palette.selectPalette('none'),
    flag: palette.flagUsedColors,
    copyCode: () => void navigator.clipboard?.writeText(palette.colorCode()).then(() => editor.status(`Cor ${palette.colorCode()} copiada`)),
    pasteCode: () => void navigator.clipboard?.readText().then(palette.pasteColorCode, () => editor.status('Sem acesso à área de transferência', 'error')),
    copyRegion: palette.copyRegion,
    pasteRegion: palette.pasteRegion,
    sort: palette.sortColors,
    random: () => palette.randomColors(),
  };
  document.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach((button) => button.addEventListener('click', () => actions[button.dataset.palette ?? '']?.()));
  maskButton.addEventListener('click', () => {
    masked = !masked;
    paintSwatches();
  });

  function paintSwatches() {
    const unused = new Set(masked ? palette.unusedColors() : []);
    maskButton.setAttribute('aria-pressed', String(masked));
    swatches.forEach((swatch, slot) => {
      swatch.style.background = toHex(paletteColor(state.vox.palette, slot + 1));
      swatch.dataset.unused = String(unused.has(slot + 1));
    });
  }

  function syncEditor() {
    const rgb = paletteColor(state.vox.palette, state.color);
    const values = space === 'hsv' ? rgbToHsv(rgb) : rgb;
    showSpace(space);
    sliders.forEach((slider, position) => {
      slider.max = String(SPACE_MAX[space][position]);
      slider.value = String(values[position]);
      sliderLabels[position].textContent = SPACE_LABELS[space][position];
    });
    picker.value = toHex(rgb);
    if (document.activeElement !== hex) hex.value = toHex(rgb);
    if (document.activeElement !== note) note.value = palette.noteOf(state.color);
  }

  const markSelected = () => {
    const selected = new Set(state.paletteSelection);
    swatches.forEach((swatch, slot) => {
      swatch.setAttribute('aria-pressed', String(slot + 1 === state.color));
      swatch.dataset.selected = String(selected.has(slot + 1));
    });
    syncEditor();
  };

  editor.subscribe((event) => {
    if (event.type === 'document' || event.type === 'palette' || (masked && event.type === 'voxels')) paintSwatches();
    if (event.type === 'document' || event.type === 'palette' || event.type === 'color') markSelected();
  });
}
