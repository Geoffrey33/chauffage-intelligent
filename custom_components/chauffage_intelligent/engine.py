"""Calcul des consignes (logique pure, sans dépendance aux états HA).

Tout ce qui décide « quelle température veut-on dans cette pièce maintenant ? »
est ici, pour être lisible et testable.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
import math
from typing import Any

from .const import (
    DAYS,
    EXT_FACTOR,
    EXT_REF_TEMP,
    GLOBAL_ABSENCE,
    GLOBAL_OFF,
    GLOBAL_VACATION,
    LOOKAHEAD_DAYS,
    MAX_TEMP,
    MIN_TEMP,
    OVERDRIVE_BAND,
    OVERDRIVE_MAX,
    PREHEAT_MIN_GAP,
    PRESET_LABELS,
    R_ABSENCE,
    R_ABSENCE_ARRIVAL,
    R_ABSENCE_PREHEAT,
    R_BOOST,
    R_ECO,
    R_FORCED,
    R_GLOBAL_OFF,
    R_MANUAL,
    R_PLANNING,
    R_PREHEAT,
    R_VACATION,
    R_VACATION_PREHEAT,
    R_WINDOW,
    R_ZONE_OFF,
    SLOT_COMFORT,
    SLOT_COMFORT_PLUS,
    SLOT_CUSTOM,
    SLOT_ECO,
    SLOT_PRESETS,
    ZONE_AUTO,
    ZONE_COMFORT,
    ZONE_COMFORT_PLUS,
    ZONE_ECO,
    ZONE_OFF,
)

# --------------------------------------------------------------------------
# Planning
# --------------------------------------------------------------------------


class PlanningError(ValueError):
    """Planning invalide."""


def parse_hhmm(value: str) -> int:
    """'07:30' -> 450 minutes. '24:00' accepté pour la fin de journée."""
    try:
        hours, minutes = str(value).strip().split(":")[:2]
        total = int(hours) * 60 + int(minutes)
    except (ValueError, AttributeError) as err:
        raise PlanningError(f"Heure invalide : {value}") from err
    if not 0 <= total <= 1440 or not 0 <= int(minutes) < 60:
        raise PlanningError(f"Heure invalide : {value}")
    return total


def fmt_hhmm(minutes: int) -> str:
    """450 -> '07:30'."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def normalize_planning(raw: Any) -> dict[str, list[dict[str, Any]]]:
    """Valide et normalise un planning hebdomadaire.

    Format : {"mon": [{"start": "07:00", "end": "07:30", "preset": "comfort"}, ...], ...}
    preset ∈ comfort / comfort_plus / eco / custom (custom => "temp" obligatoire).
    Les plages sont triées ; un chevauchement est une erreur.
    """
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise PlanningError("Le planning doit être un objet par jour")
    result: dict[str, list[dict[str, Any]]] = {}
    for day in DAYS:
        slots_in = raw.get(day) or []
        if not isinstance(slots_in, list):
            raise PlanningError(f"{day} : liste de plages attendue")
        slots: list[dict[str, Any]] = []
        for slot in slots_in:
            if not isinstance(slot, dict):
                raise PlanningError(f"{day} : plage invalide")
            start = parse_hhmm(slot.get("start", ""))
            end = parse_hhmm(slot.get("end", ""))
            if end <= start:
                raise PlanningError(
                    f"{day} : la fin ({fmt_hhmm(end)}) doit suivre le début ({fmt_hhmm(start)})"
                )
            preset = slot.get("preset", SLOT_COMFORT)
            if preset not in SLOT_PRESETS:
                raise PlanningError(f"{day} : préréglage inconnu {preset}")
            clean: dict[str, Any] = {
                "start": fmt_hhmm(start),
                "end": fmt_hhmm(end),
                "preset": preset,
            }
            if preset == SLOT_CUSTOM:
                try:
                    temp = float(slot["temp"])
                except (KeyError, TypeError, ValueError) as err:
                    raise PlanningError(f"{day} : température manquante") from err
                if not MIN_TEMP <= temp <= MAX_TEMP:
                    raise PlanningError(f"{day} : température hors bornes ({temp})")
                clean["temp"] = round(temp * 2) / 2
            slots.append(clean)
        slots.sort(key=lambda s: parse_hhmm(s["start"]))
        for prev, cur in zip(slots, slots[1:]):
            if parse_hhmm(cur["start"]) < parse_hhmm(prev["end"]):
                raise PlanningError(
                    f"{day} : les plages {prev['start']}-{prev['end']} et "
                    f"{cur['start']}-{cur['end']} se chevauchent"
                )
        result[day] = slots
    return result


def empty_planning() -> dict[str, list[dict[str, Any]]]:
    """Planning vide."""
    return {day: [] for day in DAYS}


def _at(day: date, minutes: int, tzinfo) -> datetime:
    """Datetime local pour un jour + minutes (24:00 = minuit suivant)."""
    if minutes >= 1440:
        day = day + timedelta(days=1)
        minutes -= 1440
    return datetime(day.year, day.month, day.day, minutes // 60, minutes % 60, tzinfo=tzinfo)


def iter_slots(
    planning: dict[str, list[dict[str, Any]]], start: datetime, days: int = LOOKAHEAD_DAYS
) -> Iterator[tuple[datetime, datetime, dict[str, Any]]]:
    """Plages (début, fin, plage) dans l'ordre chronologique à partir du jour de `start`."""
    tz = start.tzinfo
    first = start.date() - timedelta(days=1)  # inclut une plage de la veille finissant à 24:00
    for offset in range(days + 1):
        day = first + timedelta(days=offset)
        for slot in planning.get(DAYS[day.weekday()], []):
            yield (
                _at(day, parse_hhmm(slot["start"]), tz),
                _at(day, parse_hhmm(slot["end"]), tz),
                slot,
            )


# --------------------------------------------------------------------------
# Modèle
# --------------------------------------------------------------------------


@dataclass
class ZoneSettings:
    """Réglages d'une zone (persistés)."""

    eco: float
    comfort: float
    comfort_plus: float
    speed: float
    mode: str = ZONE_AUTO
    preheat: bool = True
    planning: dict[str, list[dict[str, Any]]] = field(default_factory=empty_planning)
    boost_until: datetime | None = None
    boost_temp: float | None = None
    manual_temp: float | None = None
    manual_off: bool = False
    manual_until: datetime | None = None
    manual_active: bool = False


@dataclass
class GlobalSettings:
    """Réglages globaux."""

    mode: str
    absence_temp: float
    vacation_temp: float
    boost_temp: float
    vacation_end: datetime | None = None
    arrival_minutes: int = 60


@dataclass
class ZoneInputs:
    """Mesures du moment."""

    window_open: bool = False
    current_temp: float | None = None
    outdoor_temp: float | None = None


@dataclass
class Result:
    """Résultat du calcul pour une zone."""

    target: float | None  # None = coupé
    reason: str
    preset: str | None = None  # eco / comfort / comfort_plus / custom / boost
    preheat_target: float | None = None
    preheat_at: datetime | None = None
    slot_end: datetime | None = None
    base: float | None = None
    # Consigne envoyée au Koolnova si elle diffère de `target` (relance : jusqu'à
    # OVERDRIVE_MAX au-dessus de la température visée pendant une montée).
    command: float | None = None

    @property
    def is_off(self) -> bool:
        """Zone coupée."""
        return self.target is None

    @property
    def send(self) -> float | None:
        """Consigne à envoyer au Koolnova."""
        if self.target is None:
            return None
        return self.command if self.command is not None else self.target


def slot_temp(slot: dict[str, Any], zone: ZoneSettings) -> float:
    """Température d'une plage."""
    preset = slot.get("preset", SLOT_COMFORT)
    if preset == SLOT_COMFORT_PLUS:
        return zone.comfort_plus
    if preset == SLOT_ECO:
        return zone.eco
    if preset == SLOT_CUSTOM:
        return float(slot.get("temp", zone.comfort))
    return zone.comfort


def active_slot(
    planning: dict[str, list[dict[str, Any]]], now: datetime
) -> tuple[datetime, datetime, dict[str, Any]] | None:
    """Plage en cours, s'il y en a une."""
    for start, end, slot in iter_slots(planning, now, days=1):
        if start <= now < end:
            return start, end, slot
        if start > now:
            break
    return None


def next_heat_slot(
    zone: ZoneSettings, after: datetime, base: float
) -> tuple[datetime, float] | None:
    """Prochaine plage (début > after) dont la température dépasse la base."""
    for start, _end, slot in iter_slots(zone.planning, after):
        if start <= after:
            continue
        temp = slot_temp(slot, zone)
        if temp > base:
            return start, temp
    return None


def next_change(planning: dict[str, list[dict[str, Any]]], now: datetime) -> datetime | None:
    """Prochain début ou fin de plage après `now`."""
    for start, end, _slot in iter_slots(planning, now):
        if start > now:
            return start
        if end > now:
            return end
    return None


def effective_speed(speed: float, outdoor: float | None) -> float:
    """Vitesse de chauffe corrigée par le froid extérieur."""
    if outdoor is None:
        return speed
    return speed / (1 + EXT_FACTOR * max(0.0, EXT_REF_TEMP - outdoor))


def floor_half(value: float) -> float:
    """Arrondi au 0,5 °C inférieur."""
    return math.floor(value * 2 + 1e-9) / 2


def overdrive(goal: float, push: float, current: float | None) -> float | None:
    """Consigne de relance au-dessus de `goal`, ou None si inutile.

    Seulement tant que la pièce est à plus de OVERDRIVE_BAND sous l'objectif,
    et jamais plus de OVERDRIVE_MAX au-dessus.
    """
    if current is None or current >= goal - OVERDRIVE_BAND or push <= goal:
        return None
    return min(goal + OVERDRIVE_MAX, push)


def catch_up(goal: float, current: float | None) -> float | None:
    """Relance pendant une plage : pièce nettement sous la température visée."""
    if current is None:
        return None
    return overdrive(goal, floor_half(current + PREHEAT_MIN_GAP), current)


def ramp(
    zone: ZoneSettings,
    now: datetime,
    base: float,
    outdoor: float | None,
    search_from: datetime | None = None,
    current: float | None = None,
) -> tuple[float, datetime | None, float | None, float | None]:
    """Consigne de préchauffe progressive vers la prochaine plage chaude.

    Une fois la préchauffe commencée, la consigne vise PREHEAT_MIN_GAP
    au-dessus du plus bas entre la mesure et la rampe (sans dépasser la
    température visée) : la PAC chauffe réellement, et la consigne ne
    retombe pas quand la pièce rattrape la rampe (pas d'allers-retours).
    Une pièce en avance sur la rampe arrive un peu plus tôt : l'apprentissage
    retarde alors le départ des préchauffes suivantes.

    Tant que la pièce est à plus de OVERDRIVE_BAND sous la température visée,
    la consigne envoyée peut la dépasser de OVERDRIVE_MAX (relance de la PAC).

    Retourne (consigne, heure de la plage visée, température visée,
    consigne de relance à envoyer ou None).
    """
    after = max(now, search_from) if search_from else now
    nxt = next_heat_slot(zone, after, base)
    if nxt is None:
        return base, None, None, None
    start, temp = nxt
    hours = max(0.0, (start - now).total_seconds() / 3600)
    value = floor_half(temp - effective_speed(zone.speed, outdoor) * hours)
    value = min(max(value, base), temp)
    command = None
    if value > base and current is not None:
        push = max(value, floor_half(min(current, value) + PREHEAT_MIN_GAP))
        command = overdrive(temp, push, current)
        value = min(push, temp)
    return value, start, temp, command


# --------------------------------------------------------------------------
# Calcul principal
# --------------------------------------------------------------------------


def compute(
    now: datetime, glob: GlobalSettings, zone: ZoneSettings, inputs: ZoneInputs
) -> Result:
    """Consigne voulue pour une zone, par ordre de priorité."""
    if inputs.window_open:
        return Result(None, R_WINDOW)
    if glob.mode == GLOBAL_OFF:
        return Result(None, R_GLOBAL_OFF)
    if zone.mode == ZONE_OFF:
        return Result(None, R_ZONE_OFF)

    if zone.boost_until and zone.boost_until > now:
        temp = zone.boost_temp if zone.boost_temp is not None else glob.boost_temp
        return Result(temp, R_BOOST, preset="boost", slot_end=zone.boost_until)

    if zone.manual_active and (zone.manual_until is None or zone.manual_until > now):
        if zone.manual_off:
            return Result(None, R_MANUAL, slot_end=zone.manual_until)
        return Result(zone.manual_temp, R_MANUAL, slot_end=zone.manual_until)

    if glob.mode == GLOBAL_VACATION:
        base = glob.vacation_temp
        if zone.mode == ZONE_AUTO and zone.preheat and glob.vacation_end:
            value, at, target, cmd = ramp(
                zone, now, base, inputs.outdoor_temp, glob.vacation_end, inputs.current_temp
            )
            if value > base:
                return Result(
                    value, R_VACATION_PREHEAT, preheat_target=target, preheat_at=at, base=base, command=cmd
                )
        return Result(base, R_VACATION, base=base)

    if glob.mode == GLOBAL_ABSENCE:
        base = min(glob.absence_temp, zone.eco)
        if zone.mode != ZONE_AUTO:
            return Result(base, R_ABSENCE, base=base)
        current = active_slot(zone.planning, now)
        if current is not None:
            start, end, slot = current
            temp = slot_temp(slot, zone)
            if temp > base and now - start < timedelta(minutes=glob.arrival_minutes):
                return Result(
                    temp, R_ABSENCE_ARRIVAL, preset=slot["preset"], slot_end=end, base=base,
                    command=catch_up(temp, inputs.current_temp),
                )
        if zone.preheat:
            value, at, target, cmd = ramp(zone, now, base, inputs.outdoor_temp, current=inputs.current_temp)
            if value > base:
                return Result(
                    value, R_ABSENCE_PREHEAT, preheat_target=target, preheat_at=at, base=base, command=cmd
                )
        return Result(base, R_ABSENCE, base=base)

    if zone.mode in (ZONE_ECO, ZONE_COMFORT, ZONE_COMFORT_PLUS):
        value = {
            ZONE_ECO: zone.eco,
            ZONE_COMFORT: zone.comfort,
            ZONE_COMFORT_PLUS: zone.comfort_plus,
        }[zone.mode]
        return Result(value, R_FORCED, preset=zone.mode)

    # Mode Auto
    current = active_slot(zone.planning, now)
    if current is not None:
        _start, end, slot = current
        temp = slot_temp(slot, zone)
        return Result(
            temp, R_PLANNING, preset=slot["preset"], slot_end=end, command=catch_up(temp, inputs.current_temp)
        )
    base = zone.eco
    if zone.preheat:
        value, at, target, cmd = ramp(zone, now, base, inputs.outdoor_temp, current=inputs.current_temp)
        if value > base:
            return Result(
                value, R_PREHEAT, preset=SLOT_ECO, preheat_target=target, preheat_at=at, base=base, command=cmd
            )
    return Result(base, R_ECO, preset=SLOT_ECO, base=base)


# --------------------------------------------------------------------------
# Libellés
# --------------------------------------------------------------------------


def _t(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:.1f}".replace(".0", "").replace(".", ",") + " °C"


def _h(value: datetime | None, now: datetime | None = None) -> str:
    if value is None:
        return ""
    if now is not None and value.date() != now.date():
        jours = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]
        return f"{jours[value.weekday()]} {value:%H:%M}"
    return f"{value:%H:%M}"


def describe(result: Result, now: datetime | None = None) -> str:
    """Phrase courte expliquant la consigne."""
    r = result.reason
    if r == R_WINDOW:
        return "Fenêtre ouverte : chauffage coupé"
    if r == R_GLOBAL_OFF:
        return "Chauffage arrêté (maison)"
    if r == R_ZONE_OFF:
        return "Pièce arrêtée"
    if r == R_BOOST:
        return f"Boost {_t(result.target)} jusqu'à {_h(result.slot_end, now)}"
    if r == R_MANUAL:
        quoi = "Arrêt manuel" if result.target is None else f"Manuel {_t(result.target)}"
        if result.slot_end:
            return f"{quoi} jusqu'à {_h(result.slot_end, now)}"
        return quoi
    if r in (R_PREHEAT, R_ABSENCE_PREHEAT, R_VACATION_PREHEAT):
        return f"Préchauffe → {_t(result.preheat_target)} à {_h(result.preheat_at, now)}"
    if r == R_VACATION:
        return f"Vacances {_t(result.target)}"
    if r == R_ABSENCE:
        return f"Absence {_t(result.target)}"
    if r == R_ABSENCE_ARRIVAL:
        return f"Retour prévu : {_t(result.target)}"
    if r == R_FORCED:
        return f"{PRESET_LABELS.get(result.preset or '', '')} forcé {_t(result.target)}"
    if r == R_PLANNING:
        label = PRESET_LABELS.get(result.preset or "", "")
        if result.preset == SLOT_CUSTOM:
            label = "Planning"
        return f"{label} {_t(result.target)} jusqu'à {_h(result.slot_end, now)}"
    if r == R_ECO:
        return f"Eco {_t(result.target)}"
    return r
