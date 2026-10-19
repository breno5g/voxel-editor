import * as THREE from 'three';
import { ENVIRONMENTS, PROJECTIONS } from '../../format/render-settings.ts';
import type { RenderSettings } from '../../format/render-settings.ts';
import { PALETTE_BYTES, PALETTE_SIZE } from '../../format/vox.ts';
import type { Vec3 } from '../../format/vox.ts';
import { linkFullScreenProgram } from '../gl-program.ts';
import { collectEmitterFaces, emitterPower, FACE_NORMALS, sampleEmitter } from './emitter-faces.ts';
import type { EmitterFaces } from './emitter-faces.ts';
import { sphereLuminance } from './hdr-image.ts';
import type { HdrImage } from './hdr-image.ts';
import { MATERIAL_KIND, MATERIAL_ROWS } from './material-table.ts';
import { BLOOM_BLUR_FRAGMENT, BLOOM_DOWNSAMPLE, BLOOM_EXTRACT_FRAGMENT, DENOISE_FRAGMENT, DISPLAY_FRAGMENT, pathTraceFragment } from './path-trace-shader.ts';
import { dilateBricks, shapeDensity } from './scene-volume.ts';
import type { SceneVolume } from './scene-volume.ts';

export type PathTracer = ReturnType<typeof createPathTracer>;
/** The camera to trace from and the distance along its view where the lens focuses. */
export type TraceView = { camera: THREE.Camera; focusDistance: number };
/** Options that only live while rendering (MagicaVoxel keeps them out of the file). */
export type TraceOptions = {
  shadows: boolean;
  translucentShadows: boolean;
  antialias: boolean;
  pixelated: boolean;
  /** `pt_mis_ggx`: the sun in reflections, sampled both ways and weighed. */
  misReflect: boolean;
  /** `pt_mis_cloud`: the same for fog and media. */
  misScatter: boolean;
  /** `pt_jit`: each pixel samples on its own; off, they share one draw per sample (smooth, banded noise). */
  stochastic: boolean;
  shape: VoxelShape;
  bloom: boolean;
  denoise: boolean;
};
/** MagicaVoxel's `pt_prim`: how each voxel is drawn. */
export const VOXEL_SHAPES = ['cube', 'lego', 'mc', 'clay', 'sphr', 'cyli'] as const;
export type VoxelShape = (typeof VOXEL_SHAPES)[number];

/** Samples per pixel after which the image is left as it is. */
export const MAX_SAMPLES = 2048;
/** How far behind an orthographic camera its rays start, so nothing in front of the scene is cut. */
const ORTHOGRAPHIC_PULLBACK = 10000;
/* MagicaVoxel's scales, as its uniform setup computes them (docs/magicavoxel-re.md §8). */
/** `_area` 1 is a sun 20° in radius. */
const SUN_AREA_ANGLE = THREE.MathUtils.degToRad(20);
/** `_inf _i` 1 is a sun of this strength; twice that under the atmosphere, which dims it. */
const SUN_SCALE = 5;
/** `_fog_uni _d`: extinction per 1000 voxels. */
const FOG_SCALE = 0.001;
/** `_ground _hor`: the ground's extinction per voxel of distance. */
const HORIZON_SCALE = 0.0005;
// ponytail: MagicaVoxel passes `_aperture`·0.03; reading it as relative to the focus distance is inferred.
/** `_lens _aperture`: lens radius as a fraction of the focus distance. */
const APERTURE_SCALE = 0.03;
/** `_bloom _mix` 1 adds this much of the blurred glow. */
const BLOOM_MIX_SCALE = 0.7;
/** `_atm`: each coefficient is colour · (10^(1.5·d) − 1) · scale. */
const AIR_SCALE = { rayleigh: 0.05, mie: 1 / 300, ozone: 0.05 };
// ponytail: MagicaVoxel's planet (radius 10000) and air profile live in its encoded shader; this depth keeps the default sky.
/** Air masses of the uniform stand-in atmosphere per unit of coefficient. */
const AIR_DEPTH = 5;

/** Units for the trace pass, then for the bloom and display passes (which bind only 2D textures). */
const TEXTURE_UNITS = { volume: 0, bricks: 1, palette: 2, materials: 3, ibl: 4, previous: 5, density: 6, previousNormal: 7, accumulation: 0, bloom: 1, albedo: 1, normal: 2 } as const;
/** Samples of first-hit albedo and normal the denoiser averages (anti-aliased edges). */
const GUIDE_SAMPLES = 8;
/** À-trous passes: taps 1, 2, 4, 8 and 16 pixels apart. */
const DENOISE_PASSES = 5;
/** Colour difference (squared) the first pass tolerates; each pass halves it. */
const DENOISE_COLOR_SIGMA = 0.8;
/** Clay is occupancy blurred this many times; marching cubes uses it as is. */
const CLAY_BLUR_PASSES = 2;

/** An 8-bit colour in linear light, by the film's gamma as MagicaVoxel does for every colour it lights with. */
const linear = (color: Vec3, gamma: number): Vec3 => [Math.pow(color[0] / 255, gamma), Math.pow(color[1] / 255, gamma), Math.pow(color[2] / 255, gamma)];
const unit = (color: Vec3): Vec3 => [Math.min(color[0] / 255, 1), Math.min(color[1] / 255, 1), Math.min(color[2] / 255, 1)];
/** An `_atm` scattering coefficient from its colour and density slider. */
const airCoefficient = (color: Vec3, density: number, scale: number) => scaled(unit(color), (Math.pow(10, 1.5 * density) - 1) * scale * AIR_DEPTH);
const scaled = (color: Vec3, factor: number): Vec3 => [color[0] * factor, color[1] * factor, color[2] * factor];
const radians = THREE.MathUtils.degToRad;
/** `_setting _scale`: the world size of a voxel, kept away from zero. */
const voxelScale = ({ scale }: RenderSettings['show']): Vec3 => [Math.max(scale[0], 1e-3), Math.max(scale[1], 1e-3), Math.max(scale[2], 1e-3)];
/** Materials light passes through, so an emitter face against them still shines out. */
const CLEAR_KINDS = new Set([MATERIAL_KIND._glass, MATERIAL_KIND._blend, MATERIAL_KIND._media]);

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

  const tracePrograms = new Map<string, WebGLProgram>();
  const traceProgramFor = (shape: VoxelShape, guide = false) => {
    const key = `${shape}:${guide}`;
    const program = tracePrograms.get(key) ?? linkFullScreenProgram(gl, pathTraceFragment(VOXEL_SHAPES.indexOf(shape), guide));
    tracePrograms.set(key, program);
    return program;
  };
  const denoiseProgram = linkFullScreenProgram(gl, DENOISE_FRAGMENT);
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
  /** The denoiser's guides (first-hit albedo and normal, ping-ponged) and its filter's ping-pong. */
  const guideTargets = [0, 1].map(() => {
    const target = { albedo: createTexture(gl.TEXTURE_2D), normal: createTexture(gl.TEXTURE_2D), framebuffer: gl.createFramebuffer() };
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    return target;
  });
  const denoiseTargets = [0, 1].map(() => ({ texture: createTexture(gl.TEXTURE_2D), framebuffer: gl.createFramebuffer() }));
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
    const attach = (texture: WebGLTexture, format: GLenum, type: GLenum, attachment: GLenum = gl.COLOR_ATTACHMENT0) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, type, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture, 0);
    };
    guideTargets.forEach(({ albedo, normal, framebuffer }) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      attach(albedo, gl.RGBA16F, gl.HALF_FLOAT);
      attach(normal, gl.RGBA16F, gl.HALF_FLOAT, gl.COLOR_ATTACHMENT1);
    });
    denoiseTargets.forEach(({ texture, framebuffer }) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      attach(texture, gl.RGBA32F, gl.FLOAT);
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
  /** Palette texels and the material table as uploaded, read again on the CPU to find area lights. */
  let paletteTexels = new Uint8Array(PALETTE_BYTES);
  let materials: Float32Array = new Float32Array(PALETTE_SIZE * MATERIAL_ROWS * 4);
  /** Area-light faces of the current volume and materials, rebuilt when either changes. */
  let emitters: EmitterFaces | null = null;
  /** Each emitter group's running power, the radiance per palette index behind it, and its world scale. */
  let emitterCumulative: Float64Array = new Float64Array(0);
  const emitterRadiance = new Float32Array(PALETTE_SIZE * 3);
  let emitterScale: Vec3 = [1, 1, 1];
  let settings: RenderSettings | null = null;
  let options: TraceOptions = { shadows: true, translucentShadows: true, antialias: true, pixelated: false, misReflect: true, misScatter: true, stochastic: true, shape: 'cube', bloom: false, denoise: false };
  let hasIbl = false;
  /** ∫ luminance dω of the loaded map, which its intensity is normalized by. */
  let iblLuminance = 0;
  let samples = 0;
  let current = 0;
  let lastView = '';
  /** The image on screen: the running mean, or its denoised copy until the next sample. */
  let shown: WebGLTexture | null = null;
  let guidesReady = false;
  const reset = () => {
    samples = 0;
    shown = null;
    guidesReady = false;
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
    const { sun, sky, ibl, atmosphere, fog, lens, ground, edge, grid, show, bounce, film } = active;
    const gamma = Math.max(film.gamma, 0.1);
    const lit = (color: Vec3) => linear(color, gamma);
    const uniform3 = (name: string, value: Vec3) => gl.uniform3fv(at(traceProgram, name), value);
    const uniform1 = (name: string, value: number) => gl.uniform1f(at(traceProgram, name), value);
    const uniformInt = (name: string, value: number | boolean) => gl.uniform1i(at(traceProgram, name), Number(value));
    const [pitch, yaw] = [radians(sun.pitch), radians(sun.yaw)];
    uniform3('u_sunDirection', [Math.cos(pitch) * Math.sin(yaw), -Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch)]);
    uniform3('u_sunRadiance', scaled(lit(sun.color), sun.intensity * SUN_SCALE * (active.environment === 'atmosphere' ? 2 : 1)));
    uniform1('u_sunCos', Math.cos(Math.min(sun.area, 1) * SUN_AREA_ANGLE));
    uniformInt('u_sunDisk', sun.disk);
    uniformInt('u_environment', ENVIRONMENTS.indexOf(active.environment));
    uniform3('u_sky', scaled(lit(sky.color), sky.intensity));
    /* MagicaVoxel normalizes the map: intensity 1 is a mean radiance of 1, whatever the file's exposure. */
    uniform1('u_iblIntensity', iblLuminance > 0 ? (ibl.intensity * 4 * Math.PI) / iblLuminance : ibl.intensity);
    gl.uniformMatrix3fv(at(traceProgram, 'u_iblRotation'), false, new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(-radians(ibl.yaw))).elements);
    uniformInt('u_hasIbl', hasIbl);
    /* Scattering colours are coefficients, not sRGB: the default Rayleigh 45 104 255 is the physical β ratio. */
    uniform3('u_rayleigh', airCoefficient(atmosphere.rayleighColor, atmosphere.rayleigh, AIR_SCALE.rayleigh));
    uniform3('u_mie', airCoefficient(atmosphere.mieColor, atmosphere.mie, AIR_SCALE.mie));
    uniform1('u_miePhase', atmosphere.miePhase);
    uniform3('u_ozone', airCoefficient(atmosphere.ozoneColor, atmosphere.ozone, AIR_SCALE.ozone));
    uniform1('u_fogDensity', fog.density * FOG_SCALE);
    /* Fog's colour is its scattering albedo, taken as is. */
    uniform3('u_fogColor', unit(fog.color));
    uniform1('u_fogPhase', fog.phase);
    uniformInt('u_ground', show.ground);
    uniform3('u_groundColor', lit(ground.color));
    uniform1('u_horizon', ground.horizon * HORIZON_SCALE);
    uniformInt('u_flatBackground', show.backgroundColor || show.transparent);
    uniformInt('u_edges', show.edge);
    uniform3('u_edgeColor', lit(edge.color));
    uniform1('u_edgeWidth', edge.width);
    uniformInt('u_grid', show.grid);
    uniform3('u_gridColor', lit(grid.color));
    uniform1('u_gamma', gamma);
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
    const scale = voxelScale(show);
    uniform3('u_scale', scale);
    uniform3('u_origin', volume ? [volume.origin[0] * scale[0], volume.origin[1] * scale[1], volume.origin[2] * scale[2]] : [0, 0, 0]);
    gl.uniform3iv(at(traceProgram, 'u_size'), volume?.size ?? [1, 1, 1]);
    uniformInt('u_hasVolume', volume !== null);
  };

  const bind = (unit: number, target: GLenum, texture: WebGLTexture | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, texture);
  };

  /** Makes `program` current with every input a sample reads but the previous mean; returns the view's key. */
  const prepareTrace = (program: WebGLProgram, view: TraceView, active: RenderSettings) => {
    traceProgram = program;
    gl.useProgram(program);
    const viewKey = applyCamera(view, active.lens);
    applySettings(active);
    weighEmitters(active);
    gl.uniform1i(at(program, 'u_shadows'), Number(options.shadows));
    gl.uniform1i(at(program, 'u_translucentShadows'), Number(options.translucentShadows));
    gl.uniform1i(at(program, 'u_misReflect'), Number(options.misReflect));
    gl.uniform1i(at(program, 'u_misScatter'), Number(options.misScatter));
    gl.uniform1i(at(program, 'u_stochastic'), Number(options.stochastic));
    gl.uniform1i(at(program, 'u_antialias'), Number(options.antialias));
    gl.uniform1i(at(program, 'u_pixelated'), Number(options.pixelated));
    gl.uniform1f(at(program, 'u_cell'), Math.min(Math.max(active.show.cell, 0.01), 1));
    bind(TEXTURE_UNITS.volume, gl.TEXTURE_3D, volumeTexture);
    bind(TEXTURE_UNITS.bricks, gl.TEXTURE_3D, bricksTexture);
    bind(TEXTURE_UNITS.palette, gl.TEXTURE_2D, paletteTexture);
    bind(TEXTURE_UNITS.materials, gl.TEXTURE_2D, materialsTexture);
    bind(TEXTURE_UNITS.ibl, gl.TEXTURE_2D, iblTexture);
    bind(TEXTURE_UNITS.density, gl.TEXTURE_3D, densityTexture);
    const units: [string, number][] = [['u_volume', TEXTURE_UNITS.volume], ['u_bricks', TEXTURE_UNITS.bricks], ['u_palette', TEXTURE_UNITS.palette], ['u_materials', TEXTURE_UNITS.materials], ['u_ibl', TEXTURE_UNITS.ibl], ['u_density', TEXTURE_UNITS.density], ['u_previous', TEXTURE_UNITS.previous]];
    units.forEach(([name, unit]) => gl.uniform1i(at(program, name), unit));
    gl.uniform2f(at(program, 'u_resolution'), width, height);
    return viewKey;
  };

  /**
   * MagicaVoxel's area lights (***REMOVED***): the faces of `_emit` voxels with `_flux` above 0, each
   * group (palette index, direction) weighed by its faces' power under the current colours and scale.
   */
  const weighEmitters = (active: RenderSettings) => {
    if (!volume) {
      emitterCumulative = new Float64Array(0);
      gl.uniform1f(at(traceProgram, 'u_emitterPower'), 0);
      return;
    }
    const kind = (index: number) => materials[index * 4];
    const areaLight = (index: number) => kind(index) === MATERIAL_KIND._emit && materials[index * 4 + 2] > 0.5;
    const flags = (test: (index: number) => boolean) => Uint8Array.from({ length: PALETTE_SIZE }, (_, index) => Number(index > 0 && test(index)));
    emitters ??= collectEmitterFaces(volume, flags(areaLight), flags((index) => CLEAR_KINDS.has(kind(index))));
    const gamma = Math.max(active.film.gamma, 0.1);
    for (let index = 0; index < PALETTE_SIZE; index++) {
      const emission = areaLight(index) ? materials[(PALETTE_SIZE + index) * 4 + 1] : 0;
      for (let channel = 0; channel < 3; channel++) emitterRadiance[index * 3 + channel] = Math.pow(paletteTexels[index * 4 + channel] / 255, gamma) * emission;
    }
    emitterScale = voxelScale(active.show);
    emitterCumulative = emitterPower(emitters, emitterRadiance, emitterScale);
    gl.uniform1f(at(traceProgram, 'u_emitterPower'), emitterCumulative.at(-1) ?? 0);
  };

  /** Picks the emitter face this sample lights by, as MagicaVoxel's ***REMOVED*** does once per pass. */
  const pickEmitter = () => {
    const sample = emitters && volume ? sampleEmitter(emitters, emitterCumulative, Math.random(), Math.random()) : null;
    gl.uniform1i(at(traceProgram, 'u_hasArea'), Number(sample !== null));
    if (!sample || !volume) return;
    const { cell, index, face } = sample;
    const { size, origin } = volume;
    const coordinate: Vec3 = [cell % size[0], Math.floor(cell / size[0]) % size[1], Math.floor(cell / (size[0] * size[1]))];
    const axis = face >> 1;
    const [sx, sy, sz] = emitterScale;
    /* A face on the cell's far side sits one voxel further along its axis. */
    const far = (along: number) => Number(along === axis && (face & 1) === 1);
    const corner: Vec3 = [(coordinate[0] + origin[0] + far(0)) * sx, (coordinate[1] + origin[1] + far(1)) * sy, (coordinate[2] + origin[2] + far(2)) * sz];
    const edge = (along: number): Vec3 => [along === 0 ? sx : 0, along === 1 ? sy : 0, along === 2 ? sz : 0];
    const radiance: Vec3 = [emitterRadiance[index * 3], emitterRadiance[index * 3 + 1], emitterRadiance[index * 3 + 2]];
    gl.uniform3fv(at(traceProgram, 'u_areaCorner'), corner);
    gl.uniform3fv(at(traceProgram, 'u_areaEdgeU'), edge((axis + 1) % 3));
    gl.uniform3fv(at(traceProgram, 'u_areaEdgeV'), edge((axis + 2) % 3));
    gl.uniform3fv(at(traceProgram, 'u_areaNormal'), FACE_NORMALS[face]);
    gl.uniform3iv(at(traceProgram, 'u_areaCell'), coordinate);
    gl.uniform3fv(at(traceProgram, 'u_areaRadiance'), radiance);
    gl.uniform1f(at(traceProgram, 'u_areaDensity'), Math.max(...radiance) / (emitterCumulative.at(-1) ?? 1));
  };

  /** Traces sample number `index` of the current program into `framebuffer`. */
  const drawSample = (index: number, framebuffer: WebGLFramebuffer | null) => {
    pickEmitter();
    gl.uniform1f(at(traceProgram, 'u_sample'), index);
    gl.uniform1f(at(traceProgram, 'u_seed'), Math.floor(Math.random() * 65536));
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** Blurs what the exposure lifts above the threshold into the first bloom target. */
  const blurBloom = (source: WebGLTexture, exposure: number, { scale, aspect, threshold }: RenderSettings['bloom']) => {
    const [first, second] = bloomTargets;
    gl.viewport(0, 0, bloomWidth, bloomHeight);
    gl.useProgram(extractProgram);
    bind(TEXTURE_UNITS.accumulation, gl.TEXTURE_2D, source);
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

  const display = (active: RenderSettings) => {
    const source = shown ?? accumulation[current].texture;
    const { film, bloom } = active;
    if (options.bloom) blurBloom(source, film.exposure, bloom);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(displayProgram);
    bind(TEXTURE_UNITS.accumulation, gl.TEXTURE_2D, source);
    bind(TEXTURE_UNITS.bloom, gl.TEXTURE_2D, bloomTargets[0].texture);
    gl.uniform1i(at(displayProgram, 'u_accumulation'), TEXTURE_UNITS.accumulation);
    gl.uniform1i(at(displayProgram, 'u_bloom'), TEXTURE_UNITS.bloom);
    gl.uniform1f(at(displayProgram, 'u_bloomMix'), options.bloom ? bloom.mix * BLOOM_MIX_SCALE : 0);
    gl.uniform2f(at(displayProgram, 'u_resolution'), width, height);
    gl.uniform1f(at(displayProgram, 'u_exposure'), film.exposure);
    gl.uniform1i(at(displayProgram, 'u_aces'), Number(film.aces));
    gl.uniform1f(at(displayProgram, 'u_gamma'), film.gamma);
    gl.uniform1f(at(displayProgram, 'u_vignette'), film.vignette);
    gl.uniform1i(at(displayProgram, 'u_transparent'), Number(active.show.transparent));
    gl.uniform3fv(at(displayProgram, 'u_background'), scaled(active.background.color, 1 / 255));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** Traces the first-hit albedo and normal for the current view; kept until the next reset. */
  const traceGuides = (view: TraceView, active: RenderSettings) => {
    prepareTrace(traceProgramFor(options.shape, true), view, active);
    gl.uniform1i(at(traceProgram, 'u_previousNormal'), TEXTURE_UNITS.previousNormal);
    for (let sample = 0; sample < GUIDE_SAMPLES; sample++) {
      bind(TEXTURE_UNITS.previous, gl.TEXTURE_2D, guideTargets[sample % 2].albedo);
      bind(TEXTURE_UNITS.previousNormal, gl.TEXTURE_2D, guideTargets[sample % 2].normal);
      drawSample(sample, guideTargets[1 - (sample % 2)].framebuffer);
    }
    guidesReady = true;
  };

  /**
   * MagicaVoxel's Denoise: the running mean filtered by the à-trous passes, guided by the first hit's
   * albedo and normal; returns the filtered texture.
   */
  const denoised = (view: TraceView, active: RenderSettings) => {
    if (!guidesReady) traceGuides(view, active);
    const guide = guideTargets[GUIDE_SAMPLES % 2];
    gl.useProgram(denoiseProgram);
    gl.viewport(0, 0, width, height);
    bind(TEXTURE_UNITS.albedo, gl.TEXTURE_2D, guide.albedo);
    bind(TEXTURE_UNITS.normal, gl.TEXTURE_2D, guide.normal);
    gl.uniform1i(at(denoiseProgram, 'u_color'), TEXTURE_UNITS.accumulation);
    gl.uniform1i(at(denoiseProgram, 'u_albedo'), TEXTURE_UNITS.albedo);
    gl.uniform1i(at(denoiseProgram, 'u_normal'), TEXTURE_UNITS.normal);
    let source = accumulation[current].texture;
    for (let pass = 0; pass < DENOISE_PASSES; pass++) {
      const target = denoiseTargets[pass % 2];
      bind(TEXTURE_UNITS.accumulation, gl.TEXTURE_2D, source);
      gl.uniform1i(at(denoiseProgram, 'u_step'), 1 << pass);
      gl.uniform1f(at(denoiseProgram, 'u_colorSigma'), DENOISE_COLOR_SIGMA / (1 << pass));
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      source = target.texture;
    }
    return source;
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
      emitters = null;
      if (next) upload3d(volumeTexture, next.size, next.voxels);
      uploadShape();
      reset();
    },

    /** RGBA palette bytes; palette index i is texel i, so slot i - 1 of the chunk. */
    setPalette(palette: Uint8Array) {
      const texels = new Uint8Array(PALETTE_BYTES);
      texels.set(palette.subarray(0, PALETTE_BYTES - 4), 4);
      paletteTexels = texels;
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texels);
      reset();
    },

    setMaterials(table: Float32Array) {
      gl.bindTexture(gl.TEXTURE_2D, materialsTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PALETTE_SIZE, MATERIAL_ROWS, 0, gl.RGBA, gl.FLOAT, table);
      materials = table;
      emitters = null;
      reset();
    },

    setIbl(image: HdrImage | null) {
      uploadIbl(image);
      hasIbl = image !== null;
      iblLuminance = image ? sphereLuminance(image) : 0;
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
      const viewKey = prepareTrace(traceProgramFor(options.shape), view, settings);
      if (viewKey !== lastView && !moving) reset();
      lastView = viewKey;
      if (samples >= MAX_SAMPLES) return;
      const previous = current;
      current = 1 - current;
      bind(TEXTURE_UNITS.previous, gl.TEXTURE_2D, accumulation[previous].texture);
      drawSample(samples, accumulation[current].framebuffer);
      samples++;
      shown = options.denoise ? denoised(view, settings) : null;
      display(settings);
    },


  };
}
