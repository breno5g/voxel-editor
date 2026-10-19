import { describe, expect, it } from 'vitest';
import { PALETTE_SIZE } from '../../format/vox.ts';
import { MATERIAL_KIND, materialTable } from './material-table.ts';

const row = (table: Float32Array, index: number, rowIndex: number) => Array.from(table.slice((rowIndex * PALETTE_SIZE + index) * 4, (rowIndex * PALETTE_SIZE + index) * 4 + 4));

describe('materialTable', () => {
  it('packs each colour material into two texels', () => {
    const table = materialTable(new Map([[3, new Map([['_type', '_glass'], ['_rough', '0.2'], ['_ri', '1.5'], ['_trans', '0.7']])]]));
    expect(row(table, 3, 0)).toEqual([MATERIAL_KIND._glass, expect.closeTo(0.2), 0, 1.5]);
    expect(row(table, 3, 1)[0]).toBeCloseTo(0.7);
  });

  it('makes emitters shine at 1 + 3·emit·10^flux their colour', () => {
    const table = materialTable(new Map([[5, new Map([['_type', '_emit'], ['_emit', '0.5'], ['_flux', '2']])], [6, new Map([['_type', '_emit'], ['_emit', '0']])]]));
    expect([row(table, 5, 1)[1], row(table, 6, 1)[1]]).toEqual([expect.closeTo(151), 1]);
  });

  it('leaves metal and transparency off for diffuse colours', () => {
    const table = materialTable(new Map([[1, new Map([['_metal', '1'], ['_trans', '1']])]]));
    expect([row(table, 1, 0)[2], row(table, 1, 1)[0]]).toEqual([0, 0]);
  });

  it('stores the media type and phase of clouds', () => {
    const table = materialTable(new Map([[9, new Map([['_type', '_media'], ['_media_type', '_scatter'], ['_g', '0.4'], ['_d', '0.3']])]]));
    expect(row(table, 9, 0).slice(0, 3)).toEqual([MATERIAL_KIND._media, 1, expect.closeTo(0.4)]);
    expect(row(table, 9, 1)[2]).toBeCloseTo(0.3);
  });
});
