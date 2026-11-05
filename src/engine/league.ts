/**
 * League lifecycle: creating a new league and rolling a finished season into
 * the next one.
 */
import { aiExtendExpiring, aiPayrollBudget, aiTrainingLevel } from "./ai";
import { DEV_RULES, retirementChance, satWholeSeasonUnsigned, type DevReport, type Retirement } from "./development";
import { autoLineup, rosterOf } from "./contracts";
import { settleFans } from "./finance";
import { generateFreeAgents, generateLeague } from "./generate";
import { overall } from "./ratings";
import { outlook } from "./scouting";
import { Rng } from "./rng";
import { createSeason, isFinished, type Season } from "./season";
import type { Player, Team } from "./types";

export const LEAGUE_RULES = {
  startingFreeAgents: 18,
  rookiesPerYear: 8,
  /** The pool is trimmed to this size each offseason, dropping the lowest rated. */
  maxFreeAgents: 30,
};

/**
 * A new league: generated clubs and a free-agent pool. By default the player
 * manages a club ranked in the bottom half by lineup rating.
 */
export function createLeague(seed: string, userTeamId?: string): Season {
  const teams = generateLeague(seed);
  const usedNames = teams.flatMap(rosterOf).map((p) => p.name);
  const freeAgents = generateFreeAgents(new Rng(`${seed}:free-agents`), {
    count: LEAGUE_RULES.startingFreeAgents,
    idPrefix: "fa-1",
    usedNames,
    tier: [62, 80],
    age: [18, 30],
  });
  const byRating = teams.slice().sort((a, b) => lineupRating(b) - lineupRating(a));
  return createSeason(seed, teams, { year: 1, freeAgents, userTeamId: userTeamId ?? byRating[7].id });
}

export const lineupRating = (t: Team): number =>
  Math.round(t.players.reduce((s, p) => s + overall(p), 0) / Math.max(1, t.players.length));

/**
 * Close the books on a finished season and set up the next one.
 *
 * Players already developed and aged when Champs ended, so every decision
 * here uses next season's ratings and ages.
 *
 * 1. AI clubs decide which final-year players to extend. The managed club's
 *    extensions are whatever the manager agreed.
 * 2. Every contract loses a season. Agreed extensions take effect. Players
 *    with nothing left become free agents. Anyone at the hard age limit
 *    retires, contract or not.
 * 3. Unsigned players roll for retirement: the newly expired, and free agents
 *    who sat the whole season unsigned (more likely to quit).
 * 4. A rookie class joins the pool, which is trimmed by scouted outlook so
 *    high-ceiling rookies survive the cut.
 *
 * The managed club may start the new season short of four. AI clubs fill
 * their gaps when the first match day is played, so the manager gets first
 * pick of the pool in the preseason.
 */
export function startNextSeason(season: Season): Season {
  if (!isFinished(season)) throw new Error("The season is not over yet.");
  const year = season.year + 1;
  const rng = new Rng(`${season.seed}:offseason:${season.year}`);
  const retireRng = new Rng(`${season.seed}:retire:${season.year}`);
  const leaving: { player: Player; teamId: string }[] = [];
  const retired: Retirement[] = [];
  const retire = (p: Player, teamId: string | null, forced: boolean) =>
    retired.push({ playerId: p.id, name: p.name, age: p.age, overall: overall(p), teamId, forced });
  // Fans settle and AI clubs choose next season's training before any budget is set.
  const finances = Object.fromEntries(
    Object.entries(season.finances).map(([id, f]) => {
      const settled = settleFans(f);
      return [id, id === season.userTeamId ? settled : { ...settled, training: aiTrainingLevel(settled, true) }];
    }),
  );

  const teams = season.teams.map((team) => {
    const isUser = team.id === season.userTeamId;
    const fin = finances[team.id];
    const budget = fin ? aiPayrollBudget(fin) : Infinity;
    const decided = isUser ? team : aiExtendExpiring(team, fin?.prestige ?? 50, rng, budget);
    const roll = (list: Player[]): Player[] =>
      list.flatMap((p) => {
        const c = p.contract;
        const staying = c && c.years > 1 ? { salary: c.salary, years: c.years - 1 } : c?.extension ? { ...c.extension } : null;
        if (staying && p.age >= DEV_RULES.hardRetireAge) {
          retire(p, team.id, true);
          return [];
        }
        if (staying) return [{ ...p, contract: staying }];
        const fa: Player = { ...p, freedIn: season.year };
        delete fa.contract;
        leaving.push({ player: fa, teamId: team.id });
        return [];
      });
    const rolled: Team = { ...decided, players: roll(decided.players), bench: roll(decided.bench) };
    return isUser ? rolled : autoLineup(rolled);
  });

  const rolls = (p: Player, satUnsigned: boolean) => retireRng.fork(p.id).next() < retirementChance(p, satUnsigned);
  const stayers: Player[] = [];
  for (const { player, teamId } of leaving) {
    if (rolls(player, false)) retire(player, teamId, false);
    else stayers.push(player);
  }
  for (const p of season.freeAgents) {
    if (rolls(p, satWholeSeasonUnsigned(p, season.year))) retire(p, null, false);
    else stayers.push(p);
  }

  const usedNames = [...teams.flatMap(rosterOf), ...season.freeAgents, ...leaving.map((l) => l.player)].map((p) => p.name);
  const rookies = generateFreeAgents(rng.fork("rookies"), {
    count: LEAGUE_RULES.rookiesPerYear,
    idPrefix: `rk-${year}`,
    usedNames,
    tier: [60, 76],
    age: [18, 20],
  }).map((p) => ({ ...p, freedIn: season.year }));
  const ranked = [...stayers, ...rookies].sort((a, b) => outlook(b) - outlook(a) || a.id.localeCompare(b.id));
  const freeAgents = ranked.slice(0, LEAGUE_RULES.maxFreeAgents);
  const left = ranked.slice(LEAGUE_RULES.maxFreeAgents).map((p) => p.name);

  const development: DevReport = {
    ...(season.development ?? { year: season.year, changes: [] }),
    retired,
    left,
    rookies: rookies.map((p) => p.id),
  };
  return createSeason(season.seed, teams, {
    year,
    userTeamId: season.userTeamId,
    freeAgents,
    finances,
    development,
  });
}

/**
 * The managed club can only be chosen before a new league's first match day.
 * Switching later would let the manager release a rival's players on the
 * rival's money and then sign them.
 */
export function canChangeClub(season: Season): boolean {
  return season.year === 1 && season.currentDay === 0;
}

/** Choose which club the player manages. Ignored once the league has started. */
export function setUserTeam(season: Season, teamId: string): Season {
  if (!canChangeClub(season)) return season;
  return { ...season, userTeamId: teamId };
}
