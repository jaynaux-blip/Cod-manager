/**
 * Season model: four Majors then Champs.
 *
 * Each Major has a qualifier phase (two groups of six, round robin, one match
 * day per round) and an eight-team double-elimination bracket for the top four
 * of each group. Qualifier wins and Major placements earn season points, and
 * the top eight by points go to Champs.
 *
 * The whole calendar is generated up front with symbolic team references that
 * are resolved on the day they are played, so a season is plain data that can
 * be advanced one match day at a time.
 */
import { BRACKET_DAYS, BRACKET_PLACEMENTS, DOUBLE_ELIM_8, roundRobin, type BracketSource } from "./bracket";
import { Rng } from "./rng";
import { simulateSeries } from "./series";
import type { SeriesResult, Team } from "./types";

export const SEASON_RULES = {
  teams: 12,
  majors: 4,
  groupSize: 6,
  bracketTeams: 8,
  pointsPerQualifierWin: 10,
  /** Season points for Major placement, indexed by place (1-based). */
  placementPoints: { 1: 100, 2: 80, 3: 65, 4: 50, 5: 40, 7: 30, 9: 20, 11: 10 } as Record<number, number>,
};

export type TeamRef =
  | { kind: "team"; id: string }
  /** A slot in a stage group, filled when the stage starts. */
  | { kind: "slot"; stage: number; group: 0 | 1; slot: number }
  /** A bracket seed, filled from qualifier standings (Majors) or season points (Champs). */
  | { kind: "seed"; stage: number; seed: number }
  | { kind: "winner"; match: string }
  | { kind: "loser"; match: string };

export type Phase = "qualifier" | "bracket";

export interface Fixture {
  id: string;
  stage: number;
  phase: Phase;
  day: number;
  round: string;
  group?: 0 | 1;
  home: TeamRef;
  away: TeamRef;
  /** Resolved team ids, set when played. */
  homeId?: string;
  awayId?: string;
  result?: SeriesResult;
}

export interface MatchDay {
  day: number;
  stage: number;
  phase: Phase;
  label: string;
  fixtureIds: string[];
}

export interface Stage {
  index: number;
  name: string;
  kind: "major" | "champs";
  /** Set when the stage starts. */
  groups?: [string[], string[]];
  /** Bracket seed order, set when the bracket starts. */
  seeds?: string[];
  /** Final placement per team id, set when the stage ends. */
  placements?: Record<string, number>;
}

export interface Season {
  seed: string;
  teams: Team[];
  stages: Stage[];
  fixtures: Fixture[];
  days: MatchDay[];
  /** Index of the next match day to play; equals days.length when finished. */
  currentDay: number;
  points: Record<string, number>;
  champion?: string;
}

export interface StandingRow {
  teamId: string;
  wins: number;
  losses: number;
  mapsWon: number;
  mapsLost: number;
  mapDiff: number;
}

export interface SeasonStandingRow extends StandingRow {
  points: number;
  /** Placement per Major, null until that Major finishes. */
  placements: (number | null)[];
  champsPlacement: number | null;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createSeason(seed: string, teams: Team[]): Season {
  if (teams.length !== SEASON_RULES.teams) {
    throw new Error(`A season needs exactly ${SEASON_RULES.teams} teams`);
  }
  const stages: Stage[] = [];
  const fixtures: Fixture[] = [];
  const days: MatchDay[] = [];
  const romans = ["I", "II", "III", "IV", "V", "VI"];

  for (let s = 0; s < SEASON_RULES.majors; s++) {
    const name = `Major ${romans[s]}`;
    stages.push({ index: s, name, kind: "major" });
    addQualifier(s, name, fixtures, days);
    addBracket(s, name, fixtures, days);
  }
  const champs = SEASON_RULES.majors;
  stages.push({ index: champs, name: "Champs", kind: "champs" });
  addBracket(champs, "Champs", fixtures, days);

  return {
    seed,
    teams,
    stages,
    fixtures,
    days,
    currentDay: 0,
    points: Object.fromEntries(teams.map((t) => [t.id, 0])),
  };
}

function addQualifier(stage: number, name: string, fixtures: Fixture[], days: MatchDay[]): void {
  const slots = Array.from({ length: SEASON_RULES.groupSize }, (_, i) => i);
  const rounds = roundRobin(slots);
  rounds.forEach((round, r) => {
    const day: MatchDay = {
      day: days.length,
      stage,
      phase: "qualifier",
      label: `${name} Qualifiers, Week ${r + 1}`,
      fixtureIds: [],
    };
    for (const group of [0, 1] as const) {
      round.forEach(([a, b], m) => {
        const id = `S${stage}-Q-G${group}-W${r + 1}-M${m + 1}`;
        fixtures.push({
          id,
          stage,
          phase: "qualifier",
          day: day.day,
          round: `Week ${r + 1}`,
          group,
          home: { kind: "slot", stage, group, slot: a },
          away: { kind: "slot", stage, group, slot: b },
        });
        day.fixtureIds.push(id);
      });
    }
    days.push(day);
  });
}

function addBracket(stage: number, name: string, fixtures: Fixture[], days: MatchDay[]): void {
  const firstDay = days.length;
  for (let d = 0; d < BRACKET_DAYS; d++) {
    days.push({ day: firstDay + d, stage, phase: "bracket", label: `${name} Bracket, Day ${d + 1}`, fixtureIds: [] });
  }
  const toRef = (src: BracketSource): TeamRef =>
    src.kind === "seed" ? { kind: "seed", stage, seed: src.seed } : { kind: src.kind, match: `S${stage}-${src.match}` };
  for (const m of DOUBLE_ELIM_8) {
    const id = `S${stage}-${m.id}`;
    const day = firstDay + m.day;
    fixtures.push({ id, stage, phase: "bracket", day, round: m.round, home: toRef(m.home), away: toRef(m.away) });
    days[day].fixtureIds.push(id);
  }
}

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

export const isFinished = (season: Season): boolean => season.currentDay >= season.days.length;

/** Play the next match day. Returns a new Season; the input is not mutated. */
export function playNextDay(season: Season): Season {
  if (isFinished(season)) return season;
  const day = season.days[season.currentDay];
  const next: Season = {
    ...season,
    stages: season.stages.map((s) => ({ ...s })),
    fixtures: season.fixtures.slice(),
    points: { ...season.points },
  };
  const stage = next.stages[day.stage];
  const fixtureIndex = new Map(next.fixtures.map((f, i) => [f.id, i]));

  if (day.phase === "qualifier" && !stage.groups) stage.groups = drawGroups(next, stage);
  if (day.phase === "bracket" && !stage.seeds) stage.seeds = drawSeeds(next, stage);

  for (const id of day.fixtureIds) {
    const i = fixtureIndex.get(id)!;
    const fixture = { ...next.fixtures[i] };
    const homeId = resolveRef(next, fixture.home);
    const awayId = resolveRef(next, fixture.away);
    const home = teamById(next, homeId);
    const away = teamById(next, awayId);
    const result = simulateSeries([home, away], { seed: `${next.seed}:${fixture.id}` });
    fixture.homeId = homeId;
    fixture.awayId = awayId;
    fixture.result = result;
    next.fixtures[i] = fixture;
    if (fixture.phase === "qualifier") {
      const winnerId = result.winner === 0 ? homeId : awayId;
      next.points[winnerId] += SEASON_RULES.pointsPerQualifierWin;
    }
  }

  next.currentDay = season.currentDay + 1;
  const stageOver = next.currentDay >= next.days.length || next.days[next.currentDay].stage !== day.stage;
  if (stageOver) finishStage(next, stage);
  return next;
}

export function playStage(season: Season): Season {
  if (isFinished(season)) return season;
  const stage = season.days[season.currentDay].stage;
  let s = season;
  while (!isFinished(s) && s.days[s.currentDay].stage === stage) s = playNextDay(s);
  return s;
}

export function playSeason(season: Season): Season {
  let s = season;
  while (!isFinished(s)) s = playNextDay(s);
  return s;
}

function finishStage(season: Season, stage: Stage): void {
  const placements: Record<string, number> = {};
  for (const { match, outcome, place } of BRACKET_PLACEMENTS) {
    const f = fixtureById(season, `S${stage.index}-${match}`);
    const winnerId = f.result!.winner === 0 ? f.homeId! : f.awayId!;
    const loserId = f.result!.winner === 0 ? f.awayId! : f.homeId!;
    placements[outcome === "winner" ? winnerId : loserId] = place;
  }
  if (stage.kind === "major") {
    // Group 5th and 6th finish 9th-10th and 11th-12th.
    for (const group of [0, 1] as const) {
      const rows = groupStandings(season, stage.index, group);
      placements[rows[4].teamId] = 9;
      placements[rows[5].teamId] = 11;
    }
    for (const [teamId, place] of Object.entries(placements)) {
      season.points[teamId] += SEASON_RULES.placementPoints[place] ?? 0;
    }
  } else {
    season.champion = Object.entries(placements).find(([, p]) => p === 1)![0];
  }
  stage.placements = placements;
}

// ---------------------------------------------------------------------------
// Draws and resolution
// ---------------------------------------------------------------------------

/** Major I groups are a random draw; later Majors snake-seed by season points. */
function drawGroups(season: Season, stage: Stage): [string[], string[]] {
  let order: string[];
  if (stage.index === 0) {
    order = new Rng(`${season.seed}:draw`).shuffle(season.teams.map((t) => t.id));
  } else {
    order = seasonStandings(season).map((r) => r.teamId);
  }
  const groups: [string[], string[]] = [[], []];
  order.forEach((id, i) => {
    // Snake: 0,1,1,0,0,1,1,0 ...
    const g = Math.floor(i / 2) % 2 === 0 ? i % 2 : 1 - (i % 2);
    groups[g as 0 | 1].push(id);
  });
  return groups;
}

/**
 * Major bracket seeds: group winners 1-2, runners-up 3-4, and so on, with the
 * better map differential taking the higher seed. Champs seeds by season points.
 */
function drawSeeds(season: Season, stage: Stage): string[] {
  if (stage.kind === "champs") {
    return seasonStandings(season).slice(0, SEASON_RULES.bracketTeams).map((r) => r.teamId);
  }
  const g0 = groupStandings(season, stage.index, 0);
  const g1 = groupStandings(season, stage.index, 1);
  const seeds: string[] = [];
  for (let i = 0; i < SEASON_RULES.bracketTeams / 2; i++) {
    const pair = [g0[i], g1[i]].sort(compareRows);
    seeds.push(pair[0].teamId, pair[1].teamId);
  }
  return seeds;
}

export function resolveRef(season: Season, ref: TeamRef): string {
  switch (ref.kind) {
    case "team":
      return ref.id;
    case "slot": {
      const groups = season.stages[ref.stage].groups;
      if (!groups) throw new Error(`Stage ${ref.stage} groups not drawn yet`);
      return groups[ref.group][ref.slot];
    }
    case "seed": {
      const seeds = season.stages[ref.stage].seeds;
      if (!seeds) throw new Error(`Stage ${ref.stage} seeds not drawn yet`);
      return seeds[ref.seed - 1];
    }
    case "winner":
    case "loser": {
      const f = fixtureById(season, ref.match);
      if (!f.result) throw new Error(`Fixture ${ref.match} not played yet`);
      const winnerIsHome = f.result.winner === 0;
      return (ref.kind === "winner") === winnerIsHome ? f.homeId! : f.awayId!;
    }
  }
}

/** Best-effort resolution for display: null when not yet known. */
export function tryResolveRef(season: Season, ref: TeamRef): string | null {
  try {
    return resolveRef(season, ref);
  } catch {
    return null;
  }
}

export function describeRef(season: Season, ref: TeamRef): string {
  const id = tryResolveRef(season, ref);
  if (id) return teamById(season, id).name;
  switch (ref.kind) {
    case "slot":
      return `Group ${ref.group === 0 ? "A" : "B"} slot ${ref.slot + 1}`;
    case "seed":
      return `Seed ${ref.seed}`;
    case "winner":
      return `Winner of ${ref.match.replace(/^S\d+-/, "")}`;
    case "loser":
      return `Loser of ${ref.match.replace(/^S\d+-/, "")}`;
    default:
      return "TBD";
  }
}

export function teamById(season: Season, id: string): Team {
  const t = season.teams.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown team ${id}`);
  return t;
}

export function fixtureById(season: Season, id: string): Fixture {
  const f = season.fixtures.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fixture ${id}`);
  return f;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

const emptyRow = (teamId: string): StandingRow => ({ teamId, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, mapDiff: 0 });

function applyResult(rows: Map<string, StandingRow>, f: Fixture): void {
  if (!f.result || !f.homeId || !f.awayId) return;
  const home = rows.get(f.homeId);
  const away = rows.get(f.awayId);
  if (!home || !away) return;
  const [h, a] = f.result.mapScore;
  home.mapsWon += h;
  home.mapsLost += a;
  away.mapsWon += a;
  away.mapsLost += h;
  home.mapDiff = home.mapsWon - home.mapsLost;
  away.mapDiff = away.mapsWon - away.mapsLost;
  if (f.result.winner === 0) {
    home.wins++;
    away.losses++;
  } else {
    away.wins++;
    home.losses++;
  }
}

/** Wins, then map differential, then maps won, then id for a stable order. */
export function compareRows(a: StandingRow, b: StandingRow): number {
  return b.wins - a.wins || b.mapDiff - a.mapDiff || b.mapsWon - a.mapsWon || a.teamId.localeCompare(b.teamId);
}

/** Qualifier table for one group of a Major, with head-to-head breaking ties on wins. */
export function groupStandings(season: Season, stage: number, group: 0 | 1): StandingRow[] {
  const ids = season.stages[stage].groups?.[group] ?? [];
  const rows = new Map(ids.map((id) => [id, emptyRow(id)]));
  const played = season.fixtures.filter((f) => f.stage === stage && f.phase === "qualifier" && f.group === group && f.result);
  for (const f of played) applyResult(rows, f);
  const sorted = [...rows.values()].sort(compareRows);

  // Head-to-head: among teams level on wins, order by the mini-table between them.
  const out: StandingRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].wins === sorted[i].wins) j++;
    const tied = sorted.slice(i, j);
    if (tied.length > 1) {
      const tiedIds = new Set(tied.map((r) => r.teamId));
      const mini = new Map(tied.map((r) => [r.teamId, emptyRow(r.teamId)]));
      for (const f of played) if (tiedIds.has(f.homeId!) && tiedIds.has(f.awayId!)) applyResult(mini, f);
      tied.sort((a, b) => compareRows(mini.get(a.teamId)!, mini.get(b.teamId)!) || compareRows(a, b));
    }
    out.push(...tied);
    i = j;
  }
  return out;
}

/** Season table: points, then overall record, then map differential. */
export function seasonStandings(season: Season): SeasonStandingRow[] {
  const rows = new Map(season.teams.map((t) => [t.id, { ...emptyRow(t.id), points: season.points[t.id], placements: [] as (number | null)[], champsPlacement: null as number | null }]));
  for (const f of season.fixtures) applyResult(rows, f);
  for (const stage of season.stages) {
    for (const row of rows.values()) {
      const place = stage.placements?.[row.teamId] ?? null;
      if (stage.kind === "major") row.placements.push(place);
      else row.champsPlacement = place;
    }
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || compareRows(a, b));
}

export function fixturesForDay(season: Season, day: number): Fixture[] {
  const ids = new Set(season.days[day].fixtureIds);
  return season.fixtures.filter((f) => ids.has(f.id));
}
