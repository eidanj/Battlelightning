// Atmosphere: physically based sky dome, sun light with a camera-following shadow frustum, hemisphere ambient,
// a prefiltered environment map for reflections, and height-aware fog colour matched to the horizon.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { TIME_OF_DAY } from './config.js';
import { DEG } from './util.js';

// Blend the sky into the fog colour near and below the horizon so sky, ocean and terrain meet seamlessly.
function patchSkyHaze(mat) {
  mat.uniforms.hazeColor = { value: new THREE.Color(0.7, 0.75, 0.82) };
  mat.uniforms.hazeAmt = { value: 1.0 };
  mat.fragmentShader = mat.fragmentShader
    .replace('uniform float time;', 'uniform float time;\nuniform vec3 hazeColor;\nuniform float hazeAmt;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', `float hz = 1.0 - smoothstep( -0.015, 0.16, direction.y );
			texColor = mix( texColor, hazeColor, hz * hz * hazeAmt );
			if ( direction.y < 0.0 ) texColor = mix( hazeColor, hazeColor * vec3( 0.55, 0.62, 0.7 ), smoothstep( 0.0, -0.35, direction.y ) );
			gl_FragColor = vec4( texColor, 1.0 );`);
}

export class Atmosphere {
  constructor(renderer, scene, tod = 'afternoon') {
    this.renderer = renderer; this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(200000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    patchSkyHaze(this.sky.material);
    scene.add(this.sky);
    this.sunDir = new THREE.Vector3();
    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.castShadow = false;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4f2, 0x52504a, 0.9);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xb8c8d8, 0.000035);
    scene.fog = this.fog;
    this.shadowSize = 340;
    this.envRT = null;
    this.horizon = new THREE.Color();
    this.zenith = new THREE.Color();
    this.setTime(tod);
  }

  setShadows(size) {
    const s = this.sun;
    s.castShadow = size > 0;
    if (size > 0) {
      s.shadow.mapSize.set(size, size);
      const h = this.shadowSize / 2;
      Object.assign(s.shadow.camera, { left: -h, right: h, top: h, bottom: -h, near: 10, far: 3000 });
      s.shadow.camera.updateProjectionMatrix();
      if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
    }
  }

  setTime(tod) {
    const T = TIME_OF_DAY[tod] || TIME_OF_DAY.afternoon;
    this.tod = T;
    const el = T.elev * DEG, az = T.azim * DEG;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    const u = this.sky.material.uniforms;
    u.turbidity.value = T.turbidity; u.rayleigh.value = T.rayleigh; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(450000);
    u.cloudCoverage.value = 0.32; u.cloudDensity.value = 0.32; u.cloudScale.value = 0.00012; u.cloudElevation.value = 0.42;
    this.sun.color.set(T.sunColor);
    this.sun.intensity = 1.2 + 2.4 * Math.min(1, Math.sin(el) * 3);
    this.hemi.color.set(T.hemiSky); this.hemi.groundColor.set(T.hemiGround);
    this.hemi.intensity = 0.55 + 0.6 * Math.min(1, Math.sin(el) * 2.5);
    this.exposure = T.exposure;
    // horizon / zenith colours for fog and water (approximate the scattering result)
    const warm = 1 - Math.min(1, el / (25 * DEG));
    this.horizon.setRGB(0.66 + 0.25 * warm, 0.74 + 0.04 * warm, 0.84 - 0.22 * warm);
    this.zenith.setRGB(0.24, 0.42, 0.74);
    this.fog.color.copy(this.horizon).multiplyScalar(0.92 + 0.08 * Math.sin(el));
    this.sky.material.uniforms.hazeColor.value.copy(this.fog.color);
  }

  // measure the real sky colour just above the horizon (GPU read-back) so fog and haze match it exactly
  sampleHorizon() {
    const r = this.renderer;
    try {
      const rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
      const cam = new THREE.PerspectiveCamera(20, 1, 1, 400000);
      const sc = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000);
      sky2.material.uniforms = THREE.UniformsUtils.clone(this.sky.material.uniforms); sky2.material.uniforms.showSunDisc.value = 0; sky2.material.uniforms.cloudCoverage.value = 0;
      sc.add(sky2);
      const buf = new Float32Array(8 * 8 * 4); const acc = [0, 0, 0]; let n = 0;
      const prevRT = r.getRenderTarget();
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        cam.position.set(0, 0, 0); cam.lookAt(Math.sin(a), Math.tan(3 * DEG), Math.cos(a));
        r.setRenderTarget(rt); r.render(sc, cam);
        r.readRenderTargetPixels(rt, 0, 0, 8, 8, buf);
        for (let i = 0; i < 64; i++) { acc[0] += buf[i * 4]; acc[1] += buf[i * 4 + 1]; acc[2] += buf[i * 4 + 2]; n++; }
      }
      r.setRenderTarget(prevRT);
      rt.dispose(); sky2.geometry.dispose(); sky2.material.dispose();
      const c = new THREE.Color(acc[0] / n, acc[1] / n, acc[2] / n);
      if (Number.isFinite(c.r) && c.r + c.g + c.b > 0.02) {
        this.fog.color.copy(c).multiplyScalar(0.95);
        this.horizon.copy(c);
        this.sky.material.uniforms.hazeColor.value.copy(this.fog.color);
      }
    } catch (e) { /* keep the estimate */ }
  }

  // Render the sky into a cube map and prefilter it for PBR reflections (called once per time-of-day).
  buildEnvironment() {
    const r = this.renderer;
    const pm = new THREE.PMREMGenerator(r);
    const skyScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    sky2.material.uniforms = THREE.UniformsUtils.clone(this.sky.material.uniforms);
    sky2.material.uniforms.showSunDisc.value = 0;
    sky2.material.uniforms.sunPosition.value.copy(this.sunDir).multiplyScalar(450000);
    skyScene.add(sky2);
    // a dim ground plane so the lower hemisphere of reflections is sea-coloured, not sky-coloured
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.09, 0.12) }));
    ground.position.y = -40; skyScene.add(ground);
    if (this.envRT) this.envRT.dispose();
    this.envRT = pm.fromScene(skyScene, 0.02, 1, 1500);
    pm.dispose();
    // separate un-prefiltered cube for the ocean's sharp reflections
    if (this.cubeRT) this.cubeRT.dispose();
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cc = new THREE.CubeCamera(1, 5000, this.cubeRT);
    skyScene.remove(ground);
    const g2 = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.05, 0.07) }));
    g2.position.y = -200; skyScene.add(g2);
    cc.update(r, skyScene);
    sky2.geometry.dispose(); sky2.material.dispose();
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.85;
    return this.envRT.texture;
  }

  // keep the shadow frustum centred on what the camera is looking at, snapped to texels (no shimmering)
  update(camPos, focus, time) {
    const s = this.sun;
    this.sky.material.uniforms.time.value = time;
    this.sky.position.copy(camPos);
    if (!s.castShadow) { s.position.copy(focus).addScaledVector(this.sunDir, 1500); s.target.position.copy(focus); return; }
    const size = s.shadow.mapSize.x, texel = this.shadowSize / size;
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const p = focus.clone().applyMatrix4(inv);
    p.x = Math.round(p.x / texel) * texel; p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(lightRot);
    s.target.position.copy(p);
    s.position.copy(p).addScaledVector(this.sunDir, 1500);
    s.target.updateMatrixWorld();
  }
}
