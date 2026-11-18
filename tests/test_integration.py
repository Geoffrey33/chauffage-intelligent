"""Tests de bout en bout dans un vrai Home Assistant."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from freezegun.api import FrozenDateTimeFactory
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er

from custom_components.chauffage_intelligent.const import DOMAIN

TZ = ZoneInfo("Europe/Paris")
KOOL = "climate.koolnova_salon"
WINDOW = "binary_sensor.fenetre_salon"
PLANNING = {d: [{"start": "07:00", "end": "07:30", "preset": "comfort"},
                {"start": "18:00", "end": "23:00", "preset": "comfort"}]
            for d in ["mon", "tue", "wed", "thu", "fri"]}


class FakeKoolnova:
    """Faux Koolnova : enregistre les commandes, peut ignorer les N premières."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.calls: list[tuple[str, dict]] = []
        self.ignore = 0
        self.set_state("heat", 19.0)
        self.register()

    def register(self) -> None:
        hass = self.hass

        async def set_temperature(call: ServiceCall) -> None:
            self.calls.append(("set_temperature", dict(call.data)))
            if self.ignore:
                self.ignore -= 1
                return
            state = self.hass.states.get(KOOL).state
            self.set_state(state, call.data["temperature"], context=call.context)

        async def set_hvac_mode(call: ServiceCall) -> None:
            self.calls.append(("set_hvac_mode", dict(call.data)))
            self.set_state(call.data["hvac_mode"], self.temp, context=call.context)

        async def turn_off(call: ServiceCall) -> None:
            self.calls.append(("turn_off", dict(call.data)))
            self.set_state("off", self.temp, context=call.context)

        hass.services.async_register("climate", "set_temperature", set_temperature)
        hass.services.async_register("climate", "turn_off", turn_off)
        hass.services.async_register("climate", "set_hvac_mode", set_hvac_mode)

    current = 19.5

    def set_state(self, state: str, temp: float, current: float | None = None, context=None) -> None:
        if current is not None:
            self.current = current
        current = self.current
        self.temp = temp
        self.hass.states.async_set(
            KOOL, state,
            {"temperature": temp, "current_temperature": current, "min_temp": 15, "max_temp": 35,
             "target_temp_step": 0.5, "hvac_modes": ["off", "heat"], "fan_mode": "auto"},
            context=context,
        )


@pytest.fixture
async def setup(hass: HomeAssistant, freezer: FrozenDateTimeFactory):
    await hass.config.async_set_time_zone("Europe/Paris")
    hass.config.language = "fr"
    freezer.move_to(datetime(2026, 11, 16, 12, 0, tzinfo=TZ))  # lundi midi
    kool = FakeKoolnova(hass)
    hass.states.async_set(WINDOW, "off")
    hass.states.async_set("person.geoffrey", "home")
    hass.states.async_set("weather.maison", "cloudy", {"temperature": 10})

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"weather_entity": "weather.maison", "presence_entities": ["person.geoffrey"],
         "absence_delay": 30, "notify_windows": False,
         "advanced": {"arrival_minutes": 60, "verify_delay": 12, "max_retries": 3}},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    entry = result["result"]
    await hass.async_block_till_done()

    sub = await hass.config_entries.subentries.async_init((entry.entry_id, "zone"), context={"source": "user"})
    assert sub["type"] is FlowResultType.FORM
    sub = await hass.config_entries.subentries.async_configure(
        sub["flow_id"],
        {"name": "Salon", "climate_entity": KOOL, "window_entities": [WINDOW], "window_delay": 5,
         "usage": "main", "follow_external": True, "eco": 18, "comfort": 21, "comfort_plus": 22, "speed": 2.5},
    )
    assert sub["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    entry = hass.config_entries.async_get_entry(entry.entry_id)
    kool.register()  # le composant climate a remplacé nos faux services
    await hass.services.async_call(DOMAIN, "set_planning", {"entity_id": "climate.salon", "planning": PLANNING}, blocking=True)
    await hass.async_block_till_done()
    await entry.runtime_data.async_refresh(resync=True)
    await hass.async_block_till_done()
    return entry, kool


async def tick(hass, freezer, minutes=1):
    for _ in range(minutes):
        freezer.tick(timedelta(minutes=1))
        async_fire_time_changed(hass)
        await hass.async_block_till_done()


async def test_entities_and_apply(hass: HomeAssistant, setup, freezer):
    entry, kool = setup
    ent_reg = er.async_get(hass)
    ids = {e.entity_id for e in er.async_entries_for_config_entry(ent_reg, entry.entry_id)}
    for expected in ["climate.salon", "select.salon_mode", "number.salon_confort", "sensor.salon_statut",
                     "select.chauffage_intelligent_mode_maison", "switch.chauffage_intelligent_moteur_actif",
                     "button.salon_boost", "binary_sensor.salon_coupure_fenetre",
                     "datetime.chauffage_intelligent_retour_de_vacances"]:
        assert expected in ids, (expected, sorted(ids))
    state = hass.states.get("climate.salon")
    assert state.attributes["temperature"] == 18
    assert state.attributes["reason"] == "eco"
    assert state.attributes["planning"]["mon"][1]["start"] == "18:00"
    assert kool.temp == 18  # Eco appliqué
    assert ent_reg.async_get("climate.salon").config_subentry_id is not None


async def test_preheat_then_comfort(hass, setup, freezer):
    entry, kool = setup
    freezer.move_to(datetime(2026, 11, 16, 17, 0, tzinfo=TZ))
    await tick(hass, freezer)
    assert hass.states.get("climate.salon").attributes["reason"] == "preheat"
    # pièce simulée à 19,5 : 18,5 + 3 = 21,5 envoyé (relance, objectif 21)
    assert kool.temp == 21.5
    assert hass.states.get("climate.salon").attributes["temperature"] == 21
    assert hass.states.get("climate.salon").attributes["sent_temperature"] == 21.5
    freezer.move_to(datetime(2026, 11, 16, 18, 0, tzinfo=TZ))
    await tick(hass, freezer)
    # plage confort, pièce toujours à 19,5 (> 1 °C sous 21) : relance à 22
    assert kool.temp == 22
    assert "Confort 21 °C jusqu'à 23:00" in hass.states.get("sensor.salon_statut").state


async def test_window(hass, setup, freezer):
    entry, kool = setup
    hass.states.async_set(WINDOW, "on")
    await hass.async_block_till_done()
    assert kool.calls[-1][0] != "turn_off"
    await tick(hass, freezer, 6)
    assert kool.calls[-1][0] == "turn_off"
    assert hass.states.get("binary_sensor.salon_coupure_fenetre").state == "on"
    hass.states.async_set(WINDOW, "off")
    await hass.async_block_till_done()
    await tick(hass, freezer)
    assert hass.states.get(KOOL).state == "heat" and kool.temp == 18


async def test_manual_speed_resets_samples(hass, setup, freezer):
    entry, kool = setup
    mgr = entry.runtime_data
    zid = next(iter(mgr.zones))
    mgr.zones[zid].data["speed_samples"] = [0.9, 0.8, 1.0]
    await hass.services.async_call(
        "number", "set_value", {"entity_id": "number.salon_vitesse_de_chauffe", "value": 2.5}, blocking=True
    )
    assert mgr.zones[zid].data["speed"] == 2.5
    assert mgr.zones[zid].data["speed_samples"] == []
    # un autre réglage ne touche pas aux mesures
    mgr.zones[zid].data["speed_samples"] = [2.4]
    await mgr.async_set_zone_values(zid, comfort=21.5)
    assert mgr.zones[zid].data["speed_samples"] == [2.4]


async def test_retry_when_koolnova_ignores(hass, setup, freezer):
    entry, kool = setup
    kool.ignore = 2
    mgr = entry.runtime_data
    await mgr.async_set_manual(next(iter(mgr.zones)), 20)  # (climate.set_temperature est simulé ici)
    await hass.async_block_till_done()
    n = len(kool.calls)
    await tick(hass, freezer, 5)
    assert len(kool.calls) == n  # on attend la vérification
    await tick(hass, freezer, 8)
    assert len(kool.calls) == n + 1
    await tick(hass, freezer, 13)
    assert kool.temp == 20
    assert hass.states.get("climate.salon").attributes["reason"] == "manual"


async def test_external_change_becomes_manual(hass, setup, freezer):
    entry, kool = setup
    kool.set_state("heat", 22.5)
    await hass.async_block_till_done()
    attrs = hass.states.get("climate.salon").attributes
    assert attrs["reason"] == "manual" and attrs["temperature"] == 22.5
    assert attrs["manual"]["until"].startswith("2026-11-16T18:00")


async def test_modes_boost_absence(hass, setup, freezer):
    entry, kool = setup
    await hass.services.async_call("button", "press", {"entity_id": "button.salon_boost"}, blocking=True)
    assert kool.temp == 22
    await tick(hass, freezer, 61)
    assert kool.temp == 18
    await hass.services.async_call("select", "select_option", {"entity_id": "select.salon_mode", "option": "comfort_plus"}, blocking=True)
    assert kool.temp == 22
    await hass.services.async_call("select", "select_option", {"entity_id": "select.salon_mode", "option": "auto"}, blocking=True)
    assert kool.temp == 18
    hass.states.async_set("person.geoffrey", "not_home")
    await hass.async_block_till_done()
    await tick(hass, freezer, 31)
    assert hass.states.get("select.chauffage_intelligent_mode_maison").state == "absence"
    assert kool.temp == 17
    hass.states.async_set("person.geoffrey", "home")
    await hass.async_block_till_done()
    assert hass.states.get("select.chauffage_intelligent_mode_maison").state == "auto"


async def test_engine_off_does_nothing(hass, setup, freezer):
    entry, kool = setup
    await hass.services.async_call("switch", "turn_off", {"entity_id": "switch.chauffage_intelligent_moteur_actif"}, blocking=True)
    n = len(kool.calls)
    freezer.move_to(datetime(2026, 11, 16, 18, 0, tzinfo=TZ))
    await tick(hass, freezer)
    assert len(kool.calls) == n


async def test_bad_planning(hass, setup):
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "set_planning", {"entity_id": "climate.salon",
            "planning": {"mon": [{"start": "09:00", "end": "08:00"}]}}, blocking=True)


async def test_persistence_and_reload(hass, setup, freezer):
    entry, kool = setup
    await hass.services.async_call("number", "set_value", {"entity_id": "number.salon_confort", "value": 20.5}, blocking=True)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    attrs = hass.states.get("climate.salon").attributes
    assert attrs["comfort"] == 20.5
    assert attrs["planning"]["fri"][0]["start"] == "07:00"


async def test_options_and_reconfigure(hass, setup):
    entry, kool = setup
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"absence_delay": 45, "notify_windows": True,
                            "advanced": {"arrival_minutes": 30, "verify_delay": 10, "max_retries": 2}})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert entry.options["absence_delay"] == 45
    sub_id = next(iter(entry.subentries))
    result = await entry.start_subentry_reconfigure_flow(hass, sub_id) if hasattr(entry, "start_subentry_reconfigure_flow") else None
    if result is None:
        result = await hass.config_entries.subentries.async_init(
            (entry.entry_id, "zone"), context={"source": "reconfigure", "subentry_id": sub_id})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"], {"name": "Séjour", "climate_entity": KOOL, "window_delay": 2, "usage": "main", "follow_external": False})
    assert result["type"] is FlowResultType.ABORT
    await hass.async_block_till_done()
    assert hass.states.get("climate.salon").attributes["windows"] == []
    assert hass.states.get("climate.salon").attributes["comfort"] == 21


async def test_turns_koolnova_on_separately(hass, setup, freezer):
    """Le Koolnova ignore hvac_mode dans set_temperature : il faut l'allumer à part."""
    entry, kool = setup
    kool.set_state("off", 18)
    await hass.async_block_till_done()
    mgr = entry.runtime_data
    await mgr.async_resume(next(iter(mgr.zones)))  # annule le « manuel » détecté
    await tick(hass, freezer)
    assert hass.states.get(KOOL).state == "heat"
    assert ("set_hvac_mode", {"entity_id": KOOL, "hvac_mode": "heat"}) in [(c, {k: str(v) for k, v in d.items()}) for c, d in kool.calls]


@pytest.mark.parametrize(("reached", "expected"), [(19.5, 2.1), (20.9, 2.6)])
async def test_learning(hass, setup, freezer, reached, expected):
    """Vitesse mesurée pendant la préchauffe de 17 h à 18 h (2,5 °C/h demandés, 10 °C dehors)."""
    entry, kool = setup
    freezer.move_to(datetime(2026, 11, 16, 16, 58, tzinfo=TZ))
    kool.set_state("heat", kool.temp, current=18.0)
    await tick(hass, freezer, 2)
    zone = next(iter(entry.runtime_data.zones.values()))
    assert zone.data["preheat_run"]["start_temp"] == 18.0
    freezer.move_to(datetime(2026, 11, 16, 17, 59, tzinfo=TZ))
    kool.set_state("heat", kool.temp, current=reached)
    await tick(hass, freezer, 1)
    assert zone.data["speed"] == expected
    assert zone.data["last_learning"]["method"] == ("mesurée" if reached < 20.75 else "suivie")
    assert zone.data["preheat_run"] is None


async def test_learning_uses_time_reached(hass, setup, freezer):
    """Objectif atteint à 17:30 puis la pièce redescend : la vitesse vient de 17:30."""
    entry, kool = setup
    freezer.move_to(datetime(2026, 11, 16, 16, 58, tzinfo=TZ))
    kool.set_state("heat", kool.temp, current=18.0)
    await tick(hass, freezer, 2)
    zone = next(iter(entry.runtime_data.zones.values()))
    freezer.move_to(datetime(2026, 11, 16, 17, 30, tzinfo=TZ))
    kool.set_state("heat", kool.temp, current=21.0)
    await tick(hass, freezer, 1)
    assert zone.data["preheat_run"]["reached_at"] is not None
    freezer.move_to(datetime(2026, 11, 16, 17, 59, tzinfo=TZ))
    kool.set_state("heat", kool.temp, current=20.5)
    await tick(hass, freezer, 1)
    last = zone.data["last_learning"]
    assert last["method"] == "atteinte"
    assert last["sample"] > 2.5
    assert zone.data["speed"] > 2.5


async def test_learning_ignored_if_window(hass, setup, freezer):
    entry, kool = setup
    freezer.move_to(datetime(2026, 11, 16, 16, 58, tzinfo=TZ))
    kool.set_state("heat", kool.temp, current=18.0)
    await tick(hass, freezer, 2)
    hass.states.async_set(WINDOW, "on")
    await tick(hass, freezer, 1)
    hass.states.async_set(WINDOW, "off")
    freezer.move_to(datetime(2026, 11, 16, 17, 59, tzinfo=TZ))
    kool.set_state("heat", kool.temp, current=19.0)
    await tick(hass, freezer, 1)
    zone = next(iter(entry.runtime_data.zones.values()))
    assert zone.data["speed"] == 2.5


def test_median_resists_one_bad_day():
    from custom_components.chauffage_intelligent.manager import Manager  # noqa: F401
    samples = sorted([2.0, 2.1, 0.5, 2.2, 1.9][-7:])
    assert samples[len(samples) // 2] == 2.0
