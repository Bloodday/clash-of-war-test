import * as THREE from 'three/webgpu';

/**
 * Convierte un modelo (varias mallas) en un conjunto de InstancedMesh para
 * dibujar cientos de copias con una draw call por malla.
 */
export class InstancedModel {
  readonly group = new THREE.Group();
  private parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  private count = 0;
  private tmp = new THREE.Matrix4();

  constructor(
    model: THREE.Object3D,
    private capacity: number,
    materialFor?: (m: THREE.Material) => THREE.Material,
  ) {
    model.updateMatrixWorld(true);
    const rootInv = model.matrixWorld.clone().invert();
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const material = materialFor ? materialFor(o.material as THREE.Material) : (o.material as THREE.Material);
      const mesh = new THREE.InstancedMesh(o.geometry, material, capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.parts.push({ mesh, local: rootInv.clone().multiply(o.matrixWorld) });
      this.group.add(mesh);
    });
  }

  add(matrix: THREE.Matrix4): void {
    if (this.count >= this.capacity) return;
    for (const p of this.parts) {
      p.mesh.setMatrixAt(this.count, this.tmp.multiplyMatrices(matrix, p.local));
      p.mesh.count = this.count + 1;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    this.count++;
  }

  set castShadow(v: boolean) {
    for (const p of this.parts) p.mesh.castShadow = v;
  }
}
