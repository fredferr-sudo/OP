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
| **Cardmarket** | OAuth 1.0a, jetons créés depuis ton compte (Account → API) | médiane des trois premières offres en Near Mint, prix bas, moyennes 1 / 7 / 30 jours, nombre d'offres |
| **TCGplayer** | OAuth2 client credentials, portail développeur | low / mid / market / direct low |
| **eBay** | OAuth2 client credentials, Browse API | médiane et minimum des annonces en cours |

Notes utiles avant de demander les accès :

- **Cardmarket** n'accepte plus de demandes d'accès à son API (« we are not
  accepting applications for API access at this time »). Le connecteur et son
  prix de référence — médiane des trois premières offres Near Mint — restent en
  place, inactifs jusqu'à réouverture. En attendant, les prix Cardmarket
  affichés viennent de dotgg, qui n'en donne qu'un seul, sans distinction d'état.
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

### Le prix de référence retenu chez Cardmarket

C'est la **médiane des trois premières offres en Near Mint**, autrement dit ce
qu'on lit sur la fiche produit une fois le filtre d'état appliqué. Ni la
tendance, qui lisse le marché et ne correspond à aucune offre réelle, ni le prix
le plus bas toutes conditions confondues, qui désigne souvent un exemplaire
abîmé.

Pourquoi une médiane plutôt que la seule offre la moins chère : celle-ci rendrait
le suivi nerveux. Une carte mal tarifée, un vendeur qui solde, et la valeur de la
collection décroche pour la journée. La médiane des trois premières absorbe ce
cas sans s'éloigner du prix auquel on achète réellement.

Le guide de prix de Cardmarket n'expose pas ce chiffre : il faut interroger les
offres réelles (`/articles/:idProduct`), en écartant les lots, dont le prix
affiché induirait en erreur. Comme rien ne garantit leur tri, on trie
soi-même. Le guide reste interrogé en parallèle, ses moyennes glissantes
alimentant la reconstruction d'historique.

Tout cela se règle dans `.env` : état minimum (`CARDMARKET_MIN_CONDITION`),
langue (`CARDMARKET_LANGUAGE_ID`), nombre d'offres récupérées
(`CARDMARKET_ARTICLE_SAMPLE`) et nombre des moins chères prises en compte
(`CARDMARKET_PRICE_SAMPLE`, ramener à 1 pour retenir la moins chère). Si le
service d'offres est indisponible, le relevé bascule sur le guide plutôt que
d'être perdu.

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
| `npm run api:probe -- card OP01-001` | Affiche les enregistrements bruts d'une carte et de ses illustrations |
| `npm run api:analyse` | Analyse le classement des cartes par produit sur tout le catalogue |
| `npm run api:find -- grevin` | Cherche une carte dans le catalogue synchronisé |
| `npm run api:gap` | Compare le catalogue aux listes officielles Bandai, dans les deux sens |
| `npm run api:discover` | Détecte les cartes absentes via apitcg, TCGplayer et Cardmarket |
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

## Les cartes qu'aucune source ne connaît

Les sources internationales ignorent les exclusivités régionales : une promo
distribuée lors d'un événement français n'existe dans aucune d'elles. Plutôt que
de chercher indéfiniment une source qui couvrirait tout, le catalogue accepte un
**complément local** : copie `services/api/data/supplement.example.json` en
`supplement.json` dans le même dossier, décris-y tes cartes, et relance la
synchronisation. Seuls `id`, `name` et `setId` sont obligatoires.

Le complément est fusionné **après** la source principale : il ajoute ce qu'elle
ignore et corrige ce qu'elle donne de travers, sans jamais être écrasé par elle.
`npm run api:find -- <terme>` sert à vérifier ce que le catalogue contient
réellement — la recherche ignore les accents, donc « grevin » trouve « Grévin ».

Le remplir à la main n'est pas une fatalité : `npm run api:discover` confronte le
catalogue local aux sources secondaires configurées et rapporte, pour chacune, ce
qu'elle apporterait de plus ; avec `-- --write`, il l'écrit dans le complément en
conservant ce qui s'y trouvait déjà.

Deux sources sont interrogées si elles répondent. **apitcg.com** demande une clé
gratuite, dont l'inscription est ouverte : c'est la piste à tenter en premier.
**Cardmarket** serait la meilleure — son catalogue européen contient forcément
les exclusivités régionales, et il fournirait au passage l'identifiant produit,
donc le prix sans rapprochement approximatif — mais **les demandes d'accès à son
API sont fermées** à ce jour (« we are not accepting applications for API access
at this time »). Le connecteur est prêt pour le jour où elles rouvriront.

Quand aucune source ne connaît une carte, il reste la saisie dans le complément :
c'est le cas des exclusivités les plus confidentielles. Le cas d'école est la
promo du Musée Grévin — une illustration alternative de OP13-001 distribuée à
Paris, marquée « NOT FOR SALE ». Bandai ne la publie pas dans sa liste
française, où OP13-001 n'a que deux impressions, toutes deux dans le booster
OP-13 : elle n'a jamais été vendue, donc elle n'est ni au catalogue de
l'éditeur ni sur une fiche produit de marketplace.

Une telle carte se revend pourtant — c'est la seule trace qu'elle laisse, et
donc le seul endroit où la chercher. La synchronisation interroge l'API
officielle d'eBay sur les termes qui désignent ce genre de tirage (« Grevin »,
« championship winner », « store battle »…), extrait de chaque titre le code
imprimé, et retient les couples code + qualificatif qui reviennent sur assez
d'annonces distinctes pour ne pas être un titre isolé mal rédigé. Trois
garde-fous : le code doit désigner une carte réelle, les lots, tapis et cartes
gradées sont écartés, et `CATALOG_OFFLIST_MIN_LISTINGS` fixe le nombre
d'annonces exigé.

Les trouvailles vont dans `data/discovered.json`, réécrit à chaque passage, et
jamais dans `supplement.json` qui reste tenu à la main : ce qui est deviné doit
rester distinguable de ce qui est su. Chaque carte arrive avec sa requête de
cotation, donc elle est cotée dès le relevé suivant, sans rien saisir.

On ne sait d'une telle carte que ce que son annonce en dit : son code, son
tirage, son prix. Le reste — effet, puissance, couleur — est laissé vide plutôt
qu'inventé. Pour compléter une carte précise, ou pour celles qu'aucune annonce
ne mentionne, `supplement.json` accepte la saisie manuelle, avec les mêmes
`cardmarketId` et `ebayQuery` ; `supplement.example.json` en contient une entrée
complète.

### Savoir ce qui manque vraiment

« Quelle carte me manque ? » n'a de sens que face à une référence, et depuis que
les listes officielles de Bandai sont là, il y en a une. `npm run api:gap` place
le catalogue en regard, dans les deux sens :

- **ce que la source commerciale ignore** est une lacune de l'app — la carte
  existe, elle ne s'affiche nulle part ;
- **ce qu'elle ajoute** n'est publié par aucune liste officielle : prix de
  tournoi, promos d'événement. C'est le seul terrain où une source
  supplémentaire apporterait quelque chose, et donc le seul endroit où il vaut
  la peine d'aller en chercher une.

À lancer avant d'ajouter un catalogue tiers : le rapport dit s'il y a quoi que
ce soit à y gagner, et combien.

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

### Éditions française et japonaise

dotgg ne connaît que l'édition internationale : sur ses 5500 cartes, 5185 sont
anglaises et aucune n'est française. Or le jeu ne se contente pas de traduire —
la France a ses propres impressions, 179 illustrations que l'édition anglaise n'a
jamais publiées, et le Japon 435.

Ces deux éditions viennent donc d'ailleurs : **les listes de cartes officielles
de Bandai**, celles publiées sur `fr.onepiece-cardgame.com` et sur
`onepiece-cardgame.com`, reprises dans le dépôt versionné
[punk-records](https://github.com/buhbbl/punk-records). Les textes, les raretés
et les visuels sont donc ceux de l'éditeur. `CATALOG_PRINTINGS` décide de ce
qu'on en prend ; vide, l'app s'en tient à l'édition globale.

On ne télécharge pas les fichiers un par un — il y en a près de huit mille pour
les deux éditions. Une copie locale est tenue à jour par `git` en clone partiel
restreint aux éditions demandées : environ 45 Mo la première fois, puis seulement
les cartes modifiées. Un échec ici n'interrompt pas la synchronisation : le
catalogue global reste à jour sans ses éditions régionales.

Trois conséquences dans le modèle de données :

- **L'identifiant porte l'édition.** `OP02-001_p1` désigne la carte globale,
  `OP02-001_p1@FR` la française, `OP02-001_p1@JP` la japonaise. L'anglais garde
  l'identifiant nu : c'est lui que les marketplaces indexent, et c'est sur lui
  que reposent les correspondances Cardmarket / TCGplayer déjà enregistrées.
- **Le produit reste unique, son nom non.** OP11 est un seul produit, nommé
  « A Fist of Divine Speed » en global et « Des poings vifs comme l'éclair » en
  France. Les titres traduits vivent dans `set_names` ; la ligne du produit garde
  le nom global, faute de quoi la dernière source synchronisée imposerait sa
  langue à tout le monde.
- **L'édition décide des effectifs.** OP01 compte 121 cartes en global et aucune
  en France. Un produit qu'une édition n'a jamais publié n'apparaît pas chez
  elle, et la progression de collection se calcule sur l'édition regardée.

L'édition japonaise a un défaut connu : le dépôt livre sa liste de produits vide.
Les cartes sont donc rattachées à leur produit en les rapprochant de l'édition
anglaise — un paquet japonais et son équivalent anglais partagent l'essentiel de
leurs numéros. La correspondance est franche pour 57 des 62 paquets ; les cinq
autres sont promotionnels et le recouvrement maximal les désigne malgré tout
correctement. En revanche les titres japonais manquent réellement : l'app affiche
alors le nom global, plutôt que de faire passer un titre anglais pour japonais.

Ce sont des APIs communautaires, sans contrat versionné : leurs adresses bougent.
La synchronisation enchaîne donc les sources et termine sur le catalogue local
plutôt que de laisser l'app vide — en disant explicitement ce qui a échoué et si
le résultat n'est que la démonstration. `npm run api:probe` interroge chaque
source et décrit ce qu'elle renvoie réellement, visuels des cartes compris :
c'est l'outil à lancer quand une synchronisation se dégrade.

## Quelles clés sont réellement obtenables

Sur les trois marketplaces, une seule ouvre encore ses accès :

| | Accès API | Prix dans l'app | Clé nécessaire |
| --- | --- | --- | --- |
| Cardmarket | **fermé** aux nouvelles demandes | oui, par la source du catalogue | non |
| TCGplayer | **fermé** aux nouvelles demandes | oui, par la source du catalogue | non |
| eBay | ouvert, gratuit | oui, par l'API | oui |

Les deux portes fermées ne coûtent donc pas les prix, qui transitent par la
source du catalogue. Elles coûtent le parcours de leur catalogue de produits,
c'est-à-dire la détection des cartes hors-liste chez eux — `api:discover` les
déclare et les ignore tant qu'aucune clé n'est là, prêt pour une réouverture.
eBay, lui, couvre à la fois la cotation et la découverte.

## Le suivi de prix Cardmarket

C'est la fonction qui distingue l'app d'un simple catalogue, et elle ne demande
**aucune clé**. Les cotations Cardmarket n'arrivent pas par l'API de Cardmarket
— elle n'accepte plus de demandes d'accès — mais par la source du catalogue, qui
les transporte avec chaque carte, en euros.

Une seule condition : **le backend doit tourner une fois par jour**, parce qu'un
historique se construit un point à la fois. Deux mécanismes s'en chargent :

- une tâche planifiée à 4 h 15, réglable par `PRICE_CRON` ;
- un **rattrapage au démarrage** : si la journée n'a pas encore son relevé, il
  est pris immédiatement. Sans lui, un ordinateur éteint la nuit n'aurait jamais
  déclenché la tâche de 4 h du matin, et l'historique se serait rempli de trous
  sans que rien ne le signale.

Le relevé quotidien prend les cotations de la source du catalogue d'abord —
tout le catalogue en un appel, sans clé — puis les marketplaces à clé, carte par
carte selon leur quota. Auparavant les cotations Cardmarket n'étaient écrites
que par la synchronisation du catalogue, hebdomadaire : l'historique gagnait un
point tous les sept jours.

Une limite qu'aucun réglage ne contourne : la source ne donne que le prix du
jour, pas les moyennes glissantes de Cardmarket. La reconstruction d'historique
(`backfill.ts`) ne peut donc pas s'appliquer, et la courbe sur 30 jours part
vide pour se remplir jour après jour. Au bout d'un mois de fonctionnement, elle
est entièrement composée de relevés réels.

### Ce que coûte une impression régionale

Les marketplaces ne tiennent **qu'une fiche par carte** : sur Cardmarket, la
langue est un attribut des annonces, pas un produit distinct. L'identifiant
produit rapporté par la source du catalogue est donc porté par l'impression
internationale, et les impressions française et japonaise n'ont aucun relevé à
leur nom — près de huit mille cartes affichaient un écran de prix vide.

Une impression régionale est donc cotée sur la fiche internationale du même
numéro, et l'app le dit : « Cote de la fiche internationale (OP01-001) ». Un
prix approché et annoncé comme tel vaut mieux qu'un prix absent, et mieux encore
qu'un prix qu'on croirait propre à l'édition regardée. La valeur de collection
suit la même règle, sans quoi une collection française aurait été estimée à zéro.

## Mettre le contenu à jour sans tout retélécharger

Une copie hors ligne ne vaut que si sa mise à jour est indolore. Deux mécanismes
le garantissent.

**Une carte inchangée n'est pas réécrite.** L'insertion porte une clause `WHERE`
qui compare champ à champ : à données identiques, rien n'est touché, et la date
de modification ne bouge pas. Sans elle, une resynchronisation hebdomadaire
marquait les huit mille cartes comme modifiées, et un appareil qui ne demande
que les nouveautés aurait tout retéléchargé chaque semaine. La comparaison
utilise `IS NOT` et non `<>` : en SQL, comparer à NULL ne rend ni vrai ni faux,
et la moitié des colonnes d'une carte sont nulles.

**L'appareil ne demande que ce qui a bougé.** `GET /cards?since=<date>` ne rend
que les cartes modifiées depuis, et la réponse porte l'heure du serveur, que
l'appareil garde comme repère pour la fois suivante — se fier à sa propre
horloge lui ferait rater ou redemander des cartes. En pratique : premier
téléchargement complet, puis une extension qui sort ne coûte que ses ~160
cartes. Les visuels ne bougent jamais pour un identifiant donné, et sont servis
en `immutable` : ils ne se retéléchargent pas du tout.

Limite connue : une carte retirée en amont reste en base. Le catalogue ne fait
que croître, donc le cas ne s'est pas présenté ; il faudrait un marquage de
suppression pour le traiter proprement.

## Ce qui reste à faire

- Scanner une carte par l'appareil photo pour l'ajouter à la collection.
- Alertes de prix (« préviens-moi si cette carte passe sous X € »).
- Constructeur de deck avec contrôle de légalité.
- Ventes conclues eBay, dès l'obtention de l'accès Marketplace Insights.
