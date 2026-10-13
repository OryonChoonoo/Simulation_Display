"""Re-colour the whole site from one palette to another, by rule.

Run once per palette change. Two rules:

  1. Semantic colours are mapped explicitly: the accents, and the physics
     colours whose meaning is fixed (magnets, current, the three phases).
  2. Everything else is a neutral from one ramp. Those keep their lightness
     exactly and are re-hued, which moves the whole page to a new family
     without disturbing any of the tonal relationships the drawings rely on.

Current palette: the Gradient Spectrum set.
  #0E0E34 Haiti   #252E8A Bay of Many   #9A4D87 Cannon Pink
  #5A7FC8 Indigo  #F7F6F7 White
"""

import colorsys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ['style.css', 'app.js', 'rig3d.js', 'focmachine.js', 'compare3d.js',
         'game3d.js', 'physics_test.html']

# --- the new palette --------------------------------------------------------
HAITI = '0e0e34'
BAY = '252e8a'
PINK = '9a4d87'
INDIGO = '5a7fc8'
WHITE = 'f7f6f7'

# Hue for the neutral ramp: the blue-violet of Haiti, so greys read as part of
# the family rather than as dead slate.
NEUTRAL_HUE = 240 / 360.0
NEUTRAL_SAT = 0.30          # neutrals stay tinted, not grey

EXPLICIT = {
    # surfaces, darkest first
    '11100e': HAITI, '0c0b0a': '090922', '1b1916': '161642', '232019': '1c1d55',
    '35302a': '2a2b66', '4a423a': '3a3c86', '241f19': '181748', '2c241b': '23245e',
    '100f0d': '0b0b2a', '0f0e0c': '090922', '121110': '101033', '171512': '13133a',
    '1a1815': '151540', '17150f': '121236', '181611': '131339', '1e1b16': '191947',
    '201d18': '1b1b4e', '221e18': '1c1c52', '0b0b2a': '0b0b2a',
    # text
    'f5f1ea': WHITE, 'a2998c': 'a9add4', '6f675d': '6e72a8',
    # the lead accent moves from orange to Cannon Pink, with Indigo answering it
    'ff6b1a': PINK, 'ff9a5c': 'c47aad', 'ff8238': 'b05c9c', '5c2a0c': '46213d',
    '00d4ff': INDIGO, '0b4451': '27365e', '7fe0ff': '8fa9dc',
    # the physics keeps its meanings, in the new family
    'ff2d55': 'ff4d6d',            # magnets, and anything bad
    'ff6b84': 'ff87a0',
    '00e693': '2ee6a8',            # the current that is making torque
    '5cffc0': '7df0c8', '00b878': '1fb98a', '00a86b': '15a37a',
    '186b52': '1a6b57', '0d3a2c': '0e3a33', '08261c': '0a2622', '0b4b36': '0d4b40',
    '0a5c42': '0c5c4c', 'd6fff0': 'd6fff4', '00c47a': '19c48c', '0a6b47': '0c6b52',
    'ffb020': 'f2b134',            # warning amber
    'ffbe3d': 'f5bf52', 'f0ad33': 'e8a93f', '8a5520': '6d5230',
    'ff7a4d': 'e8709a',            # copper loss bar
    'c01f3c': 'c02048', '8f1c32': '8f1c3e', '6b3a44': '5c3a52',
    # the three stator phases: distinct from each other, the current and the magnets
    'b36bff': '58d7c8',
    # warm one-offs from the livery that have no meaning of their own
    'c87d2e': '8f7bd4', 'd4a76a': 'b0a6e0', '2a1713': '1a1540',
    'ffffff': 'ffffff',
}


def to_neutral(hex6):
    r, g, b = (int(hex6[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if s >= 0.35:
        return None                         # saturated and unmapped: leave alone
    sat = min(NEUTRAL_SAT, 0.10 + s * 1.2) * (1.0 if 0.06 < l < 0.94 else 0.5)
    nr, ng, nb = colorsys.hls_to_rgb(NEUTRAL_HUE, l, sat)
    return '%02x%02x%02x' % (round(nr * 255), round(ng * 255), round(nb * 255))


PATTERN = re.compile(r'(#|0x)([0-9a-fA-F]{6})\b')
changed, untouched = {}, set()


def convert(match):
    prefix, value = match.group(1), match.group(2).lower()
    new = EXPLICIT.get(value) or to_neutral(value)
    if new is None:
        untouched.add(value)
        return match.group(0)
    changed[value] = new
    return prefix + new


def main():
    for name in FILES:
        path = ROOT / name
        path.write_text(PATTERN.sub(convert, path.read_text(encoding='utf-8')),
                        encoding='utf-8')
    print(f'{len(changed)} colours remapped across {len(FILES)} files')
    for old in sorted(untouched):
        print('  left alone (saturated, unmapped): #' + old)


if __name__ == '__main__':
    main()
