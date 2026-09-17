/**
 * Impressions françaises et japonaises, depuis les listes officielles Bandai.
 *
 * Le jeu de données « punk-records » est une copie versionnée des listes de
 * cartes publiées par Bandai sur ses propres sites — `fr.onepiece-cardgame.com`
 * pour la France, `www.onepiece-cardgame.com` pour le Japon. Les textes, les
 * raretés et les visuels viennent donc de l'éditeur, pas d'un site de revente.
 *
 * On ne récupère pas les fichiers un par un : le dépôt en compte près de huit
 * mille pour les deux éditions, et autant de requêtes HTTP se feraient limiter
 * bien avant la fin. On en garde une copie locale, mise à jour par `git` en
 * clone partiel (`--filter=blob:none`) restreint aux éditions demandées : la
 * première synchronisation télécharge une quarantaine de mégaoctets, les
 * suivantes ne transfèrent que les cartes modifiées depuis.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { CardLanguage } from '@op/shared';
import { printingId } from '@op/shared';
import { config } from '../../config.ts';
import {
  inferSetKind,
  normalizeCategory,
  normalizeColors,
  parseArtVariant,
  parseNumber,
  resolveProductId,
} from '../classify.ts';
import type { CatalogCard, CatalogPayload } from '../types.ts';

const run = promisify(execFile);

/** Dossier du dépôt pour chaque édition. */
const LANGUAGE_DIRS: Partial<Record<CardLanguage, string>> = {
  EN: 'english',
  FR: 'french',
  JP: 'japanese',
};

/**
 * Raretés, dans le vocabulaire déjà utilisé par le catalogue global.
 * Les deux sources décrivent la même chose avec des mots différents ; aligner
 * ici évite que l'app affiche « TreasureRare » à côté de « TR » pour la même
 * carte selon l'édition regardée.
 */
const RARITIES: Record<string, string> = {
  Common: 'C',
  Uncommon: 'UC',
  Rare: 'R',
  SuperRare: 'SR',
  SecretRare: 'SEC',
  Leader: 'L',
  Special: 'SP CARD',
  Promo: 'P',
  TreasureRare: 'TR',
};

interface RawCard {
  id: string;
  pack_id: string;
  name: string;
  rarity: string | null;
  category: string | null;
  img_full_url: string | null;
  colors: string[] | null;
  cost: number | null;
  attributes: string[] | null;
  power: number | null;
  counter: number | string | null;
  types: string[] | null;
  effect: string | null;
  trigger: string | null;
}

interface RawPack {
  id: string;
  raw_title: string;
  title_parts: { prefix?: string | null; title?: string | null; label?: string | null };
}

/**
 * Le dépôt conserve les entités HTML de la source, et les échappe deux fois
 * (« L&amp;apos;ÉCLAIR ») : une seule passe laisserait « L&apos;ÉCLAIR » à
 * l'écran. Elles ne touchent pas que les titres de produits — « Shachi &amp;
 * Penguin », « キッド&amp;キラー », et surtout les 77 cartes françaises dont la
 * ponctuation double porte l'espace insécable de la typographie française.
 *
 * Cette espace est rendue par le caractère insécable lui-même, et non par une
 * espace ordinaire : c'est ce qui empêche « Un souci ? » de se couper avant le
 * point d'interrogation en bout de ligne.
 */
function decodeEntities(value: string): string {
  const once = (text: string) =>
    text
      .replace(/&amp;/g, '&')
      .replace(/&apos;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, '\u00a0');
  return once(once(value)).trim();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Éditions demandées, hors anglais qui vient du catalogue global. */
export function extraLanguages(): CardLanguage[] {
  return config.catalog.printings
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is CardLanguage => value in LANGUAGE_DIRS && value !== 'EN');
}

export function punkRecordsEnabled(): boolean {
  return extraLanguages().length > 0;
}

/**
 * Met la copie locale à jour, en ne matérialisant que les éditions demandées.
 *
 * `--filter=blob:none` ne télécharge que l'arborescence, puis `sparse-checkout`
 * décide des fichiers dont le contenu est réellement récupéré. Le catalogue
 * anglais n'est jamais matérialisé en entier : seuls son index et sa liste de
 * produits le sont, parce qu'ils servent à nommer les produits japonais (voir
 * `borrowedPackTitles`).
 */
async function ensureCheckout(
  languages: CardLanguage[],
  extraPatterns: string[] = [],
): Promise<string> {
  const dir = config.catalog.punkRecordsDir;
  const patterns = [
    ...languages.map((language) => `${LANGUAGE_DIRS[language]}/`),
    'english/packs.json',
    'english/index/',
    ...extraPatterns,
  ];

  const git = (...args: string[]) => run('git', args, { cwd: dir, maxBuffer: 64 * 1024 * 1024 });

  const fresh = !existsSync(join(dir, '.git'));

  if (fresh) {
    mkdirSync(dir, { recursive: true });
    try {
      // `--no-checkout` : rien n'est matérialisé avant que les règles de
      // restriction soient posées, sinon git récupère les sept éditions.
      await run('git', [
        'clone',
        '--filter=blob:none',
        '--no-checkout',
        '--depth',
        '1',
        config.catalog.punkRecordsUrl,
        dir,
      ]);
    } catch (error) {
      // Un clone interrompu laisse un dossier à moitié rempli que la tentative
      // suivante prendrait pour une copie utilisable : on efface les traces
      // plutôt que de bloquer durablement les éditions régionales.
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  } else {
    await git('fetch', '--depth', '1', 'origin', 'HEAD');
  }

  // `--no-cone` accepte un chemin de fichier isolé, ce que le mode par défaut
  // ne sait pas faire : on ne veut pas des vingt mégaoctets du catalogue anglais
  // pour ses deux fichiers d'index.
  await git('sparse-checkout', 'set', '--no-cone', ...patterns);

  // Après un clone sans copie de travail, il n'y a pas encore d'arborescence à
  // remettre à niveau : c'est `checkout` qui la crée, `reset` qui l'actualise.
  if (fresh) await git('checkout');
  else await git('reset', '--hard', 'FETCH_HEAD');

  return dir;
}

/**
 * Titres d'une édition qui n'en publie pas, empruntés à l'édition anglaise.
 *
 * Le dépôt livre `japanese/packs.json` vide : l'édition japonaise n'a donc aucun
 * titre, et rien n'y dit à quel produit rattacher une carte. On le retrouve par
 * les cartes elles-mêmes — un paquet japonais et son équivalent anglais
 * contiennent très largement les mêmes numéros — en retenant pour chacun le
 * paquet anglais avec lequel il partage le plus de cartes. Sur les 62 paquets
 * japonais, la correspondance est franche pour 57 ; les 5 restants sont des
 * paquets promotionnels, plus fournis côté japonais, et le maximum les désigne
 * malgré tout correctement.
 */
function borrowedPackTitles(languageDir: string, dir: string): Map<string, RawPack> {
  const packs = readJson<Record<string, RawPack>>(join(dir, 'english/packs.json'));
  const index = readJson<Record<string, { pack_id: string }>>(
    join(dir, 'english/index/cards_by_id.json'),
  );

  const englishPacks = new Map<string, Set<string>>();
  for (const [cardId, entry] of Object.entries(index)) {
    let ids = englishPacks.get(entry.pack_id);
    if (!ids) englishPacks.set(entry.pack_id, (ids = new Set()));
    ids.add(cardId);
  }

  const result = new Map<string, RawPack>();
  const cardsDir = join(languageDir, 'cards');
  if (!existsSync(cardsDir)) return result;

  for (const packId of readdirSync(cardsDir)) {
    const cardIds = readdirSync(join(cardsDir, packId)).map((file) => basename(file, '.json'));

    let best: string | null = null;
    let bestScore = 0;
    for (const [englishId, englishIds] of englishPacks) {
      let shared = 0;
      for (const cardId of cardIds) if (englishIds.has(cardId)) shared += 1;
      if (shared > bestScore) {
        best = englishId;
        bestScore = shared;
      }
    }

    const pack = best ? packs[best] : undefined;
    if (pack) result.set(packId, pack);
  }

  return result;
}

/**
 * Identifiant de produit et nom affiché, pour un paquet donné.
 *
 * Le code entre crochets du titre (« [OP-11] ») est l'information fiable ; on le
 * passe à la logique de classement déjà en place, celle-là même qui range les
 * illustrations alternatives dans la collection premium dont elles viennent.
 * Deux paquets par édition n'ont pas de code — les promotions et les « autres
 * produits ». Leur identifiant est pris sur le titre anglais, pour que la promo
 * française et la promo japonaise se retrouvent sous la même clé.
 */
function productOf(pack: RawPack | undefined, cardId: string, englishTitle: string | null): {
  setId: string;
  name: string;
} {
  const label = pack?.title_parts?.label ?? null;
  const name = decodeEntities(
    pack?.title_parts?.title || pack?.raw_title || englishTitle || 'Produit inconnu',
  );

  if (label) {
    const code = label.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return { setId: resolveProductId(cardId, label, { code, name }), name };
  }

  const fallback = decodeEntities(englishTitle ?? pack?.raw_title ?? 'Produit inconnu');
  return { setId: fallback.toUpperCase(), name };
}

/** Un paquet sans code : on le rapproche du paquet anglais de même numéro d'ordre. */
function englishTitleFor(packId: string, englishPacks: Record<string, RawPack>): string | null {
  const suffix = packId.slice(-3);
  for (const [id, pack] of Object.entries(englishPacks)) {
    if (id.slice(-3) === suffix) return pack.title_parts?.title || pack.raw_title;
  }
  return null;
}

/** Une entrée de la liste officielle, telle que l'index du dépôt la décrit. */
export interface OfficialEntry {
  name: string;
  rarity: string | null;
  pack_id: string;
}

/**
 * Liste officielle Bandai d'une édition, sans télécharger ses cartes.
 *
 * L'index tient en un fichier d'un mégaoctet et suffit à répondre à la seule
 * question qui compte ici : cette carte existe-t-elle ? C'est la référence face
 * à laquelle mesurer ce qu'une source commerciale ignore — ou invente.
 */
export async function officialIndex(
  language: CardLanguage,
): Promise<Record<string, OfficialEntry>> {
  const directory = LANGUAGE_DIRS[language];
  if (!directory) throw new Error(`Édition inconnue : ${language}`);

  // Les éditions configurées restent du voyage : restreindre la copie au seul
  // index effacerait les cartes déjà téléchargées, que la synchronisation
  // suivante devrait remettre en place.
  const dir = await ensureCheckout(extraLanguages(), [`${directory}/index/cards_by_id.json`]);
  const path = join(dir, directory, 'index/cards_by_id.json');
  if (!existsSync(path)) throw new Error(`Liste officielle absente pour ${language}`);

  const raw = readJson<Record<string, Record<string, unknown>>>(path);
  // L'édition japonaise livre un index vide, comme sa liste de produits. Le
  // traiter comme une liste officielle ferait conclure que ses 4987 cartes sont
  // toutes hors-liste, ce qui est exactement l'inverse de la vérité.
  if (Object.keys(raw).length === 0) {
    throw new Error(
      `la source publie une liste vide pour ${language} (défaut connu de l'édition japonaise)`,
    );
  }

  const result: Record<string, OfficialEntry> = {};
  for (const [id, entry] of Object.entries(raw)) {
    result[id.toUpperCase()] = {
      name: decodeEntities(String(entry.name ?? '')),
      rarity: entry.rarity ? (RARITIES[String(entry.rarity)] ?? String(entry.rarity)) : null,
      pack_id: String(entry.pack_id ?? ''),
    };
  }
  return result;
}

export interface PunkRecordsPayload extends CatalogPayload {
  /** Nom du produit dans chaque édition, quand Bandai le traduit. */
  setNames: Array<{ setId: string; language: CardLanguage; name: string }>;
  byLanguage: Partial<Record<CardLanguage, number>>;
}

export async function fetchPunkRecords(): Promise<PunkRecordsPayload> {
  const languages = extraLanguages();
  const dir = await ensureCheckout(languages);

  const englishPacks = readJson<Record<string, RawPack>>(join(dir, 'english/packs.json'));
  const cards: CatalogCard[] = [];
  const setNames = new Map<string, { setId: string; language: CardLanguage; name: string }>();
  const sets = new Map<string, { id: string; name: string }>();
  const byLanguage: Partial<Record<CardLanguage, number>> = {};

  for (const language of languages) {
    const root = join(dir, LANGUAGE_DIRS[language]!);
    const cardsDir = join(root, 'cards');
    if (!existsSync(cardsDir)) continue;

    // L'édition japonaise livre une liste de produits vide : ses titres sont
    // alors reconstitués depuis l'édition anglaise, faute de mieux. Le test
    // porte sur le contenu et non sur la langue, pour que la source puisse
    // combler ce manque sans qu'on ait à y revenir.
    const own = existsSync(join(root, 'packs.json'))
      ? readJson<Record<string, RawPack>>(join(root, 'packs.json'))
      : {};
    const localizedTitles = Object.keys(own).length > 0;
    const packs = localizedTitles
      ? new Map(Object.entries(own))
      : borrowedPackTitles(root, dir);

    let count = 0;

    for (const packId of readdirSync(cardsDir)) {
      const pack = packs.get(packId);
      const englishTitle = englishTitleFor(packId, englishPacks);

      for (const file of readdirSync(join(cardsDir, packId))) {
        if (!file.endsWith('.json')) continue;
        const raw = readJson<RawCard>(join(cardsDir, packId, file));

        const { setId, name: setName } = productOf(pack, raw.id, englishTitle);
        const leader = normalizeCategory(raw.category) === 'LEADER';
        sets.set(setId, { id: setId, name: setName });
        // Un titre emprunté à l'édition anglaise n'est pas une traduction : le
        // ranger comme nom japonais ferait passer « A Fist of Divine Speed »
        // pour le titre japonais du produit, ce qu'il n'est pas.
        if (localizedTitles) {
          setNames.set(`${setId}|${language}`, { setId, language, name: setName });
        }

        cards.push({
          // L'identifiant porte l'édition : sans cela la carte française et la
          // carte japonaise du même numéro s'écraseraient l'une l'autre.
          id: printingId(raw.id, language),
          code: raw.id.replace(/_p\d+$/i, '').toUpperCase(),
          name: decodeEntities(raw.name),
          setId,
          setName,
          category: normalizeCategory(raw.category),
          rarity: raw.rarity ? (RARITIES[raw.rarity] ?? raw.rarity) : null,
          colors: normalizeColors(raw.colors),
          // La source loge la Vie d'un LEADER dans le champ « coût » — c'est la
          // même case sur la carte. Un LEADER n'ayant pas de coût, laisser la
          // valeur des deux côtés afficherait un coût qui n'existe pas.
          cost: leader ? null : (raw.cost ?? null),
          power: raw.power ?? null,
          counter: parseNumber(raw.counter),
          life: leader ? (raw.cost ?? null) : null,
          attributes: raw.attributes ?? [],
          types: (raw.types ?? []).map(decodeEntities),
          effect: raw.effect ? decodeEntities(raw.effect) : null,
          trigger: raw.trigger ? decodeEntities(raw.trigger) : null,
          // L'adresse porte un paramètre de cache propre à la source ; on le
          // garde, le site refusant parfois de servir l'image sans lui.
          imageUrl: raw.img_full_url,
          artVariant: parseArtVariant(raw.id),
          language,
        });
        count += 1;
      }
    }

    byLanguage[language] = count;
  }

  return {
    sets: [...sets.values()].map((set) => ({
      id: set.id,
      name: set.name,
      kind: inferSetKind(set.id, set.name),
      code: set.id,
      releaseDate: null,
      imageUrl: null,
    })),
    cards,
    setNames: [...setNames.values()],
    byLanguage,
  };
}
