import type { Dict } from '../format/vox.ts';
import type { Editor } from './editor.ts';

/** MagicaVoxel MATL `_type` values, as the renderer's material panel names them. */
export const MATERIAL_TYPES = ['_diffuse', '_emit', '_blend', '_metal', '_glass', '_media'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];
/** MATL `_media_type`: how a glass, blend or cloud material's volume behaves. */
export const MEDIA_TYPES = ['_absorb', '_scatter', '_emit', '_sss'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * The MATL parameters MagicaVoxel 0.99.7 reads and writes, with the
 * slider range and default its material panel uses, and the types that show them.
 */
export const MATERIAL_PARAMS = {
  _rough: { label: 'Rugos.', title: 'Rugosidade', min: 0, max: 1, fallback: 0.1, types: ['_metal', '_glass', '_blend'] },
  _ri: { label: 'IOR', title: 'Índice de refração', min: 1, max: 3, fallback: 1.3, types: ['_metal', '_glass', '_blend'] },
  _sp: { label: 'Espec.', title: 'Especular', min: 0, max: 1, fallback: 0.5, types: ['_metal', '_blend'] },
  _metal: { label: 'Metal', title: 'Metálico', min: 0, max: 1, fallback: 0, types: ['_metal', '_blend'] },
  _trans: { label: 'Transp.', title: 'Transparência', min: 0, max: 1, fallback: 0.5, types: ['_glass', '_blend'] },
  _d: { label: 'Dens.', title: 'Densidade do meio', min: 0, max: 1, fallback: 0.05, types: ['_glass', '_blend', '_media'] },
  _g: { label: 'Fase', title: 'Fase do meio (espalhamento para trás ou para frente)', min: -0.9, max: 0.9, fallback: 0, types: ['_media'] },
  _emit: { label: 'Emissão', title: 'Emissão de luz', min: 0, max: 1, fallback: 0, types: ['_emit', '_blend'] },
  _flux: { label: 'Pot.', title: 'Potência (fluxo radiante)', min: 0, max: 4, fallback: 1, types: ['_emit', '_blend'] },
  _ldr: { label: 'LDR', title: 'Faixa dinâmica baixa', min: 0, max: 1, fallback: 0, types: ['_emit', '_blend'] },
} as const satisfies Record<string, { label: string; title: string; min: number; max: number; fallback: number; types: readonly MaterialType[] }>;
export type MaterialParam = keyof typeof MATERIAL_PARAMS;

const isMaterialType = (value: string | undefined): value is MaterialType => MATERIAL_TYPES.some((type) => type === value);
export const materialType = (attrs: Dict | undefined): MaterialType => {
  const type = attrs?.get('_type');
  return isMaterialType(type) ? type : '_diffuse';
};

export function materialParam(attrs: Dict | undefined, key: MaterialParam): number {
  const value = Number.parseFloat(attrs?.get(key) ?? '');
  return Number.isFinite(value) ? value : MATERIAL_PARAMS[key].fallback;
}

/** Three decimals at most, without trailing zeros, as MagicaVoxel prints them. */
const formatParam = (value: number) => String(Math.round(value * 1000) / 1000);

/** MagicaVoxel's material commands (`mtl_reset`, `mtl_copy`, `mtl_paste`, the `pt_*` sliders) on the current colour or palette selection. */
export function createMaterialCommands(editor: Editor) {
  const { state } = editor;
  let copied: Dict | null = null;

  const chosen = () => (state.paletteSelection.length ? state.paletteSelection : [state.color]);

  /** Replaces the materials of the chosen colours with `next(current)`, as one undo step (null: plain diffuse). */
  const edit = (next: (current: Dict | undefined) => Dict | null, message: string) => {
    const indices = chosen();
    const before = indices.map((index) => state.vox.materials.get(index));
    const after = before.map(next);
    const apply = (values: (Dict | null | undefined)[]) => () => {
      indices.forEach((index, position) => {
        const value = values[position];
        if (value) state.vox.materials.set(index, value);
        else state.vox.materials.delete(index);
      });
      editor.paletteChanged();
    };
    apply(after)();
    editor.history.push({ undo: apply(before), redo: apply(after) });
    editor.status(message);
  };

  return {
    materialOf: (index: number) => state.vox.materials.get(index),

    setMaterialType(type: MaterialType) {
      edit((current) => (type === '_diffuse' && !current ? null : new Map(current).set('_type', type)), 'Tipo de material alterado');
    },

    setMaterialParam(key: MaterialParam, value: number) {
      const { min, max } = MATERIAL_PARAMS[key];
      const clamped = Math.min(Math.max(value, min), max);
      edit((current) => new Map(current ?? [['_type', '_diffuse']]).set(key, formatParam(clamped)), `${MATERIAL_PARAMS[key].title}: ${formatParam(clamped)}`);
    },

    setMediaType(type: MediaType) {
      edit((current) => new Map(current ?? [['_type', '_diffuse']]).set('_media_type', type), 'Meio do material alterado');
    },

    /** `mtl_reset`: back to plain diffuse. */
    resetMaterial() {
      edit(() => null, 'Material resetado para difuso');
    },

    /** `mtl_copy`: the current colour's material. */
    copyMaterial() {
      copied = new Map(state.vox.materials.get(state.color) ?? []);
      editor.status('Material copiado');
    },

    /** `mtl_paste`. */
    pasteMaterial() {
      const source = copied;
      if (!source) return editor.status('Nenhum material copiado', 'error');
      edit(() => (source.size ? new Map(source) : null), 'Material colado');
    },
  };
}

export type MaterialCommands = ReturnType<typeof createMaterialCommands>;
