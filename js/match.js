// Match flow: spawns both teams (player cold & dark on the carrier catapult or the airbase runway, AI flights
// already airborne), tracks remaining planes, kills / assists / score, the player's respawns, AI planes that go
// home to repair and relaunch, spotting for the radar, and the win / lose conditions.
import * as THREE from 'three';
import { TEAMS, CALLSIGNS, WORLD, AIRCRAFT } from './config.js';
import { Aircraft } from './aircraft.js';
import { AIPilot } from './ai.js';
import { makeRng, fmtTime } from './util.js';

const V3 = THREE.Vector3;

export class Match {
  constructor(game, o) {
    this.game = game; this.o = o;
    this.size = o.teamSize; this.playerTeam = o.side; this.enemyTeam = o.side === 'navy' ? 'coast' : 'navy';
    this.duration = o.duration ?? 20 * 60; this.timeLeft = this.duration;
    this.roster = []; this.parked = []; this.over = false; this.info = '';
    this.spotted = new Set(); this.spotT = 0; this.histT = 0;
    this.respawnT = -1; this.lives = Infinity;
    this.names = CALLSIGNS.slice().sort(() => Math.random() - 0.5);
  }
  pickName() { return this.names.pop() || `Pilot-${Math.floor(Math.random() * 99)}`; }

  start() {
    const game = this.game;
    this.spawnPlayer(true);
    if (this.o.noAI) return;
    // both wings fly the same mix of jets (one shuffled order shared by both teams) so neither side is outclassed
    const base = [...new Set([...TEAMS.navy.pool, ...TEAMS.coast.pool])], mix = [];
    while (mix.length < this.size) mix.push(...base.sort(() => Math.random() - 0.5));
    this.mix = mix;
    for (const team of ['navy', 'coast']) {
      const n = team === this.playerTeam ? this.size - 1 : this.size;
      for (let i = 0; i < n; i++) this.spawnAI(team, i, n);
    }
  }
  spawnPlayer(first = false) {
    const game = this.game, team = this.playerTeam;
    const p = new Aircraft(game, this.o.aircraft, team, { player: true, name: game.settings.callsign || 'You' });
    p.hist = [];
    game.aircraft.push(p);
    const prev = game.player;
    if (prev && this.roster.includes(prev)) {
      p.kills = prev.kills; p.assists = prev.assists; p.deaths = prev.deaths; p.score = prev.score;
      this.roster[this.roster.indexOf(prev)] = p;
    } else this.roster.push(p);
    game.player = p;
    if (team === 'navy') p.attachCatapult(Math.max(0, this.freeCat()), true);
    else { const R = game.world.airbase.runway; p.placeRunway(game.world, R.x1 - 160, R.z, Math.PI / 2, true); } // depart westbound, away from the mountains
    game.onPlayerSpawned?.(p);
    return p;
  }
  freeCat() { const used = new Set(this.game.aircraft.filter((a) => a.cat).map((a) => a.cat.i)); return used.has(0) ? (used.has(1) ? -1 : 1) : 0; }
  spawnAI(team, i, n) {
    const game = this.game, T = TEAMS[team];
    const id = this.mix ? this.mix[i % this.mix.length] : T.pool[Math.floor(Math.random() * T.pool.length)];
    const a = new Aircraft(game, id, team, { name: this.pickName() });
    a.isPrimary = true; a.hist = [];
    a.ai = new AIPilot(game, a, game.settings.difficulty);
    game.aircraft.push(a); this.roster.push(a);
    // flights of four, already airborne, staggered toward the front
    const flight = Math.floor(i / 4), slot = i % 4;
    const rows = Math.ceil(n / 4);
    const z = ((flight + 0.5) / rows - 0.5) * 16000 + (slot - 1.5) * 220;
    let x, heading;
    if (team === 'navy') { x = WORLD.front - 5000 + flight % 2 * 1500 + slot * 120; heading = -Math.PI / 2; }
    else { x = WORLD.front + 5000 - flight % 2 * 1500 - slot * 120; heading = Math.PI / 2; }
    a.placeAir(new V3(x, 0, z), heading, 210 + Math.random() * 30, 1600 + flight * 280 + slot * 40 + Math.random() * 200);
    return a;
  }

  count(team) {
    let n = 0;
    for (const a of this.game.aircraft) if (a.team === team && a.alive && !a.ejected) n++;
    return n;
  }
  isSpotted(a) { return this.spotted.has(a); }

  update(dt) {
    const game = this.game;
    if (this.over) return;
    this.timeLeft -= dt;
    // perception history for the AI (reaction delays)
    this.histT -= dt;
    if (this.histT <= 0) {
      this.histT = 0.1;
      for (const a of game.aircraft) { if (!a.hist) a.hist = []; a.hist.push({ t: game.time, pos: a.fm.pos.clone(), vel: a.fm.vel.clone() }); if (a.hist.length > 14) a.hist.shift(); }
    }
    // radar spotting
    this.spotT -= dt;
    if (this.spotT <= 0) {
      this.spotT = 0.5; this.spotted.clear();
      const mine = game.aircraft.filter((a) => a.team === this.playerTeam && a.alive);
      for (const e of game.aircraft) {
        if (e.team === this.playerTeam || !e.alive) continue;
        if (e.gunFiring || mine.some((f) => f.fm.pos.distanceToSquared(e.fm.pos) < 7500 * 7500)) this.spotted.add(e);
      }
    }
    // AI that went home: repair and relaunch
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const e = this.parked[i];
      e.t -= dt;
      if (e.t > 0) continue;
      const a = e.a;
      if (!a.alive) { this.parked.splice(i, 1); continue; }
      if (a.team === 'navy') {
        const cat = this.freeCat();
        if (cat < 0) continue;
        for (const c of ['fuselage', 'wingL', 'wingR', 'engine', 'tail']) a.hp[c] = a.maxHp[c];
        a._applyDamage(); a.engineFire = false; a.rearm();
        a.parked = false; a.group.visible = true; a.ai.rtb = false; a.ai.state = 'climbout'; a.ai.t = 0;
        a.attachCatapult(cat, false); a.fm.engine = 'running'; a.fm.rpm = 0.7;
      } else {
        const R = game.world.airbase.runway;
        const busy = game.aircraft.some((o) => o !== a && o.alive && !o.parked && o.fm.onGround && Math.abs(o.fm.pos.z - R.z) < 40 && o.fm.pos.x > R.x1 - 900);
        if (busy) continue;
        for (const c of ['fuselage', 'wingL', 'wingR', 'engine', 'tail']) a.hp[c] = a.maxHp[c];
        a._applyDamage(); a.engineFire = false; a.rearm();
        a.parked = false; a.group.visible = true; a.ai.rtb = false; a.ai.state = 'climbout'; a.ai.t = 0;
        a.placeRunway(game.world, R.x1 - 200, R.z, Math.PI / 2, false); // westbound departure
      }
      this.parked.splice(i, 1);
    }
    // player respawn
    if (this.respawnT >= 0) {
      this.respawnT -= dt;
      game.ui?.setRespawn(this.respawnT, this.canRespawn());
    }
    // win / lose
    const mine = this.count(this.playerTeam), theirs = this.count(this.enemyTeam);
    const playerOut = !game.player || !game.player.alive || game.player.ejected;
    if (!this.o.noAI) {
      if (theirs === 0) this.end(true, 'All enemy aircraft destroyed');
      else if (mine === 0 && playerOut && !this.canRespawn()) this.end(false, 'Your squadron has been wiped out');
      else if (this.timeLeft <= 0) this.end(mine > theirs, mine > theirs ? 'Time up — your side holds the sky' : mine === theirs ? 'Time up — stalemate' : 'Time up — the enemy holds the sky');
    }
    this.info = `${this.count(this.playerTeam)} vs ${this.count(this.enemyTeam)}`;
  }
  // a respawn costs the team an airframe: the player takes the jet of a teammate who stays on the ground
  // (one being serviced if possible, otherwise whoever is farthest from the fight)
  takeOverReserve() {
    const game = this.game;
    if (this.o.noAI) return null;
    const mates = game.aircraft.filter((a) => a.team === this.playerTeam && a.alive && !a.isPlayer && !a.ejected);
    if (!mates.length) return null;
    const foes = game.aircraft.filter((a) => a.team === this.enemyTeam && a.alive);
    const score = (a) => (a.parked ? -1e9 : 0) + (a.fm.onGround ? -1e8 : 0) - foes.reduce((m, e) => Math.min(m, e.fm.pos.distanceTo(a.fm.pos)), 1e7);
    mates.sort((x, y) => score(x) - score(y));
    const a = mates[0];
    a.alive = false; a.state = 'retired';
    this.parked = this.parked.filter((e) => e.a !== a);
    a.dispose(); game.aircraft = game.aircraft.filter((o) => o !== a);
    return a.name;
  }
  canRespawn() { return this.o.noAI || this.game.aircraft.some((a) => a.team === this.playerTeam && a.alive && !a.isPlayer); }
  end(win, reason) {
    if (this.over) return;
    this.over = true;
    this.game.onMatchEnd?.(win, reason);
  }

  // ---------------- events ----------------
  onKill(killer, victim, cause) {
    const game = this.game;
    victim.deaths++;
    const assists = [];
    for (const [a, dmg] of victim.damagers) {
      if (a === killer || !a || a.team === victim.team || a.isGround) continue;
      if (dmg > 60) { a.assists++; a.score += 50; assists.push(a); }
    }
    const tag = (a) => `<span class="${a.team === game.playerTeam ? 'fr' : 'en'}">${a.isGround ? a.name : `${a.name} <small>${a.def.short}</small>`}</span>`;
    if (killer && killer !== victim && !killer.isGround) {
      killer.kills++; killer.score += 100;
      game.hud.feed(`${tag(killer)} <b class="arrow">▶</b> ${tag(victim)}`, killer.isPlayer || victim.isPlayer ? 'mine' : '');
      if (killer.isPlayer) { game.hud.hitMarker(true); game.audio.killConfirm(); game.hud.message(`${victim.def.short} DESTROYED  +100`, 'good', 2.5); }
      if (assists.includes(game.player)) game.hud.message('ASSIST  +50', 'good', 2);
    } else if (killer && killer.isGround) {
      game.hud.feed(`${tag(killer)} <b class="arrow">▶</b> ${tag(victim)}`, victim.isPlayer ? 'mine' : '');
    } else {
      game.hud.feed(`${tag(victim)} <span class="cause">${cause}</span>`, victim.isPlayer ? 'mine' : '');
    }
    if (victim.isPlayer) game.onPlayerDown?.(victim, killer, cause);
  }
  onAIParked(a) { this.parked.push({ a, t: 16 + Math.random() * 8 }); }
}
