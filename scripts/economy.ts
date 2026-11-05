/**
 * Economy harness: run AI-only leagues for several seasons and report how the
 * money flows. Run with `npm run economy`.
 *
 *   npm run economy -- --leagues 8 --seasons 3
 */
import {
  CONTRACT_RULES,
  createLeague,
  EXPENSE_KINDS,
  INCOME_KINDS,
  LEDGER_LABEL,
  lineupRating,
  money,
  payroll,
  playSeason,
  rosterOf,
  seasonStandings,
  startNextSeason,
  summarize,
  type LedgerKind,
  type Season,
} from "../src/engine";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const LEAGUES = arg("leagues", 8);
const SEASONS = arg("seasons", 3);

const byRank: { kinds: Record<LedgerKind, number>; net: number; n: number }[] = Array.from({ length: 12 }, () => ({
  kinds: Object.fromEntries([...INCOME_KINDS, ...EXPENSE_KINDS].map((k) => [k, 0])) as Record<LedgerKind, number>,
  net: 0,
  n: 0,
}));
const payrolls: number[] = [];
const balancesEnd: number[] = [];
const prestigeEnd: number[] = [];
const ratingSpread: number[][] = Array.from({ length: SEASONS }, () => []);
const championRank: number[] = [];
let callUps = 0;
let freeAgentsEnd = 0;
let expiring = 0;

const t0 = Date.now();
for (let l = 0; l < LEAGUES; l++) {
  let season: Season = { ...createLeague(`economy-${l}`), userTeamId: null };
  for (let y = 0; y < SEASONS; y++) {
    if (y > 0) {
      for (const t of season.teams) for (const p of rosterOf(t)) if (p.contract?.years === 1) {
        expiring++;
      }
      season = startNextSeason(season);
    }
    const ratings = season.teams.map(lineupRating);
    season = playSeason(season);
    ratingSpread[y].push(Math.max(...ratings) - Math.min(...ratings));
    const table = seasonStandings(season);
    table.forEach((row, rank) => {
      const s = summarize(season.finances[row.teamId], season.year);
      for (const k of [...INCOME_KINDS, ...EXPENSE_KINDS]) byRank[rank].kinds[k] += s.byKind[k];
      byRank[rank].net += s.net;
      byRank[rank].n++;
    });
    const champRating = lineupRating(season.teams.find((t) => t.id === season.champion)!);
    championRank.push(season.teams.map(lineupRating).filter((r) => r > champRating).length + 1);
    for (const t of season.teams) {
      payrolls.push(payroll(t));
      callUps += rosterOf(t).filter((p) => p.id.startsWith("cu-")).length;
    }
  }
  for (const t of season.teams) {
    balancesEnd.push(season.finances[t.id].balance);
    prestigeEnd.push(season.finances[t.id].prestige);
  }
  freeAgentsEnd += season.freeAgents.length;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pctl = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];

console.log(`Clutch economy report: ${LEAGUES} leagues x ${SEASONS} seasons, ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log("Average season P&L by final standings rank");
const cols = [...INCOME_KINDS, ...EXPENSE_KINDS];
console.log(["Rank", ...cols.map((k) => LEDGER_LABEL[k].split(" ")[0]), "Net"].map((s) => s.padStart(10)).join(""));
byRank.forEach((r, i) => {
  console.log([String(i + 1), ...cols.map((k) => money(r.kinds[k] / r.n)), money(r.net / r.n)].map((s) => s.padStart(10)).join(""));
});

console.log(`\nPayroll: median ${money(pctl(payrolls, 0.5))}, 90th pct ${money(pctl(payrolls, 0.9))}, max ${money(Math.max(...payrolls))}, cap ${money(CONTRACT_RULES.salaryCap)}`);
console.log(`Share of clubs within $100k of the cap: ${((payrolls.filter((p) => p >= CONTRACT_RULES.salaryCap - 100_000).length / payrolls.length) * 100).toFixed(0)}%`);
console.log(`Balance after ${SEASONS} seasons: min ${money(Math.min(...balancesEnd))}, median ${money(pctl(balancesEnd, 0.5))}, max ${money(Math.max(...balancesEnd))}, in debt ${balancesEnd.filter((b) => b < 0).length} of ${balancesEnd.length}`);
console.log(`Prestige after ${SEASONS} seasons: min ${Math.min(...prestigeEnd)}, median ${pctl(prestigeEnd, 0.5)}, max ${Math.max(...prestigeEnd)}`);
console.log(`Lineup rating spread (best minus worst club) by season: ${ratingSpread.map((s) => avg(s).toFixed(1)).join(", ")}`);
console.log(`Champion's lineup-rating rank: ${[1, 2, 3, 4].map((r) => `#${r} ${((championRank.filter((x) => x === r).length / championRank.length) * 100).toFixed(0)}%`).join(", ")}, lower ${((championRank.filter((x) => x > 4).length / championRank.length) * 100).toFixed(0)}%`);
console.log(`Emergency call-ups on rosters per season: ${(callUps / (LEAGUES * SEASONS)).toFixed(1)} per league`);
console.log(`Free agents left in the pool at the end: ${(freeAgentsEnd / LEAGUES).toFixed(1)} per league`);
console.log(`Final-year contracts entering offseasons: ${(expiring / (LEAGUES * Math.max(1, SEASONS - 1))).toFixed(1)} per league`);
