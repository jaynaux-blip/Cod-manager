/**
 * Regression tests for issues found in the adversarial review of player
 * development, retirement and training.
 */
import { describe, expect, it } from "vitest";
import {
  aiTrainingLevel,
  ATTRIBUTE_KEYS,
  callUpAcademyPlayer,
  createLeague,
  developPlayer,
  exactOverall,
  extendContract,
  freeAgentAsk,
  generateLeague,
  maxExtensionYears,
  maxSigningYears,
  playSeason,
  releasePlayer,
  retirementChance,
  Rng,
  rosterOf,
  satWholeSeasonUnsigned,
  setTrainingLevel,
  settleFans,
  signFreeAgent,
  startNextSeason,
  teamById,
  TRAINING_LEVELS,
  trainingBoost,
  type Player,
  type Season,
  type TxResult,
} from "..";

const ok = (r: TxResult): Season => {
  if (!r.ok) throw new Error(r.reason);
  return r.season;
};
const user = (s: Season) => teamById(s, s.userTeamId!);
const withUserPlayers = (s: Season, fn: (p: Player, i: number) => Player): Season => ({
  ...s,
  teams: s.teams.map((t) => (t.id === s.userTeamId ? { ...t, players: t.players.map(fn) } : t)),
});

describe("training never makes a player worse", () => {
  it("holds for every attribute of past-peak players", () => {
    const top = trainingBoost(TRAINING_LEVELS[4].cost);
    let cases = 0;
    for (const league of ["L0", "L1", "L2"]) {
      for (const p of generateLeague(league).flatMap(rosterOf)) {
        for (let age = 24; age <= 32; age += 2) {
          for (const maps of [0, 60, 120]) {
            const q = { ...p, age };
            const seed = `t${p.id}:${age}:${maps}`;
            const none = developPlayer(q, { maps, boost: 0 }, new Rng(seed)).player;
            const elite = developPlayer(q, { maps, boost: top }, new Rng(seed)).player;
            for (const k of ATTRIBUTE_KEYS) expect(elite.attributes[k]).toBeGreaterThanOrEqual(none.attributes[k]);
            expect(exactOverall(elite)).toBeGreaterThanOrEqual(exactOverall(none) - 1e-9);
            cases++;
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(2000);
  });

  it("covers the case the review reported", () => {
    const p = generateLeague("L0").flatMap(rosterOf).find((x) => x.id === "team-7-p2")!;
    const q: Player = { ...p, age: 27, dev: { ...p.dev!, potential: 86, peakAge: 25 } };
    const none = developPlayer(q, { maps: 60, boost: 0 }, new Rng("tteam-7-p2:27:60:0")).player;
    const elite = developPlayer(q, { maps: 60, boost: trainingBoost(TRAINING_LEVELS[4].cost) }, new Rng("tteam-7-p2:27:60:0")).player;
    expect(exactOverall(elite)).toBeGreaterThanOrEqual(exactOverall(none));
  });
});

describe("veterans near the top of the scale", () => {
  it("stop gaining game sense and comms from age, and still decline by the full amount", () => {
    const base = generateLeague("vets")[0].players[0];
    const vet: Player = {
      ...base,
      age: 31,
      attributes: { ...base.attributes, gameSense: 97, comms: 97 },
      dev: { potential: 60, peakAge: 24, scoutBias: 0 },
    };
    const runs = Array.from({ length: 300 }, (_, i) => developPlayer(vet, { maps: 60, boost: 0 }, new Rng(`vet${i}`)).player);
    const mean = (f: (p: Player) => number) => runs.reduce((s, p) => s + f(p), 0) / runs.length;
    expect(mean((p) => p.attributes.gameSense - 97)).toBeLessThan(0.4);
    expect(mean((p) => p.attributes.comms - 97)).toBeLessThan(0.4);
    // 7 years past peak: the full 4-point decline still lands on overall.
    expect(mean((p) => exactOverall(p) - exactOverall(vet))).toBeCloseTo(-4, 0);
  });
});

describe("the hard age limit", () => {
  it("refuses extensions that cannot be played and caps signings", () => {
    let s = createLeague("age-limit");
    const uid = s.userTeamId!;
    s = withUserPlayers(s, (p, i) => (i === 0 ? { ...p, age: 33, contract: { salary: 100_000, years: 1 } } : i === 1 ? { ...p, age: 32, contract: { salary: 100_000, years: 1 } } : p));
    const [p33, p32] = user(s).players;
    expect(maxExtensionYears(s, p33)).toBe(0);
    expect(extendContract(s, uid, p33.id, { salary: 900_000, years: 1 }).ok).toBe(false);
    expect(maxExtensionYears(s, p32)).toBe(1);
    expect(extendContract(s, uid, p32.id, { salary: 900_000, years: 2 }).ok).toBe(false);
    expect(extendContract(s, uid, p32.id, { salary: 900_000, years: 1 }).ok).toBe(true);

    const fa = { ...s.freeAgents[0], age: 32 };
    const withFa = { ...s, freeAgents: [fa, ...s.freeAgents.slice(1)], teams: s.teams.map((t) => (t.id === uid ? { ...t, bench: [] } : t)) };
    expect(maxSigningYears(withFa, fa)).toBe(2);
    const three = signFreeAgent(withFa, uid, fa.id, { salary: 900_000, years: 3 });
    expect(!three.ok && three.reason).toMatch(/at most 2 seasons/);
  });
});

describe("retirement inputs", () => {
  it("does not treat a player released this season as having sat a whole season unsigned", () => {
    const s = playSeason(createLeague("released"));
    const p = user(s).players[3];
    const after = ok(releasePlayer(s, s.userTeamId!, p.id));
    const freed = after.freeAgents.find((x) => x.id === p.id)!;
    expect(freed.freedIn).toBe(s.year);
    expect(satWholeSeasonUnsigned(freed, s.year)).toBe(false);
    // An original free agent has been unsigned all along.
    expect(satWholeSeasonUnsigned(createLeague("released").freeAgents[0], 1)).toBe(true);
  });

  it("judges teenagers on their scouted outlook", () => {
    const base = generateLeague("teen")[0].players[0];
    const raw = { ...base, age: 19, attributes: { aim: 60, positioning: 60, gameSense: 60, consistency: 60, clutch: 60, comms: 60 } };
    const gem: Player = { ...raw, dev: { potential: 90, peakAge: 25, scoutBias: 0 } };
    const dud: Player = { ...raw, dev: { potential: 60, peakAge: 25, scoutBias: 0 } };
    expect(retirementChance(gem, true)).toBeLessThan(retirementChance(dud, true));
    expect(retirementChance(gem, true)).toBeLessThan(0.15);
  });
});

describe("AI budgets at rollover", () => {
  it("settle fans and pick next season's training before anything else", () => {
    const s: Season = { ...playSeason({ ...createLeague("rollover-budget"), userTeamId: null }) };
    const next = startNextSeason(s);
    for (const t of s.teams) {
      const settled = settleFans(s.finances[t.id]);
      expect(next.finances[t.id].fans).toBe(settled.fans);
      expect(next.finances[t.id].training).toBe(aiTrainingLevel(settled, true));
    }
  });
});

describe("academy", () => {
  it("brings back a released kid instead of a new roll", () => {
    let s = createLeague("academy-reroll");
    const uid = s.userTeamId!;
    s = { ...s, teams: s.teams.map((t) => (t.id === uid ? { ...t, players: t.players.slice(0, 3), bench: [] } : t)) };
    s = ok(callUpAcademyPlayer(s, uid));
    const kid = user(s).players[3];
    s = ok(releasePlayer(s, uid, kid.id));
    s = ok(callUpAcademyPlayer(s, uid));
    expect(user(s).players[3].id).toBe(kid.id);
    expect(user(s).players[3].attributes).toEqual(kid.attributes);
    expect(s.freeAgents.some((p) => p.id === kid.id)).toBe(false);
  });
});

describe("training on credit", () => {
  it("needs a season of the extra cost in the bank to raise the program", () => {
    const s = createLeague("credit");
    const uid = s.userTeamId!;
    const poor = { ...s, finances: { ...s.finances, [uid]: { ...s.finances[uid], balance: 1_000 } } };
    const r = setTrainingLevel(poor, uid, 4);
    expect(!r.ok && r.reason).toMatch(/needs/);
    const rich = { ...s, finances: { ...s.finances, [uid]: { ...s.finances[uid], balance: 2_000_000 } } };
    expect(setTrainingLevel(rich, uid, 4).ok).toBe(true);
  });
});

it("free agent asks still work with the new bookkeeping", () => {
  const s = createLeague("asks");
  expect(freeAgentAsk(s, s.userTeamId!, s.freeAgents[0], 1)).toBeGreaterThan(0);
});
