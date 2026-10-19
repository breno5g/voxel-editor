import * as THREE from 'three';
import { modelPivot } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import type { Axis } from '../format/rotation.ts';
import { raycastPlane, raycastVoxels } from '../geometry/raycast.ts';
import type { VoxelHit } from '../geometry/raycast.ts';
import type { Instance, Pose } from '../scene/scene-graph.ts';
import { createCameraRig } from './camera-rig.ts';
import type { ImageTarget } from './image-export.ts';
import { createModelCache } from './model-cache.ts';
import { createOverlays } from './overlays.ts';
import { createVoxelMaterial } from './voxel-material.ts';

export type Viewport = ReturnType<typeof createViewport>;
export type ViewportPick = { transformId: number; hit: VoxelHit };

type ObjectView = { group: THREE.Group; model: VoxModel | null };
export type ViewportDisplay = { grid: boolean; frame: boolean; edges: boolean; backgroundObjects: boolean };
type Ghost = { transformId: number; model: VoxModel };
type ModelRay = { origin: Vec3; direction: Vec3 };

const BACKGROUND = 0x2b2d33;

function poseMatrix({ rows, translation }: Pose): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    rows[0], rows[1], rows[2], translation[0],
    rows[3], rows[4], rows[5], translation[1],
    rows[6], rows[7], rows[8], translation[2],
    0, 0, 0, 1,
  );
}

const toVec3 = (vector: THREE.Vector3): Vec3 => [vector.x, vector.y, vector.z];

/**
 * three.js scene for the editor. Renders on demand (camera moves and explicit
 * requests) instead of every animation frame.
 */
export function createViewport(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const rig = createCameraRig(renderer.domElement, () => requestRender());

  // Raw sRGB components: the shader writes its output without colour management, like the clear colour appears.
  const { material, backgroundMaterial, ghostMaterial, setPalette, setEdges } = createVoxelMaterial(
    new THREE.Color().setHex(BACKGROUND, THREE.LinearSRGBColorSpace),
  );
  const modelCache = createModelCache();
  const overlays = createOverlays(scene);
  const views = new Map<number, ObjectView>();
  const raycaster = new THREE.Raycaster();
  const ghostGroup = new THREE.Group();
  ghostGroup.matrixAutoUpdate = false;
  ghostGroup.renderOrder = 2;
  scene.add(ghostGroup);
  let ghost: Ghost | null = null;
  let selectedId: number | null = null;
  /** The object being edited in model mode; every other object is background. */
  let focusId: number | null = null;
  let display: ViewportDisplay = { grid: true, frame: true, edges: false, backgroundObjects: true };
  let exporting = false;
  let renderQueued = false;

  const render = () => renderer.render(scene, rig.camera());
  const requestRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  };
  new ResizeObserver(() => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    rig.setAspect(container.clientWidth / Math.max(container.clientHeight, 1));
    render();
  }).observe(container);

  const fillGroup = (group: THREE.Group, model: VoxModel, meshMaterial: THREE.Material) => {
    group.clear();
    for (const { geometry, offset } of modelCache.chunks(model)) {
      const mesh = new THREE.Mesh(geometry, meshMaterial);
      mesh.position.set(...offset);
      group.add(mesh);
    }
  };

  /** Background objects are faded, or hidden when `backgroundObjects` is off; exports draw everything plainly. */
  const styleView = (transformId: number, view: ObjectView) => {
    const isBackground = !exporting && focusId !== null && transformId !== focusId;
    view.group.visible = !isBackground || display.backgroundObjects;
    view.group.children.forEach((child) => {
      if (child instanceof THREE.Mesh) child.material = isBackground ? backgroundMaterial : material;
    });
  };

  const showModel = (transformId: number, view: ObjectView, model: VoxModel) => {
    view.model = model;
    fillGroup(view.group, model, material);
    styleView(transformId, view);
  };

  /** Keeps the onion-skin ghost on its object's current pose. */
  const placeGhost = () => {
    const view = ghost && views.get(ghost.transformId);
    ghostGroup.visible = Boolean(view);
    if (!view) return;
    ghostGroup.matrix.copy(view.group.matrix);
    ghostGroup.matrixWorldNeedsUpdate = true;
  };

  /** The selection box doubles as the model frame in model mode, where `frame` toggles it. */
  const updateSelection = () => {
    const view = selectedId === null || (focusId !== null && !display.frame) ? undefined : views.get(selectedId);
    overlays.showSelection(view?.model ? view.group.matrix : null, view?.model?.size);
  };

  const restyle = () => {
    views.forEach((view, transformId) => styleView(transformId, view));
    updateSelection();
    requestRender();
  };

  /** Points the raycaster through a client-space position. */
  const aim = (clientX: number, clientY: number) => {
    const bounds = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, rig.camera());
  };

  const modelRay = (view: ObjectView, clientX: number, clientY: number): ModelRay | null => {
    if (!view.model) return null;
    aim(clientX, clientY);
    const inverse = view.group.matrix.clone().invert();
    const pivot = new THREE.Vector3(...modelPivot(view.model.size));
    return {
      origin: toVec3(raycaster.ray.origin.clone().applyMatrix4(inverse).add(pivot)),
      direction: toVec3(raycaster.ray.direction.clone().transformDirection(inverse)),
    };
  };

  /** Client-space position of a model-space point of object `transformId`. */
  const project = (transformId: number, point: Vec3): [number, number] | null => {
    const view = views.get(transformId);
    if (!view?.model) return null;
    const pivot = modelPivot(view.model.size);
    const ndc = new THREE.Vector3(point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]).applyMatrix4(view.group.matrix).project(rig.camera());
    const bounds = renderer.domElement.getBoundingClientRect();
    return [bounds.left + ((ndc.x + 1) / 2) * bounds.width, bounds.top + ((1 - ndc.y) / 2) * bounds.height];
  };

  /** Nearest voxel under the pointer across every visible object, or only object `only`. */
  const pick = (clientX: number, clientY: number, only?: number): ViewportPick | null => {
    let nearest: ViewportPick | null = null;
    for (const [transformId, view] of views) {
      if ((only !== undefined && transformId !== only) || !view.group.visible) continue;
      const ray = view.model && modelRay(view, clientX, clientY);
      const hit = ray && view.model ? raycastVoxels(view.model, ray.origin, ray.direction) : null;
      if (hit && (!nearest || hit.distance < nearest.hit.distance)) nearest = { transformId, hit };
    }
    return nearest;
  };

  // Ahead of OrbitControls' wheel handler on the canvas: cursor zoom closes in on the voxel under the cursor.
  // Over empty space the target stays, as a far floor point would fling the camera away.
  // Poses are rigid, so model-space hit distances are world distances.
  container.addEventListener(
    'wheel',
    (event) => {
      if (rig.wheelZoom() !== 'cursor') return;
      const nearest = pick(event.clientX, event.clientY);
      if (!nearest) return;
      aim(event.clientX, event.clientY);
      rig.focusDepth(raycaster.ray.at(nearest.hit.distance, new THREE.Vector3()));
    },
    { capture: true, passive: true },
  );

  /** The model cell of `layer` under the pointer, on the model-space plane `axis = plane`. */
  const planeCell = (clientX: number, clientY: number, transformId: number, axis: Axis, plane: number, layer: number): Vec3 | null => {
    const view = views.get(transformId);
    const ray = view && modelRay(view, clientX, clientY);
    return view?.model && ray ? raycastPlane(view.model, ray.origin, ray.direction, axis, plane, layer) : null;
  };

  return {
    canvas: renderer.domElement,
    requestRender,

    setPalette(palette: Uint8Array) {
      setPalette(palette);
      requestRender();
    },

    /** Places one group per visible object; geometry is only touched when the displayed model changes. */
    syncInstances(instances: Instance[], models: VoxModel[]) {
      const visible = new Set<number>();
      for (const instance of instances) {
        visible.add(instance.transformId);
        let view = views.get(instance.transformId);
        if (!view) {
          const group = new THREE.Group();
          group.matrixAutoUpdate = false;
          scene.add(group);
          view = { group, model: null };
          views.set(instance.transformId, view);
        }
        const model = models[instance.model];
        if (view.model !== model) showModel(instance.transformId, view, model);
        view.group.matrix.copy(poseMatrix(instance.pose));
        view.group.matrixWorldNeedsUpdate = true;
      }
      for (const [transformId, view] of views) {
        if (visible.has(transformId)) continue;
        scene.remove(view.group);
        views.delete(transformId);
      }
      updateSelection();
      placeGhost();
      requestRender();
    },

    refreshModel(model: VoxModel, chunks: Iterable<number>) {
      modelCache.update(model, chunks);
      views.forEach((view, transformId) => {
        if (view.model === model) showModel(transformId, view, model);
      });
      if (ghost?.model === model) fillGroup(ghostGroup, model, ghostMaterial);
      requestRender();
    },

    /** Shows `model` translucent on top of object `transformId` (onion skin); null hides it. */
    setGhost(transformId: number | null, model: VoxModel | null) {
      const next = transformId === null || !model ? null : { transformId, model };
      if (next?.model !== ghost?.model) {
        if (next) fillGroup(ghostGroup, next.model, ghostMaterial);
        else ghostGroup.clear();
      }
      ghost = next;
      placeGhost();
      requestRender();
    },

    /** Model mode edits `transformId` and treats the rest as background; null is world mode. */
    setFocus(transformId: number | null) {
      focusId = transformId;
      restyle();
    },

    setDisplay(next: ViewportDisplay) {
      display = { ...next };
      overlays.setGridVisible(display.grid);
      setEdges(display.edges);
      restyle();
    },

    reset() {
      views.forEach((view) => scene.remove(view.group));
      views.clear();
      ghostGroup.clear();
      ghost = null;
      modelCache.clear();
      overlays.showHover(null);
      requestRender();
    },

    /** Camera modes, framing, face view, free flight and saved states. */
    camera: rig,

    /** Recentres the camera on every given pose. */
    frameAll(instances: Instance[], models: VoxModel[]) {
      const bounds = new THREE.Box3();
      for (const { pose, model } of instances) {
        const center = new THREE.Vector3(...pose.translation);
        bounds.union(new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(...models[model].size)));
      }
      rig.frame(bounds);
    },

    setSelection(transformId: number | null) {
      selectedId = transformId;
      updateSelection();
      requestRender();
    },

    /** Outlines a cell, or the box from `cell` to `boxEnd`, in the object's model space. */
    showHover(transformId: number | null, cell?: Vec3, boxEnd?: Vec3) {
      const view = transformId === null ? undefined : views.get(transformId);
      overlays.showHover(view?.model && cell ? view.group.matrix : null, view?.model?.size, cell, boxEnd ?? cell);
      requestRender();
    },

    pick,

    /** Where the pointer ray crosses the horizontal plane at height `z`, in world space. */
    planePoint(clientX: number, clientY: number, z: number): Vec3 | null {
      aim(clientX, clientY);
      const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3());
      return point && toVec3(point);
    },

    planeCell,
    project,

    floorCell: (clientX: number, clientY: number, transformId: number) => planeCell(clientX, clientY, transformId, 2, 0, 0),

    imageTarget: {
      renderer,
      scene,
      camera: rig.camera,
      aspect: rig.aspect,
      setAspect: rig.setAspect,
      setOverlaysVisible: (visible: boolean) => {
        overlays.setVisible(visible);
        exporting = !visible;
        views.forEach((view, transformId) => styleView(transformId, view));
        if (visible) placeGhost();
        else ghostGroup.visible = false;
      },
    } satisfies ImageTarget,
  };
}
