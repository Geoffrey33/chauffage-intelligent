"""Bases communes des entités."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, NAME, VERSION
from .manager import Manager, ZoneRuntime


class BaseEntity(Entity):
    """Entité mise à jour par le moteur."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, manager: Manager) -> None:
        """Init."""
        self.manager = manager

    async def async_added_to_hass(self) -> None:
        """Abonnement aux mises à jour."""
        self.async_on_remove(
            async_dispatcher_connect(self.hass, self.manager.signal, self.async_write_ha_state)
        )


class GlobalEntity(BaseEntity):
    """Entité de l'appareil « Chauffage intelligent »."""

    def __init__(self, manager: Manager, key: str) -> None:
        """Init."""
        super().__init__(manager)
        entry_id = manager.entry.entry_id
        self._attr_unique_id = f"{entry_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry_id)},
            name=NAME,
            manufacturer="Geoffrey Pronier",
            model="Gestion du chauffage",
            sw_version=VERSION,
        )


class ZoneEntity(BaseEntity):
    """Entité d'une pièce."""

    def __init__(self, manager: Manager, zone: ZoneRuntime, key: str) -> None:
        """Init."""
        super().__init__(manager)
        self.zone = zone
        self._attr_unique_id = f"{zone.subentry_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, zone.subentry_id)},
            name=zone.name,
            manufacturer="Geoffrey Pronier",
            model="Pièce",
            sw_version=VERSION,
        )

    @property
    def available(self) -> bool:
        """Toujours disponible : le moteur reste pilotable même si le Koolnova ne répond pas."""
        return True
