export type Discipline = "singles" | "doubles";
export type MatchFormat = "best-of-3" | "best-of-5" | "best-of-7" | "casual";
export type TimeoutKind = "standard" | "medical";
export type CardKind = "yellow" | "red";

export interface Player {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
}

export interface MatchConfig {
  discipline: Discipline;
  format: MatchFormat;
  teams: [Team, Team];
  initialServerTeamIndex: 0 | 1;
  initialServerPlayerId: string;
  initialReceiverPlayerId: string;
  initialLeftTeamIndex: 0 | 1;
}

export interface CardState {
  yellowWarning: boolean;
  redPenalties: number;
}

export interface PointEvent {
  winnerTeamIndex: 0 | 1;
  serverTeamIndex: 0 | 1;
  scoreAfter: [number, number];
  at: string;
}

export interface CardEvent {
  teamIndex: 0 | 1;
  kind: CardKind;
  at: string;
}

export interface TimerEvent {
  teamIndex: 0 | 1;
  kind: TimeoutKind;
  at: string;
}

export interface GameState {
  points: [number, number];
  timeoutUsed: [boolean, boolean];
  medicalUsed: [boolean, boolean];
  completedAt: string | null;
  winnerTeamIndex: 0 | 1 | null;
  startedAt: string | null;
  pointHistory: PointEvent[];
  cardEvents: CardEvent[];
  timerEvents: TimerEvent[];
}

export interface MatchTimer {
  teamIndex: 0 | 1;
  kind: TimeoutKind;
  endsAt: number;
}

export interface MatchState {
  config: MatchConfig;
  games: GameState[];
  setsWon: [number, number];
  winnerTeamIndex: 0 | 1 | null;
  activeTimer: MatchTimer | null;
  cards: [CardState, CardState];
  startedAt: string;
  finishedAt: string | null;
}

export interface RotationInfo {
  currentServer: Player;
  currentReceiver: Player;
  nextServer: Player;
  nextReceiver: Player;
  serviceTurnLength: number;
}

export interface MatchSummary {
  currentGame: GameState;
  currentGameIndex: number;
  requiredSets: number | null;
  gamePointTarget: number;
  isDeuce: boolean;
  isFinalPossibleGame: boolean;
  shouldChangeEndsNow: boolean;
  rotation: RotationInfo;
}

export function getVisiblePlayerCountForExport(state: MatchState) {
  return state.config.discipline === "doubles" ? 2 : 1;
}

export function buildFormatLabel(format: MatchFormat) {
  switch (format) {
    case "best-of-3":
      return "Best of 3";
    case "best-of-5":
      return "Best of 5";
    case "best-of-7":
      return "Best of 7";
    case "casual":
      return "Casual";
  }
}

const TIMEOUT_DURATION_MS = 60_000;
const MEDICAL_TIMEOUT_DURATION_MS = 10 * 60_000;

function createCardState(): CardState {
  return {
    yellowWarning: false,
    redPenalties: 0,
  };
}

function createGameState(now: Date | null): GameState {
  return {
    points: [0, 0],
    timeoutUsed: [false, false],
    medicalUsed: [false, false],
    completedAt: null,
    winnerTeamIndex: null,
    startedAt: now ? now.toISOString() : null,
    pointHistory: [],
    cardEvents: [],
    timerEvents: [],
  };
}

function cloneGameState(game: GameState): GameState {
  return {
    points: [...game.points] as [number, number],
    timeoutUsed: [...game.timeoutUsed] as [boolean, boolean],
    medicalUsed: [...game.medicalUsed] as [boolean, boolean],
    completedAt: game.completedAt,
    winnerTeamIndex: game.winnerTeamIndex,
    startedAt: game.startedAt,
    pointHistory: game.pointHistory.map((event) => ({
      ...event,
      scoreAfter: [...event.scoreAfter] as [number, number],
    })),
    cardEvents: game.cardEvents.map((event) => ({ ...event })),
    timerEvents: game.timerEvents.map((event) => ({ ...event })),
  };
}

function cloneState(state: MatchState): MatchState {
  return {
    config: {
      ...state.config,
      teams: [
        {
          ...state.config.teams[0],
          players: state.config.teams[0].players.map((player) => ({ ...player })),
        },
        {
          ...state.config.teams[1],
          players: state.config.teams[1].players.map((player) => ({ ...player })),
        },
      ],
    },
    games: state.games.map(cloneGameState),
    setsWon: [...state.setsWon] as [number, number],
    winnerTeamIndex: state.winnerTeamIndex,
    activeTimer: state.activeTimer ? { ...state.activeTimer } : null,
    cards: state.cards.map((card) => ({ ...card })) as [CardState, CardState],
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
  };
}

export function getRequiredSets(format: MatchFormat): number | null {
  switch (format) {
    case "best-of-3":
      return 2;
    case "best-of-5":
      return 3;
    case "best-of-7":
      return 4;
    case "casual":
      return null;
  }
}

function getCurrentGame(state: MatchState): GameState {
  return state.games[state.games.length - 1];
}

function getServiceTurnLength(points: [number, number]): number {
  return points[0] >= 10 && points[1] >= 10 ? 1 : 2;
}

function getServiceTurnIndex(points: [number, number]): number {
  const totalPoints = points[0] + points[1];
  if (points[0] >= 10 && points[1] >= 10) {
    return 10 + (totalPoints - 20);
  }

  return Math.floor(totalPoints / 2);
}

function getTeamPlayer(team: Team, playerId: string): Player {
  const player = team.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId} for team ${team.name}`);
  }

  return player;
}

export function getTeamIndexForPlayer(teams: [Team, Team], playerId: string): 0 | 1 {
  return teams[0].players.some((player) => player.id === playerId) ? 0 : 1;
}

function getPartner(team: Team, playerId: string): Player {
  const partner = team.players.find((candidate) => candidate.id !== playerId);
  if (!partner) {
    throw new Error(`Partner not found for player ${playerId} on team ${team.name}`);
  }

  return partner;
}

function getOpeningPairForGame(config: MatchConfig, gameIndex: number): {
  server: Player;
  receiver: Player;
} {
  if (config.discipline === "singles") {
    const servingTeamIndex = ((config.initialServerTeamIndex + gameIndex) % 2) as 0 | 1;
    const server = config.teams[servingTeamIndex].players[0];
    const receiver = config.teams[(servingTeamIndex === 0 ? 1 : 0) as 0 | 1].players[0];

    return { server, receiver };
  }

  const servingTeamIndex = ((config.initialServerTeamIndex + gameIndex) % 2) as 0 | 1;
  const receivingTeamIndex = (servingTeamIndex === 0 ? 1 : 0) as 0 | 1;
  const baseServer = getTeamPlayer(
    config.teams[config.initialServerTeamIndex],
    config.initialServerPlayerId,
  );
  const baseReceiver = getTeamPlayer(
    config.teams[(config.initialServerTeamIndex === 0 ? 1 : 0) as 0 | 1],
    config.initialReceiverPlayerId,
  );

  const servingTeam = config.teams[servingTeamIndex];
  const receivingTeam = config.teams[receivingTeamIndex];

  const server =
    servingTeam.id === config.teams[config.initialServerTeamIndex].id
      ? getTeamPlayer(servingTeam, baseServer.id)
      : getPartner(servingTeam, baseReceiver.id);
  const receiver =
    receivingTeam.id === config.teams[(config.initialServerTeamIndex === 0 ? 1 : 0) as 0 | 1].id
      ? getTeamPlayer(receivingTeam, baseReceiver.id)
      : getPartner(receivingTeam, baseServer.id);

  const teamServeCount = Array.from({ length: gameIndex }).filter(
    (_, index) => ((config.initialServerTeamIndex + index) % 2) === servingTeamIndex,
  ).length;
  const teamReceiveCount = Array.from({ length: gameIndex }).filter(
    (_, index) => ((config.initialServerTeamIndex + index) % 2) !== servingTeamIndex,
  ).length;

  return {
    server: teamServeCount % 2 === 0 ? server : getPartner(servingTeam, server.id),
    receiver:
      teamReceiveCount % 2 === 0 ? receiver : getPartner(receivingTeam, receiver.id),
  };
}

function getRotation(config: MatchConfig, gameIndex: number, points: [number, number]): RotationInfo {
  const opening = getOpeningPairForGame(config, gameIndex);
  const serviceTurnIndex = getServiceTurnIndex(points);
  const serviceTurnLength = getServiceTurnLength(points);

  if (config.discipline === "singles") {
    const openingServerTeamIndex = getTeamIndexForPlayer(config.teams, opening.server.id);
    const otherTeamIndex = (openingServerTeamIndex === 0 ? 1 : 0) as 0 | 1;
    const currentServer =
      serviceTurnIndex % 2 === 0 ? opening.server : config.teams[otherTeamIndex].players[0];
    const currentReceiver =
      currentServer.id === opening.server.id ? opening.receiver : opening.server;

    return {
      currentServer,
      currentReceiver,
      nextServer: currentReceiver,
      nextReceiver: currentServer,
      serviceTurnLength,
    };
  }

  const servingTeam = config.teams.find((team) =>
    team.players.some((player) => player.id === opening.server.id),
  );
  const receivingTeam = config.teams.find((team) =>
    team.players.some((player) => player.id === opening.receiver.id),
  );

  if (!servingTeam || !receivingTeam) {
    throw new Error("Unable to derive doubles rotation");
  }

  const servingPartner = getPartner(servingTeam, opening.server.id);
  const receivingPartner = getPartner(receivingTeam, opening.receiver.id);
  const cycle = [
    { server: opening.server, receiver: opening.receiver },
    { server: opening.receiver, receiver: servingPartner },
    { server: servingPartner, receiver: receivingPartner },
    { server: receivingPartner, receiver: opening.server },
  ];
  const current = cycle[serviceTurnIndex % cycle.length];
  const upcoming = cycle[(serviceTurnIndex + 1) % cycle.length];

  return {
    currentServer: current.server,
    currentReceiver: current.receiver,
    nextServer: upcoming.server,
    nextReceiver: upcoming.receiver,
    serviceTurnLength,
  };
}

export function isGameWon(points: [number, number], teamIndex: 0 | 1): boolean {
  const own = points[teamIndex];
  const other = points[teamIndex === 0 ? 1 : 0];
  return own >= 11 && own - other >= 2;
}

function maybeAdvanceGame(state: MatchState, completedAt: string): MatchState {
  const next = cloneState(state);
  const currentGame = getCurrentGame(next);
  const winner =
    isGameWon(currentGame.points, 0) ? 0 : isGameWon(currentGame.points, 1) ? 1 : null;

  if (winner === null) {
    return next;
  }

  currentGame.completedAt = completedAt;
  currentGame.winnerTeamIndex = winner;
  next.setsWon[winner] += 1;
  next.activeTimer = null;

  const requiredSets = getRequiredSets(next.config.format);
  if (requiredSets !== null && next.setsWon[winner] >= requiredSets) {
    next.winnerTeamIndex = winner;
    next.finishedAt = completedAt;
    return next;
  }

  next.games.push(createGameState(null));
  return next;
}

export function createMatch(config: MatchConfig, now = new Date()): MatchState {
  return {
    config,
    games: [createGameState(null)],
    setsWon: [0, 0],
    winnerTeamIndex: null,
    activeTimer: null,
    cards: [createCardState(), createCardState()],
    startedAt: now.toISOString(),
    finishedAt: null,
  };
}

export function updateMatchConfig(state: MatchState, config: MatchConfig, now = new Date()): MatchState {
  void state;
  return createMatch(config, now);
}

export function startCurrentSet(state: MatchState, now = new Date()): MatchState {
  const next = cloneState(state);
  const currentGame = getCurrentGame(next);
  if (!currentGame.startedAt) {
    currentGame.startedAt = now.toISOString();
  }
  return next;
}

export function awardPoint(state: MatchState, teamIndex: 0 | 1, now = new Date()): MatchState {
  if (state.winnerTeamIndex !== null) {
    return state;
  }

  const next = cloneState(state);
  const currentGame = getCurrentGame(next);
  if (!currentGame.startedAt) {
    currentGame.startedAt = now.toISOString();
  }
  const summary = getMatchSummary(next);
  const serverTeamIndex = getTeamIndexForPlayer(next.config.teams, summary.rotation.currentServer.id);

  currentGame.points[teamIndex] += 1;
  currentGame.pointHistory.push({
    winnerTeamIndex: teamIndex,
    serverTeamIndex,
    scoreAfter: [...currentGame.points] as [number, number],
    at: now.toISOString(),
  });

  return maybeAdvanceGame(next, now.toISOString());
}

export function undoPoint(state: MatchState, teamIndex: 0 | 1): MatchState {
  if (state.winnerTeamIndex !== null) {
    return state;
  }

  const next = cloneState(state);
  const currentGame = getCurrentGame(next);
  if (currentGame.points[teamIndex] === 0) {
    return next;
  }

  currentGame.points[teamIndex] = Math.max(0, currentGame.points[teamIndex] - 1);
  for (let index = currentGame.pointHistory.length - 1; index >= 0; index -= 1) {
    if (currentGame.pointHistory[index].winnerTeamIndex === teamIndex) {
      currentGame.pointHistory.splice(index, 1);
      break;
    }
  }
  return next;
}

export function startTimer(
  state: MatchState,
  teamIndex: 0 | 1,
  kind: TimeoutKind,
  now = Date.now(),
): MatchState {
  const next = cloneState(state);
  const currentGame = getCurrentGame(next);
  const eventAt = new Date(now).toISOString();
  const hasUsedKind = next.games.some((game) =>
    game.timerEvents.some((event) => event.teamIndex === teamIndex && event.kind === kind),
  );

  if (kind === "standard") {
    if (hasUsedKind) {
      return state;
    }
    currentGame.timeoutUsed[teamIndex] = true;
    currentGame.timerEvents.push({ teamIndex, kind, at: eventAt });
    next.activeTimer = {
      teamIndex,
      kind,
      endsAt: now + TIMEOUT_DURATION_MS,
    };
    return next;
  }

  if (hasUsedKind) {
    return state;
  }
  currentGame.medicalUsed[teamIndex] = true;
  currentGame.timerEvents.push({ teamIndex, kind, at: eventAt });
  next.activeTimer = {
    teamIndex,
    kind,
    endsAt: now + MEDICAL_TIMEOUT_DURATION_MS,
  };
  return next;
}

export function clearTimer(state: MatchState): MatchState {
  if (!state.activeTimer) {
    return state;
  }

  const next = cloneState(state);
  next.activeTimer = null;
  return next;
}

export function issueCard(
  state: MatchState,
  teamIndex: 0 | 1,
  kind: CardKind,
  now = new Date(),
): MatchState {
  const next = cloneState(state);
  const cardState = next.cards[teamIndex];
  const currentGame = getCurrentGame(next);
  currentGame.cardEvents.push({ teamIndex, kind, at: now.toISOString() });

  if (kind === "yellow") {
    cardState.yellowWarning = true;
    return next;
  }

  cardState.yellowWarning = true;
  cardState.redPenalties += 1;

  const penaltyPoints = cardState.redPenalties === 1 ? 1 : 2;
  const opponentIndex = (teamIndex === 0 ? 1 : 0) as 0 | 1;
  const summary = getMatchSummary(next);
  const serverTeamIndex = getTeamIndexForPlayer(next.config.teams, summary.rotation.currentServer.id);

  currentGame.points[opponentIndex] += penaltyPoints;
  for (let count = 0; count < penaltyPoints; count += 1) {
    currentGame.pointHistory.push({
      winnerTeamIndex: opponentIndex,
      serverTeamIndex,
      scoreAfter: [...currentGame.points] as [number, number],
      at: now.toISOString(),
    });
  }
  return maybeAdvanceGame(next, now.toISOString());
}

export function getCompletedGames(state: MatchState): GameState[] {
  return state.games.filter((game) => game.winnerTeamIndex !== null);
}

export function getCurrentDisplayOrder(state: MatchState): [0 | 1, 0 | 1] {
  const summary = getMatchSummary(state);
  let leftTeamIndex = state.config.initialLeftTeamIndex;

  if (summary.currentGameIndex % 2 === 1) {
    leftTeamIndex = (leftTeamIndex === 0 ? 1 : 0) as 0 | 1;
  }

  if (summary.shouldChangeEndsNow) {
    leftTeamIndex = (leftTeamIndex === 0 ? 1 : 0) as 0 | 1;
  }

  return [leftTeamIndex, (leftTeamIndex === 0 ? 1 : 0) as 0 | 1];
}

export function getMatchSummary(state: MatchState): MatchSummary {
  const currentGame = getCurrentGame(state);
  const currentGameIndex = state.games.length - 1;
  const requiredSets = getRequiredSets(state.config.format);
  const isDeuce = currentGame.points[0] >= 10 && currentGame.points[1] >= 10;
  const isFinalPossibleGame =
    requiredSets !== null &&
    state.setsWon[0] === requiredSets - 1 &&
    state.setsWon[1] === requiredSets - 1;
  const shouldChangeEndsNow =
    isFinalPossibleGame &&
    currentGame.points[0] + currentGame.points[1] > 0 &&
    (currentGame.points[0] >= 5 || currentGame.points[1] >= 5);

  return {
    currentGame,
    currentGameIndex,
    requiredSets,
    gamePointTarget: 11,
    isDeuce,
    isFinalPossibleGame,
    shouldChangeEndsNow,
    rotation: getRotation(state.config, currentGameIndex, currentGame.points),
  };
}
