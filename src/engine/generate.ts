/**
 * Procedural generation of fictional teams and players.
 */
import { clamp, Rng } from "./rng";
import type { Attributes, Player, Role, Team } from "./types";

const ORG_NAMES = [
  ["Atlanta", "Faze"], ["Boston", "Breach"], ["Carolina", "Royal"], ["Las Vegas", "Legion"],
  ["Los Angeles", "Guerrillas"], ["Miami", "Heretics"], ["Minnesota", "Rokkr"], ["New York", "Subliners"],
  ["Seattle", "Surge"], ["Toronto", "Ultra"], ["Texas", "OpTic"], ["Vancouver", "Vortex"],
  ["London", "Royal"], ["Paris", "Legacy"], ["Chicago", "Huntsmen"], ["Florida", "Mutineers"],
];

const GAMERTAGS = [
  "Blaze", "Vex", "Hush", "Kairo", "Nyx", "Rook", "Sable", "Tempo", "Zed", "Ghost", "Pulse", "Fuse",
  "Sykes", "Arlo", "Dash", "Echo", "Flint", "Gage", "Havoc", "Ion", "Jolt", "Kaze", "Lux", "Mace",
  "Nova", "Onyx", "Pryce", "Quill", "Riot", "Shade", "Tusk", "Umbra", "Volt", "Wraith", "Xeno", "Yule",
  "Zane", "Ace", "Brick", "Cipher", "Drift", "Ember", "Frost", "Glitch", "Halo", "Indigo", "Jinx", "Krow",
];

export interface GenerateOptions {
  /** Average overall rating of the roster, roughly 55-90. */
  tier: number;
  /** Spread of ratings within the roster. */
  spread?: number;
  name?: string;
  tag?: string;
  aggression?: number;
}

const ROLE_SET: Role[] = ["AR", "AR", "SMG", "SMG"];

export function generateTeam(rng: Rng, id: string, opts: GenerateOptions): Team {
  const org = rng.pick(ORG_NAMES);
  const name = opts.name ?? `${org[0]} ${org[1]}`;
  const tag = opts.tag ?? org[1].slice(0, 3).toUpperCase();
  const usedTags = new Set<string>();
  const players = ROLE_SET.map((role, i) => {
    let gamertag = rng.pick(GAMERTAGS);
    while (usedTags.has(gamertag)) gamertag = rng.pick(GAMERTAGS);
    usedTags.add(gamertag);
    return generatePlayer(rng, `${id}-p${i}`, gamertag, role, opts.tier, opts.spread ?? 6);
  });
  return {
    id,
    name,
    tag,
    players,
    tactics: { aggression: opts.aggression ?? rng.int(35, 65) },
  };
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

export function generateLeague(seed: string, count = 12): Team[] {
  const rng = new Rng(seed);
  return Array.from({ length: count }, (_, i) =>
    generateTeam(rng.fork(`team${i}`), `team-${i}`, { tier: rng.int(62, 86) }),
  );
}
