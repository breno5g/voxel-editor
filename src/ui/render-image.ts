import * as THREE from 'three';
import type { Editor } from '../editor/editor.ts';
import { zipStore } from '../format/zip.ts';
import type { ZipEntry } from '../format/zip.ts';
import type { PathTracer, TraceView } from '../render/path-tracer/path-tracer.ts';
import type { Viewport } from '../render/viewport.ts';
import { t } from '../i18n/i18n.ts';
import { bindButtonGroup, downloadBlob, element } from './dom.ts';
import type { RenderSession } from './render-panel.ts';

/** MagicaVoxel's final images (`config/ui/r_image.ui`): a photo, a turntable around the focus, or the animation. */
const IMAGE_KINDS = ['photo', 'turntable', 'animation'] as const;
type ImageKind = (typeof IMAGE_KINDS)[number];
type Size = { width: number; height: number };

class Cancelled extends Error {}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('Falha ao gerar o PNG')))), 'image/png'));
const frameName = (index: number) => `frame-${String(index).padStart(4, '0')}.png`;
/** `width×height`, with the frame count when there are several. */
const imageSize = (frames: number, width: number, height: number) => (frames > 1 ? t('{frames} frames de {width}×{height}', { frames, width, height }) : `${width}×${height}`);

/** `camera` turned by `degrees` about the vertical axis through `target`, roll and all. */
function turned(camera: THREE.Camera, target: THREE.Vector3, degrees: number): THREE.Camera {
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(degrees));
  const copy = camera.clone();
  copy.position.sub(target).applyQuaternion(turn).add(target);
  copy.quaternion.premultiply(turn);
  copy.updateMatrixWorld();
  return copy;
}

export function bindRenderImage(editor: Editor, viewport: Viewport, session: RenderSession): void {
  const { state } = editor;
  const number = (id: string) => element(id, HTMLInputElement);
  const inputs = {
    width: number('render-width'),
    height: number('render-height'),
    samples: number('render-spp'),
    spinFrames: number('render-spin-frames'),
    spinAngle: number('render-spin-angle'),
    spinBlur: number('render-spin-blur'),
    animStart: number('render-anim-start'),
    animEnd: number('render-anim-end'),
  };
  const button = element('render-image', HTMLButtonElement);
  const progress = element('render-progress', HTMLProgressElement);
  const summary = element('render-image-summary', HTMLOutputElement);
  const kindPanels = [...document.querySelectorAll<HTMLElement>('[data-image-kind]')];
  let kind: ImageKind = 'photo';
  let job: { cancelled: boolean } | null = null;

  const showKind = bindButtonGroup('render-image-kind', (raw) => IMAGE_KINDS.find((value) => value === raw), (next) => {
    kind = next;
    sync();
  });
  const read = (input: HTMLInputElement) => Math.min(Math.max(Math.round(Number(input.value)) || Number(input.min), Number(input.min)), Number(input.max || Infinity));
  const frameCount = () => (kind === 'turntable' ? read(inputs.spinFrames) : kind === 'animation' ? Math.abs(read(inputs.animEnd) - read(inputs.animStart)) + 1 : 1);
  /** What the button will make: a fresh render, not a copy of the preview. */
  const describe = () => {
    const image = imageSize(frameCount(), read(inputs.width), read(inputs.height));
    summary.value = t('Calculada do zero, à parte da prévia: {image} com {samples} amostras por pixel (a prévia vai até {preview}).', { image, samples: read(inputs.samples), preview: session.previewSamples() });
  };
  const sync = () => {
    showKind(kind);
    kindPanels.forEach((panel) => (panel.hidden = panel.dataset.imageKind !== kind));
    if (!job) describe();
  };
  const baseName = () => state.fileName.replace(/\.vox$/i, '');

  /**
   * Path traces frame `frame` (of `frames`) at `samples` samples, a sample per animation frame so the editor
   * stays responsive, and reports how far it got.
   */
  const renderImage = async (tracer: PathTracer, size: Size, samples: number, viewAt: (sample: number) => TraceView, frame: number, frames: number) => {
    tracer.reset();
    for (let sample = 0; sample < samples; sample++) {
      await nextFrame();
      if (job?.cancelled) throw new Cancelled();
      tracer.trace(viewAt(sample), size, true);
      progress.value = (frame + (sample + 1) / samples) / frames;
      summary.value = frames > 1 ? t('Frame {frame} de {frames} · amostra {sample} de {samples}', { frame: frame + 1, frames, sample: sample + 1, samples }) : t('amostra {sample} de {samples}', { sample: sample + 1, samples });
    }
    tracer.present();
    return toPng(tracer.canvas);
  };

  const run = async () => {
    const tracer = session.prepare();
    if (!tracer) return;
    const size = { width: read(inputs.width), height: read(inputs.height) };
    const samples = read(inputs.samples);
    const live = session.view();
    /* A copy: orbiting the editor camera mid-render must not move the image. */
    const base = { ...live, camera: live.camera.clone() };
    const fixed = () => base;
    const restoreFrame = state.frame;
    job = { cancelled: false };
    session.setBusy(true);
    button.textContent = t('Cancelar');
    progress.hidden = false;
    try {
      if (kind === 'photo') {
        downloadBlob(await renderImage(tracer, size, samples, fixed, 0, 1), `${baseName()}-render.png`);
      } else if (kind === 'turntable') {
        const frames = read(inputs.spinFrames);
        const step = read(inputs.spinAngle) / frames;
        const blur = read(inputs.spinBlur) / 100;
        const target = new THREE.Vector3(...viewport.camera.state().target);
        const entries: ZipEntry[] = [];
        for (let index = 0; index < frames; index++) {
          const viewAt = () => ({ ...base, camera: turned(base.camera, target, step * (index + (Math.random() - 0.5) * blur)) });
          const png = await renderImage(tracer, size, samples, viewAt, index, frames);
          entries.push({ name: frameName(index), data: new Uint8Array(await png.arrayBuffer()) });
        }
        downloadBlob(new Blob([zipStore(entries)], { type: 'application/zip' }), `${baseName()}-turntable.zip`);
      } else {
        const [start, end] = [read(inputs.animStart), read(inputs.animEnd)].sort((a, b) => a - b);
        const entries: ZipEntry[] = [];
        for (let frame = start; frame <= end; frame++) {
          editor.setFrame(frame);
          const ready = session.prepare();
          if (!ready) return;
          const png = await renderImage(ready, size, samples, fixed, frame - start, end - start + 1);
          entries.push({ name: frameName(frame), data: new Uint8Array(await png.arrayBuffer()) });
        }
        downloadBlob(new Blob([zipStore(entries)], { type: 'application/zip' }), `${baseName()}-anim.zip`);
      }
      editor.status(t('Render final salvo: {image}, {samples} amostras por pixel', { image: imageSize(frameCount(), size.width, size.height), samples }));
    } catch (error) {
      if (error instanceof Cancelled) editor.status(t('Render final cancelado'));
      else editor.status(t('Render final: {error}', { error: error instanceof Error ? error.message : String(error) }), 'error');
    } finally {
      if (kind === 'animation') editor.setFrame(restoreFrame);
      job = null;
      session.setBusy(false);
      button.textContent = t('Renderizar');
      progress.hidden = true;
      progress.value = 0;
      describe();
    }
  };

  button.addEventListener('click', () => {
    if (job) job.cancelled = true;
    else void run();
  });
  editor.subscribe((event) => {
    if (event.type !== 'render' && event.type !== 'document') return;
    if (document.activeElement !== inputs.animStart) inputs.animStart.value = String(state.range[0]);
    if (document.activeElement !== inputs.animEnd) inputs.animEnd.value = String(state.range[1]);
    if (!job) describe();
  });
  for (const input of [...Object.values(inputs), element('render-preview-spp', HTMLInputElement)]) {
    for (const type of ['input', 'change']) {
      input.addEventListener(type, () => {
        if (!job) describe();
      });
    }
  }
  sync();
}
