"""Date de retour de vacances."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.datetime import DateTimeEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import ChauffageConfigEntry
from .entity import GlobalEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ChauffageConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Date de retour."""
    async_add_entities([VacationEnd(entry.runtime_data)])


class VacationEnd(GlobalEntity, DateTimeEntity):
    """Fin des vacances : la maison repasse en Auto et préchauffe pour le retour."""

    def __init__(self, manager) -> None:
        """Init."""
        super().__init__(manager, "vacation_end")

    @property
    def native_value(self) -> datetime | None:
        """Date."""
        value = self.manager.glob.get("vacation_end")
        return dt_util.parse_datetime(value) if value else None

    async def async_set_value(self, value: datetime) -> None:
        """Modifier."""
        await self.manager.async_set_global("vacation_end", value)
