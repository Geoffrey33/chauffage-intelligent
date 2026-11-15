"""Moteur d'exécution : lit les capteurs, calcule, applique au Koolnova."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.components.climate import (
    ATTR_HVAC_MODE,
    DOMAIN as CLIMATE_DOMAIN,
    SERVICE_SET_HVAC_MODE,
    SERVICE_SET_TEMPERATURE,
    SERVICE_TURN_OFF,
    HVACMode,
)
from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_TEMPERATURE,
    STATE_HOME,
    STATE_ON,
    STATE_OPEN,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import CALLBACK_TYPE, Context, Event, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    CONF_ABSENCE_DELAY,
    CONF_ARRIVAL_MINUTES,
    CONF_CLIMATE,
    CONF_COMFORT,
    CONF_COMFORT_PLUS,
    CONF_ECO,
    CONF_FOLLOW_EXTERNAL,
    CONF_MAX_RETRIES,
    CONF_NAME,
    CONF_NOTIFY,
    CONF_NOTIFY_WINDOWS,
    CONF_OUTDOOR_SENSOR,
    CONF_PRESENCE,
    CONF_SPEED,
    CONF_USAGE,
    CONF_VERIFY_DELAY,
    CONF_WEATHER,
    CONF_WINDOW_DELAY,
    CONF_WINDOWS,
    DEFAULT_ABSENCE_DELAY,
    DEFAULT_ARRIVAL_MINUTES,
    DEFAULT_COMFORT,
    DEFAULT_COMFORT_PLUS,
    DEFAULT_ECO,
    DEFAULT_MAX_RETRIES,
    DEFAULT_SPEED,
    DEFAULT_VERIFY_DELAY,
    DEFAULT_WINDOW_DELAY,
    DOMAIN,
    G_ABSENCE_TEMP,
    G_BOOST_DURATION,
    G_BOOST_TEMP,
    G_VACATION_TEMP,
    GLOBAL_ABSENCE,
    GLOBAL_AUTO,
    GLOBAL_DEFAULTS,
    GLOBAL_MODES,
    GLOBAL_OFF,
    GLOBAL_VACATION,
    EXT_FACTOR,
    EXT_REF_TEMP,
    R_ABSENCE_ARRIVAL,
    R_ABSENCE_PREHEAT,
    R_PLANNING,
    R_PREHEAT,
    R_VACATION_PREHEAT,
    R_WINDOW,
    RETRY_AFTER_FAILURE_MIN,
    REVERT_WINDOW_MIN,
    SIGNAL_UPDATE,
    SPEED_MAX,
    SPEED_MIN,
    STORAGE_VERSION,
    SUBENTRY_ZONE,
    USAGE_MAIN,
    ZONE_AUTO,
    ZONE_MODES,
)
from .engine import (
    GlobalSettings,
    Result,
    ZoneInputs,
    ZoneSettings,
    active_slot,
    compute,
    describe,
    empty_planning,
    next_change,
    normalize_planning,
    slot_temp,
)

_LOGGER = logging.getLogger(__name__)

PREHEAT_REASONS = {R_PREHEAT, R_ABSENCE_PREHEAT, R_VACATION_PREHEAT}
OPEN_STATES = {STATE_ON, STATE_OPEN, "true", "opening"}
HOME_STATES = {STATE_HOME, STATE_ON}


def _dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return dt_util.parse_datetime(str(value))


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@dataclass
class Command:
    """Dernière commande envoyée au Koolnova."""

    target: float | None
    prev_off: bool
    prev_temp: float | None
    sent_at: datetime
    attempts: int = 1


@dataclass
class ZoneRuntime:
    """Zone en fonctionnement."""

    subentry_id: str
    name: str
    climate_entity: str
    windows: list[str]
    window_delay: int
    usage: str
    follow_external: bool
    data: dict[str, Any]  # référence dans le store
    result: Result | None = None
    reason_text: str = ""
    window_open_since: datetime | None = None
    window_notified: bool = False
    pending: Command | None = None
    last_cmd: Command | None = None
    failed_target: float | None | str = "none"
    failed_at: datetime | None = None
    sync_status: str = "init"
    our_contexts: list[str] = field(default_factory=list)
    unsub_window_timer: CALLBACK_TYPE | None = None

    # --- accès pratiques ---
    @property
    def settings(self) -> ZoneSettings:
        """Réglages au format moteur."""
        d = self.data
        manual = d.get("manual") or {}
        return ZoneSettings(
            eco=d["eco"],
            comfort=d["comfort"],
            comfort_plus=d["comfort_plus"],
            speed=d["speed"],
            mode=d["mode"],
            preheat=d.get("preheat", True),
            planning=d.get("planning") or empty_planning(),
            boost_until=_dt(d.get("boost_until")),
            boost_temp=d.get("boost_temp"),
            manual_active=bool(manual),
            manual_temp=manual.get("temp"),
            manual_off=manual.get("off", False),
            manual_until=_dt(manual.get("until")),
        )


class Manager:
    """Gère toutes les zones d'une entrée de configuration."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialisation."""
        self.hass = hass
        self.entry = entry
        self.store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}"
        )
        self.data: dict[str, Any] = {}
        self.zones: dict[str, ZoneRuntime] = {}
        self._unsubs: list[Callable[[], None]] = []
        self.nobody_since: datetime | None = None
        self.started = False
        self.signal = SIGNAL_UPDATE.format(entry.entry_id)

    # ------------------------------------------------------------------
    # Options
    # ------------------------------------------------------------------
    def opt(self, key: str, default: Any = None) -> Any:
        """Option globale."""
        return self.entry.options.get(key, self.entry.data.get(key, default))

    @property
    def glob(self) -> dict[str, Any]:
        """Données globales persistées."""
        return self.data["global"]

    # ------------------------------------------------------------------
    # Chargement
    # ------------------------------------------------------------------
    async def async_load(self) -> None:
        """Charge le stockage et construit les zones."""
        stored = await self.store.async_load() or {}
        glob = {**GLOBAL_DEFAULTS, **(stored.get("global") or {})}
        if glob["mode"] not in GLOBAL_MODES:
            glob["mode"] = GLOBAL_AUTO
        zones_data: dict[str, Any] = stored.get("zones") or {}
        self.data = {"global": glob, "zones": {}}

        for sub in self.entry.subentries.values():
            if sub.subentry_type != SUBENTRY_ZONE:
                continue
            zdata = zones_data.get(sub.subentry_id) or self._initial_zone_data(sub)
            zdata.setdefault("mode", ZONE_AUTO)
            if zdata["mode"] not in ZONE_MODES:
                zdata["mode"] = ZONE_AUTO
            zdata.setdefault("preheat", True)
            try:
                zdata["planning"] = normalize_planning(zdata.get("planning"))
            except ValueError:
                _LOGGER.warning("Planning illisible pour %s, réinitialisé", sub.title)
                zdata["planning"] = empty_planning()
            self.data["zones"][sub.subentry_id] = zdata
            self.zones[sub.subentry_id] = self._build_zone(sub, zdata)
        self.save()

    @staticmethod
    def _initial_zone_data(sub: ConfigSubentry) -> dict[str, Any]:
        d = sub.data
        return {
            "mode": ZONE_AUTO,
            "eco": float(d.get(CONF_ECO, DEFAULT_ECO)),
            "comfort": float(d.get(CONF_COMFORT, DEFAULT_COMFORT)),
            "comfort_plus": float(d.get(CONF_COMFORT_PLUS, DEFAULT_COMFORT_PLUS)),
            "speed": float(d.get(CONF_SPEED, DEFAULT_SPEED)),
            "preheat": True,
            "planning": empty_planning(),
        }

    @staticmethod
    def _build_zone(sub: ConfigSubentry, zdata: dict[str, Any]) -> ZoneRuntime:
        d = sub.data
        return ZoneRuntime(
            subentry_id=sub.subentry_id,
            name=d.get(CONF_NAME) or sub.title,
            climate_entity=d[CONF_CLIMATE],
            windows=list(d.get(CONF_WINDOWS) or []),
            window_delay=int(d.get(CONF_WINDOW_DELAY, DEFAULT_WINDOW_DELAY)),
            usage=d.get(CONF_USAGE, USAGE_MAIN),
            follow_external=d.get(CONF_FOLLOW_EXTERNAL, True),
            data=zdata,
        )

    @callback
    def save(self) -> None:
        """Sauvegarde différée."""
        self.store.async_delay_save(lambda: self.data, 2)

    # ------------------------------------------------------------------
    # Démarrage / arrêt
    # ------------------------------------------------------------------
    async def async_start(self) -> None:
        """Démarre l'écoute."""
        watched: set[str] = set()
        for zone in self.zones.values():
            watched.update(zone.windows)
            watched.add(zone.climate_entity)
        watched.update(self.opt(CONF_PRESENCE) or [])
        for key in (CONF_WEATHER, CONF_OUTDOOR_SENSOR):
            if self.opt(key):
                watched.add(self.opt(key))
        if watched:
            self._unsubs.append(
                async_track_state_change_event(self.hass, list(watched), self._on_state)
            )
        self._unsubs.append(
            async_track_time_interval(self.hass, self._on_tick, timedelta(minutes=1))
        )
        now = dt_util.now()
        for zone in self.zones.values():
            if self._any_open(zone):
                # au démarrage, on considère la fenêtre ouverte depuis son dernier changement
                since = min(
                    (
                        s.last_changed
                        for e in zone.windows
                        if (s := self.hass.states.get(e)) and s.state in OPEN_STATES
                    ),
                    default=now,
                )
                zone.window_open_since = since
                self._schedule_window_check(zone, since)
        self._init_presence(now)

        @callback
        def _started(_hass: HomeAssistant) -> None:
            self.started = True
            self.hass.async_create_task(self.async_refresh(resync=True))

        self._unsubs.append(async_at_started(self.hass, _started))

    @callback
    def async_stop(self) -> None:
        """Arrête l'écoute."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        for zone in self.zones.values():
            if zone.unsub_window_timer:
                zone.unsub_window_timer()
                zone.unsub_window_timer = None

    # ------------------------------------------------------------------
    # Événements
    # ------------------------------------------------------------------
    async def _on_tick(self, _now: datetime) -> None:
        await self.async_refresh()

    @callback
    def _on_state(self, event: Event) -> None:
        entity_id: str = event.data["entity_id"]
        now = dt_util.now()
        refresh = False
        for zone in self.zones.values():
            if entity_id in zone.windows:
                self._update_window(zone, now)
                refresh = True
            if entity_id == zone.climate_entity:
                self._on_climate_change(zone, event)
                refresh = True
        if entity_id in (self.opt(CONF_PRESENCE) or []):
            self._update_presence(now)
            refresh = True
        if refresh and self.started:
            self.hass.async_create_task(self.async_refresh())

    def _any_open(self, zone: ZoneRuntime) -> bool:
        return any(
            (s := self.hass.states.get(e)) is not None and s.state in OPEN_STATES
            for e in zone.windows
        )

    @callback
    def _update_window(self, zone: ZoneRuntime, now: datetime) -> None:
        if self._any_open(zone):
            if zone.window_open_since is None:
                zone.window_open_since = now
                self._schedule_window_check(zone, now)
        else:
            zone.window_open_since = None
            zone.window_notified = False
            if zone.unsub_window_timer:
                zone.unsub_window_timer()
                zone.unsub_window_timer = None

    @callback
    def _schedule_window_check(self, zone: ZoneRuntime, since: datetime) -> None:
        if zone.unsub_window_timer:
            zone.unsub_window_timer()
        delay = max(
            1.0,
            (since + timedelta(minutes=zone.window_delay) - dt_util.now()).total_seconds() + 1,
        )

        @callback
        def _check(_now: datetime) -> None:
            zone.unsub_window_timer = None
            self.hass.async_create_task(self.async_refresh())

        zone.unsub_window_timer = async_call_later(self.hass, delay, _check)

    def window_effective(self, zone: ZoneRuntime, now: datetime) -> bool:
        """Fenêtre ouverte depuis plus que le délai."""
        return (
            zone.window_open_since is not None
            and now - zone.window_open_since >= timedelta(minutes=zone.window_delay)
        )

    # --- présence ---
    def someone_home(self) -> bool | None:
        """True / False, ou None si aucun capteur de présence."""
        entities = self.opt(CONF_PRESENCE) or []
        if not entities:
            return None
        known = [s for e in entities if (s := self.hass.states.get(e)) is not None]
        if not known:
            return None
        return any(s.state in HOME_STATES for s in known)

    def _init_presence(self, now: datetime) -> None:
        home = self.someone_home()
        if home is False:
            last = max(
                (
                    s.last_changed
                    for e in self.opt(CONF_PRESENCE) or []
                    if (s := self.hass.states.get(e)) is not None
                ),
                default=now,
            )
            self.nobody_since = last
        else:
            self.nobody_since = None

    @callback
    def _update_presence(self, now: datetime) -> None:
        home = self.someone_home()
        if home is False:
            if self.nobody_since is None:
                self.nobody_since = now
        else:
            self.nobody_since = None

    def _handle_auto_absence(self, now: datetime) -> None:
        glob = self.glob
        home = self.someone_home()
        if home is None:
            return
        delay = timedelta(minutes=int(self.opt(CONF_ABSENCE_DELAY, DEFAULT_ABSENCE_DELAY)))
        if (
            not home
            and glob["absence_auto"]
            and glob["mode"] == GLOBAL_AUTO
            and self.nobody_since is not None
            and now - self.nobody_since >= delay
        ):
            _LOGGER.info("Personne à la maison depuis %s : mode Absence", self.nobody_since)
            glob["mode"] = GLOBAL_ABSENCE
            glob["auto_absence_active"] = True
            self.save()
        elif home and glob["mode"] == GLOBAL_ABSENCE and glob.get("auto_absence_active"):
            _LOGGER.info("Retour à la maison : mode Auto")
            glob["mode"] = GLOBAL_AUTO
            glob["auto_absence_active"] = False
            self.save()

    def _handle_vacation_end(self, now: datetime) -> None:
        glob = self.glob
        end = _dt(glob.get("vacation_end"))
        if glob["mode"] == GLOBAL_VACATION and end and now >= end:
            _LOGGER.info("Fin des vacances : mode Auto")
            glob["mode"] = GLOBAL_AUTO
            glob["vacation_end"] = None
            self.save()

    # --- extérieur ---
    def outdoor_temp(self) -> float | None:
        """Température extérieure."""
        sensor = self.opt(CONF_OUTDOOR_SENSOR)
        if sensor and (state := self.hass.states.get(sensor)):
            if (value := _float(state.state)) is not None:
                return value
        weather = self.opt(CONF_WEATHER)
        if weather and (state := self.hass.states.get(weather)):
            return _float(state.attributes.get(ATTR_TEMPERATURE))
        return None

    def current_temp(self, zone: ZoneRuntime) -> float | None:
        """Température mesurée par le Koolnova."""
        state = self.hass.states.get(zone.climate_entity)
        if state is None:
            return None
        return _float(state.attributes.get("current_temperature"))

    # ------------------------------------------------------------------
    # Calcul + application
    # ------------------------------------------------------------------
    def global_settings(self) -> GlobalSettings:
        """Réglages globaux au format moteur."""
        g = self.glob
        return GlobalSettings(
            mode=g["mode"],
            absence_temp=float(g[G_ABSENCE_TEMP]),
            vacation_temp=float(g[G_VACATION_TEMP]),
            boost_temp=float(g[G_BOOST_TEMP]),
            vacation_end=_dt(g.get("vacation_end")),
            arrival_minutes=int(self.opt(CONF_ARRIVAL_MINUTES, DEFAULT_ARRIVAL_MINUTES)),
        )

    async def async_refresh(self, resync: bool = False) -> None:
        """Recalcule toutes les zones et applique."""
        now = dt_util.now()
        self._handle_vacation_end(now)
        self._handle_auto_absence(now)
        glob = self.global_settings()
        outdoor = self.outdoor_temp()
        for zone in self.zones.values():
            self._expire(zone, now)
            inputs = ZoneInputs(
                window_open=self.window_effective(zone, now),
                current_temp=self.current_temp(zone),
                outdoor_temp=outdoor,
            )
            result = compute(now, glob, zone.settings, inputs)
            zone.result = result
            zone.reason_text = describe(result, now)
            self._learn(zone, now, result)
            if result.reason == R_WINDOW:
                await self._notify_window(zone)
            if self.glob["engine"] and self.started:
                if resync:
                    zone.pending = None
                    zone.last_cmd = None
                    zone.failed_at = None
                await self._apply(zone, now)
            elif not self.glob["engine"]:
                zone.sync_status = "engine_off"
        async_dispatcher_send(self.hass, self.signal)

    def _expire(self, zone: ZoneRuntime, now: datetime) -> None:
        d = zone.data
        changed = False
        if (until := _dt(d.get("boost_until"))) and until <= now:
            d["boost_until"] = None
            d["boost_temp"] = None
            changed = True
        manual = d.get("manual")
        if manual and (until := _dt(manual.get("until"))) and until <= now:
            d["manual"] = None
            changed = True
        if changed:
            self.save()

    # --- apprentissage ---
    def _learn(self, zone: ZoneRuntime, now: datetime, result: Result) -> None:
        """Apprentissage de la vitesse de chauffe.

        Pendant chaque préchauffe, on mémorise la température de départ et l'extérieur.
        Au début de la plage visée, on compare avec la température atteinte :
        - la pièce a suivi la rampe (écart ≤ 0,25 °C) : elle sait chauffer au moins à la vitesse
          demandée, l'échantillon vaut vitesse × 1,1 (on sonde prudemment vers le haut) ;
        - sinon : l'échantillon est la vitesse réellement mesurée (montée / durée), ramenée à
          10 °C dehors.
        La vitesse retenue est la médiane des 7 derniers échantillons : une mauvaise journée
        (fenêtre ouverte, Koolnova qui n'a pas suivi…) ne la fait plus chuter.
        """
        d = zone.data
        s = zone.settings
        run = d.get("preheat_run")
        current = active_slot(s.planning, now)
        in_heat = current is not None and slot_temp(current[2], s) > s.eco
        measured = self.current_temp(zone)
        outdoor = self.outdoor_temp()
        changed = False

        # 1) Début d'une plage chaude : on termine la mesure
        if in_heat:
            start, _end, slot = current  # type: ignore[misc]
            key = start.isoformat()
            if d.get("last_slot_key") != key:
                d["last_slot_key"] = key
                changed = True
                if run and abs((start - _dt(run["target_at"])).total_seconds()) <= 120:
                    self._finish_run(zone, run, slot_temp(slot, s), measured, start, now)
                d["preheat_run"] = run = None

        # 2) Préchauffe en cours : on démarre ou on suit la mesure
        if result.reason in PREHEAT_REASONS and result.preheat_at is not None:
            if run is None or run.get("target_at") != result.preheat_at.isoformat():
                if measured is not None:
                    d["preheat_run"] = run = {
                        "start": now.isoformat(),
                        "start_temp": measured,
                        "target_at": result.preheat_at.isoformat(),
                        "out_sum": outdoor or 0.0,
                        "out_n": 1 if outdoor is not None else 0,
                        "valid": True,
                        "asked_speed": s.speed,
                    }
                    changed = True
            else:
                if outdoor is not None:
                    run["out_sum"] += outdoor
                    run["out_n"] += 1
                if zone.window_open_since is not None or zone.sync_status in ("failed", "unavailable"):
                    run["valid"] = False
                changed = True
        elif run is not None and not in_heat:
            # préchauffe interrompue (boost, manuel, fenêtre, changement de mode…)
            if result.reason not in (R_PLANNING, R_ABSENCE_ARRIVAL):
                d["preheat_run"] = None
                changed = True
        if changed:
            self.save()

    def _finish_run(
        self, zone: ZoneRuntime, run: dict[str, Any], target: float,
        measured: float | None, slot_start: datetime, now: datetime,
    ) -> None:
        d = zone.data
        if measured is None or not run.get("valid") or now - slot_start > timedelta(minutes=10):
            return
        started = _dt(run["start"])
        hours = (slot_start - started).total_seconds() / 3600 if started else 0
        need = target - run["start_temp"]
        if hours < 0.75 or need < 1.0:
            return  # trop court ou rien à chauffer : pas d'information fiable
        out = run["out_sum"] / run["out_n"] if run.get("out_n") else None
        gap = target - measured
        old = float(d["speed"])
        if gap <= 0.25:
            sample = old * 1.1
            method = "suivie"
        else:
            rate = max(0.0, measured - run["start_temp"]) / hours
            sample = rate * (1 + EXT_FACTOR * max(0.0, EXT_REF_TEMP - out)) if out is not None else rate
            method = "mesurée"
        sample = round(min(SPEED_MAX, max(SPEED_MIN, sample)), 2)
        samples = [*(d.get("speed_samples") or []), sample][-10:]
        d["speed_samples"] = samples
        recent = sorted(samples[-7:])
        if len(recent) >= 3:
            mid = len(recent) // 2
            new = recent[mid] if len(recent) % 2 else (recent[mid - 1] + recent[mid]) / 2
        else:
            new = old * 0.6 + sample * 0.4
        new = round(min(SPEED_MAX, max(SPEED_MIN, new)), 2)
        d["speed"] = new
        d["last_learning"] = {
            "at": now.isoformat(),
            "target": target,
            "measured": measured,
            "gap": round(gap, 2),
            "start_temp": run["start_temp"],
            "hours": round(hours, 2),
            "outdoor": round(out, 1) if out is not None else None,
            "method": method,
            "sample": sample,
            "samples": len(samples),
            "old_speed": old,
            "new_speed": new,
        }
        _LOGGER.info(
            "%s : %.1f → %.1f °C en %.1f h (objectif %.1f, %s) → échantillon %.2f, vitesse %.2f → %.2f °C/h",
            zone.name, run["start_temp"], measured, hours, target, method, sample, old, new,
        )

    # --- application au Koolnova ---
    def _desired(self, zone: ZoneRuntime, state) -> float | None:
        target = zone.result.target if zone.result else None
        if target is None:
            return None
        step = _float(state.attributes.get("target_temp_step")) or 0.5
        lo = _float(state.attributes.get("min_temp"))
        hi = _float(state.attributes.get("max_temp"))
        value = round(round(target / step) * step, 2)
        if lo is not None:
            value = max(lo, value)
        if hi is not None:
            value = min(hi, value)
        return value

    async def _apply(self, zone: ZoneRuntime, now: datetime) -> None:
        state = self.hass.states.get(zone.climate_entity)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            zone.sync_status = "unavailable"
            return
        desired = self._desired(zone, state)
        is_off = state.state == HVACMode.OFF
        cur = _float(state.attributes.get(ATTR_TEMPERATURE))
        matches = is_off if desired is None else (not is_off and cur == desired)
        verify = timedelta(minutes=int(self.opt(CONF_VERIFY_DELAY, DEFAULT_VERIFY_DELAY)))
        pending = zone.pending

        if pending is not None and pending.target != desired:
            pending = zone.pending = None  # nouvelle consigne : on oublie l'ancienne

        if matches:
            if pending is None or now - pending.sent_at >= verify:
                zone.pending = None
                zone.sync_status = "ok"
                zone.failed_at = None
            else:
                zone.sync_status = "verifying"
            return

        if pending is not None:
            if now - pending.sent_at < verify:
                zone.sync_status = "pending"
                return
            if pending.attempts >= int(self.opt(CONF_MAX_RETRIES, DEFAULT_MAX_RETRIES)):
                zone.pending = None
                zone.failed_target = desired
                zone.failed_at = now
                zone.sync_status = "failed"
                await self._notify(
                    "Chauffage",
                    f"⚠️ {zone.name} : la consigne {_label(desired)} n'a pas été prise "
                    f"par le Koolnova après {pending.attempts} essais.",
                )
                return
            await self._send(zone, desired, state, now, attempts=pending.attempts + 1)
            return

        if (
            zone.failed_at is not None
            and zone.failed_target == desired
            and now - zone.failed_at < timedelta(minutes=RETRY_AFTER_FAILURE_MIN)
        ):
            zone.sync_status = "failed"
            return
        if zone.last_cmd and zone.last_cmd.target == desired and now - zone.last_cmd.sent_at < timedelta(seconds=20):
            return
        await self._send(zone, desired, state, now, attempts=1)

    async def _send(self, zone: ZoneRuntime, desired: float | None, state, now: datetime, attempts: int) -> None:
        context = Context()
        zone.our_contexts = [*zone.our_contexts[-9:], context.id]
        cmd = Command(
            target=desired,
            prev_off=state.state == HVACMode.OFF,
            prev_temp=_float(state.attributes.get(ATTR_TEMPERATURE)),
            sent_at=now,
            attempts=attempts,
        )
        zone.pending = cmd
        zone.last_cmd = cmd
        zone.sync_status = "pending"
        _LOGGER.debug("%s → %s (essai %s)", zone.climate_entity, desired, attempts)
        try:
            if desired is None:
                await self.hass.services.async_call(
                    CLIMATE_DOMAIN,
                    SERVICE_TURN_OFF,
                    {ATTR_ENTITY_ID: zone.climate_entity},
                    blocking=True,
                    context=context,
                )
            else:
                if state.state != HVACMode.HEAT:
                    # Le Koolnova ignore hvac_mode passé avec la consigne : on l'allume d'abord
                    await self.hass.services.async_call(
                        CLIMATE_DOMAIN,
                        SERVICE_SET_HVAC_MODE,
                        {ATTR_ENTITY_ID: zone.climate_entity, ATTR_HVAC_MODE: HVACMode.HEAT},
                        blocking=True,
                        context=context,
                    )
                current = self.hass.states.get(zone.climate_entity)
                if current is None or _float(current.attributes.get(ATTR_TEMPERATURE)) != desired:
                    await self.hass.services.async_call(
                        CLIMATE_DOMAIN,
                        SERVICE_SET_TEMPERATURE,
                        {ATTR_ENTITY_ID: zone.climate_entity, ATTR_TEMPERATURE: desired},
                        blocking=True,
                        context=context,
                    )
        except Exception as err:  # noqa: BLE001 - un Koolnova injoignable ne doit rien casser
            _LOGGER.warning("Envoi impossible vers %s : %s", zone.climate_entity, err)

    @callback
    def _on_climate_change(self, zone: ZoneRuntime, event: Event) -> None:
        """Détecte un réglage fait directement sur le Koolnova (thermostat mural, appli)."""
        old = event.data.get("old_state")
        new = event.data.get("new_state")
        if old is None or new is None or event.context.id in zone.our_contexts:
            return
        if STATE_UNAVAILABLE in (old.state, new.state) or STATE_UNKNOWN in (old.state, new.state):
            return
        new_off = new.state == HVACMode.OFF
        new_temp = _float(new.attributes.get(ATTR_TEMPERATURE))
        old_temp = _float(old.attributes.get(ATTR_TEMPERATURE))
        if (old.state == HVACMode.OFF) == new_off and old_temp == new_temp:
            return
        if not zone.follow_external or not self.glob["engine"] or not self.started:
            return
        now = dt_util.now()
        cmd = zone.last_cmd
        if cmd is not None:
            # Le Koolnova confirme notre consigne (avec retard)
            if (cmd.target is None and new_off) or (cmd.target is not None and not new_off and new_temp == cmd.target):
                return
            # Le Koolnova revient à l'ancienne valeur : défaut connu, on renverra
            if now - cmd.sent_at < timedelta(minutes=REVERT_WINDOW_MIN) and (
                (cmd.prev_off and new_off) or (not cmd.prev_off and not new_off and new_temp == cmd.prev_temp)
            ):
                return
        if zone.result is not None:
            target = zone.result.target
            if (target is None and new_off) or (target is not None and not new_off and new_temp == target):
                return
        _LOGGER.info(
            "%s modifié directement (%s) : pris comme réglage manuel",
            zone.climate_entity, "arrêt" if new_off else new_temp,
        )
        self._set_manual(zone, None if new_off else new_temp, now)

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------
    async def _notify(self, title: str, message: str) -> None:
        targets = self.opt(CONF_NOTIFY) or []
        if not targets:
            return
        try:
            await self.hass.services.async_call(
                "notify",
                "send_message",
                {ATTR_ENTITY_ID: targets, "title": title, "message": message},
                blocking=False,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Notification impossible : %s", err)

    async def _notify_window(self, zone: ZoneRuntime) -> None:
        if zone.window_notified or not self.opt(CONF_NOTIFY_WINDOWS, True):
            return
        zone.window_notified = True
        await self._notify("Chauffage", f"🪟 {zone.name} : fenêtre ouverte, chauffage coupé.")

    # ------------------------------------------------------------------
    # Actions (appelées par les entités, services et la carte)
    # ------------------------------------------------------------------
    def _set_manual(self, zone: ZoneRuntime, temp: float | None, now: datetime) -> None:
        s = zone.settings
        until = next_change(s.planning, now) if s.mode == ZONE_AUTO else None
        zone.data["manual"] = {"temp": temp, "off": temp is None, "until": _iso(until)}
        zone.data["boost_until"] = None
        zone.data["boost_temp"] = None
        self.save()

    async def async_set_manual(self, zone_id: str, temp: float | None) -> None:
        """Consigne manuelle jusqu'au prochain changement de planning."""
        self._set_manual(self.zones[zone_id], temp, dt_util.now())
        await self.async_refresh()

    async def async_resume(self, zone_id: str) -> None:
        """Reprend le planning (annule manuel et boost)."""
        d = self.zones[zone_id].data
        d["manual"] = None
        d["boost_until"] = None
        d["boost_temp"] = None
        self.save()
        await self.async_refresh()

    async def async_set_zone_mode(self, zone_id: str, mode: str) -> None:
        """Mode de la zone."""
        if mode not in ZONE_MODES:
            raise ValueError(mode)
        d = self.zones[zone_id].data
        d["mode"] = mode
        d["manual"] = None
        d["boost_until"] = None
        d["boost_temp"] = None
        self.save()
        await self.async_refresh()

    async def async_boost(self, zone_id: str, minutes: int | None = None, temp: float | None = None) -> None:
        """Lance un boost."""
        minutes = int(minutes or self.glob[G_BOOST_DURATION])
        d = self.zones[zone_id].data
        d["boost_until"] = (dt_util.now() + timedelta(minutes=minutes)).isoformat()
        d["boost_temp"] = temp
        d["manual"] = None
        self.save()
        await self.async_refresh()

    async def async_cancel_boost(self, zone_id: str) -> None:
        """Annule le boost."""
        d = self.zones[zone_id].data
        d["boost_until"] = None
        d["boost_temp"] = None
        self.save()
        await self.async_refresh()

    async def async_set_zone_values(self, zone_id: str, **values: Any) -> None:
        """Modifie eco / comfort / comfort_plus / speed / preheat."""
        d = self.zones[zone_id].data
        for key in ("eco", "comfort", "comfort_plus", "speed"):
            if values.get(key) is not None:
                d[key] = float(values[key])
        if values.get("preheat") is not None:
            d["preheat"] = bool(values["preheat"])
        self.save()
        await self.async_refresh()

    async def async_set_planning(self, zone_id: str, planning: Any) -> None:
        """Remplace le planning d'une zone (validé)."""
        zone = self.zones[zone_id]
        zone.data["planning"] = normalize_planning(planning)
        manual = zone.data.get("manual")
        if manual and manual.get("until"):
            manual["until"] = _iso(next_change(zone.data["planning"], dt_util.now()))
        self.save()
        await self.async_refresh()

    async def async_set_global(self, key: str, value: Any) -> None:
        """Modifie un réglage global."""
        glob = self.glob
        if key == "mode":
            if value not in GLOBAL_MODES:
                raise ValueError(value)
            glob["auto_absence_active"] = False
            if value != GLOBAL_VACATION:
                glob["vacation_end"] = None
        if key == "vacation_end":
            value = _iso(value) if isinstance(value, datetime) else value
        glob[key] = value
        self.save()
        await self.async_refresh(resync=key == "engine" and bool(value))

    # ------------------------------------------------------------------
    # Lecture pour les entités
    # ------------------------------------------------------------------
    def global_entities(self) -> dict[str, str]:
        """Identifiants des entités globales (pour la carte)."""
        from homeassistant.helpers import entity_registry as er  # noqa: PLC0415

        reg = er.async_get(self.hass)
        keys = {
            "global_mode": "select", "engine": "switch", "absence_auto": "switch",
            "presence": "binary_sensor", "outdoor_temp": "sensor", "vacation_end": "datetime",
            G_ABSENCE_TEMP: "number", G_VACATION_TEMP: "number", G_BOOST_TEMP: "number",
            G_BOOST_DURATION: "number",
        }
        result = {}
        for key, domain in keys.items():
            if eid := reg.async_get_entity_id(domain, DOMAIN, f"{self.entry.entry_id}_{key}"):
                result[key] = eid
        return result

    def zone_attributes(self, zone: ZoneRuntime) -> dict[str, Any]:
        """Attributs exposés sur l'entité climate (utilisés par la carte)."""
        s = zone.settings
        r = zone.result
        manual = zone.data.get("manual")
        now = dt_util.now()
        return {
            "zone_id": zone.subentry_id,
            "entry_id": self.entry.entry_id,
            "koolnova_entity": zone.climate_entity,
            "usage": zone.usage,
            "zone_mode": s.mode,
            "reason": r.reason if r else None,
            "reason_text": zone.reason_text,
            "eco": s.eco,
            "comfort": s.comfort,
            "comfort_plus": s.comfort_plus,
            "speed": s.speed,
            "preheat": s.preheat,
            "preheat_target": r.preheat_target if r else None,
            "preheat_at": _iso(r.preheat_at) if r else None,
            "slot_end": _iso(r.slot_end) if r else None,
            "next_change": _iso(next_change(s.planning, now)),
            "boost_until": zone.data.get("boost_until"),
            "manual": manual,
            "window_open": self._any_open(zone),
            "window_effective": self.window_effective(zone, now),
            "windows": zone.windows,
            "sync_status": zone.sync_status,
            "engine": self.glob["engine"],
            "global_mode": self.glob["mode"],
            "last_learning": zone.data.get("last_learning"),
            "speed_samples": zone.data.get("speed_samples") or [],
            "planning": s.planning,
            "outdoor_temp": self.outdoor_temp(),
            "vacation_end": self.glob.get("vacation_end"),
            "absence_temp": self.glob[G_ABSENCE_TEMP],
            "boost_temp": self.glob[G_BOOST_TEMP],
            "boost_duration": self.glob[G_BOOST_DURATION],
            "someone_home": self.someone_home(),
            "absence_auto": self.glob["absence_auto"],
            "global_entities": self.global_entities(),
        }


def _label(value: float | None) -> str:
    return "arrêt" if value is None else f"{value} °C"
