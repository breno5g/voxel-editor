import * as THREE from 'three';
import { PALETTE_SIZE } from '../format/vox.ts';

/**
 * Colour comes from a 256x1 palette texture indexed per vertex, so editing the
 * palette never touches geometry. Face ids follow the mesher: +X -X +Y -Y +Z -Z.
 */
const VERTEX_SHADER = /* glsl */ `
  attribute vec2 voxel;
  uniform sampler2D palette;
  varying vec3 vColor;
  varying vec3 vLocal;
  varying float vFace;

  const vec3 SUN_DIRECTION = vec3(0.4243, -0.5657, 0.7071);

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
    vec3 normal = normalize(mat3(modelMatrix) * faceNormal(voxel.x));
    vec3 albedo = texture2D(palette, vec2((voxel.y + 0.5) / ${PALETTE_SIZE}.0, 0.5)).rgb;
    float sun = max(dot(normal, SUN_DIRECTION), 0.0);
    float sky = 0.5 + 0.5 * normal.z;
    vColor = albedo * (0.3 + 0.3 * sky + 0.5 * sun);
    vLocal = position;
    vFace = voxel.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Every quad is exactly one voxel face, so the fractional local position spans 0..1
 * across it: the outline is where it nears 0 or 1 on the face's two in-plane axes.
 * `fade` blends background objects toward the viewport colour (MagicaVoxel `rm_b_fade`).
 */
const SOLID_FRAGMENT = /* glsl */ `
  uniform float edges;
  uniform float fade;
  uniform vec3 fadeColor;
  varying vec3 vColor;
  varying vec3 vLocal;
  varying float vFace;

  float edgeLine() {
    int axis = int(vFace + 0.5) / 2;
    vec2 uv = axis == 0 ? vLocal.yz : axis == 1 ? vLocal.xz : vLocal.xy;
    vec2 pixels = min(fract(uv), 1.0 - fract(uv)) / fwidth(uv);
    return 1.0 - clamp(min(pixels.x, pixels.y), 0.0, 1.0);
  }

  void main() {
    vec3 color = mix(vColor, vColor * 0.55, edges * edgeLine());
    gl_FragColor = vec4(mix(color, fadeColor, fade), 1.0);
  }
`;

/** Onion skin: the previous frame, tinted blue and see-through. */
const GHOST_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(mix(vColor, vec3(0.35, 0.6, 1.0), 0.45), 0.3);
  }
`;

/** Selected voxels: tinted toward the selection colour, outlined, drawn over their own faces. */
const SELECTION_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vLocal;
  varying float vFace;

  float edgeLine() {
    int axis = int(vFace + 0.5) / 2;
    vec2 uv = axis == 0 ? vLocal.yz : axis == 1 ? vLocal.xz : vLocal.xy;
    vec2 pixels = min(fract(uv), 1.0 - fract(uv)) / fwidth(uv);
    return 1.0 - clamp(min(pixels.x, pixels.y), 0.0, 1.0);
  }

  void main() {
    vec3 tinted = mix(vColor, vec3(1.0, 0.86, 0.6), 0.4);
    gl_FragColor = vec4(mix(tinted, vec3(1.0, 0.67, 0.2), edgeLine()), 1.0);
  }
`;

const BACKGROUND_FADE = 0.6;

export function createVoxelMaterial(background: THREE.Color) {
  const texels = new Uint8Array(PALETTE_SIZE * 4);
  const paletteTexture = new THREE.DataTexture(texels, PALETTE_SIZE, 1);
  const shared = {
    palette: { value: paletteTexture },
    edges: { value: 0 },
    fadeColor: { value: background },
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
    setPalette,
    setEdges: (visible: boolean) => (shared.edges.value = visible ? 1 : 0),
  };
}
