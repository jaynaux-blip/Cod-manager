/**
 * Balance harness: simulate many series between teams of different strengths
 * and print win rates and typical scorelines. Run with `npm run balance`.
 *
 *   npm run balance -- --n 500
 */
import { generateTeam, Rng, simulateMap, simulateSeries, mapsForMode, type Mode, type Team } from "../src/engine";

const args = process.argv.slice(2);
const N = Number(args[args.indexOf("--n") + 1] || 400);

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function teamsWithGap(seed: string, gap: number): [Team, Team] {
  const rng = new Rng(seed);
  const a = generateTeam(rng.fork("a"), "a", { tier: 78 + gap / 2, name: "Favourite", tag: "FAV", aggression: 50 });
  const b = generateTeam(rng.fork("b"), "b", { tier: 78 - gap / 2, name: "Underdog", tag: "DOG", aggression: 50 });
  return [a, b];
}

console.log(`Clutch balance report, ${N} series per row\n`);
console.log("Rating gap | Series win | HP win | SnD win | CTL win | Avg HP score | Avg SnD | Avg CTL | Avg maps | Avg kills/map");
console.log("-".repeat(118));

for (const gap of [0, 4, 8, 12, 16, 24]) {
  let seriesWins = 0;
  let totalMaps = 0;
  const modeWins: Record<Mode, number> = { hardpoint: 0, snd: 0, control: 0 };
  const modeCount: Record<Mode, number> = { hardpoint: 0, snd: 0, control: 0 };
  const scoreSum: Record<Mode, [number, number]> = { hardpoint: [0, 0], snd: [0, 0], control: [0, 0] };
  let kills = 0;

  for (let i = 0; i < N; i++) {
    const teams = teamsWithGap(`gap${gap}-${i}`, gap);
    const result = simulateSeries(teams, { seed: `series-${gap}-${i}` });
    if (result.winner === 0) seriesWins++;
    totalMaps += result.maps.length;
    for (const m of result.maps) {
      modeCount[m.mode]++;
      if (m.winner === 0) modeWins[m.mode]++;
      scoreSum[m.mode][0] += Math.max(m.score[0], m.score[1]);
      scoreSum[m.mode][1] += Math.min(m.score[0], m.score[1]);
      kills += Object.values(m.stats).reduce((s, p) => s + p.kills, 0);
    }
  }

  const avg = (mode: Mode) =>
    `${(scoreSum[mode][0] / modeCount[mode]).toFixed(0)}-${(scoreSum[mode][1] / modeCount[mode]).toFixed(0)}`;
  console.log(
    `${String(gap).padStart(10)} | ${pct(seriesWins / N).padStart(10)} | ${pct(modeWins.hardpoint / modeCount.hardpoint).padStart(6)} | ${pct(modeWins.snd / modeCount.snd).padStart(7)} | ${pct(modeWins.control / modeCount.control).padStart(7)} | ${avg("hardpoint").padStart(12)} | ${avg("snd").padStart(7)} | ${avg("control").padStart(7)} | ${(totalMaps / N).toFixed(2).padStart(8)} | ${(kills / totalMaps).toFixed(0).padStart(13)}`,
  );
}

// Side bias check: identical teams, who attacks first should not matter much.
console.log("\nSide bias (identical rosters, team 0 attacks first):");
for (const mode of ["snd", "control"] as Mode[]) {
  let wins0 = 0;
  let attackerRoundWins = 0;
  let rounds = 0;
  for (let i = 0; i < N; i++) {
    const rng = new Rng(`side-${mode}-${i}`);
    const a = generateTeam(rng.fork("a"), "a", { tier: 78, aggression: 50 });
    const b: Team = { ...a, id: "b", name: "Mirror", tag: "MIR", players: a.players.map((p) => ({ ...p, id: `b-${p.id}` })) };
    const map = rng.pick(mapsForMode(mode));
    const r = simulateMap(rng.fork("m"), mode, map, [a, b]);
    if (r.winner === 0) wins0++;
    for (const e of r.events) {
      if (e.kind !== "round_end" || e.round === undefined) continue;
      rounds++;
      const attacker = mode === "snd" ? (e.round <= 6 ? 0 : 1) : e.round % 2 === 1 ? 0 : 1;
      if (e.team === attacker) attackerRoundWins++;
    }
  }
  console.log(`  ${mode.padEnd(8)} team 0 map win ${pct(wins0 / N)}, attacker round win ${pct(attackerRoundWins / rounds)}`);
}

// Round-end reasons for SnD and Control.
console.log("\nRound end reasons (identical rosters):");
for (const mode of ["snd", "control"] as Mode[]) {
  const reasons: Record<string, number> = {};
  let total = 0;
  for (let i = 0; i < N; i++) {
    const rng = new Rng(`reason-${mode}-${i}`);
    const a = generateTeam(rng.fork("a"), "a", { tier: 78 });
    const b = generateTeam(rng.fork("b"), "b", { tier: 78 });
    const r = simulateMap(rng.fork("m"), mode, rng.pick(mapsForMode(mode)), [a, b]);
    for (const e of r.events) {
      if (e.kind !== "round_end") continue;
      const reason = e.text.split(" by ").pop()!;
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      total++;
    }
  }
  console.log(`  ${mode.padEnd(8)} ${Object.entries(reasons).map(([k, v]) => `${k} ${pct(v / total)}`).join(", ")}`);
}

// Hardpoint duration.
{
  let dur = 0;
  for (let i = 0; i < N; i++) {
    const rng = new Rng(`dur-${i}`);
    const a = generateTeam(rng.fork("a"), "a", { tier: 78 });
    const b = generateTeam(rng.fork("b"), "b", { tier: 78 });
    dur += simulateMap(rng.fork("m"), "hardpoint", mapsForMode("hardpoint")[0], [a, b]).durationSec;
  }
  console.log(`\nAverage Hardpoint duration: ${(dur / N / 60).toFixed(1)} minutes`);
}
