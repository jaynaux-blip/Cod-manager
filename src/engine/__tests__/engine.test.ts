import { describe, expect, it } from "vitest";
import {
  CONTROL_RULES,
  generateLeague,
  generateTeam,
  HARDPOINT_RULES,
  hashString,
  mapsForMode,
  Rng,
  simulateControl,
  simulateHardpoint,
  simulateSeries,
  simulateSnd,
  SND_RULES,
  type Team,
} from "..";

const pair = (seed: string, tierA = 78, tierB = 78): [Team, Team] => {
  const rng = new Rng(seed);
  return [
    generateTeam(rng.fork("a"), "a", { tier: tierA }),
    generateTeam(rng.fork("b"), "b", { tier: tierB }),
  ];
};

describe("Rng", () => {
  it("is deterministic for a given seed", () => {
    const a = new Rng("clutch");
    const b = new Rng("clutch");
    expect(Array.from({ length: 10 }, () => a.next())).toEqual(Array.from({ length: 10 }, () => b.next()));
  });

  it("produces different streams for different seeds", () => {
    expect(new Rng("a").next()).not.toBe(new Rng("b").next());
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("stays within [0, 1) and int bounds", () => {
    const rng = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});

describe("generation", () => {
  it("builds 4-player rosters with attributes in range", () => {
    for (const team of generateLeague("league", 12)) {
      expect(team.players).toHaveLength(4);
      for (const p of team.players) {
        for (const v of Object.values(p.attributes)) {
          expect(v).toBeGreaterThanOrEqual(20);
          expect(v).toBeLessThanOrEqual(99);
        }
      }
    }
  });
});

describe("Hardpoint", () => {
  it("ends when a team reaches 250 and never exceeds it", () => {
    const r = simulateHardpoint(new Rng("hp"), mapsForMode("hardpoint")[0], pair("hp"));
    expect(Math.max(...r.score)).toBe(HARDPOINT_RULES.pointsToWin);
    expect(r.score[r.winner]).toBe(HARDPOINT_RULES.pointsToWin);
    expect(r.durationSec).toBeLessThan(HARDPOINT_RULES.maxSeconds);
  });

  it("records kills and deaths symmetrically", () => {
    const r = simulateHardpoint(new Rng("hp2"), mapsForMode("hardpoint")[0], pair("hp2"));
    const stats = Object.values(r.stats);
    const kills = stats.reduce((s, p) => s + p.kills, 0);
    const deaths = stats.reduce((s, p) => s + p.deaths, 0);
    expect(kills).toBe(deaths);
    expect(kills).toBeGreaterThan(40);
  });
});

describe("Search & Destroy", () => {
  it("is won by the first team to 6 rounds", () => {
    for (let i = 0; i < 20; i++) {
      const r = simulateSnd(new Rng(`snd${i}`), mapsForMode("snd")[0], pair(`snd${i}`));
      expect(r.score[r.winner]).toBe(SND_RULES.roundsToWin);
      expect(r.score[1 - r.winner]).toBeLessThan(SND_RULES.roundsToWin);
      expect(r.score[0] + r.score[1]).toBeLessThanOrEqual(SND_RULES.maxRounds);
    }
  });

  it("logs a plant before every detonation", () => {
    const r = simulateSnd(new Rng("plant"), mapsForMode("snd")[0], pair("plant"));
    const rounds = new Set(r.events.filter((e) => e.kind === "round_end" && e.text.endsWith("detonation")).map((e) => e.round));
    for (const round of rounds) {
      expect(r.events.some((e) => e.kind === "plant" && e.round === round)).toBe(true);
    }
  });
});

describe("Control", () => {
  it("is won by the first team to 3 rounds", () => {
    for (let i = 0; i < 20; i++) {
      const r = simulateControl(new Rng(`ctl${i}`), mapsForMode("control")[0], pair(`ctl${i}`));
      expect(r.score[r.winner]).toBe(CONTROL_RULES.roundsToWin);
      expect(r.score[0] + r.score[1]).toBeLessThanOrEqual(CONTROL_RULES.maxRounds);
    }
  });
});

describe("Series", () => {
  it("replays identically from the same seed", () => {
    const teams = pair("replay");
    const a = simulateSeries(teams, { seed: "same" });
    const b = simulateSeries(teams, { seed: "same" });
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    const teams = pair("replay");
    const a = simulateSeries(teams, { seed: "one" });
    const b = simulateSeries(teams, { seed: "two" });
    expect(a.maps.map((m) => m.events.length)).not.toEqual(b.maps.map((m) => m.events.length));
  });

  it("follows the HP / SnD / Control / HP / SnD format and stops at 3 map wins", () => {
    const r = simulateSeries(pair("fmt"), { seed: "fmt" });
    expect(r.mapScore[r.winner]).toBe(3);
    expect(r.maps.length).toBeGreaterThanOrEqual(3);
    expect(r.maps.length).toBeLessThanOrEqual(5);
    expect(r.maps.map((m) => m.mode)).toEqual(["hardpoint", "snd", "control", "hardpoint", "snd"].slice(0, r.maps.length));
  });

  it("lets the clearly better team win most of the time", () => {
    let wins = 0;
    const n = 150;
    for (let i = 0; i < n; i++) {
      const r = simulateSeries(pair(`gap${i}`, 86, 70), { seed: `gap${i}` });
      if (r.winner === 0) wins++;
    }
    expect(wins / n).toBeGreaterThan(0.8);
  });

  it("gives identical rosters a roughly even split", () => {
    let wins = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const r = simulateSeries(pair(`even${i}`), { seed: `even${i}` });
      if (r.winner === 0) wins++;
    }
    expect(wins / n).toBeGreaterThan(0.4);
    expect(wins / n).toBeLessThan(0.6);
  });
});
