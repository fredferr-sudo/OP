import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.ts';
import { request } from './lib/http.ts';

/**
 * Relais des visuels de cartes.
 *
 * Les images officielles sont servies par le site de l'éditeur, qui restreint
 * l'affichage depuis un autre site (en-tête Referer). Un navigateur qui les
 * demande directement reçoit donc souvent un refus, là où un appel serveur passe.
 * Le backend les récupère lui-même, les met en cache sur disque, puis les sert :
 * l'app n'a plus qu'une seule origine à interroger, et le second affichage est
 * instantané et hors ligne.
 */

const cacheDir = join(dirname(config.databasePath), 'images');

/** Cartes dont aucun visuel n'existe : inutile de redemander à chaque affichage. */
const missing = new Set<string>();

export interface CardImage {
  body: Buffer;
  contentType: string;
}

/** Les identifiants viennent de l'URL : on n'accepte que ce qui compose un nom de carte. */
export function isSafeCardId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,40}$/.test(id);
}

function cachePath(cardId: string): string {
  return join(cacheDir, `${cardId}.img`);
}

/**
 * Adresses à essayer, dans l'ordre.
 * L'URL enregistrée avec la carte d'abord, puis le site japonais, qui couvre les
 * produits jamais sortis en anglais.
 */
function candidates(cardId: string, storedUrl: string | null): string[] {
  const urls: string[] = [];
  if (storedUrl) urls.push(storedUrl);

  const fileName = storedUrl?.split('/').pop() ?? `${cardId}.png`;
  const japanese = `https://www.onepiece-cardgame.com/images/cardlist/card/${fileName}`;
  if (!urls.includes(japanese)) urls.push(japanese);

  return urls;
}

export async function loadCardImage(
  cardId: string,
  storedUrl: string | null,
): Promise<CardImage | null> {
  if (missing.has(cardId)) return null;

  const path = cachePath(cardId);
  if (existsSync(path)) {
    const body = await readFile(path);
    return { body, contentType: detectType(body) };
  }

  for (const url of candidates(cardId, storedUrl)) {
    try {
      const response = await request(url, {
        retries: 0,
        timeoutMs: 20_000,
        // Certains hébergeurs refusent une requête sans navigateur déclaré.
        headers: { accept: 'image/*', 'user-agent': 'op-collection/0.1 (+personal collection app)' },
      });
      if (!response.ok) continue;

      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) continue;

      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength === 0) continue;

      mkdirSync(cacheDir, { recursive: true });
      await writeFile(path, body);
      return { body, contentType: type };
    } catch {
      // Adresse suivante.
    }
  }

  missing.add(cardId);
  return null;
}

/** Le type est déduit des premiers octets, le cache ne conservant pas l'en-tête. */
function detectType(body: Buffer): string {
  if (body.length > 12) {
    if (body[0] === 0x89 && body[1] === 0x50) return 'image/png';
    if (body[0] === 0xff && body[1] === 0xd8) return 'image/jpeg';
    if (body.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  }
  return 'application/octet-stream';
}

/** Nombre de visuels déjà en cache, pour le rapport de diagnostic. */
export function cachedImageCount(): number {
  if (!existsSync(cacheDir)) return 0;
  return readdirSync(cacheDir).length;
}
