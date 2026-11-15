"""Écrans de configuration (intégration, options, pièces)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryFlow,
    OptionsFlow,
    SubentryFlowResult,
)
from homeassistant.core import callback
from homeassistant.data_entry_flow import section
from homeassistant.helpers import entity_registry as er, selector

from .const import (
    CONF_ABSENCE_DELAY,
    CONF_ARRIVAL_MINUTES,
    CONF_CLIMATE,
    CONF_COMFORT,
    CONF_COMFORT_PLUS,
    CONF_ECO,
    CONF_FOLLOW_EXTERNAL,
    CONF_MAX_RETRIES,
    CONF_NAME,
    CONF_NOTIFY,
    CONF_NOTIFY_WINDOWS,
    CONF_OUTDOOR_SENSOR,
    CONF_PRESENCE,
    CONF_SPEED,
    CONF_USAGE,
    CONF_VERIFY_DELAY,
    CONF_WEATHER,
    CONF_WINDOW_DELAY,
    CONF_WINDOWS,
    DEFAULT_ABSENCE_DELAY,
    DEFAULT_ARRIVAL_MINUTES,
    DEFAULT_COMFORT,
    DEFAULT_COMFORT_PLUS,
    DEFAULT_ECO,
    DEFAULT_MAX_RETRIES,
    DEFAULT_SPEED,
    DEFAULT_VERIFY_DELAY,
    DEFAULT_WINDOW_DELAY,
    DOMAIN,
    NAME,
    SUBENTRY_ZONE,
    USAGE_MAIN,
    USAGE_SECONDARY,
)

ADVANCED = "advanced"


def _minutes(minimum: int, maximum: int) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=minimum, max=maximum, step=1, unit_of_measurement="min",
            mode=selector.NumberSelectorMode.BOX,
        )
    )


def _temp() -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=7, max=30, step=0.5, unit_of_measurement="°C",
            mode=selector.NumberSelectorMode.BOX,
        )
    )


def _opt(key: str, defaults: dict[str, Any]) -> dict[str, Any]:
    """Valeur suggérée seulement si elle existe (champs optionnels vidables)."""
    if defaults.get(key) not in (None, "", []):
        return {"description": {"suggested_value": defaults[key]}}
    return {}


def global_schema(defaults: dict[str, Any]) -> vol.Schema:
    """Réglages généraux."""
    return vol.Schema(
        {
            vol.Optional(CONF_WEATHER, **_opt(CONF_WEATHER, defaults)): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="weather")
            ),
            vol.Optional(CONF_OUTDOOR_SENSOR, **_opt(CONF_OUTDOOR_SENSOR, defaults)): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="sensor", device_class="temperature")
            ),
            vol.Optional(CONF_PRESENCE, **_opt(CONF_PRESENCE, defaults)): selector.EntitySelector(
                selector.EntitySelectorConfig(
                    domain=["person", "device_tracker", "binary_sensor", "input_boolean"],
                    multiple=True,
                )
            ),
            vol.Required(
                CONF_ABSENCE_DELAY, default=defaults.get(CONF_ABSENCE_DELAY, DEFAULT_ABSENCE_DELAY)
            ): _minutes(0, 240),
            vol.Optional(CONF_NOTIFY, **_opt(CONF_NOTIFY, defaults)): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="notify", multiple=True)
            ),
            vol.Required(
                CONF_NOTIFY_WINDOWS, default=defaults.get(CONF_NOTIFY_WINDOWS, True)
            ): selector.BooleanSelector(),
            vol.Required(ADVANCED): section(
                vol.Schema(
                    {
                        vol.Required(
                            CONF_ARRIVAL_MINUTES,
                            default=defaults.get(CONF_ARRIVAL_MINUTES, DEFAULT_ARRIVAL_MINUTES),
                        ): _minutes(0, 240),
                        vol.Required(
                            CONF_VERIFY_DELAY,
                            default=defaults.get(CONF_VERIFY_DELAY, DEFAULT_VERIFY_DELAY),
                        ): _minutes(1, 60),
                        vol.Required(
                            CONF_MAX_RETRIES,
                            default=defaults.get(CONF_MAX_RETRIES, DEFAULT_MAX_RETRIES),
                        ): selector.NumberSelector(
                            selector.NumberSelectorConfig(min=1, max=10, step=1, mode=selector.NumberSelectorMode.BOX)
                        ),
                    }
                ),
                {"collapsed": True},
            ),
        }
    )


def _flatten(user_input: dict[str, Any]) -> dict[str, Any]:
    data = {k: v for k, v in user_input.items() if k != ADVANCED}
    data.update(user_input.get(ADVANCED) or {})
    for key in (CONF_ABSENCE_DELAY, CONF_ARRIVAL_MINUTES, CONF_VERIFY_DELAY, CONF_MAX_RETRIES):
        if key in data:
            data[key] = int(data[key])
    return data


class ChauffageConfigFlow(ConfigFlow, domain=DOMAIN):
    """Ajout de l'intégration."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Réglages généraux."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={}, options=_flatten(user_input))
        return self.async_show_form(step_id="user", data_schema=global_schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Bouton « Configurer »."""
        return ChauffageOptionsFlow()

    @classmethod
    @callback
    def async_get_supported_subentry_types(cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        """Bouton « Ajouter une pièce »."""
        return {SUBENTRY_ZONE: ZoneSubentryFlow}


class ChauffageOptionsFlow(OptionsFlow):
    """Modification des réglages généraux."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Formulaire."""
        if user_input is not None:
            return self.async_create_entry(data=_flatten(user_input))
        return self.async_show_form(step_id="init", data_schema=global_schema(dict(self.config_entry.options)))


def zone_schema(defaults: dict[str, Any], with_temps: bool) -> vol.Schema:
    """Formulaire d'une pièce."""
    fields: dict[Any, Any] = {
        vol.Required(CONF_NAME, default=defaults.get(CONF_NAME, "")): selector.TextSelector(),
        vol.Required(CONF_CLIMATE, **({"default": defaults[CONF_CLIMATE]} if defaults.get(CONF_CLIMATE) else {})): selector.EntitySelector(
            selector.EntitySelectorConfig(domain="climate")
        ),
        vol.Optional(CONF_WINDOWS, **_opt(CONF_WINDOWS, defaults)): selector.EntitySelector(
            selector.EntitySelectorConfig(domain=["binary_sensor", "input_boolean"], multiple=True)
        ),
        vol.Required(CONF_WINDOW_DELAY, default=defaults.get(CONF_WINDOW_DELAY, DEFAULT_WINDOW_DELAY)): _minutes(0, 60),
        vol.Required(CONF_USAGE, default=defaults.get(CONF_USAGE, USAGE_MAIN)): selector.SelectSelector(
            selector.SelectSelectorConfig(
                options=[USAGE_MAIN, USAGE_SECONDARY],
                translation_key=CONF_USAGE,
                mode=selector.SelectSelectorMode.LIST,
            )
        ),
        vol.Required(CONF_FOLLOW_EXTERNAL, default=defaults.get(CONF_FOLLOW_EXTERNAL, True)): selector.BooleanSelector(),
    }
    if with_temps:
        fields.update(
            {
                vol.Required(CONF_ECO, default=DEFAULT_ECO): _temp(),
                vol.Required(CONF_COMFORT, default=DEFAULT_COMFORT): _temp(),
                vol.Required(CONF_COMFORT_PLUS, default=DEFAULT_COMFORT_PLUS): _temp(),
                vol.Required(CONF_SPEED, default=DEFAULT_SPEED): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=0.5, max=5, step=0.1, unit_of_measurement="°C/h",
                        mode=selector.NumberSelectorMode.BOX,
                    )
                ),
            }
        )
    return vol.Schema(fields)


class ZoneSubentryFlow(ConfigSubentryFlow):
    """Ajout / modification d'une pièce."""

    def _validate(self, user_input: dict[str, Any], current_id: str | None) -> dict[str, str]:
        errors: dict[str, str] = {}
        climate = user_input[CONF_CLIMATE]
        ent = er.async_get(self.hass).async_get(climate)
        if ent is not None and ent.platform == DOMAIN:
            errors[CONF_CLIMATE] = "own_entity"
        for sub in self._get_entry().subentries.values():
            if sub.subentry_id != current_id and sub.data.get(CONF_CLIMATE) == climate:
                errors[CONF_CLIMATE] = "already_used"
        if not user_input.get(CONF_NAME, "").strip():
            errors[CONF_NAME] = "name_required"
        return errors

    @staticmethod
    def _clean(user_input: dict[str, Any]) -> dict[str, Any]:
        data = dict(user_input)
        data[CONF_NAME] = data[CONF_NAME].strip()
        data[CONF_WINDOW_DELAY] = int(data[CONF_WINDOW_DELAY])
        data.setdefault(CONF_WINDOWS, [])
        return data

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        """Nouvelle pièce."""
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = self._validate(user_input, None)
            if not errors:
                data = self._clean(user_input)
                return self.async_create_entry(title=data[CONF_NAME], data=data, unique_id=data[CONF_CLIMATE])
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(zone_schema({}, True), user_input or {}),
            errors=errors,
        )

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        """Modifier une pièce."""
        subentry = self._get_reconfigure_subentry()
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = self._validate(user_input, subentry.subentry_id)
            if not errors:
                data = {**subentry.data, **self._clean(user_input)}
                return self.async_update_and_abort(
                    self._get_entry(), subentry, title=data[CONF_NAME], data=data, unique_id=data[CONF_CLIMATE]
                )
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=zone_schema(dict(subentry.data), False),
            errors=errors,
        )
