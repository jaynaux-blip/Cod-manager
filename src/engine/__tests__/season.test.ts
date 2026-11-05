import { describe, expect, it } from "vitest";
import {
  createSeason,
  generateLeague,
  groupStandings,
  isFinished,
  playNextDay,
  playSeason,
  playStage,
  roundRobin,
  seasonStandings,
  SEASON_RULES,
} from "..";

const league = () => generateLeague("test-league", 12);

describe("roundRobin", () => {
  it("has every pair exactly once and no team twice in a round", () => {
    const teams = [0, 1, 2, 3, 4, 5];
    const rounds = roundRobin(teams);
    expect(rounds).toHaveLength(5);
    const seen = new Set<string>();
    for (const round of rounds) {
      const inRound = new Set<number>();
      for (const [a, b] of round) {
        expect(inRound.has(a)).toBe(false);
        expect(inRound.has(b)).toBe(false);
        inRound.add(a);
        inRound.add(b);
        seen.add([a, b].sort().join("-"));
      }
    }
    expect(seen.size).toBe(15);
  });
});

describe("Season", () => {
  it("builds the full calendar up front", () => {
    const s = createSeason("s", league());
    expect(s.stages).toHaveLength(5);
    // 4 Majors x (5 qualifier weeks + 4 bracket days) + 4 Champs days
    expect(s.days).toHaveLength(4 * 9 + 4);
    // 4 Majors x (30 qualifier matches + 14 bracket) + 14 Champs
    expect(s.fixtures).toHaveLength(4 * 44 + 14);
    expect(s.currentDay).toBe(0);
  });

  it("does not mutate the previous season state", () => {
    const s0 = createSeason("s", league());
    const s1 = playNextDay(s0);
    expect(s0.currentDay).toBe(0);
    expect(s0.fixtures.every((f) => !f.result)).toBe(true);
    expect(s1.currentDay).toBe(1);
    expect(s1.fixtures.filter((f) => f.result)).toHaveLength(6);
  });

  it("draws two groups of six for Major I", () => {
    const s = playNextDay(createSeason("s", league()));
    const groups = s.stages[0].groups!;
    expect(groups[0]).toHaveLength(6);
    expect(groups[1]).toHaveLength(6);
    expect(new Set([...groups[0], ...groups[1]]).size).toBe(12);
  });

  it("plays a whole Major with placements and points", () => {
    const s = playStage(createSeason("s", league()));
    expect(s.currentDay).toBe(9);
    const stage = s.stages[0];
    expect(stage.seeds).toHaveLength(8);
    const placements = Object.values(stage.placements!).sort((a, b) => a - b);
    expect(placements).toEqual([1, 2, 3, 4, 5, 5, 7, 7, 9, 9, 11, 11]);
    const winner = Object.entries(stage.placements!).find(([, p]) => p === 1)![0];
    const winnerWins = groupStandings(s, 0, 0).concat(groupStandings(s, 0, 1)).find((r) => r.teamId === winner)!.wins;
    expect(s.points[winner]).toBe(SEASON_RULES.placementPoints[1] + winnerWins * SEASON_RULES.pointsPerQualifierWin);
    // Bracket seeds are the top four of each group.
    const top = [...groupStandings(s, 0, 0).slice(0, 4), ...groupStandings(s, 0, 1).slice(0, 4)].map((r) => r.teamId);
    expect(new Set(stage.seeds)).toEqual(new Set(top));
  });

  it("snake-seeds later Majors by season points", () => {
    let s = playStage(createSeason("s", league()));
    const order = seasonStandings(s).map((r) => r.teamId);
    s = playNextDay(s);
    const groups = s.stages[1].groups!;
    expect(groups[0]).toEqual([order[0], order[3], order[4], order[7], order[8], order[11]]);
    expect(groups[1]).toEqual([order[1], order[2], order[5], order[6], order[9], order[10]]);
  });

  it("finishes with a champion and every fixture played", () => {
    const s = playSeason(createSeason("s", league()));
    expect(isFinished(s)).toBe(true);
    expect(s.fixtures.every((f) => f.result && f.homeId && f.awayId)).toBe(true);
    expect(s.champion).toBeDefined();
    const champs = s.stages[4];
    expect(new Set(champs.seeds).size).toBe(8);
    const minSeededPoints = Math.min(...champs.seeds!.map((id) => s.points[id]));
    for (const t of s.teams) if (!champs.seeds!.includes(t.id)) expect(s.points[t.id]).toBeLessThanOrEqual(minSeededPoints);
    expect(Object.keys(champs.placements!)).toHaveLength(8);
    const table = seasonStandings(s);
    expect(table[0].points).toBeGreaterThanOrEqual(table[11].points);
    expect(table.every((r) => r.placements.length === 4 && r.placements.every((p) => p !== null))).toBe(true);
  });

  it("is deterministic for a seed", () => {
    const a = playSeason(createSeason("det", league()));
    const b = playSeason(createSeason("det", league()));
    expect(a.points).toEqual(b.points);
    expect(a.champion).toBe(b.champion);
  });

  it("bracket matches never pair a team with itself", () => {
    const s = playSeason(createSeason("s", league()));
    for (const f of s.fixtures) expect(f.homeId).not.toBe(f.awayId);
  });
});
