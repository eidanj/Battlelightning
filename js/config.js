// Battle Lightning: game data. Aircraft, teams, keybinds, graphics presets, world layout.
// Body frame for every aircraft: x = right, y = up, -z = forward (nose), origin at the centre of gravity.

export const VERSION = '1.0.0';
export const G = 9.81;

// ---------------- WORLD ----------------
export const WORLD = {
  half: 16000,               // battle area is 32 km x 32 km, ocean west (x<0), land east (x>0)
  boundaryWarn: 15000,
  ceiling: 14000,
  fleetCenter: [-9600, 1500], // carrier group steams a racetrack around here (x, z)
  front: -1200,               // the contested line between the two AA umbrellas: spawns and AI patrols are set around it
  fleetRadius: 2200,         // racetrack turn radius
  fleetLeg: 11000,           // racetrack straight-leg length (north-south)
  fleetSpeed: 14,            // m/s (~27 knots)
  airbase: { x: 9200, z: 2400, len: 3000, width: 46, heading: 0 }, // runway along x
  city: { x0: 600, x1: 4800, z0: -6200, z1: -1200 },
  river: { z: -3600 },       // estuary through the city
};

// ---------------- KEYBINDS (KeyboardEvent.code) ----------------
export const ACTIONS = [
  ['throttleUp', 'Throttle up (hold)'],
  ['throttleDown', 'Throttle down (hold)'],
  ['pitchDown', 'Pitch down (nose down)'],
  ['pitchUp', 'Pitch up (nose up)'],
  ['rollLeft', 'Roll left'],
  ['rollRight', 'Roll right'],
  ['yawLeft', 'Yaw left (rudder)'],
  ['yawRight', 'Yaw right (rudder)'],
  ['fireGuns', 'Fire guns'],
  ['reload', 'Reload guns'],
  ['fireMissile', 'Fire missile (needs lock)'],
  ['flares', 'Drop flares'],
  ['gear', 'Toggle landing gear'],
  ['brake', 'Brakes (air brake / wheel brakes)'],
  ['camera', 'Switch camera (cockpit / chase)'],
  ['scoreboard', 'Scoreboard / tactical map (hold)'],
  ['eject', 'Eject (press twice)'],
  ['lookBack', 'Look behind (hold)'],
];
export const DEFAULT_KEYS = {
  throttleUp: ['BracketRight', 'Equal'],
  throttleDown: ['BracketLeft', 'Minus'],
  pitchDown: ['KeyW', 'ArrowUp'],
  pitchUp: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', null],
  rollRight: ['KeyD', null],
  yawLeft: ['KeyZ', 'ArrowLeft'],
  yawRight: ['KeyX', 'ArrowRight'],
  fireGuns: ['Space', null],
  reload: ['KeyQ', null],
  fireMissile: ['KeyC', null],
  flares: ['KeyF', null],
  gear: ['KeyG', null],
  brake: ['KeyB', 'ShiftLeft'],
  camera: ['KeyV', null],
  scoreboard: ['Tab', null],
  eject: ['KeyE', null],
  lookBack: ['KeyR', null],
};

// ---------------- GRAPHICS ----------------
export const GFX_PRESETS = {
  low:    { label: 'Low',    scale: 0.7,  shadows: 0,    clouds: 0.45, trees: 0.35, ocean: 0, bloom: false, particles: 0.5, fxaa: false, view: 26000 },
  medium: { label: 'Medium', scale: 0.85, shadows: 1024, clouds: 0.7,  trees: 0.6,  ocean: 1, bloom: false, particles: 0.75, fxaa: true, view: 34000 },
  high:   { label: 'High',   scale: 1.0,  shadows: 2048, clouds: 1.0,  trees: 1.0,  ocean: 2, bloom: true,  particles: 1.0, fxaa: true, view: 42000 },
  ultra:  { label: 'Ultra',  scale: 1.25, shadows: 4096, clouds: 1.35, trees: 1.4,  ocean: 2, bloom: true,  particles: 1.3, fxaa: true, view: 52000 },
};

export const DEFAULT_SETTINGS = {
  preset: 'high',
  gfx: { ...GFX_PRESETS.high },
  volume: 0.8, music: 0.4,
  fov: 72,
  units: 'kmh',          // 'kmh' | 'kts'
  mouseLook: true,       // hold right mouse to look around
  invertLook: false,
  touch: 'auto',         // touch controls: 'auto' (phones/tablets) | 'on' | 'off'
  touchInvert: false,    // touch stick: false = pull down for nose up (like a real stick)
  showFps: false,
  teamSize: 20,
  side: 'navy',          // 'navy' (carrier) | 'coast' (airbase)
  difficulty: 'veteran', // AI skill
  timeOfDay: 'afternoon',
  aircraft: 'f14',
  keys: null,            // filled from DEFAULT_KEYS
};

export const DIFFICULTY = {
  rookie:  { label: 'Rookie',  react: 0.7, aimErr: 0.95, gunRange: 750, skill: 0.45, flareSkill: 0.35 },
  veteran: { label: 'Veteran', react: 0.45, aimErr: 0.6, gunRange: 900, skill: 0.7,  flareSkill: 0.55 },
  ace:     { label: 'Ace',     react: 0.3, aimErr: 0.35, gunRange: 1050, skill: 0.92, flareSkill: 0.75 },
};

export const TIME_OF_DAY = {
  dawn:      { label: 'Dawn',      elev: 6,  azim: 80,  turbidity: 6, rayleigh: 2.4, exposure: 0.55, sunColor: 0xffc79a, hemiSky: 0x9fb4d8, hemiGround: 0x46403a },
  noon:      { label: 'Noon',      elev: 62, azim: 160, turbidity: 2.2, rayleigh: 1.0, exposure: 0.42, sunColor: 0xfff6ea, hemiSky: 0xbcd4f2, hemiGround: 0x5a5448 },
  afternoon: { label: 'Afternoon', elev: 30, azim: 230, turbidity: 3, rayleigh: 1.3, exposure: 0.46, sunColor: 0xffe8cc, hemiSky: 0xb2c8e8, hemiGround: 0x54504a },
  sunset:    { label: 'Sunset',    elev: 4,  azim: 262, turbidity: 7, rayleigh: 2.8, exposure: 0.6, sunColor: 0xffae70, hemiSky: 0x8a98c0, hemiGround: 0x3e3530 },
};

// ---------------- TEAMS ----------------
export const TEAMS = {
  navy:  { id: 'navy',  name: 'Navy Task Force', short: 'NAVY',  base: 'carrier', paint: 'navy',  pool: ['f14', 'f14', 'f18', 'f18', 'f16', 'su27', 'a10'] },
  coast: { id: 'coast', name: 'Coastal Air Wing', short: 'COAST', base: 'airbase', paint: 'coast', pool: ['su27', 'su27', 'f16', 'f16', 'a10', 'f18', 'f14'] },
};

export const CALLSIGNS = ['Viper', 'Maverick', 'Iceman', 'Jester', 'Goose', 'Hollywood', 'Slider', 'Cougar', 'Merlin', 'Wolfman', 'Sundown', 'Chipper',
  'Rooster', 'Hangman', 'Phoenix', 'Bob', 'Payback', 'Fanboy', 'Coyote', 'Warlock', 'Ghost', 'Reaper', 'Havoc', 'Striker', 'Nomad', 'Raven',
  'Saber', 'Talon', 'Blaze', 'Frost', 'Spectre', 'Titan', 'Hawk', 'Falcon', 'Cobra', 'Mustang', 'Bandit', 'Outlaw', 'Joker', 'Ranger',
  'Thunder', 'Bolt', 'Arrow', 'Lancer', 'Duke', 'Ace', 'Echo', 'Kilo', 'Zulu', 'Rogue', 'Hunter', 'Shadow', 'Storm', 'Tango', 'Flash', 'Rocket',
  'Dagger', 'Wraith', 'Banshee', 'Comet', 'Orbit', 'Static', 'Volt', 'Ion', 'Nova', 'Pulse'];

// ---------------- AIRCRAFT ----------------
// aero: S wing area m2, cd0, k induced, cdWave transonic drag rise, clA lift slope /rad, clMax, alphaOver (deg past stall reachable),
// gMax/gNeg load limits (stability augmentation), rollRate deg/s, pitchK/pitchD short-period stiffness/damping, yawK/yawD.
// engine: thrustMil/thrustAB (N, total), spool time constant (s), lapse (thrust loss per Mach, high-bypass fans), fuel kg, flow kg/s.
// geo: body-frame points in metres. hp: component hit points. armor: damage divisor.
export const AIRCRAFT = {
  f14: {
    id: 'f14', name: 'F-14 Interceptor', short: 'F-14', role: 'Fleet interceptor',
    pro: 'Highest top speed and the longest missile lock range in the hangar. Swing wings sweep back automatically for speed.',
    con: 'Heavy. Bleeds speed quickly in tight turns and is slow to spool up its engines.',
    mass: 24500, fuel: 7300, flowMil: 1.5, flowAB: 6.2,
    aero: { S: 52.5, cd0: 0.0215, k: 0.115, kSwept: 0.175, cdWave: 0.03, clA: 4.2, clMax: 1.55, clMaxSwept: 1.22, alphaOver: 7, gMax: 7.5, gNeg: 3,
      rollRate: 155, pitchK: 15, pitchD: 4.6, yawK: 9, yawD: 3.4, swing: true },
    engine: { thrustMil: 142000, thrustAB: 232000, spool: 2.4, lapse: 0.0, twin: true },
    inertia: [330000, 520000, 170000], // pitch(x), yaw(y), roll(z) kg m2
    gun: { name: 'M61 Vulcan 20 mm', rpm: 4200, box: 225, boxes: 3, vel: 1030, dmg: 34, spread: 0.0016, reload: 3.6 },
    missile: { name: 'AIM-9 IR', lockRange: 7200, lockTime: 1.0, cone: 7 },
    flares: 30,
    hp: { fuselage: 420, wingL: 230, wingR: 230, engine: 270, tail: 190 }, armor: 1.0,
    geo: {
      len: 19.1, span: 19.5, noseZ: -10.0, tailZ: 9.1,
      eye: [0, 1.22, -5.15], gun: [-0.62, -0.32, -6.6],
      gearNose: [0, -1.86, -6.75], gearMain: [2.55, -1.86, 0.95], wheelR: [0.34, 0.48],
      nozzles: [[-1.35, -0.12, 8.95, 0.56], [1.35, -0.12, 8.95, 0.56]],
      tips: [9.6, 0.1, 0.8], tipsSwept: [5.9, 0.1, 3.4], fin: [1.6, 3.05, 7.2], hook: [0, -0.9, 8.4],
      missiles: [[-1.2, -0.95, -1.5], [1.2, -0.95, -1.5], [-2.35, -0.6, 0.2], [2.35, -0.6, 0.2], [0, -1.0, 2.6]],
    },
  },
  f18: {
    id: 'f18', name: 'F/A-18 Hornet', short: 'F/A-18', role: 'Carrier multirole',
    pro: 'Superb nose authority at low speed and high angle of attack. A rugged carrier airframe that shrugs off hits.',
    con: 'Lowest top speed of the jets and sluggish acceleration once it is slow.',
    mass: 17200, fuel: 4900, flowMil: 1.2, flowAB: 4.9,
    aero: { S: 37.2, cd0: 0.0236, k: 0.11, cdWave: 0.036, clA: 3.95, clMax: 1.85, alphaOver: 9, gMax: 7.5, gNeg: 3,
      rollRate: 210, pitchK: 17, pitchD: 4.8, yawK: 10, yawD: 3.4 },
    engine: { thrustMil: 98000, thrustAB: 158000, spool: 1.9, lapse: 0.0, twin: true },
    inertia: [150000, 220000, 42000],
    gun: { name: 'M61A1 20 mm', rpm: 4000, box: 190, boxes: 3, vel: 1030, dmg: 34, spread: 0.0014, reload: 3.2 },
    missile: { name: 'AIM-9 IR', lockRange: 5200, lockTime: 1.0, cone: 8 },
    flares: 36,
    hp: { fuselage: 400, wingL: 200, wingR: 200, engine: 250, tail: 170 }, armor: 1.12,
    geo: {
      len: 17.1, span: 12.3, noseZ: -8.85, tailZ: 8.25,
      eye: [0, 1.12, -4.7], gun: [0, 0.42, -8.1],
      gearNose: [0, -1.68, -5.6], gearMain: [1.62, -1.68, 0.95], wheelR: [0.3, 0.42],
      nozzles: [[-0.56, -0.08, 8.05, 0.42], [0.56, -0.08, 8.05, 0.42]],
      tips: [6.15, 0.05, 1.6], fin: [1.35, 2.85, 5.6], hook: [0, -0.7, 7.3],
      missiles: [[-6.15, 0.05, 1.4], [6.15, 0.05, 1.4], [-3.9, -0.45, 0.8], [3.9, -0.45, 0.8], [0, -1.05, 0.2]],
    },
  },
  f16: {
    id: 'f16', name: 'F-16 Viper', short: 'F-16', role: 'Lightweight dogfighter',
    pro: 'Best acceleration and the fastest roll rate. 9 G stability augmentation lets it out-turn heavier jets.',
    con: 'One engine and a light airframe: it cannot take much damage, and it has the shortest missile lock range.',
    mass: 12100, fuel: 3200, flowMil: 0.95, flowAB: 4.0,
    aero: { S: 27.9, cd0: 0.0188, k: 0.118, cdWave: 0.036, clA: 3.6, clMax: 1.56, alphaOver: 7, gMax: 9.0, gNeg: 3,
      rollRate: 260, pitchK: 19, pitchD: 5.2, yawK: 10, yawD: 3.6 },
    engine: { thrustMil: 77000, thrustAB: 129000, spool: 1.45, lapse: 0.0, twin: false },
    inertia: [78000, 92000, 14000],
    gun: { name: 'M61A1 20 mm', rpm: 4800, box: 170, boxes: 3, vel: 1030, dmg: 33, spread: 0.0014, reload: 3.0 },
    missile: { name: 'AIM-9 IR', lockRange: 4300, lockTime: 1.0, cone: 8 },
    flares: 30,
    hp: { fuselage: 300, wingL: 160, wingR: 160, engine: 165, tail: 140 }, armor: 0.92,
    geo: {
      len: 15.0, span: 9.96, noseZ: -7.65, tailZ: 7.35,
      eye: [0, 1.18, -3.95], gun: [-0.78, 0.36, -2.9],
      gearNose: [0, -1.56, -3.65], gearMain: [1.2, -1.56, 0.7], wheelR: [0.27, 0.36],
      nozzles: [[0, 0.02, 7.25, 0.56]],
      tips: [4.98, 0.08, 1.9], fin: [0, 3.4, 5.8], hook: [0, -0.62, 6.0],
      missiles: [[-4.98, 0.08, 1.7], [4.98, 0.08, 1.7], [-3.3, -0.4, 1.0], [3.3, -0.4, 1.0], [-2.3, -0.42, 0.6]],
    },
  },
  su27: {
    id: 'su27', name: 'Su-27 Flanker', short: 'Su-27', role: 'Air superiority',
    pro: 'Super-manoeuvrable. Huge thrust and efficient lifting body: it keeps its energy through sustained turns and can reach extreme angles of attack.',
    con: 'A big, easy-to-hit target, and its roll is sluggish at low speed. Slow-firing 30 mm cannon.',
    mass: 23200, fuel: 7800, flowMil: 1.5, flowAB: 6.0,
    aero: { S: 62, cd0: 0.0205, k: 0.102, cdWave: 0.028, clA: 4.05, clMax: 1.78, alphaOver: 12, gMax: 9.0, gNeg: 3,
      rollRate: 170, pitchK: 16, pitchD: 4.4, yawK: 9, yawD: 3.2 },
    engine: { thrustMil: 152000, thrustAB: 246000, spool: 2.0, lapse: 0.0, twin: true },
    inertia: [300000, 460000, 100000],
    gun: { name: 'GSh-30-1 30 mm', rpm: 1800, box: 75, boxes: 2, vel: 900, dmg: 72, spread: 0.0016, reload: 4.0 },
    missile: { name: 'R-73 IR', lockRange: 6000, lockTime: 0.9, cone: 10 },
    flares: 40,
    hp: { fuselage: 470, wingL: 250, wingR: 250, engine: 300, tail: 200 }, armor: 1.12,
    geo: {
      len: 21.9, span: 14.7, noseZ: -11.4, tailZ: 10.5,
      eye: [0, 1.32, -6.5], gun: [0.98, 0.3, -3.7],
      gearNose: [0, -2.0, -7.8], gearMain: [2.2, -2.0, 1.3], wheelR: [0.34, 0.52],
      nozzles: [[-1.25, -0.32, 9.45, 0.62], [1.25, -0.32, 9.45, 0.62]],
      tips: [7.35, 0.0, 3.0], fin: [2.2, 3.7, 7.5], hook: [0, -0.9, 9.8],
      missiles: [[-7.35, 0.0, 2.6], [7.35, 0.0, 2.6], [-5.4, -0.5, 1.8], [5.4, -0.5, 1.8], [0, -1.2, 1.0]],
    },
  },
  a10: {
    id: 'a10', name: 'A-10 Thunderbolt II', short: 'A-10', role: 'Armoured attacker',
    pro: 'A flying tank: titanium armour, the toughest airframe here, the devastating GAU-8 30 mm cannon and tight low-speed turns.',
    con: 'By far the slowest top speed and climb. No afterburner, so it cannot run away from a fight.',
    mass: 19500, fuel: 4800, flowMil: 0.7, flowAB: 0.7,
    aero: { S: 47, cd0: 0.04, k: 0.062, cdWave: 0.09, clA: 5.2, clMax: 1.75, alphaOver: 6, gMax: 7.3, gNeg: 3,
      rollRate: 135, pitchK: 15, pitchD: 4.6, yawK: 9, yawD: 3.6 },
    engine: { thrustMil: 81000, thrustAB: 81000, spool: 2.6, lapse: 0.6, twin: true, noAB: true },
    inertia: [210000, 330000, 120000],
    gun: { name: 'GAU-8 Avenger 30 mm', rpm: 3900, box: 300, boxes: 3, vel: 1010, dmg: 52, spread: 0.0022, reload: 4.5 },
    missile: { name: 'AIM-9 IR', lockRange: 3600, lockTime: 1.1, cone: 8 },
    flares: 48,
    hp: { fuselage: 640, wingL: 340, wingR: 340, engine: 330, tail: 260 }, armor: 1.6,
    geo: {
      len: 16.3, span: 17.5, noseZ: -8.25, tailZ: 8.05,
      eye: [0, 1.32, -4.8], gun: [-0.18, -0.58, -8.35],
      gearNose: [0.45, -1.62, -5.6], gearMain: [2.65, -1.62, 0.75], wheelR: [0.32, 0.46], // mains behind the CG or it sits on its tail
      nozzles: [[-1.45, 1.08, 5.5, 0.55], [1.45, 1.08, 5.5, 0.55]],
      tips: [8.75, 0.3, 0.4], fin: [3.3, 2.65, 7.3], hook: [0, -0.8, 7.0],
      missiles: [[-7.2, -0.5, -0.1], [7.2, -0.5, -0.1], [-5.4, -0.55, -0.2], [5.4, -0.55, -0.2], [-4.0, -0.6, -0.2]],
    },
  },
};
export const AIRCRAFT_ORDER = ['f14', 'f18', 'f16', 'su27', 'a10'];

export const MISSILE = {
  max: 5, burn: 2.6, accel: 260, maxSpeed: 900, maxG: 32, life: 14, fuse: 11, dmg: 900, blast: 24,
  gimbal: 50, // deg off-bore seeker limit
};
export const FLAK = { burst: 24, dmg: 150 };
