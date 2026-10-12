"""Re-colour the drive-explorer from cold slate to the race-livery palette.

Two rules, applied to every #rrggbb and 0xrrggbb in the source:

  1. Semantic colours are mapped explicitly (the emerald/amber/red/blue trio
     that carried meaning, plus the few one-off browns and copper tones).
  2. Everything else is a cool grey from one ramp. Those keep their lightness
     exactly and are re-hued warm, which is what kills the GitHub-slate feel
     without disturbing any of the tonal relationships the drawings rely on.
"""
import colorsys
import re
from pathlib import Path

ROOT = Path(r'C:\Users\27790\OneDrive - University of Witwatersrand\MY_4th_YEAR'
            r'\INVESTIGATION\PRESENTATION\drive-explorer')
FILES = ['style.css', 'app.js', 'rig3d.js', 'focmachine.js', 'compare3d.js',
         'game3d.js', 'physics_test.html']

# ---------------------------------------------------------------------------
# 1. Explicit, semantic
# ---------------------------------------------------------------------------
EXPLICIT = {
    # the current vector / "good" green  ->  electric mint
    '34d399': '00e693', '6ee7a8': '5cffc0', '2f9e6b': '00b878', '2f8f5b': '00a86b',
    '3f6b57': '186b52', '1f3a30': '0d3a2c', '13261f': '08261c', '1d4b3a': '0b4b36',
    '245c46': '0a5c42', 'd6ffe9': 'd6fff0', '4caf50': '00c47a', '1f6b45': '0a6b47',
    # amber / warning  ->  signal amber
    'f0b429': 'ffb020', 'e0a23a': 'ffbe3d', 'd9a441': 'f0ad33', '8a5a2a': '8a5520',
    # the magnets / "bad" red  ->  livery red
    'ef4444': 'ff2d55', 'f87171': 'ff6b84', 'c0392b': 'c01f3c', '8f2420': '8f1c32',
    '6b4a4a': '6b3a44',
    # the cool blue accents  ->  electric cyan
    '7aa2f7': '00d4ff', '9ec1ff': '7fe0ff', 'bfd4ff': 'ffe2c2',
    # one-offs that were already warm, nudged to the new family
    'e07b16': 'ff6b1a', 'ff5a2a': 'ff6b1a', 'f97362': 'ff7a4d',
    'b87333': 'c87d2e', 'c8a06a': 'd4a76a', '2a1a16': '2a1713',
    'ffffff': 'ffffff',
}

# Hand-set page chrome, so the darkest surfaces are chosen rather than derived.
CHROME = {
    '0d1117': '11100e', '0c1117': '100f0d', '0b0f15': '0f0e0c', '0b0f16': '0f0e0c',
    '0c1118': '100f0d', '0e1116': '121110', '0f131a': '11100e',
    '121923': '1b1916', '11151b': '171512', '161b24': '1b1916', '161b22': '1b1916',
    '151a22': '1a1815', '11161f': '17150f', '121820': '181611', '111820': '181611',
    '161d27': '1e1b16', '1b222c': '201d18', '1b2430': '221e18',
}
EXPLICIT.update(CHROME)

WARM_HUE = 32 / 360.0          # the neutral family everything grey moves to


def to_warm(hex6):
    r, g, b = (int(hex6[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if s >= 0.35:
        return None                      # saturated and unmapped: leave it alone
    # Keep the lightness, take a warm hue, and allow a little more chroma in
    # the mid tones than the flat grey it replaces.
    warm_s = min(0.10, 0.04 + s * 0.5) * (1.0 if 0.08 < l < 0.92 else 0.4)
    nr, ng, nb = colorsys.hls_to_rgb(WARM_HUE, l, warm_s)
    return '%02x%02x%02x' % (round(nr * 255), round(ng * 255), round(nb * 255))


PATTERN = re.compile(r'(#|0x)([0-9a-fA-F]{6})\b')
changed, untouched = {}, set()


def convert(match):
    prefix, value = match.group(1), match.group(2).lower()
    new = EXPLICIT.get(value) or to_warm(value)
    if new is None:
        untouched.add(value)
        return match.group(0)
    changed[value] = new
    return prefix + new


for name in FILES:
    path = ROOT / name
    text = path.read_text(encoding='utf-8')
    path.write_text(PATTERN.sub(convert, text), encoding='utf-8')

print(f'{len(changed)} colours remapped across {len(FILES)} files')
for old in sorted(untouched):
    print('  left alone (saturated, unmapped):', '#' + old)
