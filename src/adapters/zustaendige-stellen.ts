import { z } from 'zod';
import { EmptyResultError } from '../errors.ts';
import { geoResultsSchema, identifyUrl, nullableString } from '../http/geoadmin.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

/**
 * Zuständige Stellen aus der Amtlichen Vermessung Schweiz (swisstopo): Grundbuchamt und Nachführungsgeometer.
 * Ein `identify` am Gebäudepunkt auf zwei Layer, ein Request:
 *  - ch.swisstopo-vd.geometa-grundbuch: Grundbuchkreis mit Adresse, Telefon, E-Mail und Stand der Grundbuchführung
 *  - ch.swisstopo-vd.geometa-nfgeom: Nachführungsgeometer mit Firma, Adresse, Telefon, E-Mail, Stellvertreter-Flag
 *
 * Antwortform (results[].attributes), live 15.10.2026 (Fixtures stellen-wabern.json, stellen-zuerich.json, stellen-baden.json):
 *  grundbuch: fid, ortsteil_grundbuch, grundbuchfuehrung_d/_f/_i, grundbuchkreis, adresse (Zeilen mit «#» getrennt,
 *  «Poststrasse 25#3071 Ostermundigen»), telefon, email, bgdi_created, label. Leere Einträge haben null, «-» oder «# ».
 *  nfgeom: stellvertreter (bool), name, firmenname, adresse, telefon, email, bgdi_created, label.
 *
 * Der Grundbuch-Layer ist auf Gemeindeebene aufgelöst, ein Eintrag pro Ortsteil. In einer Stadt mit mehreren
 * Grundbuchkreisen (Zürich: 21 Ortsteil-Einträge, 11 Kreise) kommen alle Kreise, ohne zu sagen, welcher für die Parzelle
 * gilt. Dann gibt es nur die Zahl der Kreise und einen Hinweis, keine Kontaktdaten: Der erste Treffer wäre geraten.
 * Gleicher Kreis mit gleichem Kontakt zählt als einer (Baden: Ortsteile Baden und Turgi, ein Grundbuchamt).
 *
 * Das Feld `name` des Geometers ist eine Person und wird nicht gespeichert (keine Personendaten im Core).
 * Firma, Adresse, Telefon und E-Mail sind Amtskontakte.
 */
const LAYER_GRUNDBUCH = 'ch.swisstopo-vd.geometa-grundbuch';
const LAYER_GEOMETER = 'ch.swisstopo-vd.geometa-nfgeom';

const grundbuchAttrs = z.object({
  ortsteil_grundbuch: nullableString,
  grundbuchfuehrung_d: nullableString,
  grundbuchkreis: nullableString,
  adresse: nullableString,
  telefon: nullableString,
  email: nullableString,
});

const geometerAttrs = z.object({
  stellvertreter: z.boolean().nullable().optional(),
  firmenname: nullableString,
  adresse: nullableString,
  telefon: nullableString,
  email: nullableString,
});

/** «Poststrasse 25#3071 Ostermundigen» → «Poststrasse 25, 3071 Ostermundigen». Leere Teile («# ») fallen weg. */
export function adresseAusZeilen(s: string | null | undefined): string | null {
  if (!s) return null;
  const teile = s
    .split('#')
    .map((t) => t.trim())
    .filter(Boolean);
  return teile.length ? teile.join(', ') : null;
}

type Amt = { kreis: string; ortsteile: string[]; fuehrung: string | null; adresse: string | null; telefon: string | null; email: string | null };

export const zustaendigeStellen: Adapter = {
  manifest: {
    id: 'zustaendige-stellen',
    title: 'Zuständige Stellen',
    provider: 'swisstopo (Amtliche Vermessung Schweiz)',
    needs: ['lv95_bau'],
    yields: [],
    provides: ['grundbuch.', 'vermessung.geometer_'],
    ttlDays: 90,
    version: 1,
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© swisstopo (Amtliche Vermessung Schweiz)',
    endpoint: 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify?layers=all:ch.swisstopo-vd.geometa-grundbuch,ch.swisstopo-vd.geometa-nfgeom',
    status: 'verifiziert', // Live-Test 16.10.2026 an den fünf goldenen Adressen
    notes:
      'Grundbuchkreis und Nachführungsgeometer am Gebäudepunkt. Mehrere Grundbuchkreise in der Gemeinde: nur Anzahl und Hinweis, keine Kontaktdaten (der Layer löst die Kreise nicht räumlich auf). Der Name des Geometers (Person) wird nicht gespeichert.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = ctx.keys.lv95_bau as LV95;
    const url = identifyUrl([LAYER_GRUNDBUCH, LAYER_GEOMETER], point);
    const { data } = await ctx.http.json(url, geoResultsSchema, { timeoutMs: this.manifest.timeoutMs });

    // Grundbuch: leere Einträge raus (kein Kreis, «-»), gleicher Kreis mit gleichem Kontakt zählt einmal.
    const kreise = new Map<string, Amt>();
    for (const r of data.results) {
      if (r.layerBodId !== LAYER_GRUNDBUCH) continue;
      const a = grundbuchAttrs.parse(r.attributes);
      if (!a.grundbuchkreis) continue;
      const adresse = adresseAusZeilen(a.adresse);
      const k = [a.grundbuchkreis, adresse, a.telefon, a.email].join('|');
      const amt = kreise.get(k) ?? { kreis: a.grundbuchkreis, ortsteile: [], fuehrung: a.grundbuchfuehrung_d, adresse, telefon: a.telefon, email: a.email };
      if (a.ortsteil_grundbuch && !amt.ortsteile.includes(a.ortsteil_grundbuch)) amt.ortsteile.push(a.ortsteil_grundbuch);
      kreise.set(k, amt);
    }
    if (kreise.size === 0) throw new EmptyResultError(url, 'Kein Grundbuchkreis am Gebäudepunkt');

    const facts: AdapterOutput['facts'] = [];
    const push = (key: string, value: AdapterOutput['facts'][number]['value']) => facts.push({ key, value, request_url: url, confidence: 1 });

    if (kreise.size === 1) {
      const a = [...kreise.values()][0]!;
      push('grundbuch.kreis', a.kreis);
      // Ortsteil nur, wenn er eindeutig ist (Baden: Ortsteile Baden und Turgi am selben Punkt, welcher gilt, sagt der Layer nicht)
      if (a.ortsteile.length === 1) push('grundbuch.ortsteil', a.ortsteile[0]!);
      if (a.fuehrung) push('grundbuch.fuehrung', a.fuehrung);
      if (a.adresse) push('grundbuch.adresse', a.adresse);
      if (a.telefon) push('grundbuch.telefon', a.telefon);
      if (a.email) push('grundbuch.email', a.email);
    } else {
      push('grundbuch.kreise_anzahl', kreise.size);
      push(
        'grundbuch.hinweis',
        `Die Gemeinde hat ${kreise.size} Grundbuchkreise. Die Amtliche Vermessung löst sie nicht räumlich auf, zuständig ist das Grundbuchamt bzw. Notariat des Quartiers.`,
      );
    }

    // Nachführungsgeometer: der ordentliche vor dem Stellvertreter. `name` (Person) wird bewusst nicht gelesen.
    const geometer = data.results.filter((r) => r.layerBodId === LAYER_GEOMETER).map((r) => geometerAttrs.parse(r.attributes));
    const g = geometer.find((x) => x.stellvertreter === false) ?? geometer[0];
    if (g) {
      if (g.firmenname) push('vermessung.geometer_firma', g.firmenname);
      const adresse = adresseAusZeilen(g.adresse);
      if (adresse) push('vermessung.geometer_adresse', adresse);
      if (g.telefon) push('vermessung.geometer_telefon', g.telefon);
      if (g.email) push('vermessung.geometer_email', g.email);
    }

    return { facts, keys: {} };
  },
};
