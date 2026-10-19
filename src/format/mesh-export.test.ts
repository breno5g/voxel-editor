import { describe, expect, it } from 'vitest';
import { createDefaultPalette } from './defaults.ts';
import { DEFAULT_MESH_OPTIONS, exportMesh, smoothFaces, voxelFaces } from './mesh-export.ts';
import { createModel } from './vox.ts';

const bar = () => {
  const model = createModel([2, 1, 1]);
  model.voxels.set([5, 5]);
  return model;
};

describe('mesh export', () => {
  it('merges coplanar faces of one colour, or keeps one quad per voxel face', () => {
    expect(voxelFaces(bar(), true)).toHaveLength(6);
    expect(voxelFaces(bar(), false)).toHaveLength(10);
    const split = bar();
    split.voxels[1] = 6;
    expect(voxelFaces(split, true)).toHaveLength(10);
  });

  it('winds every quad counter-clockwise seen from outside', () => {
    for (const { corners } of voxelFaces(bar(), true)) {
      const [a, b, c] = corners;
      const normal = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const center = [0, 1, 2].map((axis) => corners.reduce((sum, corner) => sum + corner[axis] / 4, 0));
      const outward = center.map((value, axis) => value - [1, 0.5, 0.5][axis]);
      expect(normal.reduce((dot, value, axis) => dot + value * outward[axis], 0)).toBeGreaterThan(0);
    }
  });

  it('wraps a lone voxel in six smoothed quads facing out', () => {
    const model = createModel([1, 1, 1]);
    model.voxels[0] = 1;
    const faces = smoothFaces(model);
    expect(faces).toHaveLength(6);
    for (const { corners } of faces) {
      const [a, b, c] = corners;
      const normal = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const center = [0, 1, 2].map((axis) => corners.reduce((sum, corner) => sum + corner[axis] / 4, 0) - 0.5);
      expect(normal.reduce((dot, value, axis) => dot + value * center[axis], 0)).toBeGreaterThan(0);
    }
  });

  it('writes OBJ with a palette texture, and PLY with colours, Y up and scaled', () => {
    const objects = [{ name: 'bar', model: bar(), pose: null }];
    const [obj, mtl] = exportMesh('obj', 'scene', objects, createDefaultPalette());
    expect(mtl.data).toContain('map_Kd scene.png');
    expect(String(obj.data).match(/^f /gm)).toHaveLength(6);
    expect(String(obj.data)).toContain('v 0.2 0.1 -0.1');
    const [ply] = exportMesh('ply', 'scene', objects, createDefaultPalette(), { ...DEFAULT_MESH_OPTIONS.ply, scale: 1 });
    expect(String(ply.data)).toContain('element face 6');
    expect(String(ply.data)).toContain('2 1 1 255 255 51');
    const [cloud] = exportMesh('pcl', 'scene', objects, createDefaultPalette());
    expect(String(cloud.data)).toContain('element vertex 2');
  });
});
