import { createModel, EMPTY_VOXEL, PALETTE_SIZE, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import type { Axis } from '../format/rotation.ts';
import { nearestColor } from '../format/sprite.ts';
import { t } from '../i18n/i18n.ts';
import { isUnder, parentMap } from '../scene/scene-tree.ts';
import { STORES, transact } from './browser-store.ts';
import type { Editor } from './editor.ts';
import type { ModelCommands } from './model-commands.ts';
import { modelFromCells, worldCells } from './object-booleans.ts';
import type { ObjectCommands } from './object-commands.ts';
import { fractal, mask, rotate90, texture } from './model-ops.ts';
import { selectionBounds } from './voxel-selection.ts';

/** A pattern kept in the browser: its voxels and the palette they index, to match colours on load. */
type StoredPattern = { name: string; size: Vec3; voxels: Uint8Array; palette: Uint8Array; savedAt: number };

function isStoredPattern(value: unknown): value is StoredPattern {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'size' in value &&
    Array.isArray(value.size) &&
    'voxels' in value &&
    value.voxels instanceof Uint8Array &&
    'palette' in value &&
    value.palette instanceof Uint8Array
  );
}

/** The part of `model` inside the box `[low, high]`, keeping only cells `keep` accepts. */
function crop(model: VoxModel, [low, high]: [Vec3, Vec3], keep: (index: number) => boolean): VoxModel {
  const part = createModel([high[0] - low[0] + 1, high[1] - low[1] + 1, high[2] - low[2] + 1]);
  for (let z = low[2]; z <= high[2]; z++) {
    for (let y = low[1]; y <= high[1]; y++) {
      for (let x = low[0]; x <= high[0]; x++) {
        const index = voxelIndex(model.size, x, y, z);
        if (keep(index)) part.voxels[voxelIndex(part.size, x - low[0], y - low[1], z - low[2])] = model.voxels[index];
      }
    }
  }
  return part;
}

/** MagicaVoxel's patterns: `s_patt` (from voxels or objects), the library (`i_patt`), `onewpatt`, and `fractal`, `mask`, `tex`. */
export function createPatternCommands(editor: Editor, models: ModelCommands, objects: ObjectCommands) {
  const { state } = editor;

  const requirePattern = () => {
    if (!state.pattern) editor.status(t('Crie um padrão primeiro (da seleção, ou da biblioteca)'), 'error');
    return state.pattern;
  };

  const withPattern = (operation: (model: VoxModel, pattern: VoxModel) => VoxModel, message: string) => () => {
    const pattern = requirePattern();
    if (pattern) models.apply((model) => operation(model, pattern), message);
  };
  const commands = {
    fractal: withPattern(fractal, t('Fractal com o padrão')),
    mask: withPattern(mask, t('Modelo mascarado pelo padrão')),
    tex: withPattern(texture, t('Modelo texturizado com o padrão')),
  };
  models.define('fractal', commands.fractal);
  models.define('mask', commands.mask);
  models.define('tex', commands.tex);

  return {
    ...commands,

    /** `s_patt`: the selected voxels (or the whole edited model), or in the world the selected objects, become the pattern. */
    patternFromSelection() {
      if (state.mode === 'model') {
        const instance = editor.selectedInstance();
        const model = instance && state.vox.models[instance.model];
        if (!model) return editor.status(t('Selecione um objeto primeiro'), 'error');
        const selected = editor.selectionOf(model);
        const filled = selected ?? model.voxels.map((color) => (color === EMPTY_VOXEL ? 0 : 1));
        const bounds = selectionBounds(model.size, filled);
        if (!bounds) return editor.status(t('Nada para virar padrão'), 'error');
        editor.setPattern(crop(model, bounds, (index) => filled[index] === 1));
        return editor.status(t('Padrão criado da seleção'));
      }
      const parents = parentMap(state.vox);
      const cells = new Map<number, number>();
      state.instances
        .filter((instance) => state.selection.some((id) => isUnder(parents, instance.transformId, id)))
        .forEach((instance) => worldCells(instance, state.vox.models).forEach((color, key) => cells.set(key, color)));
      const built = modelFromCells(cells);
      if (!built) return editor.status(t('Selecione objetos para virar padrão'), 'error');
      editor.setPattern(built.model);
      editor.status(t('Padrão criado dos objetos'));
    },

    /** Pattern mode `-`/`+`/`0`/`9`: a quarter turn of the pattern. */
    rotatePattern(axis: Axis, direction: 1 | -1) {
      const pattern = requirePattern();
      if (!pattern) return;
      let turned = rotate90(pattern, axis);
      if (direction < 0) turned = rotate90(rotate90(turned, axis), axis);
      editor.setPattern(turned);
    },

    /** Pattern mode `Dir`/`Page` nudge the stamp from the pointer; `Home` (no delta) recentres it. */
    movePattern(delta: Vec3 | null) {
      if (!requirePattern()) return;
      const [x, y, z] = state.patternOffset;
      editor.setPatternOffset(delta ? [x + delta[0], y + delta[1], z + delta[2]] : [0, 0, 0]);
      editor.status(t('Padrão deslocado {offset}', { offset: state.patternOffset.join(', ') }));
    },

    /** `onewpatt`: the pattern as a new object, resting on the ground at `at` (or beside the scene). */
    placePattern(at?: Vec3) {
      const pattern = requirePattern();
      if (!pattern) return;
      const corner: Vec3 | undefined = at && [at[0] - Math.floor(pattern.size[0] / 2), at[1], at[2]];
      objects.importModels([{ size: [...pattern.size], voxels: pattern.voxels.slice() }], [t('padrão')], corner);
    },

    async listPatterns(): Promise<string[]> {
      const values: unknown[] = await transact(STORES.patterns, 'readonly', (store) => store.getAll());
      return values.filter(isStoredPattern).map(({ name }) => name).sort((a, b) => a.localeCompare(b));
    },

    async savePattern(name: string) {
      const pattern = requirePattern();
      const key = name.trim();
      if (!pattern || !key) return;
      const stored: StoredPattern = { name: key, size: [...pattern.size], voxels: pattern.voxels.slice(), palette: state.vox.palette.slice(), savedAt: Date.now() };
      await transact(STORES.patterns, 'readwrite', (store) => store.put(stored, key));
      editor.status(t('Padrão {name} salvo', { name: key }));
    },

    /** `i_patt`, with MagicaVoxel's "Match": each colour becomes the nearest one of the current palette. */
    async loadPattern(name: string) {
      const stored: unknown = await transact(STORES.patterns, 'readonly', (store) => store.get(name));
      if (!isStoredPattern(stored)) return editor.status(t('Padrão {name} não encontrado', { name }), 'error');
      const mapping = Uint8Array.from({ length: PALETTE_SIZE }, (_unused, index) => {
        if (index === EMPTY_VOXEL) return EMPTY_VOXEL;
        const offset = (index - 1) * 4;
        return nearestColor(state.vox.palette, stored.palette[offset], stored.palette[offset + 1], stored.palette[offset + 2]);
      });
      editor.setPattern({ size: [stored.size[0], stored.size[1], stored.size[2]], voxels: stored.voxels.map((color) => mapping[color]) });
      editor.status(t('Padrão {name} carregado', { name }));
    },

    async deletePattern(name: string) {
      await transact(STORES.patterns, 'readwrite', (store) => store.delete(name));
      editor.status(t('Padrão {name} apagado', { name }));
    },
  };
}

export type PatternCommands = ReturnType<typeof createPatternCommands>;
