# Riyadh General Map · الخريطة العامة للرياض

Leaflet map of Riyadh Region built from open data, with coordinate search (decimal, DMS, UTM 38N), drawing tools with KML export, four background maps and a built-in password.

## Password
Built-in password: **`Riyadh@2026`**
- Netlify server check: `DEFAULT_PASSWORD` in `netlify/edge-functions/password.ts` (override with `netlify env:set PROTECTED_PAGE_PASSWORD "..."`).
- Page password screen: `PW_HASH` in `web/app.js` (SHA-256 of the password).
  - Python: `python -c "import hashlib;print(hashlib.sha256(b'NewPass').hexdigest())"`

## Deploy to Netlify
```bash
netlify login
netlify sites:create --name riyadh-general-map
netlify deploy --prod
```

## Layers and symbology
| Layer | Source | Symbol |
|---|---|---|
| Riyadh Region | geoBoundaries ADM1 (CC BY 4.0) | dark 2.2 px line on a white halo |
| Governorates (23) | geoBoundaries ADM2 (CC BY 4.0); Arabic names added | brown dash-dot line |
| Districts (711) | National Address (maps.address.gov.sa) via homaily/Saudi-Arabia-Regions-Cities-and-Districts (GPL-3.0) | thin outline, light fill, highlights on hover; names from zoom 12.5 |
| Riyadh Metro (6 lines) | Riyadh Bus (riyadhbus.sa) via aqar-app/Riyadh-Metro-Routes-and-Stations — informational use, not an open licence | official line colours on a white casing |
| Metro stations (83) | same | white disc ringed in line colour; interchanges larger with a black ring; from zoom 10, names from 13 |
| Highways | Natural Earth 1:10m (public domain) | orange on dark casing (major), yellow (other) |
| Railway | Natural Earth | black/white dashed |
| Airport | Natural Earth | circular plane icon |
| Towns (682) | National Address via homaily | ringed white disc (Riyadh), dark dot (governorate seats), small dot (villages, from zoom 9) |

Background maps: Gray (Esri), OpenStreetMap (ODbL), Streets (Esri), Satellite (Esri).

## Data files
`data/*.geojson` are simplified for the web. Full-resolution layers are in `Riyadh_General_Map.gdb` / `.gpkg` (delivered separately).
