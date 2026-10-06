'use strict';
/* BM1109 drive envelope explorer.
   The steady-state motor equations are solved live in the browser. The dots are the
   24 Simulink cases in data/matrix.json; the live model reproduces them to about four
   digits, which is the point of showing both. */

const $ = id => document.getElementById(id);
let P = null, CASES = [], mode = 'presenter', idleTimer = 0, attract = null, selected = null;

// ---- physics ------------------------------------------------------------------
// Iq from torque, terminal voltage from back-EMF + resistive and inductive drops,
// losses from I^2R and viscous friction. Same equations as the Simulink model.
function operate(rpm, torque) {
  const w = rpm * 2 * Math.PI / 60;              // mechanical rad/s
  const we = P.pole_pairs * w;                   // electrical rad/s
  const iq = (torque + P.B_Nms * w) / P.Kt_NmPerA;
  const vq = we * P.flux_Wb + P.Rs_ohm * iq;     // back-EMF + resistance
  const vd = -we * P.Lq_H * iq;                  // inductive cross-coupling
  const v = Math.hypot(vd, vq);
  const modulation = v / (P.vdc_V / Math.sqrt(3));
  const pOut = torque * w;
  const pCu = 1.5 * P.Rs_ohm * iq * iq;
  const pFric = P.B_Nms * w * w;
  const pDc = pOut + pCu + pFric;
  return {
    rpm, torque, w, iq, v, modulation,
    duty: 0.5 + 0.5 * Math.min(modulation, 1),
    pOut, pCu, pFric, pDc,
    efficiency: pOut > 0.5 ? 100 * pOut / pDc : null,
    overVoltage: modulation > 1,
    overCurrent: iq > P.iq_limit_A,
  };
}

function verdict(o) {
  if (o.overVoltage && o.overCurrent) return { ok: false, why: 'Out of voltage AND out of current', detail: 'The supply cannot reach this speed and the drive cannot supply this torque.' };
  if (o.overVoltage) return { ok: false, why: 'Out of voltage', detail: `At ${Math.round(o.rpm)} rpm the motor generates more back-EMF than the ${P.vdc_V} V supply can push against. Raise the supply voltage or lower the speed.` };
  if (o.overCurrent) return { ok: false, why: 'Out of current', detail: `${o.torque.toFixed(2)} N·m needs ${o.iq.toFixed(1)} A, above the ${P.iq_limit_A} A limit. Lower the load or raise the limit.` };
  if (o.efficiency !== null && o.efficiency < 50) return { ok: true, warn: true, why: 'Runs, but wastes most of the power', detail: `Only ${o.efficiency.toFixed(0)} % of the input becomes mechanical output: ${o.pCu.toFixed(1)} W is heating the windings. Low speed with high torque is thermally expensive.` };
  return { ok: true, why: 'The motor can do this', detail: `${o.iq.toFixed(1)} A of current, ${(100 * o.modulation).toFixed(0)} % of the available voltage used.` };
}

// Highest torque the drive can hold at a given speed, from both limits.
function envelopeTorque(rpm) {
  let lo = 0, hi = 12;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const o = operate(rpm, mid);
    (o.overVoltage || o.overCurrent) ? hi = mid : lo = mid;
  }
  return lo;
}

// ---- drawing ------------------------------------------------------------------
const MAXRPM = 2600, MAXT = 3.2;
function draw() {
  const c = $('envelope'), g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = mode === 'kiosk' ? 86 : 70, R = w - 20, T = 20, B = h - (mode === 'kiosk' ? 62 : 48);
  const X = rpm => L + rpm / MAXRPM * (R - L), Y = t => B - t / MAXT * (B - T);
  g.clearRect(0, 0, w, h);

  // Feasible region, shaded by efficiency: brighter green means less of the input
  // power is wasted as heat. The outline is the limit of what the drive can hold.
  const step = 6, dt = MAXT / 70;
  const boundary = [];
  for (let px = L; px <= R; px += step) {
    const rpm = (px - L) / (R - L) * MAXRPM;
    const tmax = envelopeTorque(rpm);
    boundary.push([px, tmax]);
    for (let t = 0; t < tmax; t += dt) {
      const e = operate(rpm, t + dt / 2).efficiency;
      g.fillStyle = `hsl(150 55% ${14 + (e === null ? 0 : e) * 0.34}%)`;
      g.fillRect(px, Y(Math.min(t + dt, tmax)), step + 1, Math.max(1, Y(t) - Y(Math.min(t + dt, tmax))));
    }
  }
  g.strokeStyle = '#6ee7a8'; g.lineWidth = 2.5; g.beginPath();
  boundary.forEach(([px, t], i) => i ? g.lineTo(px, Y(t)) : g.moveTo(px, Y(t)));
  g.stroke();

  // axes
  g.strokeStyle = '#4a5568'; g.lineWidth = 1; g.beginPath();
  g.moveTo(L, T); g.lineTo(L, B); g.lineTo(R, B); g.stroke();
  g.fillStyle = '#9aa5b1'; g.font = (mode === 'kiosk' ? 15 : 12) + 'px system-ui'; g.textAlign = 'center';
  for (let rpm = 0; rpm <= MAXRPM; rpm += 500) { g.fillText(rpm, X(rpm), B + 20); }
  g.fillText('speed (rpm)', (L + R) / 2, B + (mode === 'kiosk' ? 46 : 38));
  g.textAlign = 'right';
  for (let t = 0; t <= MAXT; t += 0.5) { g.fillText(t.toFixed(1), L - 8, Y(t) + 4); }
  g.save(); g.translate(mode === 'kiosk' ? 22 : 16, (T + B) / 2); g.rotate(-Math.PI / 2);
  g.textAlign = 'center'; g.fillText('torque (N·m)', 0, 0); g.restore();

  // the 24 Simulink cases
  for (const cs of CASES) {
    g.beginPath(); g.arc(X(cs.rpm), Y(cs.load_Nm), mode === 'kiosk' ? 5 : 4, 0, 7);
    g.fillStyle = '#e8eaed'; g.fill();
    g.strokeStyle = '#1b2430'; g.lineWidth = 1.5; g.stroke();
  }

  // the cursor
  const rpm = Number($('speed').value), torque = Number($('load').value);
  const o = operate(rpm, torque), v = verdict(o);
  g.beginPath(); g.arc(X(rpm), Y(torque), mode === 'kiosk' ? 13 : 10, 0, 7);
  g.fillStyle = v.ok ? (v.warn ? '#f0b429' : '#34d399') : '#ef4444';
  g.fill(); g.strokeStyle = '#0d1117'; g.lineWidth = 3; g.stroke();
  return { o, v };
}

// ---- readouts -----------------------------------------------------------------
function render() {
  const { o, v } = draw();
  $('speed-out').textContent = Math.round(o.rpm) + ' rpm';
  $('load-out').textContent = o.torque.toFixed(2) + ' N·m';
  $('vdc-out').textContent = P.vdc_V.toFixed(1) + ' V';
  $('imax-out').textContent = P.iq_limit_A.toFixed(0) + ' A';
  $('verdict').textContent = v.why;
  $('verdict').className = 'verdict ' + (v.ok ? (v.warn ? 'warn' : 'ok') : 'bad');
  $('explain').textContent = v.detail;
  const bar = (id, value, total) => { $(id).style.width = Math.max(0, Math.min(100, 100 * value / total)) + '%'; };
  const total = Math.max(o.pDc, 1e-6);
  bar('bar-out', o.pOut, total); bar('bar-cu', o.pCu, total); bar('bar-fric', o.pFric, total);
  $('p-out').textContent = o.pOut.toFixed(1) + ' W';
  $('p-cu').textContent = o.pCu.toFixed(1) + ' W';
  $('p-fric').textContent = o.pFric.toFixed(1) + ' W';
  $('numbers').innerHTML = [
    ['Current Iq', o.iq.toFixed(2) + ' A'],
    ['Terminal voltage', o.v.toFixed(2) + ' V'],
    ['Voltage used', (100 * o.modulation).toFixed(0) + ' %'],
    ['Max duty', o.duty.toFixed(3)],
    ['Input power', o.pDc.toFixed(1) + ' W'],
    ['Efficiency', o.efficiency === null ? 'n/a at no load' : o.efficiency.toFixed(1) + ' %'],
  ].map(([k, val]) => `<div><span>${k}</span><b>${val}</b></div>`).join('');
}

// ---- modes --------------------------------------------------------------------
function setMode(next) {
  mode = next;
  document.body.dataset.mode = next;
  $('mode-name').textContent = next === 'kiosk' ? 'Visitor mode' : 'Presenter mode';
  render();
}
const DEFAULTS = { speed: 400, load: 0.5, vdc: 26.5, imax: 25 };
function reset() {
  $('speed').value = DEFAULTS.speed; $('load').value = DEFAULTS.load;
  $('vdc').value = DEFAULTS.vdc; $('imax').value = DEFAULTS.imax;
  P.vdc_V = DEFAULTS.vdc; P.iq_limit_A = DEFAULTS.imax; render();
}
const SCENARIOS = {
  1: { speed: 400, load: 0, label: 'Spinning with no load: almost no current' },
  2: { speed: 400, load: 0.5, label: 'Same speed under load: 25 times the current' },
  3: { speed: 2100, load: 0.5, label: 'Past the voltage ceiling: the supply runs out' },
  4: { speed: 50, load: 2.0, label: 'Low speed, high torque: most of the power becomes heat' },
  5: { speed: 800, load: 2.8, label: 'Past the current limit: more torque than the drive can give' },
};
function scenario(n) {
  const s = SCENARIOS[n]; if (!s) return;
  $('speed').value = s.speed; $('load').value = s.load; render();
  $('scenario').textContent = s.label;
}

// Unattended: return to defaults when nobody has touched it, then sweep to catch the eye.
function touched() {
  idleTimer = Date.now();
  if (attract) { clearInterval(attract); attract = null; }
}
function watchIdle() {
  setInterval(() => {
    if (mode !== 'kiosk' || Date.now() - idleTimer < 45000) return;
    if (!attract) {
      reset(); setTab('envelope');   // the sweeping envelope is what catches the eye
      let phase = 0;
      attract = setInterval(() => {
        phase += 0.02;
        $('speed').value = Math.round(1100 + 900 * Math.sin(phase));
        $('load').value = (1.3 + 1.2 * Math.sin(phase * 0.6)).toFixed(2);
        render();
      }, 60);
    }
  }, 1000);
}

// ---- exhibit 2: the rotating frame ---------------------------------------------
// Three phase currents are sinusoids no controller can track. Seen from the rotor they
// become two steady numbers: Id (wasted, held at zero) and Iq (torque). Same currents,
// different viewpoint. That is field-oriented control in one picture.
let rotorFrame = false, focPhase = 0, focLast = 0;

function focState() {
  const rpm = Number($('foc-speed').value), torque = Number($('foc-load').value);
  const o = operate(rpm, torque);
  const peak = o.iq * Math.SQRT2;          // the sinusoids peak above the steady q-axis value
  // The controller aims its current at where it *thinks* the rotor is. An angle error
  // splits that current: cos(error) still makes torque, sin(error) is pushed into the
  // magnets and only makes heat.
  const err = Number($('foc-err').value) * Math.PI / 180;
  // Two amplitudes matter. `peak` is what the windings would carry if the angle
  // were right. `peakHeld` is what they must carry to make the same torque while
  // pushing at the wrong angle, which is larger by 1/cos(error).
  const peakHeld = peak / Math.max(Math.cos(err), .05);
  return { rpm, torque, o, peak, peakHeld, err,
           iq: o.iq * Math.cos(err), id: o.iq * Math.sin(err) };
}

// ---- the machine, drawn once and used by every exhibit --------------------------
// One pole pair is drawn because everything here is in ELECTRICAL angle: the real
// rotor has three, so the shaft turns a third as fast as this picture does.
function drawMachine(g, cx, cy, r, o) {
  const theta = o.theta, err = o.err || 0, peak = o.peak || 0;
  const live = peak > 0.05;

  // --- stator: back iron, slots, and the three phase windings ------------------
  const iron = g.createRadialGradient(cx, cy, r * 1.3, cx, cy, r * 1.72);
  iron.addColorStop(0, '#222b36'); iron.addColorStop(1, '#161c25');
  g.fillStyle = iron;
  g.beginPath(); g.arc(cx, cy, r * 1.72, 0, 7);
  g.arc(cx, cy, r * 1.3, 0, 7, true); g.fill();
  g.strokeStyle = '#2f3a48'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, r * 1.72, 0, 7); g.stroke();
  g.beginPath(); g.arc(cx, cy, r * 1.3, 0, 7); g.stroke();

  const PHASE = ['#34d399', '#f0b429', '#7aa2f7'];
  for (let k = 0; k < 12; k++) {                       // slots, four per phase
    const a = -k * Math.PI / 6 + Math.PI / 12;
    g.save(); g.translate(cx, cy); g.rotate(-a);
    g.fillStyle = '#121820';
    g.beginPath(); g.ellipse(r * 1.5, 0, r * 0.13, r * 0.085, 0, 0, 7); g.fill();
    g.fillStyle = PHASE[k % 3];
    g.globalAlpha = live ? 0.85 : 0.35;
    g.beginPath(); g.ellipse(r * 1.5, 0, r * 0.085, r * 0.05, 0, 0, 7); g.fill();
    g.globalAlpha = 1;
    g.restore();
  }
  for (let k = 0; k < 3; k++) {                        // phase axis labels
    const a = k * 2 * Math.PI / 3;
    g.fillStyle = PHASE[k];
    g.font = 'bold 13px system-ui'; g.textAlign = 'center';
    g.fillText('ABC'[k], cx + Math.cos(a) * r * 1.84, cy - Math.sin(a) * r * 1.84 + 4);
  }

  // --- air gap -----------------------------------------------------------------
  g.fillStyle = '#0d1117';
  g.beginPath(); g.arc(cx, cy, r * 1.3, 0, 7); g.arc(cx, cy, r * 1.06, 0, 7, true); g.fill();

  // --- rotor: two shaded magnet halves, a boundary and a shaft -----------------
  g.save(); g.translate(cx, cy); g.rotate(-theta);
  for (const [from, colour, dark] of [[-Math.PI / 2, '#ef4444', '#8f2420'], [Math.PI / 2, '#64748b', '#39434f']]) {
    const grad = g.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, colour); grad.addColorStop(1, dark);
    g.fillStyle = from < 0 ? grad : dark;
    if (from >= 0) { const g2 = g.createLinearGradient(0, r, 0, -r); g2.addColorStop(0, '#7b8798'); g2.addColorStop(1, '#39434f'); g.fillStyle = g2; }
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, from, from + Math.PI); g.fill();
  }
  g.strokeStyle = '#0d1117'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -r); g.lineTo(0, r); g.stroke();
  g.strokeStyle = '#1b2430'; g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke();
  const hub = g.createRadialGradient(-r * 0.06, -r * 0.06, 1, 0, 0, r * 0.2);
  hub.addColorStop(0, '#aab4c0'); hub.addColorStop(1, '#5b6b7f');
  g.fillStyle = hub; g.beginPath(); g.arc(0, 0, r * 0.2, 0, 7); g.fill();
  g.fillStyle = '#39434f'; g.fillRect(-r * 0.035, -r * 0.2, r * 0.07, r * 0.07);   // keyway
  g.restore();

  // Pole letters stay upright so they can be read while the rotor turns.
  g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(r * 0.3) + 'px system-ui'; g.textAlign = 'center';
  g.fillText('N', cx + Math.cos(theta) * r * 0.6, cy - Math.sin(theta) * r * 0.6 + r * 0.1);
  g.fillText('S', cx - Math.cos(theta) * r * 0.6, cy + Math.sin(theta) * r * 0.6 + r * 0.1);

  // --- the wasted wedge: the angle the current is away from where it should be --
  if (live && Math.abs(err) > 0.02) {
    const ideal = theta + Math.PI / 2;
    g.save(); g.translate(cx, cy); g.scale(1, -1);
    g.fillStyle = Math.abs(err) > Math.PI / 3 ? 'rgba(239,68,68,.20)' : 'rgba(240,180,41,.18)';
    g.beginPath(); g.moveTo(0, 0);
    g.arc(0, 0, r * 1.02, Math.min(ideal, ideal + err), Math.max(ideal, ideal + err)); g.fill();
    g.restore();
  }

  // --- vectors ------------------------------------------------------------------
  // Labels sit outside the stator, and are kept inside the panel they belong to
  // so a vector pointing sideways cannot push its label off the edge.
  const labelR = r * 2.1, bounds = o.bounds;
  arrowOn(g, cx, cy, theta, r * 1.0, '#ef4444', 'magnets (d)', false, false, labelR, bounds);
  if (live) {
    const ideal = theta + Math.PI / 2;
    if (Math.abs(err) < 0.01) {
      arrowOn(g, cx, cy, ideal, r * 1.0, '#34d399', 'current (q)', false, true, labelR, bounds);
    } else {
      // Only name the ideal direction when there is room for the label to sit
      // clear of the one next to it.
      arrowOn(g, cx, cy, ideal, r * 1.0, '#3f6b57',
        Math.abs(err) > 0.45 ? 'should be here' : '', true, false, labelR, bounds);
      arrowOn(g, cx, cy, ideal + err, r * 1.0, Math.abs(err) > Math.PI / 3 ? '#ef4444' : '#f0b429',
        'current', false, true, labelR, bounds);
    }
  }
}

// A vector with a real head, optionally dashed, optionally glowing.
function arrowOn(g, cx, cy, angle, len, colour, label, dashed, glow, labelR, bounds) {
  const x = cx + Math.cos(angle) * len, y = cy - Math.sin(angle) * len;
  g.save();
  if (glow) { g.shadowColor = colour; g.shadowBlur = 14; }
  g.strokeStyle = colour; g.lineWidth = 4; g.lineCap = 'round';
  if (dashed) g.setLineDash([7, 6]);
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(x - Math.cos(angle) * 11, y + Math.sin(angle) * 11); g.stroke();
  g.setLineDash([]);
  g.beginPath();                                        // head
  g.moveTo(x, y);
  g.lineTo(x - Math.cos(angle) * 15 - Math.sin(angle) * 7, y + Math.sin(angle) * 15 - Math.cos(angle) * 7);
  g.lineTo(x - Math.cos(angle) * 15 + Math.sin(angle) * 7, y + Math.sin(angle) * 15 + Math.cos(angle) * 7);
  g.closePath(); g.fillStyle = colour; g.fill();
  g.restore();
  if (label) {
    const lr = labelR || len + 26;
    let lx = cx + Math.cos(angle) * lr;
    g.fillStyle = colour; g.font = 'bold 13px system-ui'; g.textAlign = 'center';
    if (bounds) {
      const half = g.measureText(label).width / 2;
      lx = Math.min(Math.max(lx, bounds[0] + half), bounds[1] - half);
    }
    g.fillText(label, lx, cy - Math.sin(angle) * lr + 4);
  }
}

function drawRotor(theta, peak, err) {
  const c = $('rotor'), g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  drawMachine(g, w / 2, h / 2, Math.min(w, h) * 0.215, { theta, peak, err, bounds: [6, w - 6] });
  g.fillStyle = '#6b7684'; g.font = '12px system-ui'; g.textAlign = 'center';
  g.fillText('drawn in electrical angle: one pole pair of the three', w / 2, h - 8);
}

function drawScope(theta, peak, iq, id, err, peakHeld) {
  const c = $('scope'), g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const L = 46, R = w - 12, T = 14, B = h - 40, mid = (T + B) / 2;
  const top = rotorFrame ? Math.max(peak, 1) : Math.max(peakHeld * 1.08, 1);
  const scale = (B - T) / 2 / (top * 1.1);
  g.strokeStyle = '#2b3646'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(L, mid); g.lineTo(R, mid); g.stroke();
  g.beginPath(); g.moveTo(L, T); g.lineTo(L, B); g.stroke();
  g.fillStyle = '#9aa5b1'; g.font = '12px system-ui'; g.textAlign = 'right';
  g.fillText('+' + top.toFixed(1) + ' A', L - 6, T + 12);
  g.fillText('0', L - 6, mid + 4);
  g.fillText('-' + top.toFixed(1) + ' A', L - 6, B);

  const CYCLES = 2, N = 260, SPAN = CYCLES * 2 * Math.PI;
  const xOf = frac => L + frac * (R - L);
  const plot = (value, colour, width, dash) => {
    g.strokeStyle = colour; g.lineWidth = width; g.setLineDash(dash || []);
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const frac = i / N, a = theta - (1 - frac) * SPAN;
      const y = mid - value(a) * scale;
      i ? g.lineTo(xOf(frac), y) : g.moveTo(xOf(frac), y);
    }
    g.stroke(); g.setLineDash([]);
  };

  if (rotorFrame) {
    for (const s2 of [{ colour: '#34d399', label: 'Iq  torque', value: iq },
                      { colour: '#ef4444', label: 'Id  wasted', value: id }]) {
      plot(() => s2.value, s2.colour, 2.5);
      const y = mid - s2.value * scale;
      g.fillStyle = s2.colour; g.beginPath(); g.arc(R - 1, y, 4, 0, 7); g.fill();
      g.textAlign = 'right'; g.font = 'bold 12px system-ui';
      g.fillText(s2.label, R - 8, y - 10);
    }
  } else {
    // With an angle error the windings carry the same three currents, but shifted
    // round by the error and larger, because the torque still has to be made. The
    // faint traces are where they would be if the angle were right.
    const shifted = k => a => peakHeld * Math.cos(a - k * 2 * Math.PI / 3 + Math.PI / 2 + err);
    const ideal = k => a => peak * Math.cos(a - k * 2 * Math.PI / 3 + Math.PI / 2);
    const colours = ['#34d399', '#f0b429', '#7aa2f7'];
    if (Math.abs(err) > .01) {
      for (let k = 0; k < 3; k++) plot(ideal(k), colours[k] + '55', 1.6, [5, 5]);
    }
    for (let k = 0; k < 3; k++) {
      plot(shifted(k), colours[k], 2.5);
      const y = mid - shifted(k)(theta) * scale;
      g.fillStyle = colours[k]; g.beginPath(); g.arc(R - 1, y, 4, 0, 7); g.fill();
      g.textAlign = 'right'; g.font = 'bold 12px system-ui';
      g.fillText('phase ' + 'ABC'[k], R - 8, y - 10);
    }

    // Mark the shift itself: where phase A should peak, where it does, and the
    // gap between them. Both marks come from the same cycle, so the gap is the
    // error and never a whole revolution more.
    if (Math.abs(err) > .05) {
      const n = Math.round((theta - .5 * SPAN + Math.PI / 2) / (2 * Math.PI));
      const fIdeal = 1 - (theta - (-Math.PI / 2 + 2 * Math.PI * n)) / SPAN;
      const fActual = fIdeal - err / SPAN;
      if (fIdeal > .16 && fIdeal < .92 && fActual > .04 && fActual < .97) {
        const x1 = xOf(fIdeal), x2 = xOf(fActual);
        g.fillStyle = 'rgba(240,180,41,.16)';
        g.fillRect(Math.min(x1, x2), T, Math.abs(x2 - x1), B - T);
        for (const [x, colour] of [[x1, '#3f6b57'], [x2, '#f0b429']]) {
          g.strokeStyle = colour; g.lineWidth = 1.5; g.setLineDash([4, 4]);
          g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke(); g.setLineDash([]);
        }
        g.fillStyle = '#f0b429'; g.font = 'bold 12px system-ui'; g.textAlign = 'center';
        g.fillText(Math.abs(Math.round(err * 180 / Math.PI)) + '°',
          (x1 + x2) / 2, T + 14);
      }
    }
  }

  g.fillStyle = '#9aa5b1'; g.textAlign = 'center'; g.font = '12px system-ui';
  g.fillText(rotorFrame ? 'riding with the rotor' : 'standing still, watching the wires',
    (L + R) / 2, B + 18);
  if (!rotorFrame) {
    const degrees = Math.round(Math.abs(err) * 180 / Math.PI);
    g.fillStyle = degrees ? '#f0b429' : '#6b7684'; g.font = '12px system-ui';
    g.fillText(degrees
      ? `shifted ${degrees}\u00b0 round, and ${peak.toFixed(1)} A becomes ${peakHeld.toFixed(1)} A for the same torque`
      : 'faint traces appear when the angle is wrong, showing where the currents should have been',
      (L + R) / 2, B + 34);
  }
}

function focFrame(now) {
  if (document.getElementById('tab-foc').hidden) { focLast = now; return requestAnimationFrame(focFrame); }
  const { rpm, o, peak, peakHeld, err, iq, id } = focState();
  const dt = Math.min((now - focLast) / 1000, 0.05); focLast = now;
  focPhase += dt * (rpm * 2 * Math.PI / 60) * P.pole_pairs * Number($('foc-rate').value);
  const degrees = Math.round(err * 180 / Math.PI);
  $('foc-speed-out').textContent = Math.round(rpm) + ' rpm';
  $('foc-load-out').textContent = Number($('foc-load').value).toFixed(2) + ' N\u00b7m';
  $('foc-err-out').textContent = (degrees > 0 ? '+' : '') + degrees + '\u00b0';
  $('foc-rate-out').textContent = Number($('foc-rate').value).toFixed(2) + '\u00d7';
  drawRotor(focPhase, peak, err); drawScope(focPhase, peak, iq, id, err, peakHeld);
  const kept = Math.cos(err), backEmf = (rpm * 2 * Math.PI / 60) * P.pole_pairs * P.flux_Wb;
  $('foc-numbers').innerHTML = (rotorFrame
    ? [['Iq, makes torque', iq.toFixed(2) + ' A'],
       ['Id, makes only heat', id.toFixed(2) + ' A'],
       ['Torque', (iq * P.Kt_NmPerA).toFixed(2) + ' N\u00b7m'],
       ['Torque kept', (100 * kept).toFixed(0) + ' %']]
    : [['Phase current peak', peak.toFixed(2) + ' A'],
       ['Electrical frequency', (rpm / 60 * P.pole_pairs).toFixed(1) + ' Hz'],
       ['Back-EMF to estimate from', backEmf.toFixed(2) + ' V'],
       ['Torque', (iq * P.Kt_NmPerA).toFixed(2) + ' N\u00b7m']]
  ).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  if (Math.abs(degrees) >= 1) angleMessage(degrees, kept, iq, id);
  hear(rpm, err, Math.abs(iq) + Math.abs(id));
  requestAnimationFrame(focFrame);
}

// What an angle error costs, in the operator's language.
function angleMessage(degrees, kept, iq, id) {
  const head = $('foc-headline'), body = $('foc-explain');
  if (Math.abs(degrees) >= 80) {
    head.textContent = 'Almost no torque left';
    head.className = 'verdict bad';
    body.textContent = `The current is pushed almost entirely into the magnets: ${id.toFixed(1)} A making heat and only ${iq.toFixed(2)} A making torque. Past 90 degrees the torque reverses and the drive loses control of the motor.`;
  } else if (Math.abs(degrees) >= 25) {
    head.textContent = `Losing ${(100 - 100 * kept).toFixed(0)} % of the torque`;
    head.className = 'verdict warn';
    body.textContent = `Being ${Math.abs(degrees)} degrees out means ${id.toFixed(1)} A is wasted as heat. To keep the same torque the drive must pull more current, which heats the motor further.`;
  } else {
    head.textContent = `Slightly out: ${(100 * kept).toFixed(0)} % of the torque kept`;
    head.className = 'verdict ok';
    body.textContent = `A small error costs little torque, because cos of a small angle is close to one. This is the region a working sensorless estimator has to stay inside.`;
  }
}

function setFrame(next) {
  rotorFrame = next;
  $('frame-toggle').textContent = next ? 'Stand still again' : 'Ride along with the rotor';
  $('foc-headline').textContent = next ? 'Two steady numbers' : 'Three changing currents';
  $('foc-explain').textContent = next
    ? 'Exactly the same currents, seen from the spinning rotor. Now they hold still, so an ordinary controller can keep Iq where it wants it and Id at zero.'
    : 'Press the button below to ride along with the rotor.';
  $('scope-title').textContent = next ? 'The same currents, seen from the rotor' : 'What the three winding currents look like';
  $('scope-caption').textContent = next
    ? 'Nothing about the motor changed. Only the point of view did, and the problem became easy.'
    : 'Three sine waves, endlessly changing. A controller cannot hold a steady value against a moving target like this.';
}

// ---- why field-oriented control, in four steps ---------------------------------
// Everyone gets the same four steps. The plain text carries the argument on its own,
// and presenter mode adds the technical line underneath rather than replacing it.
const STORY = [
  { tab: 'A motor is a push',
    head: 'A motor makes torque by pushing across the magnets',
    plain: 'Magnets ride on the spinning rotor. The controller makes a magnetic field in the windings that pushes them round. Push straight across the magnets and you get the most turning force for the current you spend.',
    tech: 'Torque is T = 1.5\u00b7p\u00b7\u03bb\u00b7Iq. Only the part of the stator current at right angles to the rotor flux does work; the part lined up with it does nothing useful.',
    err: null, frame: false },
  { tab: 'The wrong angle',
    head: 'Push at the wrong angle and most of it becomes heat',
    plain: 'If the controller believes the rotor is somewhere it is not, it pushes at the wrong angle. Some of the current still turns the motor. The rest is spent squeezing the magnets, which only makes heat. Sixty degrees out and half the torque is gone.',
    tech: 'Torque falls as cos \u03b5 while copper loss follows the total current, so holding a given torque needs current rising as 1/cos \u03b5 and dissipates as 1/cos\u00b2 \u03b5. Past 90\u00b0 the torque reverses and the drive loses control of the motor.',
    err: 60, frame: false },
  { tab: 'The trick',
    head: 'So the controller rides along with the rotor',
    plain: 'Seen from the wires, the currents are three sine waves that never sit still, and nothing can be held steady against them. Seen from the spinning rotor, the same currents become two steady numbers: one that makes torque, one that must be kept at zero. Nothing about the motor changed, only the point of view.',
    tech: 'The Clarke and Park transforms rotate the measured phase currents into the rotor frame to give Id and Iq. Two PI loops hold Id at zero and Iq at the torque demand, and the inverse Park transform maps the result back onto the three windings.',
    err: null, frame: true },
  { tab: 'Where the angle comes from',
    head: 'Which leaves one question: how do you know the angle?',
    plain: 'An encoder measures it directly. That is the sensored case, and it is the reference this investigation compares against. A sensorless drive estimates it instead, from the voltage the spinning magnets generate \u2014 and that voltage shrinks as the motor slows: about 11 V at 1500 rpm, but only 0.4 V at 50 rpm. That is why the comparison is measured as a map of speed and load.',
    tech: 'ODrive starts sensorless operation with an open-loop ramp and hands over to its estimator once there is enough back-EMF to work from. That handover is the fragile part, and it is where this project\u2019s sensorless simulation currently stands: no sensorless result exists yet, so anything shown for it here is illustrative.',
    err: null, frame: true },
];
let step = 0;

function buildStory() {
  $('why-steps').innerHTML = STORY.map((s, i) => `<button data-step="${i}">${i + 1} &middot; ${s.tab}</button>`).join('');
  for (const b of $('why-steps').querySelectorAll('button'))
    b.addEventListener('click', () => { touched(); showStep(Number(b.dataset.step)); });
}

function showStep(i) {
  step = Math.max(0, Math.min(STORY.length - 1, i));
  const s = STORY[step];
  $('why-head').textContent = s.head;
  $('why-text').textContent = s.plain;
  $('why-tech').textContent = s.tech;
  $('why-back').disabled = step === 0;
  $('why-next').disabled = step === STORY.length - 1;
  for (const b of $('why-steps').querySelectorAll('button'))
    b.classList.toggle('active', Number(b.dataset.step) === step);
  // The story drives the exhibit below it, so the picture always matches the words.
  $('foc-err').value = String(s.err === null ? sourceError() : s.err);
  setFrame(s.frame);
}

// ---- sensored or sensorless ----------------------------------------------------
let source = 'sensored';

// The error a sensorless estimator would carry at this speed. The sensorless
// model exists and has measured error, but only at one operating point, so the
// error-against-speed SHAPE used here is still illustrative rather than measured.
// See the Method and limits tab for what is measured and what is not.
function sourceError() {
  if (source !== 'sensorless') return 0;
  const rpm = Number($('foc-speed').value);
  return Math.round(Math.min(85, 2500 / Math.max(rpm, 25)));
}

function setSource(next) {
  source = next;
  const note = $('foc-source');
  if (next === 'sensorless') {
    note.className = 'source-note sensorless';
    note.innerHTML = '<b>Sensorless</b> \u2014 the angle is estimated from the back-EMF. The sensorless '
      + 'model exists and hands over without an encoder, but it has been measured at <b>one</b> operating '
      + 'point only, so how the error grows as the motor slows is still an <b>illustration</b>.';
  } else {
    note.className = 'source-note sensored';
    note.innerHTML = '<b>Sensored</b> \u2014 the encoder measures the angle directly, so the error is '
      + 'essentially zero. This is the reference the investigation compares against.';
  }
  $('foc-err').value = String(sourceError());
}

function chooseSource(next) {
  setSource(next);
  setTab('foc');
  showStep(0);
}

// ---- exhibit 3: what am I looking at? -------------------------------------------
const RIG_PARTS = {
  battery: ['One battery, two controllers',
    'A 26.5 V battery feeds both controllers on a shared bus. When the load motor brakes it acts as a generator, and that energy flows back into the battery rather than being burnt in a resistor. Its fully charged voltage and current ratings are still to be confirmed.'],
  odrive1: ['The controller under test',
    'An ODrive Pro running field-oriented control on the test motor, updating the current twenty thousand times a second. It holds the speed we ask for. This is the controller whose sensored and sensorless modes the investigation compares.'],
  odrive2: ['The controller that creates the load',
    'A second ODrive Pro running the load motor in torque control. Instead of holding a speed, it holds a pushing force against the test motor, which is how a load of exactly 0.5 or 2.0 newton-metres is applied on demand.'],
  motor1: ['The motor being studied',
    'A BM1109 permanent-magnet motor, nominally 1.2 kW. Everything the investigation measures is about this motor: how accurately it holds speed, how much current it draws, and how well its rotor position can be tracked with and without an encoder.'],
  motor2: ['The brake, which is also a motor',
    'An identical BM1109 used backwards, as a brake. It keeps its encoder in every test, so it also serves as an independent measurement of shaft speed: a second opinion the sensorless estimate can be checked against.'],
  chain: ['The mechanical link',
    'A chain over nominally equal sprockets ties the two shafts together, so whatever one motor does the other feels. The sprocket pitch is not yet determined, and chain slack matters: earlier simulation work showed backlash can multiply the peak torque in the chain several times over. Tension and alignment are a safety requirement, not a detail.'],
  encoder: ['How the controller knows where the rotor is',
    'The encoder reports rotor angle directly, which is what "sensored" means. Field-oriented control needs that angle to aim the current correctly. Its type, mounting and resolution are still to be confirmed for this rig.'],
  laptop: ['The operator, and the record',
    'A desktop machine connected to both controllers over USB, through isolators that stop the two boards forming a ground loop. It configures the drives, runs the test matrix and records the data. It never replaces the safety systems: it can ask the drives to stop, but it cannot brake the motors.'],
  estop: ['The stop that actually stops it',
    'A physical emergency stop, independent of any software. The software stop only removes the driving torque and lets the motors coast: it cannot brake them, and it cannot help if the computer has stopped responding. That is why the physical one exists.'],
};

function showPart(key) {
  const part = RIG_PARTS[key]; if (!part) return;
  $('d3-title').textContent = part[0];
  $('d3-text').textContent = part[1];
  for (const b of document.querySelectorAll('#partbar button')) b.classList.toggle('active', b.dataset.part === key);
  $('source-choice').hidden = !(key === 'motor1' || key === 'motor2');
  if (rig3d) { rigView = 'rig'; rig3d.setView('rig'); rig3d.highlight(key); }
}

// A row of buttons beside the 3D view: the parts are small on a screen, and a
// visitor should not have to hunt for the emergency stop to read about it.
function buildPartBar() {
  $('partbar').innerHTML = Object.entries(RIG_PARTS)
    .map(([k, v]) => `<button data-part="${k}">${PART_LABEL[k]}</button>`).join('');
  for (const b of document.querySelectorAll('#partbar button'))
    b.addEventListener('click', () => { touched(); showPart(b.dataset.part); });
}

const PART_LABEL = {
  battery: 'Battery', odrive1: 'Controller 1', odrive2: 'Controller 2', motor1: 'Test motor',
  motor2: 'Load motor', chain: 'Chain drive', encoder: 'Encoder', laptop: 'Computer', estop: 'Emergency stop',
};

// ---- the 3D view ---------------------------------------------------------------
// Loaded on demand: if the three.js file is missing the rest of the page still works.
let rig3d = null, rig3dFailed = false;
async function ensure3d() {
  if (rig3d || rig3dFailed) return rig3d;
  // Loading the module and building the scene fail for different reasons, and
  // saying the library is missing when the scene code threw sends you looking in
  // the wrong place. They are reported separately, with the real error.
  try {
    rig3d = await import('./rig3d.js?v=' + (window.__build || ''));
  } catch (err) {
    return fail3d('The 3D view could not load its library', err, true);
  }
  try {
    rig3d.init($('stage3d'));
    rig3d.setPickHandler(key => { touched(); showPart(key); });
    // the selection was made before the scene existed, so light it up now
    const active = document.querySelector('#partbar button.active');
    if (active) rig3d.highlight(active.dataset.part);
    update3d();
  } catch (err) {
    rig3d = null;
    return fail3d('The 3D view failed while building the scene', err, false);
  }
  return rig3d;
}

function fail3d(headline, err, libraryMissing) {
  rig3dFailed = true;
  console.error(headline, err);
  const message = (err && err.message) || String(err);
  const where = ((err && err.stack) || '').split(/\r?\n/).slice(1, 3)
    .map(line => line.trim()).filter(Boolean);
  const advice = libraryMissing
    ? 'Check that <code>vendor/three.module.js</code> is there, and that the page is being served over http rather than opened as a file.'
    : 'Everything else on this page still works. The full stack is in the browser console.';
  $('stage3d').innerHTML = `<div class="stage3d-error">
    <p class="err-head">${headline}</p>
    <p class="err-msg">${escapeHtml(message)}</p>
    ${where.map(line => `<p class="err-at">${escapeHtml(line)}</p>`).join('')}
    <p class="err-advice">${advice}</p>
  </div>`;
  return null;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function update3d() {
  if (!rig3d) return;
  const rpm = Number($('d3-speed').value), sensorless = $('d3-sensorless').checked;
  rig3d.setOptions({ rpm, sensorless });
  $('d3-speed-out').textContent = Math.round(rpm) + ' rpm';
  const r = rig3d.readout();
  const backEmf = (rpm * 2 * Math.PI / 60) * P.pole_pairs * P.flux_Wb;
  $('d3-numbers').innerHTML = [
    ['Where the controller aims', sensorless ? 'estimated' : 'measured by encoder'],
    ['Angle error', sensorless ? r.errorDeg.toFixed(0) + '\u00b0' : 'essentially none'],
    ['Torque kept', (100 * r.torqueKept).toFixed(0) + ' %'],
    ['Back-EMF to estimate from', backEmf.toFixed(2) + ' V'],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

// ---- exhibit 5: side by side, measured angle against estimated angle -------------
// Both sides are the same motor model under the same demand. Only the angle differs,
// and the angle error shape is illustrative: see the banner on the tab.
let sbsLast = 0, sbsSweep = null;

function sbsState() {
  const rpm = Number($('sbs-speed').value), torque = Number($('sbs-load').value);
  const o = operate(rpm, torque);
  const err = V_deg(Math.min(85, 2500 / Math.max(rpm, 25)));
  // To hold the same torque while pushing at the wrong angle, pull more current.
  const wanted = o.iq / Math.max(Math.cos(err), .05);
  const limited = wanted > P.iq_limit_A;
  const current = Math.min(wanted, P.iq_limit_A);
  const delivered = P.Kt_NmPerA * current * Math.cos(err) - P.B_Nms * o.w;
  return {
    rpm, torque, o, err,
    sensored: { err: 0, current: o.iq, loss: 1.5 * P.Rs_ohm * o.iq * o.iq, torque: torque, limited: o.overCurrent },
    sensorless: { err, current, loss: 1.5 * P.Rs_ohm * current * current, torque: Math.max(delivered, 0), limited },
    backEmf: (rpm * 2 * Math.PI / 60) * P.pole_pairs * P.flux_Wb,
  };
}
function V_deg(d) { return d * Math.PI / 180; }





function sbsFrame(now) {
  if ($('tab-sbs').hidden) { sbsLast = now; return requestAnimationFrame(sbsFrame); }
  const dt = Math.min((now - sbsLast) / 1000, .05); sbsLast = now;
  if (sbsSweep !== null) runScript(dt);
  const s = sbsState();
  $('sbs-speed-out').textContent = Math.round(s.rpm) + ' rpm';
  $('sbs-load-out').textContent = s.torque.toFixed(2) + ' N\u00b7m';
  const rate = Number($('sbs-rate').value);
  $('sbs-rate-out').textContent = String(rate) + '×';
  if (compare3d) compare3d.update({
    rpm: s.rpm, err: s.err,
    amplitude: Math.min(s.sensorless.current / Math.max(P.iq_limit_A * .6, 1), 1),
    limited: s.sensorless.limited,
    rate,
  });
  showHeat('sensored', s.sensored.loss);
  showHeat('sensorless', s.sensorless.loss);
  recordHistory(sbsHistory, s, compare3d ? compare3d.angle() : 0);
  drawGraphs('sbs-graphs', sbsHistory);
  const extra = s.sensorless.loss - s.sensored.loss;
  $('sbs-numbers').innerHTML = [
    ['Angle error', '0\u00b0 \u00b7 ' + Math.round(s.err * 180 / Math.PI) + '\u00b0'],
    ['Current for that torque', s.sensored.current.toFixed(1) + ' A \u00b7 ' + s.sensorless.current.toFixed(1) + ' A'],
    ['Heat in the windings', s.sensored.loss.toFixed(1) + ' W \u00b7 ' + s.sensorless.loss.toFixed(1) + ' W'],
    ['Torque actually delivered', s.sensored.torque.toFixed(2) + ' \u00b7 ' + s.sensorless.torque.toFixed(2) + ' N\u00b7m'],
    ['Back-EMF to estimate from', s.backEmf.toFixed(2) + ' V'],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  sbsVerdict(s, extra);
  hear(s.rpm, s.err, s.sensorless.current);
  requestAnimationFrame(sbsFrame);
}

// ---- the three graphs under the side-by-side animation --------------------------
// They plot the same vectors the 3D machines are showing, from the same angle,
// so a visitor can move between the picture and the trace and see one thing.
// Live from the model equations, not replayed from a simulation log.
const HISTORY = 260;
function makeHistory() {
  return { t: [], theta: [], err: [], kept: [], sensoredDq: [], sensorlessDq: [] };
}
const sbsHistory = makeHistory(), rigHistory = makeHistory();
let history = sbsHistory;              // whichever exhibit is being drawn

function recordHistory(hist, s, theta) {
  history = hist;
  const kept = Math.cos(s.err);
  history.t.push(performance.now() / 1000);
  history.theta.push(((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  history.err.push(s.err);
  history.kept.push(kept);
  // Where each drive's current vector sits in the rotor frame. The sensored one
  // is on the q axis by definition; the estimating one is pushed off it, and
  // everything to the side of the axis is current that only makes heat.
  history.sensoredDq.push([0, s.sensored.current]);
  history.sensorlessDq.push([s.sensorless.current * Math.sin(s.err),
                             s.sensorless.current * Math.cos(s.err)]);
  for (const key of Object.keys(history)) {
    while (history[key].length > HISTORY) history[key].shift();
  }
}

function graphFrame(g, x, y, w, h, title) {
  g.fillStyle = '#121923'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#212a36'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  g.fillStyle = '#6b7684'; g.font = '600 11.5px system-ui'; g.textAlign = 'left';
  g.fillText(title, x + 10, y + 17);
  return { L: x + 34, R: x + w - 10, T: y + 26, B: y + h - 18 };
}

function drawGraphs(canvasId, hist) {
  history = hist;
  const c = $(canvasId); if (!c) return;
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  // On the frame a hidden canvas is first shown, layout has not run yet, so the
  // canvas is reported far narrower than it will be. Three panels need room; if
  // there is not enough, the panel maths goes negative. Wait for the next frame.
  if (w < 330 || h < 70) return;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const gap = 10, pw = (w - gap * 2) / 3;
  drawAngleGraph(g, 0, 0, pw, h);
  drawDqGraph(g, pw + gap, 0, pw, h);
  drawErrorGraph(g, (pw + gap) * 2, 0, pw, h);
}

// 1. The angles themselves. Three sawtooths; the constant vertical gap between
//    the magnets and the field is the 90 degrees the controller is holding.
function drawAngleGraph(g, x, y, w, h) {
  const { L, R, T, B } = graphFrame(g, x, y, w, h, 'ANGLE OVER TIME   magnets, field, estimate');
  const n = history.theta.length;
  if (n < 2) return;
  gridLines(g, L, R, T, B, 4, 6);
  g.fillStyle = '#4a545f'; g.font = '10px system-ui'; g.textAlign = 'right';
  g.fillText('360', L - 5, T + 8); g.fillText('0', L - 5, B);

  const trace = (offset, colour, dash) => {
    g.strokeStyle = colour; g.lineWidth = 2; g.setLineDash(dash || []);
    g.beginPath();
    let last = null;
    for (let k = 0; k < n; k++) {
      const value = (((history.theta[k] + offset(k)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const px = L + (R - L) * k / (n - 1);
      const py = B - (B - T) * value / (2 * Math.PI);
      if (last === null || value < last - Math.PI) g.moveTo(px, py);   // wrapped: lift the pen
      else g.lineTo(px, py);
      last = value;
    }
    g.stroke(); g.setLineDash([]);
  };
  trace(() => 0, '#ef4444');                                  // magnets
  trace(() => Math.PI / 2, '#34d399');                        // field, encoder-fed
  trace(k => Math.PI / 2 + history.err[k], '#f0b429', [5, 4]); // field, estimate-fed
}

// 2. The current vector in the rotor frame: the FOC diagnostic. On the q axis is
//    torque; anything to the side of it is current that only makes heat.
function drawDqGraph(g, x, y, w, h) {
  const { L, R, T, B } = graphFrame(g, x, y, w, h, 'CURRENT VECTOR   Id across, Iq up');
  const cx = (L + R) / 2, cy = (T + B) / 2;
  const scale = Math.min((R - L) / 2, (B - T) / 2) / (P.iq_limit_A * 1.05);
  if (scale <= 0) return;                       // nothing sensible to draw into

  g.strokeStyle = '#1b2430'; g.lineWidth = 1;
  for (const amps of [10, 20]) {                               // current rings
    g.beginPath(); g.arc(cx, cy, amps * scale, 0, 7); g.stroke();
  }
  g.strokeStyle = '#ef4444'; g.globalAlpha = .5;
  g.beginPath(); g.arc(cx, cy, P.iq_limit_A * scale, 0, 7); g.stroke();
  g.globalAlpha = 1;
  g.strokeStyle = '#2b3646';
  g.beginPath(); g.moveTo(L, cy); g.lineTo(R, cy); g.moveTo(cx, T); g.lineTo(cx, B); g.stroke();
  g.fillStyle = '#4a545f'; g.font = '10px system-ui'; g.textAlign = 'left';
  g.fillText('Id', R - 16, cy - 5);
  g.fillText('Iq', cx + 5, T + 10);
  g.fillStyle = '#6b4a4a'; g.textAlign = 'right';
  g.fillText(P.iq_limit_A + ' A limit', R - 4, B - 2);

  const plot = (series, colour) => {
    const n = series.length; if (!n) return;
    g.strokeStyle = colour; g.lineWidth = 1.5; g.globalAlpha = .45;
    g.beginPath();
    series.forEach(([id, iq], k) => {
      const px = cx + id * scale, py = cy - iq * scale;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    });
    g.stroke(); g.globalAlpha = 1;
    const [id, iq] = series[n - 1];
    const px = cx + id * scale, py = cy - iq * scale;
    g.strokeStyle = colour; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(px, py); g.stroke();
    g.fillStyle = colour; g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill();
  };
  plot(history.sensoredDq, '#34d399');
  plot(history.sensorlessDq, '#f0b429');
}

// 3. What the angle error costs, as it happens.
function drawErrorGraph(g, x, y, w, h) {
  const { L, R, T, B } = graphFrame(g, x, y, w, h, 'ANGLE ERROR and TORQUE KEPT');
  const n = history.err.length;
  if (n < 2) return;
  gridLines(g, L, R, T, B, 4, 6);
  g.fillStyle = '#4a545f'; g.font = '10px system-ui'; g.textAlign = 'right';
  g.fillText('90\u00b0', L - 5, T + 8); g.fillText('0', L - 5, B);

  g.strokeStyle = '#f0b429'; g.lineWidth = 2; g.beginPath();
  history.err.forEach((e, k) => {
    const px = L + (R - L) * k / (n - 1);
    const py = B - (B - T) * Math.min(Math.abs(e) / (Math.PI / 2), 1);
    k ? g.lineTo(px, py) : g.moveTo(px, py);
  });
  g.stroke();

  g.strokeStyle = '#34d399'; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath();
  history.kept.forEach((kept, k) => {
    const px = L + (R - L) * k / (n - 1);
    const py = B - (B - T) * kept;
    k ? g.lineTo(px, py) : g.moveTo(px, py);
  });
  g.stroke(); g.setLineDash([]);

  const latest = history.err[n - 1] * 180 / Math.PI;
  g.fillStyle = '#f0b429'; g.font = '600 11px system-ui'; g.textAlign = 'left';
  g.fillText(latest.toFixed(0) + '\u00b0 out', L + 6, T + 12);
  g.fillStyle = '#34d399'; g.textAlign = 'right';
  g.fillText((100 * history.kept[n - 1]).toFixed(0) + ' % kept', R - 6, T + 12);
}

function gridLines(g, L, R, T, B, rows, cols) {
  g.strokeStyle = '#1b2430'; g.lineWidth = 1;
  for (let k = 1; k < rows; k++) {
    const gy = T + (B - T) * k / rows;
    g.beginPath(); g.moveTo(L, gy); g.lineTo(R, gy); g.stroke();
  }
  for (let k = 1; k < cols; k++) {
    const gx = L + (R - L) * k / cols;
    g.beginPath(); g.moveTo(gx, T); g.lineTo(gx, B); g.stroke();
  }
  g.strokeStyle = '#2b3646';
  g.strokeRect(L + .5, T + .5, R - L - 1, B - T - 1);
}

// A told sequence: both machines fine, then the speed falls and one of them
// comes apart. Every line is timed against the speed it describes, and the whole
// thing stops the moment anyone touches a control.
const FAILURE_SCRIPT = [
  { until: 1.2, rpm: 1400, line: 'Both machines, same speed, same load. At 1400 rpm you cannot tell them apart.' },
  { until: 3.0, rpm: 900, line: 'Still nothing to choose between them. The estimate has plenty of back-EMF to work from.' },
  { until: 5.2, rpm: 420, line: 'Slowing down. Watch the right-hand machine: its field is starting to lag behind the magnets.' },
  { until: 7.4, rpm: 180, line: 'The wrong coils are lighting now, and it is pulling more current to make the same torque.' },
  { until: 9.6, rpm: 70, line: 'Well out. Look at the heat bars: the same work, noticeably more heat in the windings.' },
  { until: 12.5, rpm: 35, line: 'At walking pace the magnets barely generate anything to estimate from, and the guess falls apart.' },
  { until: 15.0, rpm: 35, line: 'That is the whole investigation: not whether sensorless works, but where it stops working.' },
];
const SCRIPT_LENGTH = FAILURE_SCRIPT[FAILURE_SCRIPT.length - 1].until;
let scriptClock = 0;

function startScript() {
  scriptClock = 0;
  sbsSweep = 1;                                   // non-null means "running"
  $('sbs-sweep').textContent = 'Stop';
  $('sbs-script').hidden = false;
}

function stopScript() {
  sbsSweep = null;
  $('sbs-sweep').textContent = 'Watch it fail';
  $('sbs-script').hidden = true;
}

function runScript(dt) {
  scriptClock += dt;
  if (scriptClock >= SCRIPT_LENGTH) { stopScript(); return; }
  // Ease between the speed each step asks for, so the machines slow smoothly
  // rather than jumping from one line to the next.
  let from = FAILURE_SCRIPT[0].rpm, start = 0, step = FAILURE_SCRIPT[0];
  for (let k = 0; k < FAILURE_SCRIPT.length; k++) {
    if (scriptClock < FAILURE_SCRIPT[k].until) {
      step = FAILURE_SCRIPT[k];
      from = k ? FAILURE_SCRIPT[k - 1].rpm : FAILURE_SCRIPT[0].rpm;
      start = k ? FAILURE_SCRIPT[k - 1].until : 0;
      break;
    }
  }
  const span = Math.max(step.until - start, .001);
  const t = Math.min((scriptClock - start) / span, 1);
  const smooth = t * t * (3 - 2 * t);
  $('sbs-speed').value = String(Math.round(from + (step.rpm - from) * smooth));
  $('sbs-script').textContent = step.line;
  $('sbs-script').className = 'script-line' + (step.rpm <= 180 ? ' hot' : '');
}

function sbsVerdict(s, extra) {
  const head = $('sbs-title'), body = $('sbs-text'), deg = Math.round(s.err * 180 / Math.PI);
  if (s.sensorless.limited || deg >= 45) {
    head.textContent = 'The estimate has lost the rotor';
    head.className = 'verdict bad';
    body.textContent = `At ${Math.round(s.rpm)} rpm the magnets generate only ${s.backEmf.toFixed(2)} V for the estimator to work from, and it is ${deg} degrees out. `
      + (s.sensorless.limited
        ? 'The drive has run into its current limit, so it can no longer hold the torque at all and the shaft slows.'
        : `Holding the same torque now costs ${s.sensorless.current.toFixed(1)} A instead of ${s.sensored.current.toFixed(1)} A, and ${extra.toFixed(0)} W of extra heat.`);
  } else if (deg >= 12) {
    head.textContent = 'Still turning, but paying for it';
    head.className = 'verdict warn';
    body.textContent = `${deg} degrees out. Both motors deliver the torque asked of them, but the estimating drive needs ${s.sensorless.current.toFixed(1)} A against ${s.sensored.current.toFixed(1)} A, and puts ${extra.toFixed(1)} W more heat into the windings for exactly the same work.`;
  } else {
    head.textContent = 'Both are keeping up';
    head.className = 'verdict ok';
    body.textContent = `At ${Math.round(s.rpm)} rpm there is plenty of back-EMF (${s.backEmf.toFixed(1)} V) to estimate from, so the two are within ${deg} degree${deg === 1 ? '' : 's'} of each other and cost almost the same. This is the easy end of the range \u2014 drag the speed down.`;
  }
}

// The side-by-side machines are the same model as the exploded view, loaded on
// demand so the envelope and control tabs do not pay for three.js.
let compare3d = null, compare3dFailed = false;
async function ensureCompare3d() {
  if (compare3d || compare3dFailed) return compare3d;
  let module;
  try {
    module = await import('./compare3d.js?v=' + (window.__build || ''));
  } catch (err) {
    return failCompare('The comparison could not load its library', err, true);
  }
  try {
    module.init($('sbs-stage'));
    compare3d = module;
  } catch (err) {
    return failCompare('The comparison failed while building its scene', err, false);
  }
  return compare3d;
}

function failCompare(headline, err, libraryMissing) {
  compare3dFailed = true;
  console.error(headline, err);
  const where = ((err && err.stack) || '').split(/\r?\n/).slice(1, 3).map(l => l.trim()).filter(Boolean);
  const advice = libraryMissing
    ? 'Check that <code>vendor/three.module.js</code> is there, and that the page is served over http.'
    : 'Everything else on this page still works. The full stack is in the browser console.';
  $('sbs-stage').innerHTML = `<div class="stage3d-error">
    <p class="err-head">${headline}</p>
    <p class="err-msg">${escapeHtml((err && err.message) || String(err))}</p>
    ${where.map(l => `<p class="err-at">${escapeHtml(l)}</p>`).join('')}
    <p class="err-advice">${advice}</p>
  </div>`;
  return null;
}

// The heat bars moved out of the canvas into the page, so they stay readable
// whatever the 3D view is doing.
function showHeat(which, watts) {
  const full = 40;
  $('heat-' + which).style.width = Math.min(100 * watts / full, 100).toFixed(1) + '%';
  $('heat-' + which + '-text').textContent = watts.toFixed(1) + ' W';
}

// The exploded view gets the same three graphs. It has no load slider, so they
// are drawn at a stated 1.0 N m: enough to make the current vector meaningful.
const RIG_GRAPH_TORQUE = 1.0;
let rigView = 'rig';

function rigState() {
  const rpm = Number($('d3-speed').value);
  const o = operate(rpm, RIG_GRAPH_TORQUE);
  // Take the error straight from the 3D view, so the graph and the arrow in the
  // picture can never disagree: it already returns zero when the encoder is on.
  const err = V_deg(rig3d ? rig3d.readout().errorDeg : 0);
  const wanted = o.iq / Math.max(Math.cos(err), .05);
  return {
    rpm, err,
    sensored: { current: o.iq },
    sensorless: { current: Math.min(wanted, P.iq_limit_A) },
  };
}

function rigGraphFrame() {
  requestAnimationFrame(rigGraphFrame);
  const showing = !$('tab-3d').hidden && rigView === 'inside';
  $('rig-graphs').hidden = !showing;
  $('rig-graphs-note').hidden = !showing;
  if (!showing || !rig3d || !P) return;
  const s = rigState();
  recordHistory(rigHistory, s, rig3d.angle());
  drawGraphs('rig-graphs', rigHistory);
  hear(s.rpm, s.err, s.sensorless.current);
}

// ---- the answer this project is working towards ---------------------------------
// The grid the investigation will fill in. It is drawn empty on purpose: the
// sensored half is measured, no sensorless case is, and showing the shape of the
// finished result is the clearest way to say what the work is for.
let plannedDrawn = false;

function drawPlannedMap() {
  const c = $('planned-map'); if (!c) return;
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (w < 320 || h < 120) return;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const speeds = [...new Set(CASES.map(k => Math.round(k.rpm)))].sort((a, b) => a - b);
  const loads = [...new Set(CASES.map(k => k.load_Nm))].sort((a, b) => b - a);
  const L = 74, R = w - 210, T = 28, B = h - 36;
  const cw = (R - L) / speeds.length, ch = (B - T) / loads.length;

  for (let row = 0; row < loads.length; row++) {
    for (let col = 0; col < speeds.length; col++) {
      const x = L + col * cw, y = T + row * ch;
      g.fillStyle = '#121923';
      g.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      g.strokeStyle = '#2a3542'; g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeRect(x + 3.5, y + 3.5, cw - 7, ch - 7);
      g.setLineDash([]);
      g.fillStyle = '#39414d'; g.font = '13px system-ui'; g.textAlign = 'center';
      g.fillText('?', x + cw / 2, y + ch / 2 + 5);
    }
  }

  g.fillStyle = '#9aa5b1'; g.font = '12px system-ui';
  g.textAlign = 'center';
  speeds.forEach((rpm, col) => g.fillText(String(rpm), L + (col + .5) * cw, B + 18));
  g.fillText('speed, rpm', (L + R) / 2, h - 4);
  g.textAlign = 'right';
  loads.forEach((nm, row) => g.fillText(nm.toFixed(1), L - 10, T + (row + .5) * ch + 4));
  g.save();
  g.translate(16, (T + B) / 2); g.rotate(-Math.PI / 2);
  g.textAlign = 'center'; g.fillText('load, N\u00b7m', 0, 0);
  g.restore();

  // What the colours will mean once there is something to colour.
  const key = [
    ['#34d399', 'as good as the encoder'],
    ['#f0b429', 'works, but costs more current'],
    ['#ef4444', 'unstable, or will not start'],
    ['#39414d', 'not measured yet'],
  ];
  g.textAlign = 'left';
  g.font = '600 11.5px system-ui'; g.fillStyle = '#6b7684';
  g.fillText('EACH SQUARE WILL BE', R + 22, T + 4);
  key.forEach(([colour, label], k) => {
    const y = T + 24 + k * 24;
    g.fillStyle = colour; g.fillRect(R + 22, y - 9, 13, 13);
    g.fillStyle = '#9aa5b1'; g.font = '12.5px system-ui';
    g.fillText(label, R + 42, y + 2);
  });
  g.fillStyle = '#6b7684'; g.font = '11.5px system-ui';
  g.fillText('24 squares \u00b7 0 filled in', R + 22, T + 24 + key.length * 24 + 10);
}

// ---- exhibit 6: method, parameters and limits ------------------------------------
// Built from data/matrix.json so the parameter table cannot drift away from the
// parameters the simulation actually ran with.
let methodBuilt = false, DATA = null;

function renderMethod() {
  if (methodBuilt) return;
  methodBuilt = true;

  const ratedTorque = P.Kt_NmPerA * P.iq_limit_A;
  const rows = [
    ['Battery, nominal', P.vdc_V.toFixed(1) + ' V', 'Stated by the team; charged and cut-off voltages still unconfirmed'],
    ['Current limit', P.iq_limit_A.toFixed(0) + ' A',
      'Iq reference clamp in the speed controller: the most the drive will ever ask the windings to carry'],
    ['Torque constant Kt', P.Kt_NmPerA.toFixed(4) + ' N\u00b7m/A', 'Derived from a manufacturer test point, not measured here'],
    ['Pole pairs', String(P.pole_pairs), 'Electrical angle turns ' + P.pole_pairs + ' times per shaft revolution'],
    ['Magnet flux \u03bb', P.flux_Wb.toFixed(5) + ' Wb', 'Derived as (2/3)\u00b7Kt/p'],
    ['Stator resistance Rs', P.Rs_ohm.toFixed(3) + ' \u03a9', 'Provisional; sets the copper loss'],
    ['Inductance Ld, Lq', (P.Ld_H * 1e6).toFixed(0) + ', ' + (P.Lq_H * 1e6).toFixed(0) + ' \u00b5H', 'Equal, so no reluctance torque is modelled'],
    ['Inertia J', P.J_kgm2.toFixed(4) + ' kg\u00b7m\u00b2', 'Provisional; sets how fast speed can change'],
    ['Viscous friction B', P.B_Nms.toExponential(2) + ' N\u00b7m\u00b7s', 'The only loss in the mechanical model'],
    ['Voltage utilisation', (100 * P.voltage_utilisation).toFixed(0) + ' %', 'Headroom left below the modulation limit'],
    ['Torque at the limit', ratedTorque.toFixed(2) + ' N\u00b7m',
      'Kt \u00d7 current limit: the most this drive can ask for \u2014 the pull of a 2.7 kg weight on the end of a 10 cm spanner'],
    ['Back-EMF at 1500 rpm', (1500 * 2 * Math.PI / 60 * P.pole_pairs * P.flux_Wb).toFixed(1) + ' V',
      'Falls in proportion to speed, which is why sensorless fails slowly'],
  ];
  $('method-params').innerHTML = '<table class="ptable"><thead><tr><th>Quantity</th><th>Value</th>'
    + '<th>What it means here</th></tr></thead><tbody>'
    + rows.map(([a, b, c]) => `<tr><td>${a}</td><td><b>${b}</b></td><td>${c}</td></tr>`).join('')
    + '</tbody></table>';

  const speeds = [...new Set(CASES.map(c => Math.round(c.rpm)))].sort((a, b) => a - b);
  const loads = [...new Set(CASES.map(c => c.load_Nm))].sort((a, b) => a - b);
  $('method-runs').innerHTML = '<table class="ptable"><tbody>'
    + [['Sensored speed\u2013load matrix', CASES.length + ' cases, all completed'],
       ['Speeds tested', speeds.join(', ') + ' rpm'],
       ['Loads tested', loads.map(l => l.toFixed(1)).join(', ') + ' N\u00b7m'],
       ['Settling windows', 'unloaded 0.90\u20131.15 s, loaded 1.40\u20131.65 s'],
       ['Worst duty cycle seen', '0.896, at 1500 rpm and 2.0 N\u00b7m \u2014 no saturation anywhere'],
       ['Sensorless', 'one startup run, handover verified, closed-loop quality failed'],
       ['Sensored run', DATA.source.run + ' (' + DATA.source.date + ')'],
      ].map(([a, b]) => `<tr><td>${a}</td><td><b>${b}</b></td></tr>`).join('')
    + '</tbody></table>';

  // Measured on the v0.6 run, not modelled here: stated with their window so they
  // cannot be confused with the whole-run figures logged by the same model.
  $('method-sensorless').innerHTML = [
    ['Angle error, settled window', '67.44\u00b0 RMS'],
    ['Speed variation, settled', '207.42 rpm peak to peak'],
    ['Mean speed held', '276.87 rpm against 300 rpm asked'],
    ['Handover', '0.800 s to 1.050 s, no abort'],
    ['Peak current during startup', '5.29 A'],
    ['Encoder in the control path', 'none, at any point'],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

// ---- sound ---------------------------------------------------------------------
// Synthesised from the numbers the page already has, never a recording. Loaded
// only when someone asks for it, because a browser will not make a sound before
// a click anyway.
let sound = null;

async function toggleSound() {
  if (!sound) {
    try {
      sound = await import('./sound.js?v=' + (window.__build || ''));
    } catch (err) {
      console.error('sound failed to load', err);
      $('sound-label').textContent = 'Sound unavailable';
      return;
    }
  }
  const on = await sound.setEnabled(!sound.isEnabled());
  $('sound-label').textContent = on ? 'Sound on' : 'Sound off';
  $('sound-toggle').setAttribute('aria-pressed', String(on));
  $('sound-toggle').classList.toggle('on', on);
}

// Whichever exhibit is on screen feeds the sound: they all pause when hidden.
function hear(rpm, err, current) {
  if (!sound || !sound.isEnabled()) return;
  sound.setState({ rpm, err, current, limit: P ? P.iq_limit_A : 25 });
  sound.update();
}

// ---- tabs ----------------------------------------------------------------------
// Each tab says what it is. One fixed standfirst described the envelope while
// the page opened on the rig, which was the first thing a visitor read.
const STANDFIRST = {
  '3d': 'The rig that produces the measurements: two motors joined by a chain, each with its own controller. Tap any part to see what it does.',
  envelope: 'Choose a speed and a load. The green area is what the drive can deliver on the configured battery and current limit. White dots are full Simulink runs; the shading is the same physics solved live in this page.',
  foc: 'Why a motor controller has to know where the rotor is, and what it does with that angle once it has it.',
  sbs: 'The same motor twice, under the same load, differing only in where the rotor angle comes from.',
  method: 'What is modelled, what every parameter is, which results exist, and what this work does not yet show.',
};

function setTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const id of ['envelope', 'foc', '3d', 'sbs', 'method']) $('tab-' + id).hidden = name !== id;
  if (STANDFIRST[name]) $('standfirst').textContent = STANDFIRST[name];
  if (name === '3d') ensure3d();
  if (name === 'sbs') {
    ensureCompare3d();
    if (!plannedDrawn) { plannedDrawn = true; requestAnimationFrame(drawPlannedMap); }
  }
  if (name === 'envelope') render();
  if (name === 'method') renderMethod();
}

// ---- start --------------------------------------------------------------------
async function start() {
  const warning = document.getElementById('boot-warning');
  if (warning) warning.remove();            // the scripts clearly did run
  const data = await fetch('data/matrix.json').then(r => r.json());
  P = { ...data.parameters }; CASES = data.cases; DATA = data;
  $('provenance').textContent = `${data.source.cases} simulated cases from ${data.source.run} (${data.source.date}). ${data.source.note}`;
  for (const id of ['speed', 'load', 'vdc', 'imax']) {
    $(id).addEventListener('input', () => {
      P.vdc_V = Number($('vdc').value); P.iq_limit_A = Number($('imax').value);
      touched(); $('scenario').textContent = ''; render();
    });
  }
  $('reset').addEventListener('click', () => { touched(); reset(); });
  $('sound-toggle').addEventListener('click', () => { touched(); toggleSound(); });
  document.addEventListener('keydown', e => {
    touched();
    // Scenarios own the number keys. Tabs are letters, so pressing 3 on the
    // envelope runs the voltage-ceiling scenario instead of jumping away from it.
    if (SCENARIOS[e.key] && !$('tab-envelope').hidden) { scenario(e.key); return; }
    if (e.key === 'k') setMode(mode === 'kiosk' ? 'presenter' : 'kiosk');
    if (e.key === 'r') reset();
    if (e.key === 'e') setTab('envelope');
    if (e.key === 'f') setTab('foc');
    if (e.key === 'w') setTab('3d');
    if (e.key === 's') setTab('sbs');
    if (e.key === 'm') setTab('method');
  });
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => { touched(); if (!t.disabled) setTab(t.dataset.tab); });
  }
  $('frame-toggle').addEventListener('click', () => { touched(); setFrame(!rotorFrame); });
  requestAnimationFrame(rigGraphFrame);
  $('d3-rig').addEventListener('click', () => { touched(); rigView = 'rig'; rig3d && rig3d.setView('rig');
    rig3d && rig3d.highlight(null);
    for (const b of document.querySelectorAll('#partbar button')) b.classList.remove('active');
    $('d3-title').textContent = 'The rig';
    $('d3-text').textContent = 'Two motors joined by a chain, each driven by its own controller from one battery. The left motor is the one under test; the right one acts as the brake that loads it. Tap any part to see what it does.'; });
  $('d3-inside').addEventListener('click', () => { touched(); rigView = 'inside'; rig3d && rig3d.setView('inside');
    $('d3-title').textContent = 'Inside the test motor';
    $('d3-text').textContent = 'The motor is pulled apart: encoder, stator, rotor. Each coil lights by the current the controller is putting through it, so the lit pattern is the magnetic field the stator makes. Watch it stay 90 electrical degrees ahead of the red magnet arrow — that is the whole of field-oriented control, and it is only possible because the angle is known. One pole pair is drawn; the real motor has three, so one turn here is a third of a shaft turn.'; });
  for (const id of ['d3-speed', 'd3-sensorless']) $(id).addEventListener('input', () => { touched(); update3d(); });
  $('d3-in').addEventListener('click', () => { touched(); rig3d && rig3d.zoomBy(1 / 1.25); });
  $('d3-out').addEventListener('click', () => { touched(); rig3d && rig3d.zoomBy(1.25); });
  $('d3-reset').addEventListener('click', () => { touched(); rig3d && rig3d.resetView(); });
  setInterval(() => { if (!$('tab-3d').hidden) update3d(); }, 250);
  buildPartBar();
  buildStory();
  setSource('sensored');
  showStep(0);
  $('pick-sensored').addEventListener('click', () => { touched(); chooseSource('sensored'); });
  $('pick-sensorless').addEventListener('click', () => { touched(); chooseSource('sensorless'); });
  $('why-next').addEventListener('click', () => { touched(); showStep(step + 1); });
  $('why-back').addEventListener('click', () => { touched(); showStep(step - 1); });
  // In sensorless mode the error is a function of speed, so it must follow the slider.
  $('foc-speed').addEventListener('input', () => { if (source === 'sensorless') $('foc-err').value = String(sourceError()); });
  for (const id of ['foc-speed', 'foc-load', 'foc-rate', 'foc-err']) $(id).addEventListener('input', touched);
  $('foc-err').addEventListener('input', () => { if (Number($('foc-err').value) === 0) setFrame(rotorFrame); });
  setFrame(false);
  requestAnimationFrame(focFrame);
  requestAnimationFrame(sbsFrame);
  for (const id of ['sbs-speed', 'sbs-load'])
    $(id).addEventListener('input', () => { touched(); if (sbsSweep !== null) stopScript(); });
  $('sbs-rate').addEventListener('input', touched);
  $('sbs-in').addEventListener('click', () => { touched(); compare3d && compare3d.zoomBy(1 / 1.25); });
  $('sbs-out').addEventListener('click', () => { touched(); compare3d && compare3d.zoomBy(1.25); });
  $('sbs-reset-view').addEventListener('click', () => { touched(); compare3d && compare3d.resetView(); });
  $('sbs-sweep').addEventListener('click', () => {
    touched();
    if (sbsSweep === null) startScript(); else stopScript();
  });
  document.addEventListener('pointerdown', touched);
  window.addEventListener('resize', () => { render(); if (plannedDrawn) drawPlannedMap(); });
  const kiosk = new URLSearchParams(location.search).get('mode') === 'kiosk';
  setMode(kiosk ? 'kiosk' : 'presenter');
  // Unattended visitors need orientation before numbers, so the kiosk opens on the rig.
  setTab('3d');
  showPart('motor1');
  reset(); watchIdle(); touched();
}
start();
