/**
 * Control: first to 3 rounds (max 5). Each team has 30 lives per round.
 * Attackers must capture zone A then zone B before time runs out.
 * Sides alternate every round. Team 0 attacks first.
 */
import type { Rng } from "./rng";
import {
  alive,
  collectStats,
  createLiveTeam,
  EventLog,
  pickInitiator,
  resolveDuel,
  reviveAll,
  tag,
  type LiveTeam,
} from "./combat";
import type { GameMap, MapResult, Team, TeamIndex } from "./types";

export const CONTROL_RULES = {
  roundsToWin: 3,
  maxRounds: 5,
  lives: 30,
  roundSeconds: 90,
  /** Extra seconds added when zone A falls. */
  captureBonusSeconds: 30,
  /** Seconds of uncontested attacker presence needed to take a zone. */
  captureSeconds: 18,
  respawnSeconds: 5,
  /** Control is the bloodiest mode; lives need to matter. */
  engagementRate: 0.42,
};

export function simulateControl(rng: Rng, map: GameMap, teams: [Team, Team]): MapResult {
  const R = CONTROL_RULES;
  const live: [LiveTeam, LiveTeam] = [createLiveTeam(rng, teams[0], 0), createLiveTeam(rng, teams[1], 1)];
  const score: [number, number] = [0, 0];
  const log = new EventLog(score);
  let totalTime = 0;

  log.push({ t: 0, kind: "map_start", text: `Control on ${map.name} begins, ${tag(live[0])} attacking first` });

  for (let round = 1; round <= R.maxRounds; round++) {
    const attackerIdx: TeamIndex = round % 2 === 1 ? 0 : 1;
    const att = live[attackerIdx];
    const def = live[attackerIdx === 0 ? 1 : 0];
    reviveAll(att);
    reviveAll(def);
    log.push({ t: 0, kind: "round_start", round, text: `Round ${round}: ${tag(att)} attacking` });

    const end = playRound(rng, round, att, def, log);
    score[end.winner]++;
    log.setScore(score);
    totalTime += end.t;
    log.push({ t: end.t, kind: "round_end", round, team: end.winner, text: `${tag(live[end.winner])} win round ${round} by ${end.reason}` });

    if (score[end.winner] >= R.roundsToWin) break;
  }

  const winner: TeamIndex = score[0] > score[1] ? 0 : 1;
  log.push({ t: 0, kind: "map_end", team: winner, text: `${tag(live[winner])} win ${map.name} ${score[0]}-${score[1]}` });
  return { map, mode: "control", score, winner, events: log.events, stats: collectStats(live), durationSec: totalTime };
}

interface RoundEnd {
  winner: TeamIndex;
  reason: "capture" | "time" | "lives";
  t: number;
}

function playRound(rng: Rng, round: number, att: LiveTeam, def: LiveTeam, log: EventLog): RoundEnd {
  const R = CONTROL_RULES;
  const lives: Record<TeamIndex, number> = { 0: R.lives, 1: R.lives };
  let limit = R.roundSeconds;
  let zone = 0; // 0 = A, 1 = B
  let progress = 0;
  let attackersOnZone = false;

  for (let t = 0; ; t++) {
    if (t >= limit) return { winner: def.index, reason: "time", t };

    for (const team of [att, def]) {
      for (const p of team.players) {
        if (!p.alive && p.respawnAt <= t && lives[team.index] > 0) {
          p.alive = true;
          lives[team.index]--;
        }
      }
    }
    const attAlive = alive(att).length;
    const defAlive = alive(def).length;
    if (attAlive === 0 && lives[att.index] === 0) return { winner: def.index, reason: "lives", t };
    if (defAlive === 0 && lives[def.index] === 0) return { winner: att.index, reason: "lives", t };

    if (attAlive > 0 && defAlive > 0 && rng.chance(R.engagementRate)) {
      const initiator = pickInitiator(rng, att, def, 0.35);
      const duel = resolveDuel(rng, att, def, { mode: "control", initiator });
      duel.loser.respawnAt = t + R.respawnSeconds + rng.int(0, 2);
      log.kill(t, duel, round);
      const edge = alive(duel.winnerTeam).length - alive(duel.loserTeam).length;
      if (duel.winnerTeam === att) {
        if (!attackersOnZone && rng.chance(0.45 + edge * 0.12)) attackersOnZone = true;
      } else if (attackersOnZone && rng.chance(0.4 + edge * 0.12)) {
        attackersOnZone = false;
      }
    }

    if (attAlive === 0) attackersOnZone = false;
    if (attackersOnZone) {
      progress++;
      if (progress >= R.captureSeconds) {
        if (zone === 0) {
          zone = 1;
          progress = 0;
          attackersOnZone = false;
          limit += R.captureBonusSeconds;
          log.push({ t, kind: "capture", round, team: att.index, text: `${tag(att)} capture zone A, +${R.captureBonusSeconds}s` });
        } else {
          log.push({ t, kind: "capture", round, team: att.index, text: `${tag(att)} capture zone B` });
          return { winner: att.index, reason: "capture", t };
        }
      }
    } else if (progress > 0 && defAlive > 0) {
      progress = Math.max(0, progress - 1);
    }
  }
}
