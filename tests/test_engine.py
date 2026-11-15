"""Tests du calcul pur."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from custom_components.chauffage_intelligent.engine import (
    GlobalSettings, PlanningError, ZoneInputs, ZoneSettings, compute, describe,
    next_change, normalize_planning,
)

TZ = ZoneInfo("Europe/Paris")
WEEK = {d: [{"start": "07:00", "end": "07:30", "preset": "comfort"},
            {"start": "18:00", "end": "23:00", "preset": "comfort"}] for d in ["mon", "tue", "wed", "thu", "fri"]}
WEEK["sat"] = [{"start": "08:00", "end": "23:00", "preset": "comfort_plus"}]


def zone(**kw):
    base = dict(eco=18, comfort=21, comfort_plus=22, speed=2.5, planning=normalize_planning(WEEK))
    base.update(kw)
    return ZoneSettings(**base)


def glob(**kw):
    base = dict(mode="auto", absence_temp=17, vacation_temp=15, boost_temp=22)
    base.update(kw)
    return GlobalSettings(**base)


def at(day, hh, mm=0):
    # 2026-11-16 = lundi
    return datetime(2026, 11, 16 + day, hh, mm, tzinfo=TZ)


def test_planning_validation():
    with pytest.raises(PlanningError):
        normalize_planning({"mon": [{"start": "08:00", "end": "07:00"}]})
    with pytest.raises(PlanningError):
        normalize_planning({"mon": [{"start": "07:00", "end": "09:00"}, {"start": "08:00", "end": "10:00"}]})
    with pytest.raises(PlanningError):
        normalize_planning({"mon": [{"start": "07:00", "end": "09:00", "preset": "custom"}]})
    p = normalize_planning({"mon": [{"start": "7:00", "end": "24:00", "preset": "custom", "temp": 20.3}]})
    assert p["mon"][0] == {"start": "07:00", "end": "24:00", "preset": "custom", "temp": 20.5}
    assert p["sun"] == []


def test_auto_slot_and_eco():
    r = compute(at(0, 19), glob(), zone(), ZoneInputs(outdoor_temp=10))
    assert (r.target, r.reason, r.preset) == (21, "planning", "comfort")
    r = compute(at(0, 12), glob(), zone(), ZoneInputs(outdoor_temp=10))
    assert (r.target, r.reason) == (18, "eco")
    r = compute(at(5, 9), glob(), zone(), ZoneInputs())
    assert r.target == 22


def test_preheat_ramp():
    # 2,5 °C/h à 10 °C dehors : 21 - 2,5*h ; à 16:30 => 1,5 h => 17,25 -> floor 17 -> borné eco 18
    r = compute(at(0, 16, 30), glob(), zone(), ZoneInputs(outdoor_temp=10))
    assert r.target == 18
    r = compute(at(0, 17, 0), glob(), zone(), ZoneInputs(outdoor_temp=10))
    assert r.target == 18.5 and r.reason == "preheat"
    assert r.preheat_at == at(0, 18) and r.preheat_target == 21
    r = compute(at(0, 17, 48), glob(), zone(), ZoneInputs(outdoor_temp=10))
    assert r.target == 20.5
    assert "Préchauffe → 21 °C à 18:00" == describe(r, at(0, 17, 48))
    # plus froid => démarre plus tôt
    cold = compute(at(0, 17, 0), glob(), zone(), ZoneInputs(outdoor_temp=0))
    assert cold.target > 18.5  # vitesse plus faible : la rampe est plus haute à la même heure
    no = compute(at(0, 17, 30), glob(), zone(preheat=False), ZoneInputs())
    assert no.target == 18


def test_priorities():
    now = at(0, 19)
    assert compute(now, glob(), zone(), ZoneInputs(window_open=True)).target is None
    assert compute(now, glob(mode="off"), zone(), ZoneInputs()).reason == "global_off"
    assert compute(now, glob(), zone(mode="off"), ZoneInputs()).reason == "zone_off"
    b = compute(now, glob(), zone(boost_until=now + timedelta(minutes=30)), ZoneInputs())
    assert (b.target, b.reason) == (22, "boost")
    m = compute(now, glob(), zone(manual_active=True, manual_temp=19.5, manual_until=now + timedelta(hours=1)), ZoneInputs())
    assert (m.target, m.reason) == (19.5, "manual")
    m2 = compute(now, glob(), zone(manual_active=True, manual_temp=19.5, manual_until=now - timedelta(minutes=1)), ZoneInputs())
    assert m2.reason == "planning"
    f = compute(now, glob(), zone(mode="eco"), ZoneInputs())
    assert (f.target, f.reason) == (18, "forced")


def test_absence():
    g = glob(mode="absence")
    # 18:30, plage commencée il y a 30 min -> confort (arrivée prévue)
    assert compute(at(0, 18, 30), g, zone(), ZoneInputs()).target == 21
    # 19:30 -> base = min(17, eco 18) = 17
    r = compute(at(0, 19, 30), g, zone(), ZoneInputs())
    assert (r.target, r.reason) == (17, "absence")
    # préchauffe avant 18h même en absence
    r = compute(at(0, 17, 30), g, zone(), ZoneInputs(outdoor_temp=10))
    assert r.reason == "absence_preheat" and r.target == 19.5


def test_vacation():
    g = glob(mode="vacation", vacation_end=at(2, 15))
    assert compute(at(0, 19), g, zone(), ZoneInputs()).target == 15
    # retour mercredi 15h : la plage visée est 18h mercredi
    r = compute(at(2, 17), g, zone(), ZoneInputs(outdoor_temp=10))
    assert r.reason == "vacation_preheat" and r.preheat_at == at(2, 18)


def test_next_change_and_midnight():
    p = normalize_planning({"mon": [{"start": "22:00", "end": "24:00"}], "tue": [{"start": "00:00", "end": "06:00"}]})
    z = zone(planning=p)
    assert compute(at(0, 23, 30), glob(), z, ZoneInputs()).reason == "planning"
    assert compute(at(1, 3), glob(), z, ZoneInputs()).reason == "planning"
    assert next_change(p, at(0, 12)) == at(0, 22)
    assert next_change(p, at(0, 23)) == at(1, 0)
