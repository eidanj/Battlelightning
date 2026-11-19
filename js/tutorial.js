// Flight school: a guided mission from a cold start on the carrier catapult to a landing.
import * as THREE from 'three';
import { Aircraft } from './aircraft.js';
import { AIPilot } from './ai.js';
import { actionLabel } from './settings.js';
import { DEG, RAD, clamp } from './util.js';

const V3 = THREE.Vector3;

export class Tutorial {
  constructor(game) {
    this.game = game; this.i = 0; this.t = 0; this.done = false; this.flags = {}; this.drones = [];
    const k = (a) => `<kbd>${actionLabel(game.settings, a)}</kbd>`;
    const touch = document.body.classList.contains('touch');
    this.steps = [
      { text: 'Welcome to <b>flight school</b>. You are cold and dark on the bow catapult of the carrier.', hint: `${touch ? 'Drag on the right side of the screen' : 'Hold the right mouse button'} to look around · ${k('camera')} switches cockpit / chase camera`, check: (p) => this.t > 7 || this.flags.camera },
      { text: `Start the engine: <b>hold ${k('throttleUp')}</b>. Listen to the starter and watch the RPM gauge climb to idle (~62%).`, hint: 'The turbine needs a few seconds to light off and spool up.', check: (p) => p.fm.engine === 'running' },
      { text: `Throttle up: keep <b>holding ${k('throttleUp')}</b> to full power (100% = afterburner). The catapult fires automatically after a moment at full power.`, hint: `${k('throttleDown')} lowers the throttle. The engine spools up slowly, just like the real thing.`, check: (p) => p.state === 'flying' && !p.cat },
      { text: `Rotate! <b>Pull back with ${k('pitchUp')}</b> as you leave the deck and climb away from the water.`, hint: 'You need flying speed for the wings to make lift. Too slow and you stall.', check: (p) => p.fm.pos.y > 140 && p.fm.vel.y > 0 },
      { text: `Positive climb: <b>raise the landing gear with ${k('gear')}</b>.`, hint: 'Gear down adds a lot of drag, and it can be torn off above ~600 km/h.', check: (p) => p.fm.gearCmd < 0.5 },
      { text: 'Climb to <b>1,000 m</b>.', hint: `${k('pitchUp')} nose up · ${k('pitchDown')} nose down`, check: (p) => p.fm.pos.y > 1000 },
      { text: `Roll: bank <b>left with ${k('rollLeft')}</b>, then <b>right with ${k('rollRight')}</b> (past 50° each way).`, hint: 'A banked aircraft turns because the lift tilts with it. Pull to tighten the turn.', check: (p) => this.flags.bankL && this.flags.bankR },
      { text: `Rudder: yaw the nose with <b>${k('yawLeft')}</b> / <b>${k('yawRight')}</b>.`, hint: 'The rudder is for small corrections and lining up on the runway.', check: (p) => this.flags.yawT > 1.2 },
      { text: `Throttle back to about <b>70%</b> with ${k('throttleDown')}.`, hint: 'Afterburner burns fuel fast. ' + (touch ? 'The slider on the right shows your throttle.' : 'Watch the throttle gauge bottom-left.'), check: (p) => p.fm.throttle > 0.55 && p.fm.throttle < 0.82 },
      { text: `Stall: throttle to idle and hold the nose up until the wing <b>stalls</b> (shudder + horn). Then push the nose down (${k('pitchDown')}) and add power to recover.`, hint: 'Below stall speed the wing cannot make enough lift. Never stall low over the water!', check: (p) => this.flags.stalled && p.fm.V * 3.6 > 420 && p.fm.stall < 0.05 },
      { text: `Guns: a target drone is ahead (red marker). A <b>lead circle</b> appears in front of it: steer so your <b>gun cross (+)</b> is inside the circle, then fire with <b>${k('fireGuns')}</b>.`, hint: `The circle turns solid and says SHOOT when you are on target. Tap the stick for small corrections. Reload with ${k('reload')}.`, enter: () => this.spawnDrone(1800), check: () => this.drones.length && this.drones.every((d) => !d.alive) },
      { text: `Missiles: keep the next drone inside the dashed <b>seeker circle</b> until the tone goes solid (LOCK), then fire with <b>${k('fireMissile')}</b>.`, hint: 'A heat-seeker needs about a second of lock. Land to rearm when you run out.', enter: () => this.spawnDrone(3200), check: () => this.drones.every((d) => !d.alive) },
      { text: `Countermeasures: drop <b>flares</b> with ${k('flares')}. They decoy heat-seeking missiles chasing you.`, hint: 'Pair flares with a hard turn for the best chance.', check: (p) => p.flares < p.def.flares },
      { text: `Landing: lower the gear (${k('gear')}), then fly to the <b>carrier</b> (west) or the <b>airbase</b> (east, see the radar). Follow the landing box: keep the cross centred and hold the <b>ON SPEED</b> number shown above it.`, hint: `Use ${k('brake')} for air brakes / wheel brakes. Too fast and you overshoot into the sea. On the carrier, the hook catches a wire.`, check: (p) => p.state === 'repairing' || p.state === 'landed' },
      { text: '<b>Flight school complete!</b> You landed safely. Your aircraft is being repaired and rearmed.', hint: touch ? 'Tap ☰ for the menu or keep flying.' : 'Press Esc for the menu or keep flying.', check: () => false },
    ];
    this.box = document.querySelector('#tutorialBox');
    this.box.classList.remove('hidden');
    game.input.onKey((code) => { if (game.settings.keys.camera.includes(code)) this.flags.camera = true; });
    this.show();
  }
  show() {
    const s = this.steps[this.i];
    this.box.querySelector('.tStep').textContent = `FLIGHT SCHOOL · ${Math.min(this.i + 1, this.steps.length)} / ${this.steps.length}`;
    this.box.querySelector('.tText').innerHTML = s.text;
    this.box.querySelector('.tHint').innerHTML = s.hint || '';
    this.box.classList.add('pulse'); setTimeout(() => this.box.classList.remove('pulse'), 600);
    this.game.audio?.click();
    if (s.enter) s.enter();
  }
  spawnDrone(dist) {
    const game = this.game, p = game.player;
    const enemy = p.team === 'navy' ? 'coast' : 'navy';
    const fwd = new V3(p.fwd.x, 0, p.fwd.z).normalize();
    const pos = p.fm.pos.clone().addScaledVector(fwd, dist);
    const a = new Aircraft(game, 'f16', enemy, { name: 'Target drone' });
    a.isDrone = true; a.hist = [];
    a.placeAir(pos, Math.atan2(-fwd.x, -fwd.z) + 0.6, 120, Math.max(900, p.fm.pos.y));
    a.missiles = 0;
    a.ai = { update: (dt) => { const fm = a.fm; fm.throttle = 0.72; const r = new V3(1, 0, 0).applyQuaternion(fm.quat); fm.input.roll = clamp(-r.y * 2 + 0.25, -1, 1) * 0.5; fm.input.pitch = clamp((Math.max(900, p.fm.pos.y) - fm.pos.y) * 0.004 - fm.vel.y * 0.03, -0.4, 0.4); } };
    game.aircraft.push(a); game.match.roster.push(a);
    this.drones.push(a);
  }
  update(dt) {
    const p = this.game.player;
    if (!p || this.done) return;
    this.t += dt;
    if (p.alive) {
      const r = new V3(1, 0, 0).applyQuaternion(p.fm.quat), u = new V3(0, 1, 0).applyQuaternion(p.fm.quat);
      const bank = Math.atan2(-r.y, u.y) * RAD;
      if (bank < -50) this.flags.bankL = true;
      if (bank > 50) this.flags.bankR = true;
      if (Math.abs(p.fm.input.yaw) > 0.5) this.flags.yawT = (this.flags.yawT || 0) + dt;
      if (p.fm.stall > 0.1 && !p.fm.onGround) this.flags.stalled = true;
    }
    const s = this.steps[this.i];
    const bar = this.box.querySelector('.tBar i');
    bar.style.width = `${(this.i / (this.steps.length - 1)) * 100}%`;
    if (p.alive && s.check(p)) {
      this.i++; this.t = 0;
      if (this.i >= this.steps.length) { this.done = true; return; }
      if (this.i === this.steps.length - 1) this.game.onTutorialDone?.();
      this.show();
    }
  }
  // after a crash the lesson continues from a fresh start
  onRespawn() {
    if (this.i > 2 && this.i < 10) { this.i = 1; this.flags = {}; }
    this.show();
  }
  dispose() { this.box.classList.add('hidden'); }
}
