import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { isLooping } from '../scene/keyframes.ts';
import { element } from './dom.ts';
import { drawTrack, frameAtPoint, rowAtPoint } from './timeline-track.ts';
import type { KeyCommands } from '../editor/key-commands.ts';

/** Transport buttons, frame/range/fps fields, key buttons and the scrubbable track. */
export function bindTimeline(editor: Editor, commands: ObjectCommands, keys: KeyCommands): void {
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
  const globalTime = element('global-time', HTMLInputElement);
  const autoKey = element('auto-key', HTMLInputElement);
  const keyMenu = element('key-menu', HTMLElement);
  /** A press on a selected key drags the selection along the frames; Ctrl leaves copies behind. */
  let keyDrag: { start: number; delta: number; copy: boolean } | null = null;

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
      selected: state.keySelection,
      dragDelta: keyDrag?.delta ?? 0,
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
    globalTime.checked = state.globalTime;
    autoKey.checked = state.autoKey;
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
  globalTime.addEventListener('change', () => editor.setGlobalTime(globalTime.checked));
  autoKey.addEventListener('change', () => editor.setAutoKey(autoKey.checked));

  const keyActions: Record<string, () => void> = {
    all: () => keys.selectKeys('all'),
    inv: () => keys.selectKeys('inv'),
    none: () => keys.selectKeys('none'),
    reverse: keys.reverseSelectedKeys,
    delete: keys.deleteSelectedKeys,
  };
  keyMenu.querySelectorAll<HTMLButtonElement>('[data-keys]').forEach((button) =>
    button.addEventListener('click', () => {
      keyMenu.hidden = true;
      keyActions[button.dataset.keys ?? '']?.();
    }),
  );
  track.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    keyMenu.hidden = false;
    const { width, height } = keyMenu.getBoundingClientRect();
    keyMenu.style.left = `${Math.min(event.clientX, window.innerWidth - width - 4)}px`;
    keyMenu.style.top = `${Math.max(event.clientY - height - 4, 4)}px`;
  });
  window.addEventListener('pointerdown', (event) => {
    if (!keyMenu.hidden && !(event.target instanceof Node && keyMenu.contains(event.target))) keyMenu.hidden = true;
  });

  /** The key under the pointer in its row, if that row shows keys. */
  const keyAt = (clientX: number, clientY: number) => {
    const row = rowAtPoint(track, clientY);
    const frame = frameAtPoint(track, state.range, clientX);
    const { transform, shape } = selectedNodes();
    const node = row === 'transform' ? transform : shape;
    return node && node.keys.length > 1 && node.keys.some((key) => key.frame === frame) ? { track: row, frame } : null;
  };
  fields.frame.addEventListener('change', () => editor.setFrame(fields.frame.valueAsNumber));
  fields.fps.addEventListener('change', () => editor.setFps(fields.fps.valueAsNumber || state.fps));
  const setRange = () => editor.setRange([fields.rangeStart.valueAsNumber || 0, fields.rangeEnd.valueAsNumber || 0]);
  fields.rangeStart.addEventListener('change', setRange);
  fields.rangeEnd.addEventListener('change', setRange);

  let scrubbing = false;
  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    track.setPointerCapture(event.pointerId);
    const key = keyAt(event.clientX, event.clientY);
    if (key) {
      keys.clickKey(key.track, key.frame, event.shiftKey);
      if (!event.shiftKey) keyDrag = { start: key.frame, delta: 0, copy: event.ctrlKey || event.metaKey };
      return editor.setFrame(key.frame);
    }
    if (!event.shiftKey) keys.selectKeys('none');
    scrubbing = true;
    editor.setFrame(frameAtPoint(track, state.range, event.clientX));
  });
  track.addEventListener('pointermove', (event) => {
    const frame = frameAtPoint(track, state.range, event.clientX);
    if (keyDrag && frame - keyDrag.start !== keyDrag.delta) {
      keyDrag.delta = frame - keyDrag.start;
      return sync();
    }
    if (scrubbing) editor.setFrame(frame);
  });
  track.addEventListener('pointerup', () => {
    scrubbing = false;
    const drag = keyDrag;
    keyDrag = null;
    if (drag?.delta) keys.moveSelectedKeys(drag.delta, drag.copy);
    if (drag) sync();
  });
  track.addEventListener('keydown', (event) => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && keys.hasKeySelection()) {
      event.preventDefault();
      event.stopPropagation();
      return keys.deleteSelectedKeys();
    }
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
