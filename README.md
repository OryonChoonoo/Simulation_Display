# BM1109 drive envelope explorer

An interactive page showing what a BM1109 PMSM driven by an ODrive Pro can and cannot do,
built for the fourth-year investigation Open Day (15 October 2026).

**This is a simulation, not a measurement.** Motor parameters are provisional, the inverter
is averaged, rotor feedback is ideal, and nothing here has been validated against the
physical rig.

## What it shows

A speed–torque envelope. The shaded region is what the drive can deliver on the configured
battery voltage and current limit, coloured by how much of the input power reaches the
shaft. The white dots are the 24 full Simulink cases; the shading is the *same physics*
solved live in JavaScript, which is why the dots sit on the boundary they predict.

Drag to any operating point and the page says whether the motor can do it, and if not,
which limit stops it:

- **Out of voltage** — back-EMF grows with speed until the supply can no longer push
  current in. This sets the top of the envelope.
- **Out of current** — torque needs current; the drive limit sets the right-hand edge.
- **Runs, but wastes most of the power** — at low speed with high torque, most of the
  input becomes heat in the windings.

## Two modes

| Mode | For | How to open |
|---|---|---|
| **Presenter** | You, demonstrating | default, or press `K` |
| **Visitor** | Unattended kiosk | `index.html?mode=kiosk`, or press `K` |

Visitor mode hides the advanced controls, enlarges everything, resets to defaults after
45 seconds of no interaction, and then sweeps the operating point to catch the eye.

**Presenter keys:** `1` no load · `2` under load · `3` voltage ceiling · `4` thermal corner ·
`5` current limit · `R` reset · `K` switch mode · `E` envelope · `F` control · `3` rig.

## Running it

No build step and no dependencies. Either open `index.html` in a browser, or serve the
folder (needed because the page fetches `data/matrix.json`):

```bash
python -m http.server 8790
```

Then open <http://127.0.0.1:8790/>. For the Open Day laptop, open visitor mode in
full screen: <http://127.0.0.1:8790/?mode=kiosk>

## Regenerating the data

After a new matrix run, in MATLAB from `tools/`:

```matlab
export_matrix_json('matrix_20260928_132634')
```

That rewrites `data/matrix.json`. The `parameters` block in that script must match
`SIMULATION/working_single_motor/single_motor_sensored_parameters.m`, because the page
solves the same equations live.

## Files

| Path | Purpose |
|---|---|
| `index.html` | Page structure, both modes |
| `app.js` | Motor equations, envelope solver, drawing, mode handling |
| `style.css` | Styling, including the visitor-mode overrides |
| `rig3d.js` | The 3D rig view and the motor cutaway |
| `vendor/three.module.js` | three.js r169 (MIT licence, Copyright 2010-2024 Three.js Authors), vendored so the page works offline |
| `data/matrix.json` | Exported simulation results and model parameters |
| `tools/export_matrix_json.m` | Regenerates the JSON from a matrix run |

## The 3D view

The first tab shows the rig in three dimensions, built from primitives at roughly rig
scale. It is an **illustration of the setup, not CAD and not measured data**: no public
CAD exists for the BM1109, and clean shapes read better on a screen than a borrowed model
of a different motor.

Two views: the whole rig, which opens with a slow fly-in and can be dragged around, and a
cutaway of the test motor seen down the shaft, showing the rotor magnets, the stator coils
and the current vector the controller holds at right angles to the magnets.

**The rig itself is the orientation exhibit.** Clicking a motor, a controller, the chain, the
battery, the encoder, the laptop or the emergency stop lights that part up and explains what
it does and why it is there. The buttons under the view select the same parts, for a visitor
who would rather read a list than hunt for the emergency stop on a screen. This replaces the
earlier flat "What am I looking at?" diagram, which said the same things about a drawing
instead of about the rig.

The **"estimate the angle instead of measuring it"** switch adds a second arrow for where a
sensorless controller *thinks* the rotor is. The gap between the arrows grows as the motor
slows, because the back-EMF it estimates from shrinks with speed. **That growth is an
illustrative shape, not simulated behaviour** — the sensorless model does not exist yet.
When it does, this can be driven by measured estimation error.

## Side by side

The last tab runs the same motor twice at once, under the same speed and the same load,
differing only in where the controller gets the rotor angle. It shows what an angle error
actually costs: the current needed to hold the demanded torque rises as `1/cos e`, the heat
in the windings as `1/cos^2 e`, and once that current hits the 25 A limit the torque cannot
be held at all. "Run the speed down" sweeps 1600 rpm to 30 rpm, which is the clearest way to
show why a low-speed limit exists.

**Both sides are the real model. The estimator's error is not.** How wrong a sensorless
estimate gets is a stand-in shape, stated as such on the tab, and it should be replaced by
the sensorless simulation's own error once that simulation works.

## The physics in the page

```
Iq        = (T + B·ω) / Kt
V         = hypot(ω_e·λ + R·Iq, ω_e·L·Iq)
modulation = V / (V_dc/√3)            infeasible when > 1
P_copper  = 1.5·R·Iq²   P_friction = B·ω²   η = T·ω / (T·ω + P_copper + P_friction)
```

These reproduce the Simulink results to about four digits: at 1500 rpm and 2.0 N·m the
page gives 355.1 W input against the simulation's 355.05 W, and 0.896 maximum duty against
0.896.

## Provenance

Data from `SIMULATION/results/single_motor_sensored/matrix_20260928_132634`, produced by
`SIMULATION/run_single_motor_sensored_matrix.m`. See `SIMULATION/SENSORED_MODEL_GUIDE.md`
for what each block of the model does, and `SIMULATION/CHANGES.md` for the model history.
