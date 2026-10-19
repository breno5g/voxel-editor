import * as THREE from 'three';
import { modelPivot } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';

const GRID_EXTENT = 256;
const GRID_CELL = 8;
const HOVER_COLOR = 0xffffff;
/** MagicaVoxel's wireframe colour (`0x963c3c3c`, ABGR): a translucent grey box per object. */
const WIRE_COLOR = 0x3c3c3c;
const WIRE_OPACITY = 0x96 / 255;
/** The ground grid's axis lines are drawn brighter than the cell lines. */
const GRID_AXIS_LIFT = 1.8;

/** An object's world pose (with the model pivot on it) and model size. */
export type BoxedObject = { matrix: THREE.Matrix4; size: Vec3 };

function wireBox(color: THREE.ColorRepresentation, opacity = 1): THREE.LineSegments {
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity }),
  );
  box.matrixAutoUpdate = false;
  box.renderOrder = 1;
  box.visible = false;
  return box;
}

/** Unit box stretched over the model-space cells [from, to] (inclusive), relative to the pivot. */
function cellBox(objectMatrix: THREE.Matrix4, size: Vec3, from: Vec3, to: Vec3) {
  const pivot = modelPivot(size);
  const low = from.map((axis, i) => Math.min(axis, to[i]) - pivot[i]);
  const extent = from.map((axis, i) => Math.abs(axis - to[i]) + 1);
  return objectMatrix
    .clone()
    .multiply(new THREE.Matrix4().makeTranslation(low[0] + extent[0] / 2, low[1] + extent[1] / 2, low[2] + extent[2] / 2))
    .multiply(new THREE.Matrix4().makeScale(extent[0], extent[1], extent[2]));
}

/** Lines across the floor of a `size` model every `spacing` cells, in model space around the pivot. */
function floorGridGeometry(size: Vec3, spacing: number): THREE.BufferGeometry {
  const pivot = modelPivot(size);
  const points: number[] = [];
  for (let x = spacing; x < size[0]; x += spacing) points.push(x - pivot[0], -pivot[1], -pivot[2], x - pivot[0], size[1] - pivot[1], -pivot[2]);
  for (let y = spacing; y < size[1]; y += spacing) points.push(-pivot[0], y - pivot[1], -pivot[2], size[0] - pivot[0], y - pivot[1], -pivot[2]);
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
}

/** Keeps `pool` at least `count` boxes long and places one per object, hiding the rest. */
function placeBoxes(pool: THREE.Group, objects: BoxedObject[], create: () => THREE.LineSegments) {
  while (pool.children.length < objects.length) pool.add(create());
  pool.children.forEach((box, index) => {
    const object = objects[index];
    box.visible = Boolean(object);
    if (!object) return;
    const { size } = object;
    box.matrix.copy(cellBox(object.matrix, size, [0, 0, 0], [size[0] - 1, size[1] - 1, size[2] - 1]));
    box.matrixWorldNeedsUpdate = true;
  });
}

/** Editor-only helpers (ground grid, model frame grid, selection, wire and hover boxes), hidden when exporting frames. */
export function createOverlays(scene: THREE.Scene) {
  const root = new THREE.Group();
  let grid = new THREE.GridHelper(GRID_EXTENT, GRID_EXTENT / GRID_CELL);
  grid.rotation.x = Math.PI / 2;
  const selectionMaterial = new THREE.LineBasicMaterial({ depthTest: false, transparent: true });
  const selectionBoxes = new THREE.Group();
  const wireBoxes = new THREE.Group();
  const hover = wireBox(HOVER_COLOR);
  const frameGrid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }));
  frameGrid.matrixAutoUpdate = false;
  frameGrid.visible = false;
  let frameGridKey = '';
  const outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: HOVER_COLOR, depthTest: false, transparent: true }));
  outline.matrixAutoUpdate = false;
  outline.renderOrder = 1;
  outline.visible = false;
  root.add(grid, selectionBoxes, wireBoxes, hover, frameGrid, outline);
  scene.add(root);

  const createSelectionBox = () => {
    const box = wireBox(0xffffff);
    box.material = selectionMaterial;
    return box;
  };

  return {
    /** One box per selected object. */
    showSelection(objects: BoxedObject[]) {
      placeBoxes(selectionBoxes, objects, createSelectionBox);
    },
    /** MagicaVoxel `rm_b_wire`: a faint box around every object in the world editor. */
    showWires(objects: BoxedObject[]) {
      placeBoxes(wireBoxes, objects, () => wireBox(WIRE_COLOR, WIRE_OPACITY));
    },
    /** Highlights one cell, or the box between two cells while a box stroke is being dragged. */
    showHover(objectMatrix: THREE.Matrix4 | null, size: Vec3 = [1, 1, 1], from: Vec3 = [0, 0, 0], to: Vec3 = from) {
      hover.visible = objectMatrix !== null;
      if (objectMatrix) hover.matrix.copy(cellBox(objectMatrix, size, from, to));
      hover.matrixWorldNeedsUpdate = true;
    },
    /** Segments in model cell coordinates (a face region's border); null hides them. */
    showOutline(object: BoxedObject | null, segments: number[] = []) {
      outline.visible = object !== null && segments.length > 0;
      if (!object) return;
      const pivot = modelPivot(object.size);
      outline.geometry.dispose();
      outline.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
      outline.matrix.copy(object.matrix).multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
      outline.matrixWorldNeedsUpdate = true;
    },
    /** The edited model's floor grid every `spacing` cells (MagicaVoxel `rm_space`); null hides it. */
    showFrameGrid(object: BoxedObject | null, spacing: number) {
      frameGrid.visible = object !== null;
      if (!object) return;
      const key = `${object.size}|${spacing}`;
      if (key !== frameGridKey) {
        frameGrid.geometry.dispose();
        frameGrid.geometry = floorGridGeometry(object.size, Math.max(1, spacing));
        frameGridKey = key;
      }
      frameGrid.matrix.copy(object.matrix);
      frameGrid.matrixWorldNeedsUpdate = true;
    },
    setVisible(visible: boolean) {
      root.visible = visible;
    },
    setGridVisible(visible: boolean) {
      grid.visible = visible;
    },
    /** MagicaVoxel `rm_grid_col` and `rm_sel_col`. */
    setColors(gridColor: string, selectionColor: string) {
      const line = new THREE.Color(gridColor);
      const visible = grid.visible;
      root.remove(grid);
      grid.dispose();
      grid = new THREE.GridHelper(GRID_EXTENT, GRID_EXTENT / GRID_CELL, line.clone().multiplyScalar(GRID_AXIS_LIFT), line);
      grid.rotation.x = Math.PI / 2;
      grid.visible = visible;
      root.add(grid);
      frameGrid.material.color.copy(line);
      selectionMaterial.color.set(selectionColor);
    },
  };
}
