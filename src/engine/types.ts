/** Core data model shared by the match engine and the UI. */

export type Role = "AR" | "SMG" | "Flex";

export const ATTRIBUTE_KEYS = [
  "aim",
  "positioning",
  "gameSense",
  "consistency",
  "clutch",
  "comms",
] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/** All attributes are on a 1-99 scale. */
export type Attributes = Record<AttributeKey, number>;

export interface ContractTerms {
  /** Salary in dollars per season. */
  salary: number;
  /** Number of seasons. */
  years: number;
}

export interface Contract extends ContractTerms {
  /** Seasons remaining, including the current one. 1 means this is the final season. */
  years: number;
  /** New terms agreed in the final season, starting next season. */
  extension?: ContractTerms;
}

/**
 * Hidden development profile. Never shown to the manager directly: the UI only
 * shows the scouted range from potentialRange().
 */
export interface Development {
  /** Ceiling on the overall scale. Drifts each offseason until age 23. */
  potential: number;
  /** Decline starts after this age. */
  peakAge: number;
  /** Fixed scouting error in range half-widths, -2..2. Positive means overhyped. */
  scoutBias: number;
}

export interface Player {
  id: string;
  name: string;
  role: Role;
  age: number;
  attributes: Attributes;
  /** Free agents have no contract. */
  contract?: Contract;
  /** Generated players always carry this. Hand-built players fall back to devOf(). */
  dev?: Development;
  /**
   * Free agents only: the season during or after which the player became
   * unsigned. A free agent who was already unsigned before a season started
   * sat that whole season unsigned. Missing means unsigned from the start.
   */
  freedIn?: number;
}

export interface Tactics {
  /** 0 = sit back and hold angles, 100 = chase every gunfight. */
  aggression: number;
}

export interface Team {
  id: string;
  name: string;
  tag: string;
  /** The four starters. The match engine only ever plays these. */
  players: Player[];
  /** Substitutes under contract. Lineup plus bench is capped by CONTRACT_RULES.rosterMax. */
  bench: Player[];
  tactics: Tactics;
}

export type Mode = "hardpoint" | "snd" | "control";

export const MODE_LABEL: Record<Mode, string> = {
  hardpoint: "Hardpoint",
  snd: "Search & Destroy",
  control: "Control",
};

export interface GameMap {
  id: string;
  name: string;
  modes: Mode[];
}

export type TeamIndex = 0 | 1;

export type EventKind =
  | "map_start"
  | "map_end"
  | "kill"
  | "rotation"
  | "break"
  | "round_start"
  | "round_end"
  | "plant"
  | "defuse"
  | "capture"
  | "clutch"
  | "info";

export interface MatchEvent {
  /** Seconds of game time (within the current round for round-based modes). */
  t: number;
  kind: EventKind;
  /** Team the event favours, when there is one. */
  team?: TeamIndex;
  text: string;
  /** Score after this event. */
  score: [number, number];
  /** Round number for round-based modes. */
  round?: number;
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  plants: number;
  defuses: number;
  clutches: number;
}

export const emptyStats = (): PlayerStats => ({
  kills: 0,
  deaths: 0,
  plants: 0,
  defuses: 0,
  clutches: 0,
});

export interface MapResult {
  map: GameMap;
  mode: Mode;
  score: [number, number];
  winner: TeamIndex;
  events: MatchEvent[];
  stats: Record<string, PlayerStats>;
  /** Total simulated game time in seconds. */
  durationSec: number;
}

export interface SeriesResult {
  seed: string;
  teams: [Team, Team];
  maps: MapResult[];
  mapScore: [number, number];
  winner: TeamIndex;
  stats: Record<string, PlayerStats>;
}
