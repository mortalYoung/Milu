# Pet sprite sheet

One image per pet, in `assets/<id>.png`. The grid is fixed; a pet only brings pixels.

## Sheet

|             |                                                                  |
| ----------- | ---------------------------------------------------------------- |
| Canvas      | 1536 × 2288 px (8 columns × 11 rows)                             |
| Cell        | 192 × 208 px, non-square, never padded or inset                  |
| Format      | PNG-32, transparent background (RGB residue cleared to 0)        |
| Style       | full-colour illustration, smooth scaling — this is not pixel art |
| Empty cells | trailing cells of a row without frames stay fully transparent    |
| Bounds      | every pixel of a frame stays inside its own cell                 |

## Rows

Row order is fixed. `Frames` is how many leading columns of that row are played.

| Row | State               | Frames |
| --- | ------------------- | ------ |
| 0   | `idle`              | 6      |
| 1   | `running-right`     | 8      |
| 2   | `running-left`      | 8      |
| 3   | `waving`            | 4      |
| 4   | `jumping`           | 5      |
| 5   | `failed`            | 8      |
| 6   | `waiting`           | 6      |
| 7   | `running`           | 6      |
| 8   | `review`            | 6      |
| 9   | `look-000-to-157.5` | 8      |
| 10  | `look-180-to-337.5` | 8      |

The constants live in `src/sheets.ts` (`COLUMNS`, `ROWS`, `CELL`, `STATES`, `FRAMES`, `DURATION`); a change there is a change to the standard.

## What drives a state

`src/use-pet-state.ts` picks the first match, top to bottom:

| Signal                               | State                                                       |
| ------------------------------------ | ----------------------------------------------------------- |
| session error                        | `failed`                                                    |
| pending approval                     | `waiting`                                                   |
| window being dragged                 | `running-left` / `running-right`                            |
| first 1.6 s after the window opens   | `waving`                                                    |
| pointer over the pet                 | `jumping`                                                   |
| idle with unread output              | `review`                                                    |
| idle, cursor away and `petFollow` on | `look-000-to-157.5` / `look-180-to-337.5`, one static frame |
| agent running                        | `running`                                                   |
| otherwise                            | `idle`                                                      |

`failed` is a bounded reaction — the session keeps its last error until the next run starts, so the window keeps it short; `waiting` comes from the session, `running`/`unread` from activity, `running-*`/`look-*` from window motion (the shell reports drag direction and the cursor angle relative to the window centre, 0° = up, clockwise in 22.5° steps), `waving`/`jumping` from the page itself.
