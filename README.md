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
`5` current limit · `R` reset · `K` switch mode.

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
| `data/matrix.json` | Exported simulation results and model parameters |
| `tools/export_matrix_json.m` | Regenerates the JSON from a matrix run |

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
