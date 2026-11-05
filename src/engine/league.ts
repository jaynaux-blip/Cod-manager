/**
 * League lifecycle: creating a new league and rolling a finished season into
 * the next one.
 */
import { aiExtendExpiring } from "./ai";
import { autoLineup, rosterOf } from "./contracts";
import { generateFreeAgents, generateLeague } from "./generate";
import { overall } from "./ratings";
import { Rng } from "./rng";
import { createSeason, isFinished, type Season } from "./season";
import type { Player, Team } from "./types";

export const LEAGUE_RULES = {
  startingFreeAgents: 18,
  rookiesPerYear: 6,
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
 * 1. AI clubs decide which final-year players to extend. The managed club's
 *    extensions are whatever the manager agreed.
 * 2. Every contract loses a season. Agreed extensions take effect. Players
 *    with nothing left become free agents.
 * 3. A rookie class joins the free-agent pool.
 *
 * The managed club may start the new season short of four. AI clubs fill
 * their gaps when the first match day is played, so the manager gets first
 * pick of the pool in the preseason.
 */
export function startNextSeason(season: Season): Season {
  if (!isFinished(season)) throw new Error("The season is not over yet.");
  const year = season.year + 1;
  const rng = new Rng(`${season.seed}:offseason:${season.year}`);
  const leaving: Player[] = [];

  const teams = season.teams.map((team) => {
    const isUser = team.id === season.userTeamId;
    const decided = isUser ? team : aiExtendExpiring(team, season.finances[team.id]?.prestige ?? 50, rng);
    const roll = (list: Player[]): Player[] =>
      list.flatMap((p) => {
        const c = p.contract;
        if (c && c.years > 1) return [{ ...p, contract: { salary: c.salary, years: c.years - 1 } }];
        if (c?.extension) return [{ ...p, contract: { ...c.extension } }];
        const fa: Player = { ...p };
        delete fa.contract;
        leaving.push(fa);
        return [];
      });
    const rolled: Team = { ...decided, players: roll(decided.players), bench: roll(decided.bench) };
    return isUser ? rolled : autoLineup(rolled);
  });

  const usedNames = [...teams.flatMap(rosterOf), ...season.freeAgents, ...leaving].map((p) => p.name);
  const rookies = generateFreeAgents(rng.fork("rookies"), {
    count: LEAGUE_RULES.rookiesPerYear,
    idPrefix: `rk-${year}`,
    usedNames,
    tier: [60, 78],
    age: [18, 20],
  });
  const freeAgents = [...season.freeAgents, ...leaving, ...rookies]
    .sort((a, b) => overall(b) - overall(a))
    .slice(0, LEAGUE_RULES.maxFreeAgents);

  return createSeason(season.seed, teams, {
    year,
    userTeamId: season.userTeamId,
    freeAgents,
    finances: season.finances,
  });
}

/** Switch which club the player manages. */
export function setUserTeam(season: Season, teamId: string): Season {
  return { ...season, userTeamId: teamId };
}
