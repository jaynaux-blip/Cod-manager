/**
 * Front-office logic for clubs the player does not manage.
 */
import {
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
import type { TeamFinances } from "./finance";
import { generatePlayer, NameGen } from "./generate";
import { overall } from "./ratings";
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
    const prestige = finances[team.id]?.prestige ?? 50;
    // Clubs in debt follow the same rule as the manager: no deals above the minimum.
    const inDebt = (finances[team.id]?.balance ?? 0) < 0;
    const sign = (p: Player, salary: number, years: number) => {
      team = addToRoster(team, { ...p, contract: { salary, years } });
      pool = pool.filter((x) => x.id !== p.id);
      changed = true;
    };

    while (rosterOf(team).length < CONTRACT_RULES.lineupSize) {
      const years = rng.int(1, 2);
      const pick = bestAffordable(team, pool, prestige, years, inDebt);
      if (pick) {
        sign(pick.player, pick.salary, years);
      } else {
        const role: Role = rng.pick(["AR", "SMG", "Flex"]);
        const callUp = generatePlayer(rng, `${opts.idPrefix}-${callUps++}`, names.next(), role, CALL_UP_TIER, 4);
        sign({ ...callUp, age: rng.int(18, 20) }, CONTRACT_RULES.minSalary, 1);
      }
    }

    if (opts.upgrades && !inDebt && rosterOf(team).length < CONTRACT_RULES.rosterMax) {
      const years = rng.int(1, CONTRACT_RULES.maxYears);
      const pick = bestAffordable(team, pool, prestige, years);
      const weakest = Math.min(...team.players.map(overall));
      // Only upgrade with a season of the new salary already in the bank.
      const cash = finances[team.id]?.balance ?? 0;
      if (pick && overall(pick.player) >= weakest + 3 && cash >= pick.salary) sign(pick.player, pick.salary, years);
    }

    if (changed || opts.upgrades || team.players.length < CONTRACT_RULES.lineupSize) out[i] = autoLineup(team);
  }
  return { teams: out, freeAgents: pool };
}

/** Highest-rated free agent the club can fit under the cap at their asking price. */
function bestAffordable(
  team: Team,
  pool: Player[],
  prestige: number,
  years: number,
  minimumOnly = false,
): { player: Player; salary: number } | null {
  const current = payroll(team);
  const sorted = pool.slice().sort((a, b) => overall(b) - overall(a));
  for (const player of sorted) {
    const salary = askingSalary(player, years, prestige);
    if (minimumOnly && salary > CONTRACT_RULES.minSalary) continue;
    if (fitsUnderCap(current, salary)) return { player, salary };
  }
  return null;
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
  let t = team;
  for (const p of rosterOf(team)) {
    const c = p.contract;
    if (!c || c.years !== 1 || c.extension) continue;
    if (overall(p) < avg - 4 || p.age >= 31 || rng.chance(0.15)) continue;
    const years = rng.int(1, CONTRACT_RULES.maxYears);
    const salary = askingSalary(p, years, prestige, true);
    const next = nextSeasonPayroll(t);
    if (!fitsUnderCap(next, salary)) continue;
    if (salary > CONTRACT_RULES.minSalary && next + salary > budget) continue;
    t = updatePlayer(t, p.id, (x) => ({ ...x, contract: { ...c, extension: { salary, years } } }));
  }
  return t;
}
