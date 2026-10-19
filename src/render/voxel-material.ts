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
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SOLID_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

/** Onion skin: the previous frame, tinted blue and see-through. */
const GHOST_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(mix(vColor, vec3(0.35, 0.6, 1.0), 0.45), 0.3);
  }
`;

export function createVoxelMaterial() {
  const texels = new Uint8Array(PALETTE_SIZE * 4);
  const paletteTexture = new THREE.DataTexture(texels, PALETTE_SIZE, 1);
  const uniforms = { palette: { value: paletteTexture } };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX_SHADER, fragmentShader: SOLID_FRAGMENT });
  const ghostMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: GHOST_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });

  /** Texel i holds palette index i; the RGBA chunk stores index i at slot i - 1. */
  const setPalette = (palette: Uint8Array) => {
    texels.set(palette.subarray(0, (PALETTE_SIZE - 1) * 4), 4);
    paletteTexture.needsUpdate = true;
  };

  return { material, ghostMaterial, setPalette };
}
