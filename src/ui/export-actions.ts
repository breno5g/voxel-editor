import type { Editor } from '../editor/editor.ts';
import { modelFromCells, worldCells } from '../editor/object-booleans.ts';
import { documentFromModels, encodeQb, encodeSlab, encodeXraw } from '../format/grid-formats.ts';
import { writeVox } from '../format/vox-writer.ts';
import type { PlacedModel } from '../format/grid-formats.ts';
import { DEFAULT_MESH_OPTIONS, exportMesh, MESH_FORMATS } from '../format/mesh-export.ts';
import type { ExportAxis, ExportFile, ExportObject, MeshFormat } from '../format/mesh-export.ts';
import type { VoxModel } from '../format/vox.ts';
import { flatImage, isoImage, sliceImage } from '../format/voxel-images.ts';
import type { RgbaImage } from '../format/voxel-images.ts';
import { isUnder, parentMap } from '../scene/scene-tree.ts';
import { downloadBlob, element } from './dom.ts';

const GRID_FORMATS = ['vox', 'qb', 'xraw', 'slab'] as const;
const IMAGE_FORMATS = ['iso', '2d', 'slice'] as const;
type ExportFormat = MeshFormat | (typeof GRID_FORMATS)[number] | (typeof IMAGE_FORMATS)[number];
const isMesh = (format: string): format is MeshFormat => MESH_FORMATS.some((mesh) => mesh === format);
const isFormat = (format: string): format is ExportFormat => isMesh(format) || [...GRID_FORMATS, ...IMAGE_FORMATS].some((other) => other === format);

async function pngBlob({ width, height, pixels }: RgbaImage): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível');
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** MagicaVoxel `o <format>`: the visible objects (or the selection) at the current frame, in world or local space. */
export function bindExportActions(editor: Editor): void {
  const { state } = editor;
  const dialog = element('export-dialog', HTMLDialogElement);
  const format = element('export-format', HTMLSelectElement);
  const selectedOnly = element('export-selected', HTMLInputElement);
  const local = element('export-local', HTMLInputElement);
  const meshOptions = element('export-mesh-options', HTMLElement);
  const scale = element('export-scale', HTMLInputElement);
  const axis = element('export-axis', HTMLSelectElement);

  const syncOptions = () => {
    const chosen = format.value;
    meshOptions.hidden = !isMesh(chosen);
    if (!isMesh(chosen)) return;
    scale.value = String(DEFAULT_MESH_OPTIONS[chosen].scale);
    axis.value = DEFAULT_MESH_OPTIONS[chosen].axis;
  };
  format.addEventListener('change', syncOptions);

  const objects = (): ExportObject[] => {
    const parents = parentMap(state.vox);
    const instances = selectedOnly.checked ? state.instances.filter((instance) => state.selection.some((id) => isUnder(parents, instance.transformId, id))) : state.instances;
    return instances.map((instance) => ({
      name: state.vox.nodes[instance.transformId]?.attrs.get('_name') ?? `objeto${instance.transformId}`,
      model: state.vox.models[instance.model],
      pose: local.checked ? null : instance.pose,
    }));
  };

  /** One model for single-grid formats: the object itself in local space, else every voxel merged in world space. */
  const mergedModel = (items: ExportObject[]): VoxModel | null => {
    if (items.length === 1 && !items[0].pose) return items[0].model;
    const cells = new Map<number, number>();
    for (const item of items) {
      if (!item.pose) return null;
      worldCells({ transformId: 0, shapeId: 0, model: 0, pose: item.pose }, [item.model]).forEach((color, key) => cells.set(key, color));
    }
    return modelFromCells(cells)?.model ?? null;
  };

  const placed = (items: ExportObject[]): PlacedModel[] =>
    items.flatMap((item) => {
      if (!item.pose) return [{ name: item.name, model: item.model, position: [0, 0, 0] }];
      const built = modelFromCells(worldCells({ transformId: 0, shapeId: 0, model: 0, pose: item.pose }, [item.model]));
      return built ? [{ name: item.name, model: built.model, position: built.low }] : [];
    });

  const filesFor = async (chosen: ExportFormat, base: string): Promise<ExportFile[] | Blob> => {
    const items = objects();
    if (items.length === 0) throw new Error('Nada para exportar');
    const { palette } = state.vox;
    if (isMesh(chosen)) {
      const files = exportMesh(chosen, base, items, palette, { ...DEFAULT_MESH_OPTIONS[chosen], scale: scale.valueAsNumber || DEFAULT_MESH_OPTIONS[chosen].scale, axis: axis.value === 'XZ-Y' ? 'XZ-Y' : ('XYZ' satisfies ExportAxis) });
      if (chosen !== 'obj') return files;
      const texture = new Uint8Array(await (await pngBlob({ width: 256, height: 1, pixels: Uint8ClampedArray.from(palette) })).arrayBuffer());
      return [...files, { name: `${base}.png`, data: texture, type: 'image/png' }];
    }
    if (chosen === 'qb') return [{ name: `${base}.qb`, data: encodeQb(placed(items), palette), type: 'application/octet-stream' }];
    if (chosen === 'vox') return [{ name: `${base}-objetos.vox`, data: writeVox(documentFromModels(placed(items), palette)), type: 'application/octet-stream' }];
    const model = mergedModel(items);
    if (!model) throw new Error('Exporte um objeto só em espaço local, ou a cena em espaço do mundo');
    if (chosen === 'xraw') return [{ name: `${base}.xraw`, data: encodeXraw(model, palette), type: 'application/octet-stream' }];
    if (chosen === 'slab') return [{ name: `${base}-slab6.vox`, data: encodeSlab(model, palette), type: 'application/octet-stream' }];
    const image = chosen === 'iso' ? isoImage(model, palette) : chosen === '2d' ? flatImage(model, palette) : sliceImage(model, palette);
    return pngBlob(image);
  };

  const run = async () => {
    const chosen = format.value;
    if (!isFormat(chosen)) return;
    const base = state.fileName.replace(/\.vox$/i, '');
    try {
      const result = await filesFor(chosen, base);
      if (result instanceof Blob) {
        downloadBlob(result, `${base}-${chosen}.png`);
      } else {
        result.forEach((file) => downloadBlob(new Blob([file.data], { type: file.type }), file.name));
      }
      editor.status(`Exportado como ${chosen.toUpperCase()}`);
    } catch (error) {
      editor.fail('Falha ao exportar', error);
    }
  };

  element('export-file', HTMLButtonElement).addEventListener('click', () => {
    selectedOnly.checked = state.mode === 'world' && state.selection.length > 0;
    syncOptions();
    dialog.showModal();
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'export') void run();
  });
}
