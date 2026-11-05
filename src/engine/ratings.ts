import type { AttributeKey, Mode, Player } from "./types";
import type { Rng } from "./rng";

/** Weights of each attribute in the overall rating. They sum to 1. */
export const OVERALL_WEIGHTS: Record<AttributeKey, number> = {
  aim: 0.28,
  positioning: 0.2,
  gameSense: 0.2,
  consistency: 0.12,
  clutch: 0.1,
  comms: 0.1,
};

/** Unrounded overall rating. */
export function exactOverall(p: Player): number {
  const a = p.attributes;
  return (
    a.aim * OVERALL_WEIGHTS.aim +
    a.positioning * OVERALL_WEIGHTS.positioning +
    a.gameSense * OVERALL_WEIGHTS.gameSense +
    a.consistency * OVERALL_WEIGHTS.consistency +
    a.clutch * OVERALL_WEIGHTS.clutch +
    a.comms * OVERALL_WEIGHTS.comms
  );
}

/** Weighted overall rating used for display and quick comparisons. */
export function overall(p: Player): number {
  return Math.round(exactOverall(p));
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
