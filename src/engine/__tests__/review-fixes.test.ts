/**
 * Regression tests for issues found in the adversarial review of the
 * contracts, salary cap and finances work.
 */
import { describe, expect, it } from "vitest";
import {
  aiExtendExpiring,
  applyPlacement,
  callUpAcademyPlayer,
  canChangeClub,
  CONTRACT_RULES,
  createLeague,
  extendContract,
  extensionAsk,
  freeAgentAsk,
  generateLeague,
  initialFinances,
  lineupProblem,
  nextSeasonPayroll,
  overall,
  playNextDay,
  playSeason,
  Rng,
  rosterOf,
  setUserTeam,
  signFreeAgent,
  startNextSeason,
  sustainablePayroll,
  teamById,
  type Player,
  type Season,
  type Team,
  type TxResult,
} from "..";

const ok = (r: TxResult): Season => {
  if (!r.ok) throw new Error(r.reason);
  return r.season;
};
const user = (s: Season) => teamById(s, s.userTeamId!);
const withUserTeam = (s: Season, fn: (t: Team) => Team): Season => ({
  ...s,
  teams: s.teams.map((t) => (t.id === s.userTeamId ? fn(t) : t)),
});
const withBalance = (s: Season, balance: number): Season => ({
  ...s,
  finances: { ...s.finances, [s.userTeamId!]: { ...s.finances[s.userTeamId!], balance } },
});
const pay = (p: Player, salary: number, years: number): Player => ({ ...p, contract: { salary, years } });

describe("debt", () => {
  it("lets a club in debt sign at the league minimum and nothing above it", () => {
    const s = withBalance(withUserTeam(createLeague("debt"), (t) => ({ ...t, players: t.players.slice(0, 3), bench: [] })), -10_000);
    const uid = s.userTeamId!;
    const minAsk = s.freeAgents.find((p) => freeAgentAsk(s, uid, p, 1) === CONTRACT_RULES.minSalary);
    const pricey = s.freeAgents.find((p) => freeAgentAsk(s, uid, p, 1) > CONTRACT_RULES.minSalary)!;
    const refused = signFreeAgent(s, uid, pricey.id, { salary: freeAgentAsk(s, uid, pricey, 1), years: 1 });
    expect(!refused.ok && refused.reason).toMatch(/league minimum/);
    if (minAsk) {
      const after = ok(signFreeAgent(s, uid, minAsk.id, { salary: CONTRACT_RULES.minSalary, years: 1 }));
      expect(lineupProblem(after)).toBeNull();
    }
  });

  it("academy call-ups rescue a club that is short, capped out and in debt", () => {
    let s = withUserTeam(createLeague("academy"), (t) => ({
      ...t,
      players: t.players.slice(0, 3).map((p) => pay(p, 560_000, 2)),
      bench: [],
    }));
    s = withBalance(s, -50_000);
    expect(lineupProblem(s)).toMatch(/only has 3 starters/);
    const before = [...s.teams.flatMap(rosterOf), ...s.freeAgents].map((p) => p.name);
    s = ok(callUpAcademyPlayer(s, s.userTeamId!));
    const added = user(s).players[3];
    expect(added.contract).toEqual({ salary: CONTRACT_RULES.minSalary, years: 1 });
    expect(before).not.toContain(added.name);
    expect(lineupProblem(s)).toBeNull();
    expect(() => playNextDay(s)).not.toThrow();
    expect(callUpAcademyPlayer(s, s.userTeamId!).ok).toBe(false);
  });

  it("academy call-ups in the offseason run through next season", () => {
    let s = playSeason(createLeague("academy-off"));
    s = withUserTeam(s, (t) => ({ ...t, players: t.players.slice(0, 2), bench: [] }));
    s = ok(callUpAcademyPlayer(s, s.userTeamId!));
    s = ok(callUpAcademyPlayer(s, s.userTeamId!));
    const ids = user(s).players.slice(2).map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    const next = startNextSeason(s);
    for (const id of ids) expect(rosterOf(user(next)).find((p) => p.id === id)?.contract?.years).toBe(1);
  });

  it("AI clubs in debt keep next season's payroll within what they can sustain", () => {
    const team = generateLeague("ai-debt")[0];
    const expiring = { ...team, players: team.players.map((p) => pay(p, 300_000, 1)), bench: [] };
    const budget = 600_000;
    let extendedSomeone = false;
    for (let i = 0; i < 20; i++) {
      const out = aiExtendExpiring(expiring, 60, new Rng(`ai-debt-${i}`), budget);
      const above = rosterOf(out).filter((p) => (p.contract?.extension?.salary ?? 0) > CONTRACT_RULES.minSalary);
      expect(above.reduce((s, p) => s + p.contract!.extension!.salary, 0)).toBeLessThanOrEqual(budget);
      extendedSomeone ||= above.length > 0;
    }
    expect(extendedSomeone).toBe(true);
  });

  it("sustainable payroll tracks recurring income", () => {
    const fin = initialFinances(generateLeague("sustain")[0]);
    expect(sustainablePayroll({ ...fin, prestige: 80 })).toBeGreaterThan(sustainablePayroll({ ...fin, prestige: 20 }));
    expect(sustainablePayroll({ ...fin, prestige: 20, fans: 100 })).toBe(600_000 + 100_000 + 20 * 6_000 + 100 * 25 * 40 - 300_000);
  });
});

describe("cap", () => {
  it("refuses a multi-season signing that breaks next season's cap after an extension", () => {
    let s = playNextDay(createLeague("cap-bypass"));
    const sorted = user(s).players.slice().sort((a, b) => overall(a) - overall(b));
    const expiringId = sorted[0].id;
    s = withUserTeam(s, (t) => ({
      ...t,
      players: t.players.map((p) => (p.id === expiringId ? pay(p, 100_000, 1) : pay(p, 350_000, 2))),
      bench: [],
    }));
    const uid = s.userTeamId!;
    const extendTo = CONTRACT_RULES.salaryCap - nextSeasonPayroll(user(s));
    const expiring = user(s).players.find((p) => p.id === expiringId)!;
    expect(extendTo).toBeGreaterThanOrEqual(extensionAsk(s, uid, expiring, 1));
    s = ok(extendContract(s, uid, expiringId, { salary: extendTo, years: 1 }));
    expect(nextSeasonPayroll(user(s))).toBe(CONTRACT_RULES.salaryCap);

    const fa = s.freeAgents.find((p) => {
      const ask = freeAgentAsk(s, uid, p, 2);
      return ask > CONTRACT_RULES.minSalary && ask <= 400_000;
    })!;
    const twoYear = signFreeAgent(s, uid, fa.id, { salary: freeAgentAsk(s, uid, fa, 2), years: 2 });
    expect(!twoYear.ok && twoYear.reason).toMatch(/next season's payroll/);
    // A one-season deal only touches this season and still fits.
    expect(signFreeAgent(s, uid, fa.id, { salary: freeAgentAsk(s, uid, fa, 1), years: 1 }).ok).toBe(true);
  });

  it("refuses to rewrite an agreed extension", () => {
    let s = createLeague("re-extend");
    const uid = s.userTeamId!;
    const p = user(s).players[0];
    s = withUserTeam(s, (t) => ({ ...t, players: t.players.map((x) => (x.id === p.id ? pay(x, 80_000, 1) : x)) }));
    s = ok(extendContract(s, uid, p.id, { salary: CONTRACT_RULES.maxSalary, years: 3 }));
    const again = extendContract(s, uid, p.id, { salary: CONTRACT_RULES.maxSalary, years: 1 });
    expect(!again.ok && again.reason).toMatch(/already agreed/);
  });

  it("never generates a starting contract below the league minimum", () => {
    for (let i = 0; i < 30; i++) {
      for (const t of generateLeague(`min-${i}`)) {
        for (const p of rosterOf(t)) expect(p.contract!.salary).toBeGreaterThanOrEqual(CONTRACT_RULES.minSalary);
      }
    }
  });
});

describe("prestige", () => {
  it("converges all the way to its placement target", () => {
    const team = generateLeague("prestige-target")[0];
    let high = { ...initialFinances(team), prestige: 98 };
    let low = { ...initialFinances(team), prestige: 22 };
    for (let i = 0; i < 30; i++) {
      high = applyPlacement(high, 1, "major", 1, 0, "win");
      low = applyPlacement(low, 11, "major", 1, 0, "last");
    }
    expect(high.prestige).toBe(100);
    expect(low.prestige).toBe(20);
  });
});

describe("club choice", () => {
  it("can only change before the league's first match day", () => {
    const s = createLeague("switch");
    const other = s.teams.find((t) => t.id !== s.userTeamId)!.id;
    expect(canChangeClub(s)).toBe(true);
    expect(setUserTeam(s, other).userTeamId).toBe(other);
    const played = playNextDay(s);
    expect(canChangeClub(played)).toBe(false);
    expect(setUserTeam(played, other).userTeamId).toBe(s.userTeamId);
  });
});
