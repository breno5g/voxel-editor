import * as THREE from 'three';
import { PALETTE_SIZE } from '../format/vox.ts';

/** Where the viewport sun comes from; the shadow camera looks back along it. */
export const SUN_DIRECTION = new THREE.Vector3(0.4243, -0.5657, 0.7071);

/** How much each occluding neighbour darkens a vertex (MagicaVoxel `rm_b_ao`). */
const OCCLUSION_STEP = 0.2;
/** Shadow lookups move this far along the face normal, so lit faces do not shadow themselves. */
const SHADOW_NORMAL_OFFSET = 0.3;

/**
 * Colour comes from a 256x1 palette texture indexed per vertex, so editing the palette never
 * touches geometry. Face ids follow the mesher: +X -X +Y -Y +Z -Z. Ambient (sky) and direct (sun)
 * light stay apart so the fragment shader can shadow only the sun part.
 */
const VERTEX_SHADER = /* glsl */ `
  attribute vec3 voxel;
  uniform sampler2D palette;
  uniform float occlusion;
  uniform float constantShading;
  uniform mat4 shadowMatrix;
  varying vec3 vAmbient;
  varying vec3 vDirect;
  varying float vOcclusion;
  varying vec4 vShadowCoord;
  varying vec3 vLocal;
  varying float vFace;

  const vec3 SUN_DIRECTION = vec3(${SUN_DIRECTION.toArray().join(', ')});

  vec3 faceNormal(float face) {
    int id = int(face + 0.5);
    if (id == 0) return vec3(1.0, 0.0, 0.0);
    if (id == 1) return vec3(-1.0, 0.0, 0.0);
    if (id == 2) return vec3(0.0, 1.0, 0.0);
    if (id == 3) return vec3(0.0, -1.0, 0.0);
    if (id == 4) return vec3(0.0, 0.0, 1.0);
    return vec3(0.0, 0.0, -1.0);
  }

  void main() {
    vec3 local = faceNormal(voxel.x);
    vec3 normal = normalize(mat3(modelMatrix) * local);
    vec3 albedo = texture2D(palette, vec2((voxel.y + 0.5) / ${PALETTE_SIZE}.0, 0.5)).rgb;
    float sky = 0.5 + 0.5 * normal.z;
    vAmbient = constantShading > 0.5 ? albedo : albedo * (0.3 + 0.3 * sky);
    vDirect = constantShading > 0.5 ? vec3(0.0) : albedo * 0.5 * max(dot(normal, SUN_DIRECTION), 0.0);
    vOcclusion = 1.0 - occlusion * ${OCCLUSION_STEP} * voxel.z;
    vShadowCoord = shadowMatrix * modelMatrix * vec4(position + local * ${SHADOW_NORMAL_OFFSET}, 1.0);
    vLocal = position;
    vFace = voxel.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 3x3 percentage-closer filter over the sun's depth map; outside the map everything is lit. */
const SHADOW_FUNCTION = /* glsl */ `
  uniform float shadows;
  uniform sampler2D shadowMap;
  uniform float shadowTexel;
  varying vec4 vShadowCoord;

  float sunVisibility() {
    if (shadows < 0.5) return 1.0;
    vec3 coord = vShadowCoord.xyz / vShadowCoord.w * 0.5 + 0.5;
    if (any(lessThan(coord, vec3(0.0))) || any(greaterThan(coord, vec3(1.0)))) return 1.0;
    float lit = 0.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) lit += step(coord.z, texture2D(shadowMap, coord.xy + vec2(x, y) * shadowTexel).r);
    }
    return lit / 9.0;
  }
`;

const EDGE_FUNCTION = /* glsl */ `
  varying vec3 vLocal;
  varying float vFace;

  float edgeLine() {
    int axis = int(vFace + 0.5) / 2;
    vec2 uv = axis == 0 ? vLocal.yz : axis == 1 ? vLocal.xz : vLocal.xy;
    vec2 pixels = min(fract(uv), 1.0 - fract(uv)) / fwidth(uv);
    return 1.0 - clamp(min(pixels.x, pixels.y), 0.0, 1.0);
  }
`;

/**
 * Every quad is exactly one voxel face, so the fractional local position spans 0..1
 * across it: the outline is where it nears 0 or 1 on the face's two in-plane axes.
 * `fade` blends background objects toward the viewport colour (MagicaVoxel `rm_b_fade`).
 */
const SOLID_FRAGMENT = /* glsl */ `
  uniform float edges;
  uniform vec3 edgeColor;
  uniform float fade;
  uniform vec3 fadeColor;
  varying vec3 vAmbient;
  varying vec3 vDirect;
  varying float vOcclusion;
  ${SHADOW_FUNCTION}
  ${EDGE_FUNCTION}

  void main() {
    vec3 lit = (vAmbient + vDirect * sunVisibility()) * vOcclusion;
    vec3 color = mix(lit, edgeColor, 0.45 * edges * edgeLine());
    gl_FragColor = vec4(mix(color, fadeColor, fade), 1.0);
  }
`;

/** Onion skin: the previous frame, tinted blue and see-through. */
const GHOST_FRAGMENT = /* glsl */ `
  varying vec3 vAmbient;
  varying vec3 vDirect;
  void main() {
    gl_FragColor = vec4(mix(vAmbient + vDirect, vec3(0.35, 0.6, 1.0), 0.45), 0.3);
  }
`;

/** Selected voxels: tinted toward the selection colour, outlined, drawn over their own faces. */
const SELECTION_FRAGMENT = /* glsl */ `
  uniform vec3 selectionColor;
  varying vec3 vAmbient;
  varying vec3 vDirect;
  ${EDGE_FUNCTION}

  void main() {
    vec3 tinted = mix(vAmbient + vDirect, mix(selectionColor, vec3(1.0), 0.5), 0.4);
    gl_FragColor = vec4(mix(tinted, selectionColor, edgeLine()), 1.0);
  }
`;

/** The ground under the scene: transparent, darkened only where the sun is blocked. */
const SHADOW_CATCHER_VERTEX = /* glsl */ `
  uniform mat4 shadowMatrix;
  varying vec4 vShadowCoord;
  void main() {
    vShadowCoord = shadowMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHADOW_CATCHER_FRAGMENT = /* glsl */ `
  ${SHADOW_FUNCTION}
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.35 * (1.0 - sunVisibility()));
  }
`;

const BACKGROUND_FADE = 0.6;

/** Viewport colours, as the shader expects them (raw sRGB components, written without colour management). */
const rawColor = (hex: string) => new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);

export function createVoxelMaterial() {
  const texels = new Uint8Array(PALETTE_SIZE * 4);
  const paletteTexture = new THREE.DataTexture(texels, PALETTE_SIZE, 1);
  const shadowMap: { value: THREE.Texture | null } = { value: null };
  const shadow = {
    shadows: { value: 0 },
    shadowMap,
    shadowMatrix: { value: new THREE.Matrix4() },
    shadowTexel: { value: 0 },
  };
  const shared = {
    ...shadow,
    palette: { value: paletteTexture },
    edges: { value: 0 },
    edgeColor: { value: new THREE.Color() },
    fadeColor: { value: new THREE.Color() },
    selectionColor: { value: new THREE.Color() },
    occlusion: { value: 0 },
    constantShading: { value: 0 },
  };
  const solid = (fade: number) =>
    new THREE.ShaderMaterial({ uniforms: { ...shared, fade: { value: fade } }, vertexShader: VERTEX_SHADER, fragmentShader: SOLID_FRAGMENT });
  const ghostMaterial = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: VERTEX_SHADER,
    fragmentShader: GHOST_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });

  const selectionMaterial = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: VERTEX_SHADER,
    fragmentShader: SELECTION_FRAGMENT,
    depthFunc: THREE.LessEqualDepth,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const shadowCatcherMaterial = new THREE.ShaderMaterial({
    uniforms: shadow,
    vertexShader: SHADOW_CATCHER_VERTEX,
    fragmentShader: SHADOW_CATCHER_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });

  /** Texel i holds palette index i; the RGBA chunk stores index i at slot i - 1. */
  const setPalette = (palette: Uint8Array) => {
    texels.set(palette.subarray(0, (PALETTE_SIZE - 1) * 4), 4);
    paletteTexture.needsUpdate = true;
  };

  return {
    material: solid(0),
    backgroundMaterial: solid(BACKGROUND_FADE),
    ghostMaterial,
    selectionMaterial,
    shadowCatcherMaterial,
    setPalette,
    setStyle(style: { edges: boolean; ao: boolean; constant: boolean; background: string; edge: string; selection: string }) {
      shared.edges.value = style.edges ? 1 : 0;
      shared.occlusion.value = style.ao ? 1 : 0;
      shared.constantShading.value = style.constant ? 1 : 0;
      shared.fadeColor.value.copy(rawColor(style.background));
      shared.edgeColor.value.copy(rawColor(style.edge));
      shared.selectionColor.value.copy(rawColor(style.selection));
    },
    /** The sun's depth map and the matrix from world space to its clip space; null map turns shadows off. */
    setShadow(map: THREE.Texture | null, matrix: THREE.Matrix4, mapSize: number) {
      shadow.shadows.value = map ? 1 : 0;
      shadow.shadowMap.value = map;
      shadow.shadowMatrix.value.copy(matrix);
      shadow.shadowTexel.value = 1 / mapSize;
    },
  };
}
