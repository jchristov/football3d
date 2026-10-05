# Turbo Football 3D – feature roadmap

Features are worked on in priority order (P1 first). Size: S < 1 h, M a few hours, L a day or more.
Status: ☐ planned · ◐ in progress · ☑ done.

| Pri | Feature | Size | Status | What it adds |
|-----|---------|------|--------|--------------|
| P1 | Speciality matters | M | ☑ | The speciality bar affects play: defenders tackle and head better, midfielders pass more accurately, attackers shoot harder; playing out of position costs a little. |
| P2 | Suspensions | S | ☑ | In cup / league a red card (or 3 yellows) means a player misses the next match; a discipline table. |
| P3 | Ratings and man of the match | S–M | ☑ | Per-player ratings from the match events and stats, best player on the end screen. |
| P4 | Pre-match line-up screen | S | ☑ | Team sheets with formation and speciality bars before kick-off. |
| P5 | Injuries | S | ☑ | Hard tackles can injure a player, who must be substituted. |
| P6 | Stadium announcer | S | ☑ | PA-style announcements (line-ups, goals, substitutions) with the Natural voice. |
| P7 | Accessibility | S–M | ☑ | Colour-blind-safe card/bar palette, UI size slider, reduced motion. |
| P8 | Installable offline app, auto quality | S | ☑ | Web manifest + service worker, fullscreen button, quality that adapts to the frame rate. |
| P9 | CPU play styles | M | ☑ | Teams with their own style (pressing, counter-attack, long ball); CPU substitutions consider cards and tiredness. |
| P10 | Throw-ins, corners, goal kicks | M | ☑ | Proper restarts when the ball leaves the pitch (depends on how the boards are modelled). |
| P11 | Team editor | M | ☐ | Custom names, colours, kit choice and speciality edits. |
| P12 | Post-match analysis | M | ☑ | Heat map, shot map and pass statistics. |
| P13 | Practice and tutorial | M | ☐ | Penalty / free-kick challenge and a short interactive tutorial. |
| P14 | VAR check | M | ☑ | Short review of red cards and penalties that may overturn the decision. |
| P15 | Stadium and weather variety | M | ☑ | Muddy pitch, wind, different stadium looks. |
| P16 | Share a replay | M | ☑ | Save a goal replay as a video. |
| P17 | Season / career mode | L | ☑ | Several matches with a persistent squad, top scorers and a form guide. |
| – | P2P online match | L | ☑ | Two-player match over WebRTC with manual code exchange; host-authoritative simulation, guest renders snapshots (done on request). |

## Why this order
1. P1–P4 build directly on the speciality bars, the cards and the match log that already exist.
2. P5–P8 are small and improve every match (injuries, announcer, accessibility, installability).
3. P9–P12 deepen the simulation and the presentation.
4. P13–P17 are larger or more independent and come last; P17 (career) reuses most of the earlier work.

## Notes for each feature
Each feature ships with unit tests, a README entry, and (where it has UI) a screenshot check in the browser; a feature is only ticked off here when its commit is in `main`.

## More ideas (not scheduled)
- Replay editor: slow motion, free camera and a saved "best goals" gallery.
- Tournament extras: custom cup brackets, transfer market between matches, trophies and achievements.
- Set-piece play: choose corner / free-kick routines, manual wall and keeper placement.
- Weather that changes during the match, day-night transition, and floodlight failure events.
- Mobile polish: haptics, on-screen button layout editor, landscape lock, PWA install prompt (see P8).
- Spectator mode for online games and a rematch button for guests.
- Daily challenge: a fixed seed match with a special rule (e.g. 5 minutes, no sprinting, golden goal).
