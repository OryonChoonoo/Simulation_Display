/* Three-dimensional view of the rig, and of what field-oriented control does inside
   the motor. Geometry is built from primitives at roughly rig scale: it is an
   illustration of the setup, not a CAD model, and not measured data. */
import * as THREE from './vendor/three.module.js';

const V = THREE.MathUtils;
let renderer, scene, camera, clock, host;
let motors = [], sprockets = [], chainLinks = [], boards = [], rotorGroup, currentArrow, trueArrow, encoderDisc, housing;
let insideKeep = [];
let view = 'rig', spin = 0, intro = 0, orbit = { yaw: 0.75, pitch: 0.22, dist: 1.35, drag: null };
let opts = { rpm: 400, sensorless: false, slow: 0.04 };

const COLOUR = { steel: 0x8b97a6, dark: 0x2a323d, pcb: 0x1f6b45, magnetN: 0xef4444, magnetS: 0x5b6b7f,
  copper: 0xf0b429, current: 0x34d399, estimate: 0xf0b429, cable: 0xef4444, power: 0xf0b429, signal: 0x7aa2f7 };

// Every mesh built while `tagging` is set belongs to that part of the rig, which is
// what makes the rig itself clickable rather than a diagram beside it.
let tagging = null;
const partMeshes = {};
function tag(m) {
  if (!tagging) return m;
  m.userData.part = tagging;
  (partMeshes[tagging] = partMeshes[tagging] || []).push(m);
  return m;
}

function box(w, h, d, colour, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: colour, roughness: .6, metalness: .25 }));
  m.position.set(x, y, z); (parent || scene).add(m); return tag(m);
}
function cyl(r, h, colour, x, y, z, parent, segments = 28) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments),
    new THREE.MeshStandardMaterial({ color: colour, roughness: .45, metalness: .45 }));
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); (parent || scene).add(m); return tag(m);
}
function ring(rInner, rOuter, h, colour, x, y, z, parent, segments = 40) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rOuter, rOuter, h, segments, 1, true),
    new THREE.MeshStandardMaterial({ color: colour, roughness: .5, metalness: .5, side: THREE.DoubleSide }));
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); (parent || scene).add(m); return tag(m);
}
function tube(points, radius, colour) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, radius, 8, false),
    new THREE.MeshStandardMaterial({ color: colour, roughness: .8 }));
  scene.add(m); return tag(m);
}

// Fasteners and cable hardware, small enough that they only register as texture from
// a distance but make the rig read as a built object close up.
function bolt(x, y, z, r = .0035, h = .004, colour = 0x9aa5b1) { return cyl(r, h, colour, x, y, z, null, 8); }
function tieWrap(x, y, z) { return box(.008, .008, .003, 0x11151b, x, y, z); }
function label(w, h, x, y, z, colour = 0xd7dde5) { return box(w, h, .0012, colour, x, y, z); }

function buildRig() {
  // The rig stands in a timber frame, not on a steel bench: five planks across,
  // posts at the corners and a back board carrying the wiring.
  const TIMBER = [0x6b543c, 0x735c42, 0x634d37];
  for (let k = 0; k < 5; k++) {
    const plank = box(1.05, .028, .086, TIMBER[k % 3], 0, -.078, -.18 + k * .09);
    plank.material.roughness = .95; plank.material.metalness = .02;
  }
  for (const lx of [-.47, .47]) for (const lz of [-.19, .19]) {      // corner posts
    const post = box(.045, .19, .045, 0x5b4733, lx, -.19, lz);
    post.material.roughness = .95; post.material.metalness = .02;
    bolt(lx, -.062, lz, .006, .006, 0x8d97a4);                       // coach screw
  }
  for (const lz of [-.19, .19]) box(.92, .05, .022, 0x5b4733, 0, -.24, lz);   // side rails
  box(.022, .05, .36, 0x5b4733, -.47, -.24, 0);
  box(.022, .05, .36, 0x5b4733, .47, -.24, 0);
  const backBoard = box(1.05, .17, .022, 0x634d37, 0, .0, -.265);    // back board
  backBoard.material.roughness = .95; backBoard.material.metalness = .02;
  for (const bx2 of [-.42, -.14, .14, .42]) bolt(bx2, .06, -.252, .005, .006, 0x8d97a4);
  for (const [i, x] of [-.26, .26].entries()) {
    tagging = i ? 'motor2' : 'motor1';
    const body = cyl(.05, .13, COLOUR.steel, x, .06, 0);             // motor body
    const cap = cyl(.052, .01, 0x6c7787, x, .06, .066, null);        // front end cap
    if (x < 0) body.userData.cap = cap;
    cyl(.052, .012, 0x6c7787, x, .06, -.066, null);                  // rear end cap
    for (let f = 0; f < 18; f++) {                                   // cooling fins
      const a = f / 18 * Math.PI * 2;
      const fin = box(.006, .012, .118, 0x7d8896, x + Math.cos(a) * .053, .06 + Math.sin(a) * .053, 0);
      fin.rotation.z = a;
    }
    for (let b = 0; b < 4; b++) {                                    // end-cap bolts
      const a = Math.PI / 4 + b / 4 * Math.PI * 2;
      cyl(.004, .006, 0x4e5866, x + Math.cos(a) * .04, .06 + Math.sin(a) * .04, .072, null, 8);
    }
    cyl(.008, .07, COLOUR.steel, x, .06, .10);                       // shaft
    cyl(.013, .012, 0x6c7787, x, .06, .112, null, 16);               // shaft collar
    box(.03, .022, .03, 0x20262f, x, .002, .03);                     // terminal box
    box(.13, .022, .11, COLOUR.dark, x, -.045, 0);                   // mounting foot
    for (const s2 of [-1, 1]) for (const s3 of [-1, 1]) {            // foot bolts
      cyl(.005, .008, 0x4e5866, x + s2 * .05, -.034, s3 * .04, null, 8).rotation.set(0, 0, 0);
    }
    // nameplate, cable gland and shaft key: the things you actually see on the motor
    label(.05, .026, x, .1105, -.012, 0xc8cfd8).rotation.x = Math.PI / 2;   // nameplate
    label(.03, .012, x, .1105, .026, 0x8d97a4).rotation.x = Math.PI / 2;    // CE / rating strip
    cyl(.008, .014, 0x2b3340, x - .022, .006, .03, null, 12);        // cable gland
    box(.004, .004, .026, 0x7d8896, x, .0695, .104);                 // shaft key
    for (let b = 0; b < 4; b++) {                                    // rear cap bolts
      const a = Math.PI / 4 + b / 4 * Math.PI * 2;
      bolt(x + Math.cos(a) * .04, .06 + Math.sin(a) * .04, -.074, .004, .006, 0x4e5866);
    }
    for (const s2 of [-1, 1]) {                                      // washers under the foot bolts
      for (const s3 of [-1, 1]) cyl(.008, .002, 0x5b6b7f, x + s2 * .05, -.0325, s3 * .04, null, 10);
    }
    motors.push(body);
    // a small encoder housing on the rear face, where the rotor angle is measured
    tagging = 'encoder';
    cyl(.022, .014, 0x2b3a55, x, .06, -.079, null, 20);
    cyl(.01, .006, 0x7aa2f7, x, .06, -.088, null, 14);
    box(.01, .006, .006, 0xe8eaed, x + .015, .052, -.084);           // small white connector
    for (let b = 0; b < 3; b++) {                                    // housing screws
      const a = b / 3 * Math.PI * 2;
      bolt(x + Math.cos(a) * .017, .06 + Math.sin(a) * .017, -.087, .002, .003, 0x5b6b7f);
    }
    tagging = 'chain';
    const s = new THREE.Group(); s.position.set(x, .06, .125); scene.add(s);
    cyl(.045, .012, 0x9aa5b1, 0, 0, 0, s, 24);                       // sprocket disc
    cyl(.014, .018, 0x6c7787, 0, 0, 0, s, 16);                       // hub
    for (let t = 0; t < 16; t++) {                                   // teeth
      const a = t / 16 * Math.PI * 2;
      const tooth = box(.008, .010, .012, 0x9aa5b1, Math.cos(a) * .049, Math.sin(a) * .049, 0, s);
      tooth.rotation.z = a;
    }
    box(.006, .007, .007, 0x4e5866, 0, .0165, .004, s);              // grub screw in the hub
    for (let b = 0; b < 4; b++) {                                    // sprocket lightening holes
      const a = Math.PI / 4 + b / 4 * Math.PI * 2;
      cyl(.007, .014, 0x707b89, Math.cos(a) * .028, Math.sin(a) * .028, 0, s, 10);
    }
    sprockets.push(s);
    tagging = i ? 'odrive2' : 'odrive1';
    // The ODrive Pro is not on the bench: it sits in the middle of a round plate
    // carried on threaded rods past the sprocket, so the shaft stays behind it.
    cyl(.085, .006, 0xc3cad3, x, .06, .145, null, 44);               // face plate
    for (let b = 0; b < 8; b++) {                                    // plate rim fixings
      const a = Math.PI / 8 + b / 8 * Math.PI * 2;
      bolt(x + Math.cos(a) * .076, .06 + Math.sin(a) * .076, .1415, .004, .005, 0x8d97a4);
    }
    label(.03, .01, x + .05, .015, .1485, 0xf0b429);                 // warning sticker
    for (const a of [Math.PI / 2, -Math.PI / 2]) {                   // threaded rods carrying it
      cyl(.005, .19, 0x9aa5b1, x + Math.cos(a) * .072, .06 + Math.sin(a) * .072, .055, null, 10);
      cyl(.008, .008, 0x4e5866, x + Math.cos(a) * .072, .06 + Math.sin(a) * .072, .152, null, 8);
      cyl(.009, .003, 0x8d97a4, x + Math.cos(a) * .072, .06 + Math.sin(a) * .072, .139, null, 8);  // nut
      cyl(.009, .003, 0x8d97a4, x + Math.cos(a) * .072, .06 + Math.sin(a) * .072, -.03, null, 8);
    }
    const bx = x, by = .06, bz = .154;                               // board, centred on the plate
    const board = box(.076, .056, .003, COLOUR.pcb, bx, by, bz);
    for (const sx of [-1, 1]) for (const sy of [-1, 1])              // standoffs
      cyl(.0028, .009, 0x5b6b7f, bx + sx * .032, by + sy * .022, .1495, null, 8);
    box(.05, .009, .009, 0x39414d, bx - .004, by + .019, bz + .005); // heatsink over the FETs
    for (let hs = 0; hs < 5; hs++)
      box(.0025, .013, .009, 0x4b5462, bx - .026 + hs * .012, by + .021, bz + .005);
    box(.011, .044, .014, 0x2f8f5b, bx - .039, by, bz + .004);       // green phase terminal
    for (let k = 0; k < 4; k++)                                      // yellow bullet connectors
      box(.018, .007, .007, 0xf0b429, bx - .053, by - .016 + k * .011, bz + .004);
    box(.012, .007, .006, 0x15191f, bx + .03, by + .016, bz + .004); // encoder header
    const led = box(.004, .004, .003, 0x34d399, bx + .012, by - .018, bz + .004);
    led.material.emissive = new THREE.Color(0x34d399); led.material.emissiveIntensity = 1.4;
    for (let c = 0; c < 4; c++)                                      // bus capacitors
      cyl(.0055, .013, 0x2a3340, bx - .026 + c * .012, by - .015, bz + .008, null, 12);
    for (let c = 0; c < 4; c++)                                      // their tops
      cyl(.0055, .001, 0x8d97a4, bx - .026 + c * .012, by - .015, bz + .0145, null, 12);
    box(.009, .005, .006, 0xc0c6cf, bx + .034, by - .022, bz + .004);  // USB-C socket
    box(.007, .007, .0035, 0x39414d, bx + .018, by - .006, bz + .003); // inductor
    for (let ic = 0; ic < 5; ic++)                                   // small packages
      box(.005, .005, .0015, 0x15191f, bx - .03 + ic * .014, by - .001, bz + .002);
    for (let sh = 0; sh < 3; sh++)                                   // shunt resistors
      box(.004, .002, .001, 0xd7dde5, bx - .012 + sh * .009, by - .026, bz + .002);
    label(.05, .003, bx - .008, by - .0285, bz + .002, 0xbfc7d1);    // silkscreen strip
    for (const sx of [-1, 1]) for (const sy of [-1, 1])              // board screws
      cyl(.0022, .002, 0xc0c6cf, bx + sx * .032, by + sy * .022, bz + .003, null, 8);
    boards.push(board);
    for (let k = 0; k < 4; k++)                                      // heat-shrink behind the bullets
      box(.008, .009, .009, 0x11151b, bx - .066, by - .016 + k * .011, bz + .004);
    tieWrap(x - .1, .034, .11); tieWrap(x - .062, .006, .052);
    // phase leads from the bullet connectors round the side to the terminal box
    for (const [k, off] of [-.008, 0, .008].entries()) {
      tube([[bx - .062, by + off, bz], [x - .105, .03 + off, .11], [x - .06, .004, .05],
        [x - .015, .002, .034]], .0028,
        [0xef4444, 0xe8eaed, 0x7aa2f7][k]);
    }
    // the encoder cable runs from the rear of the motor to the controller
    tagging = 'encoder';
    tube([[x, .06, -.092], [x + .075, .01, -.02], [x + .04, .076, .15]], .002, COLOUR.signal);
  }
  tagging = 'battery';
  box(.16, .09, .08, 0x243040, 0, .035, -.22);                       // battery
  box(.16, .01, .08, 0x3a4a5e, 0, .085, -.22);
  box(.05, .004, .022, 0xd7dde5, 0, .081, -.185);                    // battery label
  for (const s2 of [-1, 1]) box(.012, .012, .012, s2 > 0 ? 0xef4444 : 0x1b2430, s2 * .045, .088, -.2);
  box(.024, .014, .016, 0x15191f, 0, .09, -.25);                     // BMS / connector block
  for (const bz2 of [-.245, -.195]) box(.168, .094, .006, 0x11151b, 0, .035, bz2);  // retaining straps
  label(.03, .016, 0, .0355, -.181, 0xf0b429);                       // warning label
  box(.02, .013, .013, 0xf0b429, .03, .092, -.185);                  // XT90-style connector
  cyl(.007, .03, 0x39414d, -.09, .06, -.2, null, 12);                // inline fuse holder
  box(.02, .016, .02, 0x2a323d, -.12, .03, -.2);                     // isolator switch
  box(.008, .012, .008, 0xc0392b, -.12, .044, -.2);                  // its red lever
  for (let b = 0; b < 4; b++) tieWrap(-.28 + b * .18, .02, -.14);    // ties along the supply run
  tube([[-.322, .06, .155], [-.40, .02, .04], [-.30, .03, -.16], [0, .085, -.2]], .005, COLOUR.power);
  tube([[.198, .06, .155], [.40, .02, .04], [.30, .03, -.16], [0, .085, -.2]], .005, COLOUR.power);
  // A loom run along the back board, tied down, as any bench build ends up with.
  tagging = null;
  tube([[-.44, -.03, -.248], [0, -.035, -.248], [.44, -.03, -.248]], .006, 0x1b222c);
  for (const tx of [-.34, -.1, .14, .38]) {
    const tie = box(.006, .018, .006, 0x11151b, tx, -.03, -.248);
    tie.material.roughness = .8;
  }
  for (const ex of [-.26, .26]) {                                    // earth straps
    tube([[ex + .06, -.034, .02], [ex + .12, -.06, -.06], [ex + .1, -.055, -.16]], .0022, 0x4caf50);
    box(.012, .004, .008, 0xf0b429, ex + .06, -.03, .02);            // cable tag
  }
  tagging = 'laptop';
  const lidBase = box(.13, .008, .09, 0x1b2430, 0, .196, -.05);      // laptop
  const lid = box(.13, .085, .006, 0x222b36, 0, .238, -.095);
  lid.rotation.x = .28;
  const lidScreen = box(.118, .073, .002, 0x0d1117, 0, .238, -.09);
  lidScreen.rotation.x = .28; lidScreen.material.emissive = new THREE.Color(0x11303f);
  lidScreen.material.emissiveIntensity = .7;
  box(.1, .0015, .038, 0x2a323d, 0, .2005, -.036);                   // keyboard area
  for (let kr = 0; kr < 4; kr++)                                     // key rows
    box(.096, .0012, .0055, 0x39414d, 0, .2015, -.05 + kr * .009);
  box(.03, .0012, .018, 0x333c49, 0, .2015, -.012);                  // trackpad
  for (const fx of [-.055, .055]) for (const fz of [-.085, -.015])   // feet
    cyl(.004, .003, 0x11151b, fx, .191, fz, null, 8);
  label(.02, .008, 0, .2375, -.128, 0x3d4c60).rotation.x = .28;      // lid badge
  tube([[-.23, .076, .156], [-.26, .17, .02], [-.05, .2, -.05]], .0022, 0x5b6b7f);   // USB
  tube([[.29, .076, .156], [.26, .17, .02], [.05, .2, -.05]], .0022, 0x5b6b7f);
  // emergency stop on its own post
  tagging = 'estop';
  cyl(.012, .06, 0x39414d, .46, .0, -.12);
  const mushroom = new THREE.Mesh(new THREE.CylinderGeometry(.03, .026, .016, 20),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: .5 }));
  mushroom.position.set(.46, .036, -.12); scene.add(mushroom); tag(mushroom);
  box(.05, .008, .05, 0xf0b429, .46, .002, -.12);                    // yellow base plate
  cyl(.033, .003, 0xf0b429, .46, .0275, -.12, null, 20);             // yellow legend ring
  for (const s2 of [-1, 1]) bolt(.46 + s2 * .02, .007, -.12, .003, .004, 0x5b6b7f);
  box(.026, .01, .026, 0x2a323d, .46, -.008, -.12);                  // mounting block
  tube([[.46, -.01, -.12], [.42, -.05, -.16], [.2, -.055, -.2]], .004, 0x39414d);  // conduit
  tagging = 'chain';
  // chain guard: a transparent shield over the drive, as the rig will need
  const guard = box(.4, .16, .006, 0x9ec1ff, 0, .06, .158);
  guard.material.transparent = true; guard.material.opacity = .12;

  // chain: alternating roller and side-plate links around both sprockets
  const R = .05, span = .52;
  for (let i = 0; i < 72; i++) {
    const link = i % 2
      ? box(.014, .010, .014, 0x8d97a4, 0, 0, 0)                     // side plate
      : cyl(.005, .016, 0xc8d0da, 0, 0, 0, null, 10);                // roller
    if (i % 2 === 0) link.rotation.z = Math.PI / 2;
    chainLinks.push(link);
  }
  chainLinks[0].material.color.setHex(0xe0a23a);                     // master link, as fitted
  chainLinks[1].material.color.setHex(0xe0a23a);
  positionChain(0, R, span);
  tagging = null;
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
    link.position.set(x, y + .06, .125);
    if (link.geometry.type === 'BoxGeometry') link.rotation.z = angle;
  });
}

function buildMotorInside() {
  rotorGroup = new THREE.Group(); rotorGroup.position.set(-.26, .06, 0); scene.add(rotorGroup);
  // Three pole pairs, so six magnet segments alternating north and south. This
  // matches bm1109.p = 3 in the parameter file: the electrical angle turns three
  // times for every mechanical turn.
  const POLES = 6;
  cyl(.014, .102, 0x6c7787, 0, 0, 0, rotorGroup, 20);                 // rotor shaft
  cyl(.028, .1, 0x39414d, 0, 0, 0, rotorGroup, 30);                   // rotor back iron
  for (let k = 0; k < POLES; k++) {
    const start = k / POLES * Math.PI * 2 + .04, sweep = Math.PI * 2 / POLES - .08;
    const magnet = new THREE.Mesh(new THREE.CylinderGeometry(.032, .032, .096, 18, 1, false, start, sweep),
      new THREE.MeshStandardMaterial({ color: k % 2 ? COLOUR.magnetS : COLOUR.magnetN, roughness: .45 }));
    magnet.rotation.x = Math.PI / 2; rotorGroup.add(magnet);
  }
  for (const bz2 of [-.054, .054]) {                                  // bearings either end
    cyl(.0105, .011, 0x8d97a4, 0, 0, bz2, rotorGroup, 20);            // inner race
    ring(.016, .019, .011, 0x8d97a4, 0, 0, bz2, rotorGroup, 24);      // outer race
    for (let b = 0; b < 9; b++) {                                     // balls
      const a = b / 9 * Math.PI * 2;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(.0035, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xd7dde5, roughness: .25, metalness: .85 }));
      ball.position.set(Math.cos(a) * .0145, Math.sin(a) * .0145, bz2);
      rotorGroup.add(ball);
    }
  }
  // A thin sleeve over the magnets, which is what stops them leaving at speed.
  const sleeve = ring(.0325, .0335, .098, 0x9aa5b1, 0, 0, 0, rotorGroup, 36);
  sleeve.material.transparent = true; sleeve.material.opacity = .35;
  box(.004, .004, .02, 0x7d8896, 0, .015, .05, rotorGroup);           // shaft key
  encoderDisc = cyl(.026, .005, 0x7aa2f7, -.26, .06, -.072);   // encoders mount at the rear
  const stator = new THREE.Group(); stator.position.set(-.26, .06, 0); scene.add(stator);
  ring(.044, .048, .09, 0x5c6672, 0, 0, 0, stator);                   // laminated back iron
  const SLOTS = 9;                                                    // nine slots, three per phase
  for (let k = 0; k < SLOTS; k++) {
    const a = k / SLOTS * Math.PI * 2;
    const tooth = box(.009, .014, .088, 0x707b89, Math.cos(a) * .039, Math.sin(a) * .039, 0, stator);
    tooth.rotation.z = a;
    for (const side of [-1, 1]) {                                     // copper windings either side
      const b = a + side * .17;
      const winding = box(.007, .016, .094, [0x34d399, 0xf0b429, 0x7aa2f7][k % 3],
        Math.cos(b) * .0435, Math.sin(b) * .0435, 0, stator);
      winding.rotation.z = b;
      winding.material.metalness = .3;
    }
    const wedge = box(.011, .004, .09, 0x39414d, Math.cos(a) * .0335, Math.sin(a) * .0335, 0, stator);
    wedge.rotation.z = a;                                            // slot wedge closing the slot
    // Slot liner: the insulation between the copper and the iron it sits against.
    for (const side2 of [-1, 1]) {
      const b2 = a + side2 * .255;
      const liner = box(.0025, .017, .092, 0xc8a06a, Math.cos(b2) * .0425, Math.sin(b2) * .0425, 0, stator);
      liner.rotation.z = b2;
      liner.material.roughness = .85; liner.material.metalness = .05;
    }
  }
  for (const ez of [-.052, .052])                                    // end windings looping over
    ring(.038, .0455, .012, 0xb87333, 0, 0, ez, stator, 32);
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

const raycaster = new THREE.Raycaster();
const HIGHLIGHT = new THREE.Color(0x2f9e6b);
let onPick = null;

export function setPickHandler(fn) { onPick = fn; }

// Light the chosen part up rather than drawing a box round it: on a dark scene a
// glow reads from across a room, an outline does not.
export function highlight(key) {
  for (const [k, list] of Object.entries(partMeshes)) for (const m of list) {
    if (m.userData.baseEmissive === undefined) {
      m.userData.baseEmissive = m.material.emissive.clone();
      m.userData.baseIntensity = m.material.emissiveIntensity;
    }
    if (k === key) { m.material.emissive.copy(HIGHLIGHT); m.material.emissiveIntensity = .55; }
    else { m.material.emissive.copy(m.userData.baseEmissive); m.material.emissiveIntensity = m.userData.baseIntensity; }
  }
}

function shown(o) { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }

function partAt(e) {
  if (view !== 'rig') return null;
  const r = host.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  for (const hit of raycaster.intersectObjects(scene.children, true)) {
    if (!shown(hit.object)) continue;
    if (hit.object.userData.part) return hit.object.userData.part;
  }
  return null;
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

  let pressed = null;
  const pointer = e => {
    if (e.type === 'pointerdown') { orbit.drag = { x: e.clientX, y: e.clientY }; pressed = { x: e.clientX, y: e.clientY }; }
    else if (e.type === 'pointerup' || e.type === 'pointerleave') {
      // A press that did not turn the view is a tap on a part, not a drag.
      if (e.type === 'pointerup' && pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 5) {
        const key = partAt(e);
        if (key && onPick) onPick(key);
      }
      pressed = null; orbit.drag = null;
    }
    else if (!orbit.drag) host.style.cursor = partAt(e) ? 'pointer' : 'grab';
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
  for (const s of sprockets) s.rotation.z = spin;
  rotorGroup.rotation.z = spin; encoderDisc.rotation.y = spin;
  positionChain(spin * .05);

  const err = opts.sensorless ? estimateError(opts.rpm, clock.elapsedTime) : 0;
  const electrical = spin * 3;
  currentArrow.rotation.z = electrical + Math.PI / 2 + err;
  trueArrow.rotation.z = electrical + Math.PI / 2;

  // Cinematic opening: pull in from a wide shot, then hand control to the viewer.
  const target = view === 'inside' ? new THREE.Vector3(-.26, .06, .02) : new THREE.Vector3(0, .05, 0);
  const wanted = view === 'inside' ? .25 : .78;
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
