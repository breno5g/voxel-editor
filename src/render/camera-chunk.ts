import type { Dict, Vec3 } from '../format/vox.ts';
import { cameraAngles, clampFov, DEFAULT_FOV, eyeDirection, halfTan, isCameraMode } from './camera-rig.ts';
import type { CameraState } from './camera-rig.ts';


const numbers = (text: string | undefined, count: number): number[] | null => {
  const values = (text ?? '').trim().split(/\s+/).map(Number);
  return values.length === count && values.every(Number.isFinite) ? values : null;
};
const formatNumber = (value: number) => String(Number(value.toPrecision(6)));
const formatVec3 = (values: readonly number[]) => values.map(formatNumber).join(' ');

/**
 * A camera slot as MagicaVoxel writes it to rCAM. `_frustum` is `tan(fov / 2)` for the perspective
 * cameras and the visible half height for `orth` and `iso` (as files saved by MagicaVoxel show).
 */
export function cameraToDict(camera: CameraState): Dict {
  const offset: Vec3 = [camera.position[0] - camera.target[0], camera.position[1] - camera.target[1], camera.position[2] - camera.target[2]];
  const orthographic = camera.mode === 'orth' || camera.mode === 'iso';
  return new Map([
    ['_mode', camera.mode],
    ['_focus', formatVec3(camera.target)],
    ['_angle', formatVec3([...cameraAngles(offset), 0])],
    ['_radius', formatNumber(Math.hypot(...offset))],
    ['_frustum', formatNumber(orthographic ? camera.height / camera.zoom : halfTan(camera.fov))],
    ['_fov', formatNumber(camera.fov)],
  ]);
}

/** The camera stored in an rCAM slot, or null for MagicaVoxel's empty slots (radius 0) and unknown modes. */
export function cameraFromDict(attrs: Dict): CameraState | null {
  const mode = attrs.get('_mode');
  const target = numbers(attrs.get('_focus'), 3);
  const angle = numbers(attrs.get('_angle'), 3);
  const radius = Number(attrs.get('_radius'));
  const frustum = Number(attrs.get('_frustum'));
  const fov = clampFov(Number(attrs.get('_fov')) || DEFAULT_FOV);
  if (!isCameraMode(mode) || !target || !angle || !(radius > 0)) return null;
  const direction = eyeDirection(angle[0], angle[1]);
  const orthographic = mode === 'orth' || mode === 'iso';
  return {
    mode,
    target: [target[0], target[1], target[2]],
    position: [target[0] + direction[0] * radius, target[1] + direction[1] * radius, target[2] + direction[2] * radius],
    zoom: 1,
    height: orthographic && frustum > 0 ? frustum : radius * halfTan(fov),
    fov,
  };
}
