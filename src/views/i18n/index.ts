import type { Sprache } from '../../types.ts';
import { de, type FeldText, type Texte } from './de.ts';
import { en } from './en.ts';
import { fr } from './fr.ts';
import { it } from './it.ts';

export type { FeldText, Texte };

/** Alle Texte der Lesefassung pro Sprache. Deutsch ist die Quellsprache (siehe de.ts). */
export const TEXTE: Record<Sprache, Texte> = { de, fr, it, en };

export function texte(sprache: Sprache): Texte {
  return TEXTE[sprache];
}
