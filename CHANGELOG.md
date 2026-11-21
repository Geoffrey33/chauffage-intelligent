# Historique des versions

## 1.3.0
- **Affichage sur téléphone** :
  - fenêtre des pièces toujours opaque, même avec un thème à fond transparent, et fond flouté derrière ;
  - texte des plages adapté à la largeur réelle (température seule quand la place manque) ;
  - grille du planning plus compacte, outils du planning repliables ;
  - barre d'enregistrement et bas de fenêtre au-dessus de la barre de navigation du téléphone ;
  - boutons de boost sur toute la largeur.
- **Publication** : README avec boutons d'installation My Home Assistant, badges et section en anglais, modèles de tickets, validation HACS complète (sans exception).

## 1.2.9
- **Pilotage** : grand cadran de thermostat (consigne, mesure, couleur selon la situation, boutons − / + pour un réglage ponctuel), modes de la pièce en vignettes avec leur valeur, carte Boost avec temps restant et barre de progression, planning du jour avec heures et prochain changement.
- **Planning** : légende en pastilles, jour actuel mis en avant, horaires et température écrits dans les plages, temps de confort par jour et par semaine, éditeur de plage en carte (début / fin, type de plage en vignettes), outils regroupés (copier un jour, autre pièce, modèles), état d'enregistrement visible.
- **Historique** : chiffres clés en cartes en haut, zone dégradée sous la courbe mesurée, graphique du temps de chauffe par jour sur 7 jours.
- README : captures des quatre onglets.

## 1.2.8
- Nouvel onglet Réglages des pièces (voir 1.2.7).
- **Carte toujours à jour** : son adresse inclut désormais le numéro de version de l'intégration, le navigateur recharge donc la carte après chaque mise à jour sans qu'il faille vider le cache.

## 1.2.7
- **Nouvel onglet Réglages des pièces** :
  - échelle colorée situant Eco, Confort, Confort + et la température mesurée ;
  - une carte par consigne (couleur, icône, rappel de son usage, gros boutons − / +) ;
  - préchauffe : interrupteur, vitesse apprise traduite en durée (« Eco → Confort en ~1 h »), graphique des mesures avec la valeur retenue, résumé de la dernière préchauffe (départ, arrivée, objectif, durée, temps pour atteindre l'objectif, extérieur, ancienne et nouvelle vitesse) ;
  - informations de la pièce avec pastilles d'état (synchronisation, fenêtres).

## 1.2.6
- **Préchauffe sans effet ignorée par l'apprentissage** : si une pièce ne monte pas d'au moins 0,5 °C pendant une préchauffe d'une heure ou plus, c'est que la PAC n'a pas répondu (arrêt, défaut, dégivrage prolongé…), pas que la pièce est lente. La mesure n'est plus retenue (méthode « ignorée (pas de montée) » dans le détail de la dernière mesure) et une notification est envoyée pour vérifier la PAC. Avant, ces préchauffes faisaient chuter la vitesse apprise et démarrer les suivantes beaucoup trop tôt.

## 1.2.5
- **Apprentissage de la vitesse de chauffe corrigé** : quand une pièce atteint sa température visée avant l'heure, la vitesse est désormais calculée sur le temps réellement mis pour l'atteindre. Avant, elle était calculée avec la température relevée au début de la plage ; une pièce arrivée en avance puis légèrement redescendue (PAC à l'arrêt) faisait baisser la vitesse apprise, donc démarrer les préchauffes suivantes de plus en plus tôt. Nouvelle méthode « atteinte » dans le détail de la dernière mesure.
- **Fin de préchauffe** : dans le dernier degré avant l'objectif, la consigne envoyée reste 0,5 °C au-dessus de la température visée jusqu'à ce que la pièce l'atteigne. Avant, la relance s'arrêtait à 1 °C de l'objectif et la PAC pouvait s'arrêter un demi-degré trop bas. Hors préchauffe, rien ne change.

## 1.2.4
- **Relance de la PAC** : avec certains systèmes de zonage, quand une seule petite zone demande du chauffage, la PAC ne redémarre pas tant que l'écart consigne / mesure reste faible. L'écart minimum pendant une préchauffe passe donc de 1,5 à **3 °C**.
- **Dépassement temporaire de la consigne envoyée** : tant que la pièce est à plus de 1 °C sous la température visée (préchauffe, début de plage, retour prévu en absence), la consigne envoyée au Koolnova peut dépasser l'objectif de 1 °C au maximum, pour que l'écart ne retombe pas sous le seuil de relance avant l'arrivée. La température visée affichée et l'apprentissage ne changent pas.
- Nouvel attribut `sent_temperature` sur chaque thermostat : la consigne réellement envoyée au Koolnova.

## 1.2.3
- **Plus d'allers-retours de consigne pendant la préchauffe** : la consigne vise désormais 1,5 °C au-dessus du plus bas entre la mesure et la rampe. En 1.2.1/1.2.2, elle retombait sur la mesure dès que la pièce rattrapait la rampe, puis remontait quelques minutes plus tard, ce qui faisait lever le pied à la PAC et multipliait les écritures Modbus. Pendant une préchauffe, la consigne ne fait plus que monter.

## 1.2.2
- Une vitesse de chauffe réglée à la main repart de zéro : les anciennes mesures sont oubliées, pour que l'apprentissage ne la ramène pas aussitôt à leur médiane.

## 1.2.1
- **Préchauffe plus efficace** : une fois la préchauffe commencée, si la pièce est en retard sur la rampe, la consigne envoyée au Koolnova reste au moins 1,5 °C au-dessus de la température mesurée (sans dépasser la température visée). Une pièce en avance sur la rampe n'est pas poussée. Avec des paliers de 0,5 °C collés à la mesure, le Koolnova pouvait souffler à bas débit et la pièce ne montait presque pas.

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
