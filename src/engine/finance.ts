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

export type LedgerKind = "league" | "sponsor" | "merch" | "prize" | "salary" | "operations" | "buyout";

export const INCOME_KINDS: LedgerKind[] = ["league", "sponsor", "merch", "prize"];
export const EXPENSE_KINDS: LedgerKind[] = ["salary", "operations", "buyout"];

export const LEDGER_LABEL: Record<LedgerKind, string> = {
  league: "League revenue share",
  sponsor: "Sponsorships",
  merch: "Merch and viewership",
  prize: "Prize money",
  salary: "Player salaries",
  operations: "Staff and operations",
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
  ledger: LedgerEntry[];
}

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
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

export function initialFinances(team: Team): TeamFinances {
  const ovr = team.players.reduce((s, p) => s + overall(p), 0) / Math.max(1, team.players.length);
  const prestige = Math.round(clamp((ovr - 65) * 4, 10, 90));
  return { balance: 500_000 + prestige * 10_000, prestige, fans: 50 + prestige * 3, ledger: [] };
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
  let next: TeamFinances = {
    ...fin,
    prestige: Math.round(clamp(fin.prestige * (1 - w) + target * w, 0, 100)),
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

/** Balance at season end if nothing changes and no more prize money is won. */
export function projectedBalance(team: Team, fin: TeamFinances, daysLeft: number, seasonDays: number): number {
  const daily = dailyEntries(team, fin, 0, 0, seasonDays).reduce((s, e) => s + e.amount, 0);
  return fin.balance + daily * daysLeft;
}
