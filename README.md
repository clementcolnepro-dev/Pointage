# Pointage — suivi des heures de travail

Application mobile (PWA) : ouvrir → appuyer sur **POINTER** → l'heure est enregistrée → le solde est mis à jour.
Fonctionne hors ligne, données stockées sur le téléphone, aucune dépendance.

## Structure

```
pointage/
├── index.html        Page unique + barre d'onglets + fenêtre d'ajout/modification
├── style.css         Styles (mode clair/sombre automatique)
├── calc.js           Moteur de calcul (minutes entières, aucune dépendance)
├── app.js            Interface : Aujourd'hui, Jour, Historique, Semaine, Cumul, Réglages
├── manifest.json     Rend l'app installable (nom, icône, plein écran)
├── sw.js             Service worker : fonctionnement hors ligne
├── icons/            Icônes de l'application
└── tests/calc.test.js  Tests du calcul (node tests/calc.test.js)
```

## Lancer sur l'ordinateur

```bash
cd pointage
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```
(Ouvrir index.html directement fonctionne aussi, mais sans le mode hors ligne.)

## Installer sur le téléphone

L'installation hors ligne exige une adresse **HTTPS**. Le plus simple et gratuit : GitHub Pages.

1. Sur github.com → **New repository** → nom `pointage` → **Public** → Create.
2. **Add file → Upload files** → glisser **le contenu** du dossier `pointage` (index.html à la racine, avec le dossier icons) → Commit.
3. **Settings → Pages** → Source : *Deploy from a branch*, branche `main`, dossier `/ (root)` → Save.
4. Après 1 à 2 min, l'app est sur `https://<ton-pseudo>.github.io/pointage/`.

Sur le téléphone, ouvrir cette adresse puis :
- **Android (Chrome)** : menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).
- **iPhone (Safari)** : bouton Partager → **Sur l'écran d'accueil**.

L'icône « Pointage » apparaît ; l'app s'ouvre en plein écran et marche sans réseau.
Les données restent **uniquement sur ce téléphone** (rien n'est envoyé sur GitHub).

Mise à jour du code : remplacer les fichiers sur GitHub et changer `VERSION` dans `sw.js` ;
l'app se met à jour au 2e lancement.

## Calcul des heures

- Tout est calculé en **minutes entières** (07:00 = 420) ; le format `+00h17` n'est qu'un affichage.
- Chaque pointage est une date+heure absolue. Ils sont triés puis appariés Début → Fin.
  L'ordre de saisie n'a donc pas d'importance, et une période 22:00 → 05:15 (après minuit)
  est comptée sur le jour de son Début.
- **Temps pointé** = somme des périodes Début → Fin (la pause midi, non pointée, n'est pas comptée).
- **Temps travaillé** = temps pointé − 15 min de pause du matin (réglage par défaut « déduite »).
- **Solde du jour** = temps travaillé − 7h00. Il faut donc **7h15 de présence pointée** pour être à 0.
  Option « comptée comme travail » : pas de déduction, 7h00 de présence suffisent.
- **Congé / Férié / Absence / Repos** : objectif 0, aucun déficit.
- Un jour sans pointage ni statut n'est pas compté (week-ends). Un pointage sans partenaire
  (Fin oubliée…) est signalé ⚠ et ignoré jusqu'à correction ; un Début vieux de plus de 20 h est considéré oublié.
- **Semaine** = somme des soldes des jours de la semaine. **Cumul** = solde de départ + somme des soldes
  depuis la date de remise à zéro.

## Sauvegarde

Réglages → **Exporter la sauvegarde (.json)** régulièrement (à garder dans Drive, mails…).
**Importer** remplace les données du téléphone par celles du fichier. L'export .csv s'ouvre dans Excel.
