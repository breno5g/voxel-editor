import * as THREE from 'three';
import { ENVIRONMENTS, PROJECTIONS } from '../../format/render-settings.ts';
import type { RenderSettings } from '../../format/render-settings.ts';
import { PALETTE_BYTES, PALETTE_SIZE } from '../../format/vox.ts';
import type { Vec3 } from '../../format/vox.ts';
import { linkFullScreenProgram } from '../gl-program.ts';
import type { HdrImage } from './hdr-image.ts';
import { MATERIAL_ROWS } from './material-table.ts';
import { BLOOM_BLUR_FRAGMENT, BLOOM_DOWNSAMPLE, BLOOM_EXTRACT_FRAGMENT, DISPLAY_FRAGMENT, pathTraceFragment } from './path-trace-shader.ts';
import { dilateBricks, shapeDensity } from './scene-volume.ts';
import type { SceneVolume } from './scene-volume.ts';

export type PathTracer = ReturnType<typeof createPathTracer>;
/** The camera to trace from and the distance along its view where the lens focuses. */
export type TraceView = { camera: THREE.Camera; focusDistance: number };
/** Options that only live while rendering (MagicaVoxel keeps them out of the file). */
export type TraceOptions = { shadows: boolean; translucentShadows: boolean; antialias: boolean; pixelated: boolean; shape: VoxelShape; bloom: boolean };
/** MagicaVoxel's `pt_prim`: how each voxel is drawn. */
export const VOXEL_SHAPES = ['cube', 'lego', 'mc', 'clay', 'sphr', 'cyli'] as const;
export type VoxelShape = (typeof VOXEL_SHAPES)[number];

/** Samples per pixel after which the image is left as it is. */
export const MAX_SAMPLES = 2048;
/** How far behind an orthographic camera its rays start, so nothing in front of the scene is cut. */
const ORTHOGRAPHIC_PULLBACK = 10000;
// ponytail: the scales below are inferred from MagicaVoxel's slider ranges, not read from its binary.
/** `_area` as a fraction of a right angle: the sun's angular radius. */
const SUN_AREA_ANGLE = Math.PI / 2;
/** `_fog_uni _d`: extinction per 1000 voxels. */
const FOG_SCALE = 0.001;
/** `_ground _hor`: how fast the ground fades, per 100 voxels. */
const HORIZON_SCALE = 0.01;
/** `_lens _aperture`: lens radius as a fraction of the focus distance. */
const APERTURE_SCALE = 0.02;

/** Units for the trace pass, then for the bloom and display passes (which bind only 2D textures). */
const TEXTURE_UNITS = { volume: 0, bricks: 1, palette: 2, materials: 3, ibl: 4, previous: 5, density: 6, accumulation: 0, bloom: 1 } as const;
/** Clay is occupancy blurred this many times; marching cubes uses it as is. */
const CLAY_BLUR_PASSES = 2;

const linear = (color: Vec3): Vec3 => [Math.pow(color[0] / 255, 2.2), Math.pow(color[1] / 255, 2.2), Math.pow(color[2] / 255, 2.2)];
const scaled = (color: Vec3, factor: number): Vec3 => [color[0] * factor, color[1] * factor, color[2] * factor];
const radians = THREE.MathUtils.degToRad;

/**
 * MagicaVoxel's renderer: a progressive path tracer on its own WebGL2 canvas laid over the editor's.
 * Each `trace` adds one sample per pixel to a float accumulation buffer and shows the tone-mapped mean;
 * any change to the scene, settings, camera or size restarts the accumulation.
 */
export function createPathTracer(container: HTMLElement) {
  const canvas = Object.assign(document.createElement('canvas'), { className: 'path-trace', hidden: true });
  container.append(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('Este navegador não tem WebGL2 para o renderizador');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('A GPU não grava texturas float (EXT_color_buffer_float), que o renderizador usa');

  const tracePrograms = new Map<VoxelShape, WebGLProgram>();
  const traceProgramFor = (shape: VoxelShape) => {
    const program = tracePrograms.get(shape) ?? linkFullScreenProgram(gl, pathTraceFragment(VOXEL_SHAPES.indexOf(shape)));
    tracePrograms.set(shape, program);
    return program;
  };
  let traceProgram = traceProgramFor('cube');
  const displayProgram = linkFullScreenProgram(gl, DISPLAY_FRAGMENT);
  const extractProgram = linkFullScreenProgram(gl, BLOOM_EXTRACT_FRAGMENT);
  const blurProgram = linkFullScreenProgram(gl, BLOOM_BLUR_FRAGMENT);
  const locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const at = (program: WebGLProgram, name: string) => {
    const cache = locations.get(program) ?? new Map<string, WebGLUniformLocation | null>();
    locations.set(program, cache);
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    return cache.get(name) ?? null;
  };

  const createTexture = (target: GLenum, filter: GLenum = gl.NEAREST) => {
    const texture = gl.createTexture();
    gl.bindTexture(target, texture);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return texture;
  };
  const volumeTexture = createTexture(gl.TEXTURE_3D);
  const bricksTexture = createTexture(gl.TEXTURE_3D);
  const densityTexture = createTexture(gl.TEXTURE_3D, gl.LINEAR);
  const paletteTexture = createTexture(gl.TEXTURE_2D);
  const materialsTexture = createTexture(gl.TEXTURE_2D);
  const iblTexture = createTexture(gl.TEXTURE_2D, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const upload3d = (texture: WebGLTexture, size: Vec3, cells: Uint8Array) => {
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8UI, size[0], size[1], size[2], 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, cells);
  };
  const uploadIbl = (image: HdrImage | null) => {
    gl.bindTexture(gl.TEXTURE_2D, iblTexture);
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, image.width, image.height, 0, gl.RGB, gl.FLOAT, image.pixels);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, 1, 1, 0, gl.RGB, gl.FLOAT, new Float32Array(3));
  };
  const uploadDensity = (size: Vec3, density: Uint8Array) => {
    gl.bindTexture(gl.TEXTURE_3D, densityTexture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, size[0], size[1], size[2], 0, gl.RED, gl.UNSIGNED_BYTE, density);
  };
  uploadDensity([1, 1, 1], new Uint8Array(1));
  upload3d(volumeTexture, [1, 1, 1], new Uint8Array(1));
  upload3d(bricksTexture, [1, 1, 1], new Uint8Array(1));
  uploadIbl(null);

  /** Two float buffers: each sample reads the running mean from one and writes the new mean into the other. */
  const accumulation = [0, 1].map(() => ({ texture: createTexture(gl.TEXTURE_2D), framebuffer: gl.createFramebuffer() }));
  /** Bloom's bright pass and blur, ping-ponged at a quarter of the image size. */
  const bloomTargets = [0, 1].map(() => ({ texture: createTexture(gl.TEXTURE_2D, gl.LINEAR), framebuffer: gl.createFramebuffer() }));
  let width = 0;
  let height = 0;
  let bloomWidth = 0;
  let bloomHeight = 0;
  const resize = (nextWidth: number, nextHeight: number) => {
    const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    if (nextWidth > limit || nextHeight > limit) throw new Error(`A GPU renderiza até ${limit}×${limit} pixels`);
    width = nextWidth;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
    accumulation.forEach(({ texture, framebuffer }) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    });
    bloomWidth = Math.ceil(width / BLOOM_DOWNSAMPLE);
    bloomHeight = Math.ceil(height / BLOOM_DOWNSAMPLE);
    bloomTargets.forEach(({ texture, framebuffer }) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, bloomWidth, bloomHeight, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  let volume: SceneVolume | null = null;
  let settings: RenderSettings | null = null;
  let options: TraceOptions = { shadows: true, translucentShadows: true, antialias: true, pixelated: false, shape: 'cube', bloom: false };
  let hasIbl = false;
  let samples = 0;
  let current = 0;
  let lastView = '';
  const reset = () => {
    samples = 0;
  };
  /** Smooth shapes need the density field, and bricks grown by one so surfaces bulging out of them are found. */
  const uploadShape = () => {
    if (!volume) return;
    const smooth = options.shape === 'mc' || options.shape === 'clay';
    upload3d(bricksTexture, volume.brickSize, smooth ? dilateBricks(volume) : volume.bricks);
    if (smooth) uploadDensity(volume.size, shapeDensity(volume, options.shape === 'clay' ? CLAY_BLUR_PASSES : 0));
  };

  /** The camera's frame and projection as uniforms; returns a key that changes whenever the view does. */
  const applyCamera = ({ camera, focusDistance }: TraceView, lens: RenderSettings['lens']) => {
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    const right: Vec3 = [m[0], m[1], m[2]];
    const up: Vec3 = [m[4], m[5], m[6]];
    const forward: Vec3 = [-m[8], -m[9], -m[10]];
    let eye: Vec3 = [m[12], m[13], m[14]];
    const orthographic = camera instanceof THREE.OrthographicCamera;
    const orthoHeight = orthographic ? (camera.top - camera.bottom) / (2 * camera.zoom) : 0;
    /* MagicaVoxel renders with its own FOV (`pt_fov`), apart from the editor camera's. */
    const tanHalf = Math.tan(radians(Math.min(lens.fov, 179) / 2));
    if (orthographic) eye = [eye[0] - forward[0] * ORTHOGRAPHIC_PULLBACK, eye[1] - forward[1] * ORTHOGRAPHIC_PULLBACK, eye[2] - forward[2] * ORTHOGRAPHIC_PULLBACK];
    gl.uniform3fv(at(traceProgram, 'u_eye'), eye);
    gl.uniform3fv(at(traceProgram, 'u_right'), right);
    gl.uniform3fv(at(traceProgram, 'u_up'), up);
    gl.uniform3fv(at(traceProgram, 'u_forward'), forward);
    gl.uniform1i(at(traceProgram, 'u_orthographic'), orthographic ? 1 : 0);
    gl.uniform1f(at(traceProgram, 'u_orthoHeight'), orthoHeight);
    gl.uniform1f(at(traceProgram, 'u_tanHalf'), tanHalf);
    gl.uniform1f(at(traceProgram, 'u_focus'), focusDistance);
    gl.uniform1f(at(traceProgram, 'u_aperture'), lens.aperture * APERTURE_SCALE * focusDistance);
    return [...m, orthoHeight, tanHalf, focusDistance].join(',');
  };

  const applySettings = (active: RenderSettings) => {
    const { sun, sky, ibl, atmosphere, fog, lens, ground, edge, grid, show, bounce } = active;
    const uniform3 = (name: string, value: Vec3) => gl.uniform3fv(at(traceProgram, name), value);
    const uniform1 = (name: string, value: number) => gl.uniform1f(at(traceProgram, name), value);
    const uniformInt = (name: string, value: number | boolean) => gl.uniform1i(at(traceProgram, name), Number(value));
    const [pitch, yaw] = [radians(sun.pitch), radians(sun.yaw)];
    uniform3('u_sunDirection', [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)]);
    uniform3('u_sunRadiance', scaled(linear(sun.color), sun.intensity));
    uniform1('u_sunCos', Math.cos(Math.min(sun.area, 1) * SUN_AREA_ANGLE));
    uniformInt('u_sunDisk', sun.disk);
    uniformInt('u_environment', ENVIRONMENTS.indexOf(active.environment));
    uniform3('u_sky', scaled(linear(sky.color), sky.intensity));
    uniform1('u_iblIntensity', ibl.intensity);
    gl.uniformMatrix3fv(at(traceProgram, 'u_iblRotation'), false, new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(-radians(ibl.yaw))).elements);
    uniformInt('u_hasIbl', hasIbl);
    /* Scattering colours are coefficients, not sRGB: the default Rayleigh 45 104 255 is the physical β ratio. */
    uniform3('u_rayleigh', scaled(atmosphere.rayleighColor, atmosphere.rayleigh / 255));
    uniform3('u_mie', scaled(atmosphere.mieColor, atmosphere.mie / 255));
    uniform1('u_miePhase', atmosphere.miePhase);
    uniform3('u_ozone', scaled(atmosphere.ozoneColor, atmosphere.ozone / 255));
    uniform1('u_fogDensity', fog.density * FOG_SCALE);
    uniform3('u_fogColor', linear(fog.color));
    uniform1('u_fogPhase', fog.phase);
    uniformInt('u_ground', show.ground);
    uniform3('u_groundColor', linear(ground.color));
    uniform1('u_horizon', ground.horizon * HORIZON_SCALE);
    uniformInt('u_flatBackground', show.backgroundColor || show.transparent);
    uniformInt('u_edges', show.edge);
    uniform3('u_edgeColor', linear(edge.color));
    uniform1('u_edgeWidth', edge.width);
    uniformInt('u_grid', show.grid);
    uniform3('u_gridColor', linear(grid.color));
    uniform1('u_gridSpacing', grid.spacing);
    uniform1('u_gridWidth', grid.width);
    uniformInt('u_gridGroundOnly', grid.groundOnly);
    uniformInt('u_diffuseBounces', bounce.diffuse);
    uniformInt('u_specularBounces', bounce.specular);
    uniformInt('u_scatterBounces', bounce.scatter);
    uniform1('u_energy', bounce.energy);
    uniformInt('u_projection', PROJECTIONS.indexOf(lens.projection));
    uniform1('u_blades', lens.blades);
    uniform1('u_bladeRotation', radians(lens.bladeRotation));
    const scale: Vec3 = [Math.max(show.scale[0], 1e-3), Math.max(show.scale[1], 1e-3), Math.max(show.scale[2], 1e-3)];
    uniform3('u_scale', scale);
    uniform3('u_origin', volume ? [volume.origin[0] * scale[0], volume.origin[1] * scale[1], volume.origin[2] * scale[2]] : [0, 0, 0]);
    gl.uniform3iv(at(traceProgram, 'u_size'), volume?.size ?? [1, 1, 1]);
    uniformInt('u_hasVolume', volume !== null);
  };

  const bind = (unit: number, target: GLenum, texture: WebGLTexture | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, texture);
  };

  /** Blurs what the exposure lifts above the threshold into the first bloom target. */
  const blurBloom = (exposure: number, { scale, aspect, threshold }: RenderSettings['bloom']) => {
    const [first, second] = bloomTargets;
    gl.viewport(0, 0, bloomWidth, bloomHeight);
    gl.useProgram(extractProgram);
    bind(TEXTURE_UNITS.accumulation, gl.TEXTURE_2D, accumulation[current].texture);
    gl.uniform1i(at(extractProgram, 'u_accumulation'), TEXTURE_UNITS.accumulation);
    gl.uniform1f(at(extractProgram, 'u_exposure'), exposure);
    gl.uniform1f(at(extractProgram, 'u_threshold'), threshold);
    gl.bindFramebuffer(gl.FRAMEBUFFER, first.framebuffer);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(blurProgram);
    gl.uniform1i(at(blurProgram, 'u_source'), TEXTURE_UNITS.accumulation);
    // ponytail: `_aspect` read as squashing the blur vertically (an anamorphic streak at 1); unconfirmed in the binary.
    const passes: [typeof first, typeof first, [number, number], number][] = [
      [first, second, [1, 0], scale * bloomHeight],
      [second, first, [0, 1], scale * bloomHeight * (1 - 0.9 * aspect)],
    ];
    passes.forEach(([source, target, direction, radius]) => {
      bind(TEXTURE_UNITS.accumulation, gl.TEXTURE_2D, source.texture);
      gl.uniform2f(at(blurProgram, 'u_direction'), ...direction);
      gl.uniform1f(at(blurProgram, 'u_radius'), radius);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
  };

  const display = (film: RenderSettings['film'], background: Vec3, transparent: boolean, bloom: RenderSettings['bloom'] | null) => {
    if (bloom) blurBloom(film.exposure, bloom);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(displayProgram);
    bind(TEXTURE_UNITS.accumulation, gl.TEXTURE_2D, accumulation[current].texture);
    bind(TEXTURE_UNITS.bloom, gl.TEXTURE_2D, bloomTargets[0].texture);
    gl.uniform1i(at(displayProgram, 'u_accumulation'), TEXTURE_UNITS.accumulation);
    gl.uniform1i(at(displayProgram, 'u_bloom'), TEXTURE_UNITS.bloom);
    gl.uniform1f(at(displayProgram, 'u_bloomMix'), bloom ? bloom.mix : 0);
    gl.uniform2f(at(displayProgram, 'u_resolution'), width, height);
    gl.uniform1f(at(displayProgram, 'u_exposure'), film.exposure);
    gl.uniform1i(at(displayProgram, 'u_aces'), Number(film.aces));
    gl.uniform1f(at(displayProgram, 'u_gamma'), film.gamma);
    gl.uniform1f(at(displayProgram, 'u_vignette'), film.vignette);
    gl.uniform1i(at(displayProgram, 'u_transparent'), Number(transparent));
    gl.uniform3fv(at(displayProgram, 'u_background'), scaled(background, 1 / 255));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  return {
    canvas,
    get samples() {
      return samples;
    },

    setVolume(next: SceneVolume | null) {
      const limit = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
      if (next && next.size.some((axis) => axis > limit)) throw new Error(`A GPU aceita até ${limit} voxels por eixo; a cena tem ${next.size.join('×')}`);
      volume = next;
      if (next) upload3d(volumeTexture, next.size, next.voxels);
      uploadShape();
      reset();
    },

    /** RGBA palette bytes; palette index i is texel i, so slot i - 1 of the chunk. */
    setPalette(palette: Uint8Array) {
      const texels = new Uint8Array(PALETTE_BYTES);
      texels.set(palette.subarray(0, PALETTE_BYTES - 4), 4);
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texels);
      reset();
    },

    setMaterials(table: Float32Array) {
      gl.bindTexture(gl.TEXTURE_2D, materialsTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PALETTE_SIZE, MATERIAL_ROWS, 0, gl.RGBA, gl.FLOAT, table);
      reset();
    },

    setIbl(image: HdrImage | null) {
      uploadIbl(image);
      hasIbl = image !== null;
      reset();
    },

    setSettings(next: RenderSettings) {
      settings = next;
      reset();
    },

    setOptions(next: TraceOptions) {
      const reshaped = next.shape !== options.shape;
      options = next;
      if (reshaped) uploadShape();
      reset();
    },

    reset,

    /**
     * Adds one sample per pixel and shows the result, at the canvas's CSS size unless `size` is given (final
     * images). With `moving`, a changed view keeps accumulating: each sample may come from another camera (motion blur).
     */
    trace(view: TraceView, size?: { width: number; height: number }, moving = false) {
      if (!settings) return;
      const nextWidth = Math.max(1, Math.round(size?.width ?? canvas.clientWidth));
      const nextHeight = Math.max(1, Math.round(size?.height ?? canvas.clientHeight));
      if (nextWidth !== width || nextHeight !== height) {
        resize(nextWidth, nextHeight);
        reset();
      }
      traceProgram = traceProgramFor(options.shape);
      gl.useProgram(traceProgram);
      const viewKey = applyCamera(view, settings.lens);
      if (viewKey !== lastView && !moving) reset();
      lastView = viewKey;
      if (samples >= MAX_SAMPLES) return;
      applySettings(settings);
      gl.uniform1i(at(traceProgram, 'u_shadows'), Number(options.shadows));
      gl.uniform1i(at(traceProgram, 'u_translucentShadows'), Number(options.translucentShadows));
      gl.uniform1i(at(traceProgram, 'u_antialias'), Number(options.antialias));
      gl.uniform1i(at(traceProgram, 'u_pixelated'), Number(options.pixelated));
      gl.uniform1f(at(traceProgram, 'u_cell'), Math.min(Math.max(settings.show.cell, 0.01), 1));
      const previous = current;
      current = 1 - current;
      bind(TEXTURE_UNITS.volume, gl.TEXTURE_3D, volumeTexture);
      bind(TEXTURE_UNITS.bricks, gl.TEXTURE_3D, bricksTexture);
      bind(TEXTURE_UNITS.palette, gl.TEXTURE_2D, paletteTexture);
      bind(TEXTURE_UNITS.materials, gl.TEXTURE_2D, materialsTexture);
      bind(TEXTURE_UNITS.ibl, gl.TEXTURE_2D, iblTexture);
      bind(TEXTURE_UNITS.previous, gl.TEXTURE_2D, accumulation[previous].texture);
      bind(TEXTURE_UNITS.density, gl.TEXTURE_3D, densityTexture);
      gl.uniform1i(at(traceProgram, 'u_density'), TEXTURE_UNITS.density);
      gl.uniform1i(at(traceProgram, 'u_volume'), TEXTURE_UNITS.volume);
      gl.uniform1i(at(traceProgram, 'u_bricks'), TEXTURE_UNITS.bricks);
      gl.uniform1i(at(traceProgram, 'u_palette'), TEXTURE_UNITS.palette);
      gl.uniform1i(at(traceProgram, 'u_materials'), TEXTURE_UNITS.materials);
      gl.uniform1i(at(traceProgram, 'u_ibl'), TEXTURE_UNITS.ibl);
      gl.uniform1i(at(traceProgram, 'u_previous'), TEXTURE_UNITS.previous);
      gl.uniform2f(at(traceProgram, 'u_resolution'), width, height);
      gl.uniform1f(at(traceProgram, 'u_sample'), samples);
      gl.uniform1f(at(traceProgram, 'u_seed'), Math.floor(Math.random() * 65536));
      gl.bindFramebuffer(gl.FRAMEBUFFER, accumulation[current].framebuffer);
      gl.viewport(0, 0, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      samples++;
      display(settings.film, settings.background.color, settings.show.transparent, options.bloom ? settings.bloom : null);
    },
  };
}
