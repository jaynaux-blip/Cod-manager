import { useState } from "react";
import { MODE_LABEL, type EventKind, type MapResult, type Team } from "../engine";

const KEY_KINDS = new Set<EventKind>(["map_start", "map_end", "rotation", "break", "round_start", "round_end", "plant", "defuse", "capture", "clutch"]);

interface Props {
  result: MapResult;
  teams: [Team, Team];
}

export function MapDetail({ result, teams }: Props) {
  const [showKills, setShowKills] = useState(false);
  const events = showKills ? result.events : result.events.filter((e) => KEY_KINDS.has(e.kind));
  const roundBased = result.mode !== "hardpoint";

  return (
    <div className="map-detail">
      <div className="card log">
        <div className="log-head">
          <h3>
            {MODE_LABEL[result.mode]} · {result.map.name}
            <span className="muted small"> · {Math.round(result.durationSec / 60)} min of game time</span>
          </h3>
          <label className="toggle">
            <input type="checkbox" checked={showKills} onChange={(e) => setShowKills(e.target.checked)} />
            Show every kill
          </label>
        </div>
        <ol className="events">
          {events.map((e, i) => (
            <li key={i} className={`ev ev-${e.kind} ${e.team !== undefined ? `t-${e.team}` : ""}`}>
              <span className="ev-time">{roundBased && e.round !== undefined ? `R${e.round} ` : ""}{fmt(e.t)}</span>
              <span className="ev-text">{e.text}</span>
              <span className="ev-score">
                {e.score[0]}-{e.score[1]}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="boxscores">
        {teams.map((team, i) => (
          <div key={team.id} className={`card box side-${i}`}>
            <h4>
              <span className="tag">{team.tag}</span> {team.name}
            </h4>
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>K</th>
                  <th>D</th>
                  <th>K/D</th>
                  {result.mode === "snd" && (
                    <>
                      <th>Plants</th>
                      <th>Defuses</th>
                      <th>Clutches</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {team.players.map((p) => {
                  const s = result.stats[p.id];
                  return (
                    <tr key={p.id}>
                      <td className="name">{p.name}</td>
                      <td>{s.kills}</td>
                      <td>{s.deaths}</td>
                      <td className="strong">{(s.kills / Math.max(1, s.deaths)).toFixed(2)}</td>
                      {result.mode === "snd" && (
                        <>
                          <td>{s.plants}</td>
                          <td>{s.defuses}</td>
                          <td>{s.clutches}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
