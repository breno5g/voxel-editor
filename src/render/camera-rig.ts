import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../format/vox.ts';

/** MagicaVoxel `cam_mode`, in its order; the names are rCAM's `_mode` values. */
export const CAMERA_MODES = ['pers', 'free', 'orth', 'iso'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export const isCameraMode = (value: unknown): value is CameraMode => CAMERA_MODES.some((mode) => mode === value);

/** What the wheel zooms toward: the voxel under the cursor, or the focus like MagicaVoxel. */
export const WHEEL_ZOOMS = ['cursor', 'focus'] as const;
export type WheelZoom = (typeof WHEEL_ZOOMS)[number];
export const isWheelZoom = (value: unknown): value is WheelZoom => WHEEL_ZOOMS.some((zoom) => zoom === value);

/** `roll` is MagicaVoxel's `_angle` z in degrees: a turn of the view about its own axis. */
export type CameraState = { mode: CameraMode; target: Vec3; position: Vec3; zoom: number; height: number; fov: number; roll: number };
export type CameraDrag = 'pan' | 'zoom' | 'rotate';

const DRAG_ACTIONS: Record<CameraDrag, THREE.MOUSE> = { pan: THREE.MOUSE.PAN, zoom: THREE.MOUSE.DOLLY, rotate: THREE.MOUSE.ROTATE };
export type CameraRig = ReturnType<typeof createCameraRig>;

/** MagicaVoxel `cam_fov`: 45° by default, 30–90° in its camera panel. */
export const DEFAULT_FOV = 45;
export const clampFov = (fov: number) => THREE.MathUtils.clamp(fov, 30, 90);
export const halfTan = (fov: number) => Math.tan(THREE.MathUtils.degToRad(fov / 2));
const DEGREES = 180 / Math.PI;
const FRAMING_DISTANCE = 3;
/** Polar angle from +Z of a true isometric view: MagicaVoxel snaps the pitch to ±35.264° (atan(1/√2)). */
const ISO_POLAR = Math.PI / 2 - Math.atan(1 / Math.SQRT2);
const UP = new THREE.Vector3(0, 0, 1);
const FACE_DIRECTIONS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

const toVec3 = (vector: THREE.Vector3): Vec3 => [vector.x, vector.y, vector.z];

/** MagicaVoxel's wheel step: 10 × the zoom speed, 0.01 for orbit cameras and 1 for the free one. */
const FOCUS_ZOOM_STEP = 0.1;
const FREE_ZOOM_STEP = 10;
const MIN_ZOOM_EXTENT = 0.001;
/** Free camera mouse look: radians per dragged pixel, and how close to straight up or down it may pitch. */
const LOOK_SPEED = 0.005;
const LOOK_POLAR_MARGIN = 0.01;
const RIGHT_BUTTON = 2;
/** Wheel delta per notch for each `WheelEvent.deltaMode` (pixels, lines, pages), as OrbitControls reads it. */
const WHEEL_NOTCH = [100, 3, 1];

/**
 * MagicaVoxel's perspective zoom: `radius + 1` scales by `e^-amount`, so unlike a
 * plain `radius · factor` it reaches the focus in a few steps instead of slowing down forever.
 */
export const focusZoomRadius = (radius: number, amount: number) => Math.max((radius + 1) * Math.exp(-amount) - 1, MIN_ZOOM_EXTENT);
/** Its orthographic and isometric zoom: the view extent scales linearly. */
export const focusZoomExtent = (extent: number, amount: number) => Math.max(extent * (1 - amount), MIN_ZOOM_EXTENT);

/**
 * Unit vector from the focus to the eye for rCAM `_angle` `(ax, ay)` in degrees. MagicaVoxel builds
 * `R = M0 · Ry(ay) · Rx(ax) · Rz(az)` with `M0 = [1 0 0; 0 0 -1; 0 1 0]` (`UI_3DView` constructor) and puts
 * the eye at `focus + radius · R·ẑ`; roll (`az`) does not move the eye.
 */
export function eyeDirection(ax: number, ay: number): Vec3 {
  const [pitch, yaw] = [ax / DEGREES, ay / DEGREES];
  return [Math.cos(pitch) * Math.sin(yaw), -Math.cos(pitch) * Math.cos(yaw), -Math.sin(pitch)];
}

/** rCAM `_angle` `(ax, ay)` in degrees for a focus-to-eye direction (the inverse of {@link eyeDirection}). */
export function cameraAngles([x, y, z]: Vec3): [number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [-Math.asin(Math.max(-1, Math.min(1, z / length))) * DEGREES, Math.atan2(x, -y) * DEGREES];
}

/**
 * Free camera look: the target turned about the eye, `yaw` around the vertical (positive turns right)
 * and `pitch` down (positive) or up, never past straight up or down; its distance is kept.
 */
export function turnedTarget(eye: THREE.Vector3, target: THREE.Vector3, yaw: number, pitch: number): THREE.Vector3 {
  const direction = target.clone().sub(eye).applyAxisAngle(UP, -yaw);
  const polar = direction.angleTo(UP);
  const nextPolar = THREE.MathUtils.clamp(polar + pitch, LOOK_POLAR_MARGIN, Math.PI - LOOK_POLAR_MARGIN);
  return direction.applyAxisAngle(direction.clone().cross(UP).normalize(), polar - nextPolar).add(eye);
}

/**
 * Perspective and orthographic cameras orbiting one target (right button rotates,
 * middle pans, wheel zooms). Orthographic and isometric keep the visible height of
 * the perspective view when switching, like MagicaVoxel's `tan(fov/2) * radius` frustum.
 */
export function createCameraRig(canvas: HTMLCanvasElement, onChange: () => void) {
  const perspective = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 5000);
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
  perspective.up.copy(UP);
  orthographic.up.copy(UP);
  perspective.position.set(60, -80, 60);
  let wheelZoom: WheelZoom = 'cursor';
  // Registered before OrbitControls, so the focus zoom can take the wheel away from it.
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (wheelZoom !== 'focus') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      zoomToFocus(-event.deltaY / (WHEEL_NOTCH[event.deltaMode] ?? WHEEL_NOTCH[0]));
    },
    { passive: false },
  );
  /**
   * The free camera turns around its own eye (MagicaVoxel `cam_mode free`), so its rotate drags are
   * handled here, ahead of OrbitControls, which would swing the eye around the target instead.
   */
  let look: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    const rotates = event.button === RIGHT_BUTTON || (event.button === 0 && controls.mouseButtons.LEFT === THREE.MOUSE.ROTATE);
    if (mode !== 'free' || !rotates) return;
    event.stopImmediatePropagation();
    canvas.setPointerCapture(event.pointerId);
    look = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!look) return;
    event.stopImmediatePropagation();
    lookAround((event.clientX - look.x) * LOOK_SPEED * controls.rotateSpeed, (event.clientY - look.y) * LOOK_SPEED * controls.rotateSpeed);
    look = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!look) return;
    event.stopImmediatePropagation();
    look = null;
  });
  const controls = new OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(perspective, canvas);
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.zoomToCursor = true;
  const listeners = new Set<() => void>();
  let moveSpeed = 1;
  let roll = 0;
  /** OrbitControls aims the camera with `+z` up; the roll turns it about the view axis afterwards (idempotent). */
  const applyRoll = () => {
    if (roll === 0) return;
    camera().lookAt(controls.target);
    camera().rotateZ(THREE.MathUtils.degToRad(roll));
  };
  controls.addEventListener('change', () => {
    applyRoll();
    onChange();
    listeners.forEach((listener) => listener());
  });
  let mode: CameraMode = 'pers';
  let aspect = 1;
  /** Half the orthographic view height at zoom 1. */
  let orthoHeight = 50;

  const isOrthographic = (cameraMode: CameraMode) => cameraMode === 'orth' || cameraMode === 'iso';
  const camera = (): THREE.PerspectiveCamera | THREE.OrthographicCamera => (isOrthographic(mode) ? orthographic : perspective);
  const offset = () => camera().position.clone().sub(controls.target);

  const updateProjection = () => {
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
    Object.assign(orthographic, { left: -orthoHeight * aspect, right: orthoHeight * aspect, top: orthoHeight, bottom: -orthoHeight });
    orthographic.updateProjectionMatrix();
  };

  const settle = () => {
    updateProjection();
    controls.update();
    applyRoll();
    onChange();
    listeners.forEach((listener) => listener());
  };

  const lookAround = (yaw: number, pitch: number) => {
    controls.target.copy(turnedTarget(camera().position, controls.target, yaw, pitch));
    settle();
  };

  /** MagicaVoxel wheel zoom toward the focus, `notches` > 0 zooming in; the free camera flies instead. */
  const zoomToFocus = (notches: number) => {
    const view = offset();
    if (mode === 'free') {
      const move = view.normalize().multiplyScalar(-FREE_ZOOM_STEP * notches);
      camera().position.add(move);
      controls.target.add(move);
    } else if (isOrthographic(mode)) {
      orthographic.zoom = orthoHeight / focusZoomExtent(orthoHeight / orthographic.zoom, FOCUS_ZOOM_STEP * notches);
    } else {
      const radius = focusZoomRadius(view.length(), FOCUS_ZOOM_STEP * notches);
      camera().position.copy(controls.target).addScaledVector(view.normalize(), radius);
    }
    settle();
  };

  const setMode = (next: CameraMode) => {
    if (next === mode) return;
    const from = camera();
    const direction = offset().normalize();
    const visibleHeight = isOrthographic(mode) ? orthoHeight / orthographic.zoom : from.position.distanceTo(controls.target) * halfTan(perspective.fov);
    mode = next;
    const to = camera();
    if (isOrthographic(mode)) {
      orthoHeight = visibleHeight;
      orthographic.zoom = 1;
      orthographic.updateProjectionMatrix();
    }
    to.position.copy(controls.target).addScaledVector(direction, visibleHeight / halfTan(perspective.fov));
    controls.object = to;
    controls.minPolarAngle = mode === 'iso' ? ISO_POLAR : 0;
    controls.maxPolarAngle = mode === 'iso' ? ISO_POLAR : Math.PI;
    settle();
  };

  return {
    camera,
    mode: () => mode,
    setMode,

    /** MagicaVoxel `camera-control`: while a key is held, the left button drives the camera. */
    setLeftDrag(drag: CameraDrag | null) {
      controls.mouseButtons = { ...controls.mouseButtons, LEFT: drag ? DRAG_ACTIONS[drag] : null };
      // three's drag dolly reads the cursor's x for both axes, so drag zoom heads for the target instead.
      controls.zoomToCursor = drag !== 'zoom';
    },
    leftDrag: () => controls.mouseButtons.LEFT !== null,
    wheelZoom: () => wheelZoom,
    setWheelZoom(next: WheelZoom) {
      wheelZoom = next;
    },
    aspect: () => aspect,

    setAspect(next: number) {
      aspect = next;
      updateProjection();
    },

    /** Recentres on `bounds`, keeping the viewing direction (MagicaVoxel `cam focus`). */
    frame(bounds: THREE.Box3) {
      if (bounds.isEmpty()) return;
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const direction = offset().normalize();
      const distance = sphere.radius * FRAMING_DISTANCE;
      controls.target.copy(sphere.center);
      camera().position.copy(sphere.center).addScaledVector(direction, distance);
      orthoHeight = distance * halfTan(perspective.fov);
      orthographic.zoom = 1;
      settle();
    },

    /**
     * Slides the orbit target along the view axis to the depth of `point`, without moving the view.
     * Wheel zoom shrinks the distance to the target by a factor per step, so with the surface under
     * the cursor as target it closes in on that surface instead of stalling at an empty centre.
     */
    focusDepth(point: THREE.Vector3) {
      const view = camera().getWorldDirection(new THREE.Vector3());
      const depth = point.clone().sub(camera().position).dot(view);
      if (depth > 0) controls.target.copy(camera().position).addScaledVector(view, depth);
    },

    /** MagicaVoxel `camera-control` focus (`X` + click): `point` becomes the orbit centre, the view slides along with it. */
    centerOn(point: THREE.Vector3) {
      const view = offset();
      controls.target.copy(point);
      camera().position.copy(point).add(view);
      settle();
    },

    /** Snaps the view to the nearest axis, keeping target and distance (MagicaVoxel `cam face`). */
    faceView() {
      const current = offset();
      const distance = current.length();
      current.normalize();
      const nearest = FACE_DIRECTIONS.reduce((best, axis) => (axis.dot(current) > best.dot(current) ? axis : best));
      camera().position.copy(controls.target).addScaledVector(nearest, distance);
      settle();
    },

    /** Free camera (MagicaVoxel WASDQE): moves eye and target together along the view. */
    fly(forward: number, right: number, up: number) {
      if (mode !== 'free') return;
      const view = offset().negate();
      const step = Math.max(1, view.length() * 0.05) * moveSpeed;
      const ahead = view.normalize();
      const side = ahead.clone().cross(UP).normalize();
      const move = ahead.multiplyScalar(forward * step).addScaledVector(side, right * step).addScaledVector(UP, up * step);
      camera().position.add(move);
      controls.target.add(move);
      settle();
    },

    state(): CameraState {
      return { mode, target: toVec3(controls.target), position: toVec3(camera().position), zoom: orthographic.zoom, height: orthoHeight, fov: perspective.fov, roll };
    },

    restore(state: CameraState) {
      setMode(state.mode);
      perspective.fov = clampFov(state.fov);
      roll = state.roll;
      controls.target.set(...state.target);
      camera().position.set(...state.position);
      orthographic.zoom = state.zoom;
      orthoHeight = state.height;
      settle();
    },

    /** MagicaVoxel's camera panel: pitch and yaw (rCAM `_angle` degrees) about the centre, keeping the distance. */
    setOrientation(pitch: number, yaw: number) {
      const distance = offset().length();
      camera().position.copy(controls.target).add(new THREE.Vector3(...eyeDirection(pitch, yaw)).multiplyScalar(distance));
      settle();
    },
    orientation: () => cameraAngles(toVec3(offset())),
    roll: () => roll,
    /** MagicaVoxel `cam rz`; 0 puts `+z` back up. */
    setRoll(degrees: number) {
      roll = ((((degrees + 180) % 360) + 360) % 360) - 180;
      camera().lookAt(controls.target);
      settle();
    },

    /** The eye's distance to the centre, or the visible half height for `orth` and `iso` (MagicaVoxel `cam_zoom`). */
    distance: () => (isOrthographic(mode) ? orthoHeight / orthographic.zoom : offset().length()),
    setDistance(value: number) {
      const next = Math.max(value, MIN_ZOOM_EXTENT);
      if (isOrthographic(mode)) orthographic.zoom = orthoHeight / next;
      else camera().position.copy(controls.target).addScaledVector(offset().normalize(), next);
      settle();
    },

    fov: () => perspective.fov,
    setFov(degrees: number) {
      perspective.fov = clampFov(degrees);
      settle();
    },

    /** MagicaVoxel `cam_key` and `cam_mouse`: free camera key steps and mouse rotation, as multipliers. */
    speeds: () => ({ move: moveSpeed, mouse: controls.rotateSpeed }),
    setSpeeds({ move, mouse }: { move: number; mouse: number }) {
      moveSpeed = Math.max(move, 0.01);
      controls.rotateSpeed = Math.max(mouse, 0.1);
    },

    /** Called after every camera change (drags, wheel, panel edits). */
    onChange(listener: () => void) {
      listeners.add(listener);
    },
  };
}
