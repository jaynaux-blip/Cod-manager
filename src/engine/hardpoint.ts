/**
 * Hardpoint: first to 250. One point per second of uncontested hill control.
 * Hills rotate every 60 seconds through five positions.
 */
import type { Rng } from "./rng";
import {
  alive,
  collectStats,
  createLiveTeam,
  EventLog,
  pickInitiator,
  processRespawns,
  resolveDuel,
  tag,
  avgAttribute,
  type LiveTeam,
} from "./combat";
import type { GameMap, MapResult, Team, TeamIndex } from "./types";

export const HARDPOINT_RULES = {
  pointsToWin: 250,
  hillSeconds: 60,
  hillCount: 5,
  respawnSeconds: 5,
  /** Chance per second that a gunfight happens while both teams have players up. */
  engagementRate: 0.3,
  /** Safety cap so a pathological sim never loops forever. */
  maxSeconds: 1200,
};

export function simulateHardpoint(rng: Rng, map: GameMap, teams: [Team, Team]): MapResult {
  const R = HARDPOINT_RULES;
  const live: [LiveTeam, LiveTeam] = [createLiveTeam(rng, teams[0], 0), createLiveTeam(rng, teams[1], 1)];
  const score: [number, number] = [0, 0];
  const log = new EventLog(score);
  let holder: TeamIndex | null = null;
  let hill = 0;

  log.push({ t: 0, kind: "map_start", text: `Hardpoint on ${map.name} begins at P1` });

  let t = 0;
  for (; t < R.maxSeconds; t++) {
    if (t > 0 && t % R.hillSeconds === 0) {
      hill = (hill + 1) % R.hillCount;
      holder = contestRotation(rng, live);
      const who = holder === null ? "contested" : `${tag(live[holder])} rotate first`;
      log.push({ t, kind: "rotation", team: holder ?? undefined, text: `Hill rotates to P${hill + 1}, ${who}` });
    }

    for (const team of live) processRespawns(team, t);
    const aliveCounts = [alive(live[0]).length, alive(live[1]).length];

    if (aliveCounts[0] > 0 && aliveCounts[1] > 0 && rng.chance(R.engagementRate)) {
      const initiator = pickInitiator(rng, live[0], live[1]);
      const duel = resolveDuel(rng, live[0], live[1], { mode: "hardpoint", initiator });
      duel.loser.respawnAt = t + R.respawnSeconds + rng.int(0, 2);
      log.kill(t, duel);
      holder = updateHolder(rng, holder, duel.winnerTeam, duel.loserTeam, log, t);
    }

    if (holder !== null && alive(live[holder]).length === 0) holder = null;
    if (holder !== null) {
      score[holder]++;
      log.setScore(score);
      if (score[holder] >= R.pointsToWin) break;
    }
  }

  const winner: TeamIndex = score[0] >= score[1] ? 0 : 1;
  log.push({
    t,
    kind: "map_end",
    team: winner,
    text: `${tag(live[winner])} win ${map.name} ${score[0]}-${score[1]}`,
  });

  return { map, mode: "hardpoint", score, winner, events: log.events, stats: collectStats(live), durationSec: t };
}

/** Who reaches the new hill first depends on rotation IQ and comms. */
function contestRotation(rng: Rng, live: [LiveTeam, LiveTeam]): TeamIndex | null {
  const rot = (team: LiveTeam) =>
    avgAttribute(team, "gameSense") * 0.6 +
    avgAttribute(team, "comms") * 0.4 +
    (team.team.tactics.aggression - 50) * 0.1 +
    alive(team).length * 3;
  const diff = rot(live[0]) - rot(live[1]);
  const p0 = 1 / (1 + Math.exp(-diff / 10));
  const first: TeamIndex = rng.chance(p0) ? 0 : 1;
  return rng.chance(0.8) ? first : null;
}

/** After a kill, decide whether the hill changes hands. */
function updateHolder(
  rng: Rng,
  holder: TeamIndex | null,
  winnerTeam: LiveTeam,
  loserTeam: LiveTeam,
  log: EventLog,
  t: number,
): TeamIndex | null {
  const edge = alive(winnerTeam).length - alive(loserTeam).length;
  if (holder === loserTeam.index) {
    const breakChance = 0.3 + edge * 0.15;
    if (rng.chance(breakChance)) {
      log.push({ t, kind: "break", team: winnerTeam.index, text: `${tag(winnerTeam)} break the hill` });
      return winnerTeam.index;
    }
    return holder;
  }
  if (holder === null && rng.chance(0.55 + edge * 0.1)) return winnerTeam.index;
  return holder;
}
