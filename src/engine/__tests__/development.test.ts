import { describe, expect, it } from "vitest";
import {
  AI_TRAINING_POLICY,
  aiTrainingLevel,
  createLeague,
  developPlayer,
  DEV_RULES,
  exactOverall,
  fanBaseline,
  generateLeague,
  initialFinances,
  isFinished,
  overall,
  playNextDay,
  playSeason,
  potentialRange,
  retirementChance,
  Rng,
  rosterOf,
  setTrainingLevel,
  settleFans,
  startNextSeason,
  teamById,
  TRAINING_LEVELS,
  trainingBoost,
  trainingSpend,
  withDevelopment,
  type Player,
  type Season,
  type TxResult,
} from "..";

const ok = (r: TxResult): Season => {
  if (!r.ok) throw new Error(r.reason);
  return r.season;
};

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const players = (): Player[] => generateLeague("dev-players").flatMap(rosterOf);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Play a season up to, but not including, its final match day. */
function toLastDay(seed: string): Season {
  let s: Season = { ...createLeague(seed), userTeamId: null };
  while (s.currentDay < s.days.length - 1) s = playNextDay(s);
  return s;
}

describe("scouting", () => {
  it("adds development without touching anything else", () => {
    const p = players()[0];
    const { dev, ...rest } = withDevelopment({ ...p, dev: undefined }, new Rng("x"));
    expect({ ...rest, dev: undefined }).toEqual({ ...p, dev: undefined });
    expect(dev!.potential).toBeGreaterThanOrEqual(Math.min(DEV_RULES.maxPotential, Math.floor(exactOverall(p))));
    expect(withDevelopment(p, new Rng("x")).dev).toEqual(withDevelopment(p, new Rng("x")).dev);
  });

  it("shows a range that never sits below the current rating and closes at 25", () => {
    for (const p of players()) {
      const range = potentialRange(p);
      if (p.age >= 25) {
        expect(range).toBeNull();
      } else {
        expect(range![0]).toBeGreaterThanOrEqual(Math.min(99, overall(p)));
        expect(range![1]).toBeLessThanOrEqual(99);
        expect(range![1]).toBeGreaterThanOrEqual(range![0]);
      }
    }
    const young = { ...players()[0], age: 18 };
    const older = { ...young, age: 23 };
    const width = (r: [number, number] | null) => (r ? r[1] - r[0] : 0);
    expect(width(potentialRange(young))).toBeGreaterThanOrEqual(width(potentialRange(older)));
  });
});

describe("developPlayer", () => {
  it("is deterministic and ages the player by exactly one year", () => {
    const p = players()[3];
    const a = developPlayer(p, { maps: 80, boost: 0 }, new Rng("d"));
    const b = developPlayer(p, { maps: 80, boost: 0 }, new Rng("d"));
    expect(a).toEqual(b);
    expect(a.player.age).toBe(p.age + 1);
    for (const v of Object.values(a.player.attributes)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(99);
    }
  });

  it("grows prospects and declines veterans on average", () => {
    const base = players();
    const prospects = base.map((p) => ({ ...p, age: 19, dev: { potential: Math.min(95, overall(p) + 12), peakAge: 24, scoutBias: 0 } }));
    const veterans = base.map((p) => ({ ...p, age: 29, dev: { potential: overall(p), peakAge: 24, scoutBias: 0 } }));
    const change = (ps: Player[]) => mean(ps.map((p, i) => exactOverall(developPlayer(p, { maps: 80, boost: 0 }, new Rng(`g${i}`)).player) - exactOverall(p)));
    expect(change(prospects)).toBeGreaterThan(3);
    expect(change(veterans)).toBeLessThan(-2);
  });

  it("takes aim from veterans faster than game sense and comms", () => {
    const vets = players().map((p) => ({ ...p, age: 30, dev: { potential: overall(p), peakAge: 24, scoutBias: 0 } }));
    const delta = (k: "aim" | "gameSense" | "comms") =>
      mean(vets.map((p, i) => developPlayer(p, { maps: 80, boost: 0 }, new Rng(`v${i}`)).player.attributes[k] - p.attributes[k]));
    expect(delta("aim")).toBeLessThan(delta("gameSense"));
    expect(delta("aim")).toBeLessThan(delta("comms"));
  });

  it("develops starters faster than the bench and free agents", () => {
    const prospects = players().map((p) => ({ ...p, age: 19, dev: { potential: Math.min(95, overall(p) + 12), peakAge: 24, scoutBias: 0 } }));
    const change = (maps: number | null) =>
      mean(prospects.map((p, i) => exactOverall(developPlayer(p, { maps, boost: 0 }, new Rng(`r${i}`)).player) - exactOverall(p)));
    expect(change(100)).toBeGreaterThan(change(0));
    expect(change(0)).toBeGreaterThan(change(null));
  });

  it("never makes a player worse for spending more on training", () => {
    const boost = trainingBoost(TRAINING_LEVELS[4].cost);
    for (const [i, p] of players().entries()) {
      for (const age of [19, 24, 30]) {
        const q = { ...p, age };
        const none = developPlayer(q, { maps: 60, boost: 0 }, new Rng(`t${i}:${age}`)).player;
        const top = developPlayer(q, { maps: 60, boost }, new Rng(`t${i}:${age}`)).player;
        expect(exactOverall(top)).toBeGreaterThanOrEqual(exactOverall(none) - 1e-9);
        expect(top.dev!.potential).toBe(none.dev!.potential);
      }
    }
  });
});

describe("season development", () => {
  it("runs once when Champs ends: every player ages a year", () => {
    const before = toLastDay("ages");
    const after = playNextDay(before);
    expect(isFinished(after)).toBe(true);
    const ageOf = (s: Season) => new Map([...s.teams.flatMap(rosterOf), ...s.freeAgents].map((p) => [p.id, p.age]));
    const a = ageOf(before);
    // AI clubs may have signed someone from the pool that day, so compare by id.
    for (const [id, age] of ageOf(after)) if (a.has(id)) expect(age).toBe(a.get(id)! + 1);
    expect(after.development!.year).toBe(before.year);
    const reported = new Set(after.development!.changes.map((c) => c.playerId));
    for (const p of after.teams.flatMap(rosterOf)) expect(reported.has(p.id)).toBe(true);
  });

  it("does not mutate the previous season", () => {
    const before = deepFreeze(toLastDay("frozen"));
    expect(() => playNextDay(before)).not.toThrow();
    const finished = deepFreeze(playNextDay(toLastDay("frozen")));
    expect(() => startNextSeason(finished)).not.toThrow();
  });

  it("gives each player the same result whatever order the roster is in", () => {
    const s = toLastDay("order");
    const done = playSeason(s);
    const reversed = playSeason({ ...s, teams: s.teams.map((t) => ({ ...t, bench: t.bench.slice().reverse() })).reverse() });
    const attrs = (x: Season) => Object.fromEntries(x.teams.flatMap(rosterOf).map((p) => [p.id, p.attributes]));
    expect(attrs(reversed)).toEqual(attrs(done));
  });

  it("is deterministic across seasons", () => {
    const run = () => {
      let s: Season = { ...createLeague("det-dev"), userTeamId: null };
      s = startNextSeason(playSeason(s));
      return playSeason(s);
    };
    const a = run();
    const b = run();
    expect(a.teams).toEqual(b.teams);
    expect(a.freeAgents).toEqual(b.freeAgents);
    expect(a.development).toEqual(b.development);
  });
});

describe("retirement", () => {
  it("rises with age and falls for stars", () => {
    const p = players()[0];
    expect(retirementChance({ ...p, age: 22 }, false)).toBeLessThanOrEqual(retirementChance({ ...p, age: 28 }, false));
    expect(retirementChance({ ...p, age: 28 }, false)).toBeLessThanOrEqual(retirementChance({ ...p, age: 31 }, false));
    expect(retirementChance({ ...p, age: 34 }, false)).toBe(1);
    expect(retirementChance({ ...p, age: 28 }, true)).toBeGreaterThan(retirementChance({ ...p, age: 28 }, false));
  });

  it("retires contracted players only at the hard age limit", () => {
    let s = playSeason(createLeague("retire"));
    const uid = s.userTeamId!;
    const [old, young] = teamById(s, uid).players;
    s = {
      ...s,
      teams: s.teams.map((t) =>
        t.id === uid
          ? {
              ...t,
              players: t.players.map((p) =>
                p.id === old.id ? { ...p, age: DEV_RULES.hardRetireAge, contract: { salary: 100_000, years: 3 } } : p.id === young.id ? { ...p, age: 33, contract: { salary: 100_000, years: 3 } } : p,
              ),
            }
          : t,
      ),
    };
    const next = startNextSeason(s);
    const roster = rosterOf(teamById(next, uid)).map((p) => p.id);
    expect(roster).not.toContain(old.id);
    expect(roster).toContain(young.id);
    expect(next.development!.retired.find((r) => r.playerId === old.id)?.forced).toBe(true);
    for (const r of next.development!.retired) {
      expect(next.freeAgents.some((p) => p.id === r.playerId)).toBe(false);
      expect(next.teams.flatMap(rosterOf).some((p) => p.id === r.playerId)).toBe(false);
    }
    expect(next.development!.rookies).toHaveLength(8);
  });
});

describe("training", () => {
  it("charges the program cost through the ledger, per match day", () => {
    let s = createLeague("train");
    const uid = s.userTeamId!;
    s = ok(setTrainingLevel(s, uid, 2));
    s = playSeason(s);
    expect(trainingSpend(s.finances[uid], 1)).toBeCloseTo(TRAINING_LEVELS[2].cost, -2);
  });

  it("refuses raising the program in debt but always allows lowering", () => {
    let s = createLeague("train-debt");
    const uid = s.userTeamId!;
    s = ok(setTrainingLevel(s, uid, 3));
    s = { ...s, finances: { ...s.finances, [uid]: { ...s.finances[uid], balance: -1 } } };
    expect(setTrainingLevel(s, uid, 4).ok).toBe(false);
    expect(setTrainingLevel(s, uid, 1).ok).toBe(true);
    expect(setTrainingLevel(s, uid, 9).ok).toBe(false);
  });

  it("AI clubs fund training from surplus and drop it in debt", () => {
    const fin = initialFinances(generateLeague("ai-train")[0]);
    expect(aiTrainingLevel({ ...fin, balance: AI_TRAINING_POLICY.reserve }, true)).toBe(0);
    expect(aiTrainingLevel({ ...fin, balance: 10_000_000 }, true)).toBe(TRAINING_LEVELS.length - 1);
    expect(aiTrainingLevel({ ...fin, balance: -1, training: 3 }, false)).toBe(0);
    expect(aiTrainingLevel({ ...fin, balance: 5_000_000, training: 2 }, false)).toBe(2);
  });

  it("boost has diminishing returns", () => {
    const b = TRAINING_LEVELS.map((l) => trainingBoost(l.cost));
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
    expect(b[1] - b[0]).toBeGreaterThan((b[4] - b[3]) * (TRAINING_LEVELS[1].cost / (TRAINING_LEVELS[4].cost - TRAINING_LEVELS[3].cost)));
    expect(b[b.length - 1]).toBeLessThan(0.5);
  });
});

describe("fans", () => {
  it("settle part of the way back to the prestige baseline each offseason", () => {
    const fin = { ...initialFinances(generateLeague("fans")[0]), prestige: 50 };
    const high = settleFans({ ...fin, fans: 800 });
    expect(high.fans).toBeLessThan(800);
    expect(high.fans).toBeGreaterThan(fanBaseline(50));
    expect(settleFans({ ...fin, fans: fanBaseline(50) }).fans).toBe(fanBaseline(50));
  });
});
