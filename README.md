# Clutch

A Call of Duty esports management sim, in the spirit of Football Manager. You run a
CDL-style org: build the roster, set tactics, and watch the matches play out.

This repository currently contains the deterministic **match engine**, a full
**season** with calendar and standings, and a web UI to play through a season
one match day at a time and read the play-by-play of any series.

## Run it

```bash
npm install
npm run dev        # web playground at http://localhost:5173
npm test           # engine test suite
npm run balance    # simulate hundreds of series and print win rates
npm run build      # typecheck + production bundle
```

## Layout

```
src/engine/         Pure TypeScript, no framework dependency
  rng.ts            Seeded RNG (mulberry32). Same seed, same match, every time.
  types.ts          Player, Team, Map, MatchEvent, MapResult, SeriesResult
  ratings.ts        Overall rating, per-map form, duel probability
  combat.ts         Live team state and gunfight resolution shared by all modes
  hardpoint.ts      First to 250, hills rotate every 60s
  snd.ts            Search & Destroy, first to 6 of 11, sides swap after round 6
  control.ts        Control, first to 3 of 5, 30 lives, zones A then B
  series.ts         CDL best-of-5: HP, SnD, Control, HP, SnD
  season.ts         Season calendar, stages, points, standings
  bracket.ts        8-team double-elimination template and round-robin scheduler
  generate.ts       Procedural fictional teams and players
  maps.ts           Fictional map pool
src/ui/             React app (Vite): Season tab and Match lab tab
scripts/balance.ts  Balance harness
```

## Season format

Twelve teams, four Majors, then Champs. All 40 match days are generated up
front with symbolic team references (group slot, bracket seed, winner or loser
of a match) that resolve on the day they are played, so a season is plain data
advanced by `playNextDay`, `playStage` or `playSeason` in `src/engine/season.ts`.

Each Major:

1. **Qualifiers.** Two groups of six, round robin, one match day per week for
   five weeks. Major I groups are a random draw; later Majors snake-seed the
   groups from season points. Ties on wins break by head-to-head, then map
   differential.
2. **Bracket.** Top four of each group into an eight-team double-elimination
   bracket over four days (template in `src/engine/bracket.ts`). Group winners
   seed 1 and 2, runners-up 3 and 4, and so on.

Season points: 10 per qualifier win, plus Major placement points
(100, 80, 65, 50, 40, 40, 30, 30, 20, 20, 10, 10). The top eight by points play
Champs, the same bracket, which crowns the champion.

## How a gunfight is decided

Every kill in every mode goes through `resolveDuel` in `src/engine/combat.ts`.

1. Each team picks a fighter. SMGs, aggressive setups and high-aim players are in
   more fights.
2. Each fighter gets a combat rating: `aim * 0.5 + positioning * 0.3 + gameSense * 0.2`,
   plus their form for this map (individual form scaled by consistency, plus a
   whole-team form roll) and a small mode bonus.
3. Situational modifiers, in rating points: numbers advantage (+4 per extra teammate
   alive), team comms (+/-3), pushing vs holding (initiator -2 offset by aggression,
   holder gains from positioning), and clutch factor (+/-6 when alone against two or
   more).
4. The winner is drawn from a logistic curve over the rating difference. A 30-point
   edge is a 73/27 fight. Per-fight edges are deliberately small because they
   compound over 80 to 120 kills a map.

Mode rules and all tuning knobs are named constants at the top of each mode file
(`HARDPOINT_RULES`, `SND_RULES`, `CONTROL_RULES`), and `DUEL_SCALE` /
`TEAM_FORM_SD` in `ratings.ts`.

## Balance targets

`npm run balance` prints series and per-mode win rates across rating gaps, side
bias checks for the round-based modes, and round-end reasons. Current state:

| Roster rating gap | Series win for the better team |
| --- | --- |
| 0 | ~50% |
| 4 | ~74% |
| 8 | ~87% |
| 16 | ~99% |

S&D and Control attackers win roughly 47% of rounds, and identical rosters split
maps evenly regardless of which side attacks first.

## Next

In rough order: contracts, salary cap and finances, then morale, media and
scouting, then multi-season progression with aging and generated rookies. The engine is UI-free on purpose
so a headless season sim can run thousands of matches for balance testing.
