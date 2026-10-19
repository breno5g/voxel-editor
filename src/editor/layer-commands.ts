import type { Layer, TransformNode, VoxDocument } from '../format/vox.ts';
import { isHidden } from '../scene/scene-graph.ts';
import { groupNode, rootLevel } from '../scene/scene-tree.ts';
import type { Editor } from './editor.ts';
import { sceneChange } from './scene-change.ts';

/** MagicaVoxel's world editor has eight layers. */
export const LAYER_COUNT = 8;
const COLOR_KEY = '_color';

export const layerName = (vox: VoxDocument, id: number) => vox.layers.find((layer) => layer.id === id)?.attrs.get('_name') ?? `Camada ${id}`;

/** Layer colour as `#rrggbb`; MagicaVoxel stores `_color` as "r g b". */
export function layerColor(vox: VoxDocument, id: number): string | null {
  const raw = vox.layers.find((layer) => layer.id === id)?.attrs.get(COLOR_KEY);
  const channels = raw?.split(' ').map(Number);
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel))) return null;
  return `#${channels.map((channel) => Math.min(Math.max(channel, 0), 255).toString(16).padStart(2, '0')).join('')}`;
}

export const isLayerHidden = (vox: VoxDocument, id: number) => vox.layers.some((layer) => layer.id === id && isHidden(layer.attrs));

/** MagicaVoxel `lay_*` and `osel_layer`: layer naming, colour, visibility and membership. */
export function createLayerCommands(editor: Editor) {
  const { state } = editor;
  const change = sceneChange(editor);

  /** The document's layer `id`, created (empty) when the file has none yet. */
  const layerOf = (id: number): Layer => {
    const existing = state.vox.layers.find((layer) => layer.id === id);
    if (existing) return existing;
    const created: Layer = { id, attrs: new Map() };
    state.vox.layers.push(created);
    state.vox.layers.sort((a, b) => a.id - b.id);
    return created;
  };

  const setLayerAttr = (id: number, key: string, value: string | null, message: string) => {
    const { attrs } = layerOf(id);
    const before = attrs.get(key) ?? null;
    if (before === value) return;
    const apply = (next: string | null) => () => {
      if (next === null) attrs.delete(key);
      else attrs.set(key, next);
    };
    change(apply(value), apply(before), message);
  };

  const levelTransforms = (): { id: number; node: TransformNode }[] =>
    (groupNode(state.vox, state.level ?? rootLevel(state.vox) ?? -1)?.children ?? []).flatMap((id) => {
      const node = state.vox.nodes[id];
      return node?.kind === 'transform' ? [{ id, node }] : [];
    });

  return {
    /** Clicking a layer: it becomes the current one (for new objects) and the selection moves onto it. */
    useLayer(id: number) {
      editor.setCurrentLayer(id);
      const nodes = state.selection.flatMap((selected) => {
        const node = state.vox.nodes[selected];
        return node?.kind === 'transform' && node.layer !== id ? [node] : [];
      });
      if (nodes.length === 0) return;
      const before = nodes.map((node) => node.layer);
      change(
        () => nodes.forEach((node) => (node.layer = id)),
        () => nodes.forEach((node, index) => (node.layer = before[index])),
        `Seleção movida para ${layerName(state.vox, id)}`,
      );
    },

    /** MagicaVoxel `lay_vis`. */
    toggleLayerVisible(id: number) {
      setLayerAttr(id, '_hidden', isLayerHidden(state.vox, id) ? null : '1', isLayerHidden(state.vox, id) ? 'Camada visível' : 'Camada oculta');
    },

    /** MagicaVoxel `lay_name`. */
    renameLayer(id: number, name: string) {
      setLayerAttr(id, '_name', name.trim() || null, 'Camada renomeada');
    },

    /** MagicaVoxel `lay_col`, from a `#rrggbb` colour. */
    setLayerColor(id: number, hex: string) {
      const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
      if (channels.some(Number.isNaN)) return;
      setLayerAttr(id, COLOR_KEY, channels.join(' '), 'Cor da camada alterada');
    },

    /** MagicaVoxel `osel_layer`: selects the objects of layer `id` at the current level. */
    selectLayer(id: number) {
      editor.setSelection(levelTransforms().flatMap(({ id: nodeId, node }) => (node.layer === id ? [nodeId] : [])));
    },

    /** MagicaVoxel `lay_sort`: layers ordered by name; objects follow their layer. */
    sortLayers() {
      const order = Array.from({ length: LAYER_COUNT }, (_unused, id) => id).sort((a, b) => layerName(state.vox, a).localeCompare(layerName(state.vox, b)));
      const newId = new Map(order.map((oldId, index) => [oldId, index]));
      const transforms = state.vox.nodes.filter((node): node is TransformNode => node.kind === 'transform' && newId.has(node.layer));
      const beforeLayers = state.vox.layers.map((layer) => ({ layer, id: layer.id }));
      const beforeNodes = transforms.map((node) => node.layer);
      const current = state.layer;
      change(
        () => {
          state.vox.layers.forEach((layer) => (layer.id = newId.get(layer.id) ?? layer.id));
          state.vox.layers.sort((a, b) => a.id - b.id);
          transforms.forEach((node, index) => (node.layer = newId.get(beforeNodes[index]) ?? node.layer));
          editor.setCurrentLayer(newId.get(current) ?? current);
        },
        () => {
          beforeLayers.forEach(({ layer, id }) => (layer.id = id));
          state.vox.layers.sort((a, b) => a.id - b.id);
          transforms.forEach((node, index) => (node.layer = beforeNodes[index]));
          editor.setCurrentLayer(current);
        },
        'Camadas ordenadas por nome',
      );
    },
  };
}
