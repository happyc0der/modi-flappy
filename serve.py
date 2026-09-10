#!/usr/bin/env python3
# Modi Flappy -- a Flappy Bird knock-off set in a Mumbai slum.
# Copyright (C) 2026  happyc0der
#
# This program is free software: you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free Software
# Foundation, either version 3 of the License, or (at your option) any later
# version. It is distributed WITHOUT ANY WARRANTY; see LICENSE for details.
#
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Static file server for Modi Flappy.

This is `python3 -m http.server` plus one thing: a POST /__shutdown endpoint, so
the in-game Quit button can stop the server as well as the page. The game itself
is entirely client-side and does not need this -- plain `python3 -m http.server`
still works fine, the Quit button just won't be able to stop it.

Usage:
    python3 serve.py            # serves on http://127.0.0.1:8081
    PORT=9000 python3 serve.py  # or pick a port
"""

import http.server
import os
import socketserver
import sys
import threading

HOST = "127.0.0.1"  # loopback only -- never expose the shutdown endpoint
PORT = int(os.environ.get("PORT", "8081"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path != "/__shutdown":
            self.send_error(404, "Not Found")
            return

        # POST-only and loopback-only. This can stop a local dev server and
        # nothing else, but there is no reason to make it trivially reachable
        # from any page the user happens to have open.
        origin = self.headers.get("Origin", "")
        if origin and not origin.startswith(("http://127.0.0.1", "http://localhost")):
            self.send_error(403, "Forbidden")
            return

        body = b"stopping\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

        # shutdown() blocks until serve_forever() returns, so it cannot be
        # called from the thread currently handling this request.
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    try:
        httpd = Server((HOST, PORT), Handler)
    except OSError as exc:
        print(f"could not bind {HOST}:{PORT} -- {exc}", file=sys.stderr)
        print("is another copy already running? try: pkill -f serve.py", file=sys.stderr)
        return 1

    with httpd:
        print(f"Modi Flappy  ->  http://{HOST}:{PORT}")
        print("stop with Ctrl+C, or the Quit button on the game's menu")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()
    print("server stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
