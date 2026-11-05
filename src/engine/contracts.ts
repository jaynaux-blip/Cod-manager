/**
 * Contract rules: market value, asking salary, payroll and the salary cap.
 *
 * Pure team-level helpers. Season-level moves (signing, releasing, extending)
 * live in transactions.ts.
 */
import { overall } from "./ratings";
import type { Player, Team } from "./types";

export const CONTRACT_RULES = {
  /** Hard cap on total payroll (lineup plus bench) per season. */
  salaryCap: 1_600_000,
  /** League minimum. Minimum deals are always allowed, even over the cap, so every club can field four. */
  minSalary: 50_000,
  maxSalary: 900_000,
  lineupSize: 4,
  rosterMax: 6,
  maxYears: 3,
  /** Share of the remaining contract owed when a player is released. */
  buyoutShare: 0.5,
};

export const roundTo = (v: number, step = 5_000): number => Math.round(v / step) * step;

const clampSalary = (v: number): number =>
  Math.min(CONTRACT_RULES.maxSalary, Math.max(CONTRACT_RULES.minSalary, v));

/** Prime earning years are 22-26. Teenagers are unproven, veterans are discounted. */
export function ageFactor(age: number): number {
  if (age < 20) return 0.85;
  if (age < 22) return 0.95;
  if (age <= 26) return 1;
  if (age === 27) return 0.95;
  if (age === 28) return 0.9;
  return 0.8;
}

/**
 * What a player is worth per season. Exponential in overall rating:
 * roughly $100k at 70, $250k at 80, $390k at 85, $610k at 90.
 */
export function marketValue(p: Player): number {
  return clampSalary(roundTo(40_000 * Math.exp((overall(p) - 60) / 11) * ageFactor(p.age)));
}

/**
 * The minimum salary a player accepts. Young players charge more for long
 * deals, veterans take less for security. Prestigious clubs get a discount of
 * up to 10%, unknown ones pay a premium of up to 10%. Players re-signing with
 * their own club give a further 5% loyalty discount.
 */
export function askingSalary(p: Player, years: number, prestige: number, loyalty = false): number {
  const yearsFactor = p.age <= 22 ? 1 + 0.05 * (years - 1) : p.age >= 27 ? 1 - 0.05 * (years - 1) : 1;
  const prestigeFactor = 1.1 - prestige / 500;
  const loyaltyFactor = loyalty ? 0.95 : 1;
  return clampSalary(roundTo(marketValue(p) * yearsFactor * prestigeFactor * loyaltyFactor));
}

export const rosterOf = (t: Team): Player[] => [...t.players, ...t.bench];

export const payroll = (t: Team): number => rosterOf(t).reduce((s, p) => s + (p.contract?.salary ?? 0), 0);

export const capSpace = (t: Team): number => CONTRACT_RULES.salaryCap - payroll(t);

/** Salary a player will earn next season: the current deal if it runs on, else any agreed extension. */
export function nextSeasonSalary(p: Player): number {
  const c = p.contract;
  if (!c) return 0;
  if (c.years > 1) return c.salary;
  return c.extension?.salary ?? 0;
}

export const nextSeasonPayroll = (t: Team): number => rosterOf(t).reduce((s, p) => s + nextSeasonSalary(p), 0);

/** A deal fits if payroll stays under the cap, or it is a league-minimum deal. */
export function fitsUnderCap(currentPayroll: number, salary: number): boolean {
  return salary <= CONTRACT_RULES.minSalary || currentPayroll + salary <= CONTRACT_RULES.salaryCap;
}

/** Fill the lineup first, then the bench. */
export function addToRoster(t: Team, p: Player): Team {
  return t.players.length < CONTRACT_RULES.lineupSize
    ? { ...t, players: [...t.players, p] }
    : { ...t, bench: [...t.bench, p] };
}

export function removeFromRoster(t: Team, playerId: string): Team {
  return { ...t, players: t.players.filter((p) => p.id !== playerId), bench: t.bench.filter((p) => p.id !== playerId) };
}

export function updatePlayer(t: Team, playerId: string, fn: (p: Player) => Player): Team {
  const map = (p: Player) => (p.id === playerId ? fn(p) : p);
  return { ...t, players: t.players.map(map), bench: t.bench.map(map) };
}

/** Best four by overall start. Used for AI clubs. */
export function autoLineup(t: Team): Team {
  const all = rosterOf(t).sort((a, b) => overall(b) - overall(a));
  return { ...t, players: all.slice(0, CONTRACT_RULES.lineupSize), bench: all.slice(CONTRACT_RULES.lineupSize) };
}
