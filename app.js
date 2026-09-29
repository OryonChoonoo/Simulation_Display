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
      reset();
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

function drawRotor(theta, peak, err) {
  const c = $('rotor'), g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.34;

  g.strokeStyle = '#2b3646'; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, r * 1.32, 0, 7); g.stroke();       // stator bore
  for (let k = 0; k < 3; k++) {                                    // winding axes
    const a = k * 2 * Math.PI / 3;
    g.strokeStyle = ['#34d399', '#f0b429', '#7aa2f7'][k]; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * 1.2, cy - Math.sin(a) * r * 1.2);
    g.lineTo(cx + Math.cos(a) * r * 1.32, cy - Math.sin(a) * r * 1.32);
    g.stroke();
    g.fillStyle = ['#34d399', '#f0b429', '#7aa2f7'][k];
    g.font = '13px system-ui'; g.textAlign = 'center';
    g.fillText('ABC'[k], cx + Math.cos(a) * r * 1.5, cy - Math.sin(a) * r * 1.5 + 4);
  }

  g.save(); g.translate(cx, cy); g.rotate(-theta);                 // rotor
  g.fillStyle = '#ef4444';
  g.beginPath(); g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); g.fill();
  g.fillStyle = '#5b6b7f';
  g.beginPath(); g.arc(0, 0, r, Math.PI / 2, 1.5 * Math.PI); g.fill();
  g.restore();
  // Pole labels drawn upright, so they stay readable as the rotor turns.
  g.fillStyle = '#fff'; g.font = 'bold 16px system-ui'; g.textAlign = 'center';
  g.fillText('N', cx + Math.cos(theta) * r * 0.55, cy - Math.sin(theta) * r * 0.55 + 5);
  g.fillText('S', cx - Math.cos(theta) * r * 0.55, cy + Math.sin(theta) * r * 0.55 + 5);

  const arrow = (angle, len, colour, label) => {
    const x = cx + Math.cos(angle) * len, y = cy - Math.sin(angle) * len;
    g.strokeStyle = colour; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke();
    g.fillStyle = colour; g.beginPath();
    g.arc(x, y, 6, 0, 7); g.fill();
    g.font = 'bold 13px system-ui'; g.textAlign = 'center';
    g.fillText(label, cx + Math.cos(angle) * (len + 20), cy - Math.sin(angle) * (len + 20) + 4);
  };
  arrow(theta, r * 0.95, '#ef4444', 'magnets (d)');
  if (peak > 0.05) {
    if (Math.abs(err) < 0.01) {
      arrow(theta + Math.PI / 2, r * 0.95, '#34d399', 'current (q)');
    } else {
      // Where the current actually points, versus where it should.
      g.setLineDash([6, 5]);
      arrow(theta + Math.PI / 2, r * 0.95, '#3f6b57', 'should be here');
      g.setLineDash([]);
      arrow(theta + Math.PI / 2 + err, r * 0.95, Math.abs(err) > Math.PI / 3 ? '#ef4444' : '#f0b429', 'current');
    }
  }
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

// ---- tabs ----------------------------------------------------------------------
function setTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  $('tab-envelope').hidden = name !== 'envelope';
  $('tab-foc').hidden = name !== 'foc';
  if (name === 'envelope') render();
}

// ---- start --------------------------------------------------------------------
async function start() {
  const data = await fetch('data/matrix.json').then(r => r.json());
  P = { ...data.parameters }; CASES = data.cases;
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
    if (e.key === 'k') setMode(mode === 'kiosk' ? 'presenter' : 'kiosk');
    if (e.key === 'r') reset();
    if (e.key === 'e') setTab('envelope');
    if (e.key === 'f') setTab('foc');
    if (SCENARIOS[e.key] && !$('tab-envelope').hidden) scenario(e.key);
  });
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => { touched(); if (!t.disabled) setTab(t.dataset.tab); });
  }
  $('frame-toggle').addEventListener('click', () => { touched(); setFrame(!rotorFrame); });
  for (const id of ['foc-speed', 'foc-load', 'foc-rate', 'foc-err']) $(id).addEventListener('input', touched);
  $('foc-err').addEventListener('input', () => { if (Number($('foc-err').value) === 0) setFrame(rotorFrame); });
  setFrame(false);
  requestAnimationFrame(focFrame);
  document.addEventListener('pointerdown', touched);
  window.addEventListener('resize', render);
  setMode(new URLSearchParams(location.search).get('mode') === 'kiosk' ? 'kiosk' : 'presenter');
  reset(); watchIdle(); touched();
}
start();
