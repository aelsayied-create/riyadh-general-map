"""Download OpenStreetMap data for Riyadh with the Overpass API and prepare web layers.

Runs on GitHub Actions (see .github/workflows/osm-and-pages.yml), which has internet access.
Output: web/data/osm/  (manifest.json, roads.geojson, parks.geojson, poi_*.geojson, streets/<cell>.geojson)
Data © OpenStreetMap contributors, ODbL 1.0.
"""
import json, math, os, subprocess, sys, time, urllib.parse, urllib.request
import geopandas as gpd
import pandas as pd
from shapely.geometry import box

BBOX = (24.40, 46.40, 25.10, 47.05)          # south, west, north, east (Riyadh metropolitan area)
CELL = 0.05                                   # street tiles are CELL x CELL degrees
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "data", "osm")
RAW = os.path.join(os.path.dirname(__file__), "..", "build", "osm_raw")
ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter",
             "https://overpass.private.coffee/api/interpreter"]
os.makedirs(OUT, exist_ok=True); os.makedirs(RAW, exist_ok=True)


def overpass(query, tag):
    """Run a query (with retries / fallback endpoints) and return a GeoDataFrame via osmtogeojson."""
    raw, gj = os.path.join(RAW, tag + ".json"), os.path.join(RAW, tag + ".geojson")
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(8):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "riyadh-general-map (GitHub Actions)"})
            with urllib.request.urlopen(req, timeout=400) as r, open(raw, "wb") as f:
                f.write(r.read())
            break
        except Exception as e:  # 429/504/timeouts: wait and try the next endpoint
            print(f"  {tag}: {url} failed ({e}); retrying", flush=True)
            time.sleep(20 + 20 * attempt)
    else:
        sys.exit(f"Overpass failed for {tag}")
    subprocess.run(["osmtogeojson", raw], stdout=open(gj, "w"), check=True)
    g = gpd.read_file(gj) if os.path.getsize(gj) > 60 else gpd.GeoDataFrame(geometry=[], crs=4326)
    print(f"  {tag}: {len(g)} features", flush=True)
    return g


def q(body, out="geom"):
    s, w, n, e = BBOX
    return f"[out:json][timeout:360][maxsize:1073741824][bbox:{s},{w},{n},{e}];({body});out {out};"


def names(g):
    for c in ("name", "name:ar", "name:en"):
        if c not in g.columns: g[c] = None
    g["name_ar"] = g["name:ar"].fillna(g["name"])
    g["name_en"] = g["name:en"].fillna(g["name"].where(~g["name"].fillna("").str.contains(r"[؀-ۿ]")))
    return g


def save(g, name, cols, prec=6):
    g = g[[c for c in cols if c in g.columns] + ["geometry"]].copy()
    js = json.loads(g.to_json(drop_id=True, na="drop"))
    def rr(c): return [rr(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], prec), round(c[1], prec)]
    for f in js["features"]:
        if f["geometry"]: f["geometry"]["coordinates"] = rr(f["geometry"]["coordinates"])
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(js, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return len(js["features"])


manifest = {"generated": time.strftime("%Y-%m-%d"), "bbox": BBOX, "cell": CELL, "layers": {}}

# ---- 1. main roads (motorway/trunk = highways, primary/secondary = main streets)
roads = overpass(q('way["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"];'), "roads")
roads = names(roads[roads.geom_type.isin(["LineString", "MultiLineString"])])
for c in ("highway", "ref", "oneway"):
    if c not in roads.columns: roads[c] = None
roads["class"] = roads["highway"].str.replace("_link", "", regex=False)
roads["geometry"] = roads.geometry.simplify(0.00003)
manifest["layers"]["roads"] = save(roads, "roads.geojson", ["name_ar", "name_en", "class", "ref", "oneway"])

# ---- 2. internal streets, tiled so the browser only loads what is on screen
s, w, n, e = BBOX
cells = []
for i in range(math.ceil((e - w) / 0.1)):
    for j in range(math.ceil((n - s) / 0.1)):
        bw, bs = w + i * 0.1, s + j * 0.1
        part = overpass(f'[out:json][timeout:300][bbox:{bs},{bw},{bs + 0.1},{bw + 0.1}];'
                        f'(way["highway"~"^(tertiary|tertiary_link|residential|unclassified|living_street|pedestrian)$"];);out geom;', f"streets_{i}_{j}")
        if len(part): cells.append(part)
        time.sleep(5)
streets = names(pd.concat(cells)) if cells else gpd.GeoDataFrame(geometry=[], crs=4326)
streets = streets[streets.geom_type.isin(["LineString", "MultiLineString"])]
streets = streets.drop_duplicates(subset=["id"]) if "id" in streets.columns else streets
if "highway" not in streets.columns: streets["highway"] = None
streets["class"] = streets["highway"].str.replace("_link", "", regex=False)
rep = streets.geometry.representative_point()
streets["cx"] = ((rep.x - w) // CELL).astype(int); streets["cy"] = ((rep.y - s) // CELL).astype(int)
tiles = []
for (cx, cy), g in streets.groupby(["cx", "cy"]):
    save(g, f"streets/{cx}_{cy}.geojson", ["name_ar", "name_en", "class"]); tiles.append([int(cx), int(cy)])
manifest["layers"]["streets"] = len(streets); manifest["street_tiles"] = tiles

# ---- 3. parks and green spaces
parks = overpass(q('nwr["leisure"~"^(park|garden|recreation_ground|nature_reserve)$"];'
                   'nwr["landuse"~"^(grass|recreation_ground|village_green|forest)$"];'), "parks")
parks = names(parks[parks.geom_type.isin(["Polygon", "MultiPolygon"])])
for c in ("leisure", "landuse"):
    if c not in parks.columns: parks[c] = None
parks["kind"] = parks["leisure"].fillna(parks["landuse"])
parks["geometry"] = parks.geometry.simplify(0.00002)
parks = parks[parks.to_crs(32638).area > 300]      # drop tiny grass strips (< 300 m²)
manifest["layers"]["parks"] = save(parks, "parks.geojson", ["name_ar", "name_en", "kind"])

# ---- 4. points of interest (nodes, and the centre of buildings / areas)
POI = {
    "hotels":       'nwr["tourism"~"^(hotel|motel|guest_house|hostel)$"];',
    "apartments":   'nwr["tourism"="apartment"];',
    "hospitals":    'nwr["amenity"~"^(hospital|clinic)$"];',
    "universities": 'nwr["amenity"~"^(university|college)$"];',
    "schools":      'nwr["amenity"="school"];',
    "mosques":      'nwr["amenity"="place_of_worship"]["religion"="muslim"];',
    "malls":        'nwr["shop"="mall"];',
    "attractions":  'nwr["tourism"~"^(museum|attraction|viewpoint|gallery|zoo|theme_park)$"];',
}
for key, body in POI.items():
    g = overpass(q(body, "center"), "poi_" + key)
    if len(g):
        g = names(g); g["geometry"] = g.geometry.representative_point()
        for c in ("tourism", "amenity", "shop", "stars", "beds", "operator"):
            if c not in g.columns: g[c] = None
        g["kind"] = g["tourism"].fillna(g["amenity"]).fillna(g["shop"])
        g = g[g.name_ar.notna() | g.name_en.notna() | (key in ("mosques", "schools"))]
    manifest["layers"][key] = save(g, f"poi_{key}.geojson", ["name_ar", "name_en", "kind", "stars", "operator"]) if len(g) else 0
    time.sleep(5)

# ---- 5. bus routes (OSM route relations; official stops come from Riyadh Bus)
br = overpass(q('relation["route"="bus"];'), "bus_routes")
if len(br):
    br = names(br[br.geom_type.isin(["LineString", "MultiLineString"])])
    for c in ("ref", "colour", "from", "to", "operator", "network"):
        if c not in br.columns: br[c] = None
    br["geometry"] = br.geometry.simplify(0.00003)
    manifest["layers"]["bus_routes"] = save(br, "bus_routes.geojson", ["ref", "name_ar", "name_en", "colour", "from", "to", "operator"])
else:
    manifest["layers"]["bus_routes"] = 0

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print(json.dumps(manifest["layers"], indent=1))
