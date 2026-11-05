/**
 * Roster moves the manager makes: signing, extending, releasing, and setting
 * the lineup. Each returns a new Season or a reason the move was refused.
 */
import {
  addToRoster,
  askingSalary,
  CONTRACT_RULES,
  fitsUnderCap,
  nextSeasonPayroll,
  nextSeasonSalary,
  payroll,
  removeFromRoster,
  rosterOf,
  updatePlayer,
} from "./contracts";
import { post } from "./finance";
import { isFinished, teamById, type Season } from "./season";
import type { ContractTerms, Player, Team } from "./types";

export type Offer = ContractTerms;

export type TxResult = { ok: true; season: Season; message: string } | { ok: false; reason: string };

const fail = (reason: string): TxResult => ({ ok: false, reason });

export const money = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
};

/** Rosters lock once Champs begins and reopen in the offseason. */
export function rosterLocked(season: Season): boolean {
  if (isFinished(season)) return false;
  return season.stages[season.days[season.currentDay].stage].kind === "champs";
}

/** In the offseason, deals are judged against next season's payroll. */
export const isOffseason = isFinished;

function capPayroll(season: Season, team: Team): number {
  return isOffseason(season) ? nextSeasonPayroll(team) : payroll(team);
}

function replaceTeam(season: Season, team: Team): Season {
  return { ...season, teams: season.teams.map((t) => (t.id === team.id ? team : t)) };
}

function findOnRoster(team: Team, playerId: string): Player | undefined {
  return rosterOf(team).find((p) => p.id === playerId);
}

function checkTerms(offer: Offer): string | null {
  if (!Number.isInteger(offer.years) || offer.years < 1 || offer.years > CONTRACT_RULES.maxYears) {
    return `Contracts run 1 to ${CONTRACT_RULES.maxYears} seasons.`;
  }
  if (!(offer.salary >= CONTRACT_RULES.minSalary)) return `The league minimum is ${money(CONTRACT_RULES.minSalary)}.`;
  if (offer.salary > CONTRACT_RULES.maxSalary) return `The league maximum is ${money(CONTRACT_RULES.maxSalary)}.`;
  return null;
}

export function prestigeOf(season: Season, teamId: string): number {
  return season.finances[teamId]?.prestige ?? 50;
}

/** What a free agent asks this club for, given the contract length. */
export function freeAgentAsk(season: Season, teamId: string, player: Player, years: number): number {
  return askingSalary(player, years, prestigeOf(season, teamId));
}

/** What a rostered player asks for an extension. Includes a loyalty discount. */
export function extensionAsk(season: Season, teamId: string, player: Player, years: number): number {
  return askingSalary(player, years, prestigeOf(season, teamId), true);
}

export function signFreeAgent(season: Season, teamId: string, playerId: string, offer: Offer): TxResult {
  if (rosterLocked(season)) return fail("Rosters are locked during Champs.");
  const player = season.freeAgents.find((p) => p.id === playerId);
  if (!player) return fail("That player is no longer a free agent.");
  const terms = checkTerms(offer);
  if (terms) return fail(terms);
  const team = teamById(season, teamId);
  if (rosterOf(team).length >= CONTRACT_RULES.rosterMax) {
    return fail(`The roster is full at ${CONTRACT_RULES.rosterMax}. Release someone first.`);
  }
  if (season.finances[teamId].balance < 0) return fail("The club is in debt and cannot sign players.");
  const ask = freeAgentAsk(season, teamId, player, offer.years);
  if (offer.salary < ask) {
    return fail(`${player.name} wants at least ${money(ask)} a season over ${offer.years} ${offer.years === 1 ? "season" : "seasons"}.`);
  }
  const current = capPayroll(season, team);
  if (!fitsUnderCap(current, offer.salary)) {
    return fail(`That deal puts payroll ${money(current + offer.salary - CONTRACT_RULES.salaryCap)} over the cap.`);
  }
  // In the offseason the finished season still counts until rollover, so add one.
  const years = isOffseason(season) ? offer.years + 1 : offer.years;
  const signed: Player = { ...player, contract: { salary: offer.salary, years } };
  const next = replaceTeam(season, addToRoster(team, signed));
  next.freeAgents = season.freeAgents.filter((p) => p.id !== playerId);
  return { ok: true, season: next, message: `${player.name} signs for ${money(offer.salary)} a season.` };
}

/** Extend a player in the final season of their deal. New terms start next season. */
export function extendContract(season: Season, teamId: string, playerId: string, offer: Offer): TxResult {
  const team = teamById(season, teamId);
  const player = findOnRoster(team, playerId);
  if (!player?.contract) return fail("That player is not under contract with this club.");
  if (player.contract.years !== 1) return fail("Only players in the final season of their deal can be extended.");
  const terms = checkTerms(offer);
  if (terms) return fail(terms);
  const ask = extensionAsk(season, teamId, player, offer.years);
  if (offer.salary < ask) return fail(`${player.name} wants at least ${money(ask)} a season to extend.`);
  const nextPayroll = nextSeasonPayroll(team) - nextSeasonSalary(player);
  if (!fitsUnderCap(nextPayroll, offer.salary)) {
    return fail(`That extension puts next season's payroll ${money(nextPayroll + offer.salary - CONTRACT_RULES.salaryCap)} over the cap.`);
  }
  const c = player.contract;
  const next = replaceTeam(season, updatePlayer(team, playerId, (p) => ({ ...p, contract: { ...c, extension: { ...offer } } })));
  return { ok: true, season: next, message: `${player.name} extends for ${offer.years} more ${offer.years === 1 ? "season" : "seasons"}.` };
}

/** Half of what is still owed: the unpaid part of this season plus any later seasons. */
export function buyoutCost(season: Season, player: Player): number {
  const c = player.contract;
  if (!c) return 0;
  const left = (season.days.length - season.currentDay) / season.days.length;
  const later = c.salary * (c.years - 1) + (c.years === 1 && c.extension ? c.extension.salary * c.extension.years : 0);
  return Math.round(((c.salary * left + later) * CONTRACT_RULES.buyoutShare) / 1_000) * 1_000;
}

export function releasePlayer(season: Season, teamId: string, playerId: string): TxResult {
  if (rosterLocked(season)) return fail("Rosters are locked during Champs.");
  const team = teamById(season, teamId);
  const player = findOnRoster(team, playerId);
  if (!player) return fail("That player is not on this roster.");
  const cost = buyoutCost(season, player);
  const fin = season.finances[teamId];
  if (cost > 0 && fin.balance < cost) return fail(`The ${money(cost)} buyout is more than the club has in the bank.`);
  const next = replaceTeam(season, removeFromRoster(team, playerId));
  const freed: Player = { ...player };
  delete freed.contract;
  next.freeAgents = [...season.freeAgents, freed];
  if (cost > 0) {
    const day = Math.min(season.currentDay, season.days.length - 1);
    next.finances = {
      ...season.finances,
      [teamId]: post(fin, [{ year: season.year, day, kind: "buyout", amount: -cost, note: `Released ${player.name}` }]),
    };
  }
  return { ok: true, season: next, message: cost > 0 ? `${player.name} released. Buyout paid: ${money(cost)}.` : `${player.name} released.` };
}

export function benchPlayer(season: Season, teamId: string, playerId: string): TxResult {
  const team = teamById(season, teamId);
  const player = team.players.find((p) => p.id === playerId);
  if (!player) return fail("That player is not in the lineup.");
  const next = replaceTeam(season, { ...team, players: team.players.filter((p) => p.id !== playerId), bench: [...team.bench, player] });
  return { ok: true, season: next, message: `${player.name} moves to the bench.` };
}

/** Promote a substitute. With a full lineup, `swapWith` names the starter who sits. */
export function startPlayer(season: Season, teamId: string, playerId: string, swapWith?: string): TxResult {
  const team = teamById(season, teamId);
  const player = team.bench.find((p) => p.id === playerId);
  if (!player) return fail("That player is not on the bench.");
  let players = team.players;
  let bench = team.bench.filter((p) => p.id !== playerId);
  if (players.length >= CONTRACT_RULES.lineupSize) {
    const out = players.find((p) => p.id === swapWith);
    if (!out) return fail("The lineup is full. Choose a starter to swap out.");
    players = players.map((p) => (p.id === swapWith ? player : p));
    bench = [...bench, out];
  } else {
    players = [...players, player];
  }
  const next = replaceTeam(season, { ...team, players, bench });
  return { ok: true, season: next, message: `${player.name} joins the lineup.` };
}
