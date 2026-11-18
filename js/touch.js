// Touch controls for phones and tablets (landscape).
// Left thumb: a floating flight stick that appears wherever you touch the left side.
// Right thumb: throttle slider on the right edge, FIRE / missile / flare buttons beside it.
// Small buttons: pause, camera, map, eject (top left) and gear, brake, reload (above the fire buttons).
// Dragging anywhere else on the right side looks around.
const isTouchDevice = () => (window.matchMedia?.('(pointer: coarse)').matches ?? false) || (navigator.maxTouchPoints || 0) > 0 && !(window.matchMedia?.('(pointer: fine)').matches);

export class TouchControls {
  constructor(game) {
    this.game = game; this.input = game.input; this.s = game.settings;
    this.active = false;
    this.stick = null;   // { id, ox, oy } while the stick is held
    this.thr = null;     // pointer id on the throttle
    this.look = null;    // { id, x, y } while dragging to look
    this.root = document.querySelector('#touch');
    // pause menu: enter / leave full screen by hand (hidden where the browser has no full screen, e.g. iPhone Safari)
    const pfs = document.querySelector('#pauseFs');
    if (pfs) {
      const label = () => { pfs.textContent = this.isFullscreen ? 'Exit full screen' : 'Full screen'; pfs.style.display = this.canFullscreen ? '' : 'none'; };
      pfs.addEventListener('click', () => { this.toggleFullscreen(); setTimeout(label, 300); });
      for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, label);
      label();
    }
    this._build();
    this.setMode(this.s.touch || 'auto');
    // auto mode: the first real touch switches the controls on
    window.addEventListener('touchstart', () => { if ((this.s.touch || 'auto') === 'auto' && !this.active) this.enable(true); }, { passive: true });
    // Full screen is asked for ONCE, when a match starts (and from the ⛶ button) — never again on its own.
    // If the phone leaves full screen (e.g. an edge swipe), the game just keeps going; it does not fight back.
    // Anything that interrupts the touches (full screen change, rotation, app switch) releases the stick and buttons,
    // so a finger lost mid-swipe can't leave the stick stuck over.
    const reset = () => { const V = this.input.v, map = V.held.has('scoreboard'); V.pitch = 0; V.roll = 0; V.held.clear(); if (map) V.held.add('scoreboard'); this.input.v.look = false; this.stick = null; this.look = null; this.thr = null; this.input.v.thrTouch = false;
      this.root.querySelectorAll('.on').forEach((b) => { if (!b.matches('[data-toggle]')) b.classList.remove('on'); }); this._ghost(); };
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'orientationchange']) document.addEventListener(ev, reset);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
    // last finger lifted anywhere: nothing can still be held
    window.addEventListener('touchend', (e) => { if (e.touches.length === 0 && (this.stick || this.look || [...this.input.v.held].some((a) => a !== 'scoreboard'))) reset(); }, { passive: true });
    window.addEventListener('touchcancel', (e) => { if (e.touches.length === 0) reset(); }, { passive: true });
    window.addEventListener('resize', () => { if (!this.stick) this._ghost(); });
  }

  get canFullscreen() { return !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen); }
  get isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  enterFullscreen() {
    if (!this.active || this.isFullscreen || !this.canFullscreen) return;
    const el = document.documentElement, req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    Promise.resolve(req).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  }
  toggleFullscreen() {
    if (this.isFullscreen) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    else this.enterFullscreen();
  }
  setMode(mode) {
    this.s.touch = mode;
    this.enable(mode === 'on' || (mode === 'auto' && isTouchDevice()));
  }
  enable(on) {
    this.active = on;
    document.body.classList.toggle('touch', on);
    if (!on) this._releaseAll();
  }

  _build() {
    const R = this.root;
    R.innerHTML = `
      <div class="tzone" id="tStickZone"></div>
      <div class="tstick ghost" id="tStick"><div class="tknob"></div></div>
      <div class="tgroup tl">
        <button class="tbtn" data-tap="pause" aria-label="Pause">☰</button>
        <button class="tbtn" data-tap="camera" aria-label="Camera">CAM</button>
        <button class="tbtn" data-toggle="scoreboard" aria-label="Map and scoreboard">MAP</button>
        <button class="tbtn eject" data-tap="eject" aria-label="Eject (tap twice)">EJECT</button>
      </div>
      <div class="tgroup tr">
        <button class="tbtn" data-tap="gear" id="tGearBtn">GEAR</button>
        <button class="tbtn" data-hold="brake">BRK</button>
        <button class="tbtn" data-tap="reload" aria-label="Reload">⟳</button>
      </div>
      <div class="tthr" id="tThrottle"><div class="tfill"></div><div class="tabdet">AB</div><div class="tthumb"><span>0%</span></div><div class="tlbl">THR</div></div>
      <button class="tfire big" data-hold="fireGuns"><b>FIRE</b><small id="tAmmo"></small></button>
      <button class="tfire msl" data-tap="fireMissile"><b>MSL</b><small id="tMsl"></small></button>
      <button class="tfire flr" data-hold="flares"><b>FLR</b><small id="tFlr"></small></button>
      <div class="trud"><button class="tbtn" data-hold="yawLeft" aria-label="Rudder left">◀</button><span>RUDDER</span><button class="tbtn" data-hold="yawRight" aria-label="Rudder right">▶</button></div>`;
    this.el = {
      stick: R.querySelector('#tStick'), knob: R.querySelector('.tknob'), zone: R.querySelector('#tStickZone'),
      thr: R.querySelector('#tThrottle'), fill: R.querySelector('.tfill'), thumb: R.querySelector('.tthumb'), thumbTxt: R.querySelector('.tthumb span'),
      ammo: R.querySelector('#tAmmo'), msl: R.querySelector('#tMsl'), flr: R.querySelector('#tFlr'), gear: R.querySelector('#tGearBtn'),
      mapBtn: R.querySelector('[data-toggle="scoreboard"]'),
    };
    const V = this.input.v;
    // ---- buttons ----
    for (const b of R.querySelectorAll('[data-hold]')) {
      const a = b.dataset.hold;
      const on = (e) => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture?.(e.pointerId); V.held.add(a); b.classList.add('on'); };
      const off = (e) => { e.preventDefault(); V.held.delete(a); b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    }
    for (const b of R.querySelectorAll('[data-tap]')) {
      const a = b.dataset.tap;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 140);
        if (a === 'pause') this.game.pause();
        else if (a === 'camera') this.input.tap('camera');
        else V.hit.add(a);
      });
    }
    const mapBtn = this.el.mapBtn;
    mapBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (V.held.has('scoreboard')) V.held.delete('scoreboard'); else V.held.add('scoreboard'); mapBtn.classList.toggle('on', V.held.has('scoreboard')); });
    // ---- throttle: finger height sets the throttle directly ----
    const thrSet = (e) => {
      const r = this.el.thr.getBoundingClientRect();
      let v = 1 - (e.clientY - r.top - 14) / Math.max(1, r.height - 28);
      v = Math.max(0, Math.min(1, v)); if (v > 0.94) v = 1; if (v < 0.03) v = 0;
      V.throttle = v;
    };
    this.el.thr.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.el.thr.setPointerCapture?.(e.pointerId); this.thr = e.pointerId; V.thrTouch = true; V.thrSet = null; thrSet(e); this.el.thr.classList.add('on'); });
    this.el.thr.addEventListener('pointermove', (e) => { if (e.pointerId === this.thr) thrSet(e); });
    const thrOff = (e) => { if (e.pointerId !== this.thr) return; this.thr = null; V.thrTouch = false; this.el.thr.classList.remove('on'); }; // the lever stays where it was left
    this.el.thr.addEventListener('pointerup', thrOff); this.el.thr.addEventListener('pointercancel', thrOff);
    // ---- stick (left side) and look-around (everything else) ----
    R.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.preventDefault();
      const z = this.el.zone.getBoundingClientRect();
      if (!this.stick && e.clientX >= z.left && e.clientX <= z.right && e.clientY >= z.top && e.clientY <= z.bottom) {
        R.setPointerCapture?.(e.pointerId);
        this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
        this.el.stick.classList.remove('ghost');
        this.el.stick.style.left = `${e.clientX}px`; this.el.stick.style.top = `${e.clientY}px`;
        this._stickMove(e);
      } else if (!this.look) {
        R.setPointerCapture?.(e.pointerId);
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
        V.look = true;
      }
    });
    R.addEventListener('pointermove', (e) => {
      if (this.stick && e.pointerId === this.stick.id) this._stickMove(e);
      else if (this.look && e.pointerId === this.look.id) {
        this.input.mouse.dx += (e.clientX - this.look.x) * 1.6; this.input.mouse.dy += (e.clientY - this.look.y) * 1.6;
        this.look.x = e.clientX; this.look.y = e.clientY;
      }
    });
    const up = (e) => {
      if (this.stick && e.pointerId === this.stick.id) { this.stick = null; V.pitch = 0; V.roll = 0; this._ghost(); }
      if (this.look && e.pointerId === this.look.id) { this.look = null; V.look = false; }
    };
    R.addEventListener('pointerup', up); R.addEventListener('pointercancel', up);
    this._ghost();
  }
  _stickMove(e) {
    const st = this.stick, rad = this._radius();
    let dx = e.clientX - st.ox, dy = e.clientY - st.oy;
    const d = Math.hypot(dx, dy);
    if (d > rad) { dx *= rad / d; dy *= rad / d; }
    this.el.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // response curve: gentle near the centre for fine aiming, full authority at the edge
    const curve = (v) => v * (0.35 + 0.65 * Math.abs(v));
    const inv = this.s.touchInvert ? -1 : 1;
    this.input.v.roll = curve(dx / rad);
    this.input.v.pitch = curve(dy / rad) * inv; // pull the stick down (toward you) = nose up
  }
  _radius() { return Math.max(44, Math.min(70, Math.min(innerWidth, innerHeight) * 0.13)); }
  _ghost() {
    // resting position hint, bottom-left
    const z = this.el.zone.getBoundingClientRect(), rad = this._radius();
    this.el.stick.classList.add('ghost');
    this.el.stick.style.left = `${z.left + rad * 1.9}px`; this.el.stick.style.top = `${z.bottom - rad * 1.9}px`;
    this.el.knob.style.transform = '';
  }
  _releaseAll() {
    const V = this.input.v;
    V.held.clear(); V.hit.clear(); V.pitch = V.roll = 0; V.throttle = null; V.thrTouch = false; V.thrSet = null; V.look = false;
    this.stick = this.thr = this.look = null;
    this.root?.querySelectorAll('.on').forEach((b) => b.classList.remove('on'));
  }

  // per frame: show/hide, and mirror the aircraft state onto the controls
  update() {
    const g = this.game, p = g.player;
    const show = this.active && g.state === 'playing' && !g.paused;
    this.root.classList.toggle('hidden', !show);
    if (show && !this._shown && !this.stick) requestAnimationFrame(() => this._ghost()); // place the resting stick once the layer has a size
    this._shown = show;
    if (!show) { if (this.stick || this.thr || this.look || this.input.v.held.size || this.input.v.pitch || this.input.v.roll) this._releaseAll(); return; }
    if (p !== this._p) { this._p = p; this.input.v.throttle = null; this.input.v.thrSet = null; }
    const flying = !!(p && p.alive && !p.ejected);
    this.root.classList.toggle('down', !flying);
    if (!flying) return;
    const fm = p.fm, thr = this.input.v.throttle ?? fm.throttle;
    const pct = Math.round(thr * 100);
    this.el.fill.style.height = `${pct}%`;
    this.el.thumb.style.bottom = `calc((100% - 28px) * ${thr.toFixed(3)})`;
    this.el.thumbTxt.textContent = fm.engine === 'off' ? 'OFF' : fm.engine === 'starting' ? 'START' : thr > 0.97 ? 'AB' : `${pct}%`;
    this.el.thr.classList.toggle('ab', thr > 0.97 && fm.engine === 'running' && !p.model.info?.noAB);
    this.el.ammo.textContent = p.reloading > 0 ? 'RELOAD' : `${p.gunAmmo}`;
    this.el.msl.textContent = `${p.missiles}`;
    this.el.flr.textContent = `${p.flares}`;
    this.el.msl.parentElement.classList.toggle('lock', p.lock.state === 2);
    this.el.msl.parentElement.classList.toggle('seek', p.lock.state === 1);
    this.el.gear.classList.toggle('lit', fm.gearCmd > 0.5);
  }
}

// labels used in prompts and the tutorial when touch controls are on
export const TOUCH_LABELS = {
  throttleUp: 'THROTTLE ▲', throttleDown: 'THROTTLE ▼', pitchUp: 'STICK ▼', pitchDown: 'STICK ▲', rollLeft: 'STICK ◀', rollRight: 'STICK ▶',
  yawLeft: 'RUDDER ◀', yawRight: 'RUDDER ▶', fireGuns: 'FIRE', fireMissile: 'MSL', flares: 'FLR', gear: 'GEAR', camera: 'CAM', reload: '⟳',
  eject: 'EJECT', brake: 'BRK', scoreboard: 'MAP', lookBack: 'drag right side',
};
