"""Capteurs : statut, consigne, prochaine plage."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import ChauffageConfigEntry
from .engine import next_change
from .entity import GlobalEntity, ZoneEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ChauffageConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Capteurs."""
    manager = entry.runtime_data
    async_add_entities([OutdoorSensor(manager)])
    for zone in manager.zones.values():
        async_add_entities(
            [StatusSensor(manager, zone), TargetSensor(manager, zone), NextChangeSensor(manager, zone)],
            config_subentry_id=zone.subentry_id,
        )


class OutdoorSensor(GlobalEntity, SensorEntity):
    """Température extérieure utilisée pour la préchauffe."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, manager) -> None:
        """Init."""
        super().__init__(manager, "outdoor_temp")

    @property
    def native_value(self) -> float | None:
        """Valeur."""
        return self.manager.outdoor_temp()


class StatusSensor(ZoneEntity, SensorEntity):
    """Ce que fait la pièce et pourquoi."""

    def __init__(self, manager, zone) -> None:
        """Init."""
        super().__init__(manager, zone, "status")

    @property
    def native_value(self) -> str:
        """Texte."""
        return self.zone.reason_text or "—"

    @property
    def extra_state_attributes(self) -> dict:
        """Détail."""
        r = self.zone.result
        return {"reason": r.reason if r else None, "sync_status": self.zone.sync_status}


class TargetSensor(ZoneEntity, SensorEntity):
    """Consigne calculée (pour l'historique)."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, manager, zone) -> None:
        """Init."""
        super().__init__(manager, zone, "target")

    @property
    def native_value(self) -> float | None:
        """Consigne (vide si coupé)."""
        return self.zone.result.target if self.zone.result else None


class NextChangeSensor(ZoneEntity, SensorEntity):
    """Prochain changement de planning."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, manager, zone) -> None:
        """Init."""
        super().__init__(manager, zone, "next_change")

    @property
    def native_value(self) -> datetime | None:
        """Heure."""
        return next_change(self.zone.data.get("planning") or {}, dt_util.now())
