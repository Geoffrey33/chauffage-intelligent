# Historique des versions

## 1.2.4
- **Relance de la PAC** : constaté le 17/11, quand une seule petite zone demande du chauffage (chambre), la PAC ne redémarre pas avec 1,5 à 2,5 °C d'écart ; elle redémarre à 3 °C. L'écart minimum pendant une préchauffe passe donc de 1,5 à **3 °C**.
- **Dépassement temporaire de la consigne envoyée** : tant que la pièce est à plus de 1 °C sous la température visée (préchauffe, début de plage, retour prévu en absence), la consigne envoyée au Koolnova peut dépasser l'objectif de 1 °C au maximum, pour que l'écart ne retombe pas sous le seuil de relance avant l'arrivée. La température visée affichée et l'apprentissage ne changent pas.
- Nouvel attribut `sent_temperature` sur chaque thermostat : la consigne réellement envoyée au Koolnova.

## 1.2.3
- **Plus d'allers-retours de consigne pendant la préchauffe** : la consigne vise désormais 1,5 °C au-dessus du plus bas entre la mesure et la rampe. En 1.2.1/1.2.2, elle retombait sur la mesure dès que la pièce rattrapait la rampe, puis remontait quelques minutes plus tard (constaté le 17/11 dans le salon, la cuisine et la bibliothèque), ce qui faisait lever le pied à la PAC et multipliait les écritures Modbus. Pendant une préchauffe, la consigne ne fait plus que monter.

## 1.2.2
- Une vitesse de chauffe réglée à la main repart de zéro : les anciennes mesures sont oubliées, pour que l'apprentissage ne la ramène pas aussitôt à leur médiane.

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
