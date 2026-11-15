"""Thermostat de chaque pièce."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components.climate import (
    ATTR_HVAC_MODE,
    ClimateEntity,
    ClimateEntityFeature,
    HVACAction,
    HVACMode,
)
from homeassistant.const import ATTR_TEMPERATURE, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_platform
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import ChauffageConfigEntry
from .const import DOMAIN, FORCED_MODES, R_BOOST, ZONE_AUTO, ZONE_COMFORT, ZONE_OFF
from .engine import PlanningError
from .entity import ZoneEntity

PRESETS = ["eco", "comfort", "comfort_plus", "boost"]
_NATIVE = hasattr(ClimateEntity, "native_target_temperature")


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ChauffageConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Un thermostat par pièce + services."""
    manager = entry.runtime_data
    for zone in manager.zones.values():
        async_add_entities([ZoneClimate(manager, zone)], config_subentry_id=zone.subentry_id)

    platform = entity_platform.async_get_current_platform()
    temp = vol.All(vol.Coerce(float), vol.Range(min=7, max=30))
    platform.async_register_entity_service(
        "set_planning", {vol.Required("planning"): dict}, "async_service_set_planning"
    )
    platform.async_register_entity_service(
        "boost",
        {
            vol.Optional("duration"): vol.All(vol.Coerce(int), vol.Range(min=1, max=1440)),
            vol.Optional("temperature"): temp,
        },
        "async_service_boost",
    )
    platform.async_register_entity_service("cancel_boost", None, "async_service_cancel_boost")
    platform.async_register_entity_service("resume", None, "async_service_resume")
    platform.async_register_entity_service(
        "set_zone_settings",
        {
            vol.Optional("eco"): temp,
            vol.Optional("comfort"): temp,
            vol.Optional("comfort_plus"): temp,
            vol.Optional("speed"): vol.All(vol.Coerce(float), vol.Range(min=0.5, max=5)),
            vol.Optional("preheat"): cv.boolean,
        },
        "async_service_set_zone_settings",
    )
    platform.async_register_entity_service(
        "set_zone_mode",
        {vol.Required("mode"): vol.In(["auto", "eco", "comfort", "comfort_plus", "off"])},
        "async_service_set_zone_mode",
    )


class ZoneClimate(ZoneEntity, ClimateEntity):
    """Thermostat virtuel d'une pièce."""

    _attr_name = None
    _attr_hvac_modes = [HVACMode.AUTO, HVACMode.HEAT, HVACMode.OFF]
    _attr_preset_modes = PRESETS
    _attr_target_temperature_step = 0.5
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE
        | ClimateEntityFeature.PRESET_MODE
        | ClimateEntityFeature.TURN_ON
        | ClimateEntityFeature.TURN_OFF
    )
    _unrecorded_attributes = frozenset(
        {"planning", "last_learning", "windows", "manual", "koolnova_entity", "zone_id", "entry_id", "global_entities", "speed_samples"}
    )

    def __init__(self, manager, zone) -> None:
        """Init."""
        super().__init__(manager, zone, "zone")

    def _koolnova_attr(self, key: str, default: float) -> float:
        state = self.hass.states.get(self.zone.climate_entity) if self.hass else None
        try:
            return float(state.attributes[key]) if state else default
        except (KeyError, TypeError, ValueError):
            return default

    @property
    def min_temp(self) -> float:
        """Minimum du Koolnova."""
        return self._koolnova_attr("min_temp", 7.0)

    @property
    def max_temp(self) -> float:
        """Maximum du Koolnova."""
        return self._koolnova_attr("max_temp", 30.0)

    def _current(self) -> float | None:
        return self.manager.current_temp(self.zone)

    def _target(self) -> float | None:
        return self.zone.result.target if self.zone.result else None

    # HA 2026.11+ : propriétés « native_* » ; versions antérieures : noms historiques
    if _NATIVE:
        _attr_native_temperature_unit = UnitOfTemperature.CELSIUS

        @property
        def native_current_temperature(self) -> float | None:
            """Température mesurée par le Koolnova."""
            return self._current()

        @property
        def native_target_temperature(self) -> float | None:
            """Consigne calculée."""
            return self._target()
    else:
        _attr_temperature_unit = UnitOfTemperature.CELSIUS

        @property
        def current_temperature(self) -> float | None:
            """Température mesurée par le Koolnova."""
            return self._current()

        @property
        def target_temperature(self) -> float | None:
            """Consigne calculée."""
            return self._target()

    @property
    def hvac_mode(self) -> HVACMode:
        """Auto = suit le planning, Chauffe = mode forcé, Arrêt."""
        mode = self.zone.data["mode"]
        if mode == ZONE_OFF:
            return HVACMode.OFF
        if mode in FORCED_MODES:
            return HVACMode.HEAT
        return HVACMode.AUTO

    @property
    def hvac_action(self) -> HVACAction:
        """Chauffe en cours ?"""
        target = self._target()
        current = self._current()
        if target is None:
            return HVACAction.OFF
        if current is not None and current < target:
            return HVACAction.HEATING
        return HVACAction.IDLE

    @property
    def preset_mode(self) -> str | None:
        """Préréglage effectif."""
        result = self.zone.result
        if result and result.reason == R_BOOST:
            return "boost"
        mode = self.zone.data["mode"]
        if mode in FORCED_MODES:
            return mode
        if result and result.preset in PRESETS:
            return result.preset
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Attributs pour la carte."""
        return self.manager.zone_attributes(self.zone)

    # --- commandes standard ---
    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        """Changer de mode."""
        if hvac_mode == HVACMode.OFF:
            mode = ZONE_OFF
        elif hvac_mode == HVACMode.HEAT:
            current = self.zone.data["mode"]
            mode = current if current in FORCED_MODES else ZONE_COMFORT
        else:
            mode = ZONE_AUTO
        await self.manager.async_set_zone_mode(self.zone.subentry_id, mode)

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Préréglage : force la pièce, ou lance le boost."""
        if preset_mode == "boost":
            await self.manager.async_boost(self.zone.subentry_id)
        else:
            await self.manager.async_set_zone_mode(self.zone.subentry_id, preset_mode)

    async def async_set_temperature(self, **kwargs: Any) -> None:
        """Consigne manuelle (jusqu'au prochain changement du planning)."""
        if (hvac_mode := kwargs.get(ATTR_HVAC_MODE)) is not None:
            if hvac_mode == HVACMode.OFF:
                await self.async_set_hvac_mode(HVACMode.OFF)
                return
            if self.zone.data["mode"] == ZONE_OFF:
                await self.manager.async_set_zone_mode(self.zone.subentry_id, ZONE_AUTO)
        temp = kwargs.get(ATTR_TEMPERATURE, kwargs.get("native_temperature"))
        if temp is not None:
            await self.manager.async_set_manual(self.zone.subentry_id, float(temp))

    async def async_turn_on(self) -> None:
        """Remet la pièce en Auto."""
        await self.manager.async_set_zone_mode(self.zone.subentry_id, ZONE_AUTO)

    async def async_turn_off(self) -> None:
        """Arrête la pièce."""
        await self.manager.async_set_zone_mode(self.zone.subentry_id, ZONE_OFF)

    # --- services de l'intégration ---
    async def async_service_set_planning(self, planning: dict) -> None:
        """Remplace le planning."""
        try:
            await self.manager.async_set_planning(self.zone.subentry_id, planning)
        except PlanningError as err:
            raise ServiceValidationError(
                str(err), translation_domain=DOMAIN, translation_key="invalid_planning",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_service_boost(self, duration: int | None = None, temperature: float | None = None) -> None:
        """Boost."""
        await self.manager.async_boost(self.zone.subentry_id, duration, temperature)

    async def async_service_cancel_boost(self) -> None:
        """Fin du boost."""
        await self.manager.async_cancel_boost(self.zone.subentry_id)

    async def async_service_resume(self) -> None:
        """Reprendre le planning."""
        await self.manager.async_resume(self.zone.subentry_id)

    async def async_service_set_zone_settings(self, **values: Any) -> None:
        """Consignes et vitesse."""
        await self.manager.async_set_zone_values(self.zone.subentry_id, **values)

    async def async_service_set_zone_mode(self, mode: str) -> None:
        """Mode."""
        await self.manager.async_set_zone_mode(self.zone.subentry_id, mode)
