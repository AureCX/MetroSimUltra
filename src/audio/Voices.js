// Announcement voices. Four profiles, each a distinct voice: the browser's French voices are sorted into female and
// male (by name, and different voices are used for profiles of the same gender when the system has several), and
// every profile has its own pitch, rate and its own three-note chime, so no two profiles sound alike even on a
// system with a single French voice. Services and destinations get their own voice ('auto').
export const VOICE_PROFILES = {
  female: { label: 'Voix féminine', gender: 'f', pitch: 1.12, rate: 0.98, chime: [659, 784, 988], gap: 0.32 },
  male: { label: 'Voix masculine', gender: 'm', pitch: 0.82, rate: 0.95, chime: [523, 659, 784], gap: 0.32 },
  calm: { label: 'Voix calme et posée', gender: 'f', pitch: 0.98, rate: 0.84, chime: [587, 740, 880], gap: 0.42, alt: true },
  formal: { label: 'Voix claire et formelle', gender: 'm', pitch: 0.95, rate: 1.05, chime: [698, 880, 1047], gap: 0.26, alt: true },
};
export const VOICE_KEYS = Object.keys(VOICE_PROFILES);

const FEMALE = /(am[ée]lie|audrey|aur[ée]lie|marie|virginie|c[ée]line|julie|hortense|denise|chantal|sylvie|l[ée]a|elsa|eloise|vivienne|brigitte|female|femme|woman|sandy|shelley|flo|grandma|samantha|google fran)/i;
const MALE = /(thomas|paul|henri|nicolas|claude|antoine|mathieu|jacques|daniel|guillaume|yannick|gerard|g[ée]rard|remy|r[ée]my|eddy|reed|rocko|grandpa|male|homme|man\b)/i;

/** French (or `lang`) voices of the system, split by gender. */
export function voicesFor(lang = 'fr-FR') {
  if (!('speechSynthesis' in globalThis)) return { f: [], m: [], any: [] };
  const all = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  const f = all.filter((v) => FEMALE.test(v.name) && !MALE.test(v.name)), m = all.filter((v) => MALE.test(v.name));
  return { f, m, any: all };
}
/** The concrete voice of a profile: its gender if available, a different voice for the 'alt' profiles. */
export function pickVoice(profile, lang = 'fr-FR') {
  const p = VOICE_PROFILES[profile] || VOICE_PROFILES.female, v = voicesFor(lang);
  const pool = (p.gender === 'f' ? v.f : v.m).length ? (p.gender === 'f' ? v.f : v.m) : v.any;
  if (!pool.length) return null;
  return pool[p.alt && pool.length > 1 ? 1 : 0];
}
/** 'auto' → a voice per service/destination (stable), otherwise the chosen profile. */
// Default voice of each main-line service (every profile is heard on the network).
export const SERVICE_VOICE = { 'tgv-montreval': 'female', 'tgv-valdor': 'male', 'tgv-clairmont': 'formal', 'tgv-saint-roch-les-alpes': 'calm', 'tgv-belle-rive': 'male', 'tgv-port-azur': 'calm' };
export function profileFor(setting, key = '') {
  if (setting && setting !== 'auto' && VOICE_PROFILES[setting]) return setting;
  if (SERVICE_VOICE[key]) return SERVICE_VOICE[key];
  let h = 0x811c9dc5; for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return VOICE_KEYS[h % VOICE_KEYS.length];
}
