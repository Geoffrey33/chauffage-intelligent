"""Chauffage intelligent : gestion multizone d'une PAC (Koolnova) avec plannings et préchauffe."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from .const import CARD_FILE, DOMAIN, FRONTEND_URL, PLATFORMS, STORAGE_VERSION, VERSION
from .manager import Manager

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type ChauffageConfigEntry = ConfigEntry[Manager]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> None | bool:
    """Enregistre la carte Lovelace embarquée."""
    await _async_register_card(hass)
    return True


async def _async_register_card(hass: HomeAssistant) -> None:
    if getattr(hass, "http", None) is None:
        return
    try:
        from homeassistant.components.frontend import add_extra_js_url  # noqa: PLC0415
        from homeassistant.components.http import StaticPathConfig  # noqa: PLC0415

        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL, str(Path(__file__).parent / "frontend"), False)]
        )
        add_extra_js_url(hass, f"{FRONTEND_URL}/{CARD_FILE}?v={VERSION}")
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Carte Chauffage intelligent non enregistrée : %s", err)


async def async_setup_entry(hass: HomeAssistant, entry: ChauffageConfigEntry) -> bool:
    """Démarre l'intégration."""
    manager = Manager(hass, entry)
    await manager.async_load()
    entry.runtime_data = manager
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await manager.async_start()
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: ChauffageConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ChauffageConfigEntry) -> bool:
    """Arrête l'intégration."""
    manager = entry.runtime_data
    manager.async_stop()
    await manager.store.async_save(manager.data)
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Supprime les données stockées."""
    await Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}").async_remove()
