import { UNTITLED } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import { createDocument } from '../format/defaults.ts';
import { decodeQb, decodeSlab, decodeXraw } from '../format/grid-formats.ts';
import { parseVox } from '../format/vox-reader.ts';
import { VOX_MAGIC } from '../format/vox.ts';

/** MagicaVoxel opens .vox (its own, or Slab6's when the magic is missing), Qubicle .qb and .xraw. */
function readModelFile(name: string, bytes: Uint8Array) {
  if (/\.qb$/i.test(name)) return decodeQb(bytes);
  if (/\.xraw$/i.test(name)) return decodeXraw(bytes);
  return new TextDecoder().decode(bytes.subarray(0, 4)) === VOX_MAGIC ? parseVox(bytes) : decodeSlab(bytes);
}
import { writeVox } from '../format/vox-writer.ts';
import { renderSnapshot, renderSpriteSheet } from '../render/image-export.ts';
import type { Viewport } from '../render/viewport.ts';
import { t, tn } from '../i18n/i18n.ts';
import { downloadBlob, element } from './dom.ts';
import { isPaletteFile } from './palette-panel.ts';

export type FileActions = ReturnType<typeof createFileActions>;

const SPRITE_FRAME_SIZE = 256;

/** Open (button, drag-and-drop), save and export, with a guard against losing unsaved work. */
export function createFileActions(editor: Editor, viewport: Viewport) {
  const input = element('file-input', HTMLInputElement);
  const confirmDiscard = () => !editor.state.dirty || window.confirm(t('Há alterações não salvas. Descartar?'));
  const baseName = () => editor.state.fileName.replace(/\.vox$/i, '');

  const openFile = async (file: File) => {
    if (!confirmDiscard()) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const name = file.name.replace(/\.(qb|xraw)$/i, '.vox');
      editor.load(readModelFile(file.name, bytes), name);
      editor.status(t('{file} aberto', { file: file.name }));
    } catch (error) {
      editor.fail(t('Não foi possível abrir {file}', { file: file.name }), error);
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
    if (file && !isPaletteFile(file.name)) void openFile(file);
  });
  window.addEventListener('beforeunload', (event) => {
    if (editor.state.dirty) event.preventDefault();
  });

  const save = (fileName: string) => {
    try {
      downloadBlob(new Blob([writeVox(editor.savedDocument())], { type: 'application/octet-stream' }), fileName);
      editor.markSaved(fileName);
      editor.status(t('{file} salvo', { file: fileName }));
    } catch (error) {
      editor.fail(t('Falha ao salvar'), error);
    }
  };

  return {
    newDocument() {
      if (confirmDiscard()) editor.load(createDocument(), UNTITLED);
    },

    open() {
      input.click();
    },

    save: () => save(editor.state.fileName),

    /** MagicaVoxel `saveas`: asks for a name, then saves under it. */
    saveAs() {
      const name = window.prompt(t('Salvar como'), editor.state.fileName)?.trim();
      if (name) save(/\.vox$/i.test(name) ? name : `${name}.vox`);
    },

    /** MagicaVoxel `snap scene` (6): saves the current view as PNG. */
    async snapshot() {
      try {
        downloadBlob(await renderSnapshot(viewport.imageTarget), `${baseName()}-${editor.state.frame}.png`);
        editor.status(t('Imagem da vista salva'));
      } catch (error) {
        editor.fail(t('Falha ao capturar a vista'), error);
      } finally {
        viewport.requestRender();
      }
    },

    /** Renders every frame of the current range from the current camera. */
    async exportSpriteSheet() {
      const { range, frame } = editor.state;
      const frameCount = range[1] - range[0] + 1;
      editor.setPlaying(false);
      try {
        const sheet = await renderSpriteSheet(viewport.imageTarget, frameCount, SPRITE_FRAME_SIZE, (index) => editor.setFrame(range[0] + index));
        downloadBlob(sheet, `${baseName()}-sheet.png`);
        editor.status(tn(frameCount, 'Sprite sheet com {n} frame de {size}px exportada', 'Sprite sheet com {n} frames de {size}px exportada', { size: SPRITE_FRAME_SIZE }));
      } catch (error) {
        editor.fail(t('Falha ao exportar sprite sheet'), error);
      } finally {
        editor.setFrame(frame);
        viewport.requestRender();
      }
    },
  };
}
