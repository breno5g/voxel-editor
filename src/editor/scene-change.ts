import type { Editor } from './editor.ts';

/** Applies `redo` now and records it with `undo` as one history step; every run refreshes the scene. */
export const sceneChange = (editor: Editor) => (redo: () => void, undo: () => void, message?: string) => {
  const run = (step: () => void) => () => {
    step();
    editor.sceneChanged();
  };
  run(redo)();
  editor.history.push({ undo: run(undo), redo: run(redo) });
  if (message) editor.status(message);
};
