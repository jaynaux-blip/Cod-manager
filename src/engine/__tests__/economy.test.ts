import { describe, expect, it } from "vitest";
import {
  benchPlayer,
  buyoutCost,
  CONTRACT_RULES,
  createLeague,
  createSeason,
  extendContract,
  freeAgentAsk,
  generateLeague,
  isFinished,
  lineupProblem,
  marketValue,
  nextSeasonPayroll,
  overall,
  payroll,
  playNextDay,
  playSeason,
  playStage,
  releasePlayer,
  rosterLocked,
  rosterOf,
  signFreeAgent,
  startNextSeason,
  startPlayer,
  summarize,
  teamById,
  type Player,
  type Season,
  type TxResult,
} from "..";

const ok = (r: TxResult): Season => {
  if (!r.ok) throw new Error(r.reason);
  return r.season;
};

const userTeam = (s: Season) => teamById(s, s.userTeamId!);

/** A league where the managed club is guaranteed some cap room. */
function leagueWithRoom(): Season {
  const s = createLeague("economy-test");
  const team = userTeam(s);
  // Trim the bench so there is a free roster slot and some cap space.
  return { ...s, teams: s.teams.map((t) => (t.id === team.id ? { ...t, bench: [] } : t)) };
}

function cheapestFreeAgent(s: Season): Player {
  return s.freeAgents.slice().sort((a, b) => freeAgentAsk(s, s.userTeamId!, a, 1) - freeAgentAsk(s, s.userTeamId!, b, 1))[0];
}

describe("contracts", () => {
  it("values better players higher and respects the minimum", () => {
    const [team] = generateLeague("values");
    const sorted = team.players.slice().sort((a, b) => overall(a) - overall(b));
    const worst = { ...sorted[0], age: 24 };
    const best = { ...sorted[sorted.length - 1], age: 24 };
    expect(marketValue(best)).toBeGreaterThanOrEqual(marketValue(worst));
    const scrub = { ...worst, attributes: { aim: 30, positioning: 30, gameSense: 30, consistency: 30, clutch: 30, comms: 30 } };
    expect(marketValue(scrub)).toBe(CONTRACT_RULES.minSalary);
  });

  it("generates leagues under the cap with unique names and tags", () => {
    const s = createLeague("unique");
    for (const t of s.teams) {
      expect(payroll(t)).toBeLessThanOrEqual(CONTRACT_RULES.salaryCap);
      expect(t.players).toHaveLength(4);
      for (const p of rosterOf(t)) expect(p.contract).toBeDefined();
    }
    const names = [...s.teams.flatMap(rosterOf), ...s.freeAgents].map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(s.teams.map((t) => t.tag)).size).toBe(s.teams.length);
    expect(s.freeAgents.every((p) => !p.contract)).toBe(true);
    expect(s.userTeamId).not.toBeNull();
  });
});

describe("transactions", () => {
  it("signs a free agent who gets their asking price", () => {
    const s = leagueWithRoom();
    const fa = cheapestFreeAgent(s);
    const ask = freeAgentAsk(s, s.userTeamId!, fa, 2);
    const after = ok(signFreeAgent(s, s.userTeamId!, fa.id, { salary: ask, years: 2 }));
    const signed = rosterOf(userTeam(after)).find((p) => p.id === fa.id)!;
    expect(signed.contract).toEqual({ salary: ask, years: 2 });
    expect(after.freeAgents.some((p) => p.id === fa.id)).toBe(false);
    // The original season is untouched.
    expect(s.freeAgents.some((p) => p.id === fa.id)).toBe(true);
  });

  it("refuses lowball offers, cap-busting deals and full rosters", () => {
    const s = leagueWithRoom();
    const fa = s.freeAgents.slice().sort((a, b) => overall(b) - overall(a))[0];
    const ask = freeAgentAsk(s, s.userTeamId!, fa, 1);
    const low = signFreeAgent(s, s.userTeamId!, fa.id, { salary: ask - 5_000, years: 1 });
    expect(low.ok).toBe(false);
    if (ask > CONTRACT_RULES.minSalary) expect(!low.ok && low.reason).toMatch(/wants at least/);

    const broke = { ...s, teams: s.teams.map((t) => (t.id === s.userTeamId ? { ...t, players: t.players.map((p) => ({ ...p, contract: { salary: 400_000, years: 1 } })) } : t)) };
    const capped = signFreeAgent(broke, s.userTeamId!, fa.id, { salary: Math.max(ask, 100_000), years: 1 });
    expect(capped.ok).toBe(false);
    expect(!capped.ok && capped.reason).toMatch(/over the cap/);

    let full = s;
    while (rosterOf(userTeam(full)).length < CONTRACT_RULES.rosterMax) {
      const cheap = cheapestFreeAgent(full);
      full = ok(signFreeAgent(full, full.userTeamId!, cheap.id, { salary: freeAgentAsk(full, full.userTeamId!, cheap, 1), years: 1 }));
    }
    const extra = cheapestFreeAgent(full);
    const r = signFreeAgent(full, full.userTeamId!, extra.id, { salary: CONTRACT_RULES.maxSalary, years: 1 });
    expect(!r.ok && r.reason).toMatch(/roster is full/);
  });

  it("allows a league-minimum deal even over the cap", () => {
    const s = leagueWithRoom();
    const fa = s.freeAgents.find((p) => freeAgentAsk(s, s.userTeamId!, p, 1) === CONTRACT_RULES.minSalary);
    if (!fa) return;
    const maxed = { ...s, teams: s.teams.map((t) => (t.id === s.userTeamId ? { ...t, players: t.players.map((p) => ({ ...p, contract: { salary: 400_000, years: 1 } })) } : t)) };
    expect(signFreeAgent(maxed, s.userTeamId!, fa.id, { salary: CONTRACT_RULES.minSalary, years: 1 }).ok).toBe(true);
  });

  it("charges half the remaining contract to release a player", () => {
    const s = createLeague("release");
    const team = userTeam(s);
    const p = team.players[0];
    const c = p.contract!;
    const cost = buyoutCost(s, p);
    expect(cost).toBe(Math.round((c.salary * c.years * 0.5) / 1000) * 1000);
    const after = ok(releasePlayer(s, team.id, p.id));
    expect(after.finances[team.id].balance).toBe(s.finances[team.id].balance - cost);
    expect(after.freeAgents.find((x) => x.id === p.id)?.contract).toBeUndefined();
    expect(lineupProblem(after)).toMatch(/only has 3 starters/);
    expect(() => playNextDay(after)).toThrow(/starters/);
  });

  it("swaps a substitute into a full lineup", () => {
    const s = createLeague("swap");
    const team = userTeam(s);
    const sub = team.bench[0];
    const out = team.players[2];
    expect(startPlayer(s, team.id, sub.id).ok).toBe(false);
    const after = ok(startPlayer(s, team.id, sub.id, out.id));
    expect(userTeam(after).players.map((p) => p.id)).toContain(sub.id);
    expect(userTeam(after).bench.map((p) => p.id)).toEqual([out.id]);
    const benched = ok(benchPlayer(after, team.id, sub.id));
    expect(userTeam(benched).players).toHaveLength(3);
  });

  it("locks rosters during Champs", () => {
    let s = createLeague("lock");
    while (!rosterLocked(s)) s = playStage(s);
    expect(s.stages[s.days[s.currentDay].stage].kind).toBe("champs");
    const fa = s.freeAgents[0];
    expect(signFreeAgent(s, s.userTeamId!, fa.id, { salary: CONTRACT_RULES.maxSalary, years: 1 }).ok).toBe(false);
    s = playSeason(s);
    expect(rosterLocked(s)).toBe(false);
  });
});

describe("finances", () => {
  it("books every dollar in the ledger and pays the champion", () => {
    const s0 = createSeason("ledger", generateLeague("ledger"));
    const s = playSeason(s0);
    for (const t of s.teams) {
      const fin = s.finances[t.id];
      const total = fin.ledger.reduce((sum, e) => sum + e.amount, 0);
      expect(fin.balance).toBe(s0.finances[t.id].balance + total);
      expect(summarize(fin, s.year).net).toBe(total);
    }
    const champ = s.finances[s.champion!];
    expect(champ.ledger.some((e) => e.kind === "prize" && e.amount === 1_000_000)).toBe(true);
    // Every club pays salaries and gets the league share every day.
    const days = s.days.length;
    for (const t of s.teams) {
      expect(s.finances[t.id].ledger.filter((e) => e.kind === "league")).toHaveLength(days);
    }
  });

  it("moves prestige towards results", () => {
    const s = playStage(createSeason("prestige", generateLeague("prestige")));
    const winner = Object.entries(s.stages[0].placements!).find(([, p]) => p === 1)![0];
    const last = Object.entries(s.stages[0].placements!).find(([, p]) => p === 11)![0];
    const before = createSeason("prestige", generateLeague("prestige")).finances;
    expect(s.finances[winner].prestige).toBeGreaterThanOrEqual(before[winner].prestige);
    expect(s.finances[last].prestige).toBeLessThanOrEqual(before[last].prestige);
  });
});

describe("offseason", () => {
  it("rolls contracts, applies extensions and releases expired players", () => {
    let s = playSeason(createLeague("rollover"));
    expect(isFinished(s)).toBe(true);
    const team = userTeam(s);
    const expiring = rosterOf(team).filter((p) => p.contract!.years === 1);
    const multi = rosterOf(team).filter((p) => p.contract!.years > 1);
    let extended: Player | null = null;
    for (const p of expiring) {
      const r = extendContract(s, team.id, p.id, { salary: CONTRACT_RULES.maxSalary, years: 2 });
      if (r.ok) {
        s = r.season;
        extended = p;
        break;
      }
    }
    if (multi.length > 0) {
      expect(extendContract(s, team.id, multi[0].id, { salary: CONTRACT_RULES.maxSalary, years: 2 }).ok).toBe(false);
    }

    const next = startNextSeason(s);
    expect(next.year).toBe(2);
    expect(next.currentDay).toBe(0);
    const after = userTeam(next);
    for (const p of multi) {
      expect(rosterOf(after).find((x) => x.id === p.id)?.contract?.years).toBe(p.contract!.years - 1);
    }
    if (extended) {
      expect(rosterOf(after).find((x) => x.id === extended!.id)?.contract).toEqual({ salary: CONTRACT_RULES.maxSalary, years: 2 });
    }
    for (const p of expiring) {
      if (p.id === extended?.id) continue;
      expect(rosterOf(after).some((x) => x.id === p.id)).toBe(false);
      expect(next.freeAgents.some((x) => x.id === p.id)).toBe(true);
    }
    expect(next.freeAgents.some((p) => p.id.startsWith("rk-2"))).toBe(true);
    // Balances carry over.
    expect(next.finances[team.id].balance).toBe(s.finances[team.id].balance);
  });

  it("AI clubs always field four once the new season starts", () => {
    let s = playSeason(createLeague("ai-fill"));
    s = startNextSeason(s);
    // Give the managed club a valid lineup so the day can be played.
    const team = userTeam(s);
    let fixed = s;
    while (userTeam(fixed).players.length < 4) {
      const benchP = userTeam(fixed).bench[0];
      if (benchP) {
        fixed = ok(startPlayer(fixed, team.id, benchP.id));
      } else {
        const cheap = cheapestFreeAgent(fixed);
        fixed = ok(signFreeAgent(fixed, team.id, cheap.id, { salary: freeAgentAsk(fixed, team.id, cheap, 1), years: 1 }));
      }
    }
    const played = playNextDay(fixed);
    for (const t of played.teams) {
      expect(t.players).toHaveLength(4);
      expect(rosterOf(t).length).toBeLessThanOrEqual(CONTRACT_RULES.rosterMax);
      if (t.id !== played.userTeamId) expect(nextSeasonPayroll(t)).toBeGreaterThanOrEqual(0);
    }
  });

  it("signing in the offseason runs from next season", () => {
    const s = playSeason(leagueWithRoom());
    const fa = cheapestFreeAgent(s);
    const after = ok(signFreeAgent(s, s.userTeamId!, fa.id, { salary: freeAgentAsk(s, s.userTeamId!, fa, 2), years: 2 }));
    const next = startNextSeason(after);
    expect(rosterOf(userTeam(next)).find((p) => p.id === fa.id)?.contract?.years).toBe(2);
  });

  it("plays several seasons back to back", () => {
    let s: Season = { ...createLeague("multi"), userTeamId: null };
    for (let y = 0; y < 3; y++) {
      if (y > 0) s = startNextSeason(s);
      s = playSeason(s);
      expect(s.champion).toBeDefined();
    }
    expect(s.year).toBe(3);
  });
});
