# Seatmap Reservation — Module Vue 3

Module de réservation de sièges/zones en ligne, avec API mockée prête à être
remplacée par un vrai backend.

## Installation

```bash
npm install
npm run dev
```

Ouvrez ensuite l'URL affichée (par défaut http://localhost:5173).

## Build de production

```bash
npm run build
npm run preview
```

## Structure du projet

```
src/
  App.vue                       Composant racine, orchestre l'ensemble
  main.js                       Point d'entrée
  style.css                     Tailwind + styles des sièges/zones
  components/
    CategoryLegend.vue          Barre de catégories (filtre)
    VenuePlan.vue                Plan de salle (zones + sièges + portes + scène)
    CartPanel.vue                 Panier latéral
    modals/
      QtyModal.vue               Sélecteur de quantité pour une zone générique
      CheckoutModal.vue          Confirmation / erreur de réservation
  composables/
    useCart.js                  État réactif partagé du panier (store léger)
  services/
    venueData.js                 Données du plan (catégories, zones, sièges)
    mockApi.js                   Couche API mockée (fetchVenue, reserve)
    format.js                     Formatage des montants
```

## Brancher un vrai backend

Toute la "logique réseau" est isolée dans `src/services/mockApi.js`.
Pour connecter une vraie API, remplacez le corps de `fetchVenue()` et
`reserve()` par de vrais appels HTTP (fetch/axios), en conservant la même
forme de retour :

```js
async fetchVenue() {
  const res = await fetch('/api/venue/mon-evenement');
  return res.json(); // { categories, zones, doors, seatZones }
}

async reserve(payload) {
  const res = await fetch('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Échec de la réservation');
  return res.json();
}
```

Aucun autre fichier n'a besoin d'être modifié.

## Back-office (gestion des plans)

Une seconde page est dédiée à la gestion des plans de salle, accessible en
dev sur **http://localhost:5173/admin.html**.

```
src/admin/
  AdminApp.vue                 Layout + onglets (Salles / Catégories / Zones / Rangées / Aperçu)
  main-admin.js                 Point d'entrée du back-office
  components/
    VenueManager.vue           CRUD des salles (sidebar)
    CategoryManager.vue        CRUD des catégories (nom, couleur, prix)
    PlanEditor.vue              Éditeur visuel : ajout, glisser-déposer, configuration en direct
    ZoneManager.vue             CRUD des zones génériques en mode tableau (vue alternative)
    SeatRowManager.vue         CRUD des blocs de sièges nominatifs en mode tableau (vue alternative)
    PreviewPlan.vue            Aperçu en lecture seule, rendu identique au front client
  services/
    adminApi.js                  API mockée CRUD (store en mémoire + latence simulée)
```

Le back-office permet de :
- créer/éditer/supprimer une **salle**,
- définir ses **catégories** (nom, couleur, prix),
- utiliser l'**éditeur visuel du plan** (onglet "Éditeur du plan") pour :
  - ajouter une zone générique ou un bloc de sièges nominatifs en un clic,
  - les **glisser-déposer** directement sur le canevas pour les positionner,
  - les **cliquer** pour ouvrir le panneau de propriétés (libellé, catégorie,
    taille/capacité ou rangs×sièges) avec sauvegarde automatique,
  - les **supprimer** depuis le panneau,
- ou passer par les vues tableau classiques ("Zones", "Rangées de sièges")
  pour le même résultat en formulaire,
- visualiser un **aperçu** fidèle à ce que le client final verra.

`src/admin/services/adminApi.js` est totalement indépendant de l'API du
front client (`src/services/mockApi.js`). Pour brancher un vrai backend,
remplacez ses fonctions par de vrais appels HTTP en conservant les mêmes
signatures (`listVenues`, `createCategory`, `updateZone`, etc.) — aucun
composant n'a besoin d'être modifié.

## Fonctionnalités récentes

**Front client**
- Zoom avant/arrière (boutons +/− et indicateur %) avec centre de zoom stable.
- **Navigation à la souris** : cliquer-glisser sur une zone vide du plan pour le déplacer (pan), comme sur Google Maps.
- Minicarte de vue d'ensemble (bas-droite) : clic pour sauter à un endroit, **ou glisser directement le rectangle rouge** pour parcourir le plan en continu (`components/MiniMap.vue`).
- Sièges nommés automatiquement (lettre de rangée + numéro, ex. A1, B13), forme (carré/rond) et taille configurables par bloc.

**Back-office**
- Éditeur visuel (`admin/components/PlanEditor.vue`) :
  - zones et blocs de sièges déplaçables par glisser-déposer,
  - zones **redimensionnables directement sur le plan** en tirant le bord souhaité (haut/bas/gauche/droite),
  - **sièges individuels sélectionnables** : un clic affiche ses propriétés (bloc, rangée, colonne, catégorie, prix, statut) dans le panneau latéral, avec bascule disponible/vendu (démo locale),
  - **taille de police du libellé de zone** réglable (px), reflétée en temps réel sur le plan et côté front client,
  - **nommage des rangées et colonnes configurable** par bloc : format (lettres A-Z, lettres a-z, chiffres romains
    I-X, ou chiffres 1-9) et sens (normal ou inversé) indépendants pour les rangées et pour les colonnes, avec
    aperçu live des premiers noms générés,
  - **sièges désactivables** : un clic sur un siège permet de le rendre définitivement non sélectionnable côté
    client (places condamnées, vue obstruée…), persisté par bloc (`disabledSeats`), distinct du statut "vendu"
    qui reste une démonstration locale,
  - **blocs de sièges redimensionnables dynamiquement par le bord souhaité** : tirer le bord gauche/droit
    ajoute/retire des **sièges par rang (colonnes)**, tirer le bord haut/bas ajoute/retire des **rangées** — la
    grille (et les noms générés) se recalcule en direct, avec un indicateur "(rangs × colonnes)" pendant le geste.

## Fonctionnalités récentes (v3)

**Front client**
- Rendu des sièges façon "billetterie" : rectangles arrondis avec libellé lisible (A1, B13…), badge de groupe
  flottant ("R12") au-dessus de chaque bloc, carte crème à fond pointillé, sièges désactivés en gris clair —
  inspiré de la maquette fournie.
- **Zones libres** (scène, portes, sanitaires, zones inaccessibles…) : icône, couleur et motif de fond
  (uni/rayures/pointillés) configurables depuis le BO, plus liées en dur dans le code.
- Un siège peut avoir une **catégorie différente de son bloc** (utile pour un strapontin PMR au tarif réduit au
  milieu d'un carré Prestige, par exemple) — géré via `categoryOverrides` par bloc.

**Back-office**
- **Multi-sélection de sièges** : Ctrl/Cmd-clic ou Maj-clic pour sélectionner plusieurs sièges, puis depuis la
  barre d'actions groupées : désactiver/réactiver la sélection en un clic, ou changer leur catégorie en masse.
- **Taille de police du libellé de groupe de sièges** réglable par bloc (indépendante de celle des zones).
- **Zones libres** entièrement configurables (CRUD visuel dans l'éditeur de plan) : libellé, icône (toilettes,
  porte, restaurant, escalier, PMR, bar, projecteur, zone inaccessible…), couleur, motif de fond, taille de
  police, position et taille — déplaçables et redimensionnables comme les autres éléments, sans dépendre d'une
  catégorie de billetterie.
- Un siège individuel peut désormais voir sa **catégorie changée directement** depuis son panneau de propriétés,
  en plus de l'action groupée.

*Note : les zones libres ne disposent pour l'instant que de l'éditeur visuel (pas de vue tableau dédiée), contrairement aux zones et blocs de sièges qui ont les deux.*

## Fonctionnement

- **Zones génériques** (tribunes/gradins) : un clic ouvre une modale de
  quantité, ajoutée au panier par lot.
- **Zones à sièges nominatifs** (type "BRONZE/SIGNATURE" dans l'exemple) :
  grille de sièges individuels, certains marqués "vendus" aléatoirement,
  cliquables un par un.
- **Panier** : quantités modifiables, suppression, total en temps réel.
- **Réservation** : appel API mocké avec latence simulée, gestion d'un cas
  d'erreur aléatoire (conflit de réservation), écran de confirmation avec
  référence générée.
