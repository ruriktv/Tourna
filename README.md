# Tourna

Tourna starts as a browser-based table tennis umpire scoreboard designed for desktop, iPad, and iPhone. The first version is a pure client-side web application with no login and no backend.

## Product direction

The initial goal is a touch-friendly umpire interface that follows ITTF match flow while remaining fast to use during live play. This scoreboard is intended to become one module inside a much larger tournament platform in the future, so the app should be built in a way that can scale into a broader system.

## Initial scope

- Pure client-side web app
- Works in modern desktop and mobile browsers
- One-umpire operation only for v1
- Singles and doubles support
- Match formats:
  - Best of 3
  - Best of 5
  - Best of 7
  - Casual mode with continuous set history and no match limit

## Core scoring behavior

- Umpire can enter player names before the match starts
- Touching a player's score increments that player's point total
- Double-tapping a player's score decrements that player's point total to correct mistakes
- The interface should be optimized for fast score entry during live matches
- Set wins and match wins should be calculated automatically based on the selected format

Example correction flow:

- If the current score is `9:4`
- Tapping player A's score makes it `10:4`
- If that was a mistake, double-tapping player A's score reduces it back to `9:4`
- The umpire can then tap player B's score to make it `9:5`

## ITTF-oriented match logic

The scoreboard should follow standard ITTF match logic by default, including:

- Game to 11, win by 2
- Service changes every 2 points
- Service alternates every point after deuce
- End changes in the final possible game when required by the rules
- Visible indicators for current server and receiver
- Support for singles and doubles service order logic
- Expedite support if added during implementation planning

For doubles, the UI should clearly indicate:

- Current server
- Current receiver
- Team/player service order
- Rotation changes as points and games progress

## Timeouts and match events

Each player may use the following during a game:

- One standard timeout per player, with a 60-second countdown and a clear reminder for the umpire
- Medical timeout/event marker per player

Once used, each event should remain visibly indicated on the scoreboard for that game.

## UX principles

- Large touch targets suitable for phones and tablets
- Minimal input friction during live scoring
- Clear visual hierarchy for points, sets, server, receiver, and timeout status
- Fast recovery from input mistakes
- Responsive layout across desktop, iPad, and iPhone

## Recommended technical direction

The recommended starting point is a React and TypeScript application because it is easier to scale into the larger tournament system planned later, including registration, player profiles, club management, and payments.

Suggested direction for the first build:

- React + TypeScript + Vite
- Strong separation between the match rules engine and the UI
- Client-side state management centered around a match model
- Responsive design from the start
- Prepared for future persistence, multi-view displays, and backend integration

## Mobile evolution

The web version should be structured so it can evolve into iOS and Android applications later.

Planned approach:

- Keep the scoring and rules logic in framework-agnostic TypeScript modules
- Keep the web UI separate from the match engine
- Reuse the domain logic later in a React Native or Expo app
- Keep Capacitor or a similar hybrid wrapper available as a fallback path if a fast mobile shell is needed

This gives the project two future-friendly options:

- Proper mobile apps using React Native while reusing the match engine
- Hybrid mobile apps that wrap the web UI when faster delivery matters more than full native controls

## Current scaffold

The repository now includes an initial React and TypeScript application scaffold with:

- Vite-based frontend setup
- A reusable match engine for singles and doubles
- A simplified 3-step umpire flow optimized for phone and tablet browsers
- Step progress indicator for setup and live scoring
- Touch-first score entry with single tap to add a point and double tap to remove a point
- Coin toss as a modal overlay during table setup
- Umpire-view side assignment with player drag-and-drop onto the table layout
- Player-facing scoreboard orientation during live play
- Current server and receiver badges next to player names
- Standard and medical timeout handling in an overlay modal, including an urgent final-10-second warning state and manual close after expiry
- Yellow and red card controls aligned to player-side handling, with doubles treated at pair level
- Automatic visual side swaps between games and at 5 points in the last possible game
- Match export to PDF and JSON with names, timestamps, completed game history, and basic performance metrics
- Responsive layout aimed primarily at desktop, iPad, and iPhone

## Near-term build plan

1. Define the match state model and rules engine for singles and doubles
2. Build the umpire scoring interface for phones, tablets, and desktop
3. Add timeout and medical event controls
4. Add set/match configuration options
5. Add casual mode with continuous set tracking
6. Validate scoring behavior against ITTF rules and edge cases

## Notes

- v1 is intentionally local and client-side only
- Public display mode is out of scope for now
- This scoreboard is expected to become part of a larger tournament application later
