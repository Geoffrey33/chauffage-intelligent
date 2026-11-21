# Chauffage intelligent

[![Release](https://img.shields.io/github/v/release/Geoffrey33/chauffage-intelligent?style=flat-square)](https://github.com/Geoffrey33/chauffage-intelligent/releases)
[![HACS](https://img.shields.io/badge/HACS-Custom-41BDF5?style=flat-square)](https://hacs.xyz)
[![Validation](https://img.shields.io/github/actions/workflow/status/Geoffrey33/chauffage-intelligent/validate.yml?branch=main&label=validation&style=flat-square)](https://github.com/Geoffrey33/chauffage-intelligent/actions/workflows/validate.yml)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2025.8%2B-18BCF2?style=flat-square&logo=home-assistant&logoColor=white)](https://www.home-assistant.io)
[![Licence](https://img.shields.io/github/license/Geoffrey33/chauffage-intelligent?style=flat-square)](LICENSE)

*[English version below](#english)*

Intégration Home Assistant pour piloter un chauffage multizone (pensée pour une PAC gainable **Koolnova**, compatible avec toute entité `climate`) avec :

- **un thermostat par pièce** (`climate.<pièce>`) et une page appareil complète ;
- **des plannings hebdomadaires visuels**, avec une consigne par plage (Eco, Confort, Confort +, ou température personnalisée) ;
- **une préchauffe progressive** : les heures du planning sont celles où la température doit être *atteinte*. La consigne monte par paliers de 0,5 °C avant la plage, plus tôt quand il fait froid dehors. La vitesse de chauffe de chaque pièce **s'apprend toute seule** (mesurée à chaque préchauffe, lissée sur les 7 dernières mesures) ;
- **des modes maison** : Auto, Absence (automatique quand plus personne n'est là, désactivable), Vacances (avec date de retour et préchauffe pour l'arrivée), Arrêt ;
- **la coupure fenêtre** (délai réglable par pièce, notification) ;
- **le boost** et les **réglages ponctuels** (valables jusqu'au prochain changement du planning) ;
- **un envoi fiable** : chaque consigne est vérifiée puis renvoyée si le Koolnova ne l'a pas prise (notification après plusieurs échecs) ;
- **la prise en compte des réglages faits sur le thermostat Koolnova** : ils deviennent un réglage manuel temporaire au lieu d'être écrasés.

La ventilation du Koolnova n'est jamais modifiée : seules la consigne et la mise en marche/arrêt sont envoyées.

![Carte Chauffage intelligent](docs/carte-sombre.png)

## Installation (HACS)

[![Ouvrir dans HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Geoffrey33&repository=chauffage-intelligent&category=integration)

1. Clique sur le bouton ci-dessus, ou dans HACS : menu ⋮ → **Dépôts personnalisés** → ajoute l'URL de ce dépôt, catégorie **Intégration**.
2. Installe **Chauffage intelligent**, puis redémarre Home Assistant.
3. Ajoute l'intégration :

   [![Ajouter l'intégration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=chauffage_intelligent)

Chaque nouvelle version est publiée automatiquement comme release GitHub : HACS la propose aussitôt (voir [CHANGELOG.md](CHANGELOG.md)).

**Prérequis** : Home Assistant 2025.8 ou plus récent (2026.3+ pour l'icône de l'intégration), et une entité `climate` par zone à piloter (Koolnova, Airzone, vannes thermostatiques, climatiseurs…).

## Configuration

- **Réglages généraux** (bouton *Configurer*) : météo ou sonde extérieure, personnes pour l'absence automatique, téléphones à notifier, délais.
- **Pièces** (bouton *Ajouter une pièce*) : nom, zone Koolnova, capteurs de fenêtre, délai de coupure, type de pièce.
- **Consignes, planning, mode** : sur la carte ou sur la page de l'appareil de chaque pièce.

## Carte

La carte est chargée automatiquement par l'intégration : aucune ressource à déclarer.
Dans un tableau de bord : *Ajouter une carte* → **Chauffage intelligent**, ou en YAML :

```yaml
type: custom:chauffage-intelligent-card
title: Chauffage
# show_global: true   # mode maison et puces d'état
# group: true         # pièces principales / peu utilisées
# zones: [climate.sejour, climate.chambre_1]   # vide = toutes
```

Toucher une pièce ouvre sa fenêtre de réglage, en quatre onglets.

| Pilotage | Planning |
|---|---|
| ![Pilotage](docs/pilotage.png) | ![Planning](docs/planning.png) |
| **Cadran de thermostat** (consigne, mesure, − / + pour un réglage ponctuel), mode de la pièce en vignettes avec leur valeur, boost avec temps restant, planning du jour. | **Éditeur de la semaine** : touche une zone vide pour ajouter une plage, fais glisser une plage ou ses bords. Temps de confort par jour et par semaine, copie de jours, reprise du planning d'une autre pièce, modèles. |

| Historique | Réglages |
|---|---|
| ![Historique](docs/historique.png) | ![Réglages](docs/reglages.png) |
| **Chiffres clés** (chauffe du jour et de la période, température moyenne, temps à la consigne), courbe mesure / consigne sur 24 h ou 7 jours, temps de chauffe par jour. | **Consignes** sur une échelle colorée, préchauffe avec vitesse apprise et détail de la dernière mesure, état de la pièce (synchronisation, fenêtres). |

La carte suit le thème clair ou sombre de Home Assistant :

![Carte en thème clair](docs/carte-claire.png)

*Captures réalisées avec des pièces et des données de démonstration.*

## Ordre de priorité

1. Fenêtre ouverte depuis plus que le délai → arrêt
2. Maison en Arrêt, ou pièce en Arrêt → arrêt
3. Boost
4. Réglage ponctuel (jusqu'au prochain changement du planning)
5. Vacances → consigne vacances, puis préchauffe pour la date de retour
6. Absence → min(consigne absence, Eco). En Auto : préchauffe avant les plages, puis Confort pendant la première heure de chaque plage (arrivée prévue)
7. Pièce forcée en Eco, Confort ou Confort +
8. Auto : la plage en cours, sinon Eco avec la préchauffe vers la plage suivante

L'interrupteur **Moteur actif** permet de tout calculer sans rien envoyer (utile pour comparer avec un ancien système).

## Services

`chauffage_intelligent.set_planning`, `boost`, `cancel_boost`, `resume`, `set_zone_settings`, `set_zone_mode` (cible : le thermostat d'une pièce).

Format du planning :

```yaml
mon:
  - {start: "07:00", end: "07:30", preset: comfort}
  - {start: "18:00", end: "23:00", preset: custom, temp: 20.5}
tue: []
```

---

## English

**Chauffage intelligent** ("smart heating") is a Home Assistant integration that drives multi-zone heating on top of any existing `climate` entities (designed for Koolnova ducted heat-pump zoning, works with any thermostat-like entity).

**Features**
- One virtual thermostat per room, configured from the UI (*Settings → Devices & services*), one device per room.
- Visual weekly schedules with a setpoint per time slot (Eco, Comfort, Comfort +, or custom).
- **Learned preheating**: schedule times are when the temperature must be *reached*. Each room's heating speed is measured at every preheat, normalised to the outdoor temperature and smoothed over the last 7 measurements.
- House modes: Auto, Away (automatic from presence, can be disabled), Vacation (with return date and preheat for arrival), Off.
- Open-window cut-off, boost, temporary manual overrides, changes made on the physical thermostat respected.
- Reliable sending: each setpoint is verified and re-sent if the device did not take it (notification after repeated failures).
- Bundled dashboard card (`custom:chauffage-intelligent-card`, loaded automatically) with a thermostat dial, schedule editor, history and settings per room.

**Installation**: add this repository to HACS as a custom repository (category *Integration*) using the button above, install, restart Home Assistant, then add the *Chauffage intelligent* integration. The user interface is available in French and English.

**Services**: `chauffage_intelligent.set_planning`, `boost`, `cancel_boost`, `resume`, `set_zone_settings`, `set_zone_mode`.

Issues and suggestions: [GitHub issues](https://github.com/Geoffrey33/chauffage-intelligent/issues).

