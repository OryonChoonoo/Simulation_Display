"""Export the rig-matched sensored/sensorless comparison for the dashboard.

Reads the merged CSV from the 2026-10-12 rig-matched run and writes
data/rig_comparison.json. Nothing is computed that the CSV does not already
contain except the means and the percentage differences, and those are printed
so they can be checked against the notebook entry.

    python tools/export_rig_comparison.py
"""

import csv
import json
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
RUN = (SITE.parent.parent / 'final results'
       / 'rig_matched_sensored_sensorless_20261012_095210')
SOURCE = RUN / 'simulation_vs_real_comparison.csv'
OUT = SITE / 'data' / 'rig_comparison.json'

SENSORED_SESSION = 'session_20261010T133623Z_546035200'
SENSORLESS_SESSION = 'session_20261010T140233Z_986376300'


def main():
    rows = list(csv.DictReader(SOURCE.open(encoding='utf-8-sig')))
    rows.sort(key=lambda r: float(r['target_speed_rpm']))

    def series(key):
        return [round(float(r[key]), 6) for r in rows]

    def mean(key):
        values = [float(r[key]) for r in rows]
        return sum(values) / len(values)

    data = {
        'source': {
            'run': RUN.name,
            'csv': SOURCE.name,
            'exported': date.today().isoformat(),
            'sensored_session': SENSORED_SESSION,
            'sensorless_session': SENSORLESS_SESSION,
            'points': len(rows),
            'note': 'Measured on the two-motor chain-coupled rig on 2026-10-10, '
                    'alongside the matched simulation. The rig current-controls the '
                    'TEST motor and regulates speed on the LOAD motor; the simulation '
                    'speed-controls one motor against a passive equivalent load, so the '
                    'two are compared metric by metric, not signal by signal.',
        },
        'conditions': {
            'speed_rpm': series('target_speed_rpm'),
            'opposing_current_A': 0.5,
            'sim_load_torque_Nm': 0.057431,
            'bus_V': 26.5,
            'iq_limit_A': 25,
        },
        # What was measured on the hardware.
        'rig': {
            'sensored': {
                'iq_variation_rms_A': series('sensored_rig_test_iq_variation_rms_A'),
                'h5_percent': series('sensored_rig_test_h5_percent'),
                'load_speed_sd_rpm': series('sensored_rig_load_speed_sd_rpm'),
                'load_speed_mean_rpm': series('sensored_rig_load_speed_mean_rpm'),
            },
            'sensorless': {
                'iq_variation_rms_A': series('sensorless_rig_test_iq_variation_rms_A'),
                'h5_percent': series('sensorless_rig_test_h5_percent'),
                'load_speed_sd_rpm': series('sensorless_rig_load_speed_sd_rpm'),
                'load_speed_mean_rpm': series('sensorless_rig_load_speed_mean_rpm'),
                'relative_angle_rms_deg': series(
                    'sensorless_rig_relative_angle_rms_electrical_deg'),
            },
        },
        # What the model produced under the same commands.
        'sim': {
            'sensored': {
                'iq_variation_rms_A': series('sensored_sim_iq_variation_rms_A'),
                'h5_percent': series('sensored_sim_h5_percent'),
                'speed_sd_rpm': series('sensored_sim_speed_sd_rpm'),
            },
            'sensorless': {
                'iq_variation_rms_A': series('sensorless_sim_iq_variation_rms_A'),
                'h5_percent': series('sensorless_sim_h5_percent'),
                'speed_sd_rpm': series('sensorless_sim_speed_sd_rpm'),
                'angle_rms_deg': series('sensorless_sim_angle_rms_electrical_deg'),
            },
        },
    }

    headline = {}
    for name, a, b in [
        ('iq_variation_rms_A',
         'sensored_rig_test_iq_variation_rms_A', 'sensorless_rig_test_iq_variation_rms_A'),
        ('h5_percent',
         'sensored_rig_test_h5_percent', 'sensorless_rig_test_h5_percent'),
        ('load_speed_sd_rpm',
         'sensored_rig_load_speed_sd_rpm', 'sensorless_rig_load_speed_sd_rpm'),
    ]:
        sensored, sensorless = mean(a), mean(b)
        headline[name] = {
            'sensored': round(sensored, 4),
            'sensorless': round(sensorless, 4),
            'change_percent': round(100 * (sensorless - sensored) / sensored, 1),
        }
    headline['sim_vs_rig_iq_factor'] = round(
        mean('sensorless_rig_test_iq_variation_rms_A')
        / mean('sensorless_sim_iq_variation_rms_A'))
    headline['sim_vs_rig_speed_factor'] = round(
        mean('sensorless_rig_load_speed_sd_rpm')
        / mean('sensorless_sim_speed_sd_rpm'))
    headline['sim_angle_rms_deg'] = {
        'low': round(min(float(r['sensorless_sim_angle_rms_electrical_deg']) for r in rows), 3),
        'high': round(max(float(r['sensorless_sim_angle_rms_electrical_deg']) for r in rows), 3),
        'implied_delay_us': 62.6,
    }
    data['headline'] = headline

    OUT.write_text(json.dumps(data, indent=1), encoding='utf-8')
    print(f'wrote {OUT.relative_to(SITE)} from {len(rows)} matched points')
    for key, value in headline.items():
        print(' ', key, value)


if __name__ == '__main__':
    main()
