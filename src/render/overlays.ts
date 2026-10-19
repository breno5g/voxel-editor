import * as THREE from 'three';
import { modelPivot } from '../format/vox.ts';
import type { Vec3 } from '../format/vox.ts';

const GRID_EXTENT = 256;
const GRID_CELL = 8;
const GRID_COLORS = { axis: 0x5a5e68, line: 0x34373e };
const SELECTION_COLOR = 0xffaa33;
const HOVER_COLOR = 0xffffff;

function wireBox(color: number): THREE.LineSegments {
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
  );
  box.matrixAutoUpdate = false;
  box.renderOrder = 1;
  box.visible = false;
  return box;
}

/** Editor-only helpers (ground grid, selection and hover boxes), hidden when exporting frames. */
export function createOverlays(scene: THREE.Scene) {
  const root = new THREE.Group();
  const grid = new THREE.GridHelper(GRID_EXTENT, GRID_EXTENT / GRID_CELL, GRID_COLORS.axis, GRID_COLORS.line);
  grid.rotation.x = Math.PI / 2;
  const selection = wireBox(SELECTION_COLOR);
  const hover = wireBox(HOVER_COLOR);
  root.add(grid, selection, hover);
  scene.add(root);

  const place = (box: THREE.LineSegments, matrix: THREE.Matrix4 | null) => {
    box.visible = matrix !== null;
    if (matrix) box.matrix.copy(matrix);
    box.matrixWorldNeedsUpdate = true;
  };

  /** Unit box stretched over the model-space cells [from, to] (inclusive), relative to the pivot. */
  const cellBox = (objectMatrix: THREE.Matrix4, size: Vec3, from: Vec3, to: Vec3) => {
    const pivot = modelPivot(size);
    const low = from.map((axis, i) => Math.min(axis, to[i]) - pivot[i]);
    const extent = from.map((axis, i) => Math.abs(axis - to[i]) + 1);
    return objectMatrix
      .clone()
      .multiply(new THREE.Matrix4().makeTranslation(low[0] + extent[0] / 2, low[1] + extent[1] / 2, low[2] + extent[2] / 2))
      .multiply(new THREE.Matrix4().makeScale(extent[0], extent[1], extent[2]));
  };

  return {
    /** `objectMatrix` is the object's world pose; the model pivot sits on it. */
    showSelection(objectMatrix: THREE.Matrix4 | null, size: Vec3 = [1, 1, 1]) {
      place(selection, objectMatrix && cellBox(objectMatrix, size, [0, 0, 0], [size[0] - 1, size[1] - 1, size[2] - 1]));
    },
    /** Highlights one cell, or the box between two cells while a box stroke is being dragged. */
    showHover(objectMatrix: THREE.Matrix4 | null, size: Vec3 = [1, 1, 1], from: Vec3 = [0, 0, 0], to: Vec3 = from) {
      place(hover, objectMatrix && cellBox(objectMatrix, size, from, to));
    },
    setVisible(visible: boolean) {
      root.visible = visible;
    },
    setGridVisible(visible: boolean) {
      grid.visible = visible;
    },
  };
}
