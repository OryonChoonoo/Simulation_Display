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
  return { rpm, torque, o, peak, err, iq: o.iq * Math.cos(err), id: o.iq * Math.sin(err) };
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

function drawScope(theta, peak, iq, id) {
  const c = $('scope'), g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const L = 46, R = w - 12, T = 14, B = h - 26, mid = (T + B) / 2;
  const scale = (B - T) / 2 / Math.max(peak * 1.25, 1);
  g.strokeStyle = '#2b3646'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(L, mid); g.lineTo(R, mid); g.stroke();
  g.beginPath(); g.moveTo(L, T); g.lineTo(L, B); g.stroke();
  g.fillStyle = '#9aa5b1'; g.font = '12px system-ui'; g.textAlign = 'right';
  g.fillText('+' + Math.max(peak, 1).toFixed(1) + ' A', L - 6, T + 12);
  g.fillText('0', L - 6, mid + 4);
  g.fillText('-' + Math.max(peak, 1).toFixed(1) + ' A', L - 6, B);

  const CYCLES = 2, N = 260;
  const series = rotorFrame
    ? [{ colour: '#34d399', label: 'Iq  torque', value: () => iq },
       { colour: '#ef4444', label: 'Id  wasted', value: () => id }]
    : [0, 1, 2].map(k => ({
        colour: ['#34d399', '#f0b429', '#7aa2f7'][k], label: 'phase ' + 'ABC'[k],
        value: a => peak * Math.cos(a - k * 2 * Math.PI / 3 + Math.PI / 2),
      }));
  for (const s of series) {
    g.strokeStyle = s.colour; g.lineWidth = 2.5; g.beginPath();
    for (let i = 0; i <= N; i++) {
      const frac = i / N, a = theta - (1 - frac) * CYCLES * 2 * Math.PI;
      const x = L + frac * (R - L), y = mid - s.value(a) * scale;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    const yEnd = mid - s.value(theta) * scale;
    g.fillStyle = s.colour; g.beginPath(); g.arc(R - 1, yEnd, 4, 0, 7); g.fill();
    g.textAlign = 'right'; g.font = 'bold 12px system-ui';
    g.fillText(s.label, R - 8, yEnd - 10);
  }
  g.fillStyle = '#9aa5b1'; g.textAlign = 'center'; g.font = '12px system-ui';
  g.fillText(rotorFrame ? 'riding with the rotor' : 'standing still, watching the wires', (L + R) / 2, B + 18);
}

function focFrame(now) {
  if (document.getElementById('tab-foc').hidden) { focLast = now; return requestAnimationFrame(focFrame); }
  const { rpm, o, peak, err, iq, id } = focState();
  const dt = Math.min((now - focLast) / 1000, 0.05); focLast = now;
  focPhase += dt * (rpm * 2 * Math.PI / 60) * P.pole_pairs * Number($('foc-rate').value);
  const degrees = Math.round(err * 180 / Math.PI);
  $('foc-speed-out').textContent = Math.round(rpm) + ' rpm';
  $('foc-load-out').textContent = Number($('foc-load').value).toFixed(2) + ' N\u00b7m';
  $('foc-err-out').textContent = (degrees > 0 ? '+' : '') + degrees + '\u00b0';
  $('foc-rate-out').textContent = Number($('foc-rate').value).toFixed(2) + '\u00d7';
  drawRotor(focPhase, peak, err); drawScope(focPhase, peak, iq, id);
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
  if (rig3d) { rig3d.setView('rig'); rig3d.highlight(key); }
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
  try {
    rig3d = await import('./rig3d.js');
    rig3d.init($('stage3d'));
    rig3d.setPickHandler(key => { touched(); showPart(key); });
    // the selection was made before the scene existed, so light it up now
    const active = document.querySelector('#partbar button.active');
    if (active) rig3d.highlight(active.dataset.part);
    update3d();
  } catch (err) {
    rig3dFailed = true;
    $('stage3d').innerHTML = '<p class="explain" style="padding:24px">The 3D view needs <code>vendor/three.module.js</code>, which is not in this copy. Everything else on the page works without it.</p>';
  }
  return rig3d;
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
let sbsPhase = 0, sbsLast = 0, sbsSweep = null;

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

function drawSbs(theta, s) {
  const c = $('sbs'), g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  panel(g, w / 4, h, theta, s.sensored, 'Encoder', 'measured', '#34d399', s);
  g.strokeStyle = '#26303c'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(w / 2, 20); g.lineTo(w / 2, h - 20); g.stroke();
  panel(g, 3 * w / 4, h, theta, s.sensorless, 'Estimate', 'worked out from the back-EMF', '#f0b429', s);
}

function panel(g, cx, h, theta, side, name, sub, colour, s) {
  const r = Math.min(h * .17, 80), cy = h * .44;
  g.fillStyle = '#e8eaed'; g.font = 'bold 17px system-ui'; g.textAlign = 'center';
  g.fillText(name, cx, 26);
  g.fillStyle = '#9aa5b1'; g.font = '13px system-ui';
  g.fillText(sub, cx, 45);

  const halfPanel = g.canvas.clientWidth / 4;
  drawMachine(g, cx, cy, r, { theta, err: side.err, peak: Math.max(side.current, 0.06),
    bounds: [cx - halfPanel + 8, cx + halfPanel - 8] });

  // A heat bar: visitors understand "it gets hot" faster than "efficiency falls".
  const bw = Math.min(210, r * 2.4), bx = cx - bw / 2, by = cy + r * 2.2;
  const full = 40, frac = Math.min(side.loss / full, 1);
  g.fillStyle = '#121820'; roundRect(g, bx, by, bw, 15, 7); g.fill();
  const bar = g.createLinearGradient(bx, 0, bx + bw, 0);
  bar.addColorStop(0, '#34d399'); bar.addColorStop(0.55, '#f0b429'); bar.addColorStop(1, '#ef4444');
  g.save(); roundRect(g, bx, by, Math.max(bw * frac, 6), 15, 7); g.clip();
  g.fillStyle = bar; g.fillRect(bx, by, bw, 15); g.restore();
  g.strokeStyle = '#33404f'; g.lineWidth = 1; roundRect(g, bx, by, bw, 15, 7); g.stroke();
  g.fillStyle = '#cfd6df'; g.font = '13px system-ui'; g.textAlign = 'center';
  g.fillText(`${side.loss.toFixed(1)} W of heat in the windings`, cx, by + 34);
  g.fillStyle = '#9aa5b1'; g.font = '12.5px system-ui';
  g.fillText(`${side.current.toFixed(1)} A drawn \u00b7 ${aimText(side.err)}`, cx, by + 54);
  if (side.limited) {
    g.fillStyle = '#ef4444'; g.font = 'bold 14px system-ui';
    g.fillText('at the current limit \u2014 cannot hold the torque', cx, by + 76);
  }
}

function aimText(err) {
  const d = Math.round(Math.abs(err) * 180 / Math.PI);
  return d === 0 ? 'pushing on target' : 'pushing ' + d + '\u00b0 off';
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function sbsFrame(now) {
  if ($('tab-sbs').hidden) { sbsLast = now; return requestAnimationFrame(sbsFrame); }
  const dt = Math.min((now - sbsLast) / 1000, .05); sbsLast = now;
  if (sbsSweep !== null) {                                 // the money shot: speed falling
    sbsSweep -= dt;
    const t = Math.max(sbsSweep, 0) / 9;
    $('sbs-speed').value = String(Math.round(30 + (1600 - 30) * t));
    if (sbsSweep <= 0) { sbsSweep = null; $('sbs-sweep').textContent = 'Run the speed down'; }
  }
  const s = sbsState();
  sbsPhase += dt * (s.rpm * 2 * Math.PI / 60) * P.pole_pairs * .08;
  $('sbs-speed-out').textContent = Math.round(s.rpm) + ' rpm';
  $('sbs-load-out').textContent = s.torque.toFixed(2) + ' N\u00b7m';
  drawSbs(sbsPhase, s);
  const extra = s.sensorless.loss - s.sensored.loss;
  $('sbs-numbers').innerHTML = [
    ['Angle error', '0\u00b0 \u00b7 ' + Math.round(s.err * 180 / Math.PI) + '\u00b0'],
    ['Current for that torque', s.sensored.current.toFixed(1) + ' A \u00b7 ' + s.sensorless.current.toFixed(1) + ' A'],
    ['Heat in the windings', s.sensored.loss.toFixed(1) + ' W \u00b7 ' + s.sensorless.loss.toFixed(1) + ' W'],
    ['Torque actually delivered', s.sensored.torque.toFixed(2) + ' \u00b7 ' + s.sensorless.torque.toFixed(2) + ' N\u00b7m'],
    ['Back-EMF to estimate from', s.backEmf.toFixed(2) + ' V'],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  sbsVerdict(s, extra);
  requestAnimationFrame(sbsFrame);
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
    ['Current limit', P.iq_limit_A.toFixed(0) + ' A', 'Iq reference clamp in the speed controller'],
    ['Torque constant Kt', P.Kt_NmPerA.toFixed(4) + ' N\u00b7m/A', 'Derived from a manufacturer test point, not measured here'],
    ['Pole pairs', String(P.pole_pairs), 'Electrical angle turns ' + P.pole_pairs + ' times per shaft revolution'],
    ['Magnet flux \u03bb', P.flux_Wb.toFixed(5) + ' Wb', 'Derived as (2/3)\u00b7Kt/p'],
    ['Stator resistance Rs', P.Rs_ohm.toFixed(3) + ' \u03a9', 'Provisional; sets the copper loss'],
    ['Inductance Ld, Lq', (P.Ld_H * 1e6).toFixed(0) + ', ' + (P.Lq_H * 1e6).toFixed(0) + ' \u00b5H', 'Equal, so no reluctance torque is modelled'],
    ['Inertia J', P.J_kgm2.toFixed(4) + ' kg\u00b7m\u00b2', 'Provisional; sets how fast speed can change'],
    ['Viscous friction B', P.B_Nms.toExponential(2) + ' N\u00b7m\u00b7s', 'The only loss in the mechanical model'],
    ['Voltage utilisation', (100 * P.voltage_utilisation).toFixed(0) + ' %', 'Headroom left below the modulation limit'],
    ['Torque at the limit', ratedTorque.toFixed(2) + ' N\u00b7m', 'Kt \u00d7 current limit: the most this drive can ask for'],
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
  $('d3-rig').addEventListener('click', () => { touched(); rig3d && rig3d.setView('rig');
    rig3d && rig3d.highlight(null);
    for (const b of document.querySelectorAll('#partbar button')) b.classList.remove('active');
    $('d3-title').textContent = 'The rig';
    $('d3-text').textContent = 'Two motors joined by a chain, each driven by its own controller from one battery. The left motor is the one under test; the right one acts as the brake that loads it. Tap any part to see what it does.'; });
  $('d3-inside').addEventListener('click', () => { touched(); rig3d && rig3d.setView('inside');
    $('d3-title').textContent = 'Inside the test motor';
    $('d3-text').textContent = 'The housing is hidden. The rotor magnets spin, and the green arrow is the current the controller pushes into the windings: it has to stay at right angles to the magnets to make torque. That is field-oriented control, and it needs the rotor angle.'; });
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
  for (const id of ['sbs-speed', 'sbs-load']) $(id).addEventListener('input', () => { touched(); sbsSweep = null; $('sbs-sweep').textContent = 'Run the speed down'; });
  $('sbs-sweep').addEventListener('click', () => {
    touched();
    sbsSweep = sbsSweep === null ? 9 : null;
    $('sbs-sweep').textContent = sbsSweep === null ? 'Run the speed down' : 'Stop';
  });
  document.addEventListener('pointerdown', touched);
  window.addEventListener('resize', render);
  const kiosk = new URLSearchParams(location.search).get('mode') === 'kiosk';
  setMode(kiosk ? 'kiosk' : 'presenter');
  // Unattended visitors need orientation before numbers, so the kiosk opens on the rig.
  setTab('3d');
  showPart('motor1');
  reset(); watchIdle(); touched();
}
start();
