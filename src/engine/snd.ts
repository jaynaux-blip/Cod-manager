/**
 * Search & Destroy: first to 6 rounds (max 11). 4v4, no respawns.
 * Sides swap after round 6. Team 0 attacks first.
 */
import type { Rng } from "./rng";
import {
  alive,
  avgAttribute,
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

export const SND_RULES = {
  roundsToWin: 6,
  maxRounds: 11,
  roundSeconds: 90,
  bombFuseSeconds: 45,
  /** Seconds between "beats" where something can happen. */
  beatMin: 6,
  beatMax: 14,
};

type RoundEnd =
  | { winner: TeamIndex; reason: "elimination" | "detonation" | "defuse" | "time" };

export function simulateSnd(rng: Rng, map: GameMap, teams: [Team, Team]): MapResult {
  const R = SND_RULES;
  const live: [LiveTeam, LiveTeam] = [createLiveTeam(rng, teams[0], 0), createLiveTeam(rng, teams[1], 1)];
  const score: [number, number] = [0, 0];
  const log = new EventLog(score);
  let totalTime = 0;

  log.push({ t: 0, kind: "map_start", text: `Search & Destroy on ${map.name} begins, ${tag(live[0])} on offense` });

  for (let round = 1; round <= R.maxRounds; round++) {
    const attackerIdx: TeamIndex = round <= 6 ? 0 : 1;
    const att = live[attackerIdx];
    const def = live[attackerIdx === 0 ? 1 : 0];
    reviveAll(att);
    reviveAll(def);
    log.push({ t: 0, kind: "round_start", round, text: `Round ${round}: ${tag(att)} attacking` });

    const end = playRound(rng, round, att, def, log);
    score[end.winner]++;
    log.setScore(score);
    totalTime += end.t;
    log.push({
      t: end.t,
      kind: "round_end",
      round,
      team: end.winner,
      text: `${tag(live[end.winner])} take round ${round} by ${end.reason}`,
    });

    if (score[end.winner] >= R.roundsToWin) break;
  }

  const winner: TeamIndex = score[0] > score[1] ? 0 : 1;
  log.push({ t: 0, kind: "map_end", team: winner, text: `${tag(live[winner])} win ${map.name} ${score[0]}-${score[1]}` });
  return { map, mode: "snd", score, winner, events: log.events, stats: collectStats(live), durationSec: totalTime };
}

function playRound(
  rng: Rng,
  round: number,
  att: LiveTeam,
  def: LiveTeam,
  log: EventLog,
): RoundEnd & { t: number } {
  const R = SND_RULES;
  let t = 0;
  let plantedAt: number | null = null;
  let lastAliveFightWon: { team: LiveTeam; player: string } | null = null;

  const finish = (winner: LiveTeam, reason: RoundEnd["reason"]) => {
    if (lastAliveFightWon && lastAliveFightWon.team === winner) {
      const p = winner.players.find((x) => x.player.name === lastAliveFightWon!.player)!;
      p.stats.clutches++;
      log.push({ t, kind: "clutch", round, team: winner.index, text: `${tag(winner)} ${p.player.name} clutches the round` });
    }
    return { winner: winner.index, reason, t };
  };

  for (;;) {
    t += rng.int(R.beatMin, R.beatMax);
    const attAlive = alive(att).length;
    const defAlive = alive(def).length;

    if (plantedAt !== null && t >= plantedAt + R.bombFuseSeconds) return finish(att, "detonation");
    if (plantedAt === null && t >= R.roundSeconds) return finish(def, "time");
    if (attAlive === 0) {
      if (plantedAt !== null) {
        const defuser = rng.pick(alive(def));
        defuser.stats.defuses++;
        log.push({ t, kind: "defuse", round, team: def.index, text: `${tag(def)} ${defuser.player.name} defuses the bomb` });
        return finish(def, "defuse");
      }
      return finish(def, "elimination");
    }
    if (defAlive === 0) return finish(att, plantedAt !== null ? "detonation" : "elimination");

    if (plantedAt === null && tryPlant(rng, t, att, def)) {
      plantedAt = t;
      const planter = rng.weighted(alive(att), (p) => p.player.attributes.gameSense);
      planter.stats.plants++;
      log.push({ t, kind: "plant", round, team: att.index, text: `${tag(att)} ${planter.player.name} plants the bomb` });
      continue;
    }

    if (plantedAt !== null && tryDefuse(rng, t, plantedAt, att, def)) {
      const defuser = rng.weighted(alive(def), (p) => p.player.attributes.clutch);
      defuser.stats.defuses++;
      log.push({ t, kind: "defuse", round, team: def.index, text: `${tag(def)} ${defuser.player.name} sneaks the defuse` });
      return finish(def, "defuse");
    }

    // After a plant the defenders are the ones forced to push.
    const initiator = plantedAt === null ? pickInitiator(rng, att, def, 0.15) : pickInitiator(rng, def, att, 0.35);
    const duel = resolveDuel(rng, att, def, { mode: "snd", initiator });
    log.kill(t, duel, round);
    lastAliveFightWon = duel.clutchFight ? { team: duel.winnerTeam, player: duel.winner.player.name } : null;

    const loserAlive = alive(duel.loserTeam).length;
    if (loserAlive === 1 && alive(duel.winnerTeam).length >= 2) {
      const last = alive(duel.loserTeam)[0];
      log.push({
        t,
        kind: "info",
        round,
        team: duel.loserTeam.index,
        text: `${tag(duel.loserTeam)} ${last.player.name} is alone in a 1v${alive(duel.winnerTeam).length}`,
      });
    }
  }
}

/** Attackers get the bomb down when they have map control or the clock forces it. */
function tryPlant(rng: Rng, t: number, att: LiveTeam, def: LiveTeam): boolean {
  const attAlive = alive(att).length;
  const defAlive = alive(def).length;
  const urgency = t < 30 ? 0.05 : t < 55 ? 0.2 : 0.45;
  const control = attAlive >= defAlive ? 1 + (attAlive - defAlive) * 0.3 : 0.5;
  const iq = 0.7 + avgAttribute(att, "gameSense") / 150;
  return rng.chance(Math.min(0.9, urgency * control * iq));
}

/** Defenders only go for the defuse when they have numbers or time is running out. */
function tryDefuse(rng: Rng, t: number, plantedAt: number, att: LiveTeam, def: LiveTeam): boolean {
  const attAlive = alive(att).length;
  const defAlive = alive(def).length;
  const timeLeft = plantedAt + SND_RULES.bombFuseSeconds - t;
  if (defAlive < attAlive && timeLeft > 15) return false;
  const base = defAlive > attAlive ? 0.3 : 0.12;
  const comms = 0.7 + avgAttribute(def, "comms") / 150;
  return rng.chance(base * comms);
}
