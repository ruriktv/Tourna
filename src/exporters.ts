import { jsPDF } from "jspdf";
import { getCompletedGames, getVisiblePlayerCountForExport, type GameState, type MatchState } from "./domain/match";

function formatLocalDate(dateString: string | null) {
  if (!dateString) {
    return "In progress";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateString));
}

function formatDurationMs(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatLeadValue(value: number | null) {
  return value === null ? "-" : String(value);
}

function calculateLargestLead(game: GameState, teamIndex: 0 | 1) {
  let largest = 0;

  game.pointHistory.forEach((event) => {
    const margin =
      teamIndex === 0 ? event.scoreAfter[0] - event.scoreAfter[1] : event.scoreAfter[1] - event.scoreAfter[0];
    if (margin > 0) {
      largest = Math.max(largest, margin);
    }
  });

  return largest > 0 ? largest : null;
}

function calculateLongestRun(game: GameState, teamIndex: 0 | 1) {
  let best = 0;
  let current = 0;

  game.pointHistory.forEach((event) => {
    if (event.winnerTeamIndex === teamIndex) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  });

  return best;
}

function calculateServeWinRate(state: MatchState, teamIndex: 0 | 1) {
  const points = getCompletedGames(state).flatMap((game) => game.pointHistory);
  const servedPoints = points.filter((event) => event.serverTeamIndex === teamIndex);
  if (servedPoints.length === 0) {
    return 0;
  }

  const wonOnServe = servedPoints.filter((event) => event.winnerTeamIndex === teamIndex).length;
  return (wonOnServe / servedPoints.length) * 100;
}

function calculateTotalWinningPoints(state: MatchState, teamIndex: 0 | 1) {
  return getCompletedGames(state).reduce(
    (total, game) => total + game.pointHistory.filter((event) => event.winnerTeamIndex === teamIndex).length,
    0,
  );
}

function buildPointProgression(game: GameState, teamNames: [string, string]) {
  let cumulative: [number, number] = [0, 0];

  return game.pointHistory.map((event, index) => {
    cumulative = [
      cumulative[0] + (event.winnerTeamIndex === 0 ? 1 : 0),
      cumulative[1] + (event.winnerTeamIndex === 1 ? 1 : 0),
    ];

    return {
      pointNumber: index + 1,
      wonBy: teamNames[event.winnerTeamIndex],
      scoreAfter: event.scoreAfter,
      cumulative,
      at: event.at,
    };
  });
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

function ensurePage(doc: jsPDF, y: number, requiredHeight: number) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + requiredHeight <= pageHeight - 16) {
    return y;
  }

  doc.addPage();
  return 20;
}

function drawProgressionChart(
  doc: jsPDF,
  title: string,
  points: Array<{ pointNumber: number; cumulative: [number, number] }>,
  teamNames: [string, string],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const totalPoints = Math.max(points.length, 1);
  const maxScore = Math.max(1, ...points.flatMap((point) => [point.cumulative[0], point.cumulative[1]]));
  const left = x + 10;
  const right = x + width - 6;
  const top = y + 10;
  const bottom = y + height - 10;
  const chartWidth = right - left;
  const chartHeight = bottom - top;
  const projectX = (value: number) => left + (chartWidth * value) / Math.max(totalPoints, 1);
  const projectY = (value: number) => bottom - (chartHeight * value) / maxScore;
  const teamAPoints = [{ x: projectX(0), y: projectY(0) }].concat(
    points.map((point) => ({ x: projectX(point.pointNumber), y: projectY(point.cumulative[0]) })),
  );
  const teamBPoints = [{ x: projectX(0), y: projectY(0) }].concat(
    points.map((point) => ({ x: projectX(point.pointNumber), y: projectY(point.cumulative[1]) })),
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(title, x, y);

  doc.setDrawColor(210, 220, 228);
  for (let tick = 0; tick <= totalPoints; tick += 1) {
    const xPos = projectX(tick);
    doc.setLineDashPattern([1, 2], 0);
    doc.line(xPos, top, xPos, bottom);
  }
  for (let tick = 0; tick <= maxScore; tick += 1) {
    const yPos = projectY(tick);
    doc.setLineDashPattern([1, 2], 0);
    doc.line(left, yPos, right, yPos);
  }
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(120, 132, 146);
  doc.line(left, top, left, bottom);
  doc.line(left, bottom, right, bottom);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  for (let tick = 0; tick <= totalPoints; tick += 1) {
    doc.text(String(tick), projectX(tick), bottom + 4, { align: "center" });
  }
  for (let tick = 0; tick <= maxScore; tick += 1) {
    doc.text(String(tick), left - 3, projectY(tick) + 2, { align: "right" });
  }

  doc.setDrawColor(255, 111, 97);
  for (let index = 1; index < teamAPoints.length; index += 1) {
    doc.line(teamAPoints[index - 1].x, teamAPoints[index - 1].y, teamAPoints[index].x, teamAPoints[index].y);
  }
  doc.setDrawColor(15, 133, 126);
  for (let index = 1; index < teamBPoints.length; index += 1) {
    doc.line(teamBPoints[index - 1].x, teamBPoints[index - 1].y, teamBPoints[index].x, teamBPoints[index].y);
  }

  doc.setFontSize(8);
  doc.setTextColor(255, 111, 97);
  doc.text(teamNames[0], x, y + 5);
  doc.setTextColor(15, 133, 126);
  doc.text(teamNames[1], x + 34, y + 5);
  doc.setTextColor(17, 32, 49);
}

function buildGameSummary(state: MatchState, game: GameState, index: number) {
  const completedAt = game.completedAt;
  const startedAt = game.startedAt;
  const teamNames = [state.config.teams[0].name, state.config.teams[1].name] as [string, string];

  return {
    setNumber: index + 1,
    score: `${game.points[0]}-${game.points[1]}`,
    winner:
      game.winnerTeamIndex !== null ? state.config.teams[game.winnerTeamIndex].name : "Unknown",
    startedAt,
    completedAt,
    duration: formatDurationMs(
      completedAt && startedAt ? new Date(completedAt).getTime() - new Date(startedAt).getTime() : 0,
    ),
    points: buildPointProgression(game, teamNames),
    timeoutEvents: game.timerEvents.map((event) => ({
      team: state.config.teams[event.teamIndex].name,
      kind: event.kind,
      at: event.at,
    })),
    cardEvents: game.cardEvents.map((event) => ({
      team: state.config.teams[event.teamIndex].name,
      kind: event.kind,
      at: event.at,
    })),
    setStats: state.config.teams.map((team, teamIndex) => ({
      name: team.name,
      winningPoints: game.pointHistory.filter((event) => event.winnerTeamIndex === teamIndex).length,
      serveWinningRate:
        game.pointHistory.filter((event) => event.serverTeamIndex === teamIndex).length === 0
          ? 0
          : Number(
              (
                (game.pointHistory.filter(
                  (event) => event.serverTeamIndex === teamIndex && event.winnerTeamIndex === teamIndex,
                ).length /
                  game.pointHistory.filter((event) => event.serverTeamIndex === teamIndex).length) *
                100
              ).toFixed(1),
            ),
      largestLead: calculateLargestLead(game, teamIndex as 0 | 1),
      longestWinningRun: calculateLongestRun(game, teamIndex as 0 | 1),
      setsWon: state.setsWon[teamIndex as 0 | 1],
      yellowCards: game.cardEvents.filter((event) => event.teamIndex === teamIndex && event.kind === "yellow").length,
      redCards: game.cardEvents.filter((event) => event.teamIndex === teamIndex && event.kind === "red").length,
      timeoutUsed: game.timerEvents.some((event) => event.teamIndex === teamIndex && event.kind === "standard"),
      medicalTimeoutUsed: game.timerEvents.some(
        (event) => event.teamIndex === teamIndex && event.kind === "medical",
      ),
    })),
  };
}

export function buildExportPayload(state: MatchState) {
  const completedGames = getCompletedGames(state).map((game, index) => buildGameSummary(state, game, index));
  const totalMatchTimeMs =
    state.finishedAt !== null
      ? new Date(state.finishedAt).getTime() - new Date(state.startedAt).getTime()
      : 0;

  return {
    exportedAt: new Date().toISOString(),
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    totalMatchTimeMs,
    totalMatchTimeDisplay: formatDurationMs(totalMatchTimeMs),
    discipline: state.config.discipline,
    format: state.config.format,
    stats: state.config.teams.map((team, teamIndex) => ({
      name: team.name,
      players: team.players
        .slice(0, getVisiblePlayerCountForExport(state))
        .map((player) => player.name),
      serveWinningRate: Number(calculateServeWinRate(state, teamIndex as 0 | 1).toFixed(1)),
      largestLead: completedGames.reduce<number | null>((largest, game) => {
        const lead = game.setStats[teamIndex].largestLead as number | null;
        if (lead === null) {
          return largest;
        }
        return largest === null ? lead : Math.max(largest, lead);
      }, null),
      longestWinningRun: Math.max(...completedGames.map((game) => game.setStats[teamIndex].longestWinningRun), 0),
      totalWinningPoints: calculateTotalWinningPoints(state, teamIndex as 0 | 1),
      setsWon: state.setsWon[teamIndex as 0 | 1],
      yellowCards: state.cards[teamIndex as 0 | 1].yellowWarning ? 1 : 0,
      redCards: state.cards[teamIndex as 0 | 1].redPenalties,
    })),
    winner:
      state.winnerTeamIndex !== null ? state.config.teams[state.winnerTeamIndex].name : null,
    sets: completedGames,
  };
}

export function exportMatchJson(state: MatchState) {
  const payload = buildExportPayload(state);
  downloadBlob(
    `tourna-match-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`,
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
}

export function exportMatchPdf(state: MatchState) {
  const payload = buildExportPayload(state);
  const doc = new jsPDF();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Tourna Match Report", 20, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Date: ${formatLocalDate(payload.startedAt)}`, 20, 32);
  doc.text(`Finished: ${formatLocalDate(payload.finishedAt)}`, 20, 39);
  doc.text(`Discipline: ${payload.discipline}`, 20, 46);
  doc.text(`Format: ${payload.format}`, 20, 53);
  doc.text(`Match time: ${payload.totalMatchTimeDisplay}`, 20, 60);

  let y = 72;
  payload.stats.forEach((team, index) => {
    doc.setFont("helvetica", "bold");
    doc.text(`Side ${index + 1}: ${team.name}`, 20, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.text(`Players: ${team.players.join(" / ")}`, 24, y);
    y += 7;
    doc.text(`Serve win rate: ${team.serveWinningRate}%`, 24, y);
    y += 7;
    doc.text(`Largest lead: ${formatLeadValue(team.largestLead)}`, 24, y);
    y += 7;
    doc.text(`Longest run: ${team.longestWinningRun}`, 24, y);
    y += 7;
    doc.text(`Total winning points: ${team.totalWinningPoints}`, 24, y);
    y += 10;
  });

  doc.setFont("helvetica", "bold");
  doc.text("Set history", 20, y);
  y += 8;
  doc.setFont("helvetica", "normal");

  if (payload.sets.length === 0) {
    doc.text("No completed sets yet.", 24, y);
    y += 8;
  } else {
    payload.sets.forEach((game) => {
      y = ensurePage(doc, y, 80);
      doc.text(
        `Set ${game.setNumber}: ${game.score} | Winner: ${game.winner} | ${game.duration}`,
        24,
        y,
      );
      y += 7;
      doc.text(
        `Timeouts/medical: ${game.timeoutEvents.length} | Cards: ${game.cardEvents.length}`,
        28,
        y,
      );
      y += 7;
      game.setStats.forEach((stat: any) => {
        doc.text(
          `${stat.name}: points ${stat.winningPoints}, serve ${stat.serveWinningRate}%, lead ${formatLeadValue(stat.largestLead)}, run ${stat.longestWinningRun}`,
          28,
          y,
        );
        y += 6;
      });
      drawProgressionChart(
        doc,
        `Set ${game.setNumber} progression`,
        game.points,
        [payload.stats[0].name, payload.stats[1].name],
        24,
        y,
        160,
        46,
      );
      y += 52;
    });
  }

  y = ensurePage(doc, y + 4, 70);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("Summary", 20, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.text(`Sets won: ${payload.stats[0].setsWon} - ${payload.stats[1].setsWon}`, 24, y);
  y += 7;
  doc.text(`Winner: ${payload.winner ?? "Match in progress"}`, 24, y);
  y += 12;
  drawProgressionChart(
    doc,
    "Full match progression",
    buildMatchProgression(payload.sets),
    [payload.stats[0].name, payload.stats[1].name],
    24,
    y,
    160,
    52,
  );

  doc.save(`tourna-match-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.pdf`);
}
