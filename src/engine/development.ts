/**
 * Player development, aging and retirement.
 *
 * Once a season, when Champs ends, every player moves towards their hidden
 * ceiling or declines past their peak, then ages a year. Growth is a share of
 * the gap to the ceiling, scaled by age, by playing time and by the club's
 * training spend. Decline hits aim hardest while game sense and comms hold up,
 * so veterans turn into in-game leaders. Retirement is rolled when the next
 * season starts, after the manager has had the offseason to extend players.
 */
import { trainingBoost, trainingSpend } from "./finance";
import { exactOverall, overall, OVERALL_WEIGHTS } from "./ratings";
import { clamp, Rng } from "./rng";
import { devOf, outlook, potentialRange } from "./scouting";
import type { Season } from "./season";
import { ATTRIBUTE_KEYS, type AttributeKey, type Attributes, type Player } from "./types";

export const DEV_RULES = {
  /** Share of the gap to the ceiling closed in one season at full minutes, before age and training. */
  growthShare: 0.4,
  /** Maps in a season for full development. A regular starter plays 67-172, so this is a starter-vs-bench signal. */
  repsFullAt: 60,
  /** Development rate for a rostered player who never plays. */
  benchReps: 0.5,
  /** Development rate for an unsigned player. */
  freeAgentReps: 0.3,
  /** Overall points lost per year past peak, per season, up to maxDecline. */
  declinePerYear: 0.8,
  maxDecline: 4,
  /** Season-to-season noise in overall points. */
  noiseSd: 1,
  /** Ceilings drift each season until this age, which creates breakouts and busts. */
  potentialDriftUntil: 23,
  potentialDriftSd: 2,
  minPotential: 40,
  maxPotential: 95,
  /** Relative attribute weights for growth. */
  growthProfile: { aim: 1.2, positioning: 1, gameSense: 1, consistency: 1.1, clutch: 0.9, comms: 0.8 } as Record<AttributeKey, number>,
  /** Relative weights for decline. Negative values improve with age. */
  declineProfile: { aim: 1.3, positioning: 0.9, gameSense: -0.2, consistency: 1, clutch: 0.9, comms: -0.2 } as Record<AttributeKey, number>,
  /** Per-player variation on the profiles. */
  profileJitterSd: 0.3,
  /** Contracted players retire at this age regardless; the contract is voided. */
  hardRetireAge: 34,
  /** Attributes that improve with age stop improving from this rating. */
  ageGainCeiling: 95,
};

export interface DevContext {
  /** Maps played this season, or null for a free agent. */
  maps: number | null;
  /** Training boost, 0 to 0.5. */
  boost: number;
}

export interface DevResult {
  player: Player;
  growth: number;
  decline: number;
}

/** Spread `amount` overall points across attributes so the overall rating moves by exactly `amount`. */
function spread(amount: number, profile: Record<AttributeKey, number>): Record<AttributeKey, number> {
  const norm = ATTRIBUTE_KEYS.reduce((s, k) => s + OVERALL_WEIGHTS[k] * profile[k], 0);
  const out = {} as Record<AttributeKey, number>;
  for (const k of ATTRIBUTE_KEYS) out[k] = norm === 0 ? 0 : (amount * profile[k]) / norm;
  return out;
}

function jittered(rng: Rng, profile: Record<AttributeKey, number>): Record<AttributeKey, number> {
  const out = {} as Record<AttributeKey, number>;
  for (const k of ATTRIBUTE_KEYS) out[k] = profile[k] * Math.max(0.1, 1 + rng.gaussian(0, DEV_RULES.profileJitterSd));
  return out;
}

/**
 * One season of development, then a birthday. Every random draw happens in a
 * fixed order whatever the inputs, so changing the training boost never
 * changes the luck a player gets.
 */
export function developPlayer(p: Player, ctx: DevContext, rng: Rng): DevResult {
  const R = DEV_RULES;
  const dev = devOf(p);
  const noise = rng.gaussian(0, R.noiseSd);
  const growthProfile = jittered(rng, R.growthProfile);
  const declineProfile = jittered(rng, R.declineProfile);
  const drift = rng.gaussian(0, R.potentialDriftSd);
  const rounding = ATTRIBUTE_KEYS.map(() => rng.next());

  const reps = ctx.maps === null ? R.freeAgentReps : R.benchReps + (1 - R.benchReps) * Math.min(1, ctx.maps / R.repsFullAt);
  const ageMult = clamp((dev.peakAge + 1 - p.age) / 3, 0, 1);
  const growth = Math.max(0, dev.potential - exactOverall(p)) * R.growthShare * ageMult * reps * (1 + ctx.boost);
  const yearsPast = p.age - dev.peakAge;
  const rawDecline = yearsPast > 0 ? Math.min(R.maxDecline, R.declinePerYear * yearsPast) : 0;
  const decline = rawDecline * (1 - ctx.boost / 2);

  // Attributes that improve with age stop improving near the top of the scale,
  // and the decline is spread over the rest instead.
  const profile = { ...declineProfile };
  for (const k of ATTRIBUTE_KEYS) if (profile[k] < 0 && p.attributes[k] >= R.ageGainCeiling) profile[k] = 0;
  // Training slows only the losses. Gains from experience are the same with or
  // without it, so a bigger program can never lower any attribute.
  const lost = spread(decline, profile);
  const gained = spread(rawDecline, profile);
  const up = spread(growth + noise, growthProfile);
  const attributes = { ...p.attributes } as Attributes;
  ATTRIBUTE_KEYS.forEach((k, i) => {
    const down = profile[k] < 0 ? gained[k] : lost[k];
    // Stochastic rounding keeps attributes whole numbers without bias.
    const delta = Math.floor(up[k] - down + rounding[i]);
    attributes[k] = clamp(p.attributes[k] + delta, 1, 99);
  });

  const potential =
    p.age <= R.potentialDriftUntil
      ? Math.round(clamp(dev.potential + drift, R.minPotential, R.maxPotential))
      : dev.potential;
  return { player: { ...p, age: p.age + 1, attributes, dev: { ...dev, potential } }, growth, decline };
}

/** Maps each player started this season, by player id. */
export function mapsPlayed(season: Season): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of season.fixtures) {
    if (!f.result) continue;
    const maps = f.result.maps.length;
    for (const side of f.result.teams) for (const p of side.players) out[p.id] = (out[p.id] ?? 0) + maps;
  }
  return out;
}

export type DevNote = "breakout" | "stalled" | "declining";

export interface DevChange {
  playerId: string;
  name: string;
  /** Club at the time of development, or null for a free agent. */
  teamId: string | null;
  /** Age after the birthday. */
  age: number;
  before: number;
  after: number;
  /** Maps played that season, or null for a free agent. */
  maps: number | null;
  rangeBefore: [number, number] | null;
  rangeAfter: [number, number] | null;
  note?: DevNote;
}

export interface Retirement {
  playerId: string;
  name: string;
  age: number;
  overall: number;
  /** Last club, or null if unsigned. */
  teamId: string | null;
  /** Retired at the age limit with a contract still running. */
  forced: boolean;
}

export interface DevReport {
  /** Season whose development this describes. */
  year: number;
  changes: DevChange[];
  /** Filled in when the next season starts. */
  retired: Retirement[];
  /** Free agents no club wanted, dropped from the pool when the next season starts. */
  left: string[];
  /** Ids of the rookie class that joined the pool when the next season starts. */
  rookies: string[];
}

const mid = (r: [number, number] | null): number | null => (r ? (r[0] + r[1]) / 2 : null);

function noteFor(before: Player, after: Player, rb: [number, number] | null, ra: [number, number] | null): DevNote | undefined {
  const diff = overall(after) - overall(before);
  const mb = mid(rb);
  const ma = mid(ra);
  if (before.age <= 23 && (diff >= 4 || (mb !== null && ma !== null && ma - mb >= 3))) return "breakout";
  if (mb !== null && ma !== null && ma - mb <= -3) return "stalled";
  if (diff <= -2) return "declining";
  return undefined;
}

/** Free agents only appear in the report if they moved this much. */
const FREE_AGENT_REPORT_THRESHOLD = 2;

/**
 * Develop and age every player in the league. Called once, when Champs ends.
 * Returns a new Season; the input is not mutated.
 */
export function applySeasonDevelopment(season: Season): Season {
  const maps = mapsPlayed(season);
  const rng = new Rng(`${season.seed}:${season.year}:develop`);
  const changes: DevChange[] = [];

  const develop = (p: Player, teamId: string | null): Player => {
    const fin = teamId ? season.finances[teamId] : undefined;
    const boost = fin ? trainingBoost(trainingSpend(fin, season.year)) : 0;
    const playerMaps = teamId ? (maps[p.id] ?? 0) : null;
    // Forking by id makes each player's result independent of processing order.
    const { player } = developPlayer(p, { maps: playerMaps, boost }, rng.fork(p.id));
    const before = overall(p);
    const after = overall(player);
    if (teamId || Math.abs(after - before) >= FREE_AGENT_REPORT_THRESHOLD) {
      const rangeBefore = potentialRange(p);
      const rangeAfter = potentialRange(player);
      changes.push({
        playerId: p.id,
        name: p.name,
        teamId,
        age: player.age,
        before,
        after,
        maps: playerMaps,
        rangeBefore,
        rangeAfter,
        note: noteFor(p, player, rangeBefore, rangeAfter),
      });
    }
    return player;
  };

  const teams = season.teams.map((t) => ({
    ...t,
    players: t.players.map((p) => develop(p, t.id)),
    bench: t.bench.map((p) => develop(p, t.id)),
  }));
  const freeAgents = season.freeAgents.map((p) => develop(p, null));
  return {
    ...season,
    teams,
    freeAgents,
    development: { year: season.year, changes, retired: [], left: [], rookies: [] },
  };
}

/** Chance an unsigned player retires this offseason, by age (after the birthday). */
const RETIRE_BY_AGE: Record<number, number> = {
  24: 0.03, 25: 0.06, 26: 0.12, 27: 0.2, 28: 0.3, 29: 0.42, 30: 0.55, 31: 0.7, 32: 0.85,
};

/**
 * Chance a player retires if they are unsigned when the next season starts.
 * Weak players move on earlier, stars stay while clubs still want them, and a
 * whole season unsigned pushes fringe players out. Contracted players only retire at
 * the hard age limit.
 */
export function retirementChance(p: Player, satUnsigned: boolean): number {
  if (p.age >= DEV_RULES.hardRetireAge) return 1;
  if (p.age >= 33) return 1;
  let chance = p.age <= 23 ? 0 : RETIRE_BY_AGE[p.age] ?? 0;
  // Judged on scouted outlook, so a raw teenager with a high ceiling is not
  // treated as a washout, and the youngest only feel half the push.
  const view = outlook(p);
  const youth = p.age <= 21 ? 0.5 : 1;
  chance += youth * clamp((72 - view) * 0.03, 0, 0.3);
  if (overall(p) >= 82) chance -= 0.1;
  // A season without a club pushes fringe players out, not good ones priced out of the market.
  if (satUnsigned && view < 75) chance += youth * 0.15;
  return clamp(chance, 0, 1);
}

/** Whether a free agent was already unsigned before season `year` started. */
export const satWholeSeasonUnsigned = (p: Player, year: number): boolean => (p.freedIn ?? -Infinity) < year;

/** Seasons after the current one a player can still play before the hard age limit. */
export function futureSeasonsLeft(p: Player, offseason: boolean): number {
  const ageNextSeason = offseason ? p.age : p.age + 1;
  return Math.max(0, DEV_RULES.hardRetireAge - ageNextSeason);
}
