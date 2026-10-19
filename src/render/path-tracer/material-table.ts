import { MEDIA_TYPES, materialParam, materialType } from '../../editor/material-commands.ts';
import type { MaterialType } from '../../editor/material-commands.ts';
import { PALETTE_SIZE } from '../../format/vox.ts';
import type { Dict } from '../../format/vox.ts';

/** Material kinds as the shader numbers them. */
export const MATERIAL_KIND: Record<MaterialType, number> = { _diffuse: 0, _metal: 1, _glass: 2, _emit: 3, _blend: 4, _media: 5 };
/**
 * Texels per palette index: (kind, rough, metal, ior), (trans, emission, density, specular); media
 * (clouds) put their `_media_type` and phase `_g` where roughness and metal would be.
 */
export const MATERIAL_ROWS = 2;

/**
 * MagicaVoxel's emitter strength (***REMOVED***): an `_emit` voxel shines at `1 + 3·_emit·10^_flux` times
 * its colour, so it glows at its own colour even at zero emission. Blends and emitting media have no
 * such floor (inferred: the binary only shows the `_emit` branch).
 */
const emitterGain = (emit: number, flux: number) => 3 * emit * Math.pow(10, flux);

/** MATL parameters packed into a float texture, `PALETTE_SIZE` wide and `MATERIAL_ROWS` tall. */
export function materialTable(materials: Map<number, Dict>): Float32Array {
  const table = new Float32Array(PALETTE_SIZE * MATERIAL_ROWS * 4);
  for (let index = 0; index < PALETTE_SIZE; index++) {
    const attrs = materials.get(index);
    const kind = materialType(attrs);
    const param = (key: Parameters<typeof materialParam>[1]) => materialParam(attrs, key);
    const emission = kind === '_emit' ? 1 + emitterGain(param('_emit'), param('_flux')) : kind === '_blend' || kind === '_media' ? emitterGain(param('_emit'), param('_flux')) : 0;
    const media = MEDIA_TYPES.findIndex((type) => type === attrs?.get('_media_type'));
    const shape = kind === '_media' ? [Math.max(media, 0), param('_g')] : [param('_rough'), kind === '_metal' || kind === '_blend' ? param('_metal') : 0];
    table.set([MATERIAL_KIND[kind], ...shape, param('_ri')], index * 4);
    table.set([kind === '_glass' || kind === '_blend' ? param('_trans') : 0, emission, param('_d'), param('_sp')], (PALETTE_SIZE + index) * 4);
  }
  return table;
}
