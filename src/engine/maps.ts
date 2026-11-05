import type { GameMap, Mode } from "./types";

/** Fictional map pool. Each map supports a subset of modes, like the real CDL pool. */
export const MAP_POOL: GameMap[] = [
  { id: "foundry", name: "Foundry", modes: ["hardpoint", "snd", "control"] },
  { id: "harbor", name: "Harbor", modes: ["hardpoint", "snd"] },
  { id: "skyline", name: "Skyline", modes: ["hardpoint", "control"] },
  { id: "vault", name: "Vault", modes: ["snd", "control"] },
  { id: "redline", name: "Redline", modes: ["hardpoint", "snd"] },
  { id: "terminus", name: "Terminus", modes: ["snd"] },
  { id: "outpost", name: "Outpost", modes: ["hardpoint", "control"] },
];

export const mapsForMode = (mode: Mode, pool: GameMap[] = MAP_POOL): GameMap[] =>
  pool.filter((m) => m.modes.includes(mode));
