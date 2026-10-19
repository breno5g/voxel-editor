import { describe, expect, it } from 'vitest';
import { parseHdr } from './hdr-image.ts';

const header = (width: number, height: number) => new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
const concat = (...parts: ArrayLike<number>[]) => Uint8Array.from(parts.flatMap((part) => Array.from(part)));

describe('parseHdr', () => {
  it('decodes flat RGBE pixels', () => {
    const image = parseHdr(concat(header(2, 1), [128, 64, 0, 129, 0, 0, 0, 0]));
    expect(image).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(image.pixels)).toEqual([1, 0.5, 0, 0, 0, 0]);
  });

  it('decodes run-length encoded scanlines', () => {
    const channel = (value: number) => [128 + 8, value];
    const image = parseHdr(concat(header(8, 1), [2, 2, 0, 8], channel(128), channel(0), [8, 1, 2, 3, 4, 5, 6, 7, 8], channel(129)));
    expect(image.pixels[0]).toBe(1);
    expect(image.pixels[2]).toBeCloseTo(1 / 128);
    expect(image.pixels[7 * 3 + 2]).toBeCloseTo(8 / 128);
  });

  it('rejects truncated data', () => {
    expect(() => parseHdr(concat(header(2, 2), [1, 2, 3]))).toThrow(/truncados/);
  });
});
