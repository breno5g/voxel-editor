import type { Editor } from './editor.ts';

/** Advances one frame per 1/fps seconds while `state.playing`, looping inside the frame range. */
export function bindPlayback(editor: Editor): void {
  let handle = 0;
  let lastStep = 0;

  const tick = (now: number) => {
    if (!editor.state.playing) return;
    if (now - lastStep >= 1000 / editor.state.fps) {
      lastStep = now;
      editor.stepFrame(1);
    }
    handle = requestAnimationFrame(tick);
  };

  editor.subscribe((event) => {
    if (event.type !== 'playback' && event.type !== 'document') return;
    cancelAnimationFrame(handle);
    if (!editor.state.playing) return;
    lastStep = performance.now();
    handle = requestAnimationFrame(tick);
  });
}
