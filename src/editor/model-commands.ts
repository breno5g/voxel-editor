import { isAxis } from '../format/rotation.ts';
import type { Axis } from '../format/rotation.ts';
import { EMPTY_VOXEL } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { chunkCounts } from '../geometry/mesher.ts';
import type { Editor } from './editor.ts';
import * as ops from './model-ops.ts';
import type { AxisReach } from './model-ops.ts';
import { countSelected, invertSelection, selectAll, selectColor, selectedVoxels, transformSelection } from './voxel-selection.ts';

export type ModelCommands = ReturnType<typeof createModelCommands>;

const allChunks = (model: VoxModel) => {
  const [x, y, z] = chunkCounts(model.size);
  return new Set(Array.from({ length: x * y * z }, (_unused, chunk) => chunk));
};

const AXIS_LETTERS = 'xyz';
const axisOf = (letter: string): Axis | null => {
  const index = AXIS_LETTERS.indexOf(letter);
  return isAxis(index) ? index : null;
};
const axisLetters = (word: string): Axis[] | null => {
  if (!/^[xyz]+$/.test(word)) return null;
  return [...new Set([...word].map(axisOf).filter((axis) => axis !== null))];
};
const perAxis = (axes: Axis[], value: number, otherwise: number): Vec3 => {
  const pick = (axis: Axis) => (axes.includes(axis) ? value : otherwise);
  return [pick(0), pick(1), pick(2)];
};
const isPrimitive = (value: string): value is ops.Primitive => ops.PRIMITIVES.some((shape) => shape === value);

/** `axis value…` arguments of MagicaVoxel's edit text fields (`z 2`, `xyz 2`, `z 0.2 0.2`). */
export function parseAxisArgs(args: string[]): { axes: Axis[]; values: number[] } | null {
  const [word = '', ...rest] = args;
  const axes = axisLetters(word.toLowerCase());
  const values = rest.map(Number);
  if (!axes || values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  return { axes, values };
}

/** `dil`/`ero` arguments (`***REMOVED***`): `x`, `+y` or `-z` limit the neighbourhood to the named axes and directions. */
export function parseReach(args: string[]): AxisReach[] | null {
  if (args.length === 0) return [...ops.ALL_NEIGHBORS];
  const reach: AxisReach[] = ['none', 'none', 'none'];
  for (const word of args.join('').toLowerCase().match(/[+-]?[xyz]|./g) ?? []) {
    const axis = axisOf(word.at(-1) ?? '');
    if (axis === null) return null;
    reach[axis] = word.startsWith('+') ? 'positive' : word.startsWith('-') ? 'negative' : 'both';
  }
  return reach;
}

const USAGE: Record<string, string> = {
  loop: 'eixo deslocamento, ex.: z 2',
  scale: 'eixos escala, ex.: xyz 2',
  shear: 'eixo escala escala, ex.: z 0.2 0.2',
  rot: 'eixo ângulo, ex.: z 45',
  repeat: 'eixos vezes, ex.: xy 2',
};

/** Model editor actions on the edited model (MagicaVoxel's edit panel and console commands); each is one undo step. */
export function createModelCommands(editor: Editor) {
  const { state } = editor;

  /** Voxels copied with `copy`/`cut`, at their position in a model of their source's size. */
  let clipboard: VoxModel | null = null;

  const editedModel = () => {
    const instance = editor.selectedInstance();
    if (!instance) editor.status('Selecione um objeto primeiro', 'error');
    if (!instance) return undefined;
    const model = state.vox.models[instance.model];
    return { index: instance.model, model, mask: editor.selectionOf(model) };
  };

  /**
   * Rewrites voxels of the edited model in place; `edit` gets the selection mask, if any, to stay inside it.
   * Undo keeps a full copy of the voxels.
   * ponytail: one snapshot per edit; switch to run-length or sparse diffs if huge models make history heavy.
   */
  const rewrite = (edit: (voxels: Uint8Array, mask: Uint8Array | null) => void, message: string) => {
    const edited = editedModel();
    if (!edited) return;
    const { model, mask } = edited;
    const before = model.voxels.slice();
    edit(model.voxels, mask);
    const after = model.voxels.slice();
    const restore = (voxels: Uint8Array) => () => {
      model.voxels.set(voxels);
      editor.voxelsChanged(model, allChunks(model));
    };
    restore(after)();
    editor.history.push({ undo: restore(before), redo: restore(after) });
    editor.status(message);
  };

  /**
   * Swaps the edited model for `operation(model)`, which may change its size; the object keeps its position.
   * With a selection the operation runs on the selected voxels' bounding box only, and the selection follows.
   */
  const replace = (operation: (model: VoxModel) => VoxModel, message: string) => {
    const edited = editedModel();
    if (!edited) return;
    const { index, model: before, mask } = edited;
    const after = mask ? transformSelection(before, mask, operation) : { model: operation(before), mask: null };
    const assign = (model: VoxModel, selection: Uint8Array | null) => () => {
      state.vox.models[index] = model;
      editor.sceneChanged();
      editor.setVoxelSelection(selection && { model, mask: selection });
    };
    assign(after.model, after.mask)();
    editor.history.push({ undo: assign(before, mask), redo: assign(after.model, after.mask) });
    editor.status(message);
  };

  const select = (mask: (model: VoxModel, current: Uint8Array | null) => Uint8Array, message: string) => {
    const edited = editedModel();
    if (!edited) return;
    const next = mask(edited.model, edited.mask);
    const count = countSelected(next);
    editor.setVoxelSelection(count > 0 ? { model: edited.model, mask: next } : null);
    editor.status(count > 0 ? `${message}: ${count} voxels` : 'Nada selecionado');
  };

  const copy = () => {
    const edited = editedModel();
    if (!edited) return false;
    clipboard = selectedVoxels(edited.model, edited.mask);
    editor.status(`${countSelected(clipboard.voxels.map((color) => (color === EMPTY_VOXEL ? 0 : 1)))} voxels copiados`);
    return true;
  };

  const withAxis = (args: string[], run: (axis: Axis) => void) => {
    const axis = axisOf(args[0]?.toLowerCase() ?? '');
    if (axis === null) return 'informe o eixo x, y ou z';
    run(axis);
  };

  const withAxisArgs = (name: string, args: string[], run: (parsed: { axes: Axis[]; values: number[] }) => string | void) => {
    const parsed = parseAxisArgs(args);
    return parsed ? run(parsed) : `use ${USAGE[name]}`;
  };

  /** `full`: the whole volume, or the selection's box, in the current colour. */
  const full = () => {
    const { color } = state;
    if (editedModel()?.mask) return replace((part) => ({ size: part.size, voxels: part.voxels.map(() => color) }), 'Seleção preenchida');
    rewrite((voxels) => voxels.fill(color), 'Volume preenchido');
  };
  /** `fill`: repaints every voxel, or every selected one. */
  const fill = () => {
    const { color } = state;
    rewrite((voxels, mask) => {
      for (let index = 0; index < voxels.length; index++) if (voxels[index] !== EMPTY_VOXEL && (!mask || mask[index])) voxels[index] = color;
    }, 'Voxels pintados com a cor atual');
  };
  /** `zero`: clears every voxel, or the selected ones. */
  const zero = () =>
    rewrite((voxels, mask) => {
      for (let index = 0; index < voxels.length; index++) if (!mask || mask[index]) voxels[index] = EMPTY_VOXEL;
    }, 'Voxels apagados');

  /** `paste`: the copied voxels go back at their position (clipped to this model's size) and become the selection. */
  const paste = () => {
    const source = clipboard;
    const edited = editedModel();
    if (!source) return editor.status('Nada copiado ainda', 'error');
    if (!edited) return;
    const pasted = new Uint8Array(edited.model.voxels.length);
    rewrite((voxels) => {
      source.voxels.forEach((color, index) => {
        if (color === EMPTY_VOXEL) return;
        const [x, y, z] = [index % source.size[0], Math.floor(index / source.size[0]) % source.size[1], Math.floor(index / (source.size[0] * source.size[1]))];
        if (x >= edited.model.size[0] || y >= edited.model.size[1] || z >= edited.model.size[2]) return;
        const target = x + edited.model.size[0] * (y + edited.model.size[1] * z);
        voxels[target] = color;
        pasted[target] = 1;
      });
    }, 'Voxels colados');
    editor.setVoxelSelection(countSelected(pasted) > 0 ? { model: edited.model, mask: pasted } : null);
  };

  /** MagicaVoxel command words; a handler returns an error message for bad arguments. */
  const COMMANDS: Record<string, (args: string[]) => string | void> = {
    full,
    fill,
    zero,
    sel_all: () => select(selectAll, 'Tudo selecionado'),
    sel_none: () => select(() => new Uint8Array(0), ''),
    sel_inv: () => select(invertSelection, 'Seleção invertida'),
    sel_col: () => select((model) => selectColor(model, state.color), `Voxels da cor ${state.color} selecionados`),
    copy: () => void copy(),
    cut: () => {
      if (copy()) zero();
    },
    paste,
    rev: () => replace((model) => ops.reverse(model, state.color), 'Espaço vazio invertido'),
    x2: () => replace(ops.double, 'Modelo com o dobro do tamanho'),
    xh: () => replace(ops.half, 'Modelo com metade do tamanho'),
    rot90: (args) => withAxis(args, (axis) => replace((model) => ops.rotate90(model, axis), `Modelo girado 90° em ${AXIS_LETTERS[axis].toUpperCase()}`)),
    flip: (args) => withAxis(args, (axis) => replace((model) => ops.flip(model, axis), `Modelo virado em ${AXIS_LETTERS[axis].toUpperCase()}`)),
    mir: (args) => withAxis(args, (axis) => replace((model) => ops.mirror(model, axis), `Metade espelhada em ${AXIS_LETTERS[axis].toUpperCase()}`)),
    dia: (args) => withAxis(args, (axis) => replace((model) => ops.diagonal(model, axis), `Diagonal espelhada em ${AXIS_LETTERS[axis].toUpperCase()}`)),
    loop: (args) =>
      withAxisArgs('loop', args, ({ axes, values }) => replace((model) => ops.loop(model, perAxis(axes, Math.round(values[0]), 0)), 'Modelo deslocado')),
    scale: (args) =>
      withAxisArgs('scale', args, ({ axes, values }) => {
        if (values[0] <= 0) return 'a escala precisa ser positiva';
        replace((model) => ops.scale(model, perAxis(axes, values[0], 1)), 'Modelo escalado');
      }),
    shear: (args) =>
      withAxisArgs('shear', args, ({ axes, values }) => {
        if (axes.length !== 1 || values.length < 2) return `use ${USAGE.shear}`;
        replace((model) => ops.shear(model, axes[0], [values[0], values[1]]), 'Modelo cisalhado');
      }),
    rot: (args) =>
      withAxisArgs('rot', args, ({ axes, values }) => {
        if (axes.length !== 1) return `use ${USAGE.rot}`;
        replace((model) => ops.rotate(model, axes[0], values[0]), `Modelo girado ${values[0]}°`);
      }),
    repeat: (args) =>
      withAxisArgs('repeat', args, ({ axes, values }) => {
        const count = Math.round(values[0]);
        if (count < 1) return 'repita pelo menos 1 vez';
        replace((model) => ops.repeat(model, perAxis(axes, count, 1)), 'Modelo repetido');
      }),
    prim: ([shape = '']) => {
      if (!isPrimitive(shape)) return 'use elli, cyli, pyra ou cone';
      replace((model) => ops.primitive(model, shape, state.color), 'Forma gerada');
    },
    maze: ([width = '1']) => {
      const cells = Number(width);
      if (!Number.isInteger(cells) || cells < 1) return 'a largura precisa ser um inteiro positivo';
      replace((model) => ops.maze(model, state.color, cells), 'Labirinto gerado');
    },
    noise: ([seed = '-1', frequency, low, high]) => {
      const values = [seed, frequency ?? String(ops.DEFAULT_NOISE.frequency), low ?? String(ops.DEFAULT_NOISE.low), high ?? String(ops.DEFAULT_NOISE.high)].map(Number);
      if (values.some((value) => !Number.isFinite(value))) return 'use semente frequência mínimo máximo, ex.: -1 0.04 0.2 0.5';
      const chosenSeed = values[0] < 0 ? Math.floor(Math.random() * 0xffff) : Math.min(values[0], 0xffff);
      replace((model) => ops.noise(model, state.color, { seed: chosenSeed, frequency: values[1], low: values[2], high: values[3] }), `Ruído gerado (semente ${chosenSeed})`);
    },
    flood: ([mode]) =>
      mode === '0' ? replace(ops.hull, 'Voxels invisíveis removidos') : replace((model) => ops.flood(model, state.color), 'Espaço interno preenchido'),
    dil: (args) => {
      const reach = parseReach(args);
      if (!reach) return 'use eixos como x, +y ou -z';
      replace((model) => ops.dilate(model, state.color, reach), 'Modelo dilatado');
    },
    ero: (args) => {
      const reach = parseReach(args);
      if (!reach) return 'use eixos como x, +y ou -z';
      replace((model) => ops.erode(model, reach), 'Modelo erodido');
    },
  };

  return {
    full,
    fill,
    zero,

    /** Runs one MagicaVoxel model command line, e.g. `rot90 x`, `loop z 2` or `prim cone`. */
    run(line: string) {
      const [name = '', ...args] = line.trim().split(/\s+/);
      const command = COMMANDS[name.toLowerCase()];
      if (!command) return editor.status(`Comando desconhecido: ${name}`, 'error');
      const problem = command(args);
      if (problem) editor.status(`${name}: ${problem}`, 'error');
    },
  };
}
