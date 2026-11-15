"""Présence et fenêtres."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import ChauffageConfigEntry
from .entity import GlobalEntity, ZoneEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ChauffageConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Capteurs binaires."""
    manager = entry.runtime_data
    async_add_entities([PresenceSensor(manager)])
    for zone in manager.zones.values():
        if zone.windows:
            async_add_entities([WindowSensor(manager, zone)], config_subentry_id=zone.subentry_id)


class PresenceSensor(GlobalEntity, BinarySensorEntity):
    """Quelqu'un à la maison."""

    _attr_device_class = BinarySensorDeviceClass.OCCUPANCY

    def __init__(self, manager) -> None:
        """Init."""
        super().__init__(manager, "presence")

    @property
    def is_on(self) -> bool | None:
        """Présence."""
        return self.manager.someone_home()


class WindowSensor(ZoneEntity, BinarySensorEntity):
    """Fenêtre ouverte assez longtemps pour couper le chauffage."""

    _attr_device_class = BinarySensorDeviceClass.WINDOW

    def __init__(self, manager, zone) -> None:
        """Init."""
        super().__init__(manager, zone, "window")

    @property
    def is_on(self) -> bool:
        """Coupure fenêtre active."""
        return self.manager.window_effective(self.zone, dt_util.now())
