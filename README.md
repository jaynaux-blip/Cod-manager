# Clutch

A Call of Duty esports management sim, in the spirit of Football Manager. You run a
CDL-style org: build the roster, set tactics, and watch the matches play out.

This repository currently contains the deterministic **match engine**, a full
**season** with calendar and standings, **contracts, a salary cap and club
finances**, and a web UI to manage a club across seasons and read the
play-by-play of any series. All clubs, players and maps are fictional.

## Run it

```bash
npm install
npm run dev        # web playground at http://localhost:5173
npm test           # engine test suite
npm run balance    # simulate hundreds of series and print win rates
npm run economy    # run AI-only leagues for several seasons and print the money flows
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
  season.ts         Season calendar, stages, points, standings, daily finances
  bracket.ts        8-team double-elimination template and round-robin scheduler
  contracts.ts      Market value, asking salary, payroll, the cap
  finance.ts        Balance, prestige, fans, ledger, prize money
  transactions.ts   Manager moves: sign, extend, release, set the lineup
  ai.ts             AI front offices: free agency and extensions
  league.ts         New league, and rolling a season into the next
  generate.ts       Procedural fictional clubs, players and starting contracts
  maps.ts           Fictional map pool
src/ui/             React app (Vite): Season, Club and Match lab tabs
scripts/balance.ts  Match balance harness
scripts/economy.ts  Economy harness
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

## Contracts and the cap

Every rostered player has a salary and a number of seasons left. A club carries
four starters, the only players the match engine uses, plus up to two
substitutes.

| Rule | Value |
| --- | --- |
| Salary cap, lineup plus bench | $1.6M per season |
| League minimum | $50k, always allowed even over the cap |
| League maximum | $900k |
| Contract length | 1 to 3 seasons |
| Release buyout | Half of what is still owed |

- **Market value** grows exponentially with overall rating, from about $100k at
  70 to $610k at 90, discounted for teenagers and players past 26.
- **Asking salary** starts from market value. Young players charge more for long
  deals and veterans take less. Prestigious clubs get up to 10% off and unknown
  clubs pay up to 10% more. Extensions carry a 5% loyalty discount.
- **Extensions** are agreed in a player's final season and start the season
  after, so they are checked against next season's payroll.
- **Roster lock.** Signings and releases are blocked during Champs. Lineup
  changes and extensions are always allowed.

## Finances

Money is booked every match day: league revenue share, sponsorship scaled by
prestige, and merch scaled by fan base, against salaries and operating costs.
When a stage ends, clubs receive prize money, prestige drifts towards their
placement, and deep runs grow the fan base. Fans also rise and fall series by
series. Clubs in debt can only sign players at the league minimum, which
applies to AI clubs too.

## Offseason

After Champs the season stays open for the offseason. Extend the players you
want to keep. Starting the next season then:

1. Lets AI clubs decide which of their final-year players to extend.
2. Takes a season off every contract, applies agreed extensions, and sends
   everyone else to free agency.
3. Adds a rookie class to the free-agent pool.

AI clubs only sign free agents when the first match day is played, so the
manager gets first pick in the preseason. If a club cannot afford anyone it
calls up an academy player at the league minimum.

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

In rough order: player aging and development so values change between seasons,
then morale, media and scouting. Rich clubs currently pile up cash because the
cap stops money from buying players, so the economy also needs things to spend
on, such as staff and facilities that speed up development. The engine is UI-free on purpose
so a headless season sim can run thousands of matches for balance testing.
