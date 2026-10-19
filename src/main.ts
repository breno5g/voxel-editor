import './ui/styles.css';
import { bindAutosave } from './editor/autosave.ts';
import { createEditor, UNTITLED } from './editor/editor.ts';
import { createModelCommands } from './editor/model-commands.ts';
import { createObjectCommands } from './editor/object-commands.ts';
import { bindPlayback } from './editor/playback.ts';
import { createDocument } from './format/defaults.ts';
import { createViewport } from './render/viewport.ts';
import { bindBrushPanel } from './ui/brush-panel.ts';
import { bindCameraPanel } from './ui/camera-panel.ts';
import { bindDisplayPanel } from './ui/display-panel.ts';
import { element } from './ui/dom.ts';
import { createFileActions } from './ui/file-actions.ts';
import { bindHelp } from './ui/help.ts';
import { bindModelPanel } from './ui/model-panel.ts';
import { bindObjectInspector } from './ui/object-inspector.ts';
import { bindObjectsPanel } from './ui/objects-panel.ts';
import { bindWorldPanel } from './ui/world-panel.ts';
import { bindLayersPanel } from './ui/layers-panel.ts';
import { bindImportActions } from './ui/import-actions.ts';
import { bindExportActions } from './ui/export-actions.ts';
import { bindProjectsPanel } from './ui/projects-panel.ts';
import { bindXsPanel } from './ui/xs-panel.ts';
import { createProjectStore } from './editor/project-store.ts';
import { bindPalettePanel } from './ui/palette-panel.ts';
import { createPaletteCommands } from './editor/palette-commands.ts';
import { createMaterialCommands } from './editor/material-commands.ts';
import { createKeyCommands } from './editor/key-commands.ts';
import { createPatternCommands } from './editor/pattern-commands.ts';
import { bindPatternPanel } from './ui/pattern-panel.ts';
import { createComponentCommands } from './editor/component-commands.ts';
import { bindComponentsPanel } from './ui/components-panel.ts';
import { bindMaterialPanel } from './ui/material-panel.ts';
import { bindShortcuts } from './ui/shortcuts.ts';
import { bindStatusBar } from './ui/status-bar.ts';
import { bindTimeline } from './ui/timeline.ts';
import { bindToolbar } from './ui/toolbar.ts';
import { bindViewportPanel } from './ui/viewport-panel.ts';
import { bindViewCube } from './ui/view-cube.ts';

const editor = createEditor();
const viewport = createViewport(element('viewport', HTMLElement));
const commands = createObjectCommands(editor);
const models = createModelCommands(editor);
const keys = createKeyCommands(editor);
const patterns = createPatternCommands(editor, models, commands);
const files = createFileActions(editor, viewport);
const xs = bindXsPanel(editor, models);
const { focusCamera } = bindViewportPanel(editor, viewport, commands, { placePattern: patterns.placePattern, runShader: xs.runChosen });
const cameras = bindCameraPanel(editor, viewport);
bindViewCube(viewport);

bindStatusBar(editor);
bindToolbar(editor, files, commands, focusCamera);
bindBrushPanel(editor);
bindDisplayPanel(editor);
bindPalettePanel(editor, createPaletteCommands(editor));
bindMaterialPanel(editor, createMaterialCommands(editor));
bindObjectsPanel(editor, commands);
bindWorldPanel(editor, commands);
bindLayersPanel(editor, commands);
bindImportActions(editor, commands);
bindExportActions(editor);
bindProjectsPanel(editor, createProjectStore(editor));
bindComponentsPanel(editor, createComponentCommands(editor));
bindObjectInspector(editor, commands);
bindModelPanel(models);
bindPatternPanel(editor, patterns);
bindTimeline(editor, commands, keys);
bindShortcuts(editor, commands, models, files, {
  focusCamera,
  faceView: viewport.camera.faceView,
  snapshot: () => void files.snapshot(),
  saveCamera: cameras.save,
  loadCamera: cameras.load,
  selectCameraSlot: cameras.selectSlot,
  fly: viewport.camera.fly,
  openHelp: bindHelp().open,
}, keys, patterns);
bindPlayback(editor);
const autosave = bindAutosave(editor);

editor.load(createDocument(), UNTITLED);
editor.status('Pronto. Modo Modelo: desenhe no chão do objeto. Tab no viewport alterna para o modo Mundo. Botão direito gira, do meio move, roda dá zoom.');
void autosave.recover();
