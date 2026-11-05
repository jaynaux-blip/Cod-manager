import { useMemo, useState } from "react";
import { createLeague, generateTeam, money, Rng, simulateSeries, teamById, type Season, type SeriesResult, type Team } from "../engine";
import { ClubView } from "./ClubView";
import { RosterCard } from "./RosterCard";
import { SeasonView } from "./SeasonView";
import { SeriesView } from "./SeriesView";

type Tab = "season" | "club" | "lab";

const DEFAULT_SEED = "league-2026";

export function App() {
  const [tab, setTab] = useState<Tab>("season");
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [season, setSeason] = useState<Season>(() => createLeague(DEFAULT_SEED));
  const newLeague = (s: string) => {
    setSeed(s);
    setSeason(createLeague(s));
  };
  const club = season.userTeamId ? teamById(season, season.userTeamId) : null;
  const balance = club ? season.finances[club.id].balance : 0;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <h1>Clutch</h1>
            <p className="muted">CDL management sim</p>
          </div>
        </div>
        {club && (
          <div className="club-chip">
            <span className="tag">{club.tag}</span>
            <span>{club.name}</span>
            <span className={balance < 0 ? "bad" : "muted"}>{money(balance)}</span>
          </div>
        )}
        <nav className="tabs">
          <button className={tab === "season" ? "active" : ""} onClick={() => setTab("season")}>
            Season
          </button>
          <button className={tab === "club" ? "active" : ""} onClick={() => setTab("club")}>
            Club
          </button>
          <button className={tab === "lab" ? "active" : ""} onClick={() => setTab("lab")}>
            Match lab
          </button>
        </nav>
      </header>
      <main className="page">
        {tab === "season" && (
          <SeasonView season={season} setSeason={setSeason} seed={seed} onNewLeague={newLeague} onGoToClub={() => setTab("club")} />
        )}
        {tab === "club" && <ClubView season={season} setSeason={setSeason} />}
        {tab === "lab" && <MatchLab />}
      </main>
    </div>
  );
}

function buildTeams(seed: string): [Team, Team] {
  const rng = new Rng(`teams:${seed}`);
  const a = generateTeam(rng.fork("a"), "a", { tier: rng.int(66, 86) });
  let b = generateTeam(rng.fork("b"), "b", { tier: rng.int(66, 86) });
  if (b.name === a.name) b = { ...b, name: `${b.name} II`, tag: `${b.tag}2` };
  return [a, b];
}

function MatchLab() {
  const [teamSeed, setTeamSeed] = useState("opening-night");
  const [seriesSeed, setSeriesSeed] = useState("game-1");
  const [result, setResult] = useState<SeriesResult | null>(null);
  const [teams, setTeams] = useState<[Team, Team]>(() => buildTeams("opening-night"));

  const seriesCount = useMemo(() => Number(seriesSeed.match(/\d+$/)?.[0] ?? 0), [seriesSeed]);

  const regenerate = (seed: string) => {
    setTeamSeed(seed);
    setTeams(buildTeams(seed));
    setResult(null);
  };

  const simulateNext = () => {
    const next = `game-${seriesCount + 1}`;
    setSeriesSeed(next);
    setResult(simulateSeries(teams, { seed: next }));
  };

  const updateAggression = (idx: 0 | 1, aggression: number) => {
    const copy: [Team, Team] = [teams[0], teams[1]];
    copy[idx] = { ...copy[idx], tactics: { ...copy[idx].tactics, aggression } };
    setTeams(copy);
  };

  return (
    <>
      <div className="card season-bar">
        <label>
          Teams seed
          <input value={teamSeed} onChange={(e) => regenerate(e.target.value)} />
        </label>
        <label>
          Series seed
          <input value={seriesSeed} onChange={(e) => setSeriesSeed(e.target.value)} />
        </label>
        <div className="season-actions">
          <button className="primary" onClick={() => setResult(simulateSeries(teams, { seed: seriesSeed }))}>
            Simulate series
          </button>
          <button onClick={simulateNext}>Next series</button>
        </div>
      </div>
      <div className="layout">
        <aside className="rosters">
          {teams.map((team, i) => (
            <RosterCard key={team.id} team={team} side={i as 0 | 1} onAggression={(v) => updateAggression(i as 0 | 1, v)} />
          ))}
        </aside>
        <section className="series">
          {result ? (
            <SeriesView result={result} />
          ) : (
            <div className="empty">
              <h2>Ready to run</h2>
              <p className="muted">
                Best of five, CDL format: Hardpoint, Search &amp; Destroy, Control, Hardpoint, Search &amp; Destroy. Same seeds always replay
                the same series.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
