/**
 * Economy and development harness: run AI-only leagues for several seasons
 * and report money flows, player development and careers.
 *
 *   npm run economy -- --leagues 8 --seasons 6
 *   npm run economy -- --no-training      AI clubs never fund training
 */
import {
  AI_TRAINING_POLICY,
  CONTRACT_RULES,
  createLeague,
  developPlayer,
  EXPENSE_KINDS,
  INCOME_KINDS,
  LEDGER_LABEL,
  lineupRating,
  money,
  overall,
  payroll,
  playSeason,
  Rng,
  rosterOf,
  seasonStandings,
  startNextSeason,
  summarize,
  TRAINING_LEVELS,
  trainingBoost,
  type LedgerKind,
  type Season,
} from "../src/engine";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const LEAGUES = arg("leagues", 8);
const SEASONS = arg("seasons", 6);
if (args.includes("--no-training")) AI_TRAINING_POLICY.reserve = Infinity;

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pctl = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
const pct = (n: number, d: number) => `${((n / Math.max(1, d)) * 100).toFixed(0)}%`;

const kinds = [...INCOME_KINDS, ...EXPENSE_KINDS];
const byRank = Array.from({ length: 12 }, () => ({
  kinds: Object.fromEntries(kinds.map((k) => [k, 0])) as Record<LedgerKind, number>,
  net: 0,
  n: 0,
}));
const perSeason = Array.from({ length: SEASONS }, () => ({
  starterOvr: [] as number[],
  starterAge: [] as number[],
  top10: [] as number[],
  best: [] as number[],
  stars: [] as number[],
  spread: [] as number[],
  weakest: [] as number[],
  richest: [] as number[],
  inDebt: 0,
  clubs: 0,
  training: [0, 0, 0, 0, 0],
}));
const retireAges: number[] = [];
let retirements = 0;
let forced = 0;
let rookieClasses = 0;
let rookiesSignedWithin2 = 0;
let rookiesTracked = 0;
const championTraining: number[] = [];
const payrolls: number[] = [];
let callUps = 0;

const t0 = Date.now();
for (let l = 0; l < LEAGUES; l++) {
  let season: Season = { ...createLeague(`economy-${l}`), userTeamId: null };
  const rookieYear = new Map<string, number>();
  for (let y = 0; y < SEASONS; y++) {
    if (y > 0) {
      season = startNextSeason(season);
      const rep = season.development!;
      retirements += rep.retired.length;
      forced += rep.retired.filter((r) => r.forced).length;
      retireAges.push(...rep.retired.map((r) => r.age));
      for (const id of rep.rookies) rookieYear.set(id, season.year);
      rookieClasses++;
    }
    season = playSeason(season);
    const stats = perSeason[y];
    // Ratings are read before development runs at the end of the season.
    const starters = season.fixtures
      .filter((f) => f.result && f.day === 0)
      .flatMap((f) => f.result!.teams.flatMap((t) => t.players));
    stats.starterOvr.push(avg(starters.map(overall)));
    stats.starterAge.push(avg(starters.map((p) => p.age)));
    const sorted = starters.map(overall).sort((a, b) => b - a);
    stats.top10.push(avg(sorted.slice(0, 10)));
    stats.best.push(sorted[0]);
    stats.stars.push(sorted.filter((o) => o >= 88).length);
    const lineups = season.fixtures
      .filter((f) => f.result && f.day === 0)
      .flatMap((f) => f.result!.teams.map((t) => lineupRating(t)));
    stats.spread.push(Math.max(...lineups) - Math.min(...lineups));
    stats.weakest.push(Math.min(...lineups));
    const balances = season.teams.map((t) => season.finances[t.id].balance);
    stats.richest.push(Math.max(...balances));
    stats.inDebt += balances.filter((b) => b < 0).length;
    stats.clubs += balances.length;
    for (const t of season.teams) stats.training[season.finances[t.id].training]++;
    championTraining.push(season.finances[season.champion!].training);

    seasonStandings(season).forEach((row, rank) => {
      const s = summarize(season.finances[row.teamId], season.year);
      for (const k of kinds) byRank[rank].kinds[k] += s.byKind[k];
      byRank[rank].net += s.net;
      byRank[rank].n++;
    });
    for (const t of season.teams) {
      payrolls.push(payroll(t));
      callUps += rosterOf(t).filter((p) => p.id.startsWith("cu-")).length;
    }
    // Rookies from two seasons ago: were they ever signed?
    const rostered = new Set(season.teams.flatMap(rosterOf).map((p) => p.id));
    for (const [id, yr] of rookieYear) {
      if (season.year === yr + 1) {
        rookiesTracked++;
        if (rostered.has(id) || season.fixtures.some((f) => f.result?.teams.some((t) => t.players.some((p) => p.id === id)))) {
          rookiesSignedWithin2++;
        }
      }
    }
  }
}

console.log(`Clutch economy and development report: ${LEAGUES} leagues x ${SEASONS} seasons${AI_TRAINING_POLICY.reserve === Infinity ? ", AI training OFF" : ""}, ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log("Average season P&L by final standings rank");
console.log(["Rank", ...kinds.map((k) => LEDGER_LABEL[k].split(" ")[0]), "Net"].map((s) => s.padStart(10)).join(""));
byRank.forEach((r, i) => {
  console.log([String(i + 1), ...kinds.map((k) => money(r.kinds[k] / r.n)), money(r.net / r.n)].map((s) => s.padStart(10)).join(""));
});

console.log("\nBy season (averages across leagues)");
console.log("Season | Starter OVR | Top-10 | Best | 88+ starters | Starter age | Lineup spread | Weakest lineup | Richest club | In debt | Training levels 0-4");
perSeason.forEach((s, i) => {
  console.log(
    [
      String(i + 1).padStart(6),
      avg(s.starterOvr).toFixed(1).padStart(11),
      avg(s.top10).toFixed(1).padStart(6),
      avg(s.best).toFixed(1).padStart(4),
      avg(s.stars).toFixed(1).padStart(12),
      avg(s.starterAge).toFixed(1).padStart(11),
      avg(s.spread).toFixed(1).padStart(13),
      avg(s.weakest).toFixed(1).padStart(14),
      money(avg(s.richest)).padStart(12),
      pct(s.inDebt, s.clubs).padStart(7),
      `  ${s.training.join("/")}`,
    ].join(" | "),
  );
});

console.log(`\nRetirements per league-season: ${(retirements / Math.max(1, rookieClasses)).toFixed(1)} (forced at the age limit: ${forced}), age median ${pctl(retireAges, 0.5) ?? "-"}, 10th-90th pct ${pctl(retireAges, 0.1) ?? "-"}-${pctl(retireAges, 0.9) ?? "-"}`);
console.log(`Rookies who played or were rostered within two seasons: ${pct(rookiesSignedWithin2, rookiesTracked)} of ${rookiesTracked}`);
console.log(`Champion's training level: ${[0, 1, 2, 3, 4].map((l) => `L${l} ${pct(championTraining.filter((x) => x === l).length, championTraining.length)}`).join(", ")}`);
console.log(`Payroll: median ${money(pctl(payrolls, 0.5))}, 90th pct ${money(pctl(payrolls, 0.9))}, cap ${money(CONTRACT_RULES.salaryCap)}`);
console.log(`Emergency call-ups on rosters per league-season: ${(callUps / (LEAGUES * SEASONS)).toFixed(1)}`);

// Controlled experiment: the same players, the same luck, full minutes, three
// seasons of development with no program versus the top program all season.
const league = createLeague("training-ab");
const players = league.teams.flatMap(rosterOf);
const topBoost = trainingBoost(TRAINING_LEVELS[TRAINING_LEVELS.length - 1].cost);
const groups: Record<string, { none: number[]; top: number[] }> = { "21 and under": { none: [], top: [] }, "22-25": { none: [], top: [] }, "26 and over": { none: [], top: [] }, all: { none: [], top: [] } };
for (const p of players) {
  const run = (boost: number) => {
    let cur = p;
    for (let y = 0; y < 3; y++) cur = developPlayer(cur, { maps: 100, boost }, new Rng(`ab:${p.id}:${y}`)).player;
    return overall(cur) - overall(p);
  };
  const group = p.age <= 21 ? "21 and under" : p.age <= 25 ? "22-25" : "26 and over";
  for (const g of [group, "all"]) {
    groups[g].none.push(run(0));
    groups[g].top.push(run(topBoost));
  }
}
console.log(`\nTraining A/B: overall change over three seasons, same players and luck, full minutes (top program boost ${topBoost.toFixed(2)})`);
for (const [g, r] of Object.entries(groups)) {
  console.log(`  ${g.padEnd(13)} no program ${avg(r.none).toFixed(1).padStart(5)}, top program ${avg(r.top).toFixed(1).padStart(5)}, difference ${(avg(r.top) - avg(r.none)).toFixed(1)} (n=${r.none.length})`);
}
