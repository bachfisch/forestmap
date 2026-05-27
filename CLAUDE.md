# FVA Geo-Viewer — Projektkontext für Claude Code

## Was ist das?

Interaktiver Karten-Viewer für die Geodatendienste der Forstlichen Versuchs- und
Forschungsanstalt Baden-Württemberg (FVA, Freiburg) sowie ergänzende Dienste von
DWD, ForstBW und LGL BW.

**Anbieter FVA:** Wonnhaldestraße 4, 79100 Freiburg · gis.fva-bw@forst.bwl.de
**OWS-Proxy:** `https://owsproxy.lgl-bw.de/owsproxy/ows/`
**Metadaten:** https://metadaten.geoportal-bw.de

---

## ERSTER SCHRITT beim Start einer neuen Session

**Lies den `old/`-Ordner bevor du irgendetwas baust:**

```
Task: Lies alle Dateien in old/ (HTML, JS, JSON, CSS).
Extrahiere daraus ausschließlich:
  1. WMS-Service-URLs und Layer-Namen die du dort findest
  2. GetFeatureInfo-Antwortstrukturen (wie sehen die Rohdaten aus?)
  3. Bereits gelöste Grafik-Logiken (welche Plots funktionieren schon?)
  4. Bekannte Probleme oder Workarounds die kommentiert sind

Ignoriere vollständig:
  - HTML-Struktur, CSS, Layout
  - Alten Routing- oder Applikations-Code
  - Komponentenstruktur oder Framework-Logik

Schreibe die extrahierten Infos direkt in services.js ein
(fehlende Layer-Namen ergänzen, featureInfoType korrigieren,
funktionierende chartComponents übernehmen).
```

---

## Architektur-Entscheidungen (nicht diskutieren, direkt umsetzen)

| Bereich | Entscheidung |
|---|---|
| Map Engine | **MapLibre GL JS** (CDN, kein Build) |
| Basemap | **Maptiler** – Key in `config.js` als `MAPTILER_KEY` |
| Charts | **Observable Plot** (CDN) |
| Framework | **Kein Framework** – Vanilla JS, ES Modules |
| Einstiegspunkt | `index.html` – direkt mit VS Code Live Server öffnen |
| Sprache | JavaScript (kein TypeScript im Prototyp) |
| Styling | CSS Custom Properties, kein Framework |

---

## Projektstruktur

```
fva-viewer/
├── CLAUDE.md
├── index.html              ← Einstiegspunkt, Fullscreen-Layout
├── config.js               ← API-Keys, Basis-URLs (nicht committen)
├── services.js             ← HERZSTÜCK: alle Services definiert
├── old/                    ← Alter Prototyp – NUR für Datenextraktion
│   └── ...                 ← Layer-Namen, GFI-Strukturen, Grafik-Lösungen
└── src/
    ├── map.js              ← MapLibre-Instanz, WMS-Layer-Stack
    ├── sidebar.js          ← Menü, Kategorien, Layer-Toggles
    ├── popup.js            ← Popup-Container, Chart-Dispatcher
    ├── fetcher.js          ← GetFeatureInfo, externe APIs, Cache
    ├── chartTheme.js       ← Globales Theme-Objekt für alle Charts
    └── charts/
        ├── RasterValue.js      ← Default: Einzelwert + Farbskala
        ├── FeatureTable.js     ← Default: GeoJSON Attributtabelle
        ├── ScenarioBar.js      ← Default: Mehrere Layer = Balkenvergleich
        ├── BuchdruckerChart.js ← Spezifisch
        ├── BodenfeuchteChart.js← Spezifisch (DWD Buche/Fichte/Eiche/Kiefer)
        └── ...                 ← Weitere spezifische Charts
```

---

## Das Herzstück: services.js

**Nur diese Datei editieren wenn ein neuer Service dazukommt.**
Alles andere (Menü, Karte, Popup) rendert sich automatisch.

### Schema eines Service-Eintrags

```javascript
{
  id: "klima-buchdrucker",           // Eindeutige ID
  category: "klima",                 // Steuert Menü-Gruppe
  label: "Buchdruckergefährdung",    // Anzeigename
  abstract: "...",                   // Beschreibung für Info-Panel

  // WMS
  wmsUrl: "https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_FVA_Klima_Buchdruckergefaehrdung",
  wmsVersion: "1.3.0",
  layers: [
    { name: "buchdrucker_aktuell", label: "Aktuell",       defaultVisible: true },
    { name: "buchdrucker_rcp85",   label: "RCP 8.5 (2050)" }
  ],

  // GetFeatureInfo
  featureInfoType: "value-only",  // "value-only" | "geojson" | "none"
  // "value-only" = einzelner Pixelwert (90% der FVA-Raster-Dienste)
  // "geojson"    = Feature mit Attributen (Waldbiotope, Wildtier, ForstBW)
  // "none"       = kein GetFeatureInfo möglich

  // Datenquelle für den Chart
  dataSource: {
    type: "wms-single",
    // type: "wms-multi"      → mehrere Layer parallel abfragen → layerValues{}
    // type: "external-api"   → separater Datenabruf (DWD NetCDF etc.)
    // apiUrl: "...",
    // apiParams: (latlng) => ({ lat: latlng.lat, lon: latlng.lng })
  },

  // Chart
  chartComponent: "BuchdruckerChart", // Name in ChartRegistry
  // Fallback-Reihenfolge wenn chartComponent nicht gefunden:
  // featureInfoType="value-only" → RasterValue
  // featureInfoType="geojson"    → FeatureTable
  // dataSource.type="wms-multi"  → ScenarioBar

  // Metadaten
  updateInterval: "daily",     // "static" | "daily" | "weekly" | "monthly"
  license: "fva-nutzungsbedingungen", // oder "open-data"
  legendUrl: null,             // null = GetLegendGraphic automatisch generieren
  minZoom: 6,
  maxZoom: 22,
}
```

### Kategorien

```javascript
export const CATEGORIES = [
  { id: "waldfunktionen", label: "Waldfunktionen",            icon: "🌲" },
  { id: "waldbiotope",    label: "Waldbiotope",               icon: "🌿" },
  { id: "standort",       label: "Forstliche Standortkarte",  icon: "🗺️" },
  { id: "wildtier",       label: "Wildtierökologie",          icon: "🦌" },
  { id: "klima",          label: "Klimafolgenforschung",      icon: "🌡️" },
  { id: "windenergie",    label: "Windenergie im Wald",       icon: "💨" },
  { id: "fernerkundung",  label: "Fernerkundung",             icon: "🛰️" },
  { id: "dwd",            label: "DWD Wetter & Klima",        icon: "☁️" },
  { id: "kataster",       label: "Flurstücke & Forstbezirke", icon: "📐" },
]
```

---

## Chart-System

### Das Interface – jede Chart-Funktion bekommt dasselbe Objekt

```javascript
// context-Objekt das jede chartComponent-Funktion empfängt:
{
  latlng:        { lat: 48.12, lng: 8.34 },
  rawValue:      73.4,                          // bei featureInfoType="value-only"
  featureProps:  { art: "Buche", nfk: 73.4 },  // bei featureInfoType="geojson"
  layerValues:   { rcp26: 42, rcp45: 61, rcp85: 78 }, // bei dataSource.type="wms-multi"
  serviceConfig: { ...kompletter Service-Eintrag... }
}

// Rückgabe: immer ein DOM-Element (oder HTML-String)
```

### ChartRegistry in popup.js

```javascript
import { BuchdruckerChart }  from "./charts/BuchdruckerChart.js"
import { BodenfeuchteChart } from "./charts/BodenfeuchteChart.js"
import { RasterValue }       from "./charts/RasterValue.js"
// ...

export const ChartRegistry = {
  BuchdruckerChart,
  BodenfeuchteChart,
  RasterValue,
  FeatureTable,
  ScenarioBar,
  // Neuen Chart hier eintragen + Datei in charts/ anlegen – fertig
}
```

### Die 3 Default-Charts

| Chart | Wann | Was wird angezeigt |
|---|---|---|
| `RasterValue` | `featureInfoType: "value-only"` | Wert + Einheit + Farbskala aus Legende |
| `FeatureTable` | `featureInfoType: "geojson"` | Attributtabelle, konfigurierbare Spalten |
| `ScenarioBar` | `dataSource.type: "wms-multi"` | Balken pro Layer (z.B. RCP-Szenarien) |

### chartTheme – einmal definiert, überall verwendet

```javascript
// chartTheme.js
export const chartTheme = {
  style: {
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    background: "transparent",
    color: "var(--text-primary)",
  },
  color: {
    primary:  "#1D9E75",  // FVA-Grün
    warning:  "#EF9F27",
    danger:   "#D85A30",
    neutral:  "#888780",
    rcp: {
      rcp26: "#1D9E75",
      rcp45: "#EF9F27",
      rcp85: "#D85A30",
    }
  },
  marginLeft: 48,
  marginBottom: 32,
}
```

---

## WMS GetFeatureInfo — Technische Details

### Anfrage-URL-Schema

```
GET {wmsUrl}
  ?SERVICE=WMS
  &VERSION=1.3.0
  &REQUEST=GetFeatureInfo
  &CRS=EPSG:4326
  &BBOX={south},{west},{north},{east}
  &WIDTH={mapWidth}&HEIGHT={mapHeight}
  &LAYERS={layerName}
  &QUERY_LAYERS={layerName}
  &INFO_FORMAT=application/json
  &I={pixelX}&J={pixelY}
```

### Bekannte Antwort-Varianten

```javascript
// Variante A: Einfacher Raster-Wert (meiste FVA-Dienste)
{ "features": [{ "properties": { "GRAY_INDEX": 73.4 } }] }

// Variante B: Klassifizierter Wert
{ "features": [{ "properties": { "value": "hoch", "klasse": 3 } }] }

// Variante C: GeoJSON Feature (Waldbiotope, Wildtier)
{ "type": "FeatureCollection", "features": [{ "properties": { "art": "Buche", ... } }] }

// Variante D: Leere Antwort (kein Feature an dieser Stelle)
{ "features": [] }

// Variante E: XML (Fallback wenn JSON nicht unterstützt)
// → in fetcher.js mit DOMParser verarbeiten
```

### CORS-Hinweis

Der OWS-Proxy des LGL unterstützt CORS für GetMap aber **nicht immer für GetFeatureInfo**.
Falls CORS-Fehler auftreten: SvelteKit/Express-Proxy unter `/api/gfi` als Workaround.
Für den Desktop-Prototyp: Browser mit `--disable-web-security` starten oder
Live Server Proxy-Plugin verwenden.

---

## DWD-Dienste

**Basis-URL WMS:** `https://cdc.dwd.de/geoserver/wms`
**Basis-URL Rohdaten:** `https://opendata.dwd.de/climate_environment/CDC/`
**Lizenz:** CC BY 4.0

### Bodenfeuchte-Layer (Baumarten via LWF-Brook90-Modell)

```javascript
// Täglich, 1×1 km, ab 1991, Modell: LWF-Brook90
// 20 Tiefenschichten à 10 cm bis 200 cm
// Wert: % der nutzbaren Feldkapazität (nFK)
wmsUrl: "https://cdc.dwd.de/geoserver/wms",
layers: [
  { name: "CDC:GRD_DEU_P1D_BF_BU", label: "Buche – aktuell" },
  { name: "CDC:GRD_DEU_P1D_BF_FI", label: "Fichte – aktuell" },
  { name: "CDC:GRD_DEU_P1D_BF_EI", label: "Eiche – aktuell" },
  { name: "CDC:GRD_DEU_P1D_BF_KI", label: "Kiefer – aktuell" },
  // Exakte Layer-Namen via GetCapabilities prüfen:
  // https://cdc.dwd.de/geoserver/wms?SERVICE=WMS&REQUEST=GetCapabilities
]
```

### Klimaprojektionen (RCP-Szenarien)

Verfügbar als **Rohdaten-Download** (NetCDF/GeoTIFF), NICHT als fertiger WMS.
Pfad: `opendata.dwd.de/climate_environment/CDC/grids_germany/`
Gitter: 5×5 km, Zeitraum 1971–2100, Szenarien RCP 2.6 / 4.5 / 8.5.
→ Für Viewer: eigene Preprocessing-Pipeline nötig oder vorberechnete Werte cachen.

---

## ForstBW & ALKIS-Dienste

### Forstbezirke / Bewirtschaftungsgebiete (ForstBW)
```
WMS: https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_ForstBW_NachhaltWaldwirtschaft
WFS: https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Bewirtschaftungsgebiete_Waldwirtschaft_V02
Lizenz: CC BY-SA 4.0 · Quelle: "ForstBW, www.forstbw.de"
featureInfoType: "geojson"
```

### Flurstücke (ALKIS/LGL)
```
WMS: https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_INSP_BW_Flst_ALKIS
WFS: https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Flst_ALKIS
Lizenz: Open Data · Keine Eigentümerdaten im WFS
featureInfoType: "geojson"
```

---

## Bekannte Probleme & Lösungen

### Bereits gelöst (aus old/-Ordner extrahieren!)
- Beim ersten Start: `old/`-Ordner lesen und folgende Infos extrahieren:
  - Welche Layer-Namen tatsächlich funktionieren (GetCapabilities-Abgleich)
  - Welche GetFeatureInfo-Antwortformate die einzelnen Dienste liefern
  - Bereits implementierte Chart-Logiken übernehmen

### Bekannte strukturelle Probleme
1. **CORS bei GetFeatureInfo** → Desktop: Browser-Flag, Produktion: Server-Proxy
2. **WMS 1.1.1 vs 1.3.0** → Achsenreihenfolge BBOX unterschiedlich! Bei 1.3.0 ist es lat/lon, bei 1.1.1 lon/lat
3. **Leere GFI-Antwort** → immer auf `features.length === 0` prüfen vor Chart-Rendering
4. **Multi-Layer-Klick** → nur den obersten sichtbaren Layer abfragen (z-index aus Layer-Stack)
5. **Legende** → `GetLegendGraphic` liefert Bild, passt nicht zum App-Theme → als `<img>` einbetten mit `filter: invert()` im Dark Mode

### Layer-Namen ermitteln
```bash
# Lokal ausführen (braucht Internetzugang):
node scripts/fetch-capabilities.js
# Oder manuell:
# https://owsproxy.lgl-bw.de/owsproxy/ows/{SERVICE_NAME}?SERVICE=WMS&REQUEST=GetCapabilities
```

---

## Nützliche Links

- FVA Geodatendienste: https://www.fva-bw.de/daten-tools/geodaten/geodatendienste
- DWD Geodienste: https://www.dwd.de/DE/leistungen/geodienste/geodienste.html
- DWD CDC Bodenfeuchte Viewer: https://www.dwd.de/DE/leistungen/bofeu_anwendung/bofeuanwendung.html
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs/
- Observable Plot: https://observablehq.com/plot/
- Maptiler Styles: https://docs.maptiler.com/gl-style-specification/
- OWS-Proxy Metadaten: https://metadaten.geoportal-bw.de
