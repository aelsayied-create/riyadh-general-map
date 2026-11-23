"""Build the metro and bus layers from Royal Commission for Riyadh City (RCRC) open data.

Source portal: https://opendata.rcrc.gov.sa  (KSA Open Data License)
  - Metro lines, metro stations by line and station type
  - Bus routes by direction, bus stops by route, direction and shelter type
With --download (used on GitHub Actions) the latest CSV exports are fetched from the portal first;
otherwise the copies in data_src/rcrc/ are used.
Output: web/data/metro_lines.geojson, metro_stations.geojson, bus_routes.geojson, bus_stops.geojson
"""
import json, os, sys, urllib.parse, urllib.request
import pandas as pd
import geopandas as gpd
from shapely.geometry import shape

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC, OUT = os.path.join(ROOT, "data_src", "rcrc"), os.path.join(ROOT, "web", "data")
PORTAL = "https://opendata.rcrc.gov.sa/api/explore/v2.1"
WANTED = {  # local file -> words that must all appear in the dataset title
    "bus-stops-2024.csv": ["bus stops", "shelter"],
    "bus-routes-2024.csv": ["bus routes"],
    "metro-lines-2024.csv": ["metro lines"],
    "metro-stations-2024.csv": ["metro stations", "station type"],
}


def download():
    """Find each dataset in the portal catalogue by title and save its CSV export."""
    for fname, words in WANTED.items():
        try:
            where = " and ".join(f'search("{w}")' for w in words)
            url = f"{PORTAL}/catalog/datasets?limit=20&select=dataset_id,metas&where={urllib.parse.quote(where)}"
            cat = json.load(urllib.request.urlopen(url, timeout=60))
            hits = [r for r in cat.get("results", []) if all(w in r["metas"]["default"]["title"].lower() for w in words)]
            if not hits:
                print(f"  {fname}: not found in catalogue, keeping local copy"); continue
            hits.sort(key=lambda r: r["metas"]["default"].get("modified") or "", reverse=True)
            ds = hits[0]["dataset_id"]
            exp = f"{PORTAL}/catalog/datasets/{ds}/exports/csv?delimiter=%2C&lang=en"
            data = urllib.request.urlopen(exp, timeout=120).read()
            if len(data) > 1000:
                open(os.path.join(SRC, fname), "wb").write(data); print(f"  {fname}: updated from {ds}")
        except Exception as e:
            print(f"  {fname}: download failed ({e}), keeping local copy")


def geo(df, col="Geographical coordinates"):
    df = df[df[col].notna()].copy()
    return gpd.GeoDataFrame(df, geometry=df[col].map(lambda s: shape(json.loads(s))), crs=4326).drop(columns=[col, "geo_point_2d"], errors="ignore")


def dump(g, name, props, prec=6):
    js = json.loads(g[props + ["geometry"]].to_json(drop_id=True, na="drop"))
    def rr(c): return [rr(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], prec), round(c[1], prec)]
    for f in js["features"]: f["geometry"]["coordinates"] = rr(f["geometry"]["coordinates"])
    json.dump(js, open(os.path.join(OUT, name), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  {name}: {len(js['features'])} features, {os.path.getsize(os.path.join(OUT, name)) // 1024} KB")


def read(f): return pd.read_csv(os.path.join(SRC, f), encoding="utf-8-sig").rename(columns=lambda c: c.replace("\xa0", " ").strip())


if "--download" in sys.argv: download()

# ---- metro lines
COL_AR = {1: "الأزرق", 2: "الأحمر", 3: "البرتقالي", 4: "الأصفر", 5: "الأخضر", 6: "البنفسجي"}
ml = geo(read("metro-lines-2024.csv"))
ml["line_id"] = ml["Metro line number"].astype(str).str.extract(r"(\d+)")[0].astype(int)
ml["name_ar"] = "المسار " + ml.line_id.map(COL_AR)
ml["corridor_ar"] = ml["اسم خط المترو"]; ml["corridor_en"] = ml["Metro line name"]; ml["color"] = ml["Metro line color code"]
ml["length_km"] = (ml.to_crs(32638).length / 1000).round(1)
ml = ml.sort_values("line_id")

# ---- metro stations (one row per station; interchanges = several lines within 150 m)
ms = geo(read("metro-stations-2024.csv"))
ms["line_id"] = ms["Metro line number"].astype(int)
TYPE_AR = {"Elevated": "مرتفعة", "Deep Underground": "تحت الأرض (عميقة)", "Shallow Underground": "تحت الأرض (سطحية)", "At Grade": "على مستوى الأرض"}
ms = ms.rename(columns={"Station code": "stop_id", "Station name": "name_en", "اسم المحطة": "name_ar"})
ms["type_ar"] = ms["Station type"].map(TYPE_AR).fillna(ms["نوع المحطة"])
mu, su = ml.to_crs(32638), ms.to_crs(32638)
ms["lines"] = [",".join(str(i) for i in sorted(set([r.line_id] + [l.line_id for l in mu.itertuples() if l.geometry.distance(p) < 150])))
               for r, p in zip(ms.itertuples(), su.geometry)]
ms = ms.drop_duplicates("stop_id")
ms["interchange"] = ms["lines"].str.contains(",")
ms["color"] = ms.line_id.map(dict(zip(ml.line_id, ml.color)))

# ---- bus routes (official RCRC alignments), one shape per line for display
rl = json.load(open(os.path.join(ROOT, "data_src", "riyadhbus_route_list.json")))["bus"]
brt = {str(r["routeNumber"]) for r in rl if r.get("isBRT")}
br = geo(read("bus-routes-2024.csv"))
br["line"] = br["Bus line"].astype(str).str.replace(r"\.0$", "", regex=True)
def kind(n):
    if n in brt: return "brt"
    v = int(n) if n.isdigit() else 999
    return "main" if v < 100 else ("community" if v < 900 else "feeder")
br["kind"] = br.line.map(kind)
br["from_en"], br["to_en"] = br["Origin of the line"], br["Destination of the line"]
br["from_ar"] = br["منشأ المسار"]; br["to_ar"] = br.get("جهة الوصول", br.get("جهة الوصول"))
br["length_km"] = (br.to_crs(32638).length / 1000).round(1)
br = br.sort_values(["line", "Direction"]).drop_duplicates("line")          # one direction per line on the map
br["geometry"] = br.geometry.simplify(0.00003)

# ---- bus stops by shelter type
bs = geo(read("bus-stops-2024.csv"))
SHELTER = {"BRT station": ("brt", "محطة نقل سريع (BRT)"), "Terminal": ("terminal", "محطة طرفية"), "Iconic Metro Station": ("terminal", "محطة مترو أيقونية"),
           "Large air conditioned shelter": ("ac_large", "مظلة مكيفة كبيرة"), "Air conditioned shelter": ("ac", "مظلة مكيفة"),
           "Open shelter": ("open", "مظلة مفتوحة"), "Feeder pole with standard site adaptation": ("pole", "عمود توقف"),
           "Feeder pole with reduced site adaptation": ("pole", "عمود توقف")}
bs["shelter"] = bs["Shelter type"].map(lambda t: SHELTER.get(t, ("pole", "نقطة توقف"))[0])
bs["shelter_ar"] = bs["Shelter type"].map(lambda t: SHELTER.get(t, ("pole", "نقطة توقف"))[1])
bs["line"] = bs["Bus line"].astype(str).str.replace(r"\.0$", "", regex=True).replace("nan", "")
bs = bs.rename(columns={"Bus station code": "stop_id", "Bus station name": "name_en", "اسم موقف الحافلات": "name_ar", "Development stage": "stage"})

os.makedirs(OUT, exist_ok=True)
dump(ml, "metro_lines.geojson", ["line_id", "name_ar", "corridor_ar", "corridor_en", "color", "length_km"], 6)
dump(ms, "metro_stations.geojson", ["stop_id", "name_ar", "name_en", "line_id", "lines", "color", "interchange", "type_ar"], 6)
dump(br, "bus_routes.geojson", ["line", "kind", "from_ar", "to_ar", "from_en", "to_en", "length_km"], 5)
dump(bs, "bus_stops.geojson", ["stop_id", "name_ar", "name_en", "shelter", "shelter_ar", "line", "stage"], 5)
print("kinds:", br.kind.value_counts().to_dict(), "| shelters:", bs.shelter.value_counts().to_dict(), "| interchanges:", int(ms.interchange.sum()))
