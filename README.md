# Battle Lightning

A realistic 3D aerial combat and dogfighting game inspired by War Thunder. It's built with plain HTML, CSS, JavaScript and [Three.js](https://threejs.org), with no build step, no image or audio files and no dependencies to install. Every model, texture and sound is generated in code.

Pick a side, start your jet **cold and dark** on a carrier catapult or an airbase runway, and fight a 10 v 10 to 30 v 30 battle over an ocean, a coastline, a city and an airbase. The flight model is physics-based: lift, drag, thrust, weight, momentum, stalls and G-forces all behave like the real thing.

---

## Run it locally (VS Code)

Browsers block JavaScript modules on `file://` pages, so the game must be served over HTTP:

1. Open this folder in VS Code.
2. Install the **Live Server** extension (by Ritwick Dey).
3. Right-click `index.html` → **Open with Live Server**.

Alternatives: `npx serve .` or `python -m http.server 8000` from this folder, then open <http://localhost:8000>.

## Host it on GitHub Pages

1. Create a new GitHub repository and push the contents of this folder to it (`index.html` must be at the repo root).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` and `/ (root)`, then **Save**.
3. After a minute your game is live at `https://<your-username>.github.io/<repo-name>/`.

Three.js is bundled locally in `lib/`, so nothing is fetched from a CDN. The only external request is the Google Fonts stylesheet. If it fails to load, the game falls back to system fonts.

---

## Controls

Keyboard and mouse. Every key can be rebound in **Settings → Controls & Keybinds** (primary and alternate key per action).

| Key | Action |
|---|---|
| **]** (hold) | Start the engine, then throttle up. 100% lights the afterburner |
| **[** (hold) | Throttle down |
| **W** / **S** | Pitch: nose down / nose up (also **↑ / ↓**) |
| **A** / **D** | Roll left / right |
| **Z** / **X** | Rudder: yaw left / right (also **← / →**) |
| **Space** | Fire guns |
| **Q** | Reload guns |
| **C** | Fire a heat-seeking missile (needs a lock, 5 max) |
| **F** | Drop flares |
| **G** | Landing gear up / down |
| **B** / **Left Shift** | Air brake in the air, wheel brakes on the ground |
| **V** | Cockpit view (default) / chase camera |
| **Tab** (hold) | Scoreboard and tactical map |
| **E** (press twice) | Eject |
| **R** (hold) | Look behind |
| **Right mouse** (hold) | Look around |
| **Esc** | Pause |

## How it plays

- **Cold and dark start:** hold **]** to crank the engine. Watch the RPM climb to idle (about 62%), then keep holding to full power.
  - **Navy:** at full power the catapult fires. Pull up as you leave the deck.
  - **Coastal Air Wing:** roll down the runway and rotate at about 260 km/h.
- **Flying:** lift depends on airspeed and angle of attack.
  - Pull too hard while slow and the wing **stalls**: shudder, horn, a dropping nose. Push forward and add power to recover.
  - Heavy jets bleed speed in tight turns. Sustained high G greys out your vision, and strong negative G reds it out.
  - Past Mach 1 you get a sonic boom.
- **Weapons:**
  - **Guns:** bullets have travel time, drop and tracers. Aim at the lead circle, not at the target.
  - **Missiles:** keep the target in the dashed seeker circle until the tone goes solid (LOCK), then fire. Missiles leave smoke trails and can be decoyed by flares.
- **Damage:** the left wing, right wing, engine, tail and fuselage take damage separately. The airframe diagram (bottom left) shades from green to black as they fail.
  - A damaged wing makes the jet roll, and a hit engine loses thrust or catches fire.
  - Lose the tail and you can barely steer.
- **Landing, repair and rearm:**
  1. Lower the gear with **G** (the gear is torn off above about 670 km/h).
  2. Fly the landing box: keep the cross centred and hold the **ON SPEED** number shown above the box.
  3. On the carrier, the hook catches a wire. Too fast or too long and you **bolter**: go around at full power or roll off into the sea.
  4. Stop on a friendly deck or runway to repair, refuel and rearm. On the carrier you're then moved to the catapult.
- **Ejection:** press **E** twice. The canopy blows off, the rocket seat fires and the parachute opens.
  - You then take over the jet of a teammate who stayed behind, so every lost aircraft costs your team one.
- **Winning:** destroy every enemy aircraft, or hold more aircraft than the enemy when the 20-minute timer runs out.

### Aircraft

All jets are available to both sides. Stats and the pros and cons are in the **Hangar**.

| Jet | Pro | Con |
|---|---|---|
| **F-14 Interceptor** | Highest top speed and the longest missile lock range. Automatic swing wings | Heavy, bleeds speed in turns, slow to spool up |
| **F/A-18 Hornet** | Superb nose authority at low speed and high angle of attack. Rugged | Lowest top speed of the jets, sluggish acceleration when slow |
| **F-16 Viper** | Best acceleration and roll rate, 9 G | Fragile, shortest missile lock range |
| **Su-27 Flanker** | Super-manoeuvrable, keeps its energy in sustained turns | Big target, sluggish roll when slow, slow-firing 30 mm |
| **A-10 Thunderbolt II** | Armoured flying tank with the GAU-8 30 mm cannon | Slowest jet, no afterburner |

### The battlefield

The map is 32 × 32 km: half ocean (west), half land (east).

- **Carrier group (Navy):** a supercarrier with two battleships and three destroyers. It steams a racetrack, with long straight legs for landings. The ships fire flak and CIWS at enemies.
- **Coastline and city:** skyscrapers, a river estuary with bridges, and ground AA batteries.
- **Airbase (Coastal Air Wing):** a runway with hangars, AA sites and a repair area.
- **Sky:** cumulus clouds you can fly through, and four times of day (dawn, noon, afternoon, sunset) set in Match Setup.

### Enemy pilots

The AI flies the same flight model you do. It is bound by the same stall, G and energy limits, and reacts with a human-like delay and aiming error.

- **Behaviour:** pilots break and drop flares against missiles, jink when someone is on their six, and avoid flying into enemy flak. When badly damaged they head home to repair and come back.
- **Difficulty:** choose **Rookie**, **Veteran** or **Ace** in Match Setup.

---

## Project structure

```
index.html            UI screens, HUD, overlays, import map
css/style.css         All styling (intro, menus, HUD)
lib/                  Three.js (r187, bundled locally) + addons + license
js/config.js          ← all tuning numbers: world layout, keys, graphics presets, difficulty, aircraft stats, weapons
js/main.js            Game loop, state machine, rendering passes, events, player controls
js/flight.js          6-DOF flight model: aerodynamics, engine, gear, catapult, arresting wire
js/aircraft.js        Aircraft: weapons, damage model, landing/repair, crashes, ejection
js/aircraftModels.js  Procedural jet models, paint schemes, gear, afterburner
js/pilot.js           The pilot: flight suit, gloves, helmet and mask, IK arms and legs, ejection seat, parachute
js/cockpit.js         Cockpit interior with live gauges, HUD combiner, moving stick and throttle
js/ai.js              AI pilots
js/match.js           Teams, spawning, respawns, scoring, win conditions
js/weapons.js         Bullets, tracers, missiles, flares, flak
js/aa.js              Ship and ground anti-aircraft guns
js/world.js           World assembly, surfaces, collisions
js/terrain.js         Coastline, hills, forests
js/ocean.js           Gerstner-wave ocean with ship and jet wakes
js/sky.js             Sky, sun, lighting, time of day
js/clouds.js          Cumulus clouds built from thousands of lit puffs
js/ships.js           Carrier group (catapults, wires, landing lights) and fleet movement
js/city.js            City, skyscrapers and bridges
js/airbase.js         Airbase, runway, hangars
js/effects.js         Explosions, smoke, fire, debris, contrails, vapour
js/audio.js           Procedural Web Audio: engines, wind, guns, sonic boom, gear, alarms
js/camera.js          Cockpit, chase, ejection and death cameras
js/hud.js             HUD, damage diagram, minimap, scoreboard, tactical map
js/ui.js              Menus, hangar, match setup, settings, overlays
js/tutorial.js        Flight school, from engine start to landing
js/settings.js        Saved settings (localStorage)
js/input.js           Keyboard, mouse and rebinding
js/textures.js        Procedural canvas textures
js/geo.js             Geometry helpers (lofts, wing panels)
js/util.js            Math helpers and noise
```

**Graphics:** **Settings → Graphics** has presets (Low / Medium / High / Ultra) and individual settings for render scale, shadows, clouds, forest density, effects, field of view, bloom, anti-aliasing and an FPS counter. If you drop below 40 FPS, pick **Low** or lower the render scale.

**Tweaking:** almost every gameplay number lives in `js/config.js`.
