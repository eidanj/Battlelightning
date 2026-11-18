// Action-based keyboard input with rebinding, right-mouse free look, and a virtual layer fed by the touch controls.
export class Input {
  constructor(settings) {
    this.settings = settings;
    this.down = new Set();
    this.pressed = new Set();
    this.listeners = [];
    this.capture = null;    // callback while rebinding a key
    this.enabled = true;
    this.mouse = { dx: 0, dy: 0, right: false, left: false };
    // virtual inputs from the touch controls: held / tapped actions, stick axes, throttle target, look drag
    this.v = { held: new Set(), hit: new Set(), pitch: 0, roll: 0, throttle: null, look: false };
    window.addEventListener('keydown', (e) => this._kd(e));
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.right = false; this.mouse.left = false; });
    window.addEventListener('mousedown', (e) => { if (e.button === 2) this.mouse.right = true; if (e.button === 0) this.mouse.left = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.mouse.right = false; if (e.button === 0) this.mouse.left = false; });
    window.addEventListener('mousemove', (e) => { if (this.mouse.right || document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    window.addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
  }
  _kd(e) {
    if (this.capture) { e.preventDefault(); const cb = this.capture; this.capture = null; cb(e.code); return; }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && e.code !== 'Escape') return;
    const bound = this.isBoundCode(e.code);
    if (bound || ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!e.repeat) { this.pressed.add(e.code); for (const fn of this.listeners) fn(e.code); }
    this.down.add(e.code);
  }
  isBoundCode(code) { const k = this.settings.keys; for (const a in k) if (k[a][0] === code || k[a][1] === code) return true; return false; }
  // is an action held?
  held(action) { const k = this.settings.keys[action]; return this.v.held.has(action) || (!!k && ((k[0] && this.down.has(k[0])) || (k[1] && this.down.has(k[1])))); }
  // was an action pressed this frame?
  hit(action) { const k = this.settings.keys[action]; return this.v.hit.has(action) || (!!k && ((k[0] && this.pressed.has(k[0])) || (k[1] && this.pressed.has(k[1])))); }
  // a touch button acting like a key press: notify key listeners with the action's bound key
  tap(action) { this.v.hit.add(action); const k = this.settings.keys[action] || []; const code = k[0] || k[1]; if (code) for (const fn of this.listeners) fn(code); }
  axis(neg, pos) { return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0); }
  endFrame() { this.pressed.clear(); this.v.hit.clear(); this.mouse.dx = 0; this.mouse.dy = 0; }
  onKey(fn) { this.listeners.push(fn); }
  rebind(cb) { this.capture = cb; }
}
