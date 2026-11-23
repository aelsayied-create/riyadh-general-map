"""Prepare OpenStreetMap layers for Riyadh from a Geofabrik extract (no Overpass, no live queries).

Steps (run on GitHub Actions, which has internet access):
  1. download gcc-states-latest.osm.pbf from Geofabrik (or use a .pbf given as argument)
  2. cut the Riyadh box with osmium-tool (if installed) to speed things up
  3. read it once with pyosmium and write web/data/osm/:
       manifest.json, roads.geojson, parks.geojson, poi_<kind>.geojson, streets/<cx>_<cy>.geojson
Data © OpenStreetMap contributors, ODbL 1.0.
"""
import json, math, os, re, shutil, subprocess, sys, time, urllib.request
from collections import defaultdict
import osmium
from shapely import wkb
from shapely.geometry import box, mapping

BBOX = (24.40, 46.40, 25.10, 47.05)          # south, west, north, east (Riyadh metropolitan area)
CELL = 0.05                                   # street tiles are CELL x CELL degrees
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "data", "osm")
RAW = os.path.join(HERE, "..", "build", "osm_raw")
URL = "https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf"
os.makedirs(OUT, exist_ok=True); os.makedirs(RAW, exist_ok=True)
S, W, N, E = BBOX
CLIP = box(W, S, E, N)

# ---------------- 1-2. get the data
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAW, "gcc-states-latest.osm.pbf")
if not os.path.exists(src):
    print("downloading", URL, flush=True)
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": "riyadh-general-map (GitHub Actions)"})
            with urllib.request.urlopen(req, timeout=600) as r, open(src + ".part", "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            os.replace(src + ".part", src); break
        except Exception as e:
            print("  download failed:", e, flush=True); time.sleep(30)
    else:
        sys.exit("Geofabrik download failed")
pbf = src
if shutil.which("osmium"):
    pbf = os.path.join(RAW, "riyadh.osm.pbf")
    subprocess.run(["osmium", "extract", "-b", f"{W},{S},{E},{N}", "-s", "smart", "--overwrite", "-o", pbf, src], check=True)
print("reading", pbf, f"({os.path.getsize(pbf) / 1e6:.0f} MB)", flush=True)

# ---------------- 3. classify
ROAD = {"motorway", "trunk", "primary", "secondary"}
STREET = {"tertiary", "residential", "unclassified", "living_street", "pedestrian"}
PARK_LEISURE = {"park", "garden", "recreation_ground", "nature_reserve"}
PARK_LANDUSE = {"grass", "recreation_ground", "village_green", "forest"}
AR = re.compile(r"[؀-ۿ]")


def poi_kind(t):
    tour, amen = t.get("tourism"), t.get("amenity")
    if tour in ("hotel", "motel", "guest_house", "hostel"): return "hotels"
    if tour == "apartment": return "apartments"
    if amen in ("hospital", "clinic"): return "hospitals"
    if amen in ("university", "college"): return "universities"
    if amen == "school": return "schools"
    if amen == "place_of_worship" and t.get("religion") == "muslim": return "mosques"
    if t.get("shop") == "mall": return "malls"
    if tour in ("museum", "attraction", "viewpoint", "gallery", "zoo", "theme_park"): return "attractions"
    return None


def names(t):
    n, ar, en = t.get("name"), t.get("name:ar"), t.get("name:en")
    return {"name_ar": ar or n, "name_en": en or (n if n and not AR.search(n) else None)}


wkbf = osmium.geom.WKBFactory()
roads, streets, parks = [], [], []
pois = defaultdict(list)
seen_poi = set()

for o in osmium.FileProcessor(pbf).with_locations().with_areas():
    t = {k: v for k, v in o.tags}
    if not t: continue
    try:
        if o.is_way():
            hw = t.get("highway", "")
            cls = hw.replace("_link", "")
            if cls in ROAD or cls in STREET:
                g = wkb.loads(wkbf.create_linestring(o), hex=True)
                if not g.intersects(CLIP): continue
                p = {**names(t), "class": cls}
                if cls in ROAD:
                    p.update({"ref": t.get("ref"), "oneway": t.get("oneway")}); roads.append((g, p))
                else:
                    streets.append((g, p))
        elif o.is_area():
            lei, lu = t.get("leisure"), t.get("landuse")
            kind = poi_kind(t)
            if lei in PARK_LEISURE or lu in PARK_LANDUSE or kind:
                g = wkb.loads(wkbf.create_multipolygon(o), hex=True)
                if not g.intersects(CLIP): continue
                if lei in PARK_LEISURE or lu in PARK_LANDUSE:
                    parks.append((g, {**names(t), "kind": lei if lei in PARK_LEISURE else lu}))
                if kind:
                    key = ("w" if o.from_way() else "r") + str(o.orig_id())
                    if key not in seen_poi:
                        seen_poi.add(key)
                        pois[kind].append((g.representative_point(), {**names(t), "kind": t.get("tourism") or t.get("amenity") or t.get("shop"),
                                                                     "stars": t.get("stars"), "operator": t.get("operator")}))
        elif o.is_node():
            kind = poi_kind(t)
            if kind:
                g = wkb.loads(wkbf.create_point(o), hex=True)
                if not CLIP.contains(g): continue
                pois[kind].append((g, {**names(t), "kind": t.get("tourism") or t.get("amenity") or t.get("shop"),
                                       "stars": t.get("stars"), "operator": t.get("operator")}))
    except Exception:
        continue   # broken geometry (missing nodes at the edge of the extract)


# ---------------- 4. write
def rnd(c, prec):
    return [rnd(x, prec) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], prec), round(c[1], prec)]


def save(items, name, prec=5, simplify=0.0):
    feats = []
    for g, p in items:
        if simplify: g = g.simplify(simplify, preserve_topology=True)
        if g.is_empty: continue
        gm = mapping(g); gm["coordinates"] = rnd(gm["coordinates"], prec)
        feats.append({"type": "Feature", "properties": {k: v for k, v in p.items() if v not in (None, "")}, "geometry": gm})
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"type": "FeatureCollection", "features": feats}, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return len(feats)


manifest = {"generated": time.strftime("%Y-%m-%d"), "source": "Geofabrik gcc-states extract", "bbox": BBOX, "cell": CELL, "layers": {}}
manifest["layers"]["roads"] = save(roads, "roads.geojson", simplify=0.00003)

# parks: drop tiny grass strips (< ~300 m²; 1e-4 deg ≈ 11 m)
parks = [(g, p) for g, p in parks if g.area > 300 / (111_000 * 101_000)]
manifest["layers"]["parks"] = save(parks, "parks.geojson", simplify=0.00002)

for k in ("hotels", "apartments", "hospitals", "universities", "schools", "mosques", "malls", "attractions"):
    items = pois.get(k, [])
    if k not in ("mosques", "schools"): items = [(g, p) for g, p in items if p.get("name_ar") or p.get("name_en")]
    manifest["layers"][k] = save(items, f"poi_{k}.geojson")

shutil.rmtree(os.path.join(OUT, "streets"), ignore_errors=True)
tiles = defaultdict(list)
for g, p in streets:
    c = g.representative_point()
    tiles[(int((c.x - W) // CELL), int((c.y - S) // CELL))].append((g, p))
for (cx, cy), items in sorted(tiles.items()):
    save(items, f"streets/{cx}_{cy}.geojson", simplify=0.00001)
manifest["layers"]["streets"] = len(streets)
manifest["street_tiles"] = [list(k) for k in sorted(tiles)]

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print(json.dumps(manifest["layers"], indent=1))
