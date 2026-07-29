# Fonts

Self-hosted, so no surface in Stoic makes a network request to render text.
Loading a webfont from a CDN sends the user's IP and a referer to that CDN every
time the popup or the block page opens, which contradicts the product's central
promise. It also breaks offline.

| File | Family | Licence |
|---|---|---|
| `inter-latin.woff2`, `inter-latin-ext.woff2` | Inter (variable, 400–700) | SIL Open Font License 1.1 |
| `jetbrains-mono-latin.woff2`, `jetbrains-mono-latin-ext.woff2` | JetBrains Mono (variable, 400–600) | SIL Open Font License 1.1 |
| `source-serif-4-latin.woff2` | Source Serif 4 (variable, 400–600) | SIL Open Font License 1.1 |

Roles are fixed and defined in `tokens.css`:

- **Inter** — all UI.
- **JetBrains Mono** — numerals and the ledger only: stat values, timers, XP, the
  contribution grid. It carries the "this is a record" signal, so applying it
  loosely dilutes it.
- **Source Serif 4** — the product speaking in its own voice, in exactly three
  places: the reflection on the block page, the rank descriptor, and the first
  line of onboarding. Never data.

Latin subsets only. Source Serif 4 ships latin only, since its text is curated.
