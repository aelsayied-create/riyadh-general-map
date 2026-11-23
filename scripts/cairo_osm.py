"""OpenStreetMap layers for Greater Cairo from the Geofabrik Egypt extract.

Writes web/data/osm/: manifest.json, roads, rail, water, waterways, parks, metro_lines, metro_stations,
admin (boundaries by admin_level), bus_stops, poi_<kind>.geojson and streets/<cx>_<cy>.geojson.
Data © OpenStreetMap contributors, ODbL 1.0.
"""
import json, os, re, shutil, subprocess, sys, time, urllib.request
from collections import defaultdict, Counter
import osmium
from shapely import wkb
from shapely.geometry import box, mapping, MultiLineString
from shapely.ops import linemerge, unary_union

BBOX = (29.80, 30.85, 30.32, 31.90)          # south, west, north, east: Greater Cairo incl. Giza, 6 October, New Cairo, New Capital
CELL = 0.05
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "data", "osm")
RAW = os.path.join(HERE, "..", "build", "osm_raw")
URL = "https://download.geofabrik.de/africa/egypt-latest.osm.pbf"
os.makedirs(OUT, exist_ok=True); os.makedirs(RAW, exist_ok=True)
S, W, N, E = BBOX
CLIP = box(W, S, E, N)

src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAW, "egypt-latest.osm.pbf")
if not os.path.exists(src):
    print("downloading", URL, flush=True)
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": "egypt-general-map (GitHub Actions)"})
            with urllib.request.urlopen(req, timeout=900) as r, open(src + ".part", "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            os.replace(src + ".part", src); break
        except Exception as e:
            print("  download failed:", e, flush=True); time.sleep(30)
    else:
        sys.exit("Geofabrik download failed")
pbf = src
if shutil.which("osmium"):
    pbf = os.path.join(RAW, "cairo.osm.pbf")
    subprocess.run(["osmium", "extract", "-b", f"{W},{S},{E},{N}", "-s", "smart", "-S", "types=multipolygon,boundary,route",
                    "--overwrite", "-o", pbf, src], check=True)
print("reading", pbf, f"({os.path.getsize(pbf) / 1e6:.0f} MB)", flush=True)

ROAD = {"motorway", "trunk", "primary", "secondary"}
STREET = {"tertiary", "residential", "unclassified", "living_street", "pedestrian"}
PARK_LEISURE = {"park", "garden", "recreation_ground", "nature_reserve", "golf_course"}
PARK_LANDUSE = {"grass", "recreation_ground", "village_green", "forest"}
TRANSIT = {"subway": "metro", "light_rail": "lrt", "monorail": "monorail", "tram": "tram"}
AR = re.compile(r"[؀-ۿ]")


def poi_kind(t):
    tour, amen, hist = t.get("tourism"), t.get("amenity"), t.get("historic")
    if tour in ("hotel", "motel", "guest_house", "hostel"): return "hotels"
    if tour == "apartment": return "apartments"
    if amen in ("hospital", "clinic"): return "hospitals"
    if amen in ("university", "college"): return "universities"
    if amen == "school": return "schools"
    if amen == "place_of_worship":
        rel = t.get("religion")
        if rel == "muslim": return "mosques"
        if rel == "christian": return "churches"
        return None
    if t.get("shop") == "mall": return "malls"
    if tour in ("museum", "attraction", "viewpoint", "gallery", "zoo", "theme_park"): return "attractions"
    if hist in ("archaeological_site", "castle", "monument", "ruins", "tomb", "fort", "city_gate"): return "attractions"
    return None


def names(t):
    n, ar, en = t.get("name"), t.get("name:ar"), t.get("name:en")
    return {"name_ar": ar or n, "name_en": en or (n if n and not AR.search(n) else None)}


def poi_props(t):
    return {**names(t), "kind": t.get("tourism") or t.get("historic") or t.get("amenity") or t.get("shop"),
            "stars": t.get("stars"), "operator": t.get("operator")}


# ---------- pass 1: transit route relations → member way ids
routes = {}
need_ways = set()
for o in osmium.FileProcessor(pbf, osmium.osm.RELATION):
    t = {k: v for k, v in o.tags}
    if t.get("type") == "route" and t.get("route") in TRANSIT:
        ways = [m.ref for m in o.members if m.type == "w"]
        routes[o.id] = (t, ways); need_ways.update(ways)
print("transit relations:", len(routes), flush=True)

# ---------- pass 2: everything else
wkbf = osmium.geom.WKBFactory()
L = lambda o: wkb.loads(wkbf.create_linestring(o), hex=True)
roads, streets, parks, water, waterways, rail, admin, stations, bus = ([] for _ in range(9))
way_geom = {}
pois = defaultdict(list); seen_poi = set()

for o in osmium.FileProcessor(pbf).with_locations().with_areas():
    t = {k: v for k, v in o.tags}
    try:
        if o.is_way():
            if o.id in need_ways:
                way_geom[o.id] = L(o)
            if not t: continue
            cls = t.get("highway", "").replace("_link", "")
            if cls in ROAD or cls in STREET:
                g = L(o)
                if not g.intersects(CLIP): continue
                p = {**names(t), "class": cls}
                if cls in ROAD:
                    p.update({"ref": t.get("ref"), "oneway": t.get("oneway")}); roads.append((g, p))
                else:
                    streets.append((g, p))
            elif t.get("railway") in ("rail", "subway", "light_rail", "monorail") and t.get("service") is None:
                g = L(o)
                if g.intersects(CLIP): rail.append((g, {**names(t), "kind": t["railway"], "usage": t.get("usage")}))
            elif t.get("waterway") in ("river", "canal"):
                g = L(o)
                if g.intersects(CLIP): waterways.append((g, {**names(t), "kind": t["waterway"]}))
        elif o.is_area():
            if not t: continue
            lei, lu, nat = t.get("leisure"), t.get("landuse"), t.get("natural")
            kind = poi_kind(t)
            is_park = lei in PARK_LEISURE or lu in PARK_LANDUSE
            is_water = nat == "water" or t.get("waterway") == "riverbank" or lu in ("reservoir", "basin")
            is_admin = t.get("boundary") == "administrative" and t.get("admin_level") in ("4", "5", "6", "7", "8", "9", "10") and not o.from_way()
            st = t.get("railway") == "station" and (t.get("station") in TRANSIT or any(t.get(k) == "yes" for k in TRANSIT))
            if not (is_park or is_water or is_admin or kind or st): continue
            g = wkb.loads(wkbf.create_multipolygon(o), hex=True)
            if not g.intersects(CLIP): continue
            if is_park: parks.append((g, {**names(t), "kind": lei if lei in PARK_LEISURE else lu}))
            if is_water: water.append((g, {**names(t), "kind": t.get("water") or nat or lu}))
            if is_admin: admin.append((g, {**names(t), "level": int(t["admin_level"]), "osm_id": o.orig_id()}))
            key = ("w" if o.from_way() else "r") + str(o.orig_id())
            if kind and key not in seen_poi:
                seen_poi.add(key); pois[kind].append((g.representative_point(), poi_props(t)))
            if st and key not in seen_poi:
                seen_poi.add(key)
                stations.append((g.representative_point(), {**names(t), "kind": t.get("station") or next(k for k in TRANSIT if t.get(k) == "yes")}))
        elif o.is_node():
            if not t: continue
            kind = poi_kind(t)
            st = t.get("railway") in ("station", "halt") and (t.get("station") in TRANSIT or any(t.get(k) == "yes" for k in TRANSIT))
            busstop = t.get("highway") == "bus_stop" or (t.get("public_transport") == "platform" and t.get("bus") == "yes")
            if not (kind or st or busstop): continue
            g = wkb.loads(wkbf.create_point(o), hex=True)
            if not CLIP.contains(g): continue
            if kind: pois[kind].append((g, poi_props(t)))
            if st: stations.append((g, {**names(t), "kind": t.get("station") or next((k for k in TRANSIT if t.get(k) == "yes"), "subway")}))
            if busstop: bus.append((g, {**names(t), "operator": t.get("operator")}))
    except Exception:
        continue

# ---------- transit lines: merge per (mode, ref/name)
lines = defaultdict(lambda: {"geoms": [], "tags": None})
for rid, (t, ways) in routes.items():
    gs = [way_geom[w] for w in ways if w in way_geom]
    if not gs: continue
    key = (t["route"], t.get("ref") or t.get("name:en") or t.get("name"))
    d = lines[key]; d["geoms"] += gs
    if d["tags"] is None or (t.get("colour") and not d["tags"].get("colour")): d["tags"] = t
metro_lines = []
for (mode, ref), d in lines.items():
    g = linemerge(unary_union(d["geoms"]))
    if not g.intersects(CLIP): continue
    t = d["tags"]
    metro_lines.append((g, {**names(t), "mode": TRANSIT[mode], "ref": t.get("ref"), "colour": t.get("colour"),
                            "network": t.get("network"), "operator": t.get("operator")}))
# stations: attach nearest line
for g, p in stations:
    best = min(((ln.distance(g), lp) for ln, lp in metro_lines), default=(9, None), key=lambda x: x[0])
    if best[1] is not None and best[0] < 0.004:
        p["line"] = best[1].get("ref") or best[1].get("name_en"); p["mode"] = best[1]["mode"]; p["colour"] = best[1].get("colour")
    p.setdefault("mode", TRANSIT.get(p.get("kind"), "metro"))


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


man = {"generated": time.strftime("%Y-%m-%d"), "source": "Geofabrik egypt extract", "bbox": BBOX, "cell": CELL, "layers": {}}
lay = man["layers"]
lay["roads"] = save(roads, "roads.geojson", simplify=0.00003)
lay["rail"] = save(rail, "rail.geojson", simplify=0.00003)
lay["waterways"] = save(waterways, "waterways.geojson", simplify=0.00003)
lay["water"] = save([(g, p) for g, p in water if g.area > 2000 / 1.1e10], "water.geojson", simplify=0.00002)
lay["parks"] = save([(g, p) for g, p in parks if g.area > 300 / 1.1e10], "parks.geojson", simplify=0.00002)
lay["metro_lines"] = save(metro_lines, "metro_lines.geojson", simplify=0.00002)
lay["metro_stations"] = save(stations, "metro_stations.geojson")
lay["bus_stops"] = save(bus, "bus_stops.geojson")
lay["admin"] = save(admin, "admin.geojson", simplify=0.00005)
man["admin_levels"] = dict(Counter(p["level"] for _, p in admin))
for k in ("hotels", "apartments", "hospitals", "universities", "schools", "mosques", "churches", "malls", "attractions"):
    items = pois.get(k, [])
    if k not in ("mosques", "schools", "churches"): items = [(g, p) for g, p in items if p.get("name_ar") or p.get("name_en")]
    lay[k] = save(items, f"poi_{k}.geojson")

shutil.rmtree(os.path.join(OUT, "streets"), ignore_errors=True)
tiles = defaultdict(list)
for g, p in streets:
    c = g.representative_point()
    tiles[(int((c.x - W) // CELL), int((c.y - S) // CELL))].append((g, p))
for (cx, cy), items in sorted(tiles.items()):
    save(items, f"streets/{cx}_{cy}.geojson", simplify=0.00001)
lay["streets"] = len(streets)
man["street_tiles"] = [list(k) for k in sorted(tiles)]
man["metro"] = [{"mode": p["mode"], "ref": p.get("ref"), "name": p.get("name_en") or p.get("name_ar"), "colour": p.get("colour")} for _, p in metro_lines]
json.dump(man, open(os.path.join(OUT, "manifest.json"), "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in man.items() if k != "street_tiles"}, indent=1, ensure_ascii=False))
