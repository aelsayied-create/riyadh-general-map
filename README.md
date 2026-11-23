# Riyadh General Map · الخريطة العامة للرياض

Leaflet web map of Riyadh Region built from open data: coordinate search (decimal, DMS, UTM 38N), drawing tools with KML export, four background maps (Gray, OpenStreetMap, Streets, Satellite). Arabic, right-to-left. No password.

## How it is published (GitHub Pages)
Every push to `main` runs `.github/workflows/osm-and-pages.yml`:
1. If `web/data/osm/` is empty (first run), it downloads OpenStreetMap data for Riyadh with the Overpass API (`scripts/fetch_osm.py`) and commits it.
2. It publishes the `web/` folder to GitHub Pages.

The OpenStreetMap data is refreshed automatically on the 1st of every month. To refresh it now: **Actions → OpenStreetMap data + GitHub Pages → Run workflow**.

If the first run stops at "configure-pages": open **Settings → Pages**, set **Source: GitHub Actions**, then re-run the workflow.

## Layers and symbology
| Group | Layer | Source | Symbol |
|---|---|---|---|
| Boundaries | Riyadh Region | geoBoundaries ADM1 (CC BY 4.0) | dark line on a white halo |
| | Governorates (23) | geoBoundaries ADM2; Arabic names added | brown dash-dot line |
| | Districts (711) | National Address (maps.address.gov.sa) via homaily (GPL-3.0) | thin outline, hover highlight, names from zoom 12.5 |
| Transport | Riyadh Metro (6 lines), stations (83) | Riyadh Bus (riyadhbus.sa) via aqar-app — informational use | official line colours on white casing; white station discs, interchanges with black ring |
| | Airports (24) and helipads (22) | OurAirports (public domain) | icon per class: international, domestic, under construction, air base, airstrip, helipad |
| | Bus stops (2,430), park-and-ride (19), on-demand zones (12) | Riyadh Bus via aqar-app | blue dots (from zoom 12.5), blue lots with "P", dashed green zones |
| | Bus routes | OpenStreetMap | route colour on white casing |
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
- Full-resolution GIS layers: `Riyadh_General_Map.gdb` / `.gpkg` (delivered separately)

Data © OpenStreetMap contributors (ODbL), geoBoundaries (CC BY 4.0), Natural Earth, OurAirports, National Address via homaily (GPL-3.0), Riyadh Bus via aqar-app. Boundaries and names do not imply official endorsement.
