export interface AgentConfig {
  seed: number;
  debug: boolean;
  autoplay: boolean;
  paused: boolean;
  muted: boolean;
  // Run the whole sim N× faster (1–8). Scales the clock feeding decay, orbits,
  // Earth rotation, and revenue so seeded runs stay equivalent — built for
  // tests that would otherwise wait wall-clock minutes for a deorbit.
  timeScale: number;
}

const DEFAULTS: AgentConfig = {
  seed: 0xc0ffee,
  debug: false,
  autoplay: false,
  paused: false,
  muted: false,
  timeScale: 1,
};

function asInt(v: string | null, fallback: number): number {
  if (v == null) return fallback;
  const n = v.startsWith("0x") ? parseInt(v.slice(2), 16) : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

function asFloat(v: string | null, fallback: number): number {
  if (v == null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function readAgentConfig(search: string = location.search): AgentConfig {
  const p = new URLSearchParams(search);
  return {
    seed: asInt(p.get("seed"), DEFAULTS.seed),
    debug: asBool(p.get("debug"), DEFAULTS.debug),
    autoplay: asBool(p.get("autoplay"), DEFAULTS.autoplay),
    paused: asBool(p.get("paused"), DEFAULTS.paused),
    muted: asBool(p.get("muted"), DEFAULTS.muted),
    timeScale: clamp(asFloat(p.get("timeScale"), DEFAULTS.timeScale), 1, 8),
  };
}
