import * as THREE from 'three/webgpu';
import { float, mix, mrt, normalView, output, pass, renderOutput, screenUV, smoothstep, vec4, vibrance } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';

// Postprocesado con TSL (funciona igual en WebGPU y en el fallback WebGL 2).

export type Quality = 'high' | 'medium' | 'low';

export const QUALITY_LABELS: Record<Quality, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };

export class PostFX {
  private pipeline: THREE.RenderPipeline | null = null;
  quality: Quality = 'high';

  constructor(
    private renderer: THREE.WebGPURenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {}

  setQuality(q: Quality): void {
    this.quality = q;
    this.pipeline?.dispose();
    this.pipeline = null;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    if (q === 'low') return;

    const pipeline = new THREE.RenderPipeline(this.renderer);
    pipeline.outputColorTransform = false;
    const scenePass = pass(this.scene, this.camera);
    let color;
    if (q === 'high') {
      scenePass.setMRT(mrt({ output, normal: normalView }));
      const col = scenePass.getTextureNode('output');
      const aoPass = ao(scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), this.camera);
      aoPass.resolutionScale = 0.5;
      const occlusion = mix(float(1), aoPass.getTextureNode().r, 0.8);
      color = col.rgb.mul(occlusion).add(bloom(col, 0.32, 0.45, 0.82).rgb);
    } else {
      const col = scenePass.getTextureNode();
      color = col.rgb.add(bloom(col, 0.28, 0.4, 0.85).rgb);
    }
    // Gradación: colores algo más vivos y viñeta suave.
    const vignette = float(1).sub(smoothstep(0.45, 1.05, screenUV.sub(0.5).length().mul(1.35)).mul(0.28));
    const graded = vibrance(color, float(0.12)).mul(vignette);
    const out = renderOutput(vec4(graded, 1));
    pipeline.outputNode = q === 'high' ? smaa(out) : fxaa(out);
    this.pipeline = pipeline;
  }

  render(): void {
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
