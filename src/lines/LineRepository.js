// Discovers lines and trains. Built-in content is plain JSON in src/data (any file dropped
// there is picked up automatically at build time); user lines are imported JSON files persisted
// in IndexedDB. The engine itself never hardcodes any line.
import { normalizeLine, expandServices, LineValidationError } from './LineSchema.js';
import { AssetStore } from '../core/AssetStore.js';
import { deriveTrainSpecs } from '../physics/TrainPhysics.js';
import { slugify } from '../core/util.js';
import exampleMinimal from '../data/example-minimal.json';

const builtInLines = import.meta.glob('../data/lines/*.json', { eager: true, import: 'default' });
const builtInTrains = import.meta.glob('../data/trains/*.json', { eager: true, import: 'default' });

export const EXAMPLE_LINE = exampleMinimal;

export class LineRepository {
  constructor() { this.lines = []; this.trains = []; this.errors = []; }

  addSource(raw, sourceId, builtIn) {
    const services = expandServices({ ...raw, id: raw.id || sourceId });
    for (const svc of services) this.lines.push(normalizeLine(svc, { id: svc.id || sourceId, builtIn, sourceId }));
  }

  async load() {
    this.lines = []; this.errors = [];
    for (const [file, raw] of Object.entries(builtInLines).sort(([a], [b]) => a.localeCompare(b))) {
      try { this.addSource(raw, raw.id || slugify(file.split('/').pop().replace(/\.json$/, '')), true); }
      catch (e) { this.errors.push(`${file}: ${e.message}`); }
    }
    for (const { id, json } of await AssetStore.listLines()) {
      try { this.addSource(json, id, false); } catch (e) { this.errors.push(`${id}: ${e.message}`); }
    }
    this.trains = Object.values(builtInTrains).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map(deriveTrainSpecs);
    return this;
  }

  /** Validates and stores a user line (all its services). Returns the first service. */
  async importLine(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new LineValidationError(`Invalid JSON: ${e.message}`); }
    const id = raw.id ? `custom-${slugify(raw.id)}` : `custom-${slugify(`${raw.network || ''}-${raw.line || raw.name || 'line'}`)}`;
    const services = expandServices({ ...raw, id });
    const lines = services.map((svc) => normalizeLine(svc, { id: svc.id, builtIn: false, sourceId: id }));
    await AssetStore.putLine(id, raw);
    this.lines = this.lines.filter((l) => l.sourceId !== id);
    this.lines.push(...lines);
    return lines[0];
  }
  async deleteLine(id) {
    const src = this.line(id)?.sourceId || id;
    await AssetStore.deleteLine(src);
    for (const k of await AssetStore.listAudioKeys(`${src}/`)) await AssetStore.deleteAudio(k);
    this.lines = this.lines.filter((l) => l.sourceId !== src);
  }
  /** All services of the same line (one for a simple line, one per branch for a branching line). */
  services(line) { return this.lines.filter((l) => l.sourceId === line.sourceId); }
  networks() { return [...new Set(this.lines.map((l) => l.network))]; }
  line(id) { return this.lines.find((l) => l.id === id); }
  train(id) { return this.trains.find((t) => t.id === id); }
}
