import type { Editor } from '../editor/editor.ts';
import { COLOR_CHANNELS, fromHex, hsvToRgb, indexRange, rgbToHsv, toHex } from '../editor/palette-ops.ts';
import type { PaletteCommands } from '../editor/palette-commands.ts';
import { PALETTE_SIZE, paletteColor } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';
import { bindButtonGroup, element } from './dom.ts';

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

  const actions: Record<string, () => void> = {
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
