# Voxel Editor

A browser-based voxel editor with animation, built for Linux. It reads and writes [MagicaVoxel](https://ephtracy.github.io/)'s `.vox` format, including the animation keys the [public spec](https://github.com/ephtracy/voxel-model) leaves out, and reproduces MagicaVoxel 0.99.7's shortcuts, panels and path tracer.

The format and the animation evaluation come from reverse engineering the binary, documented in [`docs/magicavoxel-re.md`](docs/magicavoxel-re.md). The road to 1:1 parity is tracked in [`docs/roadmap-v1.md`](docs/roadmap-v1.md). Both documents are in Brazilian Portuguese.

> An independent project, not affiliated with MagicaVoxel or its author. No MagicaVoxel code or binaries are distributed here.

![The editor in Model mode, with the palette and brushes on the left and the object operations on the right](docs/editor.webp)

![The same scene in the path tracer, under an atmospheric sky](docs/render.webp)

## Features

- **`.vox` v200** with round-trip of animation keys, cameras (`rCAM`), render settings (`rOBJ`), materials (`MATL`), notes and unknown chunks.
- **Model mode:** voxel, face, box and geometry brushes; mirror and axis modes; selection, copy/paste, a move/scale/rotate gizmo; operations such as `rot90`, `flip`, `flood`, `shrink`, primitives, noise and mazes.
- **World mode:** multi-selection, groups, references, booleans, alignment and 8 layers.
- **Animation:** transform keys and model frames, a timeline with multi-selection, onion skin, global time, packing models into an animation.
- **Palette and materials:** HSV/RGB picker, gradients, `.png`/`.act` import and export; diffuse, emissive, metal, glass, cloud and media.
- **XS shaders** on the GPU with MagicaVoxel's API; its 7 sample shaders run unchanged.
- **Path tracer:** progressive, in WebGL2 (`F2`), with sun, atmospheric sky and `.hdr` IBL, fog, media with SSS, GGX with MIS, area lights on emissive faces, depth of field, bloom and denoising. Exports stills, turntables and animations.
- **Import/export:** `obj`, `ply`, `mc`, `qb`, `xraw`, `slab`, `iso`, `.png` sprites, sprite sheets and more.
- **In-browser projects:** a project list in IndexedDB, plus autosave every 3 s with recovery on reopen.
- **Interface in English, Spanish and Brazilian Portuguese:** follows the browser language; the picker in the toolbar switches it.

## Getting started

Requires Node 22+, pnpm and a browser with WebGL2. In Chromium, the **Fullscreen** button uses the Keyboard Lock API so `Ctrl+N`, `Ctrl+T` and `Ctrl+W` reach the editor.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production build into dist/
```

## Usage

Shortcuts follow MagicaVoxel 0.99.7's `config/hotkey.txt`. The **Shortcuts** (`?`) button lists them all inside the app.

The editor has two modes. **Model** edits the voxels of the selected object, with the others dimmed in the background. **World** arranges and animates objects. Switch with `Tab` (viewport focused), the buttons at the top, or a double click: on an object it enters the model, on empty space it returns to the world.

To animate:

1. Draw in Model mode.
2. Go to another frame and press `F5`. In Model mode this creates a model frame, an editable copy (`O` toggles onion skin). In World mode it creates a position key: move with the arrow keys or by dragging, rotate with `+`/`-`.
3. Save with **Save** (`.vox`, opens in MagicaVoxel) or export with **Sprite sheet** (a PNG of the frame range).

### Main shortcuts

| Action | Shortcut |
|---|---|
| Orbit / pan / zoom | right / middle button / wheel, or `Space`/`Z`/`K` + drag with the left button |
| Recenter / face view / save image | `5` / `Ctrl+5` / `6` |
| Camera: save / load / slot | `7` / `8` / numpad; perspective, free (`WASDQE`), orthographic and isometric in the viewport corner |
| Show grid / edges / background / frame | `Ctrl+G` / `Ctrl+E` / `Ctrl+B` / `Ctrl+F` |
| Path tracer | `F2` |
| Key: add / remove | `F5` / `F6` (model frame in Model mode, position in World mode) |
| Previous / next frame; previous / next key | `,` `.`; `Ctrl+,` `Ctrl+.` (`+Shift` jumps to the first/last) |
| **Model:** voxel / face / box / geometry brush | `V` / `F` / `B` / `L` |
| **Model:** voxel brush size | `-` / `+` |
| **Model:** attach / erase / paint | `T` / `R` / `G` |
| **Model:** mirror X / Y / Z | `1` / `2` / `3` |
| **Model:** axis mode X / Y / Z (the stroke goes through the model) | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| **Model:** fill / paint all / clear | `U` / `I` / `Delete` |
| **Model:** pick color | `Alt` + click |
| **World:** move object | drag, arrow keys, `PageUp`/`PageDown` |
| **World:** rotate 90° around Z / X | `+` `-` / `9` `0` |
| **World:** drop to ground / hide / deselect | `G` / `Ctrl+H` / `Ctrl+D` |
| **World:** new / delete object | `Ctrl+N` (fullscreen only; the browser reserves it) / `Delete` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| New / open / save / save as | `Ctrl+P` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` (or drop a `.vox`) |

- The **Brush** panel on the left holds each mode's options and the region actions: eyedropper, remove and replace region.
- The panel on the right renames, resizes (every model frame; the world position is kept), rotates, mirrors, duplicates and deletes the selected object. In the list, `●`/`◌` shows/hides and `◆` marks animated objects.
- Every edit, palette changes included, goes into undo.

## Tests

```sh
pnpm test                   # vitest
pnpm typecheck
python3 tools/vox_anim.py   # self-check of the reference animation implementation
```

If a `MagicaVoxel-0.99.7.2-win64/` folder exists at the root (it is not versioned), the tests also round-trip every sample `.vox` that ships with MagicaVoxel.

## Layout

```
src/format/       .vox (types, reader, writer), rotation, import and export formats
src/scene/        keyframe and scene-graph evaluation (port of MagicaVoxel's)
src/geometry/     meshing in 32³ chunks and DDA raycasting, independent of three.js
src/render/       three.js viewport, cameras, palette-texture material, mesh cache, XS shaders
src/render/path-tracer/  WebGL2 path tracer: scene volume, materials, emitters, IBL
src/editor/       state and events, history, tools, model, world, palette and animation commands
src/ui/           one module per panel
src/i18n/         t()/tn() and the catalog: Portuguese source text to English and Spanish, by area
tools/vox_anim.py Python reference implementation of the parser and animation evaluation
```

## License

[MIT](LICENSE). MagicaVoxel is software by [ephtracy](https://ephtracy.github.io/); this project only reads and writes the `.vox` format for interoperability.
