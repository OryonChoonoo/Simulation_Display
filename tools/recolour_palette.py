"""Re-colour the whole site from one palette to another, by rule.

Run once per palette change. Two rules:

  1. Semantic colours are mapped explicitly: the accents, and the physics
     colours whose meaning is fixed (magnets, current, the three phases).
  2. Everything else is a neutral. Its lightness is *inverted* and its hue
     pulled to the family blue-violet, which turns the dark scheme into a light
     one without disturbing the contrast relationships the drawings rely on:
     what was the darkest thing on a dark panel becomes the lightest thing on
     a light one.

Current palette: Gradient Spectrum, light.
  #F7F6F7 paper   #0E0E34 Haiti ink   #252E8A Bay of Many
  #9A4D87 Cannon Pink   #5A7FC8 Indigo

Accents are pushed to full chroma: on white, a muted colour just looks grey.
"""

import colorsys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ['style.css', 'app.js', 'rig3d.js', 'focmachine.js', 'compare3d.js',
         'game3d.js', 'physics_test.html']

NEUTRAL_HUE = 240 / 360.0
NEUTRAL_SAT = 0.16

# Explicit: these carry meaning and are chosen, not derived. Every one is a
# vivid version of the spectrum, strong enough to hold its own against white.
EXPLICIT = {
    # surfaces, from paper down to the deepest panel
    '0e0e34': 'f7f6f7',          # page
    '090922': 'ffffff',          # the lightest surface
    '161642': 'ffffff',          # cards
    '1c1d55': 'f1f0fa',          # raised cards
    '2a2b66': 'd9d8ec',          # lines
    '3a3c86': 'b9b7da',          # strong lines
    '252e8a': '252e8a',          # Bay of Many keeps its value
    # text
    'f7f6f7': '0e0e34',          # ink
    'a9add4': '5a5f8f',          # secondary text
    '6e72a8': '8186b0',          # faint text
    # accents, saturated up
    '9a4d87': 'b8278f',          # Cannon Pink, vivid
    'c47aad': 'd44fa8',
    'b05c9c': 'a01f7c',
    '46213d': 'f6dcee',          # was a dim fill, now a pale tint
    '5a7fc8': '2a5fd9',          # Indigo, vivid
    '27365e': 'dde6ff',
    '8fa9dc': '4a7fe0',
    # the physics keeps its meanings
    'ff4d6d': 'ff1f4f',          # magnets
    'ff87a0': 'ff5c7d',
    '2ee6a8': '00b377',          # current that is making torque
    '7df0c8': '00d98f',
    'f2b134': 'ef9d00',          # warning
    'e8709a': 'e0457f',          # copper loss
    '58d7c8': '00b3a4',          # the third phase
}

PATTERN = re.compile(r'(#|0x)([0-9a-fA-F]{6})\b')
changed, untouched = {}, set()


def to_light_neutral(hex6):
    r, g, b = (int(hex6[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if s >= 0.42:
        return None                          # saturated and unmapped: leave it
    # Invert the lightness, but compress toward the top so that what was
    # near-black becomes a readable ink rather than pure white.
    nl = 1.0 - l
    nl = 0.12 + nl * 0.84
    sat = min(NEUTRAL_SAT, 0.05 + s * 1.1)
    nr, ng, nb = colorsys.hls_to_rgb(NEUTRAL_HUE, nl, sat)
    return '%02x%02x%02x' % (round(nr * 255), round(ng * 255), round(nb * 255))


def convert(match):
    prefix, value = match.group(1), match.group(2).lower()
    new = EXPLICIT.get(value) or to_light_neutral(value)
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
