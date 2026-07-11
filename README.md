# AirsoftDrill

Générateur de drills d'airsoft sur mesure, propulsé par IA. Application 100 % statique
(compatible GitHub Pages) : aucune donnée ne quitte le navigateur, sauf l'appel à l'API Gemini.

## Lancer en local

Aucun build nécessaire. Deux options :

```bash
# Option 1 : ouvrir index.html directement dans le navigateur (double-clic)

# Option 2 (recommandé) : petit serveur local
npx serve .
# ou : python -m http.server 8000
```

Pour déployer : pousser `index.html`, `style.css` et le dossier `js/` sur la branche
GitHub Pages du dépôt. Rien d'autre à configurer.

## Architecture

| Fichier | Rôle |
|---|---|
| `index.html` | Les 4 pages (sections) : Squad, Terrains, Logistique, Drill |
| `style.css` | Design complet (responsive, tactile, thème sombre) |
| `js/schema.js` | **Schéma de données central** partagé par les 4 pages + factories |
| `js/store.js` | Persistance IndexedDB + migration depuis l'ancien localStorage |
| `js/ui.js` | Utilitaires : échappement HTML (anti-XSS), toasts, markdown, compression d'images |
| `js/ai.js` | **Module IA isolé** : `AI.generateDrill(...)`, seul fichier à toucher pour changer d'IA |
| `js/squad.js` | Page Squad & Matériel (squads → pax → équipements) |
| `js/terrain.js` | Éditeur de plan (Pointer Events : souris + tactile) + bibliothèque |
| `js/logistics.js` | Matériel de terrain + supports PDF / image / texte |
| `js/drill.js` | Page Création de Drill (formulaire, appel IA, rendu carte + briefing) |
| `js/main.js` | Init : stockage → modules → navigation |

## Structure des données (résumé — détail dans `js/schema.js`)

```
Squad          { id, name, pax: Pax[] }
Pax            { id, name, role, equipment: Equipment[] }
Equipment      { id, category, name, details }
Terrain        { id, name, type, width, height (px, calculés à la sauvegarde),
                 pixelsPerMeter: 20, elements: TerrainElement[], photo, thumbnail }
TerrainElement { type: wall|door_single|door_double|window|rect, x1,y1,x2,y2 }
               { type: brush_in|brush_out, points: [{x,y}] }
               { type: cover_line, kind: muret|palissade, x1,y1,x2,y2 }
               { type: cover_rect, kind: voiture|buisson|canape|bureau|lit,
                 x,y (centre), w,h (px), rot (radians) }
               { type: start_point, x, y, label: "D1"|"D2"|... }
LogisticsItem  { id, name, qty, photo }
SupportDoc     { id, title, type, kind: pdf|image|text, dataUrl|text, fileName }
```

**Repère cartographique** : coordonnées en pixels-monde, **20 px = 1 m**, origine en
haut à gauche. L'éditeur est zoomable/déplaçable (molette, pincement, ✋) : on peut
dessiner des terrains de toute taille ; l'emprise `width × height` est recalculée à la
sauvegarde (minimum 900 × 500). L'éditeur, la carte de résultat et l'IA partagent ce
repère — les coordonnées sont portables entre écrans et entre pages.

**Éditeur de terrain** : aimantation des extrémités de murs (indicateur vert), contrainte
d'angles 0/45/90° (📐, désactivable), portes **intégrées aux murs** (clic sur un mur,
0,9 m / 1,8 m, coulissantes le long du mur), cotes discrètes masquables (📏), quadrillage
5 m, et **protections** prédéfinies aux dimensions réelles (voiture, buisson, muret,
palissade, canapé, bureau, lit) posées au clic et orientées au glisser — chacune est
décrite tactiquement à l'IA (couverture dure / basse / concealment) via `js/schema.js`.
On peut aussi placer un ou plusieurs **points de départ possibles** (🚩 D1, D2...) :
l'IA doit alors choisir son départ parmi eux (plusieurs seulement si drill par équipes)
et citer le libellé retenu dans le briefing.

**Persistance** : IndexedDB (base `airsoftdrill`, stores `squads`, `terrains`,
`logistics`, `docs`, `settings`). Choix motivé : localStorage est limité à ~5 Mo,
insuffisant pour des photos et PDF en base64 ; IndexedDB en stocke des centaines de Mo,
en statique, sans backend. Les données de l'ancienne version (localStorage) sont
migrées automatiquement au premier lancement.

## Intégration IA

- La page Drill appelle `AI.generateDrill({ apiKey, model, terrain, pax, materials, docs, userPrompt })`
  qui renvoie `{ markdown, overlays }`. Les overlays (`target`, `start_point`, `path`, `zone`)
  sont validés et bornés au terrain avant affichage.
- Modèles proposés : Gemini 2.5 Flash (défaut), 2.5 Pro, 2.5 Flash Lite. La sortie JSON
  est contrainte par `responseMimeType` + `responseSchema`.
- **Résilience** : en cas de saturation (« high demand », 503) l'appel est retenté avec
  délai croissant puis bascule sur les autres modèles ; un **quota épuisé (429)** bascule
  immédiatement sans gaspiller d'essais. L'utilisateur voit chaque étape.
- **Quotas gratuits** : Flash et Flash-Lite offrent un quota journalier confortable ;
  Pro est quasi inutilisable sans facturation — il est donc en dernier dans la chaîne de
  repli. Le quota se réinitialise chaque jour (~9h heure de Paris).
- **Économie de tokens** : plan du terrain compacté avant envoi (coordonnées arrondies,
  traits de pinceau sous-échantillonnés) ; supports (PDF/images/textes) joints seulement
  si la case est cochée (budget 6 Mo) car ils consomment beaucoup de quota.
- **Mode manuel** : la carte de résultat est annotable à la main (crayon, flèche, cibles,
  départ, consignes texte) — par-dessus un résultat IA pour l'ajuster, ou sans IA du tout.

### Gestion de la clé API (important)

La clé Gemini est fournie par chaque utilisateur (« Bring Your Own Key ») et stockée
**uniquement dans le localStorage de son navigateur**. Elle n'est ni dans le code, ni
synchronisée, ni envoyée ailleurs qu'à l'API Google. C'est l'approche standard pour un
site statique. Pour offrir l'IA sans demander de clé, il faudrait un proxy serverless
(Cloudflare Worker, Netlify/Vercel Function) qui détient la clé côté serveur et rajoute
un quota par utilisateur — hors périmètre GitHub Pages.

## Reste à faire (côté IA notamment)

- [ ] Historique des drills générés (sauvegarde du résultat en IndexedDB).
- [ ] Export du drill en PDF / impression (briefing + carte).
- [ ] Envoi de la **photo du terrain** à l'IA en plus du plan vectoriel.
- [ ] Déplacer/supprimer individuellement les overlays proposés par l'IA (l'ajout
      d'annotations manuelles par-dessus est déjà possible).
- [ ] Support d'autres fournisseurs d'IA (Claude, OpenAI) dans `js/ai.js` — l'interface
      `generateDrill` est déjà indépendante du fournisseur.
- [ ] Proxy serverless optionnel pour une clé mutualisée.

## Historique

L'ancienne version utilisait Firebase (auth + Firestore) et stockait tout en
localStorage ; Firebase a été retiré (persistance 100 % locale). Si vous aviez
synchronisé des données ou une clé API dans Firestore, pensez à **régénérer votre clé
Gemini** et à désactiver le projet Firebase `drillairsoft` devenu inutile.
