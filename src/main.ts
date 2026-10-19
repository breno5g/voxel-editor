import './ui/styles.css';
import { bindAutosave } from './editor/autosave.ts';
import { createEditor, UNTITLED } from './editor/editor.ts';
import { createModelCommands } from './editor/model-commands.ts';
import { createObjectCommands } from './editor/object-commands.ts';
import { bindPlayback } from './editor/playback.ts';
import { createDocument } from './format/defaults.ts';
import { createViewport } from './render/viewport.ts';
import { bindCameraPanel } from './ui/camera-panel.ts';
import { bindDisplayPanel } from './ui/display-panel.ts';
import { element } from './ui/dom.ts';
import { createFileActions } from './ui/file-actions.ts';
import { bindHelp } from './ui/help.ts';
import { bindModelPanel } from './ui/model-panel.ts';
import { bindObjectInspector } from './ui/object-inspector.ts';
import { bindObjectsPanel } from './ui/objects-panel.ts';
import { bindPalettePanel } from './ui/palette-panel.ts';
import { bindShortcuts } from './ui/shortcuts.ts';
import { bindStatusBar } from './ui/status-bar.ts';
import { bindTimeline } from './ui/timeline.ts';
import { bindToolbar } from './ui/toolbar.ts';
import { bindViewportPanel } from './ui/viewport-panel.ts';

const editor = createEditor();
const viewport = createViewport(element('viewport', HTMLElement));
const commands = createObjectCommands(editor);
const models = createModelCommands(editor);
const files = createFileActions(editor, viewport);
const { focusCamera } = bindViewportPanel(editor, viewport, commands);
const cameras = bindCameraPanel(editor, viewport);

bindStatusBar(editor);
bindToolbar(editor, files, commands, focusCamera);
bindDisplayPanel(editor);
bindPalettePanel(editor);
bindObjectsPanel(editor, commands);
bindObjectInspector(editor, commands);
bindModelPanel(models);
bindTimeline(editor, commands);
bindShortcuts(editor, commands, models, files, {
  focusCamera,
  faceView: viewport.camera.faceView,
  snapshot: () => void files.snapshot(),
  saveCamera: cameras.save,
  loadCamera: cameras.load,
  selectCameraSlot: cameras.selectSlot,
  fly: viewport.camera.fly,
  openHelp: bindHelp().open,
});
bindPlayback(editor);
const autosave = bindAutosave(editor);

editor.load(createDocument(), UNTITLED);
editor.status('Pronto. Modo Modelo: desenhe no chão do objeto. Tab no viewport alterna para o modo Mundo. Botão direito gira, do meio move, roda dá zoom.');
void autosave.recover();
