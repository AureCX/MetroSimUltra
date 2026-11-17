# Metro Driver

Metro Driver is a browser-based metro train driving simulator built with three.js and Web Audio. You drive from a 3D cab with working controls through bored and cut-and-cover tunnels, using realistic longitudinal physics, block or CBTC signalling with ATP, timetables, door management and passengers. Lines are defined entirely in JSON, and the engine contains no line data.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (default http://localhost:5173). `npm run build` produces a static site in `dist/` that you can host anywhere. `npm run build:single` also writes `dist/metro-driver.html`, a single self-contained file you can open directly in a browser or host as one page. `npm test` runs the headless simulation tests.

## How to drive a run

1. You start at the first platform. The controller is in **B7**, the doors are locked and the clock reads 50 s before departure.
2. Press **E** to open the doors on the platform side. Passengers alight and board.
3. When the dwell is complete, boarding is finished and the scheduled time is close, the **DEPARTURE** lamp lights. Press **F** to close the doors. The warning chime plays, then the doors close and lock (**DOORS LOCKED** lamp).
4. Press **W** to notch up to P1–P4. Traction stays cut until the doors are locked and the emergency brake is released.
5. Obey the permitted speed shown on the speedometer, the DMI and the lineside boards. Obey the signals as well. With ATP on, the emergency brake trips at the permitted speed + 7 km/h or before a red signal.
6. On Line B towards the branches, set the route before Parc Monceau junction with **J** (or the cab **ROUTE** button). The HUD and the DMI show the junction distance, the route that is set and your train's destination. If no route is set, the train is held before the points. If you set the wrong branch, the train goes there.
7. Brake with **S** (B1–B7) and stop at the **STOP** marker. The DMI shows a precision bar for the last 160 m. Every door must be on the platform before the doors will release.
8. At the terminus you get a score for stop accuracy, punctuality, safety and comfort, and you can drive back in the other direction.

The emergency brake (**Space**) latches. To release it, bring the train to a stand and move the controller to a brake notch.

## Controls (rebindable in *Controls*)

| Action | Keyboard | Gamepad |
|---|---|---|
| Increase traction / release brake | W, ↑ | RT, D-pad ↑ |
| Apply brake / reduce traction | S, ↓ | LT, D-pad ↓ |
| Neutral (coast) | N | — |
| Emergency brake | Space | X |
| Open doors (platform side) / close doors | E / F | A / B |
| Change camera (cab, chase, trackside) | C | Y |
| Horn (hold) · Vigilance · Announcement | Q · V · R | LB · RB · Back |
| Set route at a junction | J | D-pad ← / → |
| Line map (full size) | M, or click the cab line map | — |
| Headlights · Cab light · HUD · Reset view | L · K · H · X | — / R3 |
| Pause menu | Esc | Start |

Keys are physical positions, and the menus show the label for your keyboard layout. On AZERTY, for example, the W key is shown as Z.

Mouse controls in the cab:
- Left-click any button.
- Drag or scroll on the master controller.
- Hold the right button and move the mouse to look around.
- Scroll to zoom.

## Architecture

```
src/
  core/        EventBus, Input (keyboard + gamepad actions), Settings, SaveSystem, AssetStore (IndexedDB), util
  lines/       LineSchema (validation/normalisation), TrackGeometry (alignment), Route (one direction), LineRepository
  physics/     TrainPhysics (traction/brake lag, Davis resistance, gradient, curves, adhesion)
  driving/     MasterController, DoorSystem, SafetySystem (ATP, SPAD, vigilance, EB latch), PlayerTrain (interlocks)
  signaling/   SignalSystem (fixed-block 3-aspect + CBTC moving block)
  stations/    StationManager (alignment, precise stop, dwell, departure), Timetable
  traffic/     AutoDriver (ideal-driver model), TrafficManager (AI trains both directions)
  world/       WorldBuilder, StationBuilder, Sweep, Textures, SignalView, TrainModel, Passengers
  cabin/       Cabin (3D cab + interactive controls), CabinDisplays (speedometer, DMI, clock)
  camera/      CameraSystem
  audio/       AudioSystem (procedural sound), Announcer (MP3 / speech)
  ui/          HUD, Menu, NetworkMap
  game/        Game (session orchestration), Scoring
src/data/lines  built-in line JSON files     src/data/trains  train JSON files     tools/  build & line-geometry scripts
docs/LINE_FORMAT.md   full line/train file reference
```

How the pieces fit together:
- Systems talk to each other through the `EventBus` (`doors:*`, `station:*`, `safety:*`, `signal:*` and others). Audio, HUD and scoring only subscribe to these events.
- Every driving system works in route chainage, so it doesn't depend on the direction of travel.
- `Game` is the only place where the systems are wired together.

## Adding content

To add a **line**, write a JSON file (see `docs/LINE_FORMAT.md`). Then either import it from *Select Line* or drop it in `src/data/lines/`.

You can import **announcements** as MP3s from *Select Line*. Files are matched by station id.

To add a **train**, add a JSON file to `src/data/trains/`.

## Built-in content

Network **Grandville Métro**:

| Line | Features |
|---|---|
| Line A — Grandville Centre ↔ Grandville Sud | 25 stations, 22 km arc, arch tunnel, fixed-block signals, track-works restriction at Val Fleuri |
| Line B — Grandville Nord ↔ Bellevue – Centre / Aéroport Est | Branching line: choose the destination at start and set the route at Parc Monceau junction. CBTC moving block, box tunnel. Walking connection Aéroport Est ↔ Aéroport International (Line A) |

A and B interchange at République and Gare Centrale. Saint-Augustin (Line B) uses the `grand` station style. Every cab has a live line diagram above the windshield. Line B's geometry is generated by `npm run solve:line-b` (`tools/solve-line-b.mjs`) so that the shared stations sit on Line A's.

Trains:

| Train | Characteristics |
|---|---|
| MX-80 Classic | GTO traction, slower brakes |
| NV-24 Modern | IGBT traction, 5 traction notches |
| HX-6 Heavy | 6 × 16.5 m cars, 4 doors per side; precise stops are demanding |

## Roadmap status

| Phase | Status | Contents |
|---|---|---|
| 1 | done | Train, cab, track, tunnel, station, physics, first-person camera |
| 2 | done | Multiple stations, signalling and ATP, doors, timetables, announcements, passengers |
| 3 | done | JSON line import and export, per-station configuration, MP3 import, 3 train models, multi-line networks with map |
| 4 | partial | See below |

Phase 4 is partly done: procedural textures and sound, animated doors and passengers, and the final UI are in place. Still to come:
- Authored 3D models and real recorded audio samples.
- Shadow and lighting quality tiers.
- Geometry instancing for very long lines.
