import { allChunks } from '../geometry/mesher.ts';
import { EMPTY_VOXEL, PALETTE_SIZE, paletteColor } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { evaluateShape, isLooping } from '../scene/keyframes.ts';
import type { Editor } from './editor.ts';
import { adjustColor, fromHex, gradient, identityMapping, invertMapping, permutePalette, remapVoxels, sortMapping, toHex, usedColors } from './palette-ops.ts';
import type { ColorChannel } from './palette-ops.ts';

const ALL_COLORS = Array.from({ length: PALETTE_SIZE - 1 }, (_unused, slot) => slot + 1);

/**
 * MagicaVoxel's palette commands (`pal`, `pal_sel`, `pal_add`, `rand`). Palette edits are one undo
 * step each; reordering (swap, sort) remaps every voxel too, so the models keep their look.
 */
export function createPaletteCommands(editor: Editor) {
  const { state } = editor;
  let region: Vec3[] = [];

  /** The palette selection, or the current colour alone. */
  const chosen = () => (state.paletteSelection.length ? state.paletteSelection : [state.color]);

  const replacePalette = (next: Uint8Array, message: string) => {
    const before = state.vox.palette.slice();
    const apply = (palette: Uint8Array) => () => {
      state.vox.palette.set(palette);
      editor.paletteChanged();
    };
    apply(next)();
    editor.history.push({ undo: apply(before), redo: apply(next) });
    editor.status(message);
  };

  const setColors = (colors: Map<number, Vec3>, message: string) => {
    const next = state.vox.palette.slice();
    colors.forEach((rgb, index) => next.set(rgb, (index - 1) * 4));
    replacePalette(next, message);
  };

  /** Moves colours by `mapping` in the palette and in every voxel, as one undo step. */
  const reorder = (mapping: Uint8Array, message: string) => {
    const before = state.vox.palette.slice();
    const after = permutePalette(before, mapping);
    const inverse = invertMapping(mapping);
    const apply = (palette: Uint8Array, voxelMapping: Uint8Array) => () => {
      state.vox.palette.set(palette);
      remapVoxels(state.vox.models, voxelMapping).forEach((model) => editor.voxelsChanged(model, allChunks(model.size)));
      editor.paletteChanged();
    };
    apply(after, mapping)();
    editor.history.push({ undo: apply(before, inverse), redo: apply(after, mapping) });
    editor.status(message);
  };

  /** The model the model editor shows, or null in the world editor. */
  const editedModel = (): VoxModel | null => {
    const transform = state.selected === null ? undefined : state.vox.nodes[state.selected];
    const shape = transform?.kind === 'transform' ? state.vox.nodes[transform.child] : undefined;
    return shape?.kind === 'shape' ? (state.vox.models[evaluateShape(shape.keys, state.frame, isLooping(shape.attrs))] ?? null) : null;
  };

  return {
    /** `pal set`: dragging colour `from` onto `to` copies it. */
    copyColorTo(from: number, to: number) {
      if (from !== to) setColors(new Map([[to, paletteColor(state.vox.palette, from)]]), `Cor ${from} copiada para ${to}`);
    },

    /** `pal swap` (Ctrl+drag): exchanges two colours, voxels included. */
    swapColors(a: number, b: number) {
      if (a === b) return;
      const mapping = identityMapping();
      mapping[a] = b;
      mapping[b] = a;
      reorder(mapping, `Cores ${a} e ${b} trocadas`);
      editor.setColor(b);
    },

    /** `pal grad` (Ctrl+Alt+drag): a gradient between two colours. */
    gradient(from: number, to: number) {
      if (Math.abs(from - to) > 1) setColors(gradient(state.vox.palette, from, to), `Gradiente de ${from} a ${to}`);
    },

    /** `pal sort`: the selection (or the whole palette) by hue and lightness, voxels included. */
    sortColors() {
      const indices = state.paletteSelection.length > 1 ? state.paletteSelection : ALL_COLORS;
      reorder(sortMapping(state.vox.palette, indices), 'Paleta ordenada');
    },

    /** Sets the current colour (or the selection) to `rgb`. */
    setColor(rgb: Vec3) {
      setColors(new Map(chosen().map((index) => [index, rgb])), 'Cor alterada');
    },

    /** `pal_add`: shifts one channel of every selected colour. */
    adjustColors(channel: ColorChannel, delta: number) {
      if (!delta) return;
      setColors(new Map(chosen().map((index) => [index, adjustColor(paletteColor(state.vox.palette, index), channel, delta)])), 'Cores ajustadas');
    },

    /** `pal_sel copy`: the current colour as hex. */
    colorCode: () => toHex(paletteColor(state.vox.palette, state.color)),

    /** `pal paste`: a hex colour onto the current colour (or the selection). */
    pasteColorCode(text: string) {
      const rgb = fromHex(text);
      if (!rgb) return editor.status(`Código de cor inválido: ${text.slice(0, 16)}`, 'error');
      setColors(new Map(chosen().map((index) => [index, rgb])), 'Cor colada');
    },

    /** `pal_sel copy_region`. */
    copyRegion() {
      region = chosen().map((index) => paletteColor(state.vox.palette, index));
      editor.status(`${region.length} cor(es) copiada(s)`);
    },

    /** `pal paste_region`: the copied colours from the current colour onwards. */
    pasteRegion() {
      if (region.length === 0) return editor.status('Nenhuma região copiada', 'error');
      const colors = new Map(region.flatMap((rgb, offset) => (state.color + offset < PALETTE_SIZE ? [[state.color + offset, rgb] as const] : [])));
      setColors(colors, 'Região colada');
    },

    /** Loads a whole palette (a preset or an imported file) as one undo step. */
    loadPalette(palette: Uint8Array, message: string) {
      replacePalette(palette, message);
    },

    /** `pal_sel all/none/inv`. */
    selectPalette(which: 'all' | 'none' | 'inv') {
      if (which === 'all') return editor.setPaletteSelection(ALL_COLORS);
      if (which === 'none') return editor.setPaletteSelection([]);
      editor.setPaletteSelection(ALL_COLORS.filter((index) => !state.paletteSelection.includes(index)));
    },

    /** `pal_sel flag`: selects the colours the edited model's voxels (or its voxel selection) use. */
    flagUsedColors() {
      const model = editedModel();
      if (!model) return editor.status('Edite um modelo para marcar as cores dele', 'error');
      const mask = editor.selectionOf(model);
      const used = new Set<number>();
      model.voxels.forEach((color, index) => color !== EMPTY_VOXEL && (!mask || mask[index]) && used.add(color));
      editor.setPaletteSelection([...used].sort((a, b) => a - b));
    },

    /** Colours no voxel uses (MagicaVoxel `pal mask` dims them). */
    unusedColors: () => ALL_COLORS.filter((index) => !usedColors(state.vox.models).has(index)),

    /** `rand`: every voxel of the edited model (or of its voxel selection) takes a random selected colour. */
    randomColors(random = Math.random) {
      const model = editedModel();
      const colors = chosen();
      if (!model) return editor.status('Edite um modelo para colorir', 'error');
      if (colors.length < 2) return editor.status('Selecione duas ou mais cores na paleta (Shift+clique)', 'error');
      const mask = editor.selectionOf(model);
      const before = model.voxels.slice();
      const after = before.map((color, index) => (color === EMPTY_VOXEL || (mask && !mask[index]) ? color : colors[Math.floor(random() * colors.length)]));
      const apply = (voxels: Uint8Array) => () => {
        model.voxels.set(voxels);
        editor.voxelsChanged(model, allChunks(model.size));
      };
      apply(after)();
      editor.history.push({ undo: apply(before), redo: apply(after) });
      editor.status('Cores aleatórias aplicadas');
    },
  };
}

export type PaletteCommands = ReturnType<typeof createPaletteCommands>;
