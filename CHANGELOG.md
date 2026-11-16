# Historique des versions

## 1.2.1
- **Préchauffe plus efficace** : une fois la préchauffe commencée, si la pièce est en retard sur la rampe, la consigne envoyée au Koolnova reste au moins 1,5 °C au-dessus de la température mesurée (sans dépasser la température visée). Une pièce en avance sur la rampe n'est pas poussée. Avec des paliers de 0,5 °C collés à la mesure, le Koolnova soufflait à bas débit et la pièce ne montait presque pas (constaté le 16/11 : salon resté à 18 °C pendant toute la préchauffe).

## 1.2.0
- **Apprentissage de la vitesse de chauffe revu** : la vitesse est mesurée pendant chaque préchauffe (montée réelle ramenée à 10 °C dehors), puis lissée par la médiane des 7 dernières mesures. Une mauvaise journée ne la fait plus chuter. Les mesures faussées (fenêtre ouverte, Koolnova injoignable, préchauffe interrompue, trop courte) sont ignorées.
- **Onglet Historique** dans la fenêtre de chaque pièce : courbe mesure / consigne sur 24 h ou 7 jours, périodes de chauffe et de fenêtre ouverte, temps de chauffe du jour et de la période, température moyenne, part du temps à la consigne.
- Réglages : détail de la dernière mesure de vitesse.
- Releases GitHub automatiques à chaque version (mises à jour immédiatement visibles dans HACS) et validation hassfest / HACS / tests.

## 1.1.0
- Nouvelle carte à jauges : moyenne de la maison, sélecteur de mode, jauge circulaire par pièce, couleurs par situation.
- Icône de l'intégration (dossier `brand/`, Home Assistant 2026.3+).

## 1.0.2
- Allume la zone Koolnova avant d'envoyer la consigne (le Koolnova ignore `hvac_mode` passé avec la consigne).

## 1.0.1
- Compatibilité Home Assistant 2026.11.

## 1.0.0
- Première version.
