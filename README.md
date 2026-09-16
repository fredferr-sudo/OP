# OP Collection — application mobile de collection One Piece Card Game

Application mobile (iOS + Android) pour consulter l'intégralité du catalogue du
**One Piece Card Game**, tenir sa collection, et suivre les prix sur **Cardmarket**,
**TCGplayer** et **eBay** — prix du jour et historique sur 30 jours.

```
apps/mobile      Application Expo / React Native (TypeScript)
services/api     Backend Node : catalogue, correspondances produits, relevés de prix
packages/shared  Types métier partagés entre les deux
```

## Ce que fait l'app

- **Catalogue complet**, rangé selon le classement du jeu : extensions (OP01…),
  decks de structure (ST01…), produits spéciaux (EB, PRB), promotions, prix de tournoi.
- **Fiche carte** : visuel officiel, effet, déclencheur, coût / puissance / contre / vie,
  attributs, traits, et les illustrations alternatives de la même carte.
- **Recherche et filtres** : plein texte (nom, code, effet), couleur, type, rareté,
  option « masquer les alt-arts ».
- **Ma collection** : quantités par état (NM / EX / GD / PL), valeur estimée selon la
  marketplace de ton choix, montant investi, plus-value, complétion par produit.
  Stockée sur l'appareil, donc consultable hors ligne, et sauvegardée sur le backend.
- **Prix** : le prix courant sur les trois marketplaces, et une courbe sur 30 jours.

## Démarrage rapide

Il faut **Node.js 22.18 ou plus** (`node --version`). Rien à compiler et aucun
script d'installation : ni Python, ni Visual Studio Build Tools, et rien à
autoriser dans npm.

```bash
npm install

# 1. Backend : remplir la base et lancer le serveur
cp services/api/.env.example services/api/.env
npm run api:sync -- catalog      # récupère le catalogue
npm run api                      # http://localhost:4000, à laisser tourner

# 2. Application, dans un second terminal
npm run mobile                   # puis scanner le QR code avec Expo Go
```

Sous Windows (invite de commandes), la copie du fichier d'environnement s'écrit
`copy services\api\.env.example services\api\.env` ; tout le reste est identique.

Le backend doit tourner pendant que l'app est ouverte : c'est lui qui sert le
catalogue et les prix. Sans lui, l'app affiche « Backend injoignable ».

Sur un téléphone physique, `localhost` désigne le téléphone, pas ton ordinateur :
ouvre l'onglet **Réglages** de l'app et saisis l'adresse IP locale de ta machine
(`http://192.168.x.x:4000`). L'app la devine automatiquement quand elle est lancée
depuis Expo Go sur le même réseau.

### Tester sur ordinateur

```bash
npm run mobile:web     # ouvre l'app dans le navigateur, sur http://localhost:8081
```

L'app tourne alors entièrement dans le navigateur, collection locale comprise
(`expo-sqlite` passe par WebAssembly). La mise en page s'adapte : la grille affiche
plus de colonnes en fenêtre large, et le contenu reste borné pour rester lisible.
Le navigateur utilise sa propre base locale : la collection y est distincte de celle
du téléphone, mais les deux se sauvegardent sur le même backend.

Les autres cibles depuis le même bundler : `npm run mobile` puis `a` pour un
émulateur Android, `i` pour un simulateur iOS (macOS uniquement).

Sans aucune clé d'API, tout fonctionne déjà : le catalogue vient d'une source
communautaire ouverte, seuls les prix restent vides.

## Les prix : comment ça marche

### Les sources

Les trois marketplaces sont interrogées via **leurs APIs officielles**, chacune
derrière un connecteur indépendant (`services/api/src/prices/providers/`).
Une source dont les clés ne sont pas renseignées est simplement ignorée ; les
autres continuent de fonctionner.

| Source | Accès | Ce qu'on en tire |
| --- | --- | --- |
| **dotgg** | aucun — c'est la source du catalogue | prix courant Cardmarket et TCGplayer, normal et foil |
| **Cardmarket** | OAuth 1.0a, jetons créés depuis ton compte (Account → API) | prix bas, tendance, moyennes 1 / 7 / 30 jours, nombre d'offres |
| **TCGplayer** | OAuth2 client credentials, portail développeur | low / mid / market / direct low |
| **eBay** | OAuth2 client credentials, Browse API | médiane et minimum des annonces en cours |

Notes utiles avant de demander les accès :

- **TCGplayer** a fermé les inscriptions publiques à son API ; l'accès passe
  aujourd'hui par leur programme partenaire.
- **eBay** Browse API donne les **annonces en cours**. Les **ventes conclues**
  relèvent de l'API *Marketplace Insights*, soumise à approbation ; le connecteur
  est prêt à basculer dessus le jour où tu l'obtiens.
- Aucun scraping : les trois connecteurs n'appellent que des APIs publiques
  documentées, ce qui les rend stables et conformes aux conditions d'utilisation.

### La correspondance carte ↔ produit

Les marketplaces ne connaissent pas les identifiants Bandai, et c'est le point le
plus fragile d'un suivi de prix : un mauvais rapprochement affiche un prix faux
sans rien signaler.

Deux mécanismes, dans cet ordre. La synchronisation du catalogue enregistre les
identifiants produit **fournis par dotgg** pour Cardmarket et TCGplayer : ce sont
des correspondances exactes, notées avec une confiance de 1, qui couvrent la
quasi-totalité du catalogue. Pour le reste — et pour eBay, qui n'a pas de notion
de produit — chaque carte est rapprochée par un score (`src/prices/matching.ts`)
appuyé d'abord sur le code imprimé (`OP01-001`), puis sur le nom et l'extension,
avec une pénalité quand une illustration alternative risque d'être confondue avec
la carte de base. En dessous de 0,55 de confiance, la carte n'est pas relevée
plutôt que de produire un prix faux.

### L'historique

Un relevé par jour et par marketplace est écrit en base (`price_snapshots`), par une
tâche planifiée (`PRICE_CRON`, 4h15 par défaut). Au bout d'un mois, l'historique
30 jours est entièrement constitué de mesures réelles.

Pour ne pas afficher un graphique vide le premier jour, le premier relevé
Cardmarket sert à **reconstruire** le mois écoulé à partir des moyennes glissantes
AVG1 / AVG7 / AVG30 (`src/prices/backfill.ts`) : elles contraignent trois segments
successifs, qu'on interpole puis recale pour que la courbe redonne exactement ces
trois moyennes. Ces points sont marqués comme estimés, grisés dans l'app, et
remplacés par les vraies mesures au fil des jours.

## Commandes

| Commande | Effet |
| --- | --- |
| `npm run api` | Démarre le backend et ses tâches planifiées |
| `npm run api:sync -- catalog` | Synchronise le catalogue |
| `npm run api:probe` | Teste les sources de catalogue et décrit leurs réponses |
| `npm run api:stats` | Rapport de couverture : prix, visuels, produits mal nommés |
| `npm run api:sync -- prices --limit 200` | Relève les prix de 200 cartes |
| `npm run mobile` | Démarre le bundler Expo |
| `npm run mobile:web` | Ouvre l'app dans le navigateur |
| `npm run typecheck` | Vérifie les trois paquets |

Les cartes de ta collection sont relevées en priorité, puis les autres par ancienneté
de dernier relevé : le quota journalier des APIs est ainsi dépensé là où il sert.

## Le backend en bref

Fastify, tâches planifiées avec `node-cron`, et **`node:sqlite`** — le module
SQLite intégré à Node depuis la 22.5 — pour le stockage. Le schéma tient dans
`services/api/src/db/schema.sql`.

Ce choix est délibéré : les bibliothèques SQLite natives (`better-sqlite3` et
consorts) exigent un binaire précompilé par version de Node et par plateforme,
et à défaut une chaîne de compilation C++ — sous Windows, Python plus les Visual
Studio Build Tools. Le module intégré supprime ce problème : `npm install`
n'a rien à compiler, aujourd'hui comme après une montée de version de Node.

Dans le même esprit, le backend s'exécute directement avec `node src/index.ts` :
Node sait effacer les types TypeScript depuis la 22.18, ce qui évite `tsx` et donc
`esbuild`. Plus aucune dépendance du projet n'a de script d'installation — npm
n'a rien à autoriser. En contrepartie, le code se limite à la syntaxe TypeScript
effaçable (ni enum, ni namespace, ni propriété de paramètre) et importe ses
modules avec l'extension `.ts` ; `tsconfig.json` impose les deux règles, donc
`npm run typecheck` signale tout écart.

Deux particularités de `node:sqlite` à connaître avant de toucher au code :
il refuse les valeurs `undefined` et les booléens (d'où le helper `bool()`), ainsi
que toute clé de paramètre nommé absente de la requête — les paramètres sont donc
construits explicitement, jamais par diffusion d'objet. Et comme il n'offre pas
d'équivalent à `db.transaction()`, `src/db/index.ts` fournit un helper
`transaction()` qui pilote BEGIN / COMMIT / ROLLBACK.

| Route | Rôle |
| --- | --- |
| `GET /sets` | Produits, déjà regroupés par nature |
| `GET /cards/:id/image` | Visuel de la carte, relayé et mis en cache |
| `GET /cards` | Recherche et filtres, paginée |
| `GET /cards/:id` | Une carte et ses illustrations alternatives |
| `GET /cards/:id/prices?days=30` | Prix courants + historique |
| `GET /collection` | Collection sauvegardée, cartes jointes, statistiques |
| `PUT /collection` | Remplace la sauvegarde par la collection de l'appareil |
| `PATCH /collection` | Met à jour une seule ligne |
| `POST /sync/catalog`, `POST /sync/prices` | Synchronisation à la demande |
| `GET /health` | État du serveur et des sources de prix configurées |

## Les visuels des cartes

Les images officielles sont servies par le site de l'éditeur, qui restreint
l'affichage depuis une autre origine : un navigateur qui les demande directement
reçoit un refus, là où un appel serveur passe. Le backend les récupère donc
lui-même (`GET /cards/:id/image`), les met en cache dans `data/images/` et les
sert à l'app. Conséquences utiles : une seule origine à interroger, un second
affichage instantané, et les visuels restent disponibles hors ligne.

Les réponses de l'API réécrivent `imageUrl` vers ce relais, en construisant
l'adresse à partir de la requête reçue — elle reste donc correcte que l'app
appelle le backend par « localhost » depuis un ordinateur ou par son IP locale
depuis un téléphone.

## Sources du catalogue

`CATALOG_PROVIDER` choisit la source : `dotgg` (défaut), `apitcg` (clé gratuite)
ou `local` (jeu de données de démonstration embarqué, pour travailler hors ligne).

**dotgg** rend les 5500+ cartes du jeu en un seul appel, sans clé. Surtout, chaque
carte y porte déjà son identifiant produit chez Cardmarket et chez TCGplayer, avec
leurs prix courants. C'est décisif : associer une carte à son produit est le point
le plus fragile d'un suivi de prix, et cette source donne la correspondance exacte
au lieu d'un rapprochement par nom. Conséquence pratique, l'app affiche des prix
dès la première synchronisation, sans aucune clé d'API.

Le nom des produits demande un peu de soin. La source nomme chaque produit dans
la langue de la carte, et le champ correspondant liste *tous* les produits où la
carte figure — une carte d'extension rééditée dans une collection premium
japonaise portait donc le nom de cette collection. Le nom retenu est celui dont
le code entre crochets correspond à l'extension de la carte, et les noms anglais
canoniques d'optcgapi (ses deux endpoints de produits fonctionnent, contrairement
à sa liste de cartes) l'emportent quand ils existent.

Ce sont des APIs communautaires, sans contrat versionné : leurs adresses bougent.
La synchronisation enchaîne donc les sources et termine sur le catalogue local
plutôt que de laisser l'app vide — en disant explicitement ce qui a échoué et si
le résultat n'est que la démonstration. `npm run api:probe` interroge chaque
source et décrit ce qu'elle renvoie réellement, visuels des cartes compris :
c'est l'outil à lancer quand une synchronisation se dégrade.

## Ce qui reste à faire

- Scanner une carte par l'appareil photo pour l'ajouter à la collection.
- Alertes de prix (« préviens-moi si cette carte passe sous X € »).
- Constructeur de deck avec contrôle de légalité.
- Ventes conclues eBay, dès l'obtention de l'accès Marketplace Insights.
