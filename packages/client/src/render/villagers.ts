import * as THREE from 'three/webgpu';
import { BUILDING_DEFS, ROLE_DEFS, TICK_RATE, type Building, type GameState, type RoleId, type Villager } from '@cow/shared';
import type { Assets, CharacterName } from './assets';
import { cellToWorld } from './coords';
import type { Particles } from './particles';

// Aldeanos animados con los personajes riggeados de KayKit. Es solo la capa
// visual: la simulación no conoce su posición dentro de la aldea.

const SCALE = 0.42;
const WALK_SPEED = 1.5;
const RUN_SPEED = 3.2;
const FADE = 0.25;

export interface Look {
  character: CharacterName;
  show: string[];
}

export function lookFor(v: Pick<Villager, "role" | "roleLevel">): Look {
  const l = v.roleLevel;
  switch (v.role) {
    case 'warrior':
      return {
        character: 'Knight',
        show: ['1H_Sword', l >= 3 ? 'Spike_Shield' : l >= 2 ? 'Badge_Shield' : 'Round_Shield', ...(l >= 2 ? ['Knight_Helmet'] : []), ...(l >= 3 ? ['Knight_Cape'] : [])],
      };
    case 'archer':
      return { character: 'Rogue_Hooded', show: ['2H_Crossbow', ...(l >= 2 ? ['Rogue_Cape'] : []), ...(l >= 3 ? ['Knife_Offhand'] : [])] };
    case 'healer':
      return { character: 'Mage', show: ['2H_Staff', ...(l >= 2 ? ['Mage_Hat'] : []), ...(l >= 3 ? ['Mage_Cape'] : [])] };
    case 'builder':
      return { character: 'Barbarian', show: [...(l >= 2 ? ['Barbarian_Hat'] : []), ...(l >= 3 ? ['Barbarian_Cape'] : [])] };
    default:
      // Aldeano sin formar: ropa sencilla, sin armas.
      return { character: 'Rogue', show: [] };
  }
}

export const BODY_PART = /_(ArmLeft|ArmRight|Body|Head|Head_Hooded|LegLeft|LegRight)$/;

type Activity = 'idle' | 'build' | 'repair' | 'train' | 'rest';

interface Agent {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  parts: Map<string, THREE.Object3D>;
  current: string;
  lookKey: string;
  anchorKey: string;
  target: THREE.Vector3;
  facing: THREE.Vector3 | null;
  wait: number;
  arrived: boolean;
  loopClock: number;
  loopIndex: number;
  fxClock: number;
}

export class VillagerAgents {
  readonly group = new THREE.Group();
  private agents = new Map<number, Agent>();
  private tmp = new THREE.Vector3();

  /** Se llama cuando llega un aldeano nuevo (para anunciarlo). */
  onArrive: (v: Villager, at: THREE.Vector3) => void = () => {};

  constructor(
    private assets: Assets,
    private particles: Particles,
  ) {}

  update(state: GameState, dt: number): void {
    const alive = new Set<number>();
    for (const v of state.villagers) {
      alive.add(v.id);
      let agent = this.agents.get(v.id);
      if (!agent) agent = this.spawn(state, v);
      this.updateLook(agent, v);
      this.step(state, agent, v, dt);
      agent.mixer.update(dt);
    }
    for (const [id, agent] of this.agents) {
      if (!alive.has(id)) {
        this.group.remove(agent.root);
        this.agents.delete(id);
      }
    }
  }

  /** Posición de un aldeano (para efectos o para seguirlo con la cámara). */
  positionOf(id: number): THREE.Vector3 | null {
    return this.agents.get(id)?.root.position ?? null;
  }

  private spawn(state: GameState, v: Villager): Agent {
    const root = new THREE.Group();
    // Los recién llegados salen por la puerta de la posada.
    const door = state.buildings.find((b) => b.type === 'inn') ?? state.buildings.find((b) => b.type === 'townHall');
    const start = door ? centerOf(door) : new THREE.Vector3();
    if (door) start.z += BUILDING_DEFS[door.type].size / 2 + 0.4;
    root.position.copy(start);
    const agent: Agent = {
      root,
      model: new THREE.Object3D(),
      mixer: new THREE.AnimationMixer(new THREE.Object3D()),
      actions: new Map(),
      parts: new Map(),
      current: '',
      lookKey: '',
      anchorKey: '',
      target: start.clone(),
      facing: null,
      wait: 0,
      arrived: false,
      loopClock: 0,
      loopIndex: 0,
      fxClock: Math.random(),
    };
    this.group.add(root);
    this.agents.set(v.id, agent);
    if (state.tick > 0 && this.agents.size > 0) {
      this.particles.dust(start.clone().setY(0.1), 0.3, 10);
      this.onArrive(v, start);
    }
    return agent;
  }

  /** Cambia de personaje o de equipo cuando el rol o su nivel cambian. */
  private updateLook(agent: Agent, v: Villager): void {
    const look = lookFor(v);
    const key = `${look.character}:${look.show.join(',')}`;
    if (agent.lookKey === key) return;
    const promoted = agent.lookKey !== '';
    agent.lookKey = key;
    if (agent.model.parent) agent.root.remove(agent.model);
    const model = this.assets.character(look.character);
    model.scale.setScalar(SCALE);
    agent.parts.clear();
    model.traverse((o) => {
      if (o.name && (o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh || o.type === 'Group')) agent.parts.set(o.name, o);
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });
    for (const [name, o] of agent.parts) {
      if (o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh) o.visible = BODY_PART.test(name) || look.show.includes(name);
    }
    agent.root.add(model);
    agent.model = model;
    agent.mixer.stopAllAction();
    agent.mixer = new THREE.AnimationMixer(model);
    agent.actions.clear();
    agent.current = '';
    if (promoted) {
      // ¡Ascenso! Destellos y celebración.
      this.particles.celebrate(agent.root.position.clone().setY(0.4), 0.6);
      this.play(agent, 'Cheer', true);
      agent.wait = 1.6;
    }
  }

  private action(agent: Agent, clip: string): THREE.AnimationAction {
    let a = agent.actions.get(clip);
    if (!a) {
      a = agent.mixer.clipAction(this.assets.clip(clip));
      agent.actions.set(clip, a);
    }
    return a;
  }

  private play(agent: Agent, clip: string, once = false, timeScale = 1): void {
    if (agent.current === clip) return;
    const next = this.action(agent, clip);
    next.reset();
    next.timeScale = timeScale;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    const prev = agent.current ? agent.actions.get(agent.current) : undefined;
    next.play();
    if (prev) next.crossFadeFrom(prev, FADE, false);
    agent.current = clip;
  }

  /** Setup de la tarea: dónde está el ancla y qué hacer al llegar. */
  private plan(state: GameState, v: Villager): { key: string; building: Building | undefined; activity: Activity } {
    const t = v.task;
    const byId = (id: number) => state.buildings.find((b) => b.id === id);
    if (t.kind === 'repair') return { key: `r${t.buildingId}`, building: byId(t.buildingId), activity: 'repair' };
    if (t.kind === 'build') return { key: `b${t.buildingId}`, building: byId(t.buildingId), activity: 'build' };
    if (t.kind === 'train') return { key: `t${t.buildingId}`, building: byId(t.buildingId), activity: 'train' };
    if (t.kind === 'wounded') {
      // Los heridos descansan junto al templo (o el ayuntamiento) hasta recuperarse.
      const rest = state.buildings.find((b) => b.type === 'temple') ?? state.buildings.find((b) => b.type === 'townHall');
      return { key: `w${rest?.id}`, building: rest, activity: 'rest' };
    }
    // Soldados: de guardia junto a su edificio. Sin formar: esperan en la posada.
    // Albañiles libres: pasean de un edificio a otro buscando trabajo.
    const home =
      v.role === 'builder'
        ? state.buildings[(v.id * 7 + Math.floor(state.tick / (TICK_RATE * 12)) * 3) % state.buildings.length]
        : v.role
          ? state.buildings.find((b) => b.type === ROLE_DEFS[v.role!].trainedAt)
          : state.buildings.find((b) => b.type === 'inn');
    return { key: `i${home?.id}`, building: home ?? state.buildings.find((b) => b.type === 'townHall'), activity: 'idle' };
  }

  private step(state: GameState, agent: Agent, v: Villager, dt: number): void {
    const { key, building, activity } = this.plan(state, v);
    const moved = building ? `${key}:${building.x}:${building.y}` : key;
    if (moved !== agent.anchorKey) {
      agent.anchorKey = moved;
      agent.arrived = false;
      agent.wait = Math.min(agent.wait, 0.2);
      if (building) {
        const p = spotFor(building, activity);
        agent.target = p.spot;
        agent.facing = p.face;
      }
    }

    const pos = agent.root.position;
    this.tmp.set(agent.target.x - pos.x, 0, agent.target.z - pos.z);
    const dist = this.tmp.length();
    if (agent.wait > 0) {
      agent.wait -= dt;
      return;
    }

    if (dist > 0.08) {
      const run = dist > 6 && activity !== 'idle';
      this.play(agent, run ? 'Running_A' : 'Walking_A', false, run ? 1 : 1.1);
      const speed = run ? RUN_SPEED : WALK_SPEED;
      pos.addScaledVector(this.tmp.normalize(), Math.min(dist, speed * dt));
      this.turnTowards(agent, Math.atan2(this.tmp.x, this.tmp.z), dt);
      agent.arrived = false;
      return;
    }

    if (!agent.arrived) {
      agent.arrived = true;
      agent.loopClock = 0;
      agent.loopIndex = Math.floor(Math.random() * 3);
    }
    if (agent.facing) {
      this.turnTowards(agent, Math.atan2(agent.facing.x - pos.x, agent.facing.z - pos.z), dt);
    }
    this.perform(agent, v, activity, building, dt);
  }

  private turnTowards(agent: Agent, angle: number, dt: number): void {
    let d = angle - agent.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    agent.root.rotation.y += d * Math.min(1, dt * 10);
  }

  /** Animación en el sitio de trabajo y sus efectos. */
  private perform(agent: Agent, v: Villager, activity: Activity, b: Building | undefined, dt: number): void {
    agent.loopClock += dt;
    agent.fxClock += dt;
    const hand = agent.root.position.clone().add(new THREE.Vector3(Math.sin(agent.root.rotation.y) * 0.3, 0.35, Math.cos(agent.root.rotation.y) * 0.3));
    const show = (name: string, on: boolean) => {
      const p = agent.parts.get(name);
      if (p) p.visible = on;
    };

    if (activity === 'idle') {
      show('Mug', v.role === 'builder');
      // Tras un rato, paseo corto o celebración.
      const cycle = ['Idle', 'Idle', v.role ? 'Cheer' : 'Sit_Floor_Idle'];
      const clip = cycle[agent.loopIndex % cycle.length]!;
      this.play(agent, clip === 'Idle' && !v.role ? 'Unarmed_Idle' : clip);
      if (agent.loopClock > 4 + Math.random() * 3) {
        agent.loopClock = 0;
        agent.loopIndex++;
        if (agent.loopIndex % 2 === 0 && b) {
          agent.target = spotFor(b, 'idle').spot;
          agent.facing = null;
        }
      }
      return;
    }

    show('Mug', false);
    if (activity === 'rest') {
      this.play(agent, 'Sit_Floor_Idle');
      if (agent.fxClock > 2.5) {
        agent.fxClock = 0;
        this.particles.magic(agent.root.position.clone().setY(0.7), '#9dffa0');
      }
      return;
    }
    if (activity === 'build' || activity === 'repair') {
      // Construir y reparar: martillazos con chispas y astillas.
      show('1H_Axe', true);
      const clip = activity === 'repair' && agent.loopIndex % 3 === 2 ? 'Interact' : '1H_Melee_Attack_Chop';
      this.play(agent, clip, false, activity === 'repair' ? 1.1 : 0.9);
      if (agent.loopClock > 2.4) {
        agent.loopClock = 0;
        agent.loopIndex++;
      }
      if (agent.fxClock > 0.9 && clip !== 'Interact') {
        agent.fxClock = 0;
        this.particles.sparks(hand, 5);
        this.particles.chips(hand, activity === 'repair' ? '#9a9a9a' : '#c08a4d');
      }
      return;
    }
    show('1H_Axe', false);

    // Entrenamiento según el rol que se aprende.
    const role: RoleId | undefined = v.task.kind === 'train' ? v.task.role : undefined;
    const drills: Record<RoleId, string[]> = {
      builder: ['1H_Melee_Attack_Chop', 'Interact', 'PickUp'],
      warrior: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', 'Block', '1H_Melee_Attack_Stab'],
      archer: ['2H_Ranged_Aiming', '2H_Ranged_Shoot', '2H_Ranged_Reload'],
      healer: ['Spellcasting', 'Spellcast_Shoot', 'Spellcast_Long'],
    };
    const list = role ? drills[role] : ['Interact'];
    this.play(agent, list[agent.loopIndex % list.length]!);
    if (agent.loopClock > 1.6) {
      agent.loopClock = 0;
      agent.loopIndex++;
    }
    if (role === 'builder') show('1H_Axe', true);
    if (role === 'healer') this.particles.magic(hand.setY(0.55), '#8fe3ff');
    else if ((role === 'warrior' || role === 'builder') && agent.fxClock > 1.2) {
      agent.fxClock = 0;
      this.particles.sparks(hand, 4, role === 'builder' ? '#ffcf5a' : '#e8f4ff');
    }
  }
}

function centerOf(b: Building): THREE.Vector3 {
  const size = BUILDING_DEFS[b.type].size;
  const c = cellToWorld(b.x, b.y, size);
  return new THREE.Vector3(c.x, 0, c.z);
}

/** Un punto de trabajo alrededor (o dentro, en la granja) del edificio, mirando hacia él. */
function spotFor(b: Building, activity: Activity): { spot: THREE.Vector3; face: THREE.Vector3 | null } {
  const size = BUILDING_DEFS[b.type].size;
  const c = centerOf(b);
  const r = size / 2 + (activity === 'idle' || activity === 'rest' ? 0.8 + Math.random() * (b.type === 'townHall' ? 2.5 : 1.2) : 0.35);
  const side = Math.floor(Math.random() * 4);
  const t = (Math.random() * 2 - 1) * (size / 2) * 0.85;
  const spot = c.clone();
  spot.x += side === 0 ? -r : side === 1 ? r : t;
  spot.z += side === 2 ? -r : side === 3 ? r : t;
  return { spot, face: activity === 'idle' || activity === 'rest' ? null : c };
}
