// online/client.js — thin client for the room server. The shooter simulates a
// shot locally then pushes the settled snapshot; the other client long-polls and
// applies newer snapshots (Decision D2). No game logic lives here.

let api = '';
let room = null;
let token = null;
let seat = -1;
let since = 0;
let polling = false;
let onSnap = null;

export const onlineState = () => ({ room, seat, connected: !!room });

async function post(path, body) {
  const res = await fetch(api + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

export function configure(baseUrl) { api = (baseUrl || '').replace(/\/$/, ''); }

export async function createRoom(name) {
  const d = await post('/api/create-room', { name });
  if (d.code) { room = d.code; token = d.token; seat = d.seat; }
  return d;
}

export async function joinRoom(code, name) {
  const d = await post('/api/join-room', { code: code.toUpperCase(), name });
  if (d.token) { room = code.toUpperCase(); token = d.token; seat = d.seat; }
  return d;
}

export async function pushSnapshot(snap) {
  if (!room || !token) return;
  since = snap.version;
  try { await post('/api/update-state', { code: room, token, state: snap }); } catch (e) { /* offline */ }
}

export function startPolling(cb) {
  onSnap = cb;
  if (polling) return;
  polling = true;
  loop();
}

async function loop() {
  if (!room || !token) { polling = false; return; }
  try {
    const res = await fetch(`${api}/api/state?code=${room}&token=${token}&since=${since}&timeout=20000`);
    const data = await res.json();
    if (data.state && data.state.version > since) {
      since = data.state.version;
      if (onSnap) onSnap(data.state);
    }
  } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
  if (room) setTimeout(loop, 200);
}
