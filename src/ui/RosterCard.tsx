import { ATTRIBUTE_KEYS, overall, type AttributeKey, type Team } from "../engine";

const ATTR_LABEL: Record<AttributeKey, string> = {
  aim: "AIM",
  positioning: "POS",
  gameSense: "IQ",
  consistency: "CON",
  clutch: "CLU",
  comms: "COM",
};

interface Props {
  team: Team;
  side: 0 | 1;
  onAggression: (value: number) => void;
}

export function RosterCard({ team, side, onAggression }: Props) {
  const avg = Math.round(team.players.reduce((s, p) => s + overall(p), 0) / team.players.length);
  return (
    <div className={`card roster side-${side}`}>
      <div className="roster-head">
        <div>
          <span className="tag">{team.tag}</span>
          <h2>{team.name}</h2>
        </div>
        <div className="ovr">
          <span className="ovr-num">{avg}</span>
          <span className="muted small">OVR</span>
        </div>
      </div>
      <table className="players">
        <thead>
          <tr>
            <th>Player</th>
            <th>Role</th>
            <th>OVR</th>
            {ATTRIBUTE_KEYS.map((k) => (
              <th key={k} title={k}>
                {ATTR_LABEL[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {team.players.map((p) => (
            <tr key={p.id}>
              <td className="name">{p.name}</td>
              <td className="muted">{p.role}</td>
              <td className="strong">{overall(p)}</td>
              {ATTRIBUTE_KEYS.map((k) => (
                <td key={k} className={rating(p.attributes[k])}>
                  {p.attributes[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <label className="slider">
        <span>
          Aggression <strong>{team.tactics.aggression}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={team.tactics.aggression}
          onChange={(e) => onAggression(Number(e.target.value))}
        />
      </label>
    </div>
  );
}

function rating(v: number): string {
  if (v >= 85) return "r-elite";
  if (v >= 75) return "r-good";
  if (v >= 60) return "r-ok";
  return "r-low";
}
