# Metro Driver — Grandville Transport Simulator

Metro Driver is a browser-based metro train driving simulator built with three.js and Web Audio. You drive from a 3D cab with working controls through bored and cut-and-cover tunnels, using realistic longitudinal physics, block or CBTC signalling with ATP, timetables, door management and passengers. Lines are defined entirely in JSON, and the engine contains no line data.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (default http://localhost:5173). `npm run build` produces a static site in `dist/` that you can host anywhere. `npm run build:single` also writes `dist/metro-driver.html`, a single self-contained file you can open directly in a browser or host as one page. `npm test` runs the headless simulation tests.

## Hosting (free)

The game is a static site, so any static host works.

- **GitHub Pages** (set up in this repository): in *Settings → Pages*, set *Source* to **GitHub Actions**. Each push to `main` then runs `.github/workflows/deploy.yml`, which tests, builds and publishes the game to `https://<user>.github.io/<repo>/`.
- **Netlify / Vercel / Cloudflare Pages**: import the repository, set the build command to `npm run build` and the output directory to `dist`.
- **itch.io**: run `npm run build`, zip the *contents* of `dist/`, and upload the zip as an HTML game. Alternatively, upload `dist/metro-driver.html` on its own.

## Economy, fleet & depot

* You start with **80 000 €**, one MX-80 train and one Urbano 12 bus. Balance is shown in the main menu and depot.
* Every metro run and bus shift is paid: distance, stops served, passengers carried, service quality (score),
  regularity — minus penalties (collisions, SPADs, skipped stations, delays, rule breaches) and energy.
* **Trains & purchases**: specifications and prices; buy trains (refused without enough money), pick which
  of your trains to drive. **Depot & fleet**: every vehicle has a unique ID, condition, odometer and maintenance
  interval; service, repair, sell; buy buses; account history. Worn vehicles (< 60 %) lose performance.
* Bus repairs are also done in the depot maintenance hall (paid as they progress); fuel and charging are paid.

## Online multiplayer

*Multiplayer* in the main menu: connect to a server, create or join a session (code or invite link), then drive
any line or bus route — the others see your vehicle in 3D and on the maps, trains on the same track are kept apart
by the server, arrivals and departures appear in the session feed. The server is in `server/` (Node, no
dependencies). **GitHub Pages can host the game but not the server** — see `docs/MULTIPLAYER.md` for free hosting.

## Grandes Lignes — Gare Centrale & the TGV network

Main menu → **🚄 Grandes Lignes — TGV**. Gare Centrale (above metro A · B · C) is the main-line station: monumental
façade with clock tower and copper domes, landscaped forecourt with fountains, taxis and buses, a great hall under a
coffered vault with a skylight (marble, colonnades, chandeliers, split-flap departure/arrival boards, cafés, brasserie,
boutiques, ticket offices and machines, first-class lounge, indoor trees, fountain, suspended sculpture), and a
glass-and-steel train shed over six islands (voies 1–12) reached by a footbridge. Travellers follow the boards to the
island of an upcoming departure and board only a train standing there; crowds follow rush hours.

| Departure (examples) | Destination | Journey | Identity |
|---|---|---|---|
| 06:30 | Montreval | 35 min | regional city, cathedral, river |
| 07:15 | Valdor | 55 min | coastal town, harbour, lighthouse |
| 08:00 | Clairmont | 1 h 10 | industrial & cultural, factories, opera |
| 09:00 | Saint-Roch-les-Alpes | 1 h 20 | mountain town, cable car, tunnels |
| 10:30 | Belle-Rive | 1 h 45 | large western river city |
| 12:00 | Port-Azur | 2 h 15 | southern coastal metropolis, marina |

- The country between the cities is streamed around the train: terrain, embankments, cuttings, viaducts, tunnels,
  catenary, forests, villages, sea coasts. TVM cab signalling (marker boards), 300–320 km/h, station zones at 160.
- Fleet: **TGV Duplex** (bi-level, 512 seats) and **TGV Classique** (377 seats), 1st/2nd class saloons, power cars.
- Board: train number, destination, calling points, track, duration, live status (on time, boarding, delayed, departed,
  arrived, cancelled). Assign owned trainsets to departures, drive one, hire a trainset, or run it with a company driver.
- Economy: tickets by distance, punctuality bonus (≤ 5 min), compensation (> 30 min), access charges, energy, crew, hire.
- Keys: **U** time acceleration ×1/×2/×5/×10 (main lines), **O** station tour camera (façade, forecourt, hall, shed,
  platforms, aerial). Lighting follows the clock: morning, day, golden hour, evening, night floodlighting.
- Regenerate the lines with `node tools/build-tgv.mjs` (alignment, terrain-fitted profile, tunnels, timing).

## Bus simulator (Grandville buses & Aéroval)

Choose **🚌 Bus** in the main menu. The bus mode is a separate simulator that shares only the core services
(input, audio, settings, saves) with the metro.

- **Modes**: Career (shifts from the depot, XP, unlocks), Timetable, Aéroval Airport, Free Roam, Custom Route.
- **World**: the airport district around Grandville International — terminals 1 & 2, cargo zone, exhibition centre,
  hotels, business district, long-term parking, rental-car centre, staff zone, shopping centre, industrial estate,
  residential streets, a 90 km/h motorway, a roundabout, traffic lights, zebra crossings, bus lanes and the depot.
- **Routes**: AV1 *Aéroval Terminaux – Expositions* (from the network plan), AV2 *Aéroval Hôtels & Affaires*,
  31 *Gare Routière – Les Coteaux*. Both directions.
- **Buses**: Urbano 12 (diesel), Urbano 18 G (articulated), Volta 12e (electric), Hybride 12h, Aéroval Shuttle 13,
  Duplex 11 DD (double-decker), Midi 10.5 LF (low-floor).
- **Driving a shift**: start the engine (**I**), release the parking brake (**P**), select **D** (**1**), follow the
  GPS to the first stop, stop with the front door at the pole, open the doors (**F** front, **G** rear), kneel if
  needed (**K**), close (**B**), indicate (**Q**/**E**) and pull out. After the last stop, return to the depot and
  apply the parking brake (career / timetable).
- **Cab**: instrument hood with cluster, driver information display, two switch consoles (gears, engine, lights,
  wipers, climate, retarder, mirrors, doors, kneeling, wheelchair ramp, hazards, stop-request reset, announcement),
  parking-brake valve, emergency stop, ticket machine (passengers paying cash wait for a ticket: **5**), and the
  red **ARRÊT DEMANDÉ** signs that light up when a passenger presses a stop button.
- **Crashes**: impulse physics at the contact point (masses, inertia, angle, grip, rotation, secondary impacts);
  damage where it hits (dents, cracked glass, broken lamps and mirrors, jammed doors, mechanical failures),
  passengers stumble or fall, emergency stop and incident report; damage stays until repaired.
- **Terrain**: the Les Coteaux suburb climbs about 3 % (route 31); the gradient acts on the bus.
- Bus stops at Terminal 1, Terminal 2 and the airport business district connect with Metro Line D (Aéroval).
- In the cab every control on the dashboard and consoles is clickable; drag the steering wheel with the mouse.
  Gamepad: RT/LT analogue pedals, left stick steering.

See `docs/BUS_FORMAT.md` for routes, networks and vehicles.

## How to drive a metro run

The cab desk has a **network screen**: click it (or press **G**) for the full interactive map of Lines A–D with
your train, the next station and the other players. Passengers board only trains going their way, and nobody
boards a terminating train; everyone alights at the terminus.


1. You start at the first platform. The controller is in **B7**, the doors are locked and the clock reads 50 s before departure.
2. Press **E** to open the doors on the platform side. Passengers alight and board.
3. When the dwell is complete, boarding is finished and the scheduled time is close, the **DEPARTURE** lamp lights. Press **F** to close the doors. The warning chime plays, then the doors close and lock (**DOORS LOCKED** lamp).
4. Press **W** to notch up to P1–P4. Traction stays cut until the doors are locked and the emergency brake is released.
5. Obey the permitted speed shown on the speedometer, the DMI and the lineside boards. Obey the signals as well. With ATP on, the emergency brake trips at the permitted speed + 7 km/h or before a red signal.
6. On Line B towards the branches, set the route before Parc Monceau junction with **J** (or the cab **ROUTE** button). The HUD and the DMI show the junction distance, the route that is set and your train's destination. If no route is set, the train is held before the points. If you set the wrong branch, the train goes there.
7. Brake with **S** (B1–B7) and stop at the **STOP** marker. The DMI shows a precision bar for the last 160 m. Every door must be on the platform before the doors will release.
8. At the terminus you get a score for stop accuracy, punctuality, safety and comfort, and you can drive back in the other direction.

Hitting the buffer stop or the train ahead faster than about 6 km/h ends the run with a crash cinematic: the impact in the cab, then a slow-motion replay. Press any key to skip it. Slower contact costs a penalty, and the run continues.

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
| Line C — Grandville Nord ⟲ Opéra | One-way terminal loop at République (Gare Centrale → Palais Royal → Opéra); interchanges with B at Grandville Nord and A/B at Place des Nations, République, Gare Centrale; Palais Royal (grand style) with a walking link to Line A |
| Line D — Aéroval | Platform screen doors at every station (synchronised with the train doors, obstruction detection, departure interlock). Automated elevated airport express (ATO, CBTC), entirely on viaducts: Aéroport International – Terminal 1 (Est) → Terminal 2 → Quartier des Affaires – Aéroport → Grandville Sud. Interchanges: Lines A and B at Terminal 1, Line A at Grandville Sud; Aéroval buses. Skybridges to both terminals, flight information displays, passenger interior view. Press **T** to drive manually. Generated by `npm run solve:line-d` |
| Line A — Grandville Centre ↔ Grandville Sud | 25 stations, 22 km arc, arch tunnel, fixed-block signals, track-works restriction at Val Fleuri |
| Line B — Grandville Nord ↔ Bellevue – Centre / Aéroport Est | Branching line: choose the destination at start and set the route at Parc Monceau junction. CBTC moving block, box tunnel. Walking connection Aéroport Est ↔ Aéroport International (Line A) |

A and B interchange at République and Gare Centrale. Saint-Augustin (Line B) uses the `grand` station style. After Mairie de Bellevue, the Bellevue branch climbs out of a tunnel portal onto a viaduct through the city, with elevated open-air stations. Every cab has a live line diagram above the windshield. An airport (runways, terminal, piers, aircraft, tower) is modelled above Aéroport Est; it is hidden for now because the station is underground. Line B's geometry is generated by `npm run solve:line-b` (`tools/solve-line-b.mjs`) so that the shared stations sit on Line A's.

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
