import { describe, expect, it } from "vitest";
import {
  awardPoint,
  createMatch,
  getCurrentDisplayOrder,
  getMatchSummary,
  issueCard,
  startTimer,
  undoPoint,
  type MatchConfig,
} from "./match";

function buildSinglesConfig(): MatchConfig {
  return {
    discipline: "singles",
    format: "best-of-5",
    initialServerTeamIndex: 0,
    initialServerPlayerId: "a1",
    initialReceiverPlayerId: "b1",
    initialLeftTeamIndex: 0,
    teams: [
      {
        id: "team-a",
        name: "Player A",
        players: [{ id: "a1", name: "Player A" }],
      },
      {
        id: "team-b",
        name: "Player B",
        players: [{ id: "b1", name: "Player B" }],
      },
    ],
  };
}

describe("match engine", () => {
  it("switches to one-point service turns at deuce", () => {
    let match = createMatch(buildSinglesConfig());

    for (let index = 0; index < 10; index += 1) {
      match = awardPoint(match, 0);
      match = awardPoint(match, 1);
    }

    const summary = getMatchSummary(match);
    expect(summary.isDeuce).toBe(true);
    expect(summary.rotation.serviceTurnLength).toBe(1);
  });

  it("supports undoing the current score", () => {
    let match = createMatch(buildSinglesConfig());
    match = awardPoint(match, 0);
    match = awardPoint(match, 0);
    match = undoPoint(match, 0);

    expect(getMatchSummary(match).currentGame.points).toEqual([1, 0]);
  });

  it("tracks one standard timeout per side", () => {
    const match = createMatch(buildSinglesConfig());
    const withTimeout = startTimer(match, 0, "standard", 1000);
    const duplicate = startTimer(withTimeout, 0, "standard", 2000);

    expect(withTimeout.activeTimer?.endsAt).toBe(61_000);
    expect(duplicate).toBe(withTimeout);
  });

  it("limits medical timeout to once per side for the whole match", () => {
    let match = createMatch(buildSinglesConfig());
    const withMedical = startTimer(match, 0, "medical", 1000);
    expect(withMedical.activeTimer?.endsAt).toBe(601_000);
    match = withMedical;

    for (let point = 0; point < 11; point += 1) {
      match = awardPoint(match, 0, new Date(`2026-04-07T10:${String(point).padStart(2, "0")}:00Z`));
    }

    const duplicate = startTimer(match, 0, "medical", 2000);

    expect(duplicate).toBe(match);
  });

  it("keeps standard timeout unavailable after a new set starts", () => {
    let match = createMatch(buildSinglesConfig());
    match = startTimer(match, 0, "standard", 1000);

    for (let point = 0; point < 11; point += 1) {
      match = awardPoint(match, 0, new Date(`2026-04-07T10:${String(point).padStart(2, "0")}:00Z`));
    }

    const duplicate = startTimer(match, 0, "standard", 2000);

    expect(match.games[1].winnerTeamIndex).toBeNull();
    expect(duplicate).toBe(match);
  });

  it("records the final completed game when the match ends", () => {
    let match = createMatch(buildSinglesConfig());

    for (let index = 0; index < 33; index += 1) {
      match = awardPoint(match, 0, new Date(`2026-04-07T10:${String(index).padStart(2, "0")}:00Z`));
    }

    expect(match.winnerTeamIndex).toBe(0);
    expect(match.games.filter((game) => game.winnerTeamIndex !== null)).toHaveLength(3);
  });

  it("adds penalty points for a red card", () => {
    const match = createMatch(buildSinglesConfig());
    const withCard = issueCard(match, 0, "red", new Date("2026-04-07T10:00:00Z"));

    expect(getMatchSummary(withCard).currentGame.points).toEqual([0, 1]);
    expect(withCard.games[0].cardEvents).toHaveLength(1);
  });

  it("swaps display sides at 5 points in the final possible game", () => {
    let match = createMatch({ ...buildSinglesConfig(), format: "best-of-3" });

    for (let game = 0; game < 2; game += 1) {
      for (let point = 0; point < 11; point += 1) {
        match = awardPoint(
          match,
          game === 0 ? 0 : 1,
          new Date(`2026-04-07T10:${String(game * 12 + point).padStart(2, "0")}:00Z`),
        );
      }
    }

    for (let point = 0; point < 5; point += 1) {
      match = awardPoint(match, 0, new Date(`2026-04-07T11:0${point}:00Z`));
    }

    expect(getMatchSummary(match).shouldChangeEndsNow).toBe(true);
    expect(getCurrentDisplayOrder(match)).toEqual([1, 0]);
  });
});
