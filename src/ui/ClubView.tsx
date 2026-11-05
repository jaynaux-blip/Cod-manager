import { useMemo, useState } from "react";
import {
  benchPlayer,
  buyoutCost,
  callUpAcademyPlayer,
  CONTRACT_RULES,
  EXPENSE_KINDS,
  extendContract,
  extensionAsk,
  fitsUnderCap,
  freeAgentAsk,
  INCOME_KINDS,
  isFinished,
  LEDGER_LABEL,
  marketValue,
  money,
  nextSeasonPayroll,
  nextSeasonSalary,
  overall,
  payroll,
  projectedBalance,
  releasePlayer,
  rosterLocked,
  rosterOf,
  signFreeAgent,
  startPlayer,
  summarize,
  teamById,
  type Player,
  type Role,
  type Season,
  type Team,
  type TxResult,
} from "../engine";

interface Props {
  season: Season;
  setSeason: (s: Season) => void;
}

type Negotiation = { kind: "sign" | "extend"; playerId: string };

export function ClubView({ season, setSeason }: Props) {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [negotiation, setNegotiation] = useState<Negotiation | null>(null);

  if (!season.userTeamId) return <div className="card">Pick a club to manage on the Season tab.</div>;
  const team = teamById(season, season.userTeamId);
  const offseason = isFinished(season);
  const locked = rosterLocked(season);

  const apply = (r: TxResult) => {
    if (r.ok) {
      setSeason(r.season);
      setNegotiation(null);
      setNotice({ ok: true, text: r.message });
    } else {
      setNotice({ ok: false, text: r.reason });
    }
  };

  return (
    <div className="club">
      <ClubHeader season={season} team={team} />
      <div className={`notice ${locked ? "warn" : offseason ? "info" : "muted-notice"}`}>
        {locked
          ? "Rosters are locked for Champs. You can still change the lineup and agree extensions."
          : offseason
            ? `Offseason. Extend final-year players now or they leave when season ${season.year + 1} starts. AI clubs sign free agents on the first match day, so you get first pick.`
            : "Transfer window open. Mid-season signings are paid only for the match days that remain."}
      </div>
      {notice && (
        <div className={`notice ${notice.ok ? "ok" : "err"}`} onClick={() => setNotice(null)}>
          {notice.text}
        </div>
      )}
      <div className="club-grid">
        <div className="club-left">
          <RosterPanel
            season={season}
            team={team}
            negotiation={negotiation}
            setNegotiation={setNegotiation}
            apply={apply}
          />
          <FreeAgentPanel
            season={season}
            team={team}
            negotiation={negotiation}
            setNegotiation={setNegotiation}
            apply={apply}
          />
        </div>
        <div className="club-right">
          <FinancePanel season={season} team={team} />
          <LeagueMoneyPanel season={season} />
        </div>
      </div>
    </div>
  );
}

function ClubHeader({ season, team }: { season: Season; team: Team }) {
  const fin = season.finances[team.id];
  const offseason = isFinished(season);
  const pay = offseason ? nextSeasonPayroll(team) : payroll(team);
  const capPct = Math.min(100, (pay / CONTRACT_RULES.salaryCap) * 100);
  const daysLeft = season.days.length - season.currentDay;
  const projected = projectedBalance(team, fin, daysLeft, season.days.length);
  return (
    <div className="card club-head">
      <div className="club-title">
        <span className="tag">{team.tag}</span>
        <h2>{team.name}</h2>
        <span className="muted small">Season {season.year}</span>
      </div>
      <div className="club-stats">
        <Stat label="Balance" value={money(fin.balance)} tone={fin.balance < 0 ? "bad" : undefined} />
        <Stat
          label={offseason ? "Season closed" : "Projected at season end"}
          value={offseason ? "-" : money(projected)}
          hint={offseason ? undefined : "Before any further prize money"}
          tone={projected < 0 ? "bad" : undefined}
        />
        <Stat label="Prestige" value={`${fin.prestige}`} hint="Drives sponsors and how cheaply players sign" />
        <Stat label="Fans" value={`${Math.round(fin.fans)}k`} hint="Drives merch and viewership" />
        <Stat label="Roster" value={`${rosterOf(team).length} / ${CONTRACT_RULES.rosterMax}`} />
      </div>
      <div className="cap">
        <div className="cap-label">
          <span>{offseason ? "Next season payroll" : "Payroll"}</span>
          <span>
            <strong>{money(pay)}</strong> <span className="muted">of {money(CONTRACT_RULES.salaryCap)} cap</span>
          </span>
        </div>
        <div className="cap-bar">
          <div className={`cap-fill ${capPct > 95 ? "full" : ""}`} style={{ width: `${capPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <div className="stat" title={hint}>
      <span className="muted small">{label}</span>
      <span className={`stat-value ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

interface PanelProps {
  season: Season;
  team: Team;
  negotiation: Negotiation | null;
  setNegotiation: (n: Negotiation | null) => void;
  apply: (r: TxResult) => void;
}

function contractLabel(p: Player, offseason: boolean): string {
  const c = p.contract;
  if (!c) return "-";
  const left = offseason ? c.years - 1 : c.years;
  const ext = c.extension ? ` · extended ${c.extension.years}y at ${money(c.extension.salary)}` : "";
  if (left <= 0) {
    return c.extension
      ? `Extended: ${c.extension.years} ${c.extension.years === 1 ? "season" : "seasons"} at ${money(c.extension.salary)}`
      : "Expiring";
  }
  if (left === 1 && !offseason) return `Final season${ext}`;
  return `${left} ${left === 1 ? "season" : "seasons"}${ext}`;
}

function RosterPanel({ season, team, negotiation, setNegotiation, apply }: PanelProps) {
  const offseason = isFinished(season);
  const locked = rosterLocked(season);
  const [confirmRelease, setConfirmRelease] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<Record<string, string>>({});
  const lineupFull = team.players.length >= CONTRACT_RULES.lineupSize;

  const row = (p: Player, starter: boolean) => {
    const c = p.contract;
    const canExtend = c?.years === 1 && !c.extension;
    const cost = buyoutCost(season, p);
    const negotiating = negotiation?.kind === "extend" && negotiation.playerId === p.id;
    const swapChoice = team.players.some((s) => s.id === swapFor[p.id]) ? swapFor[p.id] : "";
    return (
      <tbody key={p.id}>
        <tr className={starter ? "" : "bench-row"}>
          <td className="name">{p.name}</td>
          <td className="muted">{p.role}</td>
          <td className="muted">{p.age}</td>
          <td className="strong">{overall(p)}</td>
          <td className="muted">{money(marketValue(p))}</td>
          <td>{c ? money(c.salary) : "-"}</td>
          <td className={c?.years === 1 && !c.extension ? "expiring" : c?.extension ? "extended" : "muted"}>{contractLabel(p, offseason)}</td>
          <td className="actions">
            {starter ? (
              <button className="sm" onClick={() => apply(benchPlayer(season, team.id, p.id))}>
                Bench
              </button>
            ) : lineupFull ? (
              <span className="swap">
                <select value={swapChoice} onChange={(e) => setSwapFor({ ...swapFor, [p.id]: e.target.value })}>
                  <option value="">Swap for…</option>
                  {team.players.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button className="sm" disabled={!swapChoice} onClick={() => apply(startPlayer(season, team.id, p.id, swapChoice))}>
                  Start
                </button>
              </span>
            ) : (
              <button className="sm" onClick={() => apply(startPlayer(season, team.id, p.id))}>
                Start
              </button>
            )}
            {canExtend && (
              <button className="sm" onClick={() => setNegotiation(negotiating ? null : { kind: "extend", playerId: p.id })}>
                Extend
              </button>
            )}
            {confirmRelease === p.id ? (
              <button
                className="sm danger"
                onClick={() => {
                  setConfirmRelease(null);
                  apply(releasePlayer(season, team.id, p.id));
                }}
              >
                Confirm {cost > 0 ? money(cost) : "release"}
              </button>
            ) : (
              <button className="sm" disabled={locked} onClick={() => setConfirmRelease(p.id)}>
                Release{cost > 0 ? ` (${money(cost)})` : ""}
              </button>
            )}
          </td>
        </tr>
        {negotiating && (
          <tr>
            <td colSpan={8}>
              <NegotiationForm
                season={season}
                team={team}
                player={p}
                kind="extend"
                onCancel={() => setNegotiation(null)}
                onOffer={(offer) => apply(extendContract(season, team.id, p.id, offer))}
              />
            </td>
          </tr>
        )}
      </tbody>
    );
  };

  return (
    <div className="card">
      <h3 className="panel-title">Roster</h3>
      <table className="roster-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Role</th>
            <th>Age</th>
            <th>OVR</th>
            <th title="What the player is worth on the open market">Value</th>
            <th>Salary</th>
            <th>Contract</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr className="section-row">
            <td colSpan={8}>Lineup ({team.players.length}/4)</td>
          </tr>
        </tbody>
        {team.players.map((p) => row(p, true))}
        <tbody>
          <tr className="section-row">
            <td colSpan={8}>Bench ({team.bench.length})</td>
          </tr>
          {team.bench.length === 0 && (
            <tr>
              <td colSpan={8} className="muted small">
                No substitutes. Sign a free agent to add depth.
              </td>
            </tr>
          )}
        </tbody>
        {team.bench.map((p) => row(p, false))}
        {rosterOf(team).length < CONTRACT_RULES.lineupSize && (
          <tbody>
            <tr>
              <td colSpan={8}>
                <div className="academy">
                  <span>
                    The club cannot field four. Sign a free agent, or call up an academy player at the league minimum. Call-ups are
                    allowed even in debt.
                  </span>
                  <button className="sm primary" onClick={() => apply(callUpAcademyPlayer(season, team.id))}>
                    Call up academy player ({money(CONTRACT_RULES.minSalary)})
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}

const ROLE_FILTERS: (Role | "All")[] = ["All", "AR", "SMG", "Flex"];

function FreeAgentPanel({ season, team, negotiation, setNegotiation, apply }: PanelProps) {
  const [role, setRole] = useState<Role | "All">("All");
  const locked = rosterLocked(season);
  const full = rosterOf(team).length >= CONTRACT_RULES.rosterMax;
  const agents = useMemo(
    () =>
      season.freeAgents
        .filter((p) => role === "All" || p.role === role)
        .slice()
        .sort((a, b) => overall(b) - overall(a)),
    [season.freeAgents, role],
  );

  return (
    <div className="card">
      <div className="panel-head">
        <h3 className="panel-title">Free agents ({season.freeAgents.length})</h3>
        <div className="chips">
          {ROLE_FILTERS.map((r) => (
            <button key={r} className={`chip ${role === r ? "active" : ""}`} onClick={() => setRole(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {full && <p className="muted small">Your roster is full. Release a player to make room.</p>}
      <table className="roster-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Role</th>
            <th>Age</th>
            <th>OVR</th>
            <th>AIM</th>
            <th>POS</th>
            <th>IQ</th>
            <th title="Asking salary for a one-season deal with your club">Asking</th>
            <th />
          </tr>
        </thead>
        {agents.map((p) => {
          const negotiating = negotiation?.kind === "sign" && negotiation.playerId === p.id;
          return (
            <tbody key={p.id}>
              <tr>
                <td className="name">
                  {p.name}
                  {p.id.startsWith("rk-") && <span className="badge">Rookie</span>}
                </td>
                <td className="muted">{p.role}</td>
                <td className="muted">{p.age}</td>
                <td className="strong">{overall(p)}</td>
                <td className="muted">{p.attributes.aim}</td>
                <td className="muted">{p.attributes.positioning}</td>
                <td className="muted">{p.attributes.gameSense}</td>
                <td>{money(freeAgentAsk(season, team.id, p, 1))}</td>
                <td className="actions">
                  <button
                    className="sm"
                    disabled={locked || full}
                    onClick={() => setNegotiation(negotiating ? null : { kind: "sign", playerId: p.id })}
                  >
                    Negotiate
                  </button>
                </td>
              </tr>
              {negotiating && (
                <tr>
                  <td colSpan={9}>
                    <NegotiationForm
                      season={season}
                      team={team}
                      player={p}
                      kind="sign"
                      onCancel={() => setNegotiation(null)}
                      onOffer={(offer) => apply(signFreeAgent(season, team.id, p.id, offer))}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

function NegotiationForm({
  season,
  team,
  player,
  kind,
  onOffer,
  onCancel,
}: {
  season: Season;
  team: Team;
  player: Player;
  kind: "sign" | "extend";
  onOffer: (offer: { salary: number; years: number }) => void;
  onCancel: () => void;
}) {
  const askFor = (years: number) =>
    kind === "sign" ? freeAgentAsk(season, team.id, player, years) : extensionAsk(season, team.id, player, years);
  const [years, setYears] = useState(1);
  const [salary, setSalary] = useState(() => askFor(1));
  const ask = askFor(years);
  const offseason = isFinished(season);

  // Which payroll the deal is judged against: next season's for extensions and offseason signings.
  const base =
    kind === "extend" ? nextSeasonPayroll(team) - nextSeasonSalary(player) : offseason ? nextSeasonPayroll(team) : payroll(team);
  const fits = fitsUnderCap(base, salary);
  const yearsLabel =
    kind === "extend" ? "Extra seasons after this deal" : offseason ? "Seasons, from next season" : "Seasons, including this one";

  return (
    <div className="negotiation">
      <div className="neg-line">
        <strong>{kind === "sign" ? `Offer to ${player.name}` : `Extend ${player.name}`}</strong>
        <span className="muted small">
          Asking {money(ask)} for {years} {years === 1 ? "season" : "seasons"}
          {kind === "extend" ? ", with a loyalty discount" : ""}
        </span>
      </div>
      <div className="neg-line">
        <label>
          {yearsLabel}
          <select
            value={years}
            onChange={(e) => {
              const y = Number(e.target.value);
              setYears(y);
              setSalary(askFor(y));
            }}
          >
            {Array.from({ length: CONTRACT_RULES.maxYears }, (_, i) => i + 1).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label>
          Salary per season
          <input
            type="number"
            step={5_000}
            min={CONTRACT_RULES.minSalary}
            max={CONTRACT_RULES.maxSalary}
            value={salary}
            onChange={(e) => setSalary(Number(e.target.value))}
          />
        </label>
        <span className={`small ${fits ? "muted" : "bad"}`}>
          {kind === "extend" || offseason ? "Next season payroll" : "Payroll"} after: {money(base + salary)}
          {fits ? "" : " (over the cap)"}
        </span>
        <span className={`small ${salary >= ask ? "good" : "bad"}`}>{salary >= ask ? "Likely to accept" : "Below asking"}</span>
        <button className="primary sm" onClick={() => onOffer({ salary, years })}>
          Make offer
        </button>
        <button className="sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FinancePanel({ season, team }: { season: Season; team: Team }) {
  const fin = season.finances[team.id];
  const summary = summarize(fin, season.year);
  const notable = fin.ledger.filter((e) => e.kind === "prize" || e.kind === "buyout").slice(-8).reverse();
  return (
    <div className="card">
      <h3 className="panel-title">Season {season.year} finances</h3>
      <table className="money-table">
        <tbody>
          {INCOME_KINDS.map((k) => (
            <tr key={k}>
              <td>{LEDGER_LABEL[k]}</td>
              <td className="good">{money(summary.byKind[k])}</td>
            </tr>
          ))}
          <tr className="subtotal">
            <td>Income</td>
            <td>{money(summary.income)}</td>
          </tr>
          {EXPENSE_KINDS.map((k) => (
            <tr key={k}>
              <td>{LEDGER_LABEL[k]}</td>
              <td className={summary.byKind[k] < 0 ? "bad" : "muted"}>{money(summary.byKind[k])}</td>
            </tr>
          ))}
          <tr className="subtotal">
            <td>Costs</td>
            <td>{money(summary.expenses)}</td>
          </tr>
          <tr className="total">
            <td>Net this season</td>
            <td className={summary.net >= 0 ? "good" : "bad"}>{money(summary.net)}</td>
          </tr>
        </tbody>
      </table>
      {notable.length > 0 && (
        <>
          <h4 className="sub-title">Prize money and buyouts</h4>
          <ul className="ledger">
            {notable.map((e, i) => (
              <li key={i}>
                <span className="muted small">S{e.year}</span>
                <span>{e.note}</span>
                <span className={e.amount >= 0 ? "good" : "bad"}>{money(e.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LeagueMoneyPanel({ season }: { season: Season }) {
  const offseason = isFinished(season);
  const rows = season.teams
    .map((t) => ({ t, fin: season.finances[t.id], pay: offseason ? nextSeasonPayroll(t) : payroll(t) }))
    .sort((a, b) => b.fin.balance - a.fin.balance);
  return (
    <div className="card">
      <h3 className="panel-title">League finances</h3>
      <table className="league-money">
        <thead>
          <tr>
            <th>Club</th>
            <th>Payroll</th>
            <th>Balance</th>
            <th title="Prestige">Pres.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, fin, pay }) => (
            <tr key={t.id} className={t.id === season.userTeamId ? "mine" : ""}>
              <td className="name">
                <span className="tag">{t.tag}</span>
                {t.name}
              </td>
              <td>{money(pay)}</td>
              <td className={fin.balance < 0 ? "bad" : ""}>{money(fin.balance)}</td>
              <td className="muted">{fin.prestige}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
