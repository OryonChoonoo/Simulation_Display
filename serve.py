"""Serve this folder with caching turned off, and keep the leaderboard shared.

Browsers cache ES modules hard. With `python -m http.server`, editing app.js or
rig3d.js and reloading can leave the old module running against the new page,
which shows up as a tab that renders nothing and no error to explain it. This
server tells the browser never to store anything, so a reload is always the
current code.

It also answers the leaderboard endpoint the page asks for, storing the list in
a file beside this script. On Netlify that endpoint is a serverless function; a
production deploy there needs paid credits, so for now the laptop does the job
instead. Nothing in the page changes: it is the same path either way.

    python serve.py              # http://127.0.0.1:8790, this machine only
    python serve.py 8123         # a different port
    python serve.py --lan        # also reachable from phones on the same Wi-Fi

`--lan` opens the port to your local network, which is what Open Day visitors
scanning the QR code need. Windows asks once whether to allow it through the
firewall; say yes for private networks. Leave it off when you do not need it:
anyone on that network can then reach the site and post to the board.
"""

import json
import re
import socket
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BOARD_PATH = Path(__file__).resolve().parent / 'leaderboard_local.json'
BOARD_ROUTE = '/.netlify/functions/leaderboard'
MAX_ENTRIES = 20
NOT_IN_NAME = re.compile(r"[^\w .'-]", re.UNICODE)
board_lock = threading.Lock()


def read_board():
    try:
        data = json.loads(BOARD_PATH.read_text(encoding='utf-8'))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []                      # first run, before anything is stored


def write_board(entries):
    BOARD_PATH.write_text(json.dumps(entries, indent=1), encoding='utf-8')


def number(value, lo, hi):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return lo
    if n != n:                         # NaN
        return lo
    return min(max(n, lo), hi)


def clean(entry):
    """The same rules as the Netlify function, so a board moved between the two
    cannot carry anything the other would have rejected."""
    if not isinstance(entry, dict):
        entry = {}
    name = NOT_IN_NAME.sub('', str(entry.get('name', ''))).strip()[:14] or 'anonymous'
    return {
        'name': name,
        'seconds': number(entry.get('seconds'), 0, 3600),
        'percent': number(entry.get('percent'), 0, 100),
        'step': round(number(entry.get('step'), 1, 999)),
        'rpm': round(number(entry.get('rpm'), 0, 100000)),
    }


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):      # one tidy line per request
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))

    # ---- the leaderboard ---------------------------------------------------
    def is_board(self):
        return self.path.split('?')[0] == BOARD_ROUTE

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.is_board():
            with board_lock:
                return self.send_json({'list': read_board()})
        super().do_GET()

    def do_HEAD(self):
        if self.is_board():
            return self.send_json({'list': []})
        super().do_HEAD()

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        if not self.is_board():
            return self.send_error(404)
        length = min(int(self.headers.get('Content-Length') or 0), 4096)
        try:
            entry = json.loads(self.rfile.read(length) or b'null')
        except ValueError:
            entry = None
        if entry is None:
            return self.send_json({'error': 'bad request'}, 400)
        with board_lock:
            entries = read_board()
            entries.append(clean(entry))
            entries.sort(key=lambda e: e.get('rpm', 0), reverse=True)
            entries = entries[:MAX_ENTRIES]
            write_board(entries)
        self.send_json({'list': entries})

    def do_DELETE(self):
        """Emptying the board is for the person running the laptop, so it is
        allowed from this machine only. A phone on the Wi-Fi cannot wipe it."""
        if not self.is_board():
            return self.send_error(404)
        if self.client_address[0] not in ('127.0.0.1', '::1'):
            return self.send_json({'error': 'not allowed'}, 403)
        with board_lock:
            write_board([])
        self.send_json({'list': []})


def lan_address():
    """The address a phone on the same Wi-Fi would use. Nothing is actually
    sent; the socket is only asked which interface it would go out of."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def main():
    args = sys.argv[1:]
    lan = '--lan' in args
    if lan:
        args.remove('--lan')
    port = int(args[0]) if args else 8790
    host = '0.0.0.0' if lan else '127.0.0.1'
    handler = partial(NoCacheHandler, directory='.')
    with ThreadingHTTPServer((host, port), handler) as httpd:
        print('Serving with caching disabled on http://127.0.0.1:%d/' % port)
        print('Visitor mode:                    http://127.0.0.1:%d/?mode=kiosk' % port)
        if lan:
            ip = lan_address()
            print('On this Wi-Fi:                   http://%s:%d/?mode=kiosk'
                  % (ip or '<this machine>', port))
            print('   (that is the address for the QR code)')
        else:
            print('This machine only. Add --lan to let phones on the same Wi-Fi reach it.')
        print('Leaderboard kept in %s' % BOARD_PATH.name)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')


if __name__ == '__main__':
    main()
