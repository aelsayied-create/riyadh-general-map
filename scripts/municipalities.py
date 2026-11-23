"""Build Riyadh sub-municipality (البلديات الفرعية) boundaries from open data.

RCRC open data publishes service points tagged with their sub-municipality and district
(e.g. "Commercial services by category, sub-municipality and district (2024)").
Each district polygon (web/data/districts.geojson) takes the sub-municipality that most of
its points belong to; districts are then dissolved into sub-municipality polygons.
Runs on GitHub Actions (needs internet). Output: web/data/municipalities.geojson
"""
import json, os, re, sys, urllib.request
import geopandas as gpd
import pandas as pd

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "web", "data", "municipalities.geojson")
API = "https://opendata.rcrc.gov.sa/api/explore/v2.1/catalog/datasets/{}/exports/geojson?lang=en"
DATASETS = ["commercial-services-by-category-sub-municipality-and-district-2024",
            "entertainment-services-by-sub-municipality-and-district-2024"]


def fetch(ds):
    path = os.path.join(ROOT, "build", ds + ".geojson")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(API.format(ds), timeout=300) as r, open(path, "wb") as f:
        f.write(r.read())
    return gpd.read_file(path)


pts = []
for ds in DATASETS:
    try:
        g = fetch(ds); print(f"{ds}: {len(g)} points; fields {list(g.columns)}"); pts.append(g)
    except Exception as e:
        print(f"{ds}: failed ({e})")
if not pts:
    sys.exit("no sub-municipality data downloaded; municipalities.geojson not changed")
pts = pd.concat(pts, ignore_index=True)
pts = gpd.GeoDataFrame(pts, geometry="geometry", crs=4326)
pts = pts[pts.geometry.notna() & (pts.geom_type == "Point")]

cols = [c for c in pts.columns if c != "geometry"]
def pick(pattern, avoid="code"):
    c = [x for x in cols if re.search(pattern, x, re.I) and not re.search(avoid, x, re.I)]
    return c[0] if c else None
name_en = pick(r"sub.?municipal")
name_ar = pick(r"البلدية")
code = next((x for x in cols if re.search(r"sub.?municipal", x, re.I) and re.search("code", x, re.I)), None)
print("using fields:", name_en, name_ar, code)
if not name_en and not name_ar:
    sys.exit("sub-municipality field not found")
key = name_en or name_ar
pts = pts[pts[key].notna()]

dist = gpd.read_file(os.path.join(ROOT, "web", "data", "districts.geojson"))
j = gpd.sjoin(pts[[key] + [c for c in (name_ar, code) if c and c != key] + ["geometry"]], dist[["district_id", "geometry"]], predicate="within")
vote = j.groupby(["district_id", key]).size().reset_index(name="n").sort_values("n", ascending=False).drop_duplicates("district_id")
attrs = j.drop_duplicates(key).set_index(key)
dist = dist.merge(vote[["district_id", key]], on="district_id", how="inner")
mun = dist.dissolve(by=key, as_index=False)[[key, "geometry"]]
mun["name_en"] = mun[key].astype(str).str.replace(r"\s*sub-?municipality\s*", "", flags=re.I, regex=True).str.strip()
mun["name_ar"] = mun[key].map(attrs[name_ar]) if name_ar and name_ar != key else (mun[key] if key == name_ar else None)
mun["name_ar"] = mun["name_ar"].astype("string").str.replace(r"^\s*بلدية\s+", "", regex=True).str.strip()
if code: mun["code"] = mun[key].map(attrs[code]).astype(str)
mun["districts"] = mun[key].map(dist.groupby(key).size())
mun["area_km2"] = (mun.to_crs(32638).area / 1e6).round(1)
mun["geometry"] = mun.geometry.buffer(0.0003).buffer(-0.0003).simplify(0.0002)   # close slivers between districts
keep = ["name_ar", "name_en", "districts", "area_km2"] + (["code"] if code else [])
mun = mun[keep + ["geometry"]]
mun.to_file(OUT, driver="GeoJSON")
print(f"{len(mun)} sub-municipalities written to {OUT}")
print(mun.drop(columns="geometry").to_string())
