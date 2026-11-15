"""Boutons Boost et Reprendre le planning."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import ChauffageConfigEntry
from .entity import ZoneEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ChauffageConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Boutons."""
    manager = entry.runtime_data
    for zone in manager.zones.values():
        async_add_entities(
            [ZoneButton(manager, zone, "boost"), ZoneButton(manager, zone, "resume")],
            config_subentry_id=zone.subentry_id,
        )


class ZoneButton(ZoneEntity, ButtonEntity):
    """Bouton de pièce."""

    def __init__(self, manager, zone, key: str) -> None:
        """Init."""
        super().__init__(manager, zone, key)
        self._key = key

    async def async_press(self) -> None:
        """Appui."""
        if self._key == "boost":
            await self.manager.async_boost(self.zone.subentry_id)
        else:
            await self.manager.async_resume(self.zone.subentry_id)
