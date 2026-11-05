import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeRef,
  fixturesForDay,
  groupStandings,
  isFinished,
  lineupProblem,
  lineupRating,
  playNextDay,
  playSeason,
  playStage,
  seasonStandings,
  setUserTeam,
  startNextSeason,
  teamById,
  type Fixture,
  type Season,
} from "../engine";
import { SeriesView } from "./SeriesView";

interface Props {
  season: Season;
  setSeason: (s: Season) => void;
  seed: string;
  onNewLeague: (seed: string) => void;
  onGoToClub: () => void;
}

export function SeasonView({ season, setSeason, seed, onNewLeague, onGoToClub }: Props) {
  const [openFixture, setOpenFixture] = useState<Fixture | null>(null);

  const finished = isFinished(season);
  const today = finished ? null : season.days[season.currentDay];
  const stageIndex = today?.stage ?? season.stages.length - 1;
  const stage = season.stages[stageIndex];
  const problem = lineupProblem(season);
  const blocked = finished || problem !== null;

  return (
    <div className="season">
      <div className="card season-bar">
        <label>
          League seed
          <input value={seed} onChange={(e) => onNewLeague(e.target.value)} />
        </label>
        <label>
          Managing
          <select value={season.userTeamId ?? ""} onChange={(e) => setSeason(setUserTeam(season, e.target.value))}>
            {season.teams
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <div className="progress">
          {finished ? (
            <>
              <strong>Season {season.year} complete. Champion: {teamById(season, season.champion!).name}</strong>
              <span className="muted">Offseason: handle expiring contracts on the Club tab, then start the next season.</span>
            </>
          ) : (
            <>
              <strong>
                Season {season.year} · {today!.label}
              </strong>
              <span className="muted">
                Day {season.currentDay + 1} of {season.days.length}
              </span>
            </>
          )}
        </div>
        <div className="season-actions">
          {finished ? (
            <button className="primary" onClick={() => setSeason(startNextSeason(season))}>
              Start season {season.year + 1}
            </button>
          ) : (
            <>
              <button className="primary" disabled={blocked} onClick={() => setSeason(playNextDay(season))}>
                Play day
              </button>
              <button disabled={blocked} onClick={() => setSeason(playStage(season))}>
                Play {stage.kind === "champs" ? "Champs" : "Major"}
              </button>
              <button disabled={blocked} onClick={() => setSeason(playSeason(season))}>
                Play season
              </button>
            </>
          )}
          <button onClick={() => onNewLeague(seed)}>New league</button>
        </div>
        {problem && (
          <div className="notice err full-width">
            {problem}{" "}
            <button className="link" onClick={onGoToClub}>
              Go to Club
            </button>
          </div>
        )}
      </div>

      <div className="season-grid">
        <div className="season-left">
          <StandingsTable season={season} />
          <StageBrowser season={season} currentStage={stageIndex} onOpen={setOpenFixture} />
        </div>
        <Calendar season={season} onOpen={setOpenFixture} />
      </div>

      {openFixture?.result && (
        <div className="modal-backdrop" onClick={() => setOpenFixture(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {season.stages[openFixture.stage].name} · {openFixture.round}
              </h3>
              <button onClick={() => setOpenFixture(null)}>Close</button>
            </div>
            <SeriesView result={openFixture.result} />
          </div>
        </div>
      )}
    </div>
  );
}

function StandingsTable({ season }: { season: Season }) {
  const rows = useMemo(() => seasonStandings(season), [season]);
  const majors = season.stages.filter((s) => s.kind === "major");
  return (
    <div className="card">
      <h3 className="panel-title">Season standings</h3>
      <table className="standings">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>OVR</th>
            <th>Pts</th>
            <th>W-L</th>
            <th>Maps</th>
            {majors.map((m) => (
              <th key={m.index} title={m.name}>
                M{m.index + 1}
              </th>
            ))}
            <th title="Champs">CH</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const team = teamById(season, r.teamId);
            const champion = season.champion === r.teamId;
            return (
              <tr key={r.teamId} className={`${i < 8 ? "qualified" : ""} ${r.teamId === season.userTeamId ? "mine" : ""}`}>
                <td className="muted">{i + 1}</td>
                <td className="name">
                  <span className="tag">{team.tag}</span>
                  {team.name}
                  {champion && <span className="crown"> ★</span>}
                </td>
                <td className="muted">{lineupRating(team)}</td>
                <td className="strong">{r.points}</td>
                <td>
                  {r.wins}-{r.losses}
                </td>
                <td className="muted">
                  {r.mapsWon}-{r.mapsLost}
                </td>
                {r.placements.map((p, j) => (
                  <td key={j} className={placeClass(p)}>
                    {p ?? "·"}
                  </td>
                ))}
                <td className={placeClass(r.champsPlacement)}>{r.champsPlacement ?? "·"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Top eight by points qualify for Champs. Qualifier wins are worth 10 points; Major placements 100 down to 10.</p>
    </div>
  );
}

function placeClass(p: number | null): string {
  if (p === null) return "muted";
  if (p === 1) return "place-1";
  if (p <= 3) return "place-podium";
  return "";
}

function StageBrowser({ season, currentStage, onOpen }: { season: Season; currentStage: number; onOpen: (f: Fixture) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const stage = picked ?? currentStage;
  const started = (i: number) => i <= currentStage;
  return (
    <div className="card">
      <div className="stage-tabs">
        {season.stages.map((s) => (
          <button key={s.index} className={s.index === stage ? "active" : ""} disabled={!started(s.index)} onClick={() => setPicked(s.index)}>
            {s.name}
          </button>
        ))}
      </div>
      <StagePanel season={season} stage={stage} onOpen={onOpen} />
    </div>
  );
}

function StagePanel({ season, stage, onOpen }: { season: Season; stage: number; onOpen: (f: Fixture) => void }) {
  const s = season.stages[stage];
  const bracket = season.fixtures.filter((f) => f.stage === stage && f.phase === "bracket");
  const bracketStarted = bracket.some((f) => f.result);
  if (s.kind === "major" && !s.groups) {
    return <p className="muted">Groups are drawn when the first qualifier week is played.</p>;
  }
  return (
    <div>
      {s.kind === "major" && (
        <div className="groups">
          {([0, 1] as const).map((g) => (
            <table key={g} className="group">
              <thead>
                <tr>
                  <th>Group {g === 0 ? "A" : "B"}</th>
                  <th>W-L</th>
                  <th>Maps</th>
                </tr>
              </thead>
              <tbody>
                {groupStandings(season, stage, g).map((r, i) => (
                  <tr key={r.teamId} className={i < 4 ? "qualified" : ""}>
                    <td className="name">{teamById(season, r.teamId).name}</td>
                    <td>
                      {r.wins}-{r.losses}
                    </td>
                    <td className="muted">
                      {r.mapsWon}-{r.mapsLost}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
      {(bracketStarted || s.kind === "champs") && (
        <div className="bracket">
          {bracket.map((f) => (
            <FixtureRow key={f.id} season={season} fixture={f} onOpen={onOpen} showRound />
          ))}
        </div>
      )}
    </div>
  );
}

function Calendar({ season, onOpen }: { season: Season; onOpen: (f: Fixture) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const target = currentRef.current ? currentRef.current.offsetTop - box.offsetTop - 8 : box.scrollHeight;
    box.scrollTo({ top: target, behavior: "smooth" });
  }, [season.currentDay]);

  return (
    <div className="card calendar">
      <h3 className="panel-title">Calendar</h3>
      <div className="calendar-scroll" ref={scrollRef}>
        {season.days.map((day) => {
          const status = day.day < season.currentDay ? "played" : day.day === season.currentDay ? "current" : "upcoming";
          return (
            <div key={day.day} className={`day ${status}`} ref={status === "current" ? currentRef : undefined}>
              <div className="day-head">
                <span className="muted small">Day {day.day + 1}</span>
                <strong>{day.label}</strong>
              </div>
              {fixturesForDay(season, day.day).map((f) => (
                <FixtureRow key={f.id} season={season} fixture={f} onOpen={onOpen} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FixtureRow({ season, fixture, onOpen, showRound = false }: { season: Season; fixture: Fixture; onOpen: (f: Fixture) => void; showRound?: boolean }) {
  const r = fixture.result;
  const home = describeRef(season, fixture.home);
  const away = describeRef(season, fixture.away);
  const cls = r ? (r.winner === 0 ? "home-win" : "away-win") : "pending";
  return (
    <button className={`fixture ${cls}`} disabled={!r} onClick={() => onOpen(fixture)}>
      {showRound && <span className="muted small round">{fixture.round}</span>}
      {fixture.group !== undefined && !showRound && <span className="muted small round">Group {fixture.group === 0 ? "A" : "B"}</span>}
      <span className="home">{home}</span>
      <span className="score">{r ? `${r.mapScore[0]} - ${r.mapScore[1]}` : "vs"}</span>
      <span className="away">{away}</span>
    </button>
  );
}
