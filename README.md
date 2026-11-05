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
  after, so they are checked against next season's payroll. Each player can
  agree one extension.
- **Multi-season signings** made mid-season must fit both this season's cap and
  next season's, where agreed extensions take effect.
- **Academy call-ups.** A club that cannot field four can call up an academy
  player at the league minimum, even in debt. AI clubs do the same. A kid you
  release comes back if you call up again, so call-ups cannot be rerolled.
- **Your club** is chosen before a new league's first match day and is fixed
  after that.
- **Roster lock.** Signings and releases are blocked during Champs. Lineup
  changes and extensions are always allowed.

## Finances

Money is booked every match day: league revenue share, sponsorship scaled by
prestige, and merch scaled by fan base, against salaries and operating costs.
When a stage ends, clubs receive prize money, prestige drifts towards their
placement, and deep runs grow the fan base. Fans also rise and fall series by
series. Clubs in debt can only sign players at the league minimum, which
applies to AI clubs too. AI clubs only make a preseason upgrade with a season
of that salary already in the bank, and while in debt they keep extensions
within 85% of the payroll their recurring income can sustain, so they work
their way back out instead of spiralling.

## Player development

Players develop once a year, when Champs ends, so the offseason shows next
season's ratings and ages before any contract decision. The model lives in
`src/engine/development.ts` and `src/engine/scouting.ts`.

- **Hidden ceiling.** Every player has a hidden potential, a peak age between
  22 and 28, and a fixed scouting error. The manager and the AI only ever see
  the scouted range, which is wide for teenagers, narrows each year and closes
  at 25. Some prospects are overhyped and some are hidden gems.
- **Growth** closes about 40% of the gap to the ceiling a season, scaled by
  age, by minutes and by training. Starters with 60 or more maps develop at the
  full rate, the bench at half and free agents at 30%. Ceilings drift until
  23, which produces breakouts and busts.
- **Decline** starts after the peak age and grows by 0.8 a year, to at most 4
  a season. Aim falls fastest while game sense and comms keep improving, so
  veterans become in-game leaders. Those gains stop at 95.
- **Retirement** happens when the next season starts. Unsigned players retire
  on an age curve, sooner if their scouted outlook is weak; fringe players who
  were already unsigned when the season started are pushed out, and the
  youngest feel half of both pushes. Contracted players only retire at 34, so
  no deal or extension may run past that age. Final-year players show their
  retirement risk so you can extend them first; during the season it is an
  estimate until development runs.
- **Rookie class.** Eight rookies aged 18 to 20 join each year, and the pool is
  trimmed by scouted outlook so high-ceiling rookies are not cut.
- **Pricing** includes a share of a young player's visible upside, and
  veterans are discounted more steeply from 29.

### Training program

| Level | Cost a season | Development boost |
| --- | --- | --- |
| None | $0 | 0% |
| Analyst | $250k | 15% |
| Coaching staff | $550k | 27% |
| Performance center | $900k | 36% |
| Elite program | $1.4M | 43% |

The cost is charged per match day as "Coaching and facilities". The boost is
based on what was actually spent that season, speeds growth, slows the
losses from decline by half as much, and never raises a ceiling or lowers any
attribute. Raising the program needs a season of the extra cost in the bank. AI clubs fund training from three quarters of their cash above a $1M
reserve and cancel it in debt. In a controlled test the top program is worth
about 1.3 overall points over three seasons for the same players.

### AI spending

AI clubs budget payroll from recurring income, expected prize money for their
prestige, and a quarter of cash above $1M, after choosing next season's
training program. Gap signings rank free agents by scouted outlook, so
prospects get minutes; if nobody fits the budget a solvent club may overspend
on a one-season deal only as far as half its cash covers. Preseason upgrades
rank by current rating. Fan bases drift 30% of the way back to a prestige baseline each
offseason, so a dynasty's merch income cannot compound forever.

`npm run economy` tracks all of this over several seasons: rating drift, stars,
starter age, lineup spread, the richest club, debt, retirements, rookies and a
training A/B. Add `--no-training` to switch AI training off for comparison.

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

In rough order: morale and chemistry, media and owner expectations, and a
scouting staff that narrows the scouted ranges. The engine is UI-free on purpose
so a headless season sim can run thousands of matches for balance testing.
