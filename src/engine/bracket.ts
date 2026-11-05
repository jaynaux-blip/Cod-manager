/**
 * Eight-team double-elimination bracket template (the CDL Major format).
 *
 * Each match names where its two teams come from: a seed, or the winner or
 * loser of an earlier match. Days group matches into match days.
 */
export type BracketSource =
  | { kind: "seed"; seed: number }
  | { kind: "winner"; match: string }
  | { kind: "loser"; match: string };

export interface BracketMatch {
  id: string;
  round: string;
  /** 0-based match day within the bracket. */
  day: number;
  home: BracketSource;
  away: BracketSource;
}

const seed = (n: number): BracketSource => ({ kind: "seed", seed: n });
const W = (match: string): BracketSource => ({ kind: "winner", match });
const L = (match: string): BracketSource => ({ kind: "loser", match });

export const DOUBLE_ELIM_8: BracketMatch[] = [
  { id: "WR1-1", round: "Winners Round 1", day: 0, home: seed(1), away: seed(8) },
  { id: "WR1-2", round: "Winners Round 1", day: 0, home: seed(4), away: seed(5) },
  { id: "WR1-3", round: "Winners Round 1", day: 0, home: seed(2), away: seed(7) },
  { id: "WR1-4", round: "Winners Round 1", day: 0, home: seed(3), away: seed(6) },
  { id: "WR2-1", round: "Winners Round 2", day: 1, home: W("WR1-1"), away: W("WR1-2") },
  { id: "WR2-2", round: "Winners Round 2", day: 1, home: W("WR1-3"), away: W("WR1-4") },
  { id: "LR1-1", round: "Losers Round 1", day: 1, home: L("WR1-1"), away: L("WR1-2") },
  { id: "LR1-2", round: "Losers Round 1", day: 1, home: L("WR1-3"), away: L("WR1-4") },
  { id: "WF", round: "Winners Final", day: 2, home: W("WR2-1"), away: W("WR2-2") },
  { id: "LR2-1", round: "Losers Round 2", day: 2, home: L("WR2-2"), away: W("LR1-1") },
  { id: "LR2-2", round: "Losers Round 2", day: 2, home: L("WR2-1"), away: W("LR1-2") },
  { id: "LR3", round: "Losers Round 3", day: 3, home: W("LR2-1"), away: W("LR2-2") },
  { id: "LF", round: "Losers Final", day: 3, home: L("WF"), away: W("LR3") },
  { id: "GF", round: "Grand Final", day: 3, home: W("WF"), away: W("LF") },
];

export const BRACKET_DAYS = 4;

/**
 * Final placement for each bracket slot once every match has a result.
 * Returns a map of match id + outcome to placement.
 */
export const BRACKET_PLACEMENTS: { match: string; outcome: "winner" | "loser"; place: number }[] = [
  { match: "GF", outcome: "winner", place: 1 },
  { match: "GF", outcome: "loser", place: 2 },
  { match: "LF", outcome: "loser", place: 3 },
  { match: "LR3", outcome: "loser", place: 4 },
  { match: "LR2-1", outcome: "loser", place: 5 },
  { match: "LR2-2", outcome: "loser", place: 5 },
  { match: "LR1-1", outcome: "loser", place: 7 },
  { match: "LR1-2", outcome: "loser", place: 7 },
];

/** Round-robin schedule for an even number of teams (circle method). */
export function roundRobin<T>(teams: readonly T[]): [T, T][][] {
  if (teams.length % 2 !== 0) throw new Error("roundRobin needs an even number of teams");
  const n = teams.length;
  const rotating = teams.slice(1);
  const rounds: [T, T][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const order = [teams[0], ...rotating];
    const round: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    rotating.unshift(rotating.pop()!);
  }
  return rounds;
}
