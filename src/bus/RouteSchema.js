// Validation / normalisation of bus route files (pure, testable).
import { slugify } from '../core/util.js';

export class RouteError extends Error {}

export function normalizeRoute(raw, nets, { builtIn = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new RouteError('A route file must contain a JSON object.');
  const number = String(raw.route ?? raw.number ?? '').trim();
  if (!number) throw new RouteError('Missing "route" (route number).');
  if (!Array.isArray(raw.stops) || raw.stops.length < 2) throw new RouteError('A route needs at least two stops.');
  const net = nets.find((n) => n.id === raw.network) || nets[0];
  const names = new Set(net.stops.map((s) => s.name));
  const bad = raw.stops.filter((s) => !names.has(s?.name)).map((s) => s?.name);
  if (bad.length) throw new RouteError(`Unknown stop(s) in network "${net.name}": ${bad.join(', ')}`);
  const aeroval = raw.operator === 'aeroval' || /^AV/i.test(number);
  return {
    id: raw.id || slugify(`${net.id}-${number}`), builtIn, raw,
    route: number, name: String(raw.name || number), color: raw.color || (aeroval ? '#FFD000' : '#1f4fa0'),
    textColor: raw.textColor || (aeroval ? '#16233a' : '#ffffff'), network: net.id, operator: aeroval ? 'aeroval' : raw.operator || 'grandville',
    type: raw.type || (aeroval ? 'airport' : 'urban'), language: raw.language || 'fr-FR', headway: Number(raw.headway) || 600,
    stops: raw.stops.map((s) => ({ name: s.name, dwellTime: Math.max(5, Number(s.dwellTime) || 20) })),
  };
}

