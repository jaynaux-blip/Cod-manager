/**
 * Club finances: a running balance, prestige, fan base and a ledger.
 *
 * Recurring income and costs are posted every match day. Prize money, prestige
 * and fan growth are settled when a stage ends.
 */
import { payroll } from "./contracts";
import { overall } from "./ratings";
import { clamp } from "./rng";
import type { Team } from "./types";

export type LedgerKind = "league" | "sponsor" | "merch" | "prize" | "salary" | "operations" | "training" | "buyout";

export const INCOME_KINDS: LedgerKind[] = ["league", "sponsor", "merch", "prize"];
export const EXPENSE_KINDS: LedgerKind[] = ["salary", "operations", "training", "buyout"];

export const LEDGER_LABEL: Record<LedgerKind, string> = {
  league: "League revenue share",
  sponsor: "Sponsorships",
  merch: "Merch and viewership",
  prize: "Prize money",
  salary: "Player salaries",
  operations: "Staff and operations",
  training: "Coaching and facilities",
  buyout: "Contract buyouts",
};

export interface LedgerEntry {
  year: number;
  day: number;
  kind: LedgerKind;
  /** Positive for income, negative for costs. */
  amount: number;
  note?: string;
}

export interface TeamFinances {
  balance: number;
  /** 0-100. Drives sponsorship income and how cheaply players will sign. */
  prestige: number;
  /** Fan base in thousands. Drives merch and viewership income. */
  fans: number;
  /** Training program level, an index into TRAINING_LEVELS. */
  training: number;
  ledger: LedgerEntry[];
}

/**
 * Training programs. The cost is charged per match day. The development
 * effect comes from what was actually spent that season, so switching level
 * late in a season buys only a fraction of the effect.
 */
export const TRAINING_LEVELS = [
  { name: "None", cost: 0 },
  { name: "Analyst", cost: 250_000 },
  { name: "Coaching staff", cost: 550_000 },
  { name: "Performance center", cost: 900_000 },
  { name: "Elite program", cost: 1_400_000 },
] as const;

/** Development boost from a season's training spend: 0 to 0.5, with diminishing returns. */
export const trainingBoost = (spend: number): number => 0.5 * (1 - Math.exp(-Math.max(0, spend) / 700_000));

/** What a club spent on training in a season. */
export function trainingSpend(fin: TeamFinances, year: number): number {
  return -fin.ledger.reduce((s, e) => (e.year === year && e.kind === "training" ? s + e.amount : s), 0);
}

export const trainingCost = (fin: TeamFinances): number => TRAINING_LEVELS[fin.training]?.cost ?? 0;

export const FINANCE_RULES = {
  /** Paid to every club per season, spread across match days. */
  leagueShare: 600_000,
  operations: 300_000,
  sponsorBase: 100_000,
  sponsorPerPrestige: 6_000,
  merchPerThousandFansPerDay: 25,
  fansOnWin: 1.01,
  fansOnLoss: 0.993,
  prize: {
    major: { 1: 200_000, 2: 120_000, 3: 80_000, 4: 60_000, 5: 40_000, 7: 25_000 },
    champs: { 1: 1_000_000, 2: 500_000, 3: 300_000, 4: 200_000, 5: 100_000, 7: 75_000 },
  } as Record<"major" | "champs", Record<number, number>>,
  /** Prestige each placement pulls towards. */
  prestigeTarget: { 1: 100, 2: 85, 3: 75, 4: 65, 5: 55, 7: 45, 9: 30, 11: 20 } as Record<number, number>,
  /** How hard one stage pulls prestige towards its target. */
  prestigeWeight: { major: 0.2, champs: 0.35 },
  fansOnPlacement: { 1: 1.05, 2: 1.03, 3: 1.01, 4: 1.01 } as Record<number, number>,
  /**
   * Share of a fan base above or below its prestige baseline that survives the
   * offseason. Without it a dynasty's fans compound forever and its merch
   * income outgrows every way to spend it.
   */
  fanRetention: 0.7,
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** The fan base a club of this prestige settles towards, in thousands. */
export const fanBaseline = (prestige: number): number => 50 + prestige * 3;

/** Offseason: fan bases drift back towards their prestige baseline. */
export function settleFans(fin: TeamFinances): TeamFinances {
  const base = fanBaseline(fin.prestige);
  return { ...fin, fans: round1(base + (fin.fans - base) * FINANCE_RULES.fanRetention) };
}

export function initialFinances(team: Team): TeamFinances {
  const ovr = team.players.reduce((s, p) => s + overall(p), 0) / Math.max(1, team.players.length);
  const prestige = Math.round(clamp((ovr - 65) * 4, 10, 90));
  return { balance: 500_000 + prestige * 10_000, prestige, fans: fanBaseline(prestige), training: 0, ledger: [] };
}

export const sponsorIncome = (prestige: number): number =>
  FINANCE_RULES.sponsorBase + prestige * FINANCE_RULES.sponsorPerPrestige;

/** Recurring income and costs for one match day. */
export function dailyEntries(team: Team, fin: TeamFinances, year: number, day: number, seasonDays: number): LedgerEntry[] {
  const R = FINANCE_RULES;
  const perDay = (perSeason: number) => Math.round(perSeason / seasonDays);
  const entries: LedgerEntry[] = [
    { year, day, kind: "league", amount: perDay(R.leagueShare) },
    { year, day, kind: "sponsor", amount: perDay(sponsorIncome(fin.prestige)) },
    { year, day, kind: "merch", amount: Math.round(fin.fans * R.merchPerThousandFansPerDay) },
    { year, day, kind: "salary", amount: -perDay(payroll(team)) },
    { year, day, kind: "operations", amount: -perDay(R.operations) },
    { year, day, kind: "training", amount: -perDay(trainingCost(fin)) },
  ];
  return entries.filter((e) => e.amount !== 0);
}

export function post(fin: TeamFinances, entries: LedgerEntry[]): TeamFinances {
  const total = entries.reduce((s, e) => s + e.amount, 0);
  return { ...fin, balance: fin.balance + total, ledger: [...fin.ledger, ...entries] };
}

/** Fans follow results series by series. */
export function applySeriesResult(fin: TeamFinances, won: boolean): TeamFinances {
  return { ...fin, fans: round1(fin.fans * (won ? FINANCE_RULES.fansOnWin : FINANCE_RULES.fansOnLoss)) };
}

/** Settle a stage placement: prize money, prestige drift and a fan bump for deep runs. */
export function applyPlacement(
  fin: TeamFinances,
  place: number,
  kind: "major" | "champs",
  year: number,
  day: number,
  note: string,
): TeamFinances {
  const R = FINANCE_RULES;
  const w = R.prestigeWeight[kind];
  const target = R.prestigeTarget[place] ?? 20;
  // Always move at least one point towards the target, so rounding never stalls prestige short of it.
  let prestige = Math.round(fin.prestige * (1 - w) + target * w);
  if (prestige === fin.prestige && target !== fin.prestige) prestige += Math.sign(target - fin.prestige);
  let next: TeamFinances = {
    ...fin,
    prestige: clamp(prestige, 0, 100),
    fans: round1(fin.fans * (R.fansOnPlacement[place] ?? 1)),
  };
  const prize = R.prize[kind][place] ?? 0;
  if (prize > 0) next = post(next, [{ year, day, kind: "prize", amount: prize, note }]);
  return next;
}

export interface FinanceSummary {
  byKind: Record<LedgerKind, number>;
  income: number;
  expenses: number;
  net: number;
}

export function summarize(fin: TeamFinances, year: number): FinanceSummary {
  const byKind = Object.fromEntries([...INCOME_KINDS, ...EXPENSE_KINDS].map((k) => [k, 0])) as Record<LedgerKind, number>;
  for (const e of fin.ledger) if (e.year === year) byKind[e.kind] += e.amount;
  const income = INCOME_KINDS.reduce((s, k) => s + byKind[k], 0);
  const expenses = EXPENSE_KINDS.reduce((s, k) => s + byKind[k], 0);
  return { byKind, income, expenses, net: income + expenses };
}

/**
 * The payroll a club can carry without losing money before prize money:
 * recurring income at current prestige and fans, minus operating costs.
 */
export function sustainablePayroll(fin: TeamFinances): number {
  const R = FINANCE_RULES;
  const seasonDays = 40;
  const merch = fin.fans * R.merchPerThousandFansPerDay * seasonDays;
  return Math.max(0, R.leagueShare + sponsorIncome(fin.prestige) + merch - R.operations - trainingCost(fin));
}

/** Balance at season end if nothing changes and no more prize money is won. */
export function projectedBalance(team: Team, fin: TeamFinances, daysLeft: number, seasonDays: number): number {
  const daily = dailyEntries(team, fin, 0, 0, seasonDays).reduce((s, e) => s + e.amount, 0);
  return fin.balance + daily * daysLeft;
}
