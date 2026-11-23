"""Riyadh sub-municipalities (البلديات الفرعية) from open data.

District polygons: web/data/districts.geojson (National Address via homaily).
District -> sub-municipality: data_src/district_municipality.csv, compiled from the neighbourhood
lists on the Wikipedia pages of each Riyadh sub-municipality and the Amanat Riyadh website;
districts not named on any list take the neighbouring sub-municipality with the longest shared border.
Output: web/data/municipalities.geojson
"""
import os
import geopandas as gpd, pandas as pd
ROOT = os.path.join(os.path.dirname(__file__), "..")
d = gpd.read_file(os.path.join(ROOT, "web", "data", "districts.geojson"))
m = pd.read_csv(os.path.join(ROOT, "data_src", "district_municipality.csv"), dtype={"district_id": str})
d["district_id"] = d["district_id"].astype(str)
d = d.merge(m[["district_id", "mun"]], on="district_id", how="inner")
u = d.to_crs(32638).dissolve(by="mun", as_index=False)
u["geometry"] = u.geometry.buffer(40).buffer(-40).simplify(15)          # close slivers between districts
u = u.to_crs(4326)
u["name_ar"] = u.mun.str.split("|").str[0]; u["name_en"] = u.mun.str.split("|").str[1]
u["districts"] = u.mun.map(d.groupby("mun").size())
u["area_km2"] = (u.to_crs(32638).area / 1e6).round(1)
u[["name_ar", "name_en", "districts", "area_km2", "geometry"]].to_file(os.path.join(ROOT, "web", "data", "municipalities.geojson"), driver="GeoJSON")
print(u[["name_ar", "name_en", "districts", "area_km2"]].to_string())
