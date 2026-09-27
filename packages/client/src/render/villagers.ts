import * as THREE from 'three/webgpu';
import { BUILDING_DEFS, ROLE_DEFS, type Building, type GameState, type RoleId, type Villager } from '@cow/shared';
import { mat } from './meshes';
import { cellToWorld } from './coords';

// Representación visual de los aldeanos. Es solo cosmética: la simulación no
// conoce posiciones de aldeanos en la aldea (sí las tendrá en la fase RTS).

const TUNIC: Record<RoleId | 'civil', string> = {
  civil: '#9c7a54',
  warrior: '#b03a2e',
  archer: '#3f7d3a',
  healer: '#f1efe6',
};

const SPEED = 1.6;

interface Agent {
  root: THREE.Group;
  body: THREE.Mesh;
  accessory: THREE.Mesh | null;
  target: THREE.Vector3;
  wait: number;
  anchorKey: string;
  lookKey: string;
  phase: number;
}

type Anchor = { center: THREE.Vector3; radius: number; inside: boolean };

export class VillagerAgents {
  readonly group = new THREE.Group();
  private agents = new Map<number, Agent>();
  private headGeo = new THREE.SphereGeometry(0.11, 10, 8);
  private bodyGeo = new THREE.CylinderGeometry(0.1, 0.16, 0.45, 8);

  update(state: GameState, dt: number): void {
    const alive = new Set<number>();
    for (const v of state.villagers) {
      alive.add(v.id);
      let agent = this.agents.get(v.id);
      if (!agent) agent = this.spawn(state, v);
      this.updateLook(agent, v);
      this.step(state, agent, v, dt);
    }
    for (const [id, agent] of this.agents) {
      if (!alive.has(id)) {
        this.group.remove(agent.root);
        this.agents.delete(id);
      }
    }
  }

  private spawn(state: GameState, v: Villager): Agent {
    const root = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, mat(TUNIC.civil));
    body.position.y = 0.225;
    body.castShadow = true;
    const head = new THREE.Mesh(this.headGeo, mat('#f0c8a0'));
    head.position.y = 0.55;
    head.castShadow = true;
    root.add(body, head);
    const th = state.buildings.find((b) => b.type === 'townHall');
    const start = th ? anchorOf(th).center : new THREE.Vector3();
    root.position.copy(start);
    const agent: Agent = { root, body, accessory: null, target: start.clone(), wait: 0, anchorKey: '', lookKey: '', phase: Math.random() * 10 };
    this.group.add(root);
    this.agents.set(v.id, agent);
    return agent;
  }

  private updateLook(agent: Agent, v: Villager): void {
    const key = `${v.role}`;
    if (agent.lookKey === key) return;
    agent.lookKey = key;
    agent.body.material = mat(TUNIC[v.role ?? 'civil']);
    if (agent.accessory) agent.root.remove(agent.accessory);
    agent.accessory = null;
    if (v.role === 'warrior') {
      agent.accessory = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), mat('#c9ccd1', { roughness: 0.3 }));
      agent.accessory.position.set(0.2, 0.35, 0.05);
    } else if (v.role === 'archer') {
      agent.accessory = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.015, 4, 12, Math.PI), mat('#6b4a2b'));
      agent.accessory.position.set(0.18, 0.35, 0);
      agent.accessory.rotation.set(0, Math.PI / 2, Math.PI / 2);
    } else if (v.role === 'healer') {
      agent.accessory = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), mat('#d4a93a'));
      agent.accessory.position.set(0.2, 0.3, 0);
    }
    if (agent.accessory) agent.root.add(agent.accessory);
  }

  private step(state: GameState, agent: Agent, v: Villager, dt: number): void {
    const { key, anchor } = anchorFor(state, v);
    if (key !== agent.anchorKey) {
      agent.anchorKey = key;
      agent.target = pickPoint(anchor);
      agent.wait = 0;
    }
    const pos = agent.root.position;
    const to = new THREE.Vector3(agent.target.x - pos.x, 0, agent.target.z - pos.z);
    const dist = to.length();
    if (dist > 0.05) {
      const move = Math.min(dist, SPEED * dt);
      pos.addScaledVector(to.normalize(), move);
      agent.root.rotation.y = Math.atan2(to.x, to.z);
      agent.phase += dt * 12;
      pos.y = Math.abs(Math.sin(agent.phase)) * 0.06;
    } else {
      pos.y = 0;
      agent.wait -= dt;
      if (agent.wait <= 0) {
        agent.target = pickPoint(anchor);
        agent.wait = 1 + Math.random() * 3;
      }
    }
  }
}

function anchorOf(b: Building, inside = false): Anchor {
  const size = BUILDING_DEFS[b.type].size;
  const c = cellToWorld(b.x, b.y, size);
  return { center: new THREE.Vector3(c.x, 0, c.z), radius: size / 2, inside };
}

/** Lugar alrededor del cual se mueve un aldeano según su tarea. */
function anchorFor(state: GameState, v: Villager): { key: string; anchor: Anchor } {
  const t = v.task;
  const byId = (id: number) => state.buildings.find((b) => b.id === id);
  let b: Building | undefined;
  let inside = false;
  if (t.kind === 'work' || t.kind === 'train') {
    b = byId(t.buildingId);
    inside = true;
  } else if (t.kind === 'build') {
    b = byId(t.buildingId);
  } else if (v.role) {
    // Los soldados montan guardia junto a su edificio de entrenamiento.
    b = state.buildings.find((x) => x.type === ROLE_DEFS[v.role!].trainedAt);
  }
  b ??= state.buildings.find((x) => x.type === 'townHall');
  if (!b) return { key: 'none', anchor: { center: new THREE.Vector3(), radius: 3, inside: false } };
  const anchor = anchorOf(b, inside);
  if (t.kind === 'idle' && !v.role) anchor.radius += 2.5; // los civiles libres pasean
  return { key: `${t.kind}:${b.id}:${b.x}:${b.y}`, anchor };
}

function pickPoint(a: Anchor): THREE.Vector3 {
  const p = a.center.clone();
  if (a.inside) {
    p.x += (Math.random() - 0.5) * a.radius * 1.6;
    p.z += (Math.random() - 0.5) * a.radius * 1.6;
  } else {
    // Un punto en el perímetro, justo fuera de la huella.
    const r = a.radius + 0.35;
    const side = Math.floor(Math.random() * 4);
    const t = (Math.random() * 2 - 1) * r;
    p.x += side === 0 ? -r : side === 1 ? r : t;
    p.z += side === 2 ? -r : side === 3 ? r : t;
  }
  return p;
}
