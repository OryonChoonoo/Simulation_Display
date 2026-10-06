/* The sound of the motor, synthesised from the numbers on screen.

   This is NOT a recording of the rig. Nothing has been measured acoustically.
   What it does is turn quantities the page already computes into something you
   can hear, so a visitor can listen to a motor speed up instead of reading a
   number change.

   How it is put together, and why it sounds like a machine rather than a test
   tone: a real motor is mostly low. The body of the sound is a growl an octave
   or so above shaft speed, with a quieter whine on the electrical frequency
   above it, and air noise above that. Everything goes through one lazy low-pass
   so nothing up at the top of the range survives to become piercing, and the two
   growl oscillators are slightly detuned against each other, which is what makes
   a sound feel like an object rather than a synthesiser.

     - the growl follows the electrical frequency, rpm/60 x 3 pole pairs, doubled;
     - the whine sits on its sixth harmonic, filtered and quiet;
     - a rumble follows shaft speed;
     - low-passed noise stands in for windage and bearings;
     - loudness follows current, so a loaded motor is louder than a free one;
     - when the rotor angle is wrong the sound is roughened. That roughness is a
       cue for the ear, not a measured effect.

   Browsers refuse to make sound until someone clicks something, so nothing is
   created until the listener asks for it. */

let ctx = null, master = null, parts = null, enabled = false;
let state = { rpm: 0, err: 0, current: 0, limit: 25 };

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // One master low-pass over everything. A motor heard across a room has almost
  // nothing above a couple of kilohertz, and this is what keeps the whole thing
  // from turning into a whistle.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 800;
  tone.Q.value = .4;

  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(tone);
  tone.connect(ctx.destination);

  const voice = (type, gain) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g); g.connect(master);
    osc.start();
    return { osc, g };
  };

  // Two triangles a few cents apart: the beating between them is most of what
  // makes this read as a physical thing turning rather than a tone generator.
  const growl = voice('triangle', .20);
  const growlB = voice('triangle', .14);
  growlB.osc.detune.value = 7;
  // The whine, quiet and under its own filter so it stays a hint, not a scream.
  const whineFilter = ctx.createBiquadFilter();
  whineFilter.type = 'lowpass'; whineFilter.frequency.value = 1100; whineFilter.Q.value = .6;
  const whineOsc = ctx.createOscillator(); whineOsc.type = 'sawtooth';
  const whineGain = ctx.createGain(); whineGain.gain.value = .035;
  whineOsc.connect(whineFilter); whineFilter.connect(whineGain); whineGain.connect(master);
  whineOsc.start();
  const whine = { osc: whineOsc, g: whineGain, filter: whineFilter };

  const rumble = voice('sine', .34);

  // Windage: noise, kept low and dull rather than hissy.
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // A one-pole smoothing of white noise: brown-ish, which is what moving air
    // actually sounds like. Raw white noise hisses like a radio.
    last = (last + (Math.random() * 2 - 1) * .12) * .96;
    data[i] = last;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer; noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'lowpass'; band.frequency.value = 700; band.Q.value = .5;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
  noise.connect(band); band.connect(noiseGain); noiseGain.connect(master);
  noise.start();

  // A slow wobble that only appears when the angle is wrong: the ear hears
  // "rough" long before it reads "43 % of the torque lost".
  const wobble = ctx.createOscillator();
  wobble.type = 'sine'; wobble.frequency.value = 5;
  const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 0;
  wobble.connect(wobbleDepth); wobbleDepth.connect(master.gain);
  wobble.start();

  parts = { growl, growlB, whine, rumble, noiseGain, band, wobble, wobbleDepth, tone };
}

export function setState(next) { Object.assign(state, next); }

export function isEnabled() { return enabled; }

export async function setEnabled(on) {
  enabled = on;
  if (!on) {
    if (master) master.gain.setTargetAtTime(0, ctx.currentTime, .12);
    return false;
  }
  if (!ctx) build();
  if (ctx.state === 'suspended') await ctx.resume();
  return true;
}

// Called every frame by whichever exhibit is on screen.
export function update() {
  if (!enabled || !ctx || !parts) return;
  const now = ctx.currentTime, ease = .12;
  const rpm = Math.max(state.rpm, 0);
  const mechanical = rpm / 60;                       // shaft revolutions a second
  const electrical = mechanical * 3;                 // three pole pairs
  const moving = rpm > 8;

  // An octave lower than the obvious choice. The electrical frequency itself,
  // not twice it, is the body of the sound: at 1500 rpm that is 75 Hz, which is
  // where a machine of this size actually sits rather than where a tone is easy
  // to synthesise.
  const growlHz = clamp(electrical, 30, 260);
  parts.growl.osc.frequency.setTargetAtTime(growlHz, now, ease);
  parts.growlB.osc.frequency.setTargetAtTime(growlHz, now, ease);
  parts.whine.osc.frequency.setTargetAtTime(clamp(electrical * 4, 60, 800), now, ease);
  parts.whine.filter.frequency.setTargetAtTime(clamp(electrical * 7, 160, 1000), now, ease);
  parts.rumble.osc.frequency.setTargetAtTime(clamp(mechanical, 14, 90), now, ease);

  // The tone opens up a little with speed, the way a machine brightens as it
  // winds up, but the ceiling is low enough that it can never become shrill.
  parts.tone.frequency.setTargetAtTime(clamp(380 + rpm * .32, 380, 1200), now, ease);

  const load = clamp(state.current / Math.max(state.limit, 1), 0, 1);
  const level = moving ? clamp(.04 + .13 * clamp(rpm / 1500, 0, 1) + .07 * load, 0, .24) : 0;
  master.gain.setTargetAtTime(level, now, ease);
  parts.noiseGain.gain.setTargetAtTime(moving ? .05 + .10 * clamp(rpm / 2000, 0, 1) : 0, now, ease);
  parts.band.frequency.setTargetAtTime(clamp(220 + rpm * .20, 220, 700), now, ease);
  parts.whine.g.gain.setTargetAtTime(moving ? .012 + .020 * clamp(rpm / 1800, 0, 1) : 0, now, ease);

  // Roughness in proportion to how far out the angle is.
  const wrong = clamp(Math.abs(state.err) / (Math.PI / 2), 0, 1);
  parts.wobble.frequency.setTargetAtTime(4 + 7 * wrong, now, ease);
  parts.wobbleDepth.gain.setTargetAtTime(level * wrong * .55, now, ease);
}
