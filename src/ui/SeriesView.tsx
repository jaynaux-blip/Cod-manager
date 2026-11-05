import { useEffect, useState } from "react";
import { MODE_LABEL, type SeriesResult } from "../engine";
import { MapDetail } from "./MapDetail";

export function SeriesView({ result }: { result: SeriesResult }) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [result]);
  const [a, b] = result.teams;
  const map = result.maps[selected];

  return (
    <div className="series-view">
      <div className="card scoreboard">
        <div className={`team-score ${result.winner === 0 ? "winner" : ""}`}>
          <span className="tag">{a.tag}</span>
          <span className="name">{a.name}</span>
          <span className="big">{result.mapScore[0]}</span>
        </div>
        <div className="vs muted">Series seed {result.seed}</div>
        <div className={`team-score right ${result.winner === 1 ? "winner" : ""}`}>
          <span className="big">{result.mapScore[1]}</span>
          <span className="name">{b.name}</span>
          <span className="tag">{b.tag}</span>
        </div>
      </div>

      <div className="map-tabs">
        {result.maps.map((m, i) => (
          <button key={i} className={`map-tab ${i === selected ? "active" : ""} w-${m.winner}`} onClick={() => setSelected(i)}>
            <span className="muted small">
              Map {i + 1} · {MODE_LABEL[m.mode]}
            </span>
            <span className="map-name">{m.map.name}</span>
            <span className="map-score">
              {m.score[0]} - {m.score[1]}
            </span>
          </button>
        ))}
      </div>

      <MapDetail key={`${result.seed}-${selected}`} result={map} teams={result.teams} />
    </div>
  );
}
