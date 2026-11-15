"""Consignes réglables."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.const import EntityCategory, UnitOfTemperature, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import ChauffageConfigEntry
from .const import G_ABSENCE_TEMP, G_BOOST_DURATION, G_BOOST_TEMP, G_VACATION_TEMP
from .entity import GlobalEntity, ZoneEntity

TEMP = {"min": 7.0, "max": 30.0, "step": 0.5, "unit": UnitOfTemperature.CELSIUS}
GLOBAL_NUMBERS = {
    G_ABSENCE_TEMP: TEMP,
    G_VACATION_TEMP: TEMP,
    G_BOOST_TEMP: TEMP,
    G_BOOST_DURATION: {"min": 5, "max": 480, "step": 5, "unit": UnitOfTime.MINUTES},
}
ZONE_NUMBERS = {
    "eco": TEMP,
    "comfort": TEMP,
    "comfort_plus": TEMP,
    "speed": {"min": 0.5, "max": 5.0, "step": 0.1, "unit": "°C/h"},
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ChauffageConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Nombres."""
    manager = entry.runtime_data
    async_add_entities([GlobalNumber(manager, k, c) for k, c in GLOBAL_NUMBERS.items()])
    for zone in manager.zones.values():
        async_add_entities(
            [ZoneNumber(manager, zone, k, c) for k, c in ZONE_NUMBERS.items()],
            config_subentry_id=zone.subentry_id,
        )


def _setup(entity, conf) -> None:
    entity._attr_native_min_value = conf["min"]
    entity._attr_native_max_value = conf["max"]
    entity._attr_native_step = conf["step"]
    entity._attr_native_unit_of_measurement = conf["unit"]
    entity._attr_mode = NumberMode.BOX


class GlobalNumber(GlobalEntity, NumberEntity):
    """Réglage global."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, manager, key: str, conf) -> None:
        """Init."""
        super().__init__(manager, key)
        self._key = key
        _setup(self, conf)

    @property
    def native_value(self) -> float:
        """Valeur."""
        return self.manager.glob[self._key]

    async def async_set_native_value(self, value: float) -> None:
        """Modifier."""
        await self.manager.async_set_global(
            self._key, int(value) if self._key == G_BOOST_DURATION else float(value)
        )


class ZoneNumber(ZoneEntity, NumberEntity):
    """Consigne ou vitesse d'une pièce."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, manager, zone, key: str, conf) -> None:
        """Init."""
        super().__init__(manager, zone, key)
        self._key = key
        _setup(self, conf)

    @property
    def native_value(self) -> float:
        """Valeur."""
        return self.zone.data[self._key]

    async def async_set_native_value(self, value: float) -> None:
        """Modifier."""
        await self.manager.async_set_zone_values(self.zone.subentry_id, **{self._key: value})
