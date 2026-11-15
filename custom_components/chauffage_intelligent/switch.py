"""Interrupteurs : moteur, absence automatique, préchauffe par pièce."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import ChauffageConfigEntry
from .entity import GlobalEntity, ZoneEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ChauffageConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Interrupteurs."""
    manager = entry.runtime_data
    async_add_entities([GlobalSwitch(manager, "engine"), GlobalSwitch(manager, "absence_auto")])
    for zone in manager.zones.values():
        async_add_entities([PreheatSwitch(manager, zone)], config_subentry_id=zone.subentry_id)


class GlobalSwitch(GlobalEntity, SwitchEntity):
    """Réglage global on/off."""

    def __init__(self, manager, key: str) -> None:
        """Init."""
        super().__init__(manager, key)
        self._key = key

    @property
    def is_on(self) -> bool:
        """État."""
        return bool(self.manager.glob[self._key])

    async def async_turn_on(self, **kwargs: Any) -> None:
        """On."""
        await self.manager.async_set_global(self._key, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Off."""
        await self.manager.async_set_global(self._key, False)


class PreheatSwitch(ZoneEntity, SwitchEntity):
    """Préchauffe (anticipation) d'une pièce."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, manager, zone) -> None:
        """Init."""
        super().__init__(manager, zone, "preheat")

    @property
    def is_on(self) -> bool:
        """État."""
        return bool(self.zone.data.get("preheat", True))

    async def async_turn_on(self, **kwargs: Any) -> None:
        """On."""
        await self.manager.async_set_zone_values(self.zone.subentry_id, preheat=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Off."""
        await self.manager.async_set_zone_values(self.zone.subentry_id, preheat=False)
