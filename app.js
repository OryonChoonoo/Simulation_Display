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
    if (SCENARIOS[e.key]) scenario(e.key);
  });
  document.addEventListener('pointerdown', touched);
  window.addEventListener('resize', render);
  setMode(new URLSearchParams(location.search).get('mode') === 'kiosk' ? 'kiosk' : 'presenter');
  reset(); watchIdle(); touched();
}
start();
