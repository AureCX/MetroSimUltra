# Bus content format

The bus simulator is data-driven like the metro. Files in these folders are picked up at build time:

| Folder | Content |
|---|---|
| `src/data/bus/vehicles/*.json` | Bus models (dimensions, mass, power, gearbox / battery, livery) |
| `src/data/bus/networks/*.json` | Road networks (nodes, roads, stops, districts, depot) |
| `src/data/bus/routes/*.json` | Routes |

Routes can also be **created in the game** (*Bus → Custom routes*: tick stops in order) or **imported** as JSON.
They are stored in the browser.

## Route

The format from the brief works as-is (stops are matched by name to the network's stops):

```json
{
  "route": "B12",
  "name": "Airport Express",
  "color": "#E6B800",
  "stops": [
    { "name": "Aéroport International – Terminal 1 (Est)", "dwellTime": 30 },
    { "name": "Aéroport International – Terminal 2 (Ouest)", "dwellTime": 25 },
    { "name": "Quartier d'Affaires de l'Aéroport", "dwellTime": 20 }
  ]
}
```

| Field | Default | Meaning |
|---|---|---|
| `route` | required | Route number shown on the bus displays and stops. |
| `name`, `color`, `textColor` | — | Name and branding. |
| `network` | first network | Network id the stops belong to. |
| `operator` | `grandville` | `aeroval` puts the route in the Aéroval network (yellow branding, airport demand, all-door boarding on shuttles). Route numbers starting with `AV` are Aéroval automatically. |
| `type` | `urban` / `airport` | Demand profile: commuter rush hours, or flight waves. |
| `language` | `fr-FR` | Speech-synthesis language of announcements. |
| `headway` | 600 | Seconds between departures (stop displays, depot board). |
| `stops[].dwellTime` | 20 | Minimum dwell in seconds (timetable). |

The driving path is not written in the file: the game finds the shortest legal road path between consecutive
stops (including the side of the road each stop is on), so it follows the network's one-way rules, roundabouts and
turning circles. Both directions are generated from the same file.

**Announcements:** in the route screen, import MP3 files named `<stop-id>.mp3` (interior “next stop”) or
`<stop-id>-outside.mp3` (exterior “line … destination …” when the doors open). Otherwise speech synthesis is used.

## Network

```json
{
  "id": "grandville-est", "name": "Grandville Est – Aéroport",
  "nodes": [ { "id": "n1", "x": 0, "z": 0, "signal": true }, { "id": "r1", "x": 500, "z": 0, "roundabout": 22 } ],
  "edges": [ { "a": "n1", "b": "r1", "name": "Avenue …", "speed": 50, "lanes": 2, "busLane": true } ],
  "stops": [ { "id": "t1", "name": "Terminal 1", "edge": ["n1", "r1"], "along": 120, "demand": 3, "aeroval": true, "metro": ["A", "B"] } ],
  "crossings": [ { "edge": ["n1", "r1"], "along": 300 } ],
  "blocks": [ { "x0": 0, "z0": 0, "x1": 300, "z1": 280, "type": "business", "name": "…" } ],
  "depot": { "name": "…", "x0": …, "z0": …, "x1": …, "z1": …, "exitNode": "…", "start": { "x": …, "z": …, "heading": 0 },
             "bays": { "fuel": [x, z], "charge": [x, z], "wash": [x, z], "maintenance": [x, z] } },
  "airport": { "x": 0, "z": 0 },
  "terrain": { "axis": "z", "profile": [[620, 0], [920, 9], [1210, 18]] }
}
```

* Coordinates in metres, `+x` east, `+z` south. Traffic drives on the right.
* `signal`: traffic lights (two phases) with zebra crossings; other junctions use priority to the faster road, then
  priority to the right. `roundabout`: radius in metres (also used for turning circles at dead ends).
* `lanes`: lanes per direction (1 or 2); `busLane` makes the kerb lane a red bus-only lane.
* A stop exists on both sides of its road. `demand` scales waiting passengers; `metro` lists interchange lines.
* `terrain` (optional): ground height in metres, piecewise linear along `axis` and constant beyond the end points.
  Put the break points on rows of nodes so roads between nodes follow the slope exactly. The bus feels the gradient
  (climbing, downhill braking, retarder).
* `blocks.type`: `business`, `hotel`, `parking`, `rental`, `staff`, `expo`, `commercial`, `industrial`, `residential`, `depot`.

## Vehicle

| Field | Meaning |
|---|---|
| `length`, `width`, `height`, `wheelbase`, `frontOverhang` | Dimensions (m). Articulated: `trailerLength`, `hitchBehindRear`, `trailerAxle`. |
| `mass`, `capacity`, `seats` | Empty mass (kg) and passengers. Passengers add 72 kg each. |
| `doors` | Door centres, metres from the front. Door 1 is for boarding. |
| `powertrain` | `diesel`, `electric` or `hybrid`. |
| `power` (kW), `torque` (Nm), `gears`, `finalDrive`, `idleRpm`, `maxRpm`, `fuelCapacity` | Diesel / hybrid drive (torque-converter automatic). |
| `battery` (kWh), `auxPower` (kW), `regen` | Electric: energy, HVAC load, regenerative braking share. |
| `maxSpeed`, `brakeDecel`, `steerMax`, `rollStiffness`, `maxAccel` | Handling. |
| `livery` | `body`, `stripe`, `skirt`, `seats` colours. `aeroval: true` = Aéroval shuttle. |
