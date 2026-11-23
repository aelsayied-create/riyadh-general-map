// Riyadh General Map — Leaflet, open data prepared into Riyadh_General_Map.gdb
{
const $ = id => document.getElementById(id);

// ---------------- built-in password (SHA-256 of the password; see README to change it)
const PW_HASH = "29811764bb9dd62d077118f2d83f923c61cbcc2606d0fb15da62f38ba25845c9";
const KEY = "ryd-map-ok";
const store = { get: () => { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } },
  set: v => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch (e) {} } };
const serverOk = () => /(?:^|;\s*)rgm_ok=1/.test(document.cookie); // set by the Netlify password check
async function sha256(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
let started = false;
function unlock() { $("gate").hidden = true; document.body.classList.remove("locked"); if (!started) { started = true; start(); } }
$("gateForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (await sha256($("pw").value) === PW_HASH) { store.set(PW_HASH); unlock(); }
  else { $("gateErr").hidden = false; $("pw").select(); }
});
$("lock").addEventListener("click", () => {
  store.set(null);
  if (serverOk()) { location.href = "/__logout"; return; }
  $("pw").value = ""; $("gateErr").hidden = true; $("gate").hidden = false; document.body.classList.add("locked"); $("pw").focus();
});

// ---------------- coordinate maths
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
function toUTM(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1, a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), lon0 = ((zone - 1) * 6 - 180 + 3) * D2R;
  const φ = lat * D2R, N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2), T = Math.tan(φ) ** 2, C = ep2 * Math.cos(φ) ** 2;
  const A = Math.cos(φ) * (lon * D2R - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * φ - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * φ)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * φ) - (35 * e2 ** 3 / 3072) * Math.sin(6 * φ));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let Nn = k0 * (M + N * Math.tan(φ) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) Nn += 10000000;
  return { zone, hemi: lat >= 0 ? "N" : "S", E, N: Nn };
}
function fromUTM(zone, north, E, Nn) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = E - 500000, y = north ? Nn : Nn - 10000000, lon0 = ((zone - 1) * 6 - 180 + 3) * D2R;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const φ1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(φ1) ** 2), T1 = Math.tan(φ1) ** 2, C1 = ep2 * Math.cos(φ1) ** 2;
  const R1 = a * (1 - e2) / (1 - e2 * Math.sin(φ1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = φ1 - (N1 * Math.tan(φ1) / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / Math.cos(φ1);
  return [lat * R2D, lon * R2D];
}
const dms = (v, pos, neg) => {
  const h = v >= 0 ? pos : neg; v = Math.abs(v);
  let d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
  if (s >= 59.995) { s = 0; m++; } if (m === 60) { m = 0; d++; }
  return `${d}°${String(m).padStart(2, "0")}′${s.toFixed(2).padStart(5, "0")}″${h}`;
};
function dmsPart(s) {
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length || nums.length > 3) return null;
  let v = nums[0] + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600;
  if (/[SWsw]/.test(s) || /^\s*-/.test(s)) v = -v;
  return { v, ew: /[EWew]/.test(s), ns: /[NSns]/.test(s) };
}
const inBox = (lat, lon) => lat >= 19 && lat <= 28.5 && lon >= 41 && lon <= 49.5;
// returns {lat, lon, note} or {error}
function parse(raw) {
  let s = raw.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).trim().replace(/[’′‘`]/g, "'").replace(/[”″“]/g, '"').replace(/º/g, "°").replace(/،/g, ",");
  if (!s) return { error: "اكتب إحداثيات أولاً." };
  // UTM: "36N 329900 3325017", "36R 330000, 3324000", "36 330000 3324000"
  const u = s.match(/^(\d{1,2})\s*([A-Za-z])?\s+(\d{6}(?:\.\d+)?)\s*[,;\s]\s*(\d{6,7}(?:\.\d+)?)\s*$/);
  if (u) {
    const zone = +u[1], band = (u[2] || "N").toUpperCase();
    if (zone < 1 || zone > 60) return { error: "UTM zone must be 1–60." };
    const [lat, lon] = fromUTM(zone, band >= "N", +u[3], +u[4]);
    return { lat, lon, note: `محوّلة من UTM، النطاق ${zone}${band} (WGS 84)` };
  }
  let parts;
  if (/[,;]/.test(s)) parts = s.split(/[,;]/);
  else if (/[NSEWnsew]/.test(s)) parts = s.match(/[^NSEWnsew]+[NSEWnsew]/g) || [];
  else {
    const n = s.match(/-?\d+(?:\.\d+)?/g) || [];
    const k = n.length / 2;
    if (![1, 2, 3].includes(k)) return { error: "تعذّرت قراءة إحداثيين." };
    parts = [n.slice(0, k).join(" "), n.slice(k).join(" ")];
  }
  parts = parts.map(p => p.trim()).filter(Boolean);
  if (parts.length !== 2) return { error: "تعذّرت قراءة إحداثيين. اكتبها بالشكل: خط العرض، خط الطول" };
  const a = dmsPart(parts[0]), b = dmsPart(parts[1]);
  if (!a || !b) return { error: "تعذّرت قراءة الأرقام." };
  let lat = a.v, lon = b.v, note = "";
  if (a.ew || b.ns) { lat = b.v; lon = a.v; }
  else if (!a.ns && !b.ew && !inBox(lat, lon) && inBox(lon, lat)) {
    [lat, lon] = [lon, lat]; note = "بدا أن الترتيب خط الطول ثم خط العرض، فتم تبديلهما.";
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: "خط العرض يجب أن يكون بين ‎±90 وخط الطول بين ‎±180." };
  return { lat, lon, note };
}

// ---------------- geometry helpers
function inRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function inGeom(x, y, g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
}
const hit = (fc, lat, lon) => fc.features.find(f => inGeom(lon, lat, f.geometry));
function km(a, b, c, d) {
  const dl = (c - a) * D2R, dn = (d - b) * D2R;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a * D2R) * Math.cos(c * D2R) * Math.sin(dn / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------- map
async function start() {
  const get = n => fetch(`data/${n}`).then(r => r.json());
  const [RG, GV, DS, NB, ML, MS, HW, RW, AP, TW] = await Promise.all(
    ["region", "governorates", "districts", "neighbours", "metro_lines", "metro_stations", "highways", "railways", "airports", "towns"]
      .map(n => get(n + ".geojson")));
  const S = GV; // used by the drawing tools to name the governorate

  const HOME = [[24.55, 46.50], [24.98, 46.92]]; // Riyadh city opening view
  const map = L.map("map", { zoomSnap: 0.25, minZoom: 5, maxZoom: 20, attributionControl: true }).fitBounds(HOME);
  map.attributionControl.setPrefix("Leaflet");
  const pane = (n, z) => { map.createPane(n).style.zIndex = z; return n; };
  pane("base", 250); pane("lines", 420); pane("metro", 450); pane("pts", 620); pane("lbl", 640);
  const cssv = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ringsOf = g => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).flat();
  const asLines = fc => ({ type: "FeatureCollection", features: fc.features.map(f => ({ type: "Feature", properties: f.properties, geometry: { type: "MultiLineString", coordinates: ringsOf(f.geometry) } })) });
  const label = (lat, lon, html, cls) => L.marker([lat, lon], { pane: "lbl", interactive: false, keyboard: false,
    icon: L.divIcon({ className: "lbl " + cls, html: `<span>${html}</span>`, iconSize: [0, 0] }) });
  const centre = f => { const b = L.geoJSON(f).getBounds(), c = b.getCenter(); return hit({ features: [f] }, c.lat, c.lng) ? c : b.getCenter(); };

  // ---- symbology
  const SYM = {
    region:  { casing: { color: "#ffffff", weight: 6, opacity: 0.85 }, line: { color: "#2b2a27", weight: 2.2 } },
    gov:     { color: "#7a6a55", weight: 1.3, dashArray: "8 4 2 4" },
    dist:    { color: "#857c6d", weight: 0.9, opacity: 0.9, fillColor: "#c9b99a", fillOpacity: 0.07 },
    distHi:  { color: "#b5452e", weight: 2, fillColor: "#b5452e", fillOpacity: 0.12 },
    hwMajor: { casing: { color: "#7a3b12", weight: 5.5 }, line: { color: "#f59d4c", weight: 3.5 } },
    hwMinor: { casing: { color: "#8a6a2a", weight: 3.6 }, line: { color: "#ffd27a", weight: 2 } },
    rail:    { base: { color: "#3b3b3b", weight: 4 }, dash: { color: "#ffffff", weight: 2, dashArray: "8 8" } },
  };

  const nbL = L.geoJSON(NB, { pane: "base", interactive: false, style: { color: "#fff", weight: 0.8, fillColor: cssv("--nb"), fillOpacity: 1 } });
  const rgFill = L.geoJSON(RG, { pane: "base", interactive: false, style: { stroke: false, fillColor: cssv("--land"), fillOpacity: 1 } });
  const rgLines = asLines(RG);
  const rgL = L.layerGroup([L.geoJSON(rgLines, { pane: "lines", interactive: false, style: SYM.region.casing }),
                            L.geoJSON(rgLines, { pane: "lines", interactive: false, style: SYM.region.line })]).addTo(map);

  const govL = L.geoJSON(GV, { pane: "lines", style: { ...SYM.gov, fill: true, fillOpacity: 0 },
    onEachFeature: (f, l) => l.bindTooltip(`<div dir="rtl"><b>محافظة ${esc(f.properties.name_ar)}</b><br><small>${(+f.properties.area_km2).toLocaleString("en-US")} كم²</small></div>`, { sticky: true }) });
  const distL = L.geoJSON(DS, { pane: "lines", style: SYM.dist,
    onEachFeature: (f, l) => {
      l.bindTooltip(`<div dir="rtl"><b>حي ${esc(f.properties.name_ar)}</b><br><small>${esc(f.properties.city_ar)} · ${f.properties.area_km2} كم²</small></div>`, { sticky: true });
      l.on("mouseover", () => l.setStyle(SYM.distHi)); l.on("mouseout", () => l.setStyle(SYM.dist));
    } });

  const hwL = L.layerGroup([
    L.geoJSON(HW, { pane: "lines", interactive: false, style: f => f.properties.major ? SYM.hwMajor.casing : SYM.hwMinor.casing }),
    L.geoJSON(HW, { pane: "lines", interactive: false, style: f => f.properties.major ? SYM.hwMajor.line : SYM.hwMinor.line }),
  ]);
  const rwL = L.layerGroup([L.geoJSON(RW, { pane: "lines", interactive: false, style: SYM.rail.base }),
                            L.geoJSON(RW, { pane: "lines", interactive: false, style: SYM.rail.dash })]);

  // metro: white casing + official line colour, stations as white discs ringed in the line colour; interchanges larger with a dark ring
  const metroL = L.layerGroup([
    L.geoJSON(ML, { pane: "metro", interactive: false, style: { color: "#ffffff", weight: 9, opacity: 0.95, lineCap: "round" } }),
    L.geoJSON(ML, { pane: "metro", style: f => ({ color: f.properties.color, weight: 5, lineCap: "round" }),
      onEachFeature: (f, l) => l.bindTooltip(`<div dir="rtl"><b style="color:${f.properties.color}">${esc(f.properties.name_ar)}</b><br><small>${f.properties.length_km} كم</small></div>`, { sticky: true }) }),
  ]);
  const LINE_AR = Object.fromEntries(ML.features.map(f => [f.properties.line_id, [f.properties.name_ar, f.properties.color]]));
  const lineChips = s => s.split(",").map(i => `<span class="chip" style="--c:${LINE_AR[i][1]}">${esc(LINE_AR[i][0].replace("المسار ", ""))}</span>`).join("");
  const stL = L.layerGroup(MS.features.map(f => {
    const p = f.properties, [x, y] = f.geometry.coordinates;
    return L.circleMarker([y, x], { pane: "pts", radius: p.interchange ? 6.5 : 4.5, color: p.interchange ? "#1b1b1b" : p.color,
      weight: p.interchange ? 2.5 : 2.5, fillColor: "#ffffff", fillOpacity: 1 })
      .bindTooltip(`<div dir="rtl"><b>محطة ${esc(p.name_ar)}</b><br>${lineChips(p.lines)}</div>`, { direction: "top", offset: [0, -6] });
  }));
  const stLbl = L.layerGroup(MS.features.map(f => label(f.geometry.coordinates[1], f.geometry.coordinates[0], esc(f.properties.name_ar), "station")));

  const PLANE = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1f5f7a" stroke="#fff" stroke-width="2"/><path d="M17.8 13.6v-1.2l-4.7-2.9V6.3a1.1 1.1 0 0 0-2.2 0v3.2l-4.7 2.9v1.2l4.7-1.4v3.2l-1.2.9v.9l2.3-.6 2.3.6v-.9l-1.2-.9v-3.2z" fill="#fff"/></svg>`;
  const apL = L.layerGroup(AP.features.map(f => L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { pane: "pts",
    icon: L.divIcon({ className: "", html: PLANE, iconSize: [20, 20], iconAnchor: [10, 10] }) })
    .bindTooltip(`<div dir="rtl"><b>${esc(f.properties.name_ar || f.properties.name)}</b>${f.properties.iata_code ? ` (${esc(f.properties.iata_code)})` : ""}</div>`)));

  const TW_SYM = { 1: { radius: 7, weight: 3, color: "#1b1b1b", fillColor: "#ffffff" }, 2: { radius: 4.5, weight: 1.5, color: "#ffffff", fillColor: "#2b2a27" }, 3: { radius: 2.6, weight: 1, color: "#ffffff", fillColor: "#5b5750" } };
  const twMk = f => L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { pane: "pts", fillOpacity: 1, ...TW_SYM[f.properties.rank] })
    .bindTooltip(`<div dir="rtl"><b>${esc(f.properties.name_ar)}</b><br><small lang="en">${esc(f.properties.name_en)}</small></div>`);
  const twL = L.layerGroup(TW.features.filter(f => f.properties.rank < 3).map(twMk));       // city + governorate seats
  const twSmall = L.layerGroup(TW.features.filter(f => f.properties.rank === 3).map(twMk)); // villages: zoom 9+
  const twLbl = { 1: [], 2: [], 3: [] };
  TW.features.forEach(f => twLbl[f.properties.rank].push(label(f.geometry.coordinates[1], f.geometry.coordinates[0], esc(f.properties.name_ar), "city r" + f.properties.rank)));
  const twLbl1 = L.layerGroup(twLbl[1]), twLbl2 = L.layerGroup(twLbl[2]), twLbl3 = L.layerGroup(twLbl[3]);
  const govLbl = L.layerGroup(GV.features.map(f => { const c = centre(f); return label(c.lat, c.lng, esc(f.properties.name_ar), "gov"); }));
  const distLbl = L.layerGroup(DS.features.map(f => { const c = centre(f); return label(c.lat, c.lng, esc(f.properties.name_ar), "dist"); }));

  // ---------------- layer switcher
  const sw = (bg, extra = "") => `<i style="${bg}${extra}"></i>`;
  const LAYERS = [
    ["الحدود"],
    ["region", "منطقة الرياض", rgL, true, `<i style="border:2px solid #2b2a27;background:none;box-shadow:0 0 0 2px #fff inset"></i>`],
    ["gov", "المحافظات", govL, false, `<i style="border:1.5px dashed #7a6a55;background:none"></i>`],
    ["dist", "الأحياء", distL, false, `<i style="border:1px solid #8a8478;background:rgba(201,185,154,.25)"></i>`],
    ["النقل"],
    ["metro", "مترو الرياض", metroL, true, `<i class="ln metro"></i>`],
    ["stations", "محطات المترو", stL, true, `<i class="dot" style="background:#fff;box-shadow:0 0 0 2px #00ade5"></i>`],
    ["hw", "الطرق السريعة", hwL, false, `<i class="ln" style="background:#f59d4c;box-shadow:0 0 0 1px #7a3b12"></i>`],
    ["rail", "السكك الحديدية", rwL, false, `<i class="ln" style="background:repeating-linear-gradient(90deg,#3b3b3b 0 5px,#fff 5px 10px);box-shadow:0 0 0 1px #3b3b3b"></i>`],
    ["air", "المطارات", apL, false, `<i class="dot" style="background:#1f5f7a"></i>`],
    ["الأماكن"],
    ["towns", "المدن والبلدات", twL, false, `<i class="dot" style="background:#2b2a27"></i>`],
    ["labels", "الأسماء", L.layerGroup(), false, `<i style="background:none;font-style:normal;font-size:11px;line-height:11px;font-weight:700">أ</i>`],
  ];
  const on = {};
  $("layers").innerHTML = LAYERS.map(r => r.length === 1 ? `<h4>${r[0]}</h4>` :
    `<label><input type="checkbox" data-k="${r[0]}" ${r[3] ? "checked" : ""}>${r[4]}${r[1]}</label>`).join("");
  LAYERS.filter(r => r.length > 1).forEach(r => { on[r[0]] = r[3]; });
  const set = (lyr, show) => show ? map.addLayer(lyr) : map.removeLayer(lyr);
  function zoomRules() {
    const z = map.getZoom(), lab = on.labels;
    set(govLbl, lab && on.gov && z < 11);
    set(distLbl, lab && on.dist && z >= 12.5);
    set(stL, on.stations && z >= 10); set(stLbl, on.stations && z >= 13);
    set(twLbl1, lab && on.towns); set(twLbl2, lab && on.towns && z >= 8); set(twLbl3, lab && on.towns && z >= 11);
    set(twSmall, on.towns && z >= 9);
  }
  function apply() {
    LAYERS.filter(r => r.length > 1 && !["labels", "stations"].includes(r[0])).forEach(r => set(r[2], on[r[0]]));
    zoomRules();
  }
  $("layers").addEventListener("change", e => { const k = e.target.dataset.k; if (k) { on[k] = e.target.checked; apply(); } });
  map.on("zoomend", zoomRules);
  apply();

  // ---------------- background maps
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const tl = (path, o = {}) => L.tileLayer(ESRI + path + "/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, ...o });
  const BASES = {
    gray: [tl("Canvas/World_Light_Gray_Base", { maxNativeZoom: 16, attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors" }),
           tl("Canvas/World_Light_Gray_Reference", { maxNativeZoom: 16, pane: "lbl" })],
    osm: [L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 19, attribution: "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors" })],
    streets: [tl("World_Street_Map", { maxNativeZoom: 19, attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors" })],
    imagery: [tl("World_Imagery", { maxNativeZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }),
              tl("Reference/World_Boundaries_and_Places", { maxNativeZoom: 19, pane: "lbl" })],
  };
  let current = "gray";
  function vectorFallback() {
    current = null; document.querySelectorAll("#basemap button").forEach(x => x.classList.remove("on"));
    $("map").classList.remove("on-imagery"); $("map").style.background = cssv("--sea");
    nbL.addTo(map); rgFill.addTo(map);
  }
  Object.entries(BASES).forEach(([k, layers]) => {
    let fails = 0, ok = false;
    layers[0].on("tileload", () => { ok = true; });
    layers[0].on("tileerror", () => {
      if (ok || ++fails !== 4) return;
      const btn = document.querySelector(`#basemap [data-b="${k}"]`);
      btn.disabled = true; btn.title = "تعذّر تحميل هذه الخريطة هنا. تعمل على الموقع المنشور.";
      const next = ["gray", "osm", "streets", "imagery"].find(x => !document.querySelector(`#basemap [data-b="${x}"]`).disabled);
      if (current === k) next ? setBase(next) : (Object.values(BASES).flat().forEach(l => map.removeLayer(l)), vectorFallback());
    });
  });
  function setBase(b) {
    current = b;
    document.querySelectorAll("#basemap button").forEach(x => x.classList.toggle("on", x.dataset.b === b));
    Object.entries(BASES).forEach(([k, ls]) => ls.forEach(l => k === b ? l.addTo(map) : map.removeLayer(l)));
    const dark = b === "imagery";
    rgL.eachLayer(g => g.setStyle(g === rgL.getLayers()[1] ? { color: dark ? "#fff" : "#2b2a27" } : { color: dark ? "#000" : "#fff", opacity: dark ? 0.5 : 0.85 }));
    govL.setStyle({ color: dark ? "#fff" : "#7a6a55" });
    SYM.dist.color = dark ? "#ffffff" : "#857c6d"; SYM.dist.fillOpacity = dark ? 0 : 0.06; distL.setStyle(SYM.dist);
    $("map").classList.toggle("on-imagery", dark);
  }
  setBase("gray");
  $("basemap").addEventListener("click", e => { const b = e.target.dataset.b; if (b && !e.target.disabled) setBase(b); });

  // ---------------- cursor readout
  map.on("mousemove", e => { $("cursor").textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`; });
  map.on("mouseout", () => { $("cursor").textContent = ""; });

  // ---------------- drawing + KML export
  const draw = (() => {
    const COL = "#ff7a00", DKEY = "ryd-map-drawings";
    const group = L.featureGroup().addTo(map);
    const temp = L.layerGroup().addTo(map);
    let mode = null, verts = [], items = [], seq = { point: 0, line: 0, poly: 0 }, cursorLL = null;
    const NAMES = { point: "نقطة", line: "خط", poly: "مضلع" };
    const lineKm = ll => ll.slice(1).reduce((s, p, i) => s + km(ll[i].lat, ll[i].lng, p.lat, p.lng), 0);
    function areaKm2(ll) {
      const lat0 = ll.reduce((s, p) => s + p.lat, 0) / ll.length * D2R, R = 6371.0088;
      const xy = ll.map(p => [p.lng * D2R * R * Math.cos(lat0), p.lat * D2R * R]);
      let a = 0; for (let i = 0; i < xy.length; i++) { const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length]; a += x1 * y2 - x2 * y1; }
      return Math.abs(a) / 2;
    }
    const fmtLen = k => k < 1 ? `${Math.round(k * 1000).toLocaleString("en-US")} م` : `${k.toLocaleString("en-US", { maximumFractionDigits: 2 })} كم`;
    const fmtArea = k => k < 1 ? `${Math.round(k * 1e6).toLocaleString("en-US")} م² · ${(k * 100).toFixed(2)} هكتار` : `${k.toLocaleString("en-US", { maximumFractionDigits: 2 })} كم²`;
    function measure(it) {
      if (it.type === "point") return `${it.ll[0].lat.toFixed(6)}, ${it.ll[0].lng.toFixed(6)}`;
      if (it.type === "line") return `الطول ${fmtLen(lineKm(it.ll))}`;
      return `المساحة ${fmtArea(areaKm2(it.ll))} · المحيط ${fmtLen(lineKm([...it.ll, it.ll[0]]))}`;
    }
    function where(it) {
      const c = it.type === "point" ? it.ll[0] : L.latLngBounds(it.ll).getCenter();
      const g = hit(S, c.lat, c.lng); return g ? g.properties.name_ar : "";
    }
    function makeLayer(it) {
      if (it.type === "point") return L.circleMarker(it.ll[0], { pane: "lbl", radius: 7, color: "#fff", weight: 2.5, fillColor: COL, fillOpacity: 1 });
      if (it.type === "line") return L.polyline(it.ll, { pane: "lbl", color: COL, weight: 3.5 });
      return L.polygon(it.ll, { pane: "lbl", color: COL, weight: 3, fillColor: COL, fillOpacity: 0.18 });
    }
    function save() {
      try { localStorage.setItem(DKEY, JSON.stringify(items.map(i => ({ type: i.type, name: i.name, ll: i.ll.map(p => [p.lat, p.lng]) })))); } catch (e) {}
    }
    function addFeature(type, ll, name) {
      const it = { id: Math.random().toString(36).slice(2, 9), type, ll, name: name || `${NAMES[type]} ${++seq[type]}` };
      it.layer = makeLayer(it).addTo(group).bindTooltip(() => `<b>${esc(it.name)}</b><br>${esc(measure(it))}`, { sticky: true });
      items.push(it); save(); list(); return it;
    }
    function remove(id) {
      const it = items.find(i => i.id === id); if (!it) return;
      group.removeLayer(it.layer); items = items.filter(i => i !== it); save(); list();
    }
    // ---- drawing interaction
    function setMode(m) {
      mode = m; verts = []; temp.clearLayers();
      document.querySelectorAll("#drawbar button").forEach(b => b.classList.toggle("on", b.dataset.d === m));
      $("drawhint").hidden = !m || m === "point";
      $("map").classList.toggle("drawing", !!m);
      m ? map.doubleClickZoom.disable() : map.doubleClickZoom.enable();
      if (m === "point") flash("انقر على الخريطة لوضع نقطة");
      hint();
    }
    let flashT;
    function flash(t) { $("drawhint").hidden = false; $("drawmsg").textContent = t; ["dUndo", "dFinish"].forEach(i => $(i).hidden = true); clearTimeout(flashT); }
    function hint() {
      if (!mode || mode === "point") return;
      ["dUndo", "dFinish"].forEach(i => $(i).hidden = false);
      const need = mode === "line" ? 2 : 3;
      $("drawmsg").textContent = verts.length < need
        ? `انقر لإضافة النقاط (${verts.length} من ${need} على الأقل)`
        : `${mode === "line" ? fmtLen(lineKm(verts)) : fmtArea(areaKm2(verts))} · نقرتان أو «إنهاء»`;
      $("dFinish").disabled = verts.length < need; $("dUndo").disabled = !verts.length;
    }
    function redraw() {
      temp.clearLayers();
      const pts = cursorLL && verts.length ? [...verts, cursorLL] : verts;
      if (pts.length > 1) (mode === "poly" && pts.length > 2 ? L.polygon(pts, { pane: "lbl", color: COL, weight: 2, dashArray: "6 4", fillOpacity: 0.1, interactive: false })
        : L.polyline(pts, { pane: "lbl", color: COL, weight: 2, dashArray: "6 4", interactive: false })).addTo(temp);
      verts.forEach(v => L.circleMarker(v, { pane: "lbl", radius: 4, color: COL, weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(temp));
    }
    function finish() {
      const need = mode === "line" ? 2 : 3;
      if (verts.length >= need) addFeature(mode, verts.slice());
      setMode(null);
    }
    map.on("click", e => {
      if (!mode) return;
      if (mode === "point") { addFeature("point", [e.latlng]); setMode(null); return; }
      const last = verts[verts.length - 1];
      if (last && map.latLngToContainerPoint(last).distanceTo(e.containerPoint) < 4) return; // double-click duplicate
      verts.push(e.latlng); redraw(); hint();
    });
    map.on("dblclick", () => { if (mode === "line" || mode === "poly") finish(); });
    map.on("mousemove", e => { if (mode && mode !== "point") { cursorLL = e.latlng; redraw(); } });
    $("drawbar").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setMode(mode === b.dataset.d ? null : b.dataset.d); });
    $("dUndo").addEventListener("click", e => { L.DomEvent.stop(e); verts.pop(); redraw(); hint(); });
    $("dFinish").addEventListener("click", e => { L.DomEvent.stop(e); finish(); });
    $("dCancel").addEventListener("click", e => { L.DomEvent.stop(e); setMode(null); });
    L.DomEvent.disableClickPropagation($("drawbar")); L.DomEvent.disableClickPropagation($("drawhint"));
    document.addEventListener("keydown", e => {
      if (!mode || e.target.matches("input")) return;
      if (e.key === "Escape") setMode(null);
      if (e.key === "Enter") finish();
      if (e.key === "Backspace") { verts.pop(); redraw(); hint(); }
    });
    // ---- KML
    const xml = s => String(s).replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
    const co = ll => ll.map(p => `${p.lng.toFixed(7)},${p.lat.toFixed(7)},0`).join(" ");
    function kml() {
      const pm = items.map(it => {
        const g = it.type === "point" ? `<Point><coordinates>${co(it.ll)}</coordinates></Point>`
          : it.type === "line" ? `<LineString><tessellate>1</tessellate><coordinates>${co(it.ll)}</coordinates></LineString>`
          : `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${co([...it.ll, it.ll[0]])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
        const gov = where(it);
        return `    <Placemark>
      <name>${xml(it.name)}</name>
      <description>${xml(measure(it) + (gov ? ` · محافظة ${gov}` : ""))}</description>
      <styleUrl>#${it.type}</styleUrl>
      <ExtendedData><Data name="type"><value>${it.type}</value></Data><Data name="governorate"><value>${xml(gov)}</value></Data></ExtendedData>
      ${g}
    </Placemark>`;
      }).join("\n");
      return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>رسومات الخريطة العامة للرياض</name>
    <Style id="point"><IconStyle><color>ff007aff</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
    <Style id="line"><LineStyle><color>ff007aff</color><width>3</width></LineStyle></Style>
    <Style id="poly"><LineStyle><color>ff007aff</color><width>2.5</width></LineStyle><PolyStyle><color>40007aff</color></PolyStyle></Style>
${pm}
  </Document>
</kml>
`;
    }
    function download() {
      const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([kml()], { type: "application/vnd.google-earth.kml+xml" }));
      a.download = `riyadh_drawings_${stamp}.kml`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    // ---- list in the side panel
    function list() {
      $("drawings").innerHTML = `
        <h3>الرسومات</h3>
        ${items.length ? `<ul class="dlist">${items.map(it => `
          <li data-id="${it.id}">
            <span class="dico ${it.type}" aria-hidden="true"></span>
            <div><input value="${esc(it.name)}" aria-label="الاسم" data-act="name"><small>${esc(measure(it))}</small></div>
            <button data-act="zoom" title="تكبير إليه">تكبير</button><button data-act="del" title="حذف">✕</button>
          </li>`).join("")}</ul>
          <div class="dbtns"><button class="primary" data-act="kml">تنزيل KML</button><button data-act="copykml">نسخ KML</button><button data-act="clear">حذف الكل</button></div>`
        : `<p class="hint">استخدم أزرار «نقطة» و«خط» و«مضلع» أعلى يسار الخريطة للرسم. تُحفظ الرسومات في هذا المتصفح، ويمكن تنزيلها بصيغة KML لفتحها في Google Earth أو ArcGIS Pro أو QGIS.</p>`}`;
    }
    $("drawings").addEventListener("input", e => {
      if (e.target.dataset.act !== "name") return;
      const it = items.find(i => i.id === e.target.closest("li").dataset.id); if (it) { it.name = e.target.value; save(); }
    });
    $("drawings").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const act = b.dataset.act, li = b.closest("li"), it = li && items.find(i => i.id === li.dataset.id);
      if (act === "zoom" && it) it.type === "point" ? map.flyTo(it.ll[0], Math.max(map.getZoom(), 15)) : map.flyToBounds(it.layer.getBounds(), { padding: [40, 40], maxZoom: 18 });
      if (act === "del" && it) remove(it.id);
      if (act === "kml") download();
      if (act === "copykml") (navigator.clipboard ? navigator.clipboard.writeText(kml()) : Promise.reject()).then(() => { b.textContent = "تم النسخ"; }, () => { b.textContent = "تعذّر النسخ"; });
      if (act === "clear") {
        if (b.dataset.sure) { group.clearLayers(); items = []; save(); list(); }
        else { b.dataset.sure = 1; b.textContent = "انقر مرة أخرى للحذف"; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = "حذف الكل"; } }, 3000); }
      }
    });
    try { (JSON.parse(localStorage.getItem(DKEY) || "[]")).forEach(i => { addFeature(i.type, i.ll.map(p => L.latLng(p[0], p[1])), i.name); seq[i.type]++; }); } catch (e) {}
    list();
    return { get mode() { return mode; }, addFeature, kml };
  })();

  // ---------------- search + result panel
  const pin = L.layerGroup().addTo(map);
  const EXAMPLES = [
    ["برج المملكة", "24.71138, 46.67435"],
    ["قصر المصمك", "24°37'52\"N 46°42'48\"E"],
    ["مطار الملك خالد الدولي", "38N 671498 2761330"],
    ["حي الطريف، الدرعية", "24.73300, 46.57338"],
    ["نهاية العالم (جبل فهرين)", "24.94720, 45.99101"],
  ];
  function intro(msg) {
    $("result").innerHTML = `
      <h2>البحث بالإحداثيات</h2>
      <p class="hint">اكتب الإحداثيات في الشريط أعلاه، أو انقر على أي مكان في الخريطة. المرجع: WGS 84.</p>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ""}
      <h3>الصيغ المقبولة</h3>
      <div class="facts">
        <div class="fact wide"><span>درجات عشرية (خط العرض، خط الطول)</span><b dir="ltr">24.7136, 46.6753</b></div>
        <div class="fact wide"><span>درجات ودقائق وثوانٍ</span><b dir="ltr">24°42'49"N 46°40'31"E</b></div>
        <div class="fact wide"><span>UTM (النطاق، الشرقي، الشمالي)</span><b dir="ltr">38N 669460 2734272</b></div>
      </div>
      <h3>جرّب مثالاً</h3>
      <ul class="examples">${EXAMPLES.map(([n, q]) => `<li><button data-q="${esc(q)}">${esc(n)}<br><small dir="ltr">${esc(q)}</small></button></li>`).join("")}</ul>`;
  }
  $("panel").addEventListener("click", e => {
    const b = e.target.closest("button[data-q]");
    if (b) { $("q").value = b.dataset.q; go(); }
    const c = e.target.closest("button.copy[data-t]");
    if (c) {
      const t = c.dataset.t;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
        .then(() => { c.textContent = "تم النسخ"; }, () => { c.textContent = t; });
    }
  });
  const fmtKm = k => k < 1 ? `${Math.round(k * 1000).toLocaleString("en-US")} م` : `${k.toLocaleString("en-US", { maximumFractionDigits: 1 })} كم`;
  function show(lat, lon, note, source) {
    const inside = !!hit(RG, lat, lon);
    const g = inside ? hit(GV, lat, lon) : null, d = inside ? hit(DS, lat, lon) : null, nb = inside ? null : hit(NB, lat, lon);
    let nearT = null, nearS = null;
    TW.features.forEach(f => { const [x, y] = f.geometry.coordinates, k = km(lat, lon, y, x); if (!nearT || k < nearT.k) nearT = { p: f.properties, k }; });
    MS.features.forEach(f => { const [x, y] = f.geometry.coordinates, k = km(lat, lon, y, x); if (!nearS || k < nearS.k) nearS = { p: f.properties, k }; });
    const u = toUTM(lat, lon), dec = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    pin.clearLayers();
    L.circleMarker([lat, lon], { pane: "lbl", radius: 9, color: "#fff", weight: 3, fillColor: "#b5452e", fillOpacity: 1 }).addTo(pin)
      .bindTooltip(dec, { direction: "top", offset: [0, -8] });
    if (source === "search") map.flyTo([lat, lon], Math.max(map.getZoom(), 14), { duration: 0.8 });
    const dp = d?.properties, gp = g?.properties;
    const title = dp ? `حي ${esc(dp.name_ar)}` : gp ? `محافظة ${esc(gp.name_ar)}` : nb ? esc(nb.properties.name_ar || nb.properties.name) : "خارج نطاق الخريطة";
    $("result").innerHTML = `
      <button class="back" id="back" type="button">→ الصيغ والأمثلة</button>
      <h2>${title}</h2>
      <span class="status ${inside ? "in" : "out"}">${inside ? "داخل منطقة الرياض" : "خارج منطقة الرياض"}</span>
      ${note ? `<p class="hint">${esc(note)}</p>` : ""}
      <div class="facts">
        ${dp ? `<div class="fact"><span>الحي</span><b>${esc(dp.name_ar)}</b><small lang="en">${esc(dp.name_en)}</small></div>
                <div class="fact"><span>المدينة</span><b>${esc(dp.city_ar)}</b><small lang="en">${esc(dp.city_en)}</small></div>` : ""}
        ${gp ? `<div class="fact"><span>المحافظة</span><b>${esc(gp.name_ar)}</b><small lang="en">${esc(gp.name_en)}</small></div>` : ""}
        <div class="fact"><span>أقرب مدينة أو بلدة</span><b>${esc(nearT.p.name_ar)}</b><small>على بُعد ${fmtKm(nearT.k)}</small></div>
        ${nearS && nearS.k < 15 ? `<div class="fact wide"><span>أقرب محطة مترو</span><b>${esc(nearS.p.name_ar)}</b><small>على بُعد ${fmtKm(nearS.k)} · ${lineChips(nearS.p.lines)}</small></div>` : ""}
        <div class="fact wide"><span>درجات عشرية</span><b dir="ltr">${dec}</b></div>
        <div class="fact wide"><span>درجات ودقائق وثوانٍ</span><b dir="ltr">${dms(lat, "N", "S")} ${dms(lon, "E", "W")}</b></div>
        <div class="fact wide"><span>UTM WGS 84 · النطاق ${u.zone}${u.hemi}</span><b dir="ltr">E ${u.E.toFixed(1)} · N ${u.N.toFixed(1)}</b></div>
      </div>
      <button class="copy" data-t="${esc(dec)}">نسخ الإحداثيات العشرية</button>
      <button class="copy" id="addPt" type="button">إضافة النقطة إلى الرسومات</button>`;
    $("addPt").addEventListener("click", () => { draw.addFeature("point", [L.latLng(lat, lon)]); $("addPt").textContent = "أُضيفت إلى الرسومات"; });
    $("back").addEventListener("click", () => intro());
  }
  function go() {
    const r = parse($("q").value);
    if (r.error) { intro(r.error); return; }
    show(r.lat, r.lon, r.note, "search");
  }
  $("search").addEventListener("submit", e => { e.preventDefault(); go(); });
  $("clear").addEventListener("click", () => { $("q").value = ""; pin.clearLayers(); intro(); map.flyToBounds(HOME, { duration: 0.6 }); });
  map.on("click", e => { if (draw.mode) return; $("q").value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`; show(e.latlng.lat, e.latlng.lng, "", "click"); });
  if (window.matchMedia("(max-width:860px)").matches) $("layerbox").open = false;
  intro();
}
if (serverOk() || store.get() === PW_HASH) unlock();
}
