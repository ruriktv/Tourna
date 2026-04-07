import { useEffect, useMemo, useRef, useState } from "react";
import {
  awardPoint,
  buildFormatLabel,
  clearTimer,
  createMatch,
  getCompletedGames,
  getCurrentDisplayOrder,
  getMatchSummary,
  issueCard,
  startCurrentSet,
  startTimer,
  undoPoint,
  updateMatchConfig,
  type Discipline,
  type MatchConfig,
  type MatchFormat,
  type MatchState,
  type Team,
} from "./domain/match";
import { buildExportPayload, exportMatchJson, exportMatchPdf } from "./exporters";

type WizardStep = 1 | 2 | 3;
type CoinResult = "heads" | "tails";

const FORMAT_OPTIONS: Array<{ value: MatchFormat; label: string }> = [
  { value: "best-of-3", label: "Best of 3" },
  { value: "best-of-5", label: "Best of 5" },
  { value: "best-of-7", label: "Best of 7" },
  { value: "casual", label: "Casual" },
];

function syncTeamName(team: Team, discipline: Discipline): Team {
  const visiblePlayers = team.players
    .slice(0, discipline === "doubles" ? 2 : 1)
    .map((player) => player.name.trim())
    .filter(Boolean);

  return {
    ...team,
    name: visiblePlayers.join(" / ") || (team.id === "team-a" ? "Team A" : "Team B"),
  };
}

function createDraftConfig(): MatchConfig {
  return {
    discipline: "singles",
    format: "best-of-5",
    initialServerTeamIndex: 0,
    initialServerPlayerId: "team-a-p1",
    initialReceiverPlayerId: "team-b-p1",
    initialLeftTeamIndex: 0,
    teams: [
      syncTeamName(
        {
          id: "team-a",
          name: "Player A",
          players: [
            { id: "team-a-p1", name: "Player A" },
            { id: "team-a-p2", name: "Partner A" },
          ],
        },
        "singles",
      ),
      syncTeamName(
        {
          id: "team-b",
          name: "Player B",
          players: [
            { id: "team-b-p1", name: "Player B" },
            { id: "team-b-p2", name: "Partner B" },
          ],
        },
        "singles",
      ),
    ],
  };
}

function getVisiblePlayerCount(discipline: Discipline) {
  return discipline === "doubles" ? 2 : 1;
}

function formatTimer(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getValidationErrors(config: MatchConfig): string[] {
  const errors: string[] = [];
  const playerCount = getVisiblePlayerCount(config.discipline);

  config.teams.forEach((team, teamIndex) => {
    team.players.slice(0, playerCount).forEach((player, playerIndex) => {
      if (!player.name.trim()) {
        errors.push(`Player ${playerIndex + 1} on side ${teamIndex + 1} is required.`);
      }
    });
  });

  return errors;
}

function playTimerAlert() {
  const audioContext = new window.AudioContext();
  const frequencies = [880, 988, 880];

  frequencies.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gainNode.gain.value = 0.06;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    const startAt = audioContext.currentTime + index * 0.22;
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.14);
  });

  window.setTimeout(() => {
    audioContext.close().catch(() => undefined);
  }, 1200);
}

function ProgressBar(props: { step: WizardStep }) {
  return (
    <div className="progress-bar" aria-label="Setup progress">
      {[1, 2, 3].map((step) => (
        <div key={step} className={`progress-step ${props.step === step ? "current" : props.step > step ? "done" : ""}`}>
          <span className="progress-dot" />
        </div>
      ))}
    </div>
  );
}

function AnimatedScore(props: { score: number }) {
  const previousScoreRef = useRef(props.score);
  const [trend, setTrend] = useState<"up" | "down" | "same">("same");

  useEffect(() => {
    if (props.score > previousScoreRef.current) {
      setTrend("up");
    } else if (props.score < previousScoreRef.current) {
      setTrend("down");
    } else {
      setTrend("same");
    }
    previousScoreRef.current = props.score;
  }, [props.score]);

  const isMilestone = props.score === 5 || props.score === 10;
  return (
    <span
      className={`score-number ${trend !== "same" ? `animate-${trend}` : ""} ${isMilestone ? "milestone-red" : ""}`}
    >
      {props.score}
    </span>
  );
}

function TapScoreButton(props: {
  score: number;
  onSingleTap: () => void;
  onDoubleTap: () => void;
  label: string;
  disabled?: boolean;
}) {
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  return (
    <button
      className="score-button"
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => {
        if (props.disabled) {
          return;
        }
        if (clickTimerRef.current !== null) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
          props.onDoubleTap();
          return;
        }

        clickTimerRef.current = window.setTimeout(() => {
          props.onSingleTap();
          clickTimerRef.current = null;
        }, 220);
      }}
    >
      <AnimatedScore score={props.score} />
    </button>
  );
}

function TimeoutIcon() {
  return null;
}

function MedicalIcon() {
  return null;
}

function CardIcon(props: { color: "yellow" | "red" | "neutral" }) {
  return <span className={`card-rect ${props.color}`} aria-hidden="true" />;
}

function SetStatComparison(props: { stats: Array<any> }) {
  if (props.stats.length < 2) {
    return null;
  }

  const left = props.stats[0];
  const right = props.stats[1];
  const rows = [
    ["Points won", String(left.winningPoints), String(right.winningPoints)],
    ["Serve win rate", `${left.serveWinningRate}%`, `${right.serveWinningRate}%`],
    ["Largest lead", formatLeadValue(left.largestLead), formatLeadValue(right.largestLead)],
    ["Longest run", String(left.longestWinningRun), String(right.longestWinningRun)],
    ["Yellow cards", String(left.yellowCards), String(right.yellowCards)],
    ["Red cards", String(left.redCards), String(right.redCards)],
    ["Timeout", left.timeoutUsed ? "Yes" : "No", right.timeoutUsed ? "Yes" : "No"],
    [
      "Medical",
      left.medicalTimeoutUsed ? "Yes" : "No",
      right.medicalTimeoutUsed ? "Yes" : "No",
    ],
  ];

  return (
    <div className="comparison-table">
      <div className="comparison-head right-align">{left.name}</div>
      <div className="comparison-head metric-col">Metric</div>
      <div className="comparison-head left-align">{right.name}</div>
      {rows.map(([metric, leftValue, rightValue]) => (
        <div className="comparison-row" key={metric}>
          <div className="comparison-cell right-align" key={`${metric}-left`}>
            {leftValue}
          </div>
          <div className="comparison-cell metric-col">
            {metric}
          </div>
          <div className="comparison-cell left-align">
            {rightValue}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildPolyline(points: Array<{ x: number; y: number }>) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function formatLeadValue(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : String(value);
}

function PointProgressChart(props: {
  title: string;
  points: Array<{
    pointNumber: number;
    cumulative: [number, number];
  }>;
  teamNames: [string, string];
  dividerMode?: "every-6" | "sets";
  setBoundaries?: number[];
  tickSize?: "normal" | "small";
}) {
  const width = 520;
  const height = 220;
  const padding = 24;
  const totalPoints = Math.max(props.points.length, 1);
  const maxScore = Math.max(
    1,
    ...props.points.flatMap((point) => [point.cumulative[0], point.cumulative[1]]),
  );
  const xTicks = Array.from({ length: totalPoints + 1 }, (_, index) => index);
  const yTicks = Array.from({ length: maxScore + 1 }, (_, index) => index);

  const projectX = (value: number) =>
    padding + ((width - padding * 2) * value) / Math.max(totalPoints, 1);
  const projectY = (value: number) =>
    height - padding - ((height - padding * 2) * value) / maxScore;

  const teamALine = [{ x: projectX(0), y: projectY(0) }].concat(
    props.points.map((point) => ({
      x: projectX(point.pointNumber),
      y: projectY(point.cumulative[0]),
    })),
  );
  const teamBLine = [{ x: projectX(0), y: projectY(0) }].concat(
    props.points.map((point) => ({
      x: projectX(point.pointNumber),
      y: projectY(point.cumulative[1]),
    })),
  );
  const setDividerPositions =
    props.dividerMode === "sets" ? (props.setBoundaries ?? []).filter((value) => value > 0 && value < totalPoints) : [];

  return (
    <div className="chart-block">
      <div className="chart-header">
        <strong>{props.title}</strong>
        <div className="chart-legend">
          <span className="legend-item">
            <span className="legend-swatch team-a" />
            {props.teamNames[0]}
          </span>
          <span className="legend-item">
            <span className="legend-swatch team-b" />
            {props.teamNames[1]}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="progress-chart" role="img" aria-label={props.title}>
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            {props.dividerMode !== "sets" ? (
              <line
                x1={projectX(tick)}
                y1={padding}
                x2={projectX(tick)}
                y2={height - padding}
                className={`chart-gridline vertical ${tick > 0 && tick % 6 === 0 ? `phase-break phase-${Math.floor(tick / 6) % 2}` : ""}`}
              />
            ) : null}
            <text
              x={projectX(tick)}
              y={height - 12}
              textAnchor="middle"
              className={`chart-tick ${props.tickSize === "small" ? "small" : ""}`}
            >
              {tick}
            </text>
          </g>
        ))}
        {setDividerPositions.map((tick, index) => (
          <line
            key={`set-divider-${tick}`}
            x1={projectX(tick)}
            y1={padding}
            x2={projectX(tick)}
            y2={height - padding}
            className={`chart-gridline vertical phase-break phase-${index % 2}`}
          />
        ))}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={padding}
              y1={projectY(tick)}
              x2={width - padding}
              y2={projectY(tick)}
              className="chart-gridline horizontal"
            />
            <text
              x={padding - 10}
              y={projectY(tick) + 4}
              textAnchor="end"
              className={`chart-tick ${props.tickSize === "small" ? "small" : ""}`}
            >
              {tick}
            </text>
          </g>
        ))}
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="chart-axis" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="chart-axis" />
        <polyline fill="none" strokeWidth="4" points={buildPolyline(teamALine)} className="chart-line team-a" />
        <polyline fill="none" strokeWidth="4" points={buildPolyline(teamBLine)} className="chart-line team-b" />
      </svg>
    </div>
  );
}

function buildMatchProgression(sets: Array<any>) {
  let running: [number, number] = [0, 0];

  return sets.flatMap((set: any) =>
    set.points.map((point: any, index: number) => {
      running = [
        running[0] + (point.wonBy === set.setStats[0].name ? 1 : 0),
        running[1] + (point.wonBy === set.setStats[1].name ? 1 : 0),
      ];
      return {
        pointNumber: running[0] + running[1],
        cumulative: [...running] as [number, number],
        setNumber: set.setNumber,
        pointInSet: index + 1,
      };
    }),
  );
}

function TeamRoleBadges(props: {
  team: Team;
  discipline: Discipline;
  serverId: string;
  receiverId: string;
  isWinner: boolean;
}) {
  return (
    <div className={`player-list ${props.isWinner ? "winner" : ""}`}>
      {props.team.players.slice(0, getVisiblePlayerCount(props.discipline)).map((player) => (
        <span className="player-chip" key={player.id}>
          <span className="player-chip-name">{player.name}</span>
          {player.id === props.serverId ? <span className="role-badge serve">Serve</span> : null}
          {player.id === props.receiverId ? <span className="role-badge receive">Receive</span> : null}
        </span>
      ))}
    </div>
  );
}

function MatchTimerModal(props: {
  match: MatchState;
  remainingSeconds: number;
  onClose: () => void;
}) {
  const kindLabel = props.match.activeTimer?.kind === "medical" ? "Medical timeout" : "Timeout";
  const isUrgent = props.remainingSeconds <= 10;
  const teamName =
    props.match.activeTimer !== null
      ? props.match.config.teams[props.match.activeTimer.teamIndex].name
      : "";

  return (
    <div className="timer-overlay" role="dialog" aria-modal="true" aria-label="Active timer">
      <div className="timer-modal">
        <span className="eyebrow">{kindLabel}</span>
        <h2>{teamName}</h2>
        <div className={`timer-value ${isUrgent ? "urgent" : ""}`}>{formatTimer(props.remainingSeconds)}</div>
        <button className="primary-button modal-action danger-button full-width" type="button" onClick={props.onClose}>
          Abort / clear timer?
        </button>
      </div>
    </div>
  );
}

function CoinModal(props: {
  coinResult: CoinResult | null;
  isFlipping: boolean;
  onFlip: () => void;
  onClose: () => void;
}) {
  const resultClass = props.coinResult ?? "heads";
  const coinClass = props.isFlipping ? `spinning ${resultClass}` : resultClass;
  const hasCompleted = props.coinResult !== null && !props.isFlipping;

  return (
    <div className="timer-overlay" role="dialog" aria-modal="true" aria-label="Coin toss">
      <div className="coin-modal">
        <span className="eyebrow">Coin toss</span>
        <div className={`coin ${coinClass}`}>
          <div className="coin-face black">
            <span>H</span>
          </div>
          <div className="coin-face red">
            <span>T</span>
          </div>
        </div>
        <div className="button-row center">
          <button
            className="primary-button modal-action full-width"
            type="button"
            onClick={hasCompleted ? props.onClose : props.onFlip}
            disabled={props.isFlipping}
          >
            {hasCompleted ? "Close" : "Toss coin"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [draftConfig, setDraftConfig] = useState<MatchConfig>(createDraftConfig);
  const [match, setMatch] = useState<MatchState>(() => createMatch(createDraftConfig()));
  const [now, setNow] = useState(() => Date.now());
  const [coinResult, setCoinResult] = useState<CoinResult | null>(null);
  const [isFlippingCoin, setIsFlippingCoin] = useState(false);
  const [showCoinModal, setShowCoinModal] = useState(true);
  const [hasPlayedTimerAlert, setHasPlayedTimerAlert] = useState(false);
  const [showWaterBreakModal, setShowWaterBreakModal] = useState(false);
  const [waterBreakEndsAt, setWaterBreakEndsAt] = useState<number | null>(null);
  const [waterBreakAlerted, setWaterBreakAlerted] = useState(false);
  const [showWarmupModal, setShowWarmupModal] = useState(true);
  const [warmupEndsAt, setWarmupEndsAt] = useState<number | null>(null);
  const [warmupAlerted, setWarmupAlerted] = useState(false);
  const [showMatchStatsModal, setShowMatchStatsModal] = useState(false);
  const previousCompletedSetsRef = useRef(0);

  const summary = useMemo(() => getMatchSummary(match), [match]);
  const completedSets = useMemo(() => getCompletedGames(match), [match]);
  const playerFacingDisplayOrder = useMemo(() => {
    const umpireOrder = getCurrentDisplayOrder(match);
    return [umpireOrder[1], umpireOrder[0]] as [0 | 1, 0 | 1];
  }, [match]);
  const validationErrors = useMemo(() => getValidationErrors(draftConfig), [draftConfig]);
  const exportPayload = useMemo(() => buildExportPayload(match), [match]);

  useEffect(() => {
    if (!match.activeTimer && waterBreakEndsAt === null && warmupEndsAt === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [match.activeTimer, warmupEndsAt, waterBreakEndsAt]);

  const activeTimerSeconds = match.activeTimer
    ? Math.max(0, Math.ceil((match.activeTimer.endsAt - now) / 1000))
    : 0;
  const waterBreakSeconds =
    waterBreakEndsAt !== null ? Math.max(0, Math.ceil((waterBreakEndsAt - now) / 1000)) : 60;
  const warmupSeconds =
    warmupEndsAt !== null ? Math.max(0, Math.ceil((warmupEndsAt - now) / 1000)) : 120;

  useEffect(() => {
    if (!match.activeTimer || activeTimerSeconds > 0 || hasPlayedTimerAlert) {
      return;
    }

    playTimerAlert();
    setHasPlayedTimerAlert(true);
  }, [activeTimerSeconds, hasPlayedTimerAlert, match.activeTimer]);

  useEffect(() => {
    if (match.activeTimer) {
      return;
    }
    setHasPlayedTimerAlert(false);
  }, [match.activeTimer]);

  useEffect(() => {
    if (waterBreakEndsAt === null || waterBreakSeconds > 0 || waterBreakAlerted) {
      return;
    }

    playTimerAlert();
    setWaterBreakAlerted(true);
  }, [waterBreakAlerted, waterBreakEndsAt, waterBreakSeconds]);

  useEffect(() => {
    if (waterBreakEndsAt === null) {
      setWaterBreakAlerted(false);
    }
  }, [waterBreakEndsAt]);

  useEffect(() => {
    if (warmupEndsAt === null || warmupSeconds > 0 || warmupAlerted) {
      return;
    }

    playTimerAlert();
    setWarmupAlerted(true);
  }, [warmupAlerted, warmupEndsAt, warmupSeconds]);

  useEffect(() => {
    if (warmupEndsAt === null) {
      setWarmupAlerted(false);
    }
  }, [warmupEndsAt]);

  useEffect(() => {
    const completedCount = completedSets.length;
    if (completedCount > previousCompletedSetsRef.current) {
      if (match.winnerTeamIndex !== null) {
        setShowMatchStatsModal(true);
      } else {
        setShowWaterBreakModal(true);
        setWaterBreakEndsAt(null);
      }
    }
    previousCompletedSetsRef.current = completedCount;
  }, [completedSets.length, match.winnerTeamIndex]);

  const visibleTeams = playerFacingDisplayOrder.map((teamIndex) => ({
    teamIndex,
    team: match.config.teams[teamIndex],
  }));
  const isMatchComplete = match.winnerTeamIndex !== null;
  const handleWarmupButton = () => {
    if (warmupEndsAt === null) {
      const startedAt = Date.now();
      setNow(startedAt);
      setWarmupEndsAt(startedAt + 120_000);
      return;
    }

    setShowWarmupModal(false);
    setWarmupEndsAt(null);
  };
  const handleWaterBreakButton = () => {
    if (waterBreakEndsAt === null) {
      const startedAt = Date.now();
      setNow(startedAt);
      setWaterBreakEndsAt(startedAt + 60_000);
      return;
    }

    setShowWaterBreakModal(false);
    setWaterBreakEndsAt(null);
  };
  const handleMatchTimerStart = (teamIndex: 0 | 1, kind: "standard" | "medical") => {
    const startedAt = Date.now();
    setNow(startedAt);
    setMatch((current) => startTimer(current, teamIndex, kind, startedAt));
  };

  const renderScoreSide = (entry: (typeof visibleTeams)[number]) => {
    const isWinner = match.winnerTeamIndex === entry.teamIndex;
    const currentGame = summary.currentGame;
    const timeoutUsed = match.games.some((game) =>
      game.timerEvents.some((event) => event.teamIndex === entry.teamIndex && event.kind === "standard"),
    );
    const medicalUsed = match.games.some((game) =>
      game.timerEvents.some((event) => event.teamIndex === entry.teamIndex && event.kind === "medical"),
    );

    return (
      <article className={`score-side mobile-first ${isWinner ? "is-winner" : ""}`} key={entry.team.id}>
        <header className="score-side-header">
          <TeamRoleBadges
            team={entry.team}
            discipline={match.config.discipline}
            serverId={summary.rotation.currentServer.id}
            receiverId={summary.rotation.currentReceiver.id}
            isWinner={isWinner}
          />
          {isWinner ? <span className="winner-mark">🏆</span> : null}
        </header>

        <TapScoreButton
          score={currentGame.points[entry.teamIndex]}
          label={`Score for ${entry.team.name}`}
          disabled={!summary.currentGame.startedAt && match.winnerTeamIndex === null}
          onSingleTap={() => setMatch((current) => awardPoint(current, entry.teamIndex, new Date()))}
          onDoubleTap={() => setMatch((current) => undoPoint(current, entry.teamIndex))}
        />

        <div className="icon-card-row">
          <button
            className={`icon-card plain timeout-card ${timeoutUsed ? "used" : ""}`}
            type="button"
            aria-label="Timeout"
            disabled={timeoutUsed}
            onClick={() => handleMatchTimerStart(entry.teamIndex, "standard")}
          >
            <CardIcon color="neutral" />
            <TimeoutIcon />
            <span className="card-caption">Timeout</span>
          </button>
          <button
            className={`icon-card plain medical-card ${medicalUsed ? "used" : ""}`}
            type="button"
            aria-label="Medical timeout"
            disabled={medicalUsed}
            onClick={() => handleMatchTimerStart(entry.teamIndex, "medical")}
          >
            <CardIcon color="neutral" />
            <MedicalIcon />
            <span className="card-caption">Medical</span>
          </button>
          <button
            className={`icon-card plain ${match.cards[entry.teamIndex].yellowWarning ? "used" : ""}`}
            type="button"
            aria-label="Yellow card"
            onClick={() => setMatch((current) => issueCard(current, entry.teamIndex, "yellow"))}
          >
            <CardIcon color="yellow" />
            <span className="card-caption">Yellow</span>
          </button>
          <button
            className={`icon-card plain ${match.cards[entry.teamIndex].redPenalties > 0 ? "used" : ""}`}
            type="button"
            aria-label="Red card"
            onClick={() => setMatch((current) => issueCard(current, entry.teamIndex, "red", new Date()))}
          >
            <CardIcon color="red" />
            <span className="card-caption">Red</span>
          </button>
        </div>
      </article>
    );
  };

  const currentPlayerCount = getVisiblePlayerCount(draftConfig.discipline);

  return (
    <main className="app-shell compact-shell">
      {wizardStep !== 3 ? <ProgressBar step={wizardStep} /> : null}

      {wizardStep === 1 ? (
        <section className="panel compact-panel">
          <div className="section-heading">
            <img className="brand-mark" src="/tourna-icon.svg" alt="Tourna icon" />
            <span className="eyebrow">Step 1</span>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Format</span>
              <select
                value={draftConfig.format}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    format: event.target.value as MatchFormat,
                  }))
                }
              >
                {FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Type</span>
              <select
                value={draftConfig.discipline}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    discipline: event.target.value as Discipline,
                    teams: current.teams.map((team) =>
                      syncTeamName(team, event.target.value as Discipline),
                    ) as [Team, Team],
                  }))
                }
              >
                <option value="singles">Singles</option>
                <option value="doubles">Doubles</option>
              </select>
            </label>
          </div>

          <div className="player-input-grid">
            {draftConfig.teams.map((team, teamIndex) => (
              <section className="player-group" key={team.id}>
                <span className="eyebrow">Side {teamIndex === 0 ? "A" : "B"}</span>
                {team.players.slice(0, currentPlayerCount).map((player, playerIndex) => (
                  <label className="field" key={player.id}>
                    <span>{draftConfig.discipline === "doubles" ? `Player ${playerIndex + 1}` : "Player name"}</span>
                    <input
                      required
                      value={player.name}
                      onChange={(event) => {
                        const players = team.players.map((candidate) =>
                          candidate.id === player.id ? { ...candidate, name: event.target.value } : candidate,
                        );
                        const updatedTeam = syncTeamName({ ...team, players }, draftConfig.discipline);
                        setDraftConfig((current) => ({
                          ...current,
                          teams:
                            teamIndex === 0
                              ? [updatedTeam, current.teams[1]]
                              : [current.teams[0], updatedTeam],
                        }));
                      }}
                    />
                  </label>
                ))}
              </section>
            ))}
          </div>

          {validationErrors.length > 0 ? (
            <div className="validation-box">
              {validationErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}

          <div className="button-row roomy-button-row">
            <button
              className="primary-button"
              type="button"
              disabled={validationErrors.length > 0}
              onClick={() => {
                setShowCoinModal(true);
                setCoinResult(null);
                setWizardStep(2);
              }}
            >
              Continue to table setup
            </button>
          </div>
        </section>
      ) : null}

      {wizardStep === 2 ? (
        <section className="panel compact-panel">
          <div className="section-heading">
            <img className="brand-mark" src="/tourna-icon.svg" alt="Tourna icon" />
            <span className="eyebrow">Step 2</span>
            {coinResult ? (
              <div className={`coin-result-badge ${coinResult}`}>
                {coinResult === "heads" ? "H" : "T"}
              </div>
            ) : null}
          </div>

          <div className="table-view polished">
            <div className="side-slot">
              <span className="table-label">Umpire-left</span>
              <button
                className="side-assigned"
                type="button"
                onClick={() =>
                  setDraftConfig((current) => ({
                    ...current,
                    initialLeftTeamIndex: 0,
                  }))
                }
              >
                {draftConfig.teams[draftConfig.initialLeftTeamIndex].name}
              </button>
            </div>
            <div className="table-surface improved">
              <div className="table-half" />
              <div className="table-half opposite" />
              <div className="table-net visible" />
              <div className="table-centerline" />
            </div>
            <div className="side-slot">
              <span className="table-label">Umpire-right</span>
              <button
                className="side-assigned"
                type="button"
                onClick={() =>
                  setDraftConfig((current) => ({
                    ...current,
                    initialLeftTeamIndex: 1,
                  }))
                }
              >
                {draftConfig.teams[draftConfig.initialLeftTeamIndex === 0 ? 1 : 0].name}
              </button>
            </div>
          </div>

          <div className="field-row">
            <label className="field">
              <span>First server</span>
              <select
                value={draftConfig.initialServerPlayerId}
                onChange={(event) => {
                  const playerId = event.target.value;
                  const serverTeamIndex = draftConfig.teams[0].players.some((player) => player.id === playerId)
                    ? 0
                    : 1;
                  const receiverTeamIndex = (serverTeamIndex === 0 ? 1 : 0) as 0 | 1;
                  setDraftConfig((current) => ({
                    ...current,
                    initialServerTeamIndex: serverTeamIndex,
                    initialServerPlayerId: playerId,
                    initialReceiverPlayerId: current.teams[receiverTeamIndex].players[0].id,
                  }));
                }}
              >
                {draftConfig.teams.map((team) =>
                  team.players.slice(0, currentPlayerCount).map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  )),
                )}
              </select>
            </label>
            <label className="field">
              <span>First receiver</span>
              <select
                value={draftConfig.initialReceiverPlayerId}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    initialReceiverPlayerId: event.target.value,
                  }))
                }
              >
                {draftConfig.teams
                  .filter(
                    (team) =>
                      !team.players.some((player) => player.id === draftConfig.initialServerPlayerId),
                  )
                  .flatMap((team) =>
                    team.players.slice(0, currentPlayerCount).map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    )),
                  )}
              </select>
            </label>
          </div>

          <div className="button-row roomy-button-row">
            <button className="secondary-button" type="button" onClick={() => setWizardStep(1)}>
              Back
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setMatch((current) => updateMatchConfig(current, draftConfig, new Date()));
                setShowWarmupModal(true);
                setWarmupEndsAt(null);
                setWizardStep(3);
              }}
            >
              Start match
            </button>
          </div>

          {showCoinModal ? (
            <CoinModal
              coinResult={coinResult}
              isFlipping={isFlippingCoin}
              onClose={() => setShowCoinModal(false)}
              onFlip={() => {
                if (isFlippingCoin) {
                  return;
                }
                const result = Math.random() > 0.5 ? "heads" : "tails";
                setIsFlippingCoin(true);
                setCoinResult(result);
                window.setTimeout(() => {
                  setIsFlippingCoin(false);
                }, 1400);
              }}
            />
          ) : null}
        </section>
      ) : null}

      {wizardStep === 3 ? (
        <section className="panel scoreboard-panel">
          <div className="scoreboard-toolbar">
            <div className="scoreboard-meta">
              <img className="brand-mark small" src="/tourna-icon.svg" alt="Tourna icon" />
              <span className="eyebrow">Live match</span>
            </div>
            <h1 className="scoreboard-title">
              Set {summary.currentGameIndex + 1} - {buildFormatLabel(match.config.format)}
            </h1>
            <div className="toolbar-actions">
              <button className="secondary-button" type="button" onClick={() => setShowMatchStatsModal(true)}>
                Stats
              </button>
              {isMatchComplete ? (
                <details className="export-menu">
                  <summary className="secondary-button">
                    Export <span className="dropdown-arrow">▾</span>
                  </summary>
                  <div className="export-popover">
                    <button type="button" onClick={() => exportMatchPdf(match)}>
                      PDF
                    </button>
                    <button type="button" onClick={() => exportMatchJson(match)}>
                      JSON
                    </button>
                  </div>
                </details>
              ) : (
                <button className="secondary-button" type="button" disabled aria-disabled="true">
                  Export <span className="dropdown-arrow">▾</span>
                </button>
              )}
            </div>
          </div>

          <div className="arena-layout compact-arena">
            {renderScoreSide(visibleTeams[0])}
            <section className="set-strip in-arena" aria-label="Sets won">
              {!summary.currentGame.startedAt && match.winnerTeamIndex === null ? (
                <div className="start-set-banner in-arena">
                  <button
                    className="primary-button start-set-button"
                    type="button"
                    onClick={() => setMatch((current) => startCurrentSet(current, new Date()))}
                  >
                    Start set
                  </button>
                </div>
              ) : null}
              <div className="set-card small">
                <AnimatedScore score={match.setsWon[visibleTeams[0].teamIndex]} />
              </div>
              <div className="set-card small">
                <AnimatedScore score={match.setsWon[visibleTeams[1].teamIndex]} />
              </div>
              <div className="set-strip-center">
                {summary.currentGame.winnerTeamIndex === null && summary.isDeuce ? (
                  <span className="deuce-pill">
                    {summary.currentGame.points[0] === summary.currentGame.points[1] ? "Deuce" : "Advanced"}
                  </span>
                ) : null}
              </div>
            </section>
            {renderScoreSide(visibleTeams[1])}
          </div>

          <section className="history-card compact-history">
            <span className="eyebrow">Set history</span>
            <ul className="history-list">
              {completedSets.length === 0 ? (
                <li>No completed sets yet.</li>
              ) : (
                completedSets.map((game, index) => (
                  <li key={`${game.points.join("-")}-${index}`}>
                    <strong>Set {index + 1}</strong>
                    <span>
                      {game.points[0]} - {game.points[1]}
                    </span>
                    <span className="winner-text">
                      {game.winnerTeamIndex !== null ? match.config.teams[game.winnerTeamIndex].name : "Unknown"}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>

          {match.activeTimer ? (
            <MatchTimerModal
              match={match}
              remainingSeconds={activeTimerSeconds}
              onClose={() => {
                const confirmed = window.confirm("Abort and clear this timer?");
                if (!confirmed) {
                  return;
                }
                setMatch((current) => clearTimer(current));
              }}
            />
          ) : null}

          {showWarmupModal ? (
            <div className="timer-overlay" role="dialog" aria-modal="true" aria-label="Warm-up">
              <div className="timer-modal">
                <span className="eyebrow">Warm-up</span>
                <div className={`timer-value ${warmupSeconds > 0 && warmupSeconds <= 10 ? "urgent" : ""}`}>
                  {formatTimer(warmupSeconds)}
                </div>
                <div className="button-row center">
                  <button className="primary-button modal-action full-width" type="button" onClick={handleWarmupButton}>
                    {warmupEndsAt === null ? "Start" : "Clear"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showWaterBreakModal ? (
            <div className="timer-overlay" role="dialog" aria-modal="true" aria-label="Water break">
              <div className="timer-modal">
                <div className="modal-topbar">
                  <span className="eyebrow">Water break</span>
                  <button className="primary-button modal-action corner-action" type="button" onClick={handleWaterBreakButton}>
                    {waterBreakEndsAt === null ? "Start" : "Clear"}
                  </button>
                </div>
                <div className={`timer-value ${waterBreakSeconds > 0 && waterBreakSeconds <= 10 ? "urgent" : ""}`}>
                  {formatTimer(waterBreakSeconds)}
                </div>
                {exportPayload.sets.length > 0 ? (
                  <>
                    <SetStatComparison stats={exportPayload.sets[exportPayload.sets.length - 1].setStats} />
                    <PointProgressChart
                      title={`Set ${exportPayload.sets[exportPayload.sets.length - 1].setNumber} point progression`}
                      points={exportPayload.sets[exportPayload.sets.length - 1].points}
                      teamNames={[
                        exportPayload.stats[0].name,
                        exportPayload.stats[1].name,
                      ]}
                      dividerMode="every-6"
                    />
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {showMatchStatsModal ? (
            <div className="timer-overlay" role="dialog" aria-modal="true" aria-label="Match stats">
              <div className="timer-modal wide">
                <span className="eyebrow">Match complete</span>
                <h2>{match.winnerTeamIndex !== null ? `${match.config.teams[match.winnerTeamIndex].name} wins` : "Match stats"}</h2>
                <div className="comparison-table match-stats">
                  <div className="comparison-head right-align">{exportPayload.stats[0].name}</div>
                  <div className="comparison-head metric-col">Metric</div>
                  <div className="comparison-head left-align">{exportPayload.stats[1].name}</div>
                  {[
                    ["Sets won", String(exportPayload.stats[0].setsWon), String(exportPayload.stats[1].setsWon)],
                    ["Winning points", String(exportPayload.stats[0].totalWinningPoints), String(exportPayload.stats[1].totalWinningPoints)],
                    ["Serve win rate", `${exportPayload.stats[0].serveWinningRate}%`, `${exportPayload.stats[1].serveWinningRate}%`],
                    ["Largest lead", formatLeadValue(exportPayload.stats[0].largestLead), formatLeadValue(exportPayload.stats[1].largestLead)],
                    ["Longest run", String(exportPayload.stats[0].longestWinningRun), String(exportPayload.stats[1].longestWinningRun)],
                    ["Yellow cards", String(exportPayload.stats[0].yellowCards), String(exportPayload.stats[1].yellowCards)],
                    ["Red cards", String(exportPayload.stats[0].redCards), String(exportPayload.stats[1].redCards)],
                  ].map(([metric, leftValue, rightValue]) => (
                    <div className="comparison-row" key={metric}>
                      <div className="comparison-cell right-align">{leftValue}</div>
                      <div className="comparison-cell metric-col">{metric}</div>
                      <div className="comparison-cell left-align">{rightValue}</div>
                    </div>
                  ))}
                </div>
                <PointProgressChart
                  title="Full match point progression"
                  points={buildMatchProgression(exportPayload.sets)}
                  teamNames={[exportPayload.stats[0].name, exportPayload.stats[1].name]}
                  dividerMode="sets"
                  tickSize="small"
                  setBoundaries={exportPayload.sets.reduce<number[]>((boundaries, set) => {
                    const prior = boundaries[boundaries.length - 1] ?? 0;
                    boundaries.push(prior + set.points.length);
                    return boundaries;
                  }, [])}
                />
                <div className="button-row center">
                  <button className="primary-button modal-action" type="button" onClick={() => setShowMatchStatsModal(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
