/**
 * Shared runtime state and gunfight resolution used by every mode.
 */
import { clamp, type Rng } from "./rng";
import { combatRating, duelProbability, rollForm, TEAM_FORM_SD } from "./ratings";
import {
  emptyStats,
  type MatchEvent,
  type Mode,
  type Player,
  type PlayerStats,
  type Team,
  type TeamIndex,
} from "./types";

export interface LivePlayer {
  player: Player;
  /** Per-map form roll, added to combat rating. */
  form: number;
  alive: boolean;
  /** Game-time second at which the player respawns (respawn modes only). */
  respawnAt: number;
  stats: PlayerStats;
}

export interface LiveTeam {
  index: TeamIndex;
  team: Team;
  players: LivePlayer[];
}

export function createLiveTeam(rng: Rng, team: Team, index: TeamIndex): LiveTeam {
  if (team.players.length !== 4) {
    throw new Error(`Team ${team.name} must field exactly 4 players`);
  }
  const teamForm = rng.gaussian(0, TEAM_FORM_SD);
  return {
    index,
    team,
    players: team.players.map((player) => ({
      player,
      form: teamForm + rollForm(rng, player),
      alive: true,
      respawnAt: 0,
      stats: emptyStats(),
    })),
  };
}

export const alive = (t: LiveTeam): LivePlayer[] => t.players.filter((p) => p.alive);

export function reviveAll(t: LiveTeam): void {
  for (const p of t.players) {
    p.alive = true;
    p.respawnAt = 0;
  }
}

/** Respawn anyone whose timer has elapsed. */
export function processRespawns(t: LiveTeam, now: number): void {
  for (const p of t.players) {
    if (!p.alive && p.respawnAt <= now) p.alive = true;
  }
}

export function avgAttribute(t: LiveTeam, key: keyof Player["attributes"]): number {
  return t.players.reduce((s, p) => s + p.player.attributes[key], 0) / t.players.length;
}

/**
 * How likely a player is to be the one in the next gunfight. SMGs and
 * aggressive setups hunt fights; anchors see fewer of them.
 */
export function pickFighter(rng: Rng, t: LiveTeam): LivePlayer {
  const aggression = t.team.tactics.aggression;
  return rng.weighted(alive(t), (p) => {
    const roleWeight = p.player.role === "SMG" ? 1.5 : p.player.role === "Flex" ? 1.2 : 1.0;
    return roleWeight * (0.6 + aggression / 100) * (0.5 + p.player.attributes.aim / 100);
  });
}

export interface DuelContext {
  mode: Mode;
  /** Team that pushed into the fight. */
  initiator: TeamIndex;
}

export interface DuelResult {
  winner: LivePlayer;
  loser: LivePlayer;
  winnerTeam: LiveTeam;
  loserTeam: LiveTeam;
  /** Winner was the last player standing against two or more. */
  clutchFight: boolean;
}

/**
 * Resolve one gunfight between a fighter from each team.
 *
 * Modifiers, in rating points (14 points is ~73/27):
 *  - numbers: +4 per extra teammate alive (trades, crossfires)
 *  - comms:   up to +/-3 from team average comms
 *  - push:    the initiator takes -2, offset by their aggression; the holder
 *             gains from positioning
 *  - clutch:  a lone survivor vs 2+ gains or loses up to 6 from clutch factor
 */
export function resolveDuel(
  rng: Rng,
  a: LiveTeam,
  b: LiveTeam,
  ctx: DuelContext,
): DuelResult {
  const fa = pickFighter(rng, a);
  const fb = pickFighter(rng, b);
  const ra = situationalRating(fa, a, b, ctx);
  const rb = situationalRating(fb, b, a, ctx);
  const aWins = rng.chance(duelProbability(ra, rb));
  const [winner, loser, winnerTeam, loserTeam] = aWins ? [fa, fb, a, b] : [fb, fa, b, a];
  const clutchFight = alive(winnerTeam).length === 1 && alive(loserTeam).length >= 2;

  loser.alive = false;
  loser.stats.deaths++;
  winner.stats.kills++;

  return { winner, loser, winnerTeam, loserTeam, clutchFight };
}

function situationalRating(
  p: LivePlayer,
  own: LiveTeam,
  opp: LiveTeam,
  ctx: DuelContext,
): number {
  let r = combatRating(p.player, p.form, ctx.mode);
  const ownAlive = alive(own).length;
  const oppAlive = alive(opp).length;

  r += clamp(ownAlive - oppAlive, -3, 3) * 4;
  r += ((avgAttribute(own, "comms") - 50) / 50) * 3;

  if (ctx.initiator === own.index) {
    r += -2 + ((own.team.tactics.aggression - 50) / 50) * 2;
  } else {
    r += ((p.player.attributes.positioning - 50) / 50) * 3;
  }

  if (ownAlive === 1 && oppAlive >= 2) {
    r += ((p.player.attributes.clutch - 50) / 50) * 6;
  }
  return r;
}

/** Decide which team pushes into the next engagement. */
export function pickInitiator(rng: Rng, a: LiveTeam, b: LiveTeam, bias = 0): TeamIndex {
  const wa = 20 + a.team.tactics.aggression + bias * 100;
  const wb = 20 + b.team.tactics.aggression;
  return rng.chance(wa / (wa + wb)) ? a.index : b.index;
}

/** Append-only event log with a running score. */
export class EventLog {
  readonly events: MatchEvent[] = [];
  constructor(private score: [number, number]) {}

  setScore(score: [number, number]): void {
    this.score = score;
  }

  push(e: Omit<MatchEvent, "score">): void {
    this.events.push({ ...e, score: [this.score[0], this.score[1]] });
  }

  kill(t: number, d: DuelResult, round?: number): void {
    const suffix = d.clutchFight ? " in a clutch fight" : "";
    this.push({
      t,
      kind: "kill",
      team: d.winnerTeam.index,
      round,
      text: `${tag(d.winnerTeam)} ${d.winner.player.name} kills ${d.loser.player.name}${suffix}`,
    });
  }
}

export const tag = (t: LiveTeam): string => `[${t.team.tag}]`;

export function collectStats(teams: LiveTeam[]): Record<string, PlayerStats> {
  const out: Record<string, PlayerStats> = {};
  for (const t of teams) for (const p of t.players) out[p.player.id] = { ...p.stats };
  return out;
}
