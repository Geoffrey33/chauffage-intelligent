"""Modes (maison et pièces)."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import ChauffageConfigEntry
from .const import GLOBAL_MODES, ZONE_MODES
from .entity import GlobalEntity, ZoneEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ChauffageConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Sélecteurs."""
    manager = entry.runtime_data
    async_add_entities([GlobalModeSelect(manager)])
    for zone in manager.zones.values():
        async_add_entities([ZoneModeSelect(manager, zone)], config_subentry_id=zone.subentry_id)


class GlobalModeSelect(GlobalEntity, SelectEntity):
    """Mode de la maison."""

    _attr_options = GLOBAL_MODES

    def __init__(self, manager) -> None:
        """Init."""
        super().__init__(manager, "global_mode")

    @property
    def current_option(self) -> str:
        """Mode actuel."""
        return self.manager.glob["mode"]

    async def async_select_option(self, option: str) -> None:
        """Changer."""
        await self.manager.async_set_global("mode", option)


class ZoneModeSelect(ZoneEntity, SelectEntity):
    """Mode de la pièce."""

    _attr_options = ZONE_MODES

    def __init__(self, manager, zone) -> None:
        """Init."""
        super().__init__(manager, zone, "zone_mode")

    @property
    def current_option(self) -> str:
        """Mode actuel."""
        return self.zone.data["mode"]

    async def async_select_option(self, option: str) -> None:
        """Changer."""
        await self.manager.async_set_zone_mode(self.zone.subentry_id, option)
