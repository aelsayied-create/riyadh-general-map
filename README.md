# Riyadh General Map · الخريطة العامة للرياض

Leaflet web map of Riyadh Region built from open data: coordinate search (decimal, DMS, UTM 38N), drawing tools with KML export, four background maps (Gray, OpenStreetMap, Streets, Satellite). Arabic, right-to-left. Password-protected on Netlify.

## Password
Built-in password: **`Riyadh@2026`** — checked on Netlify's server (`netlify/edge-functions/password.ts`), so the page and the data are never sent without it.
To change it without editing code: Netlify → Site configuration → Environment variables → `PROTECTED_PAGE_PASSWORD`, then redeploy.

## Publish on Netlify
**Option A — from this folder (quickest):**
```bash
netlify login
netlify sites:create --name riyadh-general-map
netlify deploy --prod
```
(Use the CLI: Netlify's drag-and-drop upload does not run the password function.)

**Option B — connected to GitHub (adds the OpenStreetMap layers and keeps all data up to date):**
1. Push this folder to a GitHub repository.
2. Netlify → Add new site → Import an existing project → choose the repository. Netlify reads `netlify.toml` (publish folder `web`).
3. The workflow `.github/workflows/update-data.yml` downloads OpenStreetMap (streets, parks, hotels, places) and the latest Royal Commission transport data on the first run and on the 1st of every month, commits it, and Netlify redeploys automatically.
   To refresh now: GitHub → Actions → Update map data → Run workflow.

The site is published only on Netlify (behind the password); nothing is published on GitHub Pages.

## Layers and symbology
| Group | Layer | Source | Symbol |
|---|---|---|---|
| Boundaries | Riyadh Region | geoBoundaries ADM1 (CC BY 4.0) | dark line on a white halo |
| | Governorates (23) | geoBoundaries ADM2; Arabic names added | brown dash-dot line |
| | Districts (711) | National Address (maps.address.gov.sa) via homaily (GPL-3.0) | thin outline, hover highlight, names from zoom 12.5 |
| Transport | Riyadh Metro (6 lines), stations (83, with station type) | Royal Commission for Riyadh City open data (opendata.rcrc.gov.sa, KSA Open Data License) | official line colours on white casing; white station discs, interchanges with black ring |
| | Airports (24) and helipads (22) | OurAirports (public domain) | icon per class: international, domestic, under construction, air base, airstrip, helipad |
| | Bus routes (88 lines: 3 BRT, 6 main, 20 community, 59 feeder) | RCRC open data | navy 5 px (BRT), blue (main), teal (community), light blue (feeder), on white casing |
| | Bus stops (3,010) by shelter type | RCRC open data | terminal / BRT station / AC shelter / open shelter / pole — size and colour by type, shown progressively from zoom 11 to 15 |
| | Park-and-ride (19), on-demand zones (12) | Riyadh Bus via aqar-app — informational use | blue lots with "P", dashed green zones |
| | Regional highways, railway | Natural Earth (public domain) | red with dark casing; black/white dashes |
| OpenStreetMap | Highways (motorway, trunk) | OpenStreetMap (ODbL) | red on dark-red casing |
| | Main streets (primary, secondary) | OpenStreetMap | white on gray casing |
| | Internal streets | OpenStreetMap | gray, from zoom 14, loaded per tile |
| | Parks and green spaces | OpenStreetMap | green fill, from zoom 11 |
| | Hotels, serviced apartments, hospitals, universities, malls, attractions | OpenStreetMap | round icons: purple bed, magenta apartments, red cross, indigo cap, orange bag, brown star |
| | Mosques, schools | OpenStreetMap | small teal / ochre dots from zoom 15 |
| Places | Towns (682) | National Address via homaily | ringed disc (Riyadh), dark dot (governorate seats), small dot (villages, zoom 9+) |

## Files
- `web/` — the site (`index.html`, `app.js`, `style.css`, `data/`)
- `scripts/fetch_osm.py` — OpenStreetMap download and preparation (runs on GitHub)
- `scripts/rcrc_transport.py` — builds metro and bus layers from RCRC open data (`data_src/rcrc/`; `--download` refreshes from the portal)
- Full-resolution GIS layers: `Riyadh_General_Map.gdb` / `.gpkg` (delivered separately)

Data © OpenStreetMap contributors (ODbL), geoBoundaries (CC BY 4.0), Natural Earth, OurAirports, National Address via homaily (GPL-3.0), Royal Commission for Riyadh City open data (KSA Open Data License), Riyadh Bus via aqar-app. Boundaries and names do not imply official endorsement.
