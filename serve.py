"""Serve this folder with caching turned off.

Browsers cache ES modules hard. With `python -m http.server`, editing app.js or
rig3d.js and reloading can leave the old module running against the new page,
which shows up as a tab that renders nothing and no error to explain it. This
server tells the browser never to store anything, so a reload is always the
current code.

    python serve.py           # http://127.0.0.1:8790
    python serve.py 8123      # a different port
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):      # one tidy line per request
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    handler = partial(NoCacheHandler, directory='.')
    with ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print('Serving with caching disabled on http://127.0.0.1:%d/' % port)
        print('Visitor mode: http://127.0.0.1:%d/?mode=kiosk' % port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')


if __name__ == '__main__':
    main()
