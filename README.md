# Mapy + Strava Heatmap Overlay

This repo includes:

- `mapy_strava_overlay.user.js` — Tampermonkey userscript that overlays
  Strava global heatmap (or Waymarked Trails MTB routes) on `mapy.com`
  while keeping all native Mapy controls
- `index.html` / `app.js` / `styles.css` — small standalone demo planner
  (not needed for the userscript flow)

## Real Mapy Overlay

### Setup

1. Install Tampermonkey in your browser.
2. Create a new userscript and paste `mapy_strava_overlay.user.js`.
3. Open `https://www.strava.com/maps/global-heatmap` once **in a normal tab
   while logged in**, and pan/zoom once so heatmap tiles load. This makes Strava
   set the CloudFront signed cookies (scoped to `.strava.com`, ~1-week expiry)
   that gate the high-resolution `tiles-auth` tiles. Do this in a real tab, not
   just rely on the background refresh — third-party cookie partitioning can
   stop an iframe's cookies from being usable.
4. Open `https://mapy.com/` and pan/zoom — the overlay tracks the URL.

### Hotkeys

- `H` — toggle overlay on/off
- `J` — cycle tile **source** (remembered across reloads):
  Strava **Road** heatmap → Strava **MTB** heatmap → Strava **Gravel** heatmap →
  Waymarked Trails **MTB** routes → Waymarked Trails **road/cycling** routes.
- `M` — cycle Strava heatmap **color**: grayscale → hot → bluered → blue →
  mobileblue → purple (grayscale is the confirmed-valid default; others fall
  back to grayscale per tile if a color isn't served).
- `G` — toggle Mapy base map between aerial (satellite) and outdoor/tourist
- `[` / `]` — decrease / increase opacity in 10% steps
- `Alt + D` — toggle debug panel
- `S` — export current Mapy planner route as GPX and open Ride with GPS upload
- `P` — toggle Mapy panorama

### Tile sources

| Source | URL pattern | Max zoom | Auth |
| --- | --- | --- | --- |
| Strava per-sport heatmap | `content-a.strava.com/identified/globalheat/sport_{Ride,MountainBikeRide,GravelRide}/{color}/{z}/{x}/{y}.png?v=19&missing=empty` | ~15 | CloudFront **cookie** (your logged-in `.strava.com` cookies, sent via `GM_xmlhttpRequest`) |
| Waymarked Trails MTB | `tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png` | 18 | none |
| Waymarked Trails road/cycling | `tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png` | 18 | none |

The **per-sport heatmap** is the endpoint the Strava web app itself uses, and —
unlike the public `heatmap-external/.../ride/...` tiles — it **separates
disciplines** (`sport_Ride` = road, `sport_MountainBikeRide`, `sport_GravelRide`).
It authenticates by cookie, so the script fetches it through Tampermonkey
(`@connect content-*.strava.com` + `strava.com`, `withCredentials`) and your
browser attaches the `.strava.com` CloudFront cookies. No query-string signature
or "capture" step is involved.

### Auth — it just needs your logged-in Strava cookies

Open the heatmap once in a normal tab while logged in (`https://www.strava.com/maps/global-heatmap`)
so Strava sets the CloudFront cookies, then use mapy. If heatmap tiles come back
`403`, your cookies are missing/expired — reload the Strava heatmap page (logged
in) to refresh them. Diagnose with `Alt+D`: the `gm ok/fail` and `last=` lines
show the tile HTTP status (`200` = working, `403` = cookie problem). High-res
(z>11) heatmap needs a Strava **subscription**; a free login is capped at z11.

> Legacy: an older path used `heatmap-external-*.strava.com/tiles{,-auth}` with a
> signed-query capture + cookie probe (`tryRefreshStravaAuth`,
> `probeStravaCookieAuth`). That endpoint returned `InvalidKey` for this account,
> so the script moved to the `content-*` per-sport endpoint above. The legacy
> code remains but isn't wired into the `J` source list.

**Diagnose:** press `Alt+D` and read the `gm ok/fail` and `last=` lines —
`200` means heatmap tiles are flowing, `403` means a cookie problem (reload the
Strava heatmap page logged in to refresh the CloudFront cookies).

### MTB vs road: now actually split

- **Popularity (Strava per-sport heatmap)** *can* be split. The web app's
  `content-*.strava.com/identified/globalheat/sport_<X>/...` endpoint serves
  per-discipline heat — `sport_Ride` (road), `sport_MountainBikeRide`,
  `sport_GravelRide` — which the public `heatmap-external/.../ride/...` tiles do
  not (those aggregate every ride sub-type into `ride`). The `J` hotkey cycles
  Road → MTB → Gravel heatmaps. This needs your logged-in Strava cookies (and a
  subscription for z>11); the official Strava API / MCP can't help — the heatmap
  is an internal tile service outside the public API.
- **Designated routes (Waymarked Trails)** are a complementary free overlay.
  `J` also cycles to `mtb` (mountain-bike route relations) and `cycling` (signed
  road/touring cycle routes). These show where routes are *designated*, not how
  popular they are, but they render crisply to z=18 and need no Strava login.

## Demo app

For local experimentation only:

- `python -m http.server 5500`
- Open `http://localhost:5500`
