# BM1109 drive envelope explorer

An interactive page showing what a BM1109 PMSM driven by an ODrive Pro can and cannot do,
built for the fourth-year investigation Open Day (15 October 2026).

**Live at <https://clever-gecko-55237e.netlify.app>**, redeployed automatically from this
repository on every push.

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

**Presenter keys.** Numbers run scenarios on the envelope tab: `1` no load · `2` under load ·
`3` voltage ceiling · `4` thermal corner · `5` current limit. Letters switch tabs: `W` rig ·
`E` envelope · `F` control · `S` side by side · `M` method. Also `R` reset and `K` switch mode.

## Running it

No build step and no dependencies. Either open `index.html` in a browser, or serve the
folder (needed because the page fetches `data/matrix.json`):

```bash
python serve.py
```

`serve.py` is `python -m http.server` with caching switched off. That matters here:
browsers cache ES modules hard, and a stale `app.js` against a fresh `index.html`
renders a blank tab with nothing in the console to explain it.

Then open <http://127.0.0.1:8790/>. For the Open Day laptop, open visitor mode in
full screen: <http://127.0.0.1:8790/?mode=kiosk>

## Putting it on the web

`netlify.toml` is already here: nothing to build, publish the folder as it is, with
the code and page served `no-cache` so a stale module can never meet a fresh page.

The quickest route is Netlify Drop (drag the folder onto <https://app.netlify.com/drop>).
The better one is connecting this GitHub repository to a Netlify site, because then
every push redeploys it.

Remember what goes public with it: provisional parameters and an unvalidated model.
The sensorless results are simulation evidence only, and the page keeps them separate
from future hardware measurements.

## Regenerating the data

After a new matrix run, in MATLAB from `tools/`:

```matlab
export_matrix_json('matrix_20260928_132634')
```

That rewrites `data/matrix.json`. The `parameters` block in that script must match
`SIMULATION/working_single_motor/single_motor_sensored_parameters.m`, because the page
solves the same equations live.

To export the matched sensored/sensorless sweep, representative transient and startup
timeline from the investigation workspace:

```matlab
export_project_results('C:\path\to\INVESTIGATION')
```

This rewrites `data/sensorless_speed_sweep.json`, `data/comparison_800rpm.json` and
`data/sensorless_startup.json`. The exporter deliberately removes absolute source paths.

## Files

| Path | Purpose |
|---|---|
| `index.html` | Page structure, both modes |
| `app.js` | Motor equations, envelope solver, drawing, mode handling |
| `style.css` | Styling, including the visitor-mode overrides |
| `rig3d.js` | The 3D rig view and the exploded motor |
| `focmachine.js` | The teaching machine both 3D exhibits are built from |
| `compare3d.js` | The two machines on the side-by-side tab |
| `vendor/three.module.js` | three.js r169 (MIT licence, Copyright 2010-2024 Three.js Authors), vendored so the page works offline |
| `data/matrix.json` | Exported simulation results and model parameters |
| `data/sensorless_speed_sweep.json` | Matched 0.5 N.m sensored/sensorless sweep |
| `data/comparison_800rpm.json` | Matched 800 rpm transient for the results graph |
| `data/sensorless_startup.json` | Encoder-assisted startup and handover timeline |
| `tools/export_matrix_json.m` | Regenerates the JSON from a matrix run |
| `tools/export_project_results.m` | Regenerates the comparison result JSON |

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

The **"estimate the angle instead of measuring it"** switch adds a second arrow using the
angle-error curve exported from the 0.5 N.m simulation sweep. No error is fabricated below
the demonstrated sensorless region: the display reports encoder fallback instead.

**What is measured and what is not.** The matched simulation sweep covers 200--1500 rpm at
0.5 N.m. Sensorless control stayed active from 300 rpm upward; the 200 rpm case completed
handover and then fell back to the encoder. The startup is encoder-assisted, the other load
rows have not been run, and no result has been validated against the physical rig.

## Side by side

The side-by-side tab runs the same motor twice at once, under the same speed and the same load,
differing only in where the controller gets the rotor angle. It shows what an angle error
actually costs: the current needed to hold the demanded torque rises as `1/cos e`, the heat
in the windings as `1/cos^2 e`, and once that current hits the 25 A limit the torque cannot
be held at all. "Run the speed down" sweeps 1600 rpm to 30 rpm, which is the clearest way to
show why a low-speed limit exists.

At 0.5 N.m the estimator error is interpolated from the completed sweep. Changing the load
keeps the explanatory motor equations live, but is not presented as sensorless evidence until
the remaining load rows have been simulated.

## Method and limits

The last tab is the one to send an examiner at. It is built from `data/matrix.json`, so the
parameter table cannot drift away from the parameters the simulation actually ran with: every
motor, inverter and limit value with what it means and where it came from, the full signal
chain from speed command to shaft, which runs exist, where the sensorless model stands with its
measured numbers, the check that the measurement instrumentation changes no control result, and
a plain list of what this work does **not** show.

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
