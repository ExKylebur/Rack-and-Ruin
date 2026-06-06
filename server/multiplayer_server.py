#!/usr/bin/env python3
"""
Rack & Ruin - Multiplayer Server
Room-based sync, async turn handoff, optional public tunnel via localhost.run
"""

import argparse
import json
import os
import random
import string
import threading
import time
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(os.path.dirname(__file__), 'state', 'rooms.json')

rooms = {}
rooms_lock = threading.Lock()
public_base_url = None
tunnel_url = None

LONG_POLL_TIMEOUT = 25  # seconds

# ---- Persistence ----

def load_rooms():
    global rooms
    try:
        with open(STATE_FILE, 'r') as f:
            rooms = json.load(f)
    except Exception:
        rooms = {}

def save_rooms():
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE, 'w') as f:
            json.dump(rooms, f)
    except Exception as e:
        print(f'[warn] Could not save rooms: {e}')

# ---- Room helpers ----

def gen_code(length=4):
    return ''.join(random.choices(string.ascii_uppercase, k=length))

def gen_token():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=24))

def get_room(code):
    return rooms.get(code.upper())

def notify_waiters(code):
    room = get_room(code)
    if not room:
        return
    waiters = room.get('_waiters', [])
    room['_waiters'] = []
    for ev in waiters:
        ev.set()

# ---- HTTP Handler ----

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default access log

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def send_cors_preflight(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def serve_static(self, path):
        full = os.path.join(REPO_ROOT, path.lstrip('/'))
        full = os.path.normpath(full)
        if not full.startswith(REPO_ROOT):
            self.send_response(403); self.end_headers(); return
        if not os.path.isfile(full):
            self.send_response(404); self.end_headers(); return
        ext = os.path.splitext(full)[1].lower()
        ct = {'.html':'text/html', '.js':'application/javascript', '.css':'text/css',
              '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon'}.get(ext, 'application/octet-stream')
        with open(full, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ct)
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}

    def do_OPTIONS(self):
        self.send_cors_preflight()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == '/api/server-info':
            self.send_json({'status': 'ok', 'publicBaseUrl': tunnel_url or public_base_url or ''})

        elif path == '/api/state':
            code = (qs.get('code', [''])[0]).upper()
            token = qs.get('token', [''])[0]
            since = int(qs.get('since', ['0'])[0])
            timeout = min(float(qs.get('timeout', [str(LONG_POLL_TIMEOUT * 1000)])[0]) / 1000, LONG_POLL_TIMEOUT)

            with rooms_lock:
                room = get_room(code)
                if not room:
                    self.send_json({'error': 'room not found'}, 404); return
                # validate token is in room
                if token not in room.get('tokens', {}).values():
                    self.send_json({'error': 'invalid token'}, 403); return

                state = room.get('state')
                version = (state or {}).get('version', 0)
                if version > since:
                    self.send_json({'state': state}); return

                ev = threading.Event()
                if '_waiters' not in room:
                    room['_waiters'] = []
                room['_waiters'].append(ev)

            # Long poll outside lock
            ev.wait(timeout=timeout)

            with rooms_lock:
                room = get_room(code)
                if not room:
                    self.send_json({'state': None}); return
                # remove ev if still there
                try: room.get('_waiters', []).remove(ev)
                except ValueError: pass
                self.send_json({'state': room.get('state')})

        else:
            # Static file fallback
            if path == '/':
                path = '/PLAY ME.html'
            self.serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()

        if path == '/api/create-room':
            name = body.get('name', 'Player 1')
            with rooms_lock:
                code = gen_code()
                while code in rooms:
                    code = gen_code()
                token = gen_token()
                rooms[code] = {
                    'code': code,
                    'seats': [name],
                    'tokens': {'0': token},
                    'state': None,
                    'created': time.time(),
                    '_waiters': [],
                }
                save_rooms()
            self.send_json({'code': code, 'token': token, 'seat': 0})

        elif path == '/api/join-room':
            code = body.get('code', '').upper()
            name = body.get('name', 'Player 2')
            with rooms_lock:
                room = get_room(code)
                if not room:
                    self.send_json({'error': 'room not found'}, 404); return
                seats = room.get('seats', [])
                if len(seats) >= 2:
                    # Check for name-based reclaim
                    if name in seats:
                        seat_idx = seats.index(name)
                        token = room['tokens'].get(str(seat_idx), gen_token())
                        room['tokens'][str(seat_idx)] = token
                        self.send_json({'token': token, 'seat': seat_idx, 'spectator': False}); return
                    self.send_json({'token': gen_token(), 'seat': len(seats), 'spectator': True}); return
                seat_idx = len(seats)
                token = gen_token()
                seats.append(name)
                room['tokens'][str(seat_idx)] = token
                save_rooms()
            self.send_json({'token': token, 'seat': seat_idx, 'spectator': False})

        elif path == '/api/reconnect':
            code = body.get('code', '').upper()
            name = body.get('name', '')
            token = body.get('token', '')
            with rooms_lock:
                room = get_room(code)
                if not room:
                    self.send_json({'error': 'room not found'}, 404); return
                # Verify token or name
                seats = room.get('seats', [])
                tokens = room.get('tokens', {})
                for idx, t in tokens.items():
                    if t == token:
                        self.send_json({'seat': int(idx), 'state': room.get('state')}); return
                if name in seats:
                    idx = seats.index(name)
                    new_token = gen_token()
                    room['tokens'][str(idx)] = new_token
                    save_rooms()
                    self.send_json({'seat': idx, 'token': new_token, 'state': room.get('state')}); return
                self.send_json({'error': 'not found'}, 404)

        elif path == '/api/update-state':
            code = body.get('code', '').upper()
            token = body.get('token', '')
            state = body.get('state')
            with rooms_lock:
                room = get_room(code)
                if not room:
                    self.send_json({'error': 'room not found'}, 404); return
                if token not in room.get('tokens', {}).values():
                    self.send_json({'error': 'invalid token'}, 403); return
                existing_version = (room.get('state') or {}).get('version', 0)
                new_version = (state or {}).get('version', 0)
                if new_version > existing_version:
                    room['state'] = state
                    save_rooms()
                    notify_waiters(code)
            self.send_json({'ok': True})

        elif path == '/api/start-tunnel':
            start_tunnel_async()
            self.send_json({'ok': True, 'msg': 'Tunnel starting…'})

        else:
            self.send_json({'error': 'not found'}, 404)


def start_tunnel_async():
    def run():
        global tunnel_url
        try:
            print('[tunnel] Starting localhost.run tunnel…')
            proc = subprocess.Popen(
                ['ssh', '-o', 'StrictHostKeyChecking=no', '-R', f'80:localhost:{server_port}', 'nokey@localhost.run'],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
            )
            for line in proc.stdout:
                if 'tunneled with tls termination' in line.lower() or '.lhr.life' in line or '.lhrtunnel' in line:
                    parts = line.strip().split()
                    for part in parts:
                        if part.startswith('https://'):
                            tunnel_url = part.rstrip(',').rstrip('.')
                            print(f'[tunnel] Public URL: {tunnel_url}')
                            break
        except Exception as e:
            print(f'[tunnel] Error: {e}')
    threading.Thread(target=run, daemon=True).start()


server_port = 8000

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Rack & Ruin Multiplayer Server')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--public-base-url', default='')
    parser.add_argument('--auto-public-tunnel', action='store_true')
    args = parser.parse_args()

    server_port = args.port
    public_base_url = args.public_base_url or f'http://localhost:{args.port}'

    load_rooms()
    print(f'[server] Rack & Ruin server starting on port {args.port}')
    print(f'[server] Serving from: {REPO_ROOT}')
    print(f'[server] Open: http://localhost:{args.port}/PLAY%20ME.html')

    if args.auto_public_tunnel:
        start_tunnel_async()

    httpd = HTTPServer(('0.0.0.0', args.port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n[server] Shutting down.')
