import type { Mode, Player } from "./types";
import type { Rng } from "./rng";

/** Weighted overall rating used for display and quick comparisons. */
export function overall(p: Player): number {
  const a = p.attributes;
  return Math.round(
    a.aim * 0.28 +
      a.positioning * 0.2 +
      a.gameSense * 0.2 +
      a.consistency * 0.12 +
      a.clutch * 0.1 +
      a.comms * 0.1,
  );
}

/**
 * Roll a player's form for one map. Low consistency means big swings either
 * way; a 90-consistency player barely moves off their baseline.
 */
export function rollForm(rng: Rng, p: Player): number {
  const sd = 2 + (100 - p.attributes.consistency) * 0.1;
  return rng.gaussian(0, sd);
}

/** Small per-mode skew so rosters built for one mode feel different. */
export function modeBonus(mode: Mode, p: Player): number {
  const a = p.attributes;
  switch (mode) {
    case "hardpoint":
      return (a.aim - 50) * 0.06 + (a.positioning - 50) * 0.04;
    case "snd":
      return (a.gameSense - 50) * 0.08 + (a.clutch - 50) * 0.03;
    case "control":
      return (a.comms - 50) * 0.06 + (a.positioning - 50) * 0.05;
  }
}

/** Raw gunfight rating before situational modifiers. */
export function combatRating(p: Player, form: number, mode: Mode): number {
  const a = p.attributes;
  return (
    a.aim * 0.5 +
    a.positioning * 0.3 +
    a.gameSense * 0.2 +
    form +
    modeBonus(mode, p)
  );
}

/**
 * Probability that a player with rating `a` beats a player with rating `b`
 * in a single gunfight. A 30-point edge is roughly a 73/27 fight.
 *
 * Gunfights compound over 80+ kills a map, so the per-fight edge has to be
 * small for a 5-point roster gap to still produce upsets.
 */
export const DUEL_SCALE = 30;

export function duelProbability(a: number, b: number): number {
  return 1 / (1 + Math.exp(-(a - b) / DUEL_SCALE));
}

/**
 * Whole-team form for one map: the "they just showed up today" factor that
 * is correlated across a roster, unlike individual form.
 */
export const TEAM_FORM_SD = 5;
