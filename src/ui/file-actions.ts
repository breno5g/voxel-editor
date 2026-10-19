import { UNTITLED } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import { createDocument } from '../format/defaults.ts';
import { parseVox } from '../format/vox-reader.ts';
import { writeVox } from '../format/vox-writer.ts';
import { renderSpriteSheet } from '../render/sprite-sheet.ts';
import type { Viewport } from '../render/viewport.ts';
import { downloadBlob, element } from './dom.ts';

export type FileActions = ReturnType<typeof createFileActions>;

const SPRITE_FRAME_SIZE = 256;

/** Open (button, drag-and-drop), save and export, with a guard against losing unsaved work. */
export function createFileActions(editor: Editor, viewport: Viewport) {
  const input = element('file-input', HTMLInputElement);
  const confirmDiscard = () => !editor.state.dirty || window.confirm('Há alterações não salvas. Descartar?');
  const baseName = () => editor.state.fileName.replace(/\.vox$/i, '');

  const openFile = async (file: File) => {
    if (!confirmDiscard()) return;
    try {
      editor.load(parseVox(new Uint8Array(await file.arrayBuffer())), file.name);
      editor.status(`${file.name} aberto`);
    } catch (error) {
      editor.fail(`Não foi possível abrir ${file.name}`, error);
    }
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void openFile(file);
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void openFile(file);
  });
  window.addEventListener('beforeunload', (event) => {
    if (editor.state.dirty) event.preventDefault();
  });

  return {
    newDocument() {
      if (confirmDiscard()) editor.load(createDocument(), UNTITLED);
    },

    open() {
      input.click();
    },

    save() {
      try {
        downloadBlob(new Blob([writeVox(editor.state.vox)], { type: 'application/octet-stream' }), editor.state.fileName);
        editor.markSaved();
        editor.status(`${editor.state.fileName} salvo`);
      } catch (error) {
        editor.fail('Falha ao salvar', error);
      }
    },

    /** Renders every frame of the current range from the current camera. */
    async exportSpriteSheet() {
      const { range, frame } = editor.state;
      const frameCount = range[1] - range[0] + 1;
      editor.setPlaying(false);
      try {
        const sheet = await renderSpriteSheet(viewport.spriteTarget, frameCount, SPRITE_FRAME_SIZE, (index) => editor.setFrame(range[0] + index));
        downloadBlob(sheet, `${baseName()}-sheet.png`);
        editor.status(`Sprite sheet com ${frameCount} frames de ${SPRITE_FRAME_SIZE}px exportada`);
      } catch (error) {
        editor.fail('Falha ao exportar sprite sheet', error);
      } finally {
        editor.setFrame(frame);
        viewport.requestRender();
      }
    },
  };
}
