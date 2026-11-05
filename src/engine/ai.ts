/**
 * Front-office logic for clubs the player does not manage.
 */
import {
  withContract,
  addToRoster,
  askingSalary,
  autoLineup,
  CONTRACT_RULES,
  fitsUnderCap,
  nextSeasonPayroll,
  payroll,
  rosterOf,
  updatePlayer,
} from "./contracts";
import { sustainablePayroll, TRAINING_LEVELS, type TeamFinances } from "./finance";
import { generatePlayer, NameGen } from "./generate";
import { overall } from "./ratings";
import { outlook, withDevelopment } from "./scouting";
import type { Rng } from "./rng";
import type { Player, Role, Team } from "./types";

export interface AiRosterOptions {
  /** Preseason: allow one signing that upgrades the lineup, and reset lineups. */
  upgrades: boolean;
  /** Prefix for ids of emergency call-ups. */
  idPrefix: string;
}

/** Tier of an emergency call-up from the academy, signed at the league minimum. */
export const CALL_UP_TIER = 62;

/**
 * Make sure every AI club can field four, and in preseason let each make one
 * upgrade. Weaker-prestige clubs pick first, like a reverse-order draft.
 */
export function aiPrepareRosters(
  teams: Team[],
  freeAgents: Player[],
  finances: Record<string, TeamFinances>,
  userTeamId: string | null,
  rng: Rng,
  opts: AiRosterOptions,
): { teams: Team[]; freeAgents: Player[] } {
  let pool = freeAgents.slice();
  const out = teams.slice();
  const order = out
    .map((_, i) => i)
    .filter((i) => out[i].id !== userTeamId)
    .sort((a, b) => (finances[out[a].id]?.prestige ?? 50) - (finances[out[b].id]?.prestige ?? 50));
  const names = new NameGen(rng.fork("call-ups"), [...teams.flatMap(rosterOf), ...pool].map((p) => p.name));
  let callUps = 0;

  for (const i of order) {
    let team = out[i];
    let changed = false;
    const fin = finances[team.id];
    const prestige = fin?.prestige ?? 50;
    // Clubs in debt follow the same rule as the manager: no deals above the minimum.
    const inDebt = (fin?.balance ?? 0) < 0;
    const budget = fin ? aiPayrollBudget(fin) : Infinity;
    const sign = (p: Player, salary: number, years: number) => {
      team = addToRoster(team, withContract(p, { salary, years }));
      pool = pool.filter((x) => x.id !== p.id);
      changed = true;
    };

    while (rosterOf(team).length < CONTRACT_RULES.lineupSize) {
      const years = rng.int(1, 2);
      const pick = bestAffordable(team, pool, prestige, years, budget, inDebt);
      // A solvent club over budget still prefers the cheapest real free agent to
      // an academy kid, but only on a one-season deal and only if cash covers
      // the overspend, so it cannot lock itself into years of debt.
      const fallback = pick || inDebt ? null : cheapestAffordable(team, pool, prestige, 1);
      const overspend = fallback ? payroll(team) + fallback.salary - budget : 0;
      const affordable = fallback && overspend <= Math.max(0, fin?.balance ?? 0) / 2 ? fallback : null;
      if (pick) {
        sign(pick.player, pick.salary, years);
      } else if (affordable) {
        sign(affordable.player, affordable.salary, 1);
      } else {
        const role: Role = rng.pick(["AR", "SMG", "Flex"]);
        const callUp = generatePlayer(rng, `${opts.idPrefix}-${callUps++}`, names.next(), role, CALL_UP_TIER, 4);
        sign(withDevelopment({ ...callUp, age: rng.int(18, 20) }, rng), CONTRACT_RULES.minSalary, 1);
      }
    }

    if (opts.upgrades && !inDebt && rosterOf(team).length < CONTRACT_RULES.rosterMax) {
      const years = rng.int(1, CONTRACT_RULES.maxYears);
      // An upgrade has to help now, so rank by current rating rather than outlook.
      const pick = bestAffordable(team, pool, prestige, years, budget, false, "overall");
      const weakest = Math.min(...team.players.map(overall));
      // Only upgrade with a season of the new salary already in the bank.
      const cash = finances[team.id]?.balance ?? 0;
      if (pick && overall(pick.player) >= weakest + 3 && cash >= pick.salary) sign(pick.player, pick.salary, years);
    }

    if (changed || opts.upgrades || team.players.length < CONTRACT_RULES.lineupSize) out[i] = autoLineup(team);
  }
  return { teams: out, freeAgents: pool };
}

/**
 * Best free agent the club can fit under the cap and its payroll budget at
 * their asking price. Filling a gap ranks by scouted outlook, so prospects get
 * signed and played; an upgrade ranks by current rating. Minimum deals always
 * fit, as they do for the manager.
 */
function bestAffordable(
  team: Team,
  pool: Player[],
  prestige: number,
  years: number,
  budget: number,
  minimumOnly = false,
  rank: "outlook" | "overall" = "outlook",
): { player: Player; salary: number } | null {
  const current = payroll(team);
  const score = rank === "outlook" ? outlook : overall;
  const sorted = pool.slice().sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  for (const player of sorted) {
    const salary = askingSalary(player, years, prestige);
    const minimum = salary <= CONTRACT_RULES.minSalary;
    if (minimumOnly && !minimum) continue;
    if (!minimum && current + salary > budget) continue;
    if (fitsUnderCap(current, salary)) return { player, salary };
  }
  return null;
}

/** Cheapest free agent who fits under the cap, best outlook first among equal asks. */
function cheapestAffordable(team: Team, pool: Player[], prestige: number, years: number): { player: Player; salary: number } | null {
  const current = payroll(team);
  let best: { player: Player; salary: number } | null = null;
  for (const player of pool) {
    const salary = askingSalary(player, years, prestige);
    if (!fitsUnderCap(current, salary)) continue;
    if (!best || salary < best.salary || (salary === best.salary && outlook(player) > outlook(best.player))) best = { player, salary };
  }
  return best;
}

/**
 * End of season: decide which final-year players to extend. Clubs keep players
 * close to their lineup level if next season's cap allows, and some players
 * test free agency regardless. Clubs in debt also keep next season's payroll
 * within `budget`, the payroll their recurring income can sustain, so debt
 * shrinks instead of compounding.
 */
export function aiExtendExpiring(team: Team, prestige: number, rng: Rng, budget = Infinity): Team {
  const avg = team.players.reduce((s, p) => s + overall(p), 0) / Math.max(1, team.players.length);
  // Judged on the scouted outlook, so prospects below the lineup average can still be kept.
  let t = team;
  for (const p of rosterOf(team)) {
    const c = p.contract;
    if (!c || c.years !== 1 || c.extension) continue;
    if (outlook(p) < avg - 4 || p.age >= 30 || rng.chance(0.15)) continue;
    // Veterans only get one season at a time now that decline is real.
    const years = p.age >= 28 ? Math.min(1, rng.int(1, CONTRACT_RULES.maxYears)) : rng.int(1, CONTRACT_RULES.maxYears);
    const salary = askingSalary(p, years, prestige, true);
    const next = nextSeasonPayroll(t);
    if (!fitsUnderCap(next, salary)) continue;
    if (salary > CONTRACT_RULES.minSalary && next + salary > budget) continue;
    t = updatePlayer(t, p.id, (x) => ({ ...x, contract: { ...c, extension: { salary, years } } }));
  }
  return t;
}

/**
 * How AI clubs set their payroll budget: what recurring income sustains, plus
 * the prize money a club of their prestige can expect, plus a share of cash
 * above a reserve. Clubs in debt budget below break-even, without counting on
 * prize money, so they climb back out.
 */
export const AI_PAYROLL_POLICY = { reserve: 1_000_000, surplusShare: 0.25, debtShare: 0.85, expectedPrizePerPrestige: 4_000 };

export function aiPayrollBudget(fin: TeamFinances): number {
  const P = AI_PAYROLL_POLICY;
  const base = sustainablePayroll(fin);
  if (fin.balance < 0) return base * P.debtShare;
  return base + fin.prestige * P.expectedPrizePerPrestige + Math.max(0, fin.balance - P.reserve) * P.surplusShare;
}

/**
 * How AI clubs fund training: they keep `reserve` in cash and spend up to
 * `share` of what is above it. The economy harness raises the reserve to
 * switch AI training off for comparison.
 */
export const AI_TRAINING_POLICY = { reserve: 1_000_000, share: 0.75 };

/**
 * AI training level. In preseason a club spends up to three quarters of its cash above the
 * reserve, which drains the surplus rich clubs would otherwise hoard. A club
 * in debt drops to no program on any day.
 */
export function aiTrainingLevel(fin: TeamFinances, preseason: boolean): number {
  if (fin.balance < 0) return 0;
  if (!preseason) return fin.training;
  const budget = (fin.balance - AI_TRAINING_POLICY.reserve) * AI_TRAINING_POLICY.share;
  let level = 0;
  TRAINING_LEVELS.forEach((l, i) => {
    if (l.cost <= budget) level = i;
  });
  return level;
}
