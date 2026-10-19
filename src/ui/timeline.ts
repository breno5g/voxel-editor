import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { isLooping } from '../scene/keyframes.ts';
import { element } from './dom.ts';
import { drawTrack, frameAtPoint } from './timeline-track.ts';

/** Transport buttons, frame/range/fps fields, key buttons and the scrubbable track. */
export function bindTimeline(editor: Editor, commands: ObjectCommands): void {
  const { state } = editor;
  const track = element('timeline-track', HTMLCanvasElement);
  const fields = {
    frame: element('frame', HTMLInputElement),
    rangeStart: element('range-start', HTMLInputElement),
    rangeEnd: element('range-end', HTMLInputElement),
    fps: element('fps', HTMLInputElement),
  };
  const play = element('play', HTMLButtonElement);
  const loops = { transform: element('loop-transform', HTMLInputElement), shape: element('loop-shape', HTMLInputElement) };
  const onionSkin = element('onion-skin', HTMLInputElement);

  const selectedNodes = () => {
    const instance = editor.selectedInstance();
    const transform = instance && state.vox.nodes[instance.transformId];
    const shape = instance && state.vox.nodes[instance.shapeId];
    return {
      transform: transform?.kind === 'transform' ? transform : undefined,
      shape: shape?.kind === 'shape' ? shape : undefined,
    };
  };

  const sync = () => {
    const { transform, shape } = selectedNodes();
    drawTrack(track, {
      range: state.range,
      frame: state.frame,
      transformKeys: transform && transform.keys.length > 1 ? transform.keys.map((key) => key.frame) : [],
      shapeKeys: shape && shape.keys.length > 1 ? shape.keys.map((key) => key.frame) : [],
    });
    fields.frame.value = String(state.frame);
    fields.rangeStart.value = String(state.range[0]);
    fields.rangeEnd.value = String(state.range[1]);
    fields.fps.value = String(state.fps);
    play.textContent = state.playing ? '❚❚' : '▶';
    play.setAttribute('aria-pressed', String(state.playing));
    loops.transform.checked = Boolean(transform && isLooping(transform.attrs));
    loops.shape.checked = Boolean(shape && isLooping(shape.attrs));
    loops.transform.disabled = !transform;
    loops.shape.disabled = !shape;
    onionSkin.checked = state.onionSkin;
    track.setAttribute('aria-valuemin', String(state.range[0]));
    track.setAttribute('aria-valuemax', String(state.range[1]));
    track.setAttribute('aria-valuenow', String(state.frame));
  };

  const buttons: [string, () => void][] = [
    ['first-key', () => commands.stepKey(-1, true)],
    ['prev-key', () => commands.stepKey(-1)],
    ['prev-frame', () => editor.stepFrame(-1)],
    ['play', () => editor.setPlaying(!state.playing)],
    ['next-frame', () => editor.stepFrame(1)],
    ['next-key', () => commands.stepKey(1)],
    ['last-key', () => commands.stepKey(1, true)],
    ['add-transform-key', commands.addTransformKey],
    ['remove-transform-key', commands.removeTransformKey],
    ['add-model-frame', commands.addModelFrame],
    ['remove-model-frame', commands.removeModelFrame],
  ];
  buttons.forEach(([id, action]) => element(id, HTMLButtonElement).addEventListener('click', action));

  loops.transform.addEventListener('change', () => commands.toggleLoop('transform'));
  loops.shape.addEventListener('change', () => commands.toggleLoop('shape'));
  onionSkin.addEventListener('change', () => editor.setOnionSkin(onionSkin.checked));
  fields.frame.addEventListener('change', () => editor.setFrame(fields.frame.valueAsNumber));
  fields.fps.addEventListener('change', () => editor.setFps(fields.fps.valueAsNumber || state.fps));
  const setRange = () => editor.setRange([fields.rangeStart.valueAsNumber || 0, fields.rangeEnd.valueAsNumber || 0]);
  fields.rangeStart.addEventListener('change', setRange);
  fields.rangeEnd.addEventListener('change', setRange);

  let scrubbing = false;
  track.addEventListener('pointerdown', (event) => {
    scrubbing = true;
    track.setPointerCapture(event.pointerId);
    editor.setFrame(frameAtPoint(track, state.range, event.clientX));
  });
  track.addEventListener('pointermove', (event) => {
    if (scrubbing) editor.setFrame(frameAtPoint(track, state.range, event.clientX));
  });
  track.addEventListener('pointerup', () => {
    scrubbing = false;
  });
  track.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    editor.stepFrame(step);
  });

  new ResizeObserver(sync).observe(track);
  editor.subscribe((event) => {
    if (event.type !== 'status' && event.type !== 'voxels') sync();
  });
}
