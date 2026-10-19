import { xsFragmentSource } from '../editor/xs-shader.ts';
import { t } from '../i18n/i18n.ts';
import { linkFullScreenProgram } from './gl-program.ts';
import type { XsShader } from '../editor/xs-shader.ts';
import { PALETTE_BYTES, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';

/** Everything an XS `map()` reads besides the volume: MagicaVoxel's `i_*` uniforms. */
export type XsInputs = {
  palette: Uint8Array;
  color: number;
  colorSelection: number[];
  args: number[];
  mirror: Vec3;
  axis: Vec3;
  frame: number;
  frameCount: number;
  iterations: number;
  random: () => number;
};

/** Slices per row of the packed volume: a near-square grid of z slices. */
const columnsFor = ([, , sz]: Vec3) => Math.ceil(Math.sqrt(sz));

/**
 * Runs XS shaders on the GPU like MagicaVoxel: the volume goes to an integer texture, one fragment per
 * voxel evaluates `map()`, and the result is read back; `iterations` feed each pass into the next.
 */
export function createXsRunner() {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2');
  const programs = new Map<string, WebGLProgram>();

  const programFor = (shader: XsShader, context: WebGL2RenderingContext) => {
    const source = xsFragmentSource(shader);
    const program = programs.get(source) ?? linkFullScreenProgram(context, source);
    programs.set(source, program);
    return program;
  };

  const texture = (context: WebGL2RenderingContext) => {
    const handle = context.createTexture();
    context.bindTexture(context.TEXTURE_2D, handle);
    for (const parameter of [context.TEXTURE_MIN_FILTER, context.TEXTURE_MAG_FILTER]) context.texParameteri(context.TEXTURE_2D, parameter, context.NEAREST);
    return handle;
  };

  return {
    run(shader: XsShader, model: VoxModel, inputs: XsInputs): VoxModel {
      if (!gl) throw new Error(t('Este navegador não tem WebGL2 para rodar shaders XS'));
      const { size } = model;
      const columns = columnsFor(size);
      const width = size[0] * columns;
      const height = size[1] * Math.ceil(size[2] / columns);
      if (Math.max(width, height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error(t('Volume grande demais para a GPU'));
      const program = programFor(shader, gl);
      canvas.width = width;
      canvas.height = height;
      gl.useProgram(program);
      gl.viewport(0, 0, width, height);

      const location = (name: string) => gl.getUniformLocation(program, name);
      gl.uniform1i(location('u_volume'), 0);
      gl.uniform1i(location('u_palette'), 1);
      gl.uniform1i(location('u_columns'), columns);
      gl.uniform3f(location('i_volume_size'), ...size);
      gl.uniform1f(location('i_color_index'), inputs.color);
      const selection = inputs.colorSelection.length ? inputs.colorSelection : [inputs.color];
      gl.uniform1i(location('i_num_color_sels'), selection.length);
      gl.uniform1fv(location('i_color_sels'), Float32Array.from({ length: 256 }, (_unused, index) => selection[index] ?? 0));
      gl.uniform3f(location('i_mirror'), ...inputs.mirror);
      gl.uniform3f(location('i_axis'), ...inputs.axis);
      gl.uniform1fv(location('i_args'), Float32Array.from({ length: 16 }, (_unused, index) => inputs.args[index] ?? 0));
      gl.uniform1f(location('i_frame'), inputs.frame);
      gl.uniform1f(location('i_num_frames'), inputs.frameCount);

      gl.activeTexture(gl.TEXTURE1);
      const paletteTexture = texture(gl);
      const paletteData = new Uint8Array(PALETTE_BYTES);
      paletteData.set(inputs.palette.subarray(0, PALETTE_BYTES - 4), 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);

      gl.activeTexture(gl.TEXTURE0);
      const volumeTexture = texture(gl);
      const target = texture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);

      const packed = new Uint8Array(width * height);
      const pixels = new Uint8Array(width * height * 4);
      const cellOffset = (x: number, y: number, z: number) => ((Math.floor(z / columns) * size[1] + y) * width + (z % columns) * size[0] + x);
      let voxels = model.voxels;
      try {
        for (let iteration = 0; iteration < Math.max(1, inputs.iterations); iteration++) {
          for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) packed[cellOffset(x, y, z)] = voxels[voxelIndex(size, x, y, z)];
          gl.bindTexture(gl.TEXTURE_2D, volumeTexture);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, packed);
          gl.uniform1f(location('i_iter'), iteration);
          gl.uniform4f(location('i_rand'), inputs.random(), inputs.random(), inputs.random(), inputs.random());
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const next = new Uint8Array(voxels.length);
          for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) next[voxelIndex(size, x, y, z)] = pixels[cellOffset(x, y, z) * 4];
          voxels = next;
        }
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(framebuffer);
        [volumeTexture, target, paletteTexture].forEach((handle) => gl.deleteTexture(handle));
      }
      return { size: [...size], voxels };
    },
  };
}

export type XsRunner = ReturnType<typeof createXsRunner>;
