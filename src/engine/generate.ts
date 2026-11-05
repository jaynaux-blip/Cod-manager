/**
 * Procedural generation of fictional clubs, players and contracts.
 */
import { CONTRACT_RULES, marketValue, roundTo } from "./contracts";
import { clamp, Rng } from "./rng";
import type { Attributes, Player, Role, Team } from "./types";

/** Fictional orgs: city, name, tag. Tags are unique. */
const ORGS: [string, string, string][] = [
  ["Atlanta", "Firebirds", "ATL"], ["Boston", "Tidebreakers", "BOS"], ["Carolina", "Corsairs", "CAR"],
  ["Las Vegas", "Aces", "LVA"], ["Los Angeles", "Vipers", "LAV"], ["Miami", "Mirage", "MIA"],
  ["Minnesota", "Frost", "MIN"], ["New York", "Kings", "NYK"], ["Seattle", "Cascade", "SEA"],
  ["Toronto", "Northmen", "TOR"], ["Austin", "Rattlers", "AUS"], ["Vancouver", "Vortex", "VAN"],
  ["London", "Sovereigns", "LDN"], ["Paris", "Phantoms", "PAR"], ["Chicago", "Hounds", "CHI"],
  ["Orlando", "Tempest", "ORL"],
];

const GAMERTAGS = [
  "Blaze", "Vex", "Hush", "Kairo", "Nyx", "Rook", "Sable", "Tempo", "Zed", "Ghost", "Pulse", "Fuse",
  "Sykes", "Arlo", "Dash", "Echo", "Flint", "Gage", "Havoc", "Ion", "Jolt", "Kaze", "Lux", "Mace",
  "Nova", "Onyx", "Pryce", "Quill", "Riot", "Shade", "Tusk", "Umbra", "Volt", "Wraith", "Xeno", "Yule",
  "Zane", "Ace", "Brick", "Cipher", "Drift", "Ember", "Frost", "Glitch", "Halo", "Indigo", "Jinx", "Krow",
];
const SYL_START = ["Br", "Cr", "Dr", "Fr", "Gr", "Kr", "Pr", "Tr", "Vr", "Bl", "Cl", "Fl", "Sl", "Sk", "Sn", "St", "Sw", "Z", "V", "K", "J", "R", "N", "M", "T", "Q"];
const SYL_MID = ["a", "e", "i", "o", "u", "y", "ae", "io", "ay"];
const SYL_END = ["x", "z", "k", "n", "r", "sh", "ck", "ze", "ro", "lo", "ix", "on", "ar", "en", "is", "yn", "ek"];

/** Hands out gamertags that are unique across everything it has seen. */
export class NameGen {
  private used: Set<string>;
  constructor(private rng: Rng, used: Iterable<string> = []) {
    this.used = new Set(used);
  }

  next(): string {
    const fresh = GAMERTAGS.filter((n) => !this.used.has(n));
    let name: string;
    if (fresh.length > 0 && this.rng.chance(0.6)) {
      name = this.rng.pick(fresh);
    } else {
      do {
        name = this.rng.pick(SYL_START) + this.rng.pick(SYL_MID) + this.rng.pick(SYL_END);
      } while (this.used.has(name));
    }
    this.used.add(name);
    return name;
  }
}

export interface GenerateOptions {
  /** Average overall rating of the lineup, roughly 55-90. */
  tier: number;
  /** Spread of ratings within the roster. */
  spread?: number;
  name?: string;
  tag?: string;
  aggression?: number;
  /** Shared name generator, so names stay unique across a league. */
  names?: NameGen;
  /** Number of substitutes, generated a little below the lineup. */
  bench?: number;
  /** Give every player a starting contract that fits under the cap. */
  contracts?: boolean;
}

const ROLE_SET: Role[] = ["AR", "AR", "SMG", "SMG"];
const ROLES: Role[] = ["AR", "SMG", "Flex"];

export function generateTeam(rng: Rng, id: string, opts: GenerateOptions, org = rng.pick(ORGS)): Team {
  const names = opts.names ?? new NameGen(rng.fork("names"));
  const spread = opts.spread ?? 6;
  const players = ROLE_SET.map((role, i) => generatePlayer(rng, `${id}-p${i}`, names.next(), role, opts.tier, spread));
  const bench = Array.from({ length: opts.bench ?? 0 }, (_, i) =>
    generatePlayer(rng, `${id}-p${ROLE_SET.length + i}`, names.next(), rng.pick(ROLES), opts.tier - 6, spread),
  );
  const team: Team = {
    id,
    name: opts.name ?? `${org[0]} ${org[1]}`,
    tag: opts.tag ?? org[2],
    players,
    bench,
    tactics: { aggression: opts.aggression ?? rng.int(35, 65) },
  };
  return opts.contracts ? withStartingContracts(rng, team) : team;
}

export function generatePlayer(rng: Rng, id: string, name: string, role: Role, tier: number, spread: number): Player {
  const base = rng.gaussian(tier, spread);
  const roll = (bias: number, sd = 7) => Math.round(clamp(rng.gaussian(base + bias, sd), 20, 99));
  const bias: Record<Role, Partial<Attributes>> = {
    SMG: { aim: 4, positioning: -3, gameSense: -2 },
    AR: { aim: -1, positioning: 3, gameSense: 2 },
    Flex: {},
  };
  const b = bias[role];
  const attributes: Attributes = {
    aim: roll(b.aim ?? 0),
    positioning: roll(b.positioning ?? 0),
    gameSense: roll(b.gameSense ?? 0),
    consistency: roll(0, 10),
    clutch: roll(0, 10),
    comms: roll(0, 9),
  };
  return { id, name, role, age: rng.int(18, 29), attributes };
}

/** Contracts near market value, scaled down if needed so the club starts under the cap. */
export function withStartingContracts(rng: Rng, team: Team): Team {
  const sign = (p: Player): Player => ({
    ...p,
    contract: {
      salary: Math.max(CONTRACT_RULES.minSalary, roundTo(marketValue(p) * rng.range(0.8, 1.1))),
      years: rng.int(1, CONTRACT_RULES.maxYears),
    },
  });
  let players = team.players.map(sign);
  let bench = team.bench.map(sign);
  const limit = CONTRACT_RULES.salaryCap * 0.95;
  const total = [...players, ...bench].reduce((s, p) => s + p.contract!.salary, 0);
  if (total > limit) {
    const scale = (p: Player): Player => ({
      ...p,
      contract: { ...p.contract!, salary: Math.max(CONTRACT_RULES.minSalary, Math.floor((p.contract!.salary * limit) / total / 5_000) * 5_000) },
    });
    players = players.map(scale);
    bench = bench.map(scale);
  }
  return { ...team, players, bench };
}

/** Rating band for a generated league. Narrow on purpose: see the balance harness. */
export const LEAGUE_TIER_RANGE: [number, number] = [71, 83];

/** Twelve clubs with unique orgs, unique player names, one substitute each and starting contracts. */
export function generateLeague(seed: string, count = 12): Team[] {
  const rng = new Rng(seed);
  const orgs = rng.shuffle(ORGS);
  const names = new NameGen(rng.fork("names"));
  return Array.from({ length: count }, (_, i) =>
    generateTeam(
      rng.fork(`team${i}`),
      `team-${i}`,
      { tier: rng.int(...LEAGUE_TIER_RANGE), names, bench: 1, contracts: true },
      orgs[i % orgs.length],
    ),
  );
}

export interface FreeAgentOptions {
  count: number;
  idPrefix: string;
  /** Names already taken in the league. */
  usedNames: Iterable<string>;
  tier: [number, number];
  age: [number, number];
}

export function generateFreeAgents(rng: Rng, opts: FreeAgentOptions): Player[] {
  const names = new NameGen(rng.fork("names"), opts.usedNames);
  return Array.from({ length: opts.count }, (_, i) => {
    const p = generatePlayer(rng, `${opts.idPrefix}-${i}`, names.next(), rng.pick(ROLES), rng.int(...opts.tier), 6);
    return { ...p, age: rng.int(...opts.age) };
  });
}
