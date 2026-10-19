import { createDefaultPalette } from './defaults.ts';
import type { VoxDocument } from './vox.ts';

/** MagicaVoxel's file components (`i_comp`/`o_comp` and the `save_*` switches of the File panel). */
export const COMPONENTS = ['palette', 'material', 'render', 'camera', 'note'] as const;
export type Component = (typeof COMPONENTS)[number];
export const isComponent = (value: unknown): value is Component => COMPONENTS.some((component) => component === value);

/** Render settings live in rOBJ chunks (`_type _setting` …), which this editor keeps verbatim. */
const RENDER_CHUNKS = ['rOBJ'];
const isRender = (id: string) => RENDER_CHUNKS.includes(id);

/** Replaces `component` of `target` with a copy of `source`'s. */
export const copyComponent: Record<Component, (source: VoxDocument, target: VoxDocument) => void> = {
  palette: (source, target) => {
    target.palette = source.palette.slice();
  },
  material: (source, target) => {
    target.materials = new Map([...source.materials].map(([id, attrs]) => [id, new Map(attrs)]));
  },
  render: (source, target) => {
    const copies = source.extras.filter(({ id }) => isRender(id)).map((chunk) => ({ id: chunk.id, content: chunk.content.slice(), children: chunk.children.slice() }));
    target.extras = [...target.extras.filter(({ id }) => !isRender(id)), ...copies];
  },
  camera: (source, target) => {
    target.cameras = new Map([...source.cameras].map(([id, attrs]) => [id, new Map(attrs)]));
  },
  note: (source, target) => {
    target.notes = [...source.notes];
  },
};

/** A document with nothing but the defaults, to hold components. */
export const emptyDocument = (): VoxDocument => ({
  models: [],
  nodes: [],
  palette: createDefaultPalette(),
  layers: [],
  materials: new Map(),
  notes: [],
  cameras: new Map(),
  meta: new Map(),
  extras: [],
});

/** `document` as written with only the `saved` components (the others fall back to their defaults). */
export function withComponents(document: VoxDocument, saved: Record<Component, boolean>): VoxDocument {
  const blank = emptyDocument();
  const written: VoxDocument = { ...document };
  COMPONENTS.forEach((component) => {
    if (!saved[component]) copyComponent[component](blank, written);
  });
  return written;
}
