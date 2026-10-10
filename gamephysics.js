/* The game's motor: a deliberately simple rotor you can actually push around.

   This is NOT the BM1109 and it is not the Simulink model. It is a teaching
   motor whose numbers were chosen so that a human finger is the limiting factor,
   which is the whole point of the game. Torque follows the sine of the angle
   between the stator field and the rotor's magnetic axis:

       T = Tmax * sin(delta)          delta = field angle - rotor angle

   so +90 degrees pulls hardest, 0 does nothing, and -90 brakes just as hard as
   +90 drives. Nothing clamps the torque positive: aim badly and you really do
   slow the rotor down, stop it, and drive it backwards. That is the lesson.

       J * domega/dt = T - B*omega - Tc*sign(omega)

   Everything is integrated against elapsed time with a bounded substep, so the
   same run behaves the same on a 60 Hz phone, a 120 Hz phone, and a laptop that
   drops frames while the browser does something else. */

// ---------------------------------------------------------------------------
// Tuning. These are the only numbers worth changing to alter how it feels.
// ---------------------------------------------------------------------------
export const PHYSICS = {
  // Rotor inertia, kg.m^2 in game units. Higher = heavier, slower to get going,
  // more forgiving of a bad moment because it coasts through it. Lower = darts
  // away from you and is much harder to hold.
  rotorInertia: 0.040,

  // Peak torque at 90 degrees, N.m in game units. Higher = accelerates faster
  // and reaches a higher top speed, so the game gets hard sooner.
  maxTorque: 1.00,

  // Viscous drag, N.m.s/rad. This alone sets the top speed a perfect player
  // could ever reach: terminalRpm = maxTorque / viscousFriction, in rad/s.
  // Higher = lower ceiling and the rotor bleeds speed faster when you lose it.
  viscousFriction: 0.0159,          // -> about 600 rpm terminal

  // Dry friction, N.m. Stops the rotor creeping forever at a crawl. Higher =
  // harder to get moving from rest and it stops sooner once you give up.
  coulombFriction: 0.035,

  // Multiplies simulated time. Below 1 the whole game runs in slow motion,
  // which makes it easier. Left at 1 the picture is the simulation.
  simulationTimeScale: 1.0,

  // Largest integration step, seconds. A long browser stall is split into
  // pieces this size so the integrator cannot be thrown by one late frame.
  maxSubStep: 1 / 240,

  startRpm: 0,                      // the rotor begins at rest
  maxDisplayRpm: 700,               // full scale on the dial, not a limit
  runSeconds: 30,                   // a run is this long, then the score stands
  countdownSeconds: 3,              // 3, 2, 1 before control is handed over

  // Sensorless round. The estimate is only as good as the back-EMF, which is
  // proportional to speed, so it degrades as the rotor slows and gives up
  // entirely below the threshold. Illustrative, not the project's estimator.
  estimatorMinRpm: 60,              // below this there is no usable estimate
  estimatorNoiseDeg: 7,             // error at the threshold speed
  estimatorLagSeconds: 0.020,       // fixed delay, the same shape as the real one
};

export const TWO_PI = Math.PI * 2;

/** Wrap to (-pi, pi]. Crossing zero must not jump. */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function rpmOf(omega) { return omega * 60 / TWO_PI; }
export function omegaOf(rpm) { return rpm * TWO_PI / 60; }

/** Electromagnetic torque for a given field-to-rotor angle. */
export function torqueFor(delta, cfg = PHYSICS) {
  return cfg.maxTorque * Math.sin(wrapAngle(delta));
}

export function newRotor(cfg = PHYSICS) {
  return { angle: 0, omega: omegaOf(cfg.startRpm), torque: 0, delta: 0 };
}

/* One frame of integration.

   The field is swept from where the player was pointing last frame to where
   they are pointing now, rather than being held at the new angle for the whole
   frame. Without that, a phone running at 30 Hz holds a stale field for 33 ms
   while the rotor turns underneath it and gets measurably less torque than a
   120 Hz phone from the identical finger movement — which would quietly make
   the leaderboard a hardware contest. */
export function stepRotor(rotor, fieldAngle, dt, cfg = PHYSICS, fieldFrom = null) {
  const total = Math.max(0, dt) * cfg.simulationTimeScale;
  const steps = Math.max(1, Math.ceil(total / cfg.maxSubStep));
  const h = total / steps;
  const start = fieldFrom === null ? fieldAngle : fieldFrom;
  const sweep = wrapAngle(fieldAngle - start);      // shortest way round
  for (let i = 0; i < steps; i++) {
    const field = start + sweep * ((i + 0.5) / steps);
    const delta = wrapAngle(field - rotor.angle);
    const torque = torqueFor(delta, cfg);
    const viscous = cfg.viscousFriction * rotor.omega;
    // Dry friction opposes motion but must never reverse it inside one step,
    // or the rotor buzzes about zero instead of stopping.
    const moving = Math.abs(rotor.omega) > 1e-6;
    const dry = moving ? cfg.coulombFriction * Math.sign(rotor.omega) : 0;
    let omega = rotor.omega + h * (torque - viscous - dry) / cfg.rotorInertia;
    if (moving && Math.sign(omega) !== Math.sign(rotor.omega)
        && Math.abs(torque) <= cfg.coulombFriction) {
      omega = 0;                    // dry friction brought it to a stop
    }
    rotor.omega = omega;
    rotor.angle = (rotor.angle + omega * h) % TWO_PI;
    if (rotor.angle < 0) rotor.angle += TWO_PI;
    rotor.torque = torque;
    rotor.delta = delta;
  }
  return rotor;
}

/* The sensorless round's rotor-angle estimate.

   Back-EMF is proportional to speed, so an estimator built on it gets worse as
   the motor slows and has nothing at all to work with near standstill. That is
   the actual finding this investigation is about, reduced to something you can
   feel with a finger. The numbers here are chosen to be playable, not to model
   any particular estimator. */
export function estimateAngle(trueAngle, omega, cfg = PHYSICS) {
  const rpm = Math.abs(rpmOf(omega));
  if (rpm < cfg.estimatorMinRpm) return { angle: null, valid: false, errorDeg: Infinity };
  // Error shrinks as speed rises, plus a fixed delay that grows with speed:
  // the same two effects the simulation found, pulling in opposite directions.
  const noise = (cfg.estimatorNoiseDeg * cfg.estimatorMinRpm / rpm) * Math.PI / 180;
  const lag = omega * cfg.estimatorLagSeconds;
  const wobble = noise * Math.sin(trueAngle * 3.1 + rpm * 0.07);
  const error = wobble - lag;
  return {
    angle: wrapAngle(trueAngle + error),
    valid: true,
    errorDeg: Math.abs(error) * 180 / Math.PI,
  };
}
