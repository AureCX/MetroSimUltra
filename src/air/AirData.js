// Aviation data: the seven airports of the Grandville network (placed next to the existing cities of the TGV map, in
// the same world coordinates: metres, x east, z south, y up), the aircraft types and the airlines.
// Headings are compass headings in degrees (0 = north = −z, 90 = east = +x).

export const AIRPORTS = [
  {
    id: 'GRV', cityPos: { x: 3570, z: 200, y: 6 }, icao: 'LFGV', name: 'Grandville International', city: 'Grandville', size: 'international',
    x: -5600, z: 4200, runways: [
      { id: '12L/30R', hdg: 120, length: 3400, width: 45, offset: -380 },
      { id: '12R/30L', hdg: 120, length: 3000, width: 45, offset: 380, shift: 300 },
    ], stands: 18, terminal: 'large',
  },
  { id: 'MTV', cityPos: { x: 139007, z: -5456, y: 54 }, icao: 'LFMT', name: 'Montreval – Saint-Aubin', city: 'Montreval', size: 'regional', x: 146000, z: 2500, runways: [{ id: '09/27', hdg: 90, length: 2800, width: 45, offset: 0 }], stands: 6, terminal: 'medium' },
  { id: 'VLD', cityPos: { x: -213149, z: -55630, y: 42 }, icao: 'LFVD', name: 'Valdor Côte Atlantique', city: 'Valdor', size: 'regional', x: -205000, z: -49000, runways: [{ id: '11/29', hdg: 110, length: 2600, width: 45, offset: 0 }], stands: 5, terminal: 'medium' },
  { id: 'CLM', cityPos: { x: 19440, z: -282833, y: 32 }, icao: 'LFCL', name: 'Clairmont – Les Forges', city: 'Clairmont', size: 'regional', x: 27000, z: -276000, runways: [{ id: '01/19', hdg: 10, length: 2700, width: 45, offset: 0 }], stands: 5, terminal: 'medium' },
  { id: 'SRA', cityPos: { x: 252566, z: 64167, y: 1290 }, icao: 'LFSR', name: 'Saint-Roch-les-Alpes Altiport', city: 'Saint-Roch-les-Alpes', size: 'altiport', x: 246000, z: 58000, runways: [{ id: '14/32', hdg: 140, length: 2100, width: 40, offset: 0 }], stands: 4, terminal: 'small' },
  { id: 'BLR', cityPos: { x: -401979, z: -23336, y: 69 }, icao: 'LFBR', name: 'Belle-Rive Atlantique', city: 'Belle-Rive', size: 'regional', x: -394000, z: -15000, runways: [{ id: '08/26', hdg: 80, length: 3000, width: 45, offset: 0 }], stands: 7, terminal: 'medium' },
  { id: 'PAZ', cityPos: { x: 313117, z: 269426, y: 31 }, icao: 'LFPZ', name: 'Port-Azur Méditerranée', city: 'Port-Azur', size: 'large', x: 303000, z: 262000, runways: [{ id: '15/33', hdg: 150, length: 3000, width: 45, offset: 0 }], stands: 10, terminal: 'large' },
];
export const airport = (id) => AIRPORTS.find((a) => a.id === id);

/**
 * Aircraft types. Masses in kg, wing area m², thrust per engine N (sea level static), lengths in m, speeds in m/s
 * (vr: rotation, vref: final approach), fuelBurn kg/h at cruise, range-relevant fuel capacity kg.
 * Aerodynamics: cl0, cla (per rad), clmax clean / with full flaps, cd0, k (induced), alphaStall (rad).
 * Handling: roll / pitch / yaw authority and damping (normalised moment coefficients), steering geometry.
 */
export const AIRCRAFT = {
  atr72: {
    id: 'atr72', name: 'ATR 72-600 style', short: 'AT76', maker: 'ATR', kind: 'turboprop', engines: 2, seats: 70, price: 320000, lease: 900,
    massEmpty: 13500, mtow: 23000, fuelMax: 5000, fuelBurn: 650, wingArea: 61, span: 27.05, length: 27.2, height: 7.65,
    thrust: 2 * 21000, power: 2 * 2050e3, cruise: 140, ceiling: 7600, vr: 55, vref: 61, vmo: 128,
    cl0: 0.35, cla: 5.6, clmax: 1.6, clmaxFlaps: 2.6, cd0: 0.028, k: 0.042, alphaStall: 0.27,
    flaps: [0, 15, 30], gearDrag: 0.018, roll: 1.2, pitch: 1.4, yaw: 0.9, wheelbase: 10.8, gearHeight: 1.5, mainGearX: 2.05, tailstrike: 9,
    fuselageR: 1.4, highWing: true, sound: 'prop', costPerHour: 900,
  },
  a320: {
    id: 'a320', name: 'A320-style', short: 'A320', maker: 'Airbus', kind: 'jet', engines: 2, seats: 174, price: 820000, lease: 2200,
    massEmpty: 42600, mtow: 78000, fuelMax: 19000, fuelBurn: 2400, wingArea: 122.6, span: 35.8, length: 37.57, height: 11.76,
    thrust: 2 * 120000, cruise: 230, ceiling: 12000, vr: 73, vref: 70, vmo: 180,
    cl0: 0.3, cla: 5.3, clmax: 1.5, clmaxFlaps: 2.9, cd0: 0.022, k: 0.038, alphaStall: 0.26,
    flaps: [0, 1, 2, 3, 4], gearDrag: 0.016, roll: 1.0, pitch: 1.0, yaw: 0.7, wheelbase: 12.6, gearHeight: 2.2, mainGearX: 3.8, tailstrike: 11.7,
    fuselageR: 1.98, sidestick: true, sound: 'jet', costPerHour: 2100,
  },
  a321: {
    id: 'a321', name: 'A321-style', short: 'A321', maker: 'Airbus', kind: 'jet', engines: 2, seats: 220, price: 980000, lease: 2600,
    massEmpty: 48500, mtow: 93500, fuelMax: 23500, fuelBurn: 2750, wingArea: 122.6, span: 35.8, length: 44.51, height: 11.76,
    thrust: 2 * 133000, cruise: 230, ceiling: 12000, vr: 77, vref: 75, vmo: 180,
    cl0: 0.3, cla: 5.3, clmax: 1.5, clmaxFlaps: 3.0, cd0: 0.023, k: 0.038, alphaStall: 0.25,
    flaps: [0, 1, 2, 3, 4], gearDrag: 0.016, roll: 0.9, pitch: 0.85, yaw: 0.65, wheelbase: 16.9, gearHeight: 2.2, mainGearX: 3.8, tailstrike: 9.7,
    fuselageR: 1.98, sidestick: true, sound: 'jet', costPerHour: 2400,
  },
  b737: {
    id: 'b737', name: '737-800-style', short: 'B738', maker: 'Boeing', kind: 'jet', engines: 2, seats: 189, price: 800000, lease: 2150,
    massEmpty: 41400, mtow: 79000, fuelMax: 20800, fuelBurn: 2450, wingArea: 124.6, span: 35.8, length: 39.5, height: 12.5,
    thrust: 2 * 117000, cruise: 230, ceiling: 12500, vr: 74, vref: 72, vmo: 175,
    cl0: 0.3, cla: 5.2, clmax: 1.45, clmaxFlaps: 2.8, cd0: 0.023, k: 0.04, alphaStall: 0.26,
    flaps: [0, 1, 5, 15, 30, 40], gearDrag: 0.016, roll: 1.0, pitch: 1.0, yaw: 0.7, wheelbase: 15.6, gearHeight: 2.0, mainGearX: 2.85, tailstrike: 11,
    fuselageR: 1.88, sound: 'jet', costPerHour: 2050,
  },
  b777: {
    id: 'b777', name: '777-300ER-style', short: 'B77W', maker: 'Boeing', kind: 'jet', engines: 2, seats: 396, price: 2600000, lease: 7400,
    massEmpty: 167800, mtow: 351500, fuelMax: 145000, fuelBurn: 7500, wingArea: 436.8, span: 64.8, length: 73.9, height: 18.5,
    thrust: 2 * 513000, cruise: 245, ceiling: 13100, vr: 85, vref: 76, vmo: 185,
    cl0: 0.32, cla: 5.4, clmax: 1.5, clmaxFlaps: 2.7, cd0: 0.021, k: 0.036, alphaStall: 0.25,
    flaps: [0, 1, 5, 15, 20, 25, 30], gearDrag: 0.018, roll: 0.7, pitch: 0.7, yaw: 0.5, wheelbase: 31.2, gearHeight: 3.0, mainGearX: 5.5, tailstrike: 9.5,
    fuselageR: 3.1, sound: 'jet', costPerHour: 6200,
  },
};
export const AIRCRAFT_IDS = Object.keys(AIRCRAFT);

export const AIRLINES = [
  { code: 'GV', name: 'Air Grandville', color: '#1b2a4a', accent: '#b48a3c', fleet: ['a320', 'a321', 'b777', 'atr72'] },
  { code: 'VA', name: 'Valdor Air', color: '#0f6b8a', accent: '#f2c200', fleet: ['atr72', 'b737'] },
  { code: 'AZ', name: 'Azur Express', color: '#e4002b', accent: '#ffffff', fleet: ['a320', 'b737'] },
  { code: 'AC', name: 'Alpes Connect', color: '#2e9e4f', accent: '#ffffff', fleet: ['atr72'] },
];
export const airlineOf = (code) => AIRLINES.find((a) => a.code === code) || AIRLINES[0];

/** Runway geometry helpers (heading → unit vector in world xz). */
export const hdgVec = (hdg) => { const r = (hdg * Math.PI) / 180; return { x: Math.sin(r), z: -Math.cos(r) }; };
export const vecHdg = (x, z) => ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
/** Both ends of runway rw of airport ap: { a: {x,z,hdg,name}, b: {...}, cx, cz, len, width }. */
export function runwayEnds(ap, rw) {
  const d = hdgVec(rw.hdg), n = { x: -d.z, z: d.x };
  const cx = ap.x + n.x * (rw.offset || 0) + d.x * (rw.shift || 0), cz = ap.z + n.z * (rw.offset || 0) + d.z * (rw.shift || 0);
  const [n1, n2] = rw.id.split('/');
  return {
    cx, cz, len: rw.length, width: rw.width, dir: d, normal: n,
    a: { x: cx - d.x * rw.length / 2, z: cz - d.z * rw.length / 2, hdg: rw.hdg, name: n1 },           // threshold for landing towards hdg
    b: { x: cx + d.x * rw.length / 2, z: cz + d.z * rw.length / 2, hdg: (rw.hdg + 180) % 360, name: n2 },
  };
}
export const distKm = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) / 1000;
