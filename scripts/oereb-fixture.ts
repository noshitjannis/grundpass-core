#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Verkleinert eine rohe ÖREB-Aufzeichnung zu einer Fixture, Struktur erhalten:
 *
 *   tsx scripts/oereb-fixture.ts <quelle.json> <ziel.json> "<Hinweis: Adresse, Datum, URL, Besonderheit>"
 *
 * Weg: Geometrien, Bilder und Logos (auch Base64 und Symbol-URLs), Glossar, allgemeine Informationen, Disclaimer, WMS-Verweise
 * (tragen bei FR ein Token), Pläne fürs Grundbuch, Erweiterungen, Codelisten. Rechtsvorschriften bleiben pro Beschränkung genau
 * eine: die, deren Titel nach Baureglement aussieht (der Adapter liest sie als zone.baureglement_url), sonst die erste.
 * `Map.OtherLegend` bleibt nur bei GeoShop-Diensten (UR, OW, NW, Hülle mit «?xml»), weil sie die Zonenbezeichnung dort führen; sonst fällt `Map` weg. Die Hülle (GetExtractByIdResponse,
 * «?xml», Item) bleibt, damit der Adapter die Form erkennt. `_hinweis` kommt als erster Schlüssel dazu.
 */
const WEG = new Set([
  'Glossary', 'GeneralInformation', 'Disclaimer',
  'LogoPLRCadastreRef', 'FederalLogoRef', 'CantonalLogoRef', 'MunicipalityLogoRef', 'QRCodeRef',
  'Image', 'SymbolRef', 'ReferenceWMS', 'PlanForLandRegister', 'PlanForLandRegisterMainPage',
  'extensions', 'Geometry', 'Limit', 'AnyAttr', 'MetadataOfGeographicalBaseData', 'TypeCodelist', 'min', 'max', 'layerIndex', 'layerOpacity',
]);
const BAUREGLEMENT = /Baureglement|Nutzungsordnung|Zonenordnung|Zonenreglement|Bauordnung|Baugesetz der Gemeinde|Règlement (communal|général) (sur|des) (les )?constructions|Regolamento edilizio/i;

function titelVon(r: unknown): string {
  if (!r || typeof r !== 'object') return '';
  let t = (r as Record<string, unknown>).Title;
  if (t && typeof t === 'object' && !Array.isArray(t) && 'LocalisedText' in t) t = (t as Record<string, unknown>).LocalisedText;
  if (Array.isArray(t)) return t.map((x) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).Text ?? '') : String(x))).join(' ');
  if (t && typeof t === 'object') return String((t as Record<string, unknown>).Text ?? '');
  return typeof t === 'string' ? t : '';
}

/** GeoShop-Form (UR, OW, NW): Hülle mit «?xml». Nur dort braucht der Adapter Map.OtherLegend, sonst fliegt Map ganz raus. */
let geoshop = false;

function kuerze(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    if (key === 'LegalProvisions') {
      const eins = value.find((r) => BAUREGLEMENT.test(titelVon(r))) ?? value[0];
      return eins === undefined ? [] : [kuerze(eins, key)];
    }
    return value.map((v) => kuerze(v, key));
  }
  if (!value || typeof value !== 'object') {
    // Base64-Bilder und andere Riesenstrings
    if (typeof value === 'string' && value.length > 2000) return '[entfernt]';
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (WEG.has(k)) continue;
    if (k === 'Map' && !geoshop) continue;
    // .NET: Item, Item1 … sind Bild-URLs, wenn sie keine Objekte sind (das Objekt Item ist der Extract selbst)
    if (/^Item\d*$/.test(k) && (v === null || typeof v !== 'object')) continue;
    if (k === 'LegalProvisions' && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = kuerze(v, k); // GeoShop: einzelnes Objekt statt Array, bleibt eines
      continue;
    }
    out[k] = kuerze(v, k);
  }
  return out;
}

const [quelle, ziel, hinweis] = process.argv.slice(2);
if (!quelle || !ziel || !hinweis) {
  console.error('Verwendung: tsx scripts/oereb-fixture.ts <quelle.json> <ziel.json> "<Hinweis>"');
  process.exit(2);
}
const roh = readFileSync(quelle, 'utf8');
const geparst = JSON.parse(roh) as Record<string, unknown>;
geoshop = '?xml' in geparst;
const klein = kuerze(geparst) as Record<string, unknown>;
const mitHinweis = { _hinweis: hinweis, ...klein };
const text = JSON.stringify(mitHinweis, null, 1);
writeFileSync(ziel, text + '\n');
console.log(`${ziel}: ${roh.length} → ${text.length} Zeichen`);
