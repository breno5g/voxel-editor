import * as THREE from 'three';
import type { Vec3 } from '../format/vox.ts';
import type { Viewport } from '../render/viewport.ts';
import { t } from '../i18n/i18n.ts';
import { element } from './dom.ts';

type Face = { label: string; title: string; normal: Vec3; right: Vec3; down: Vec3; pitch: number; yaw: number };

/** Straight up or down stays just short of the pole, where the orbit's up vector degenerates. */
const POLE = 89.9;
const CUBE_SIZE = 56;
/** Ruler ticks every few degrees, labelled every 45°, and how far a dragged pixel turns the camera. */
const TICK_DEGREES = 5;
const LABEL_DEGREES = 45;
const RULER_PIXELS_PER_DEGREE = 3;

/** Each face as seen from outside: its screen right and down in world axes, and the camera angles that look at it. */
const FACES: Face[] = [
  { label: t('Frente'), title: t('Olhar de frente'), normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1], pitch: 0, yaw: 0 },
  { label: t('Trás'), title: t('Olhar de trás'), normal: [0, 1, 0], right: [-1, 0, 0], down: [0, 0, -1], pitch: 0, yaw: 180 },
  { label: t('Direita'), title: t('Olhar de direita'), normal: [1, 0, 0], right: [0, 1, 0], down: [0, 0, -1], pitch: 0, yaw: 90 },
  { label: t('Esquerda'), title: t('Olhar de esquerda'), normal: [-1, 0, 0], right: [0, -1, 0], down: [0, 0, -1], pitch: 0, yaw: -90 },
  { label: t('Topo'), title: t('Olhar de topo'), normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0], pitch: -POLE, yaw: 0 },
  { label: t('Base'), title: t('Olhar de base'), normal: [0, 0, -1], right: [1, 0, 0], down: [0, 1, 0], pitch: POLE, yaw: 0 },
];

const faceMatrix = ({ normal, right, down }: Face) =>
  `matrix3d(${[...right, 0, ...down, 0, ...normal, 0, ...normal.map((axis) => (axis * CUBE_SIZE) / 2), 1].join(',')})`;

/** CSS space is the camera's with y pointing down. */
const SCREEN_FLIP = new THREE.Matrix4().makeScale(1, -1, 1);

/**
 * MagicaVoxel's view cube (`ui/scene.cube`, on by default): turns with the camera, and clicking a face
 * looks at that side. The camera ruler (`ui/scene.ruler`) shows yaw along the bottom and pitch along the
 * side; dragging either turns the camera.
 * ponytail: the ruler's look is inferred from its hint ("Drag on Ruler"); its exact layout is unconfirmed.
 */
export function bindViewCube(viewport: Viewport): void {
  const { camera } = viewport;
  const cube = element('view-cube', HTMLElement);
  const body = element('view-cube-body', HTMLElement);
  const cubeToggle = element('view-cube-toggle', HTMLButtonElement);
  const rulerToggle = element('camera-ruler-toggle', HTMLButtonElement);
  const rulers = { yaw: element('ruler-yaw', HTMLElement), pitch: element('ruler-pitch', HTMLElement) };

  FACES.forEach((face) => {
    const side = Object.assign(document.createElement('button'), { type: 'button', className: 'view-cube-face', textContent: face.label, title: face.title });
    side.style.transform = faceMatrix(face);
    side.addEventListener('click', () => camera.setOrientation(face.pitch, face.yaw));
    body.append(side);
  });

  const tickMarks = (ruler: HTMLElement, value: number, span: number, vertical: boolean) => {
    const length = vertical ? ruler.clientHeight : ruler.clientWidth;
    const half = length / 2 / RULER_PIXELS_PER_DEGREE;
    const ticks: HTMLElement[] = [];
    for (let degrees = Math.ceil((value - half) / TICK_DEGREES) * TICK_DEGREES; degrees <= value + half; degrees += TICK_DEGREES) {
      const tick = Object.assign(document.createElement('span'), { className: degrees % LABEL_DEGREES === 0 ? 'ruler-tick major' : 'ruler-tick' });
      const offset = length / 2 + (degrees - value) * RULER_PIXELS_PER_DEGREE;
      tick.style[vertical ? 'top' : 'left'] = `${offset}px`;
      if (degrees % LABEL_DEGREES === 0) tick.textContent = String(((((degrees + span / 2) % span) + span) % span) - span / 2);
      ticks.push(tick);
    }
    ruler.replaceChildren(...ticks, Object.assign(document.createElement('span'), { className: 'ruler-marker' }));
  };

  const sync = () => {
    if (!cube.hidden) {
      const view = camera.camera();
      view.updateMatrixWorld();
      const rotation = new THREE.Matrix4().extractRotation(view.matrixWorldInverse);
      body.style.transform = `matrix3d(${SCREEN_FLIP.clone().multiply(rotation).elements.join(',')})`;
    }
    if (!rulers.yaw.hidden) {
      const [pitch, yaw] = camera.orientation();
      tickMarks(rulers.yaw, yaw, 360, false);
      tickMarks(rulers.pitch, pitch, 360, true);
    }
  };

  const dragRuler = (ruler: HTMLElement, turn: (degrees: number) => void, vertical: boolean) => {
    let last: number | null = null;
    ruler.addEventListener('pointerdown', (event) => {
      ruler.setPointerCapture(event.pointerId);
      last = vertical ? event.clientY : event.clientX;
    });
    ruler.addEventListener('pointermove', (event) => {
      if (last === null) return;
      const position = vertical ? event.clientY : event.clientX;
      turn((last - position) / RULER_PIXELS_PER_DEGREE);
      last = position;
    });
    ruler.addEventListener('pointerup', () => (last = null));
  };
  dragRuler(rulers.yaw, (degrees) => {
    const [pitch, yaw] = camera.orientation();
    camera.setOrientation(pitch, yaw + degrees);
  }, false);
  dragRuler(rulers.pitch, (degrees) => {
    const [pitch, yaw] = camera.orientation();
    camera.setOrientation(Math.max(-POLE, Math.min(POLE, pitch + degrees)), yaw);
  }, true);

  const toggle = (button: HTMLButtonElement, show: (visible: boolean) => void) => {
    const apply = (visible: boolean) => {
      show(visible);
      button.setAttribute('aria-pressed', String(visible));
      sync();
    };
    button.addEventListener('click', () => apply(button.getAttribute('aria-pressed') !== 'true'));
    return apply;
  };
  toggle(cubeToggle, (visible) => (cube.hidden = !visible))(true);
  toggle(rulerToggle, (visible) => {
    rulers.yaw.hidden = !visible;
    rulers.pitch.hidden = !visible;
  })(false);
  camera.onChange(sync);
}
