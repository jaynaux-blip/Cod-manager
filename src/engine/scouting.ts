/**
 * Hidden potential and what scouts can see of it.
 *
 * Every generated player gets a hidden development profile: a ceiling, the age
 * decline starts, and a fixed scouting error. The manager and the AI only ever
 * use the scouted range, so they work from the same information.
 */
import { exactOverall, overall } from "./ratings";
import { clamp, hashString, Rng } from "./rng";
import type { Development, Player } from "./types";

export const SCOUTING_RULES = {
  maxPotential: 95,
  /** Expected headroom per year under 24: an 18-year-old has about 13 points to grow. */
  headroomPerYear: 2.2,
  headroomSd: 4,
  peakAgeMean: 24,
  peakAgeSd: 1.5,
  peakAgeMin: 22,
  peakAgeMax: 28,
  /** Players are never generated already more than this many years past their peak. */
  maxYearsPastPeakAtCreation: 3,
  /** Range width in overall points per year under 25. Gone at 25. */
  rangeWidthPerYear: 2,
  maxRangeWidth: 14,
  /** Scouts project a realistic peak, slightly under the true ceiling. */
  projectionDiscount: 1.5,
  /** How far scouting error moves the range, as a share of its width. */
  biasShare: 0.35,
};

export function rollDevelopment(p: Player, rng: Rng): Development {
  const R = SCOUTING_RULES;
  const ex = exactOverall(p);
  const headroom = Math.max(0, R.headroomPerYear * (24 - p.age) + rng.gaussian(0, R.headroomSd));
  const potential = Math.round(Math.min(R.maxPotential, Math.max(ex, ex + headroom)));
  const peak = Math.round(clamp(rng.gaussian(R.peakAgeMean, R.peakAgeSd), R.peakAgeMin, R.peakAgeMax));
  return {
    potential,
    peakAge: Math.max(peak, p.age - R.maxYearsPastPeakAtCreation),
    scoutBias: clamp(rng.gaussian(0, 1), -2, 2),
  };
}

/**
 * Attach a development profile. Uses a fork of `rng`, which does not advance
 * it, so adding development never changes anything else a seed generates.
 * Call after the player's final age is set.
 */
export function withDevelopment(p: Player, rng: Rng): Player {
  return { ...p, dev: rollDevelopment(p, rng.fork(`dev:${p.id}`)) };
}

/** A player's development profile, derived deterministically for hand-built players. */
export function devOf(p: Player): Development {
  return p.dev ?? rollDevelopment(p, new Rng(hashString(`dev:${p.id}`)));
}

/**
 * The scouted ceiling range, or null once a player is established (25+).
 * It narrows with age and is shifted by the player's fixed scouting error, so
 * some prospects are overhyped and some are hidden gems.
 */
export function potentialRange(p: Player): [number, number] | null {
  const R = SCOUTING_RULES;
  const width = clamp(R.rangeWidthPerYear * (25 - p.age), 0, R.maxRangeWidth);
  if (width <= 0) return null;
  const dev = devOf(p);
  const centre = dev.potential - R.projectionDiscount + dev.scoutBias * R.biasShare * width;
  const ovr = overall(p);
  const hi = Math.min(99, Math.max(ovr, Math.round(centre + width / 2)));
  const lo = Math.min(hi, Math.max(ovr, Math.round(centre - width / 2)));
  return [lo, hi];
}

/** Visible upside: how far the middle of the scouted range sits above current overall. */
export function visibleUpside(p: Player): number {
  const range = potentialRange(p);
  return range ? Math.max(0, (range[0] + range[1]) / 2 - overall(p)) : 0;
}

/** Rating used for pricing: current overall plus a share of visible upside. */
export const valuationOverall = (p: Player): number => overall(p) + 0.3 * visibleUpside(p);

/** Rating used to rank prospects and veterans together: values upside more heavily. */
export const outlook = (p: Player): number => overall(p) + 0.5 * visibleUpside(p);
