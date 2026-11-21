# Online multiplayer

Players join the same Grandville world: each drives their own metro train or bus, and everyone sees the
others' vehicles in real time (3D, network map, bus navigation display), with shared station and stop events.

## How it works

* `server/` holds a small **Node.js** program (no dependencies, Node 18+). It is **authoritative**:
  * sessions with 5-character join codes, public session list, invite links;
  * it validates every position update (no teleporting, no over-speed) and sends corrections;
  * trains on the same track and direction are kept apart: the server gives each driver a **movement
    authority** that ends 40 m behind the train ahead (branch-aware on Line B), and reports collisions;
  * bus-to-bus contacts are detected by the server and resolved physically by both players' games;
  * service events (arrivals, departures, passengers carried, termini, finished services) feed the session log;
  * a player who loses the connection is kept for 60 s and resumes automatically (same session, same vehicle).
* The game connects over WebSocket (`wss://…/ws`), sends its state 10 times a second and draws the other
  players 150 ms in the past, interpolated, for smooth motion.
* Each game still simulates its own AI traffic (metro timetable trains are deterministic, road traffic is local).

## Can it run on GitHub Pages?

**The game, yes; the server, no.** GitHub Pages only serves static files, it cannot run a program that keeps
connections open. Host the server somewhere that runs Node; the game on GitHub Pages then connects to it
(players type the server address in *Multiplayer*, or open an invite link that contains it).

## Hosting the server for free (Render)

1. On https://render.com create a **Web Service** from the GitHub repository.
2. Settings: **Runtime** Node · **Build command** `npm install && npm run build` (optional: also serves the game) ·
   **Start command** `node server/server.js`. Render provides HTTPS/WSS and the `PORT` variable.
3. Open the service URL: `/health` should answer `{"ok":true,…}`.
4. In the game: *Multiplayer* → server address `https://your-service.onrender.com` → *Connect*.

When the build step is kept, the same address also serves the game itself, so friends only need that one link.
Free Render services sleep after inactivity; the first connection can take up to a minute to wake it.
Any other Node host works the same way (Fly.io, Railway, a VPS, a Raspberry Pi with port forwarding…).

## Running locally

```
npm run build          # optional: lets the server serve the game too
node server/server.js  # PORT=8080 by default
```

Then open `http://localhost:8080` (if built) or the dev server, and connect to `http://localhost:8080`.
Players on the same network use the computer's local IP address instead of `localhost`.

## Protocol (JSON over WebSocket)

Client → server: `hello {name, token}`, `list`, `create {name, public, max}`, `join {code}`, `leave`,
`drive {kind: 'train'|'bus', …}`, `state {s, v, doors, …}` / `{x, z, yaw, v, doors, …}`, `event {e, …}`, `ping`.
Server → client: `welcome`, `sessions`, `joined`, `players`, `states` (10 Hz), `auth {s}`, `correction`,
`collision`, `feed`, `error`, `pong`. See `server/rooms.js`.


## Main lines (TGV)

TGV services of one corridor share the track up to their first destination: the server keeps those trains apart like
branches of a metro line. Trains on other services are shown in 3D on their own track. The server accepts train speeds
up to 360 km/h — **redeploy the server** (Render: push to the branch / *Manual Deploy*) after updating. Time acceleration is
disabled in online sessions.
