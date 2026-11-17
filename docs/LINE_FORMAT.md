# Line file format

Lines are plain JSON. The engine contains no line data: everything below is read at runtime,
either from `src/data/lines/*.json` (built-in; every file in that folder is picked up
automatically) or imported from **Select Line → Import line JSON** (stored in the browser).

The minimal format from the original brief is valid as-is (`src/data/example-minimal.json`, also
shown by the **Example file** button):

```json
{
  "line": "Line 1",
  "color": "#FFCC00",
  "stations": [
    { "name": "La Défense", "distanceToNext": 1200, "speedLimit": 70, "stopDuration": 25 },
    { "name": "Esplanade de La Défense", "distanceToNext": 850, "speedLimit": 60, "stopDuration": 20 },
    { "name": "Pont de Neuilly", "distanceToNext": 0 }
  ]
}
```

## Line fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `line` (or `name`) | string | — | Line name shown everywhere. |
| `number` | string | digits in name | Short code on badges, DMI, destination blinds. |
| `id` | string | from network + name | Stable ID (records and imported MP3s are keyed by it). |
| `network` | string | `"Custom lines"` | Lines sharing a network are drawn on the same map. |
| `color` / `textColor` | hex | `#ffcc00` / auto | Line colour and badge text colour. |
| `language` | BCP-47 | `en-GB` | Voice used for speech-synthesis announcements. |
| `maxSpeed` | km/h | 80 | Absolute line maximum. |
| `startTime` | `"HH:MM[:SS]"` | `06:30:00` | Departure of the player's train from the first stop. |
| `headway` | s | 180 | Interval between trains (AI traffic both directions). |
| `trackSpacing` | m | 3.8 | Distance between the two track centres. |
| `tunnel.profile` | `arch` \| `box` | `arch` | Bored tube-style arch or cut-and-cover box tunnel. |
| `map.origin` | `[x, y]` m | `[0,0]` | Position of the line's start on the network map. |
| `map.heading` | degrees | 0 | Initial direction (0 = north/up, 90 = east). Curves in `track` then shape the line. |
| `defaults` | object | — | Default values for any station field below. |
| `signaling` | object | see below | Signalling system. |
| `speedRestrictions` | array | `[]` | Temporary/permanent speed restrictions. |
| `directions.A.name` / `directions.B.name` | string | `Direction <terminus>` | A = first → last station, B = reverse. |
| `announcements` | object | English | Templates: `nextStation`, `arrival`, `terminus`; `{station}` and `{line}` are substituted. |

### Branching lines (`branches`)

A line that forks (like Line B) lists its trunk in `stations` and each branch in `branches`.
The line appears once in the menu. Before starting you pick the destination (direction A) or
the branch you start from (direction B). All branches are built into the same world, with a
junction chamber where the tunnels part. Driving towards the branches, the driver must set the
route at the junction (key **J** or the cab **ROUTE** button): until a route is set, the
signal/movement authority protecting the points stays at danger. If the wrong branch is set, the
train really takes it and the run continues on that branch with a penalty.

```json
"stations": [ …trunk…, { "name": "Parc Monceau", "speedLimit": 65 } ],
"branches": [
  { "id": "bellevue", "name": "Bellevue – Centre",
    "link": { "distanceToNext": 1150, "track": [ { "length": 60 }, { "length": 806, "radius": 330, "turn": "left" } ] },
    "stations": [ { "name": "Mairie de Bellevue", "distanceToNext": 1000 }, … ] }
]
```

`link` is merged into the last trunk station (the junction): it holds the distance, speed limit
and track layout from the junction to the branch's first station.

### `signaling`

```json
{ "system": "fixed-block", "blockLength": 320, "overlap": 40, "atpBrakeRate": 0.85 }
```

* `fixed-block` — automatic 3-aspect lineside signals (green / yellow / red). A starter after each
  platform, a home signal before each platform, block signals in between at most `blockLength` m
  apart. A signal shows red while its block plus `overlap` is occupied. Passing a red signal (SPAD)
  trips the emergency brake. With ATP on, a braking curve (`atpBrakeRate`, m/s²) supervises the
  approach to a red signal.
* `cbtc` — moving block: no lineside block signals; the cab receives a limit of movement authority
  45 m behind the train ahead and supervision is always active.

### `speedRestrictions`

```json
{ "fromStation": "Les Sablons", "start": 200, "length": 260, "limit": 40, "direction": "A", "reason": "Track works" }
```

`start`/`length` are metres measured from the centre of `fromStation` towards the next station
(direction A). Without `fromStation`, metres are measured from the first station. Omit `direction`
for both directions. Lineside warning and execution boards are generated automatically.

## Station fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | required | Station name. |
| `id` | string | slug of name | Used to match imported MP3s. |
| `distanceToNext` | m | required (≥150) except last | Platform centre to next platform centre. |
| `speedLimit` | km/h | `maxSpeed` | Line speed on the section towards the next station. |
| `approachSpeedLimit` | km/h | 50 | Limit when entering this platform. |
| `approachDistance` | m | 120 | Distance before the platform where the approach limit starts. |
| `stopDuration` | s | 20 | Minimum dwell (doors open). Shortened to 60 % when running late. |
| `runTime` | s | computed | Scheduled run time to the next station; otherwise computed from the chosen train with a 6 % recovery margin. |
| `platformLength` | m | 110 | Platform length. Every door must be on the platform to release doors. |
| `platformWidth` | m | 4.5 | Platform width. |
| `platformType` | `side` \| `island` | `side` | Side platforms (doors right) or island (tracks spread around it, doors left). |
| `stopMarkerOffset` | m | 4 | Stop marker distance from the far platform end. |
| `style` | `vault` \| `pillars` \| `modern` \| `grand` | `vault` | Architecture: tiled vault, flat ceiling with columns, contemporary, or a grand hall (ribbed coffered vault, stained-glass skylight, chandeliers, marble, mezzanine, mosaic murals, clock). |
| `theme.wall` / `theme.accent` / `theme.vault` | hex | style / line colour | Wall colour, accent colour, and (grand style) vault colour. |
| `passengers` | 0–60 | 18 | Waiting passengers per platform. |
| `announcement` | path / URL | — | MP3 played as next-station announcement (relative to the line file). |
| `announcementText` | string | — | Custom speech text for this station. |
| `track` | array | straight & level | Alignment between this station and the next (see below). |
| `connections` | array of names | `[]` | Walking connections to stations with another name (drawn dashed on the map), e.g. `["Aéroport International"]`. Stations with the same name on different lines are interchanges automatically. |

### `track` segments

Segments are laid one after another starting 25 m beyond the departure platform; anything left
over to the next platform is straight and level. Platforms are always straight and level.

```json
"track": [
  { "length": 200 },
  { "length": 380, "radius": 650, "turn": "left", "gradient": -22 },
  { "length": 300, "gradient": 12 }
]
```

* `radius` (m, ≥ 60) and `turn` (`left`/`right`, direction A) make a curve. Transition curves are
  generated automatically. Tight curves add curve resistance and flange squeal.
* `portal`: `"exit"` (leave the tunnel at the start of this segment) or `"enter"` (go underground).
  Between an exit and the next enter portal the line runs in the open air: ground level is the
  track level at the portal + 5.5 m, so climb out with a gradient (e.g. 40 ‰ over 160 m) after the
  portal to reach the surface. Cuttings, embankments, portal headwalls, fences, a road, buildings,
  trees, daylight and open-air canopy stations are generated automatically.
* `gradient` in ‰, positive = uphill in direction A. Vertical curves are smoothed automatically.
  Gradients act on the train physics (it will roll back on an up-grade if you release the brake).

## Announcements (MP3)

Priority for each announcement: imported MP3 → `announcement` file from the line → speech synthesis.

Import from **Select Line → Import MP3 announcements**. Files are matched by name:

* `<station-id>.mp3` — next-station announcement (played ~7 s after departure, or with the cab ANNOUNCE button)
* `<station-id>-arrival.mp3` — played when stopping at the station
* `<station-id>-terminus.mp3` — played when arriving at the terminus

Station ids are shown in the station table (they are the slug of the name, e.g.
`charles-de-gaulle-etoile`). Single files can also be attached per row with the **＋** button.

## Trains

Trains live in `src/data/trains/*.json` (picked up automatically, sorted by `order`). All fields are optional:

| Field | Meaning |
|---|---|
| `cars`, `carLength`, `carGap`, `width`, `height` | Formation and dimensions (m). |
| `doorsPerSide`, `doorWidth` | Door layout (per car). |
| `massEmpty` (t), `capacity` | Mass and passenger capacity (passenger load adds mass). |
| `maxPower` (kW), `maxTractiveForce` (kN), `maxSpeed` (km/h) | Traction curve: constant force, then constant power. |
| `serviceDecel`, `emergencyDecel` (m/s²) | Full-service and emergency braking rates. |
| `tractionNotches`, `brakeNotches` | Master controller notches. |
| `tractionResponse`, `brakeResponse` (s), `tractionDeadTime`, `brakeDeadTime` (s) | Actuator ramp time and dead time. |
| `davis.{a,b,c}` | Running resistance R = m·(a + b·v) + c·v² (N, t, km/h). |
| `livery.{body,front,stripe,doors,roof}` | Colours. |
| `sound.inverter` (`gto`/`igbt`), `sound.motorPitch` | Traction sound character. |
