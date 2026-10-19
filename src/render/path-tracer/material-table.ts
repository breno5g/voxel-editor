import { materialParam, materialType } from '../../editor/material-commands.ts';
import type { MaterialType } from '../../editor/material-commands.ts';
import { PALETTE_SIZE } from '../../format/vox.ts';
import type { Dict } from '../../format/vox.ts';

/** Material kinds as the shader numbers them. */
export const MATERIAL_KIND: Record<MaterialType, number> = { _diffuse: 0, _metal: 1, _glass: 2, _emit: 3, _blend: 4, _media: 5 };
/** Texels per palette index: (kind, rough, metal, ior), (trans, emission, density, specular). */
export const MATERIAL_ROWS = 2;

/** MATL parameters packed into a float texture, `PALETTE_SIZE` wide and `MATERIAL_ROWS` tall. */
export function materialTable(materials: Map<number, Dict>): Float32Array {
  const table = new Float32Array(PALETTE_SIZE * MATERIAL_ROWS * 4);
  for (let index = 0; index < PALETTE_SIZE; index++) {
    const attrs = materials.get(index);
    const kind = materialType(attrs);
    const param = (key: Parameters<typeof materialParam>[1]) => materialParam(attrs, key);
    // ponytail: inferred scale (each `_flux` step ×4); MagicaVoxel's exact emission curve is unconfirmed.
    const emission = kind === '_emit' || kind === '_blend' ? param('_emit') * Math.pow(4, param('_flux')) : 0;
    table.set([MATERIAL_KIND[kind], param('_rough'), kind === '_metal' || kind === '_blend' ? param('_metal') : 0, param('_ri')], index * 4);
    table.set([kind === '_glass' || kind === '_blend' ? param('_trans') : 0, emission, param('_d'), param('_sp')], (PALETTE_SIZE + index) * 4);
  }
  return table;
}
