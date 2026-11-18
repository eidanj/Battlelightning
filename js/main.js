// Battle Lightning — entry point: boot (Altekz Studios intro + loading), renderer and post-processing, menus with
// the carrier-deck backdrop, matches, flight school, the main loop and the cockpit render pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { AIRCRAFT, WORLD } from './config.js';
import { loadSettings, saveSettings, keyName } from './settings.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { Weapons } from './weapons.js';
import { AADefence } from './aa.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { CameraRig } from './camera.js';
import { Match } from './match.js';
import { Tutorial } from './tutorial.js';
import { Clouds } from './clouds.js';
import { buildAircraft } from './aircraftModels.js';
import { Cockpit } from './cockpit.js';
import { Pilot, buildSeat, buildParachute } from './pilot.js';
import { abUniforms } from './aircraftModels.js';
import { clamp, damp } from './util.js';

const $ = (s) => document.querySelector(s);
const V3 = THREE.Vector3;

class Game {
  constructor() {
    this.settings = loadSettings();
    this.input = new Input(this.settings);
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume; this.audio.music = this.settings.music;
    this.state = 'boot';
    this.time = 0; this.aircraft = []; this.player = null; this.view = 'cockpit';
    this.fps = 60; this.paused = false;
    this.camPos = new V3();
    this.ejectArm = 0;
  }

  // ---------------- boot ----------------
  async boot() {
    const intro = $('#intro');
    requestAnimationFrame(() => requestAnimationFrame(() => intro.classList.add('show')));
    const t0 = performance.now();
    const bar = $('#loadBar'), txt = $('#loadText');
    const progress = (p, label) => { bar.style.width = `${Math.round(p * 100)}%`; if (label) txt.textContent = label; };
    try {
      this.buildRenderer();
      progress(0.01, 'Starting engines');
      await new Promise((r) => setTimeout(r, 400));
      this.world = new World(this.renderer, this.scene, this.settings.gfx);
      this.world.camera = this.camera;
      await this.world.build(this.settings.timeOfDay, progress);
      this.fx = new Effects(this.scene, this.settings.gfx.particles, this.world.ocean);
      this.weapons = new Weapons(this);
      this.aa = new AADefence(this);
      progress(0.94, 'Calibrating instruments');
      await new Promise((r) => setTimeout(r, 0));
      this.hud = new HUD(this); this.hud.units = this.settings.units; this.hud.buildMap(this.world);
      this.ui = new UI(this);
      this.applyGraphics();
      this.showcase(this.settings.aircraft);
      this.rig.mode = 'menu';
      this._tod = this.settings.timeOfDay; this._clouds = this.settings.gfx.clouds;
      this.renderer.toneMappingExposure = this.world.atmo.exposure;
      // warm up shaders for a smooth first frame
      this.update(0.016); this.renderer.compile(this.scene, this.camera); this.render();
      progress(1, 'Ready');
    } catch (e) {
      console.error(e);
      txt.textContent = 'Failed to start: ' + (e.message || e) + ' — your browser needs WebGL 2.';
      return;
    }
    // keep the studio card up for at least ~3.5 s, then let the player click through (unlocks audio)
    const wait = Math.max(0, 3500 - (performance.now() - t0));
    await new Promise((r) => setTimeout(r, wait));
    intro.classList.remove('show');
    await new Promise((r) => setTimeout(r, 900));
    intro.classList.add('ready');
    const go = () => {
      intro.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go);
      this.audio.init(); this.audio.introHit();
      intro.classList.add('out');
      setTimeout(() => { intro.classList.add('hidden'); }, 900);
      this.state = 'menu'; this.ui.go('menu');
      this.audio.setAmbience(0.7, 1);
    };
    intro.addEventListener('pointerdown', go); window.addEventListener('keydown', go);
    this.state = 'intro';
    if (new URLSearchParams(location.search).has('autostart')) go();
  }

  buildRenderer() {
    const canvas = $('#game');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    if (!r.capabilities.isWebGL2) throw new Error('WebGL 2 not available');
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.46;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 1.5, 100000);
    // cockpit pass: its own scene, near camera and lights (so the canopy frame shadows the panel)
    this.ckScene = new THREE.Scene();
    this.ckCam = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.02, 30);
    this.ckSun = new THREE.DirectionalLight(0xffffff, 3); this.ckSun.castShadow = true; this.ckSun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.ckSun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.1, far: 12 }); this.ckSun.shadow.bias = -0.0008; this.ckSun.shadow.normalBias = 0.01;
    this.ckHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    this.ckScene.add(this.ckSun, this.ckSun.target, this.ckHemi);
    this.rig = new CameraRig(this.camera, this.ckCam);
    window.addEventListener('resize', () => this.resize());
  }
  buildComposer() {
    const r = this.renderer, gfx = this.settings.gfx;
    const w = innerWidth, h = innerHeight;
    if (this.composer) this.composer.dispose?.();
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: gfx.fxaa ? 0 : (gfx.scale >= 1 ? 4 : 2) });
    const c = this.composer = new EffectComposer(r, rt);
    c.setPixelRatio(r.getPixelRatio()); c.setSize(w, h);
    this.mainPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.mainPass);
    this.ckPass = new RenderPass(this.ckScene, this.ckCam); this.ckPass.clear = false; this.ckPass.clearDepth = true;
    c.addPass(this.ckPass);
    if (gfx.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.16, 0.25, 4.0); c.addPass(this.bloom); } else this.bloom = null;
    c.addPass(new OutputPass());
    if (gfx.fxaa) c.addPass(new FXAAPass());
  }
  applyGraphics() {
    const gfx = this.settings.gfx, r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * gfx.scale);
    r.setSize(innerWidth, innerHeight, false);
    this.world?.atmo.setShadows(gfx.shadows);
    this.rig.fovBase = this.settings.fov;
    this.showFps = this.settings.showFps;
    $('#fps').style.display = this.showFps ? 'block' : 'none';
    this.buildComposer();
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.ckCam.aspect = this.camera.aspect; this.ckCam.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer?.setSize(innerWidth, innerHeight);
  }

  // ---------------- menu backdrop: a jet parked on the carrier deck ----------------
  showcase(id) {
    if (this.show) { this.scene.remove(this.show.group); }
    const team = this.settings.side;
    const m = buildAircraft(id, team);
    const ck = new Cockpit(AIRCRAFT[id], team, true);
    m.group.add(ck.group);
    this.scene.add(m.group);
    const fm = { surf: { pitch: 0, roll: 0, yaw: 0 }, flaps: 1, sweep: 0, gear: 1, gearCmd: 1, rpm: 0, ab: 0, throttle: 0, dmg: { gearOk: true } };
    m.update(fm, 0, 0); ck.animate(fm);
    this.show = { group: m.group, model: m, ck, fm, id, local: new V3(-12, 0, -96), yaw: 2.6 };
  }
  updateShowcase(dt) {
    const s = this.show;
    if (!s) return;
    const c = this.world.fleet.carrier;
    const local = s.local.clone(); local.y = c.deckY - AIRCRAFT[s.id].geo.gearMain[1] - 0.12;
    c.toWorld(local, s.group.position);
    s.group.quaternion.copy(c.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), s.yaw));
    s.model.update(s.fm, dt, this.time);
    s.group.visible = this.state === 'menu';
  }
  enterMenu(screen) {
    if (this.state === 'playing' || this.state === 'paused') return;
    this.state = 'menu';
    const o = this.rig.orbit;
    if (screen === 'hangar') { this.rig.mode = 'hangar'; o.dist = AIRCRAFT[this.show?.id || 'f14'].geo.len * 1.35; o.pitch = 0.22; o.auto = true; }
    else { this.rig.mode = 'menu'; o.dist = 30; o.pitch = 0.12; o.auto = true; }
    this.hud.show(false);
    this.audio.setAmbience(0.7, 1);
  }

  // ---------------- matches ----------------
  async startMatch(tutorial = false) {
    const s = this.settings;
    this.clearMatch();
    this.ui.hideAll();
    if (this.world.atmo.tod !== undefined && this._tod !== s.timeOfDay) { this.world.setTimeOfDay(s.timeOfDay); this._tod = s.timeOfDay; this.renderer.toneMappingExposure = this.world.atmo.exposure; }
    if (this._clouds !== s.gfx.clouds) { this.scene.remove(this.world.clouds.mesh); this.world.clouds = new Clouds(this.world.atmo, s.gfx.clouds); this.scene.add(this.world.clouds.mesh); this._clouds = s.gfx.clouds; }
    this.tutorialMode = tutorial; this.tutorialSafe = tutorial;
    this.playerTeam = s.side;
    if (tutorial) this.playerTeam = 'navy';
    this.match = new Match(this, { teamSize: s.teamSize, side: this.playerTeam, aircraft: s.aircraft, noAI: tutorial, duration: tutorial ? 3600 : 20 * 60 });
    this.match.start();
    this.state = 'playing'; this.paused = false;
    this.view = 'cockpit'; this.setView('cockpit');
    this.hud.show(true);
    if (this.show) this.show.group.visible = false;
    this.audio.init(); this.audio.setAmbience(0.25, 0);
    if (tutorial) this.tutorial = new Tutorial(this);
    this.hud.message(tutorial ? 'FLIGHT SCHOOL' : `${this.playerTeam === 'navy' ? 'NAVY TASK FORCE' : 'COASTAL AIR WING'} · ${s.teamSize} v ${s.teamSize}`, 'good', 4);
    this.prewarm();
  }
  // Compile every shader the match can need up front, while the match is loading. A shader compiled in the
  // middle of a fight stalls that frame (up to seconds on some GPUs). Ejection is the one event that brings
  // new materials into the world: the pilot, seat and parachute, lit by the sun instead of the cockpit lights.
  prewarm() {
    const r = this.renderer, g = new THREE.Group(), c = this.camera.position;
    g.position.set(c.x, c.y - 2000, c.z);
    const p0 = new Pilot({ lod: 0 }), p1 = new Pilot({ lod: 1 });
    p0.setHeadVisible(true); p1.setHeadVisible(true);
    g.add(buildSeat(), p0.root, p1.root, buildParachute());
    this.scene.add(g);
    // one permanent, empty smoke ribbon keeps the trail shader compiled for the whole session
    if (!this._warmTrail || !this.fx.trails.includes(this._warmTrail)) this._warmTrail = this.fx.trail({ life: 1e9 });
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.composer.readBuffer); // same target (linear, no tone mapping) as the real main pass
    try { r.compile(this.scene, this.camera); r.compile(this.ckScene, this.ckCam); } catch (e) { console.warn('prewarm', e); }
    r.setRenderTarget(prev);
    this.scene.remove(g);
  }
  startTutorial() { this.startMatch(true); }
  clearMatch() {
    for (const a of this.aircraft) a.dispose();
    this.aircraft = []; this.player = null; this.match = null;
    if (this.tutorial) { this.tutorial.dispose(); this.tutorial = null; }
    for (const m of this.weapons.missiles) { this.scene.remove(m.mesh); m.trail.stop(); }
    this.weapons.missiles.length = 0; this.weapons.flares.length = 0; this.weapons.shells.length = 0; this.weapons.n = 0;
    for (const d of this.fx.debris) this.scene.remove(d.obj);
    this.fx.debris.length = 0;
    for (const m of this.aa.mounts) if (!m.alive) { m.alive = true; m.hp = m.S.hp; }
    this.audio.silencePlayer?.();
    $('#tacmap').classList.add('hidden');
  }
  quitToMenu() {
    this.clearMatch();
    this.state = 'menu'; this.paused = false;
    this.ui.go('menu');
    this.hud.show(false);
  }
  pause() { if (this.state !== 'playing') return; this.paused = true; this.state = 'paused'; this.ui.go('pause'); this.audio.silencePlayer(); }
  resume() { this.ui.hideAll(); this.paused = false; this.state = 'playing'; if (this.player && !this.player.alive && this.match?.respawnT >= 0) this.ui.showDeath(this._deathTitle, this._deathBy); }
  respawn() {
    if (!this.match || !this.match.canRespawn() || this.match.respawnT > 0) return;
    $('#death').classList.add('hidden'); this.ui.screen = null;
    const old = this.player;
    if (old && old.alive && old.ejected) old.writeOff('bailed out');
    this.match.respawnT = -1;
    const crew = this.match.takeOverReserve();
    this.match.spawnPlayer();
    if (crew) this.hud.message(`You take over ${crew}'s aircraft`, 'info', 3);
    if (old) { old.dispose(); this.aircraft = this.aircraft.filter((a) => a !== old); }
    this.setView(this.view === 'chase' ? 'chase' : 'cockpit');
    this.tutorial?.onRespawn();
  }
  setView(v) {
    this.view = v;
    const p = this.player;
    if (!p) return;
    const ck = p.cockpit;
    if (v === 'cockpit' && p.alive && !p.ejected) {
      this.rig.mode = 'cockpit';
      if (ck.group.parent !== this.ckScene) { ck.group.parent?.remove(ck.group); this.ckScene.add(ck.group); }
      ck.setInteriorVisible(true); ck.pilot.setHeadVisible(false);
      p.model.parts.canopy.visible = false;
    } else {
      this.rig.mode = 'chase'; this.rig.chaseInit = false;
      if (ck.group.parent !== p.group) { ck.group.parent?.remove(ck.group); p.group.add(ck.group); ck.group.position.set(0, 0, 0); ck.group.quaternion.identity(); }
      ck.setInteriorVisible(false); ck.pilot.setHeadVisible(true);
      if (p.model.parts.canopy.parent) p.model.parts.canopy.visible = true;
    }
    $('#viewMode').textContent = v === 'cockpit' ? 'COCKPIT VIEW · V' : 'CHASE VIEW · V';
  }

  // ---------------- events from the simulation ----------------
  onHit(attacker, victim, comp, dmg, kind, point) {
    if (attacker && attacker.isPlayer && victim !== attacker) { this.hud.hitMarker(false); this.audio.hitMarker(); }
    if (victim.isPlayer) {
      this.hud.damageFlash(Math.min(1.5, dmg / 40)); this.audio.hitTink(dmg > 50); this.rig.addShake(Math.min(0.8, dmg / 120));
    }
  }
  onKill(killer, victim, cause) { this.match?.onKill(killer, victim, cause); }
  onPlayerDown(p, killer, cause) {
    if (p.ejected) return;
    this.match.respawnT = 6;
    this.rig.mode = 'death'; this._deathPos = p.fm.pos.clone();
    if (p.cockpit.group.parent === this.ckScene) this.ckScene.remove(p.cockpit.group);
    this._deathTitle = killer ? 'SHOT DOWN' : cause === 'ditched' ? 'DITCHED' : 'CRASHED';
    this._deathBy = killer ? `by <b>${killer.name}</b>${killer.def ? ` (${killer.def.short})` : ''}` : `You ${cause}.`;
    setTimeout(() => { if (this.player === p && !p.alive && this.state === 'playing') this.ui.showDeath(this._deathTitle, this._deathBy); }, 1800);
    this.audio.silencePlayer();
  }
  onEject(p) {
    if (!p.isPlayer) return;
    this.match.respawnT = 8;
    if (p.cockpit.group.parent === this.ckScene) { this.ckScene.remove(p.cockpit.group); p.group.add(p.cockpit.group); }
    this.rig.mode = 'eject'; this.rig.orbit.yaw = Math.random() * 6;
    this._deathTitle = 'EJECTED'; this._deathBy = 'You punched out and are floating down under your parachute.';
    this.hud.message('EJECTED!', 'warn', 3);
    setTimeout(() => { if (this.player === p && this.state === 'playing') this.ui.showDeath(this._deathTitle, this._deathBy); }, 3500);
  }
  onPilotLanded(p, water) { if (p.isPlayer) this.hud.message(water ? 'Splashdown — rescue helicopter inbound' : 'Safe on the ground', 'good', 3); }
  onLanded(p, kind) { if (p.isPlayer) this.hud.message(kind === 'deck' ? 'WELCOME ABOARD' : 'TOUCHDOWN', 'good', 2.5); }
  onRepaired(p, kind) {
    if (!p.isPlayer) return;
    this.hud.message('REPAIRED & REARMED', 'good', 3);
    if (kind === 'deck') {
      setTimeout(() => { if (this.player === p && p.alive && (p.state === 'landed') && p.fm.onGround) { const i = Math.max(0, this.match.freeCat()); p.fm.arrest = null; p.attachCatapult(i, false); p.fm.throttle = 0; this.hud.message('Taxied to the catapult — full power to launch', 'info', 4); } }, 1500);
    }
  }
  onLaunched(p) { if (p.isPlayer) this.hud.message('AIRBORNE — pull up!', 'good', 2); }
  onAIParked(a) { this.match?.onAIParked(a); }
  onMatchEnd(win, reason) {
    this.state = 'end';
    this.audio.silencePlayer();
    setTimeout(() => this.ui.showEnd(win, reason, this.player || { kills: 0, assists: 0, deaths: 0, score: 0 }), 600);
  }
  onTutorialDone() {}
  isSpotted(a) { return this.match ? this.match.isSpotted(a) : false; }

  // ---------------- player controls ----------------
  controls(dt) {
    const p = this.player, I = this.input;
    if (!p || !p.alive || p.ejected) return;
    const fm = p.fm;
    fm.input.pitch = I.axis('pitchDown', 'pitchUp');
    fm.input.roll = I.axis('rollLeft', 'rollRight');
    fm.input.yaw = I.axis('yawLeft', 'yawRight');
    fm.input.brake = I.held('brake') ? 1 : 0;
    if (I.held('throttleUp')) { if (fm.engine === 'off') fm.startEngine(); else if (fm.engine === 'running') fm.throttle = Math.min(1, fm.throttle + dt * 0.32); }
    if (I.held('throttleDown')) fm.throttle = Math.max(0, fm.throttle - dt * 0.42);
    if (I.hit('gear')) {
      if (fm.onGround && fm.gearCmd > 0.5) p.say('Weight on wheels — gear stays down', 'warn', 1.5);
      else { fm.gearCmd = fm.gearCmd > 0.5 ? 0 : 1; p.say(fm.gearCmd ? 'GEAR DOWN' : 'GEAR UP', 'info', 1.2); }
    }
    p.ctrl.fire = I.held('fireGuns');
    if (I.hit('reload')) p.reload();
    if (I.hit('fireMissile')) p.fireMissile();
    if (I.held('flares')) p.dropFlares();
    this.ejectArm -= dt;
    if (I.hit('eject')) { if (this.ejectArm > 0) { p.doEject(); this.ejectArm = 0; } else { this.ejectArm = 1.3; p.say('Press EJECT again to bail out', 'bad', 1.3); } }
    // gear overspeed tears the gear off
    if (fm.gear > 0.3 && fm.V > 185 && !fm.onGround) { p.gearOver = (p.gearOver || 0) + dt; if (p.gearOver > 2.5 && fm.dmg.gearOk) { fm.dmg.gearOk = false; fm.gear = 0; fm.gearCmd = 0; p.say('LANDING GEAR TORN OFF — overspeed!', 'bad', 4); } } else p.gearOver = 0;
  }
  prompts() {
    const p = this.player;
    if (!p || !p.alive || p.ejected) { this.hud.setPrompt(''); return; }
    const fm = p.fm, k = (a) => `<kbd>${keyName(this.settings.keys[a][0])}</kbd>`;
    let h = '';
    if (fm.engine === 'off') h = `Hold ${k('throttleUp')} to start the engine`;
    else if (fm.engine === 'starting') h = `Engine starting… RPM ${Math.round(fm.rpm * 100)}%<div class="bar"><i style="width:${Math.round(fm.rpm / 0.62 * 100)}%"></i></div>`;
    else if (p.cat && p.cat.phase === 'hold') h = fm.throttle < 0.88 ? `Hold ${k('throttleUp')} to <b>full power</b> — the catapult fires automatically` : `Catapult armed… <b>pull up as you leave the deck</b><div class="bar"><i style="width:${Math.round(p.catReady() * 100)}%"></i></div>`;
    else if (p.state === 'repairing') { const f = p.health; h = `Repairing & rearming… ${Math.round(f * 100)}%<div class="bar"><i style="width:${Math.round(f * 100)}%"></i></div>`; }
    else if (fm.onGround && fm.V < 5 && p.state === 'landed' && p.team === 'coast') h = `Ready — hold ${k('throttleUp')} for full power, pull ${k('pitchUp')} at 260 km/h`;
    else if (fm.engine === 'dead') h = 'Engine out — glide to a landing or eject';
    else if (p.gunAmmo === 0 && p.gunReserve > 0 && p.reloading <= 0) h = `Guns empty — reload with ${k('reload')}`;
    else if (p.heavilyDamaged() && !fm.onGround) h = `Heavily damaged — land at your base to repair, or press ${k('eject')} twice to eject`;
    this.hud.setPrompt(h);
  }

  // ---------------- main loop ----------------
  loop() {
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.1) dt = 0.1;
      this.fps = lerp1(this.fps, 1 / Math.max(dt, 1e-3), 0.05);
      if (this.state === 'boot') return;
      this.update(dt);
      this.render();
      this.input.endFrame();
    };
    requestAnimationFrame(frame);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.input.capture) {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') { if (this.ui.screen === 'settings') this.ui.go('pause'); else this.resume(); }
        else if (this.state === 'menu' && this.ui.screen && this.ui.screen !== 'menu') this.ui.go(this.ui.screen === 'settings' ? this.ui.prev : 'menu');
      }
    });
    this.input.onKey((code) => {
      if (this.state !== 'playing') return;
      if (this.settings.keys.camera.includes(code) && this.player && this.player.alive && !this.player.ejected) this.setView(this.view === 'cockpit' ? 'chase' : 'cockpit');
    });
  }

  update(dt) {
    const playing = this.state === 'playing' || this.state === 'end';
    const simDt = this.paused ? 0 : dt;
    if (!this.paused) this.time += dt;
    // world first so the carrier deck has moved before aircraft sit on it
    this.world.update(simDt, this.camPos, this.player);
    if (this.state === 'menu' || this.state === 'intro' || this.state === 'boot') {
      this.updateShowcase(dt);
      this.rig.update(dt, { target: this.show?.group.position, world: this.world, minY: this.world.fleet.carrier.deckY + 2 + this.world.fleet.carrier.heave });
    } else if (playing && !this.paused) {
      this.controls(dt);
      for (const a of this.aircraft) if (a.ai && a.alive && !a.ejected) a.ai.update(dt);
      for (const a of this.aircraft) a.update(dt);
      this.weapons.update(dt);
      this.aa.update(dt);
      this.match?.update(dt);
      this.tutorial?.update(dt);
      // drop wrecks after a while
      for (let i = this.aircraft.length - 1; i >= 0; i--) { const a = this.aircraft[i]; if (!a.alive && a !== this.player) { a.deadT = (a.deadT || 0) + dt; if (a.deadT > 20 && !(a.eject && !a.eject.landed)) { a.dispose(); this.aircraft.splice(i, 1); } } }
      // camera
      const p = this.player;
      this.rig.freeLook(this.input, dt, this.settings.mouseLook, this.settings.invertLook);
      if (p) {
        if (this.rig.mode === 'eject' && p.eject) this.rig.update(dt, { target: p.eject.anchor.position, chute: !!p.eject.chute, world: this.world });
        else if (this.rig.mode === 'death') this.rig.update(dt, { target: this._deathPos, world: this.world });
        else this.rig.update(dt, { plane: p, world: this.world });
      }
      $('#tacmap').classList.toggle('hidden', !this.input.held('scoreboard'));
      this.prompts();
    } else this.rig.update(0, { plane: this.player, world: this.world, target: this._deathPos || this.camera.position });
    this.camPos.copy(this.camera.position);
    this.fx.update(simDt, this.camPos, this.world);
    abUniforms().uTime.value = this.time;
    this.world.atmo.update(this.camPos, this.rig.focus, this.time);
    // cockpit pass lighting follows the aircraft
    const p = this.player;
    if (p && this.rig.mode === 'cockpit') {
      const ck = p.cockpit.group;
      ck.position.copy(p.fm.pos); ck.quaternion.copy(p.fm.quat);
      const eye = this.camera.position;
      this.ckSun.position.copy(eye).addScaledVector(this.world.atmo.sunDir, 5); this.ckSun.target.position.copy(eye); this.ckSun.target.updateMatrixWorld();
      this.ckSun.color.copy(this.world.atmo.sun.color); this.ckSun.intensity = this.world.atmo.sun.intensity;
      this.ckHemi.color.copy(this.world.atmo.hemi.color); this.ckHemi.groundColor.copy(this.world.atmo.hemi.groundColor); this.ckHemi.intensity = this.world.atmo.hemi.intensity;
      this.ckScene.environment = this.scene.environment;
      if (this._panelT === undefined || (this._panelT -= dt) <= 0) { this._panelT = 1 / 24; p.cockpit.draw(p, this.settings.units); }
    }
    // audio
    if (this.audio.ok) {
      const cam = this.camera;
      const fwd = new V3(0, 0, -1).applyQuaternion(cam.quaternion), up = new V3(0, 1, 0).applyQuaternion(cam.quaternion);
      this.audio.updateWorld({ position: cam.position, forward: fwd, up }, this.rig.vel, this.aircraft, this.player, dt);
      if (playing && !this.paused && p) this.audio.updatePlayer(p, dt, this.rig.mode === 'cockpit', this.rig.mode);
    }
    if (playing) this.hud.update(dt, { plane: this.player, camera: this.camera, ckCamera: this.ckCam, mode: this.rig.mode, game: this });
  }

  render() {
    this.ckPass.enabled = this.rig.mode === 'cockpit' && this.player && this.player.alive && !this.player.ejected && (this.state === 'playing' || this.state === 'paused' || this.state === 'end');
    this.composer.render();
  }
  get world() { return this._world; }
  set world(w) { this._world = w; }
}
function lerp1(a, b, t) { return a + (b - a) * t; }

const game = new Game();
window.__game = game;
game.boot().then(() => game.loop());
