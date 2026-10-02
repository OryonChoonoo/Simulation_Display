/* Three-dimensional view of the rig, and of what field-oriented control does inside
   the motor. Geometry is built from primitives at roughly rig scale: it is an
   illustration of the setup, not a CAD model, and not measured data. */
import * as THREE from './vendor/three.module.js';
import { buildFocMachine, labelSprite, calloutSprite, leader } from './focmachine.js';

const V = THREE.MathUtils;
let renderer, scene, camera, clock, host;
let motors = [], sprockets = [], chainLinks = [], boards = [], rotorGroup, encoderDisc, housing;
let insideKeep = [];
let view = 'rig', spin = 0, intro = 0, orbit = { yaw: 0.75, pitch: 0.22, dist: 1.35, drag: null, zoom: 1 };
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

// The operator's screen: a small dashboard drawn to a canvas and used as a
// texture, so the monitor in the scene shows something worth reading rather than
// a glowing rectangle. It mirrors the page's own numbers.
let screenTexture = null, screenCanvas = null, screenClock = 0;

function makeScreenTexture() {
  screenCanvas = document.createElement('canvas');
  screenCanvas.width = 900; screenCanvas.height = 540;
  drawScreen(0);
  const t = new THREE.CanvasTexture(screenCanvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A short rolling history so the speed trace has a past, not just a value.
const speedHistory = [];

function panelBox(g, x, y, w, h, title) {
  g.fillStyle = '#121923'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#212a36'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  if (title) {
    g.fillStyle = '#6b7684'; g.font = '600 13px system-ui'; g.textAlign = 'left';
    g.fillText(title, x + 12, y + 21);
  }
}

function drawScreen(t) {
  const c = screenCanvas, g = c.getContext('2d'), W = c.width, H = c.height;
  const rpm = opts.rpm, err = opts.sensorless ? estimateError(rpm, t) : 0;
  const kept = Math.cos(err);
  const iq = 9.5 / Math.max(kept, .2);
  const backEmf = rpm * 2 * Math.PI / 60 * 3 * 0.0236;
  const duty = Math.min(.5 + .5 * backEmf / 15.3, .99);
  const pOut = 1.0 * rpm * 2 * Math.PI / 60, pCu = 1.5 * 0.05 * iq * iq, pFr = 0.00049 * (rpm * 2 * Math.PI / 60) ** 2;

  speedHistory.push(rpm * (1 - 0.04 * Math.sin(t * 3.1) * (opts.sensorless ? 4 : 1)));
  if (speedHistory.length > 150) speedHistory.shift();

  g.fillStyle = '#0d1117'; g.fillRect(0, 0, W, H);

  // ---- title bar --------------------------------------------------------------
  g.fillStyle = '#161d27'; g.fillRect(0, 0, W, 46);
  g.fillStyle = '#34d399'; g.font = 'bold 21px system-ui'; g.textAlign = 'left';
  g.fillText("LET'S TORQUE CONTROL", 18, 31);
  g.fillStyle = '#2a323d'; g.fillRect(286, 11, 1, 24);
  g.fillStyle = opts.sensorless ? '#f0b429' : '#9aa5b1'; g.font = '15px system-ui';
  g.fillText(opts.sensorless ? 'SENSORLESS \u00b7 angle estimated from back-EMF'
                             : 'SENSORED \u00b7 encoder feedback', 304, 30);
  g.fillStyle = '#6b7684'; g.font = '13px system-ui'; g.textAlign = 'right';
  const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(Math.floor(t % 60)).padStart(2, '0');
  g.fillText('elapsed ' + mm + ':' + ss, W - 86, 29);
  g.fillStyle = (t % 2) < 1.4 ? '#34d399' : '#1f3a30';
  g.beginPath(); g.arc(W - 62, 23, 6, 0, 7); g.fill();
  g.fillStyle = '#6b7684'; g.fillText('REC', W - 20, 28);

  const LX = 14, LW = 224, RX = LX + LW + 12, RW = W - RX - 14;

  // ---- rotor dial ---------------------------------------------------------------
  panelBox(g, LX, 54, LW, 176, 'ROTOR AND CURRENT');
  const dx = LX + LW / 2, dy = 150, dr = 56;
  g.strokeStyle = '#2b3646'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(dx, dy, dr, 0, 7); g.stroke();
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6;
    g.beginPath();
    g.moveTo(dx + Math.cos(a) * dr, dy - Math.sin(a) * dr);
    g.lineTo(dx + Math.cos(a) * (dr - (k % 3 ? 5 : 9)), dy - Math.sin(a) * (dr - (k % 3 ? 5 : 9)));
    g.stroke();
  }
  const theta = (t * Math.max(rpm, 1) / 60 * 2 * Math.PI * 3) % (2 * Math.PI);
  const vec = (a, len, colour, width) => {
    g.strokeStyle = colour; g.lineWidth = width; g.lineCap = 'round';
    g.beginPath(); g.moveTo(dx, dy); g.lineTo(dx + Math.cos(a) * len, dy - Math.sin(a) * len); g.stroke();
  };
  if (err > .02) {                                      // the wasted angle, shaded
    g.fillStyle = 'rgba(240,180,41,.18)';
    g.beginPath(); g.moveTo(dx, dy);
    g.arc(dx, dy, dr - 10, -(theta + Math.PI / 2 + err), -(theta + Math.PI / 2)); g.fill();
  }
  vec(theta, dr - 12, '#ef4444', 5);
  if (err > .02) vec(theta + Math.PI / 2, dr - 12, '#3f6b57', 3);
  vec(theta + Math.PI / 2 + err, dr - 12, err > .02 ? '#f0b429' : '#34d399', 5);
  g.fillStyle = '#5b6b7f'; g.beginPath(); g.arc(dx, dy, 6, 0, 7); g.fill();
  g.fillStyle = '#ef4444'; g.font = '11px system-ui'; g.textAlign = 'center';
  g.fillText('d', dx - dr - 8, dy + 4);
  g.fillStyle = '#34d399'; g.fillText('q', dx, dy - dr - 8);

  // ---- checks -------------------------------------------------------------------
  panelBox(g, LX, 238, LW, 146, 'CHECKS');
  const checks = [
    ['Id held at zero', true],
    ['Duty below saturation', duty < .98],
    ['Current within 25 A', iq < 25],
    [opts.sensorless ? 'Observer valid' : 'Encoder healthy', !opts.sensorless || rpm > 150],
    ['No fault latched', true],
  ];
  checks.forEach(([label, ok], k) => {
    const y = 266 + k * 23;
    g.textAlign = 'left';
    g.fillStyle = ok ? '#34d399' : '#ef4444'; g.font = 'bold 13px system-ui';
    g.fillText(ok ? '\u2713' : '\u2715', LX + 13, y);
    g.fillStyle = ok ? '#9aa5b1' : '#ef4444'; g.font = '13px system-ui';
    g.fillText(label, LX + 32, y);
  });

  // ---- the matrix that has actually been run ------------------------------------
  panelBox(g, LX, 392, LW, 118, 'SENSORED MATRIX   24 / 24');
  const speedsLabel = ['50', '100', '200', '400', '800', '1500'];
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 4; row++) {
      const x = LX + 18 + col * 32, y = 414 + row * 17;
      g.fillStyle = '#1f3a30'; g.fillRect(x, y, 26, 13);
      g.fillStyle = '#34d399'; g.fillRect(x, y, 26, 13);
      g.globalAlpha = .25 + .12 * row; g.fillStyle = '#0d1117'; g.fillRect(x, y, 26, 13);
      g.globalAlpha = 1;
    }
    g.fillStyle = '#5b6b7f'; g.font = '9px system-ui'; g.textAlign = 'center';
    g.fillText(speedsLabel[col], LX + 31 + col * 32, 496);
  }
  g.fillStyle = '#5b6b7f'; g.font = '9px system-ui'; g.textAlign = 'right';
  ['0', '0.5', '1.0', '2.0'].forEach((l, row) => g.fillText(l, LX + 15, 424 + row * 17));
  g.textAlign = 'left'; g.fillText('N\u00b7m', LX + 6, 412);
  g.textAlign = 'center'; g.fillText('rpm', LX + LW / 2, 507);

  // ---- plots ---------------------------------------------------------------------
  const plot = (y, h, title, draw) => {
    panelBox(g, RX, y, RW, h, title);
    const L = RX + 12, R = RX + RW - 12, T = y + 26, B = y + h - 12;
    g.save(); g.beginPath(); g.rect(L, T, R - L, B - T); g.clip();
    g.strokeStyle = '#1b2430'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const gy = T + (B - T) * k / 4; g.beginPath(); g.moveTo(L, gy); g.lineTo(R, gy); g.stroke(); }
    for (let k = 1; k < 12; k++) { const gx = L + (R - L) * k / 12; g.beginPath(); g.moveTo(gx, T); g.lineTo(gx, B); g.stroke(); }
    draw(L, R, T, B);
    g.restore();
    g.strokeStyle = '#2b3646'; g.strokeRect(L + .5, T + .5, R - L - 1, B - T - 1);
  };

  plot(54, 150, 'PHASE CURRENTS   A   B   C', (L, R, T, B) => {
    const mid = (T + B) / 2, amp = (B - T) * .4 * (0.35 + 0.65 * Math.min(rpm / 1200, 1));
    for (let ph = 0; ph < 3; ph++) {
      g.strokeStyle = ['#34d399', '#f0b429', '#7aa2f7'][ph]; g.lineWidth = 2.2;
      g.beginPath();
      for (let px = 0; px <= R - L; px += 3) {
        const a = px / 78 + t * 2.4 - ph * 2 * Math.PI / 3;
        const yy = mid - Math.sin(a) * amp;
        px ? g.lineTo(L + px, yy) : g.moveTo(L + px, yy);
      }
      g.stroke();
    }
    g.strokeStyle = '#2b3646'; g.setLineDash([3, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, mid); g.lineTo(R, mid); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#6b7684'; g.font = '11px system-ui'; g.textAlign = 'right';
    g.fillText('+' + (iq * 1.41).toFixed(1) + ' A', R - 5, T + 13);
    g.fillText('0', R - 5, mid - 3);
    g.fillText('-' + (iq * 1.41).toFixed(1) + ' A', R - 5, B - 5);
  });

  plot(212, 138, 'SHAFT SPEED   reference and measured', (L, R, T, B) => {
    const top = Math.max(...speedHistory, rpm) * 1.25 + 50;
    const yFor = v => B - (B - T) * Math.min(v / top, 1);
    g.strokeStyle = '#5b6b7f'; g.setLineDash([6, 5]); g.lineWidth = 2;
    g.beginPath(); g.moveTo(L, yFor(rpm)); g.lineTo(R, yFor(rpm)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#34d399'; g.lineWidth = 2.4; g.beginPath();
    speedHistory.forEach((v, k) => {
      const x = L + (R - L) * k / Math.max(speedHistory.length - 1, 1);
      k ? g.lineTo(x, yFor(v)) : g.moveTo(x, yFor(v));
    });
    g.stroke();
    g.fillStyle = '#6b7684'; g.font = '11px system-ui'; g.textAlign = 'right';
    g.fillText(Math.round(top) + ' rpm', R - 5, T + 13);
    g.fillText('0', R - 5, B - 5);
  });

  // ---- bars and event log --------------------------------------------------------
  panelBox(g, RX, 358, RW / 2 - 6, 152, 'LIMITS');
  const bars = [
    ['Iq against 25 A', Math.min(iq / 25, 1), iq < 20 ? '#34d399' : '#f0b429'],
    ['Maximum duty', duty, duty < .95 ? '#34d399' : '#f0b429'],
    ['Torque kept', kept, kept > .97 ? '#34d399' : kept > .8 ? '#f0b429' : '#ef4444'],
    ['Copper loss share', Math.min(pCu / Math.max(pOut + pCu + pFr, .001), 1), '#7aa2f7'],
  ];
  bars.forEach(([label, frac, col], k) => {
    const y = 388 + k * 30, bw = RW / 2 - 36;
    g.fillStyle = '#9aa5b1'; g.font = '12px system-ui'; g.textAlign = 'left';
    g.fillText(label, RX + 12, y);
    g.fillStyle = '#0b0f15'; g.fillRect(RX + 12, y + 6, bw, 9);
    g.fillStyle = col; g.fillRect(RX + 12, y + 6, Math.max(bw * frac, 2), 9);
    g.fillStyle = '#6b7684'; g.textAlign = 'right';
    g.fillText((100 * frac).toFixed(0) + '%', RX + 12 + bw, y);
  });

  const EX = RX + RW / 2 + 6, EW = RW / 2 - 6;
  panelBox(g, EX, 358, EW, 152, 'EVENT LOG');
  const log = opts.sensorless
    ? [['0.000', 'bus 26.5 V, drive enabled', '#9aa5b1'],
       ['0.300', 'alignment complete', '#9aa5b1'],
       ['0.800', 'observer valid, handover started', '#34d399'],
       ['1.050', 'closed loop on estimated angle', '#34d399'],
       ['1.050', 'angle error above target', '#f0b429']]
    : [['0.000', 'bus 26.5 V, drive enabled', '#9aa5b1'],
       ['0.050', 'encoder index found', '#34d399'],
       ['0.500', 'speed reference ' + Math.round(rpm) + ' rpm', '#9aa5b1'],
       ['1.200', 'load applied 1.00 N\u00b7m', '#9aa5b1'],
       ['1.400', 'steady state, logging', '#34d399']];
  log.forEach(([time, text, col], k) => {
    const y = 386 + k * 24;
    g.fillStyle = '#4a545f'; g.font = '12px ui-monospace, monospace'; g.textAlign = 'left';
    g.fillText(time, EX + 12, y);
    g.fillStyle = col; g.font = '12px system-ui';
    g.fillText(text, EX + 58, y);
  });

  // ---- tiles ---------------------------------------------------------------------
  const tiles = [
    ['SPEED', Math.round(rpm) + ' rpm', '#e8eaed'],
    ['Iq', iq.toFixed(1) + ' A', iq < 20 ? '#e8eaed' : '#f0b429'],
    ['TORQUE KEPT', (100 * kept).toFixed(0) + ' %', kept > .97 ? '#34d399' : kept > .8 ? '#f0b429' : '#ef4444'],
    ['ANGLE ERROR', (err * 180 / Math.PI).toFixed(0) + '\u00b0', err < .05 ? '#34d399' : '#f0b429'],
    ['BACK-EMF', backEmf.toFixed(2) + ' V', '#7aa2f7'],
    ['COPPER LOSS', pCu.toFixed(1) + ' W', '#9aa5b1'],
  ];
  // One line each, so the strip stays readable at the size it is seen on screen.
  const tw = (W - 28 - 5 * 7) / 6;
  tiles.forEach(([k, v, col], idx) => {
    const x = 14 + idx * (tw + 7), y = 508;
    g.fillStyle = '#121923'; g.fillRect(x, y, tw, 20);
    g.strokeStyle = '#212a36'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, tw - 1, 19);
    g.fillStyle = '#6b7684'; g.font = '600 10px system-ui'; g.textAlign = 'left';
    g.fillText(k, x + 8, y + 14);
    g.fillStyle = col; g.font = 'bold 13px system-ui'; g.textAlign = 'right';
    g.fillText(v, x + tw - 8, y + 14);
  });

  // The screen is convincing enough now that this line has to stay on it.
  g.fillStyle = '#4a545f'; g.font = '11px system-ui'; g.textAlign = 'right';
  g.fillText('simulation, not measured', W - 14, 537);
}

function buildRig() {
  // A steel workbench: a plate top with a folded lip, square-tube legs with
  // stretchers and levelling feet, and a lower shelf.
  const steelTop = box(1.08, .014, .48, 0x58626f, 0, -.071, 0);
  steelTop.material.metalness = .62; steelTop.material.roughness = .52;
  for (const ez of [-.236, .236]) box(1.08, .03, .012, 0x6a7482, 0, -.084, ez);   // folded lip
  for (const ex of [-.534, .534]) box(.012, .03, .48, 0x6a7482, ex, -.084, 0);
  for (const lx of [-.49, .49]) for (const lz of [-.20, .20]) {      // square-tube legs
    const leg = box(.032, .20, .032, 0x5c6672, lx, -.185, lz);
    leg.material.metalness = .8; leg.material.roughness = .4;
    cyl(.018, .008, 0x2a323d, lx, -.287, lz, null, 12);              // levelling foot
    bolt(lx, -.064, lz, .005, .005, 0x8d97a4);                       // top fixing
  }
  for (const lz of [-.20, .20]) box(.95, .022, .022, 0x5c6672, 0, -.255, lz);     // stretchers
  box(.022, .022, .38, 0x5c6672, -.49, -.255, 0);
  box(.022, .022, .38, 0x5c6672, .49, -.255, 0);
  const lowerShelf = box(.95, .008, .36, 0x4b5562, 0, -.243, 0);     // lower shelf
  lowerShelf.material.metalness = .6; lowerShelf.material.roughness = .55;
  const backPanel = box(1.08, .17, .014, 0x5c6672, 0, .0, -.262);    // back panel
  backPanel.material.metalness = .8; backPanel.material.roughness = .42;
  for (const bx2 of [-.44, -.15, .15, .44]) bolt(bx2, .06, -.25, .005, .006, 0xc0c6cf);
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
    // Rear cowl with cooling slots, a lifting eye, a direction arrow and a lid on
    // the terminal box: the things that are on every industrial motor.
    cyl(.047, .022, 0x6c7787, x, .06, -.086, null, 24);              // fan cowl
    for (let v2 = 0; v2 < 10; v2++) {
      const a2 = v2 / 10 * Math.PI * 2;
      const slot = box(.006, .018, .004, 0x1b2430,
        x + Math.cos(a2) * .032, .06 + Math.sin(a2) * .032, -.0975);
      slot.rotation.z = a2;
    }
    const eye = new THREE.Mesh(new THREE.TorusGeometry(.008, .0028, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x8d97a4, roughness: .5, metalness: .7 }));
    eye.position.set(x, .122, -.02); eye.rotation.y = Math.PI / 2; scene.add(eye); tag(eye);
    const arrow = box(.012, .003, .012, 0xd7dde5, x + .024, .1105, .012);
    arrow.rotation.y = Math.PI / 4;                                  // rotation arrow sticker
    box(.034, .005, .034, 0x2a323d, x, .014, .03);                   // terminal box lid
    for (const s4 of [-1, 1]) for (const s5 of [-1, 1])
      cyl(.0025, .003, 0x8d97a4, x + s4 * .012, .017, .03 + s5 * .012, null, 6);
    tube([[x - .012, .03, .012], [x - .018, .02, .022], [x - .012, .012, .028]], .0015, 0x7aa2f7);
    for (const s6 of [-1, 1])                                        // slotted foot holes
      box(.022, .004, .012, 0x11151b, x + s6 * .05, -.0335, 0);
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
    box(.01, .006, .005, 0xe8eaed, bx + .03, by + .005, bz + .004);  // CAN connector
    box(.013, .013, .0025, 0x0e1116, bx - .002, by + .004, bz + .003);  // gate driver
    box(.009, .009, .002, 0x0e1116, bx + .016, by - .003, bz + .003);   // microcontroller
    box(.006, .011, .0025, 0x2b3340, bx - .02, by + .004, bz + .003);   // current sense
    for (let tp = 0; tp < 6; tp++)                                   // test points
      cyl(.0012, .0015, 0xd9a441, bx - .024 + tp * .009, by - .0225, bz + .003, null, 6);
    for (const [dx, col] of [[-.028, 0xef4444], [-.021, 0x7aa2f7]]) {  // status LEDs
      const d = box(.0035, .0035, .002, col, bx + dx, by - .018, bz + .004);
      d.material.emissive = new THREE.Color(col); d.material.emissiveIntensity = 1.1;
    }
    for (let sc = 0; sc < 4; sc++)                                   // terminal screws
      cyl(.0022, .002, 0xc0c6cf, bx - .039, by - .016 + sc * .011, bz + .011, null, 8);
    for (let k2 = 0; k2 < 4; k2++)                                   // crimp ferrules
      box(.006, .0075, .0075, 0xb9c2cd, bx - .0455, by - .016 + k2 * .011, bz + .004);
    const silk = box(.078, .058, .0012, 0x2f8f5b, bx, by, bz - .002); // board edge
    silk.material.roughness = .9;
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
  // The battery is the heaviest thing here, so it lives on the lower shelf with
  // its isolator and fuse beside it, and feeds both controllers up the back.
  tagging = 'battery';
  const batY = -.192, batZ = -.03;
  box(.17, .092, .085, 0x243040, -.02, batY, batZ);                  // pack
  box(.17, .010, .085, 0x3a4a5e, -.02, batY + .051, batZ);           // lid
  box(.058, .004, .026, 0xd7dde5, -.02, batY + .058, batZ + .028);   // label
  label(.034, .018, -.02, batY + .058, batZ - .03, 0xf0b429);        // warning label
  for (const s2 of [-1, 1])                                          // terminals
    box(.013, .013, .013, s2 > 0 ? 0xef4444 : 0x1b2430, -.02 + s2 * .048, batY + .062, batZ - .01);
  for (const bz2 of [batZ - .028, batZ + .028])                      // retaining straps
    box(.178, .096, .007, 0x11151b, -.02, batY, bz2);
  box(.028, .016, .018, 0x15191f, .085, batY + .03, batZ);           // BMS
  for (let l = 0; l < 4; l++)                                        // balance leads
    tube([[.062, batY + .05, batZ - .012 + l * .008], [.075, batY + .046, batZ - .006 + l * .006],
          [.082, batY + .036, batZ]], .0012, [0xef4444, 0xf0b429, 0x7aa2f7, 0xe8eaed][l]);
  box(.022, .014, .014, 0xf0b429, .02, batY + .062, batZ - .01);     // XT90
  cyl(.008, .034, 0x39414d, .14, batY + .02, batZ, null, 12);        // inline fuse
  box(.026, .022, .026, 0x2a323d, .20, batY + .012, batZ);           // isolator
  box(.01, .016, .01, 0xc0392b, .20, batY + .03, batZ);              // its red lever
  box(.034, .004, .034, 0x11151b, .20, batY - .001, batZ);           // isolator base

  // Supply up the back of the bench to each controller, tied as it goes.
  tube([[-.322, .06, .155], [-.44, .0, .08], [-.47, -.14, -.05], [-.17, -.168, batZ]], .005, COLOUR.power);
  tube([[.198, .06, .155], [.46, .0, .08], [.47, -.14, -.05], [.26, -.17, batZ]], .005, COLOUR.power);
  for (const [tx, ty, tz] of [[-.45, -.06, .01], [-.3, -.172, -.03], [.47, -.06, .01], [.3, -.174, -.03]])
    tieWrap(tx, ty, tz);
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
  // A desktop on the bench and its tower standing on the floor beside the frame.
  tagging = 'laptop';
  const deskX = -.44, benchTop = -.062;

  // A shelf across the back of the frame carries the screen above the rig, where
  // an operator can watch it while standing at the bench.
  for (const ux of [-.30, .30]) {
    const upright = box(.026, .24, .026, 0x5c6672, ux, .058, -.12);
    upright.material.metalness = .8; upright.material.roughness = .4;
    bolt(ux, -.056, -.12, .006, .006, 0xc0c6cf);
  }
  const shelf = box(.72, .012, .10, 0x58626f, 0, .173, -.12);
  shelf.material.metalness = .62; shelf.material.roughness = .52;
  box(.72, .022, .010, 0x6a7482, 0, .162, -.072);                    // shelf lip
  for (const sx of [-.30, .30]) bolt(sx, .181, -.12, .005, .005, 0x8d97a4);

  const monitor = new THREE.Group();
  monitor.position.set(0, .179, -.125);
  scene.add(monitor);
  box(.15, .008, .075, 0x1b2430, 0, .004, .01, monitor);             // stand foot
  box(.024, .055, .024, 0x222b36, 0, .034, 0, monitor);              // column
  const panel = box(.30, .185, .010, 0x161b22, 0, .145, -.004, monitor);
  panel.rotation.x = -.07;
  const bezelLight = box(.012, .004, .002, 0x34d399, .13, .055, .004, monitor);
  bezelLight.material.emissive = new THREE.Color(0x34d399);
  bezelLight.material.emissiveIntensity = 1.1;

  // The screen is a drawn dashboard rather than a coloured rectangle, redrawn
  // while the rig view is on so the traces move with the speed slider.
  screenTexture = makeScreenTexture();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.282, .168),
    new THREE.MeshBasicMaterial({ map: screenTexture }));
  screen.position.set(0, .145, .0025);
  screen.rotation.x = -.07;
  monitor.add(screen); tag(screen);

  const desk = new THREE.Group();
  desk.position.set(deskX + .03, benchTop, .12);
  desk.rotation.y = .62; scene.add(desk);
  box(.17, .008, .055, 0x222b36, 0, .004, 0, desk);                  // keyboard
  for (let kr = 0; kr < 5; kr++)
    box(.158, .0015, .0075, 0x39414d, 0, .009, -.019 + kr * .0095, desk);
  const mouse = box(.024, .012, .038, 0x222b36, .115, .006, .004, desk);
  mouse.material.roughness = .45;

  // Tower on the floor, with its own cables up to the bench.
  const tower = new THREE.Group(); tower.position.set(-.60, -.115, .02); scene.add(tower);
  box(.10, .33, .28, 0x1b2430, 0, 0, 0, tower);                      // case
  box(.004, .33, .28, 0x262f3b, .052, 0, 0, tower);                  // side panel
  box(.085, .30, .004, 0x151a22, 0, 0, .142, tower);                 // front bezel
  for (let v = 0; v < 9; v++)                                        // front vents
    box(.06, .006, .003, 0x0d1117, 0, .11 - v * .016, .145, tower);
  const power = cyl(.008, .004, 0x34d399, 0, -.055, .146, tower, 14);
  power.material.emissive = new THREE.Color(0x34d399); power.material.emissiveIntensity = 1.3;
  box(.05, .01, .003, 0x39414d, 0, -.085, .145, tower);              // front port strip
  for (const fz of [-.11, .11]) for (const fx of [-.04, .04])        // feet
    box(.02, .012, .02, 0x11151b, fx, -.171, fz, tower);
  box(.05, .05, .004, 0x2a323d, 0, .08, -.141, tower);               // rear fan grille
  for (let f2 = 0; f2 < 6; f2++) {
    const blade = box(.004, .022, .002, 0x39414d, 0, .08, -.144, tower);
    blade.rotation.z = f2 / 6 * Math.PI;
  }

  tube([[-.60, .06, .04], [-.53, .0, .0], [-.47, -.04, -.02]], .0035, 0x2a323d);  // monitor lead
  tube([[-.60, -.27, .06], [-.5, -.275, .16], [-.3, -.275, .2]], .004, 0x11151b);    // mains
  tube([[-.23, .076, .156], [-.38, .02, .1], [-.52, -.03, -.02], [-.56, -.02, -.06]], .0022, 0x5b6b7f);
  tube([[.29, .076, .156], [.1, .04, .2], [-.4, -.02, .16], [-.56, -.02, -.04]], .0022, 0x5b6b7f);
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
    let link;
    if (i % 2) {
      // An outer link: two side plates with the pin heads showing through them.
      link = new THREE.Group(); scene.add(link);
      for (const pz of [-.0065, .0065]) {
        const plate = box(.016, .009, .0025, 0x8d97a4, 0, 0, pz, link);
        plate.material.metalness = .7; plate.material.roughness = .35;
        for (const px of [-.005, .005])
          cyl(.0022, .0008, 0xd7dde5, px, 0, pz + Math.sign(pz) * .0016, link, 8);
      }
      link.userData.rotates = true;
    } else {
      // An inner link: the roller plus the two narrower plates that carry it.
      link = new THREE.Group(); scene.add(link);
      const roller = cyl(.005, .015, 0xc8d0da, 0, 0, 0, link, 12);
      roller.rotation.z = Math.PI / 2;
      roller.material.metalness = .75; roller.material.roughness = .3;
      for (const pz of [-.0042, .0042]) {
        const inner = box(.014, .0075, .0022, 0x7c8694, 0, 0, pz, link);
        inner.material.metalness = .7; inner.material.roughness = .4;
      }
      link.userData.rotates = true;
    }
    chainLinks.push(link);
  }
  // The master link, which is the one you actually undo to fit the chain.
  // Both kinds of link are groups now, so colour whatever is inside them.
  for (const masterLink of [chainLinks[0], chainLinks[1]])
    masterLink.traverse(m => { if (m.material) m.material.color.setHex(0xe0a23a); });
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
    // The slack side of a chain hangs. Only the lower straight droops, most at
    // its middle, which is what gives a chain drive its look.
    if (y < 0 && Math.abs(x) < span / 2) {
      y -= .006 * Math.cos(Math.PI * x / span);
    }
    link.position.set(x, y + .06, .125);
    if (link.userData.rotates) link.rotation.z = angle;
  });
}

// ---- the exploded teaching machine -----------------------------------------------
// The inside view is an exploded single pole pair. The real BM1109 has three, so
// one turn of this picture is a third of a shaft turn; that is said on screen and
// in the panel beside it, because every electrical angle here depends on it.
//
// What it shows: six coils, two per phase, carrying the currents the controller
// actually commands. Each coil lights by how much current it is carrying, so the
// lit pattern IS the stator field, and you can watch it run 90 electrical degrees
// ahead of the magnets, which is the whole of field-oriented control.
let machine = null, explode = 0;

function buildMotorInside() {
  const centre = new THREE.Vector3(-.26, .06, 0);

  machine = buildFocMachine(THREE, { labelScale: 1, detailed: true });
  machine.group.position.copy(centre);
  scene.add(machine.group);
  rotorGroup = machine.rotorGroup;

  // The encoder and the cap it sits behind, pulled furthest off the back.
  const rearGroup = new THREE.Group();
  rearGroup.position.copy(centre);
  rearGroup.userData.explodeZ = -.185;
  scene.add(rearGroup);
  cyl(.050, .012, 0x6c7787, 0, 0, -.06, rearGroup, 28);
  encoderDisc = cyl(.026, .005, 0x7aa2f7, 0, 0, -.072, rearGroup);
  for (let k = 0; k < 36; k++) {
    const a = k / 36 * Math.PI * 2;
    box(.0022, .006, .0022, 0x0d1117, Math.cos(a) * .021, Math.sin(a) * .021, -.0745, rearGroup);
  }
  for (let b = 0; b < 3; b++) {
    const a = b / 3 * Math.PI * 2 + .4;
    cyl(.002, .004, 0x8d97a4, Math.cos(a) * .034, Math.sin(a) * .034, -.06, rearGroup, 6);
  }
  const encoderTag = labelSprite(THREE, 'encoder', '#7aa2f7', .05);
  encoderTag.position.set(0, .046, -.072); rearGroup.add(encoderTag);

  const poleNote = labelSprite(THREE,
    'one pole pair shown · the motor has three', '#6b7684', .19);
  poleNote.position.set(-.26, -.085, .02); scene.add(poleNote);

  // Floating notes, each with a line back to the part it is about, so the view
  // explains itself to someone standing in front of it with nobody talking.
  const notes = new THREE.Group(); scene.add(notes);
  const note = (text, colour, at, pointsAt, width) => {
    const sprite = calloutSprite(THREE, text, colour, width);
    sprite.position.set(at[0], at[1], at[2]);
    notes.add(sprite);
    notes.add(leader(THREE, at, pointsAt, colour));
  };
  note('Each coil lights with the current sent to it. The lit pattern is the stator field.',
    '#34d399', [-.50, .125, -.02], [-.30, .062, -.05], .145);
  note('That field is held 90 electrical degrees ahead of the magnets: the most torque per amp.',
    '#f0b429', [-.035, .135, .07], [-.215, .085, .065], .145);
  note('The encoder measures this angle. Sensorless has to work it out from the back-EMF.',
    '#7aa2f7', [-.025, -.085, -.17], [-.255, -.01, -.165], .145);

  housing = motors[0];
  insideKeep = [machine.group, rearGroup, poleNote, notes];
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
    // Some meshes, such as the screen, use a material with no emissive channel.
    if (!m.material || !m.material.emissive) continue;
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
  // Scroll to zoom. The page must not scroll underneath, so the event is claimed.
  container.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(1 + Math.sign(e.deltaY) * .12);
  }, { passive: false });
  // Pinch on a touch screen, which is what a visitor will try first.
  let pinch = 0;
  container.addEventListener('touchmove', e => {
    if (e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
    if (pinch) zoomBy(pinch / d);
    pinch = d;
  }, { passive: true });
  container.addEventListener('touchend', () => { pinch = 0; });
  resize(); addEventListener('resize', resize);
  renderer.setAnimationLoop(frame);
}

function resize() {
  if (!host.clientWidth) return;
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1); camera.updateProjectionMatrix();
}

// Zoom is a multiplier on the framing each view asks for, so switching view
// still frames properly and the viewer keeps control afterwards.
// The graphs under the view plot the same angle the machine is turning at.
export function angle() { return spin; }

export function zoomBy(factor) {
  orbit.zoom = V.clamp(orbit.zoom * factor, .35, 2.6);
  intro = 99;                       // the viewer has taken over from the fly-in
  return orbit.zoom;
}

export function resetView() {
  orbit.zoom = 1; orbit.yaw = 0.75; orbit.pitch = 0.22; intro = 0;
}

export function setView(next) {
  view = next; intro = 0; orbit.zoom = 1;
  const inside = next === 'inside';
  for (const child of scene.children) {
    if (child.isLight) continue;
    child.visible = inside ? insideKeep.includes(child) : !insideKeep.includes(child);
  }
  housing.visible = !inside; housing.userData.cap.visible = !inside;
}

export function setOptions(next) {
  Object.assign(opts, next);
  return opts;
}

export function readout() {
  const err = opts.sensorless ? estimateError(opts.rpm, clock ? clock.elapsedTime : 0) : 0;
  return { errorDeg: V.radToDeg(err), torqueKept: Math.cos(err) };
}

function frame() {
  const dt = Math.min(clock.getDelta(), .05);
  intro += dt;
  // Redraw the operator's screen a few times a second: often enough to look live,
  // rarely enough that it costs nothing.
  screenClock += dt;
  if (screenTexture && view === 'rig' && screenClock > .07) {
    drawScreen(clock.elapsedTime); screenTexture.needsUpdate = true; screenClock = 0;
  }
  spin += dt * (opts.rpm * 2 * Math.PI / 60) * opts.slow;
  for (const s of sprockets) s.rotation.z = spin;
  machine.rotorGroup.rotation.z = spin; encoderDisc.rotation.y = spin;
  // Slide the assembly apart on entering the inside view, back when leaving.
  explode += ((view === 'inside' ? 1 : 0) - explode) * Math.min(dt * 1.6, 1);
  machine.setExplode(explode);
  for (const child of scene.children) {
    if (!child.userData || child.userData.explodeZ === undefined) continue;
    child.position.z = child.userData.explodeZ * explode;
  }
  positionChain(spin * .05);

  const err = opts.sensorless ? estimateError(opts.rpm, clock.elapsedTime) : 0;
  // One pole pair is drawn, so the electrical angle is the angle you can see.
  machine.update({
    theta: spin, err,
    amplitude: .55 + .45 * Math.min(opts.rpm / 900, 1),
    showEstimate: view === 'inside' && opts.sensorless,
  });

  // Cinematic opening: pull in from a wide shot, then hand control to the viewer.
  const target = view === 'inside' ? new THREE.Vector3(-.26, .06, .02) : new THREE.Vector3(0, .05, 0);
  const wanted = view === 'inside' ? .44 : .88;
  const ease = Math.min(intro / 3.5, 1);
  const dist = V.lerp(wanted * 2.1, wanted, ease * ease * (3 - 2 * ease)) * orbit.zoom;
  if (intro < 8 && !orbit.drag && view === 'rig') orbit.yaw += dt * .12;
  // Three-quarter view inside: straight down the shaft the parts would sit on top
  // of one another and the explosion would be invisible, but turn too far and the
  // angle between the two vectors stops reading.
  if (view === 'inside' && intro < .05) { orbit.yaw = Math.PI / 2 - .8; orbit.pitch = .30; }
  camera.position.set(
    target.x + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist,
    target.y + Math.sin(orbit.pitch) * dist,
    target.z + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist);
  camera.lookAt(target);
  renderer.render(scene, camera);
}
