"""Constantes de l'intégration Chauffage intelligent."""

from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "chauffage_intelligent"
NAME = "Chauffage intelligent"
VERSION = "1.2.0"

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.CLIMATE,
    Platform.DATETIME,
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.SWITCH,
]

SUBENTRY_ZONE = "zone"

STORAGE_VERSION = 1

# --- Options globales (bouton « Configurer ») ---
CONF_WEATHER = "weather_entity"
CONF_OUTDOOR_SENSOR = "outdoor_sensor"
CONF_PRESENCE = "presence_entities"
CONF_ABSENCE_DELAY = "absence_delay"
CONF_NOTIFY = "notify_entities"
CONF_VERIFY_DELAY = "verify_delay"
CONF_MAX_RETRIES = "max_retries"
CONF_ARRIVAL_MINUTES = "arrival_minutes"
CONF_NOTIFY_WINDOWS = "notify_windows"

DEFAULT_ABSENCE_DELAY = 30
DEFAULT_VERIFY_DELAY = 12
DEFAULT_MAX_RETRIES = 3
DEFAULT_ARRIVAL_MINUTES = 60

# --- Sous-entrée zone ---
CONF_NAME = "name"
CONF_CLIMATE = "climate_entity"
CONF_WINDOWS = "window_entities"
CONF_WINDOW_DELAY = "window_delay"
CONF_USAGE = "usage"
CONF_FOLLOW_EXTERNAL = "follow_external"
CONF_ECO = "eco"
CONF_COMFORT = "comfort"
CONF_COMFORT_PLUS = "comfort_plus"
CONF_SPEED = "speed"

USAGE_MAIN = "main"
USAGE_SECONDARY = "secondary"

DEFAULT_WINDOW_DELAY = 5
DEFAULT_ECO = 18.0
DEFAULT_COMFORT = 20.0
DEFAULT_COMFORT_PLUS = 21.0
DEFAULT_SPEED = 2.0

# --- Modes ---
GLOBAL_AUTO = "auto"
GLOBAL_ABSENCE = "absence"
GLOBAL_VACATION = "vacation"
GLOBAL_OFF = "off"
GLOBAL_MODES = [GLOBAL_AUTO, GLOBAL_ABSENCE, GLOBAL_VACATION, GLOBAL_OFF]

ZONE_AUTO = "auto"
ZONE_ECO = "eco"
ZONE_COMFORT = "comfort"
ZONE_COMFORT_PLUS = "comfort_plus"
ZONE_OFF = "off"
ZONE_MODES = [ZONE_AUTO, ZONE_ECO, ZONE_COMFORT, ZONE_COMFORT_PLUS, ZONE_OFF]
FORCED_MODES = [ZONE_ECO, ZONE_COMFORT, ZONE_COMFORT_PLUS]

# Préréglages de plage dans un planning
SLOT_COMFORT = "comfort"
SLOT_COMFORT_PLUS = "comfort_plus"
SLOT_ECO = "eco"
SLOT_CUSTOM = "custom"
SLOT_PRESETS = [SLOT_COMFORT, SLOT_COMFORT_PLUS, SLOT_ECO, SLOT_CUSTOM]

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

# Réglages globaux modifiables (entités number)
G_ABSENCE_TEMP = "absence_temp"
G_VACATION_TEMP = "vacation_temp"
G_BOOST_TEMP = "boost_temp"
G_BOOST_DURATION = "boost_duration"

GLOBAL_DEFAULTS = {
    "mode": GLOBAL_AUTO,
    "engine": True,
    "absence_auto": True,
    "auto_absence_active": False,
    "vacation_end": None,
    G_ABSENCE_TEMP: 17.0,
    G_VACATION_TEMP: 15.0,
    G_BOOST_TEMP: 22.0,
    G_BOOST_DURATION: 60,
}

# Bornes
MIN_TEMP = 7.0
MAX_TEMP = 30.0
SPEED_MIN = 0.5
SPEED_MAX = 5.0
LEARN_MIN_IDLE_HOURS = 3.0
LOOKAHEAD_DAYS = 8
EXT_REF_TEMP = 10.0
EXT_FACTOR = 0.04
# Écart de relance : pendant une montée, la consigne envoyée reste au moins à cet
# écart au-dessus de la température mesurée. Constaté le 17/11 : quand une seule
# petite zone demande du chauffage, la PAC ne redémarre pas avec 1,5 à 2,5 °C
# d'écart, elle redémarre à 3 °C.
PREHEAT_MIN_GAP = 3.0
# Dépassement autorisé de la consigne envoyée au-dessus de la température visée,
# tant que la pièce est à plus de OVERDRIVE_BAND en dessous (sinon l'écart
# retombe sous le seuil de relance avant l'objectif et la pièce cale).
OVERDRIVE_MAX = 1.0
OVERDRIVE_BAND = 1.0
RETRY_AFTER_FAILURE_MIN = 30
REVERT_WINDOW_MIN = 45

SIGNAL_UPDATE = f"{DOMAIN}_update_{{}}"

# Codes de raison
R_ENGINE_OFF = "engine_off"
R_WINDOW = "window"
R_GLOBAL_OFF = "global_off"
R_ZONE_OFF = "zone_off"
R_BOOST = "boost"
R_MANUAL = "manual"
R_VACATION = "vacation"
R_VACATION_PREHEAT = "vacation_preheat"
R_ABSENCE = "absence"
R_ABSENCE_ARRIVAL = "absence_arrival"
R_ABSENCE_PREHEAT = "absence_preheat"
R_FORCED = "forced"
R_PLANNING = "planning"
R_PREHEAT = "preheat"
R_ECO = "eco"
R_UNAVAILABLE = "unavailable"

PRESET_LABELS = {
    SLOT_COMFORT: "Confort",
    SLOT_COMFORT_PLUS: "Confort +",
    SLOT_ECO: "Eco",
    SLOT_CUSTOM: "Personnalisé",
}

FRONTEND_URL = "/chauffage_intelligent_static"
CARD_FILE = "chauffage-intelligent-card.js"
