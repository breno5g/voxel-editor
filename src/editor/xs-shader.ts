/** One `// arg : { ... }` line of an XS shader header: becomes `#define <name> i_args[index]`. */
export type XsArg = { name: string; label: string; value: number; min: number; max: number; step: number; precision: number };
export type XsShader = { name: string; source: string; args: XsArg[] };

/** MagicaVoxel's limit on shader arguments (`uniform float i_args[16]`). */
export const MAX_XS_ARGS = 16;

const ARG_LINE = /^\s*\/\/\s*arg\s*:\s*\{(.*)\}\s*$/;
const FIELD = /(\w+)\s*=\s*'([^']*)'/g;
const IDENTIFIER = /^[A-Za-z_]\w*$/;

/** The arguments a shader declares in its `xs_begin … xs_end` header, with their UI defaults. */
export function parseXsArgs(source: string): XsArg[] {
  return source
    .split('\n')
    .flatMap((line) => {
      const match = ARG_LINE.exec(line);
      if (!match) return [];
      const fields = new Map([...match[1].matchAll(FIELD)].map(([, key, value]) => [key, value]));
      const name = fields.get('var') ?? '';
      if (!IDENTIFIER.test(name)) return [];
      const [min = 0, max = 1] = (fields.get('range') ?? '').trim().split(/\s+/).map(Number);
      const number = (key: string, fallback: number) => {
        const value = Number(fields.get(key));
        return Number.isFinite(value) ? value : fallback;
      };
      return [{ name, label: fields.get('name') ?? name, value: number('value', min), min, max, step: number('step', 1), precision: number('precision', 0) }];
    })
    .slice(0, MAX_XS_ARGS);
}

export const createXsShader = (name: string, source: string): XsShader => ({ name, source, args: parseXsArgs(source) });

/**
 * The fragment shader that runs an XS `map()` once per voxel: the built-in uniforms and functions of
 * MagicaVoxel's XS API (and their camelCase aliases), one `#define` per declared argument, the user
 * code, and a `main` that evaluates `map` at the centre of the voxel this fragment stands for. The
 * volume is a 2D grid of z slices (`u_columns` per row) in an unsigned integer texture.
 */
export function xsFragmentSource(shader: XsShader): string {
  const defines = shader.args.map((arg, index) => `#define ${arg.name} i_args[${index}]`).join('\n');
  return `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_volume;
uniform sampler2D u_palette;
uniform int u_columns;
uniform vec3 i_volume_size;
uniform float i_color_index;
uniform int i_num_color_sels;
uniform float i_color_sels[256];
uniform vec3 i_mirror;
uniform vec3 i_axis;
uniform float i_args[${MAX_XS_ARGS}];
uniform float i_frame;
uniform float i_num_frames;
uniform vec4 i_rand;
uniform float i_iter;
#define iVolumeSize i_volume_size
#define iColorIndex i_color_index
#define iNumColorSels i_num_color_sels
#define iMirror i_mirror
#define iAxis i_axis
#define iArgs i_args
#define iFrame i_frame
#define iNumFrames i_num_frames
#define iRand i_rand
#define iIter i_iter
out vec4 o_color;

ivec2 xs_texel(ivec3 cell) {
  ivec3 size = ivec3(i_volume_size);
  return ivec2((cell.z % u_columns) * size.x + cell.x, (cell.z / u_columns) * size.y + cell.y);
}
float voxel(vec3 v) {
  ivec3 cell = ivec3(floor(v));
  if (any(lessThan(cell, ivec3(0))) || any(greaterThanEqual(cell, ivec3(i_volume_size)))) return 0.0;
  return float(texelFetch(u_volume, xs_texel(cell), 0).r);
}
float color_sel(float k) { return i_color_sels[clamp(int(k), 0, 255)]; }
vec4 palette(float index) { return texelFetch(u_palette, ivec2(clamp(int(index), 0, 255), 0), 0); }
${defines}
#line 1
${shader.source}

void main() {
  ivec3 size = ivec3(i_volume_size);
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec3 cell = ivec3(pixel.x % size.x, pixel.y % size.y, (pixel.y / size.y) * u_columns + pixel.x / size.x);
  if (cell.z >= size.z) { o_color = vec4(0.0); return; }
  float value = map(vec3(cell) + 0.5);
  o_color = vec4(clamp(floor(value + 0.5), 0.0, 255.0) / 255.0, 0.0, 0.0, 1.0);
}
`;
}

/** Built-in examples, so the panel works before any file is loaded (written for this editor). */
export const EXAMPLE_SHADERS: XsShader[] = [
  createXsShader(
    'bola',
    `// xs_begin
// arg : { var = 'm_radius' name = 'Raio' value = '1' range = '0 1' step = '0.05' precision = '2' }
// xs_end
float map(vec3 v) {
  vec3 p = (v - i_volume_size * 0.5) / (i_volume_size * 0.5);
  return length(p) <= m_radius ? i_color_index : voxel(v);
}`,
  ),
  createXsShader(
    'anel',
    `// xs_begin
// arg : { var = 'm_major' name = 'Raio' value = '0.65' range = '0 1' step = '0.05' precision = '2' }
// arg : { var = 'm_minor' name = 'Espessura' value = '0.25' range = '0 1' step = '0.05' precision = '2' }
// xs_end
float map(vec3 v) {
  vec3 p = (v - i_volume_size * 0.5) / (i_volume_size * 0.5);
  vec2 q = vec2(length(p.xy) - m_major, p.z);
  return length(q) <= m_minor ? i_color_index : voxel(v);
}`,
  ),
  createXsShader(
    'degraus',
    `// xs_begin
// arg : { var = 'm_step' name = 'Degrau' value = '4' range = '1 64' step = '1' precision = '0' }
// xs_end
float map(vec3 v) {
  float height = floor(v.x / m_step) * m_step;
  return v.z < height ? i_color_index : voxel(v);
}`,
  ),
];
