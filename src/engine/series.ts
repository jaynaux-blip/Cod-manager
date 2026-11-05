/**
 * A CDL-format best-of-5 series: HP, S&D, Control, HP, S&D.
 */
import { simulateControl } from "./control";
import { simulateHardpoint } from "./hardpoint";
import { mapsForMode, MAP_POOL } from "./maps";
import { Rng } from "./rng";
import { simulateSnd } from "./snd";
import { emptyStats, type GameMap, type MapResult, type Mode, type PlayerStats, type SeriesResult, type Team, type TeamIndex } from "./types";

export const SERIES_FORMAT: Mode[] = ["hardpoint", "snd", "control", "hardpoint", "snd"];
export const MAPS_TO_WIN = 3;

export function simulateMap(rng: Rng, mode: Mode, map: GameMap, teams: [Team, Team]): MapResult {
  switch (mode) {
    case "hardpoint":
      return simulateHardpoint(rng, map, teams);
    case "snd":
      return simulateSnd(rng, map, teams);
    case "control":
      return simulateControl(rng, map, teams);
  }
}

export interface SeriesOptions {
  seed: string;
  mapPool?: GameMap[];
  /** Explicit map picks per game, overriding the random draw. */
  maps?: GameMap[];
}

export function simulateSeries(teams: [Team, Team], opts: SeriesOptions): SeriesResult {
  const rng = new Rng(opts.seed);
  const pool = opts.mapPool ?? MAP_POOL;
  const picks = opts.maps ?? drawMaps(rng, pool);
  const maps: MapResult[] = [];
  const mapScore: [number, number] = [0, 0];

  for (let i = 0; i < SERIES_FORMAT.length; i++) {
    const mode = SERIES_FORMAT[i];
    const result = simulateMap(rng.fork(`map${i}`), mode, picks[i], teams);
    maps.push(result);
    mapScore[result.winner]++;
    if (mapScore[result.winner] >= MAPS_TO_WIN) break;
  }

  const winner: TeamIndex = mapScore[0] > mapScore[1] ? 0 : 1;
  return { seed: opts.seed, teams, maps, mapScore, winner, stats: aggregateStats(maps) };
}

/** Pick one map per game without repeating a map within the series where possible. */
export function drawMaps(rng: Rng, pool: GameMap[]): GameMap[] {
  const used = new Set<string>();
  return SERIES_FORMAT.map((mode) => {
    const candidates = mapsForMode(mode, pool);
    const fresh = candidates.filter((m) => !used.has(m.id));
    const pick = rng.pick(fresh.length > 0 ? fresh : candidates);
    used.add(pick.id);
    return pick;
  });
}

export function aggregateStats(maps: MapResult[]): Record<string, PlayerStats> {
  const out: Record<string, PlayerStats> = {};
  for (const m of maps) {
    for (const [id, s] of Object.entries(m.stats)) {
      const acc = (out[id] ??= emptyStats());
      acc.kills += s.kills;
      acc.deaths += s.deaths;
      acc.plants += s.plants;
      acc.defuses += s.defuses;
      acc.clutches += s.clutches;
    }
  }
  return out;
}
