# Push-optimal Sokoban solver

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/idn45-agent/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/idn45-agent/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Built with [make.fun](https://make.fun) (referral code `p43eknr7`).

**A push-optimal Sokoban solver** — `main.ts` answers every instance of a
drawn set in as few pushes as possible: it splits each level into its rooms
(boxes can never leave their room), solves each room push-optimally with A*
over push states (Hungarian assignment heuristic, deadlock pruning), and
stitches the room solutions together with shortest player walks through the
hallway.

Entry for the [make.fun bounty sokoban-solver-01-run-20261121](https://make.fun/bounty/sokoban-solver-01-run-20261121)
(pot $100, deadline 23 November 2026).
