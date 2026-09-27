#!/usr/bin/env node
// Empaqueta los packs CC0 de KayKit (Kay Lousberg, www.kaylousberg.com) en
// GLB optimizados para el cliente:
//
//   public/assets/village.glb     edificios, decoración y props (1 textura compartida)
//   public/assets/char_*.glb      personajes riggeados (sin animaciones)
//   public/assets/animations.glb  clips seleccionados del rig compartido
//
// Uso:
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/kaykit-medieval-hexagon-pack-1.0 <dir>/...
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/kaykit-character-pack-adventures-1.0 <dir>/...
//   KAYKIT_DIR=<dir> pnpm assets

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, resample, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KAYKIT = process.env.KAYKIT_DIR ?? '/home/user/kaykit-game-assets';
const HEX = join(KAYKIT, 'kaykit-medieval-hexagon-pack-1.0/addons/kaykit_medieval_hexagon_pack/Assets/gltf');
const CHARS = join(KAYKIT, 'kaykit-character-pack-adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf');
const OUT = join(ROOT, 'packages/client/public/assets');

const BUILDINGS = [
  'archeryrange', 'barracks', 'blacksmith', 'castle', 'church', 'home_A', 'home_B', 'lumbermill', 'market',
  'mine', 'tavern', 'tower_A', 'tower_B', 'tower_base', 'tower_catapult', 'watermill', 'well', 'windmill',
];
const COLORS = ['blue', 'red'];
const NEUTRAL = [
  'building_scaffolding', 'building_stage_A', 'building_stage_B', 'building_stage_C', 'building_dirt',
  'building_grain', 'building_destroyed', 'wall_straight', 'wall_corner_A_outside', 'fence_stone_straight',
  'fence_wood_straight', 'projectile_catapult',
];
const NATURE = [
  'cloud_big', 'cloud_small', 'hill_single_A', 'hill_single_B', 'hill_single_C', 'hills_A_trees', 'hills_B_trees',
  'hills_C_trees', 'mountain_A_grass_trees', 'mountain_B_grass_trees', 'mountain_C_grass_trees', 'mountain_A',
  'mountain_B', 'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E',
  'tree_single_A', 'tree_single_B', 'tree_single_A_cut', 'trees_A_large', 'trees_A_medium', 'trees_A_small', 'trees_B_large',
  'trees_B_medium', 'trees_B_small', 'waterlily_A', 'waterlily_B', 'waterplant_A', 'waterplant_B',
];
const PROPS = [
  'barrel', 'bucket_arrows', 'bucket_water', 'crate_A_big', 'crate_A_small', 'crate_B_small', 'crate_long_A',
  'crate_open', 'flag_blue', 'flag_red', 'ladder', 'pallet', 'resource_lumber', 'resource_stone', 'sack', 'target',
  'tent', 'weaponrack', 'wheelbarrow',
];

const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Rogue_Hooded'];
// Clips que usamos ahora (aldea) y los que necesitarán las fases de batalla.
const CLIPS = [
  'Idle', 'Unarmed_Idle', 'Walking_A', 'Walking_B', 'Running_A', 'Interact', 'Use_Item', 'PickUp', 'Cheer',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab', '2H_Melee_Idle',
  '2H_Ranged_Aiming', '2H_Ranged_Shoot', '2H_Ranged_Reload', 'Spellcast_Shoot', 'Spellcasting', 'Spellcast_Long',
  'Block', 'Hit_A', 'Death_A', 'Death_A_Pose', 'Sit_Floor_Idle', 'Throw', 'Dodge_Forward',
];

await MeshoptEncoder.ready;
/** Elimina accessors sin uso (p. ej. los de animaciones descartadas), que prune() no siempre recoge. */
function dropOrphanAccessors() {
  return (doc) => {
    for (const a of doc.getRoot().listAccessors()) {
      if (a.listParents().every((p) => p.propertyType === 'Root')) a.dispose();
    }
  };
}

/** Desecha una animación con sus canales y samplers para que sus datos no queden en el archivo. */
function disposeAnimation(anim) {
  for (const c of anim.listChannels()) c.dispose();
  for (const smp of anim.listSamplers()) {
    const accessors = [smp.getInput(), smp.getOutput()];
    smp.dispose();
    for (const a of accessors) if (a && a.listParents().every((p) => p.propertyType === 'Root')) a.dispose();
  }
  anim.dispose();
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

/** Carga varios modelos y los une en una escena; cada raíz se llama como el archivo. */
async function buildVillage() {
  const files = [
    ...COLORS.flatMap((c) => BUILDINGS.map((b) => `buildings/${c}/building_${b}_${c}.gltf`)),
    ...NEUTRAL.map((n) => `buildings/neutral/${n}.gltf`),
    ...NATURE.map((n) => `decoration/nature/${n}.gltf`),
    ...PROPS.map((n) => `decoration/props/${n}.gltf`),
  ];
  const doc = await io.read(join(HEX, files[0]));
  nameRoots(doc, files[0]);
  for (const f of files.slice(1)) {
    const other = await io.read(join(HEX, f));
    nameRoots(other, f);
    mergeDocuments(doc, other);
  }
  // mergeDocuments crea una escena por documento: se juntan todas en la primera.
  const [main, ...rest] = doc.getRoot().listScenes();
  for (const s of rest) {
    for (const n of s.listChildren()) main.addChild(n);
    s.dispose();
  }
  await doc.transform(dropOrphanAccessors(), dedup(), prune(), weld(), unpartition(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return doc;
}

function nameRoots(doc, file) {
  const base = file.split('/').pop().replace('.gltf', '');
  const scene = doc.getRoot().listScenes()[0];
  const roots = scene.listChildren();
  if (roots.length === 1 && roots[0].getName() === base) return;
  // Algunos modelos tienen varias raíces (p. ej. molino: base + aspas): se agrupan.
  const group = doc.createNode(base);
  for (const r of roots) {
    scene.removeChild(r);
    group.addChild(r);
  }
  scene.addChild(group);
}

/** Un GLB por personaje: si se unieran, GLTFLoader renombraría los huesos repetidos (hips_1...). */
async function buildCharacter(name) {
  const doc = await io.read(join(CHARS, `${name}.glb`));
  for (const a of doc.getRoot().listAnimations()) disposeAnimation(a);
  const scene = doc.getRoot().listScenes()[0];
  const group = doc.createNode(name);
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    group.addChild(n);
  }
  scene.addChild(group);
  await doc.transform(dropOrphanAccessors(), prune(), dedup(), unpartition(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return doc;
}

async function buildAnimations() {
  const doc = await io.read(join(CHARS, 'Knight.glb'));
  const keep = new Set(CLIPS);
  for (const a of doc.getRoot().listAnimations()) if (!keep.has(a.getName())) disposeAnimation(a);
  // Solo se necesitan los huesos: fuera mallas y texturas.
  for (const n of doc.getRoot().listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
  }
  await doc.transform(resample(), dropOrphanAccessors(), prune({ keepLeaves: true }), unpartition(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const missing = CLIPS.filter((c) => !doc.getRoot().listAnimations().some((a) => a.getName() === c));
  if (missing.length) throw new Error(`Faltan animaciones: ${missing.join(', ')}`);
  return doc;
}

mkdirSync(OUT, { recursive: true });
for (const [name, build] of [
  ['village.glb', buildVillage],
  ...CHARACTERS.map((c) => [`char_${c}.glb`, () => buildCharacter(c)]),
  ['animations.glb', buildAnimations],
]) {
  const doc = await build();
  const path = join(OUT, name);
  await io.write(path, doc);
  console.log(`${name.padEnd(16)} ${(statSync(path).size / 1024).toFixed(0).padStart(6)} KB`);
}
