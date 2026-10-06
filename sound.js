/* The sound of the motor, synthesised from the numbers on screen.

   This is NOT a recording of the rig. Nothing has been measured acoustically.
   What it does is turn quantities the page already computes into something you
   can hear, so a visitor can listen to a motor speed up instead of reading a
   number change:

     - the pitch follows the electrical frequency, rpm/60 x 3 pole pairs, lifted
       into the audible range by playing its sixth and twelfth harmonics, which is
       roughly where a real machine of this kind sings;
     - a low rumble follows shaft speed;
     - a breath of filtered noise stands in for windage and bearings;
     - loudness follows current, so a loaded motor is louder than a free one;
     - when the rotor angle is wrong, the tone is deliberately roughened. That
       roughness is a cue for the ear, not a measured effect.

   Browsers refuse to make sound until someone clicks something, so nothing is
   created until the listener asks for it. */

let ctx = null, master = null, parts = null, enabled = false;
let state = { rpm: 0, err: 0, current: 0, limit: 25 };

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // Two saw partials for the whine, one sine for the shaft rumble.
  const voice = (type, gain) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g); g.connect(master);
    osc.start();
    return { osc, g };
  };
  const whine = voice('sawtooth', .10);
  const whine2 = voice('sawtooth', .05);
  const rumble = voice('sine', .22);

  // Windage: noise, filtered so it hisses rather than roars.
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer; noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = .7;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = .0;
  noise.connect(band); band.connect(noiseGain); noiseGain.connect(master);
  noise.start();

  // A tremolo that only appears when the angle is wrong: the ear hears "rough"
  // long before it reads "43 % of the torque lost".
  const wobble = ctx.createOscillator();
  wobble.type = 'sine'; wobble.frequency.value = 7;
  const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 0;
  wobble.connect(wobbleDepth); wobbleDepth.connect(master.gain);
  wobble.start();

  parts = { whine, whine2, rumble, noiseGain, wobble, wobbleDepth, band };
}

export function setState(next) { Object.assign(state, next); }

export function isEnabled() { return enabled; }

export async function setEnabled(on) {
  enabled = on;
  if (!on) {
    if (master) master.gain.setTargetAtTime(0, ctx.currentTime, .08);
    return false;
  }
  if (!ctx) build();
  if (ctx.state === 'suspended') await ctx.resume();
  return true;
}

// Called every frame by whichever exhibit is on screen.
export function update() {
  if (!enabled || !ctx || !parts) return;
  const now = ctx.currentTime, ease = .09;
  const rpm = Math.max(state.rpm, 0);
  const mechanical = rpm / 60;                       // shaft revolutions a second
  const electrical = mechanical * 3;                 // three pole pairs
  const moving = rpm > 8;

  // The sixth and twelfth harmonics of the electrical frequency sit in the range
  // an ear is good at, and rise and fall with speed the way a motor does.
  parts.whine.osc.frequency.setTargetAtTime(clamp(electrical * 6, 30, 3800), now, ease);
  parts.whine2.osc.frequency.setTargetAtTime(clamp(electrical * 12, 40, 7000), now, ease);
  parts.rumble.osc.frequency.setTargetAtTime(clamp(mechanical * 2, 20, 220), now, ease);

  const load = clamp(state.current / Math.max(state.limit, 1), 0, 1);
  const level = moving ? clamp(.05 + .22 * clamp(rpm / 1500, 0, 1) + .12 * load, 0, .40) : 0;
  master.gain.setTargetAtTime(level, now, ease);
  parts.noiseGain.gain.setTargetAtTime(moving ? .02 + .05 * clamp(rpm / 2000, 0, 1) : 0, now, ease);
  parts.band.frequency.setTargetAtTime(clamp(500 + rpm * .8, 300, 5000), now, ease);

  // Roughness in proportion to how far out the angle is.
  const wrong = clamp(Math.abs(state.err) / (Math.PI / 2), 0, 1);
  parts.wobble.frequency.setTargetAtTime(6 + 10 * wrong, now, ease);
  parts.wobbleDepth.gain.setTargetAtTime(level * wrong * .8, now, ease);
}
