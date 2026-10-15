import type { Adapter } from '../types.ts';
import { avParzelle } from './av-parzelle.ts';
import { geocode } from './geocode.ts';
import { gwr } from './gwr.ts';
import { laermStrasse } from './laerm-strasse.ts';
import { oevGueteklasse } from './oev-gueteklasse.ts';
import { radon } from './radon.ts';
import { sonnendach } from './sonnendach.ts';

/**
 * Alle Adapter. Reihenfolge ist nur für die Anzeige und für Key-Konflikte (erster Schreiber gewinnt)
 * relevant. Den Ablauf bestimmt der Resolver aus den Manifesten.
 *
 * Neuer Adapter: Datei daneben anlegen, hier eintragen, docs/QUELLEN.md ergänzen. Siehe docs/ADAPTER-SCHREIBEN.md.
 */
export const adapters: Adapter[] = [geocode, gwr, avParzelle, sonnendach, oevGueteklasse, radon, laermStrasse];

export { avParzelle, geocode, gwr, laermStrasse, oevGueteklasse, radon, sonnendach };
