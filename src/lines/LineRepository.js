// Discovers lines and trains. Built-in content is plain JSON under /public, user lines are
// imported JSON files persisted in IndexedDB. The engine never hardcodes any line.
import { normalizeLine, LineValidationError } from './LineSchema.js';
import { AssetStore } from '../core/AssetStore.js';
import { deriveTrainSpecs } from '../physics/TrainPhysics.js';
import { slugify } from '../core/util.js';

const base = import.meta.env?.BASE_URL ?? './';

async function getJSON(path) {
  const r = await fetch(`${base}${path}`);
  if (!r.ok) throw new Error(`Cannot load ${path} (${r.status})`);
  return r.json();
}

export class LineRepository {
  constructor() { this.lines = []; this.trains = []; this.errors = []; }

  async load() {
    this.lines = []; this.errors = [];
    try {
      const idx = await getJSON('lines/index.json');
      for (const file of idx.lines) {
        try {
          const raw = await getJSON(`lines/${file}`);
          const line = normalizeLine(raw, { id: raw.id || slugify(file.replace(/\.json$/, '')), builtIn: true });
          line.baseUrl = `${base}lines/`;
          for (const st of line.stations) if (st.announcement && !/^(https?:|\/|data:)/.test(st.announcement)) st.announcement = `${line.baseUrl}${st.announcement}`;
          this.lines.push(line);
        } catch (e) { this.errors.push(`${file}: ${e.message}`); }
      }
    } catch (e) { this.errors.push(e.message); }
    for (const { id, json } of await AssetStore.listLines()) {
      try { this.lines.push(normalizeLine(json, { id, builtIn: false })); } catch (e) { this.errors.push(`${id}: ${e.message}`); }
    }
    const tIdx = await getJSON('trains/index.json');
    this.trains = [];
    for (const file of tIdx.trains) this.trains.push(deriveTrainSpecs(await getJSON(`trains/${file}`)));
    return this;
  }

  /** Validates and stores a user line. Returns the normalised line. */
  async importLine(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new LineValidationError(`Invalid JSON: ${e.message}`); }
    const id = raw.id ? `custom-${slugify(raw.id)}` : `custom-${slugify(`${raw.network || ''}-${raw.line || raw.name || 'line'}`)}`;
    const line = normalizeLine(raw, { id, builtIn: false });
    await AssetStore.putLine(id, raw);
    this.lines = this.lines.filter((l) => l.id !== id);
    this.lines.push(line);
    return line;
  }
  async deleteLine(id) {
    await AssetStore.deleteLine(id);
    for (const k of await AssetStore.listAudioKeys(`${id}/`)) await AssetStore.deleteAudio(k);
    this.lines = this.lines.filter((l) => l.id !== id);
  }
  networks() { return [...new Set(this.lines.map((l) => l.network))]; }
  line(id) { return this.lines.find((l) => l.id === id); }
  train(id) { return this.trains.find((t) => t.id === id); }
}
