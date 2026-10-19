/** A linear RGB float image, top row first. */
export type HdrImage = { width: number; height: number; pixels: Float32Array };

const RESOLUTION = /^-Y (\d+) \+X (\d+)$/;
/** Scanlines this wide may use the new run-length encoding, flagged by a leading 2, 2. */
const RLE_MIN_WIDTH = 8;
const RLE_MAX_WIDTH = 0x7fff;

/** Radiance `.hdr` (RGBE, flat or run-length encoded), as used for MagicaVoxel's image-based lighting. */
export function parseHdr(bytes: Uint8Array): HdrImage {
  let offset = 0;
  const fail = (reason: string): never => {
    throw new Error(`Arquivo .hdr inválido: ${reason}`);
  };
  const line = () => {
    const end = bytes.indexOf(0x0a, offset);
    if (end < 0) fail('cabeçalho incompleto');
    const text = new TextDecoder().decode(bytes.subarray(offset, end));
    offset = end + 1;
    return text;
  };
  if (!line().startsWith('#?')) fail('falta a assinatura #?RADIANCE');
  for (let header = line(); header.trim() !== ''; header = line()) {
    if (header.startsWith('FORMAT=') && header.trim() !== 'FORMAT=32-bit_rle_rgbe') fail(`formato ${header.slice(7)} não suportado`);
  }
  const match = RESOLUTION.exec(line().trim()) ?? fail('só a orientação -Y +X é suportada');
  const height = Number(match[1]);
  const width = Number(match[2]);
  const rgbe = new Uint8Array(width * height * 4);
  const take = () => (offset < bytes.length ? bytes[offset++] : fail('dados truncados'));

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    const encoded = width >= RLE_MIN_WIDTH && width <= RLE_MAX_WIDTH && bytes[offset] === 2 && bytes[offset + 1] === 2 && (bytes[offset + 2] & 0x80) === 0;
    if (!encoded) {
      if (offset + width * 4 > bytes.length) fail('dados truncados');
      rgbe.set(bytes.subarray(offset, offset + width * 4), row);
      offset += width * 4;
      continue;
    }
    offset += 2;
    if (((take() << 8) | take()) !== width) fail('largura da linha não confere');
    for (let channel = 0; channel < 4; channel++) {
      for (let x = 0; x < width; ) {
        const count = take();
        const run = count > 128;
        const length = run ? count - 128 : count;
        if (length === 0 || x + length > width) fail('sequência fora da linha');
        const value = run ? take() : 0;
        for (let end = x + length; x < end; x++) rgbe[row + x * 4 + channel] = run ? value : take();
      }
    }
  }

  const pixels = new Float32Array(width * height * 3);
  for (let index = 0; index < width * height; index++) {
    const exponent = rgbe[index * 4 + 3];
    const scale = exponent === 0 ? 0 : Math.pow(2, exponent - 136);
    for (let channel = 0; channel < 3; channel++) pixels[index * 3 + channel] = rgbe[index * 4 + channel] * scale;
  }
  return { width, height, pixels };
}
