// Bus content: vehicles, road networks and routes (JSON in src/data/bus, picked up at build
// time) plus user routes imported or created in the menu (IndexedDB). Validates route files.
import { AssetStore } from '../core/AssetStore.js';
import { normalizeRoute, RouteError } from './RouteSchema.js';

export { normalizeRoute, RouteError };

const vehicles = import.meta.glob('../data/bus/vehicles/*.json', { eager: true, import: 'default' });
const networks = import.meta.glob('../data/bus/networks/*.json', { eager: true, import: 'default' });
const routes = import.meta.glob('../data/bus/routes/*.json', { eager: true, import: 'default' });
const PREFIX = 'busroute:';

export class BusRepository {
  async load() {
    this.vehicles = Object.values(vehicles).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    this.networks = Object.values(networks);
    this.routes = []; this.errors = [];
    for (const [f, r] of Object.entries(routes)) { try { this.routes.push(normalizeRoute(r, this.networks, { builtIn: true })); } catch (e) { this.errors.push(`${f}: ${e.message}`); } }
    for (const { id, json } of await AssetStore.listLines()) {
      if (!String(id).startsWith(PREFIX)) continue;
      try { this.routes.push(normalizeRoute(json, this.networks)); } catch (e) { this.errors.push(`${id}: ${e.message}`); }
    }
    return this;
  }
  network(id) { return this.networks.find((n) => n.id === id) || this.networks[0]; }
  vehicle(id) { return this.vehicles.find((v) => v.id === id); }
  route(id) { return this.routes.find((r) => r.id === id); }
  async saveRoute(raw) {
    const r = normalizeRoute(raw, this.networks);
    await AssetStore.putLine(PREFIX + r.id, raw);
    this.routes = this.routes.filter((x) => x.id !== r.id); this.routes.push(r);
    return r;
  }
  async deleteRoute(id) { await AssetStore.deleteLine(PREFIX + id); this.routes = this.routes.filter((r) => r.id !== id); }
}

/** Career progression: levels from XP, unlocked vehicles and routes. */
export const CAREER = {
  level: (xp) => 1 + Math.floor(xp / 1200),
  vehicleLevel: { urbano12: 1, midi10: 1, hybrid12: 2, volta12e: 2, urbano18: 3, duplex11: 4, aeroshuttle: 2 },
  routeLevel: (r) => (r.operator === 'aeroval' ? 2 : 1),
};
