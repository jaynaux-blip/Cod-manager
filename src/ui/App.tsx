import { useMemo, useState } from "react";
import { generateTeam, Rng, simulateSeries, type SeriesResult, type Team } from "../engine";
import { RosterCard } from "./RosterCard";
import { SeriesView } from "./SeriesView";

function buildTeams(seed: string): [Team, Team] {
  const rng = new Rng(`teams:${seed}`);
  const a = generateTeam(rng.fork("a"), "a", { tier: rng.int(66, 86) });
  let b = generateTeam(rng.fork("b"), "b", { tier: rng.int(66, 86) });
  if (b.name === a.name) b = { ...b, name: `${b.name} II`, tag: `${b.tag}2` };
  return [a, b];
}

export function App() {
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

  const simulate = () => {
    setResult(simulateSeries(teams, { seed: seriesSeed }));
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
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <h1>Clutch</h1>
            <p className="muted">Match engine playground</p>
          </div>
        </div>
        <div className="controls">
          <label>
            Teams seed
            <input value={teamSeed} onChange={(e) => regenerate(e.target.value)} />
          </label>
          <label>
            Series seed
            <input value={seriesSeed} onChange={(e) => setSeriesSeed(e.target.value)} />
          </label>
          <button className="primary" onClick={simulate}>
            Simulate series
          </button>
          <button onClick={simulateNext}>Next series</button>
        </div>
      </header>

      <main className="layout">
        <aside className="rosters">
          {teams.map((team, i) => (
            <RosterCard
              key={team.id}
              team={team}
              side={i as 0 | 1}
              onAggression={(v) => updateAggression(i as 0 | 1, v)}
            />
          ))}
        </aside>
        <section className="series">
          {result ? (
            <SeriesView result={result} />
          ) : (
            <div className="empty">
              <h2>Ready to run</h2>
              <p className="muted">
                Best of five, CDL format: Hardpoint, Search &amp; Destroy, Control, Hardpoint, Search &amp; Destroy.
                Same seeds always replay the same series.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
