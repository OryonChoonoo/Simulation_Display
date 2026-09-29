/* Three-dimensional view of the rig, and of what field-oriented control does inside
   the motor. Geometry is built from primitives at roughly rig scale: it is an
   illustration of the setup, not a CAD model, and not measured data. */
import * as THREE from './vendor/three.module.js';

const V = THREE.MathUtils;
let renderer, scene, camera, clock, host;
let motors = [], sprockets = [], chainLinks = [], rotorGroup, currentArrow, trueArrow, encoderDisc, housing;
let insideKeep = [];
let view = 'rig', spin = 0, intro = 0, orbit = { yaw: 0.75, pitch: 0.22, dist: 1.35, drag: null };
let opts = { rpm: 400, sensorless: false, slow: 0.04 };

const COLOUR = { steel: 0x8b97a6, dark: 0x2a323d, pcb: 0x1f6b45, magnetN: 0xef4444, magnetS: 0x5b6b7f,
  copper: 0xf0b429, current: 0x34d399, estimate: 0xf0b429, cable: 0xef4444, power: 0xf0b429, signal: 0x7aa2f7 };

function box(w, h, d, colour, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: colour, roughness: .6, metalness: .25 }));
  m.position.set(x, y, z); (parent || scene).add(m); return m;
}
function cyl(r, h, colour, x, y, z, parent, segments = 28) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments),
    new THREE.MeshStandardMaterial({ color: colour, roughness: .45, metalness: .45 }));
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); (parent || scene).add(m); return m;
}
function tube(points, radius, colour) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, radius, 8, false),
    new THREE.MeshStandardMaterial({ color: colour, roughness: .8 }));
  scene.add(m); return m;
}

function buildRig() {
  box(1.05, .035, .46, 0x171d27, 0, -.08, 0);                        // bench
  for (const [i, x] of [-.26, .26].entries()) {
    const body = cyl(.05, .13, COLOUR.steel, x, .06, 0);             // motor body
    const cap = cyl(.052, .01, 0x6c7787, x, .06, .066, null);        // end cap
    if (x < 0) body.userData.cap = cap;
    cyl(.008, .07, COLOUR.steel, x, .06, .10);                       // shaft
    box(.12, .02, .1, COLOUR.dark, x, -.04, 0);                      // mount
    motors.push(body);
    const s = cyl(.045, .012, 0x9aa5b1, x, .06, .125, null, 18);     // sprocket
    for (let t = 0; t < 16; t++) {                                   // teeth
      const a = t / 16 * Math.PI * 2;
      box(.008, .008, .012, 0x9aa5b1, Math.cos(a) * .048, Math.sin(a) * .048, 0, s)
        .rotation.set(Math.PI / 2, 0, 0);
    }
    sprockets.push(s);
    box(.1, .004, .07, COLOUR.pcb, x, .17, -.02);                    // ODrive board
    tube([[x, .16, -.02], [x, .11, .02], [x, .075, .02]], .004, COLOUR.cable);
  }
  const battery = box(.16, .09, .08, 0x243040, 0, .035, -.22);       // battery
  box(.16, .01, .08, 0x3a4a5e, 0, .085, -.22);
  tube([[-.26, .17, -.03], [-.12, .13, -.18], [0, .09, -.2]], .005, COLOUR.power);
  tube([[.26, .17, -.03], [.12, .13, -.18], [0, .09, -.2]], .005, COLOUR.power);
  tube([[-.26, .17, -.02], [0, .21, -.05], [.26, .17, -.02]], .0035, COLOUR.signal);
  box(.07, .012, .05, 0x1b2430, 0, .2, -.05);                        // laptop stand-in
  cyl(.03, .012, 0x8a3429, .48, .02, -.1);                           // emergency stop

  // chain: links following a stadium path around both sprockets
  const R = .05, span = .52;
  for (let i = 0; i < 64; i++) {
    const link = box(.016, .009, .012, 0xb9c2cd, 0, 0, 0);
    chainLinks.push(link);
  }
  positionChain(0, R, span);
}

function positionChain(offset, R = .05, span = .52) {
  const straight = span, arc = Math.PI * R, total = 2 * straight + 2 * arc;
  chainLinks.forEach((link, i) => {
    let s = ((i / chainLinks.length) * total + offset) % total;
    let x, y, angle;
    if (s < straight) { x = -span / 2 + s; y = R; angle = 0; }
    else if (s < straight + arc) { const a = (s - straight) / R; x = span / 2 + Math.sin(a) * R; y = Math.cos(a) * R; angle = -a; }
    else if (s < 2 * straight + arc) { const d = s - straight - arc; x = span / 2 - d; y = -R; angle = Math.PI; }
    else { const a = (s - 2 * straight - arc) / R; x = -span / 2 - Math.sin(a) * R; y = -Math.cos(a) * R; angle = Math.PI - a; }
    link.position.set(x, y + .06, .125); link.rotation.z = angle;
  });
}

function buildMotorInside() {
  rotorGroup = new THREE.Group(); rotorGroup.position.set(-.26, .06, 0); scene.add(rotorGroup);
  const north = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .1, 24, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: COLOUR.magnetN, roughness: .5 }));
  const south = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .1, 24, 1, false, Math.PI, Math.PI),
    new THREE.MeshStandardMaterial({ color: COLOUR.magnetS, roughness: .5 }));
  for (const half of [north, south]) { half.rotation.x = Math.PI / 2; rotorGroup.add(half); }
  encoderDisc = cyl(.026, .005, 0x7aa2f7, -.26, .06, -.072);   // encoders mount at the rear
  const stator = new THREE.Group(); stator.position.set(-.26, .06, 0); scene.add(stator);
  for (let k = 0; k < 6; k++) {                                       // coils around the rotor
    const a = k / 6 * Math.PI * 2;
    const coil = box(.012, .018, .075, COLOUR.copper, Math.cos(a) * .043, Math.sin(a) * .043, 0, stator);
    coil.rotation.z = a;
  }
  housing = motors[0];
  currentArrow = makeArrow(COLOUR.current); trueArrow = makeArrow(COLOUR.estimate);
  for (const a of [currentArrow, trueArrow]) { a.position.set(-.26, .06, .062); scene.add(a); }
  trueArrow.visible = false;
  // Only these stay on screen in the cutaway; the rest of the rig would crowd it.
  insideKeep = [rotorGroup, stator, encoderDisc, currentArrow, trueArrow];
}

function makeArrow(colour) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: .35, roughness: .4 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.0045, .0045, .07, 10), mat);
  shaft.position.y = .035; g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(.014, .028, 14), mat);
  head.position.y = .084; g.add(head);
  return g;
}

// The angle a sensorless estimator gets wrong: back-EMF shrinks with speed, so the
// error grows as the motor slows. Illustrative shape, not measured behaviour.
function estimateError(rpm, t) {
  const base = Math.min(85, 2500 / Math.max(rpm, 25));
  return V.degToRad(base) * (0.7 + 0.3 * Math.sin(t * 6));
}

export function init(container) {
  host = container;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x11161f);
  camera = new THREE.PerspectiveCamera(42, 2, .01, 20);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20262f, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(.6, 1, .8); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec1ff, .35); rim.position.set(-.8, .4, -.7); scene.add(rim);
  buildRig(); buildMotorInside(); setView('rig');
  clock = new THREE.Clock();

  const pointer = e => {
    if (e.type === 'pointerdown') orbit.drag = { x: e.clientX, y: e.clientY };
    else if (e.type === 'pointerup' || e.type === 'pointerleave') orbit.drag = null;
    else if (orbit.drag) {
      orbit.yaw -= (e.clientX - orbit.drag.x) * .006;
      orbit.pitch = V.clamp(orbit.pitch + (e.clientY - orbit.drag.y) * .004, -.2, 1.1);
      orbit.drag = { x: e.clientX, y: e.clientY }; intro = 99;
    }
  };
  for (const t of ['pointerdown', 'pointerup', 'pointermove', 'pointerleave']) container.addEventListener(t, pointer);
  resize(); addEventListener('resize', resize);
  renderer.setAnimationLoop(frame);
}

function resize() {
  if (!host.clientWidth) return;
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1); camera.updateProjectionMatrix();
}

export function setView(next) {
  view = next; intro = 0;
  const inside = next === 'inside';
  for (const child of scene.children) {
    if (child.isLight) continue;
    child.visible = inside ? insideKeep.includes(child) : !insideKeep.includes(child);
  }
  housing.visible = !inside; housing.userData.cap.visible = !inside;
  trueArrow.visible = inside && opts.sensorless;
}

export function setOptions(next) {
  Object.assign(opts, next);
  trueArrow.visible = view === 'inside' && opts.sensorless;
  return opts;
}

export function readout() {
  const err = opts.sensorless ? estimateError(opts.rpm, clock ? clock.elapsedTime : 0) : 0;
  return { errorDeg: V.radToDeg(err), torqueKept: Math.cos(err) };
}

function frame() {
  const dt = Math.min(clock.getDelta(), .05);
  intro += dt;
  spin += dt * (opts.rpm * 2 * Math.PI / 60) * opts.slow;
  for (const s of sprockets) s.rotation.y = spin;
  rotorGroup.rotation.z = spin; encoderDisc.rotation.y = spin;
  positionChain(spin * .05);

  const err = opts.sensorless ? estimateError(opts.rpm, clock.elapsedTime) : 0;
  const electrical = spin * 3;
  currentArrow.rotation.z = electrical + Math.PI / 2 + err;
  trueArrow.rotation.z = electrical + Math.PI / 2;

  // Cinematic opening: pull in from a wide shot, then hand control to the viewer.
  const target = view === 'inside' ? new THREE.Vector3(-.26, .06, .02) : new THREE.Vector3(0, .05, 0);
  const wanted = view === 'inside' ? .22 : .78;
  const ease = Math.min(intro / 3.5, 1);
  const dist = V.lerp(wanted * 2.1, wanted, ease * ease * (3 - 2 * ease));
  if (intro < 8 && !orbit.drag && view === 'rig') orbit.yaw += dt * .12;
  if (view === 'inside' && intro < .05) { orbit.yaw = Math.PI / 2; orbit.pitch = .22; }
  camera.position.set(
    target.x + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist,
    target.y + Math.sin(orbit.pitch) * dist,
    target.z + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist);
  camera.lookAt(target);
  renderer.render(scene, camera);
}
