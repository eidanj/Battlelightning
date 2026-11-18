// World assembly + physics queries: what surface is under a point (deck, runway, grass, water), solid obstacles,
// ground clearance for the AI, per-frame updates of moving/animated scenery.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { buildTextures, TEX, setAniso } from './textures.js';
import { Atmosphere } from './sky.js';
import { Ocean, waveHeight } from './ocean.js';
import { Terrain } from './terrain.js';
import { buildCity, Colliders } from './city.js';
import { buildAirbase, updatePapi } from './airbase.js';
import { Fleet } from './ships.js';
import { Clouds } from './clouds.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

export class World {
  constructor(renderer, scene, gfx) {
    this.renderer = renderer; this.scene = scene; this.gfx = gfx;
    this.time = 0;
    this._pool = Array.from({ length: 8 }, () => ({ h: 0, vx: 0, vy: 0, vz: 0, kind: 'grass', ship: null, local: null }));
    this._pi = 0;
  }

  async build(tod, progress = () => {}) {
    const gfx = this.gfx;
    setAniso(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    progress(0.02, 'Generating textures');
    await tick();
    buildTextures(1);
    progress(0.12, 'Raising the mainland');
    await tick();
    this.atmo = new Atmosphere(this.renderer, this.scene, tod);
    this.atmo.setShadows(gfx.shadows);
    this.terrain = new Terrain();
    this.terrain.bake();
    progress(0.3, 'Meshing terrain');
    await tick();
    this.terrain.buildMaterial(this.atmo);
    this.scene.add(this.terrain.buildMeshes(gfx.ocean));
    this.colliders = new Colliders();
    progress(0.4, 'Filling the ocean');
    await tick();
    const depth = this.terrain.depthTexture();
    this.ocean = new Ocean(this.renderer, this.atmo, gfx.ocean, depth);
    this.scene.add(this.ocean.mesh);
    progress(0.48, 'Building the city');
    await tick();
    this.city = buildCity(this.terrain, this.colliders, 1);
    this.scene.add(this.city.group);
    progress(0.58, 'Paving the airbase');
    await tick();
    this.airbase = buildAirbase(this.terrain, this.colliders);
    this.scene.add(this.airbase.group);
    progress(0.64, 'Launching the fleet');
    await tick();
    this.fleet = new Fleet(this.scene, this.ocean);
    progress(0.72, 'Planting forests');
    await tick();
    const C = WORLD.city, A = this.airbase.repair;
    this.scene.add(this.terrain.buildTrees(gfx.trees, (x, z) => (x > C.x0 - 80 && x < C.x1 + 80 && z > C.z0 - 80 && z < C.z1 + 80) || (x > A.x0 - 300 && x < A.x1 + 300 && z > A.z0 - 400 && z < A.z1 + 500)));
    progress(0.8, 'Forming clouds');
    await tick();
    this.clouds = new Clouds(this.atmo, gfx.clouds);
    this.scene.add(this.clouds.mesh);
    progress(0.86, 'Lighting the sky');
    await tick();
    this.atmo.sampleHorizon();
    this.atmo.buildEnvironment();
    this.ocean.setEnv(this.atmo.cubeRT.texture);
    this.clouds.setColors();
    this.applyTimeOfDay();
    progress(0.9, 'Ready');
  }

  setTimeOfDay(tod) {
    this.atmo.setTime(tod);
    this.atmo.sampleHorizon();
    this.atmo.buildEnvironment();
    this.ocean.setEnv(this.atmo.cubeRT.texture);
    this.clouds.setColors();
    this.applyTimeOfDay();
  }
  applyTimeOfDay() {
    const el = this.atmo.sunDir.y;
    const night = 1 - Math.min(1, Math.max(0, (el - 0.02) / 0.22));
    for (const m of this.city.mats) m.emissiveIntensity = night * 1.6;
    this.atmo.fog.density = 0.000026 + 0.00001 * night;
  }

  // ---------------- queries ----------------
  // Surface under (x, z) near height y: deck of the carrier, runway / apron, grass, city streets, or water.
  surface(x, z, y = 0) {
    const o = this._pool[this._pi = (this._pi + 1) & 7];
    o.ship = null; o.local = null; o.vx = 0; o.vy = 0; o.vz = 0;
    if (this.fleet.deckAt(x, y, z, o)) return o;
    const h = this.terrain.height(x, z);
    if (h < 0.4) { o.h = waveHeight(x, z, this.time) * 0.85; o.kind = 'water'; return o; }
    o.h = h;
    const A = this.airbase.repair, r = this.airbase.runway;
    if (x > r.x0 - 20 && x < r.x1 + 20 && Math.abs(z - r.z) < r.width / 2 + 2) { o.h = r.y + 0.08; o.kind = 'runway'; }
    else if (x > A.x0 && x < A.x1 && z > A.z0 && z < A.z1 && Math.abs(h - r.y) < 1.2) { o.h = Math.max(h, r.y); o.kind = 'apron'; }
    else { const C = WORLD.city; o.kind = x > C.x0 && x < C.x1 && z > C.z0 && z < C.z1 ? 'city' : 'grass'; }
    return o;
  }
  groundHeight(x, z) { return Math.max(this.terrain.height(x, z), 0); }
  // highest obstacle/terrain within r metres (AI terrain avoidance)
  clearance(x, z, r = 250) {
    let h = Math.max(this.groundHeight(x, z), this.groundHeight(x + r, z), this.groundHeight(x - r, z), this.groundHeight(x, z + r), this.groundHeight(x, z - r));
    if (x > WORLD.city.x0 - 400 && x < WORLD.city.x1 + 400 && z > WORLD.city.z0 - 400 && z < WORLD.city.z1 + 400) h = Math.max(h, this.colliders.topNear(x, z, r));
    return h;
  }
  // solid obstacle at point? returns a tag or null
  obstacle(x, y, z) {
    if (y < 460) { const b = this.colliders.hit(x, y, z); if (b) return b.tag; }
    if (y < 70 && this.fleet.hit(x, y, z)) return 'ship';
    return null;
  }
  isFriendlyBase(surf, team) {
    if (!surf) return false;
    if (team === 'navy') return surf.kind === 'deck';
    return surf.kind === 'runway' || surf.kind === 'apron';
  }

  update(dt, camPos, player) {
    this.time += dt;
    this.fleet.update(this.time, dt);
    this.ocean.update(dt, this.time, camPos);
    this.ocean.renderWakes(camPos);
    this.clouds.update(dt, camPos, this.camera);
    this.terrain.updateLOD(camPos);
    this.terrain.updateTrees(camPos, 4200 * Math.max(0.7, Math.min(1.3, this.gfx.trees)));
    this.airbase.radar.rotation.y += dt * 1.3;
    this.city.beaconMat.color.setHex((this.time % 1.6) < 0.8 ? 0xff2a1a : 0x2a0503);
    updatePapi(this.airbase.papi, camPos);
  }
}
