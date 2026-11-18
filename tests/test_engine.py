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


def test_preheat_min_gap():
    # écart de relance 3 °C ; 17:00 : rampe 18,5 ; pièce à 18 -> 18 + 3 = 21
    r = compute(at(0, 17, 0), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=18))
    assert (r.target, r.send, r.reason) == (21, 21, "preheat")
    r = compute(at(0, 17, 0), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=17))
    assert (r.target, r.send) == (20, 20)
    # arrondi au 0,5 inférieur : 18,3 + 3 = 21,3 -> 21
    r = compute(at(0, 17, 0), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=18.3))
    assert r.send == 21
    # relance au-dessus de l'objectif (max +1) tant que la pièce est à plus de 1 °C dessous
    r = compute(at(0, 17, 48), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=18.5))
    assert (r.target, r.send) == (21, 21.5)
    r = compute(at(0, 17, 0), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=19.5))
    assert (r.target, r.send) == (21, 21.5)
    # à 1 °C ou moins de l'objectif : petite relance (+0,5) jusqu'à l'objectif
    r = compute(at(0, 17, 48), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=20))
    assert (r.target, r.send) == (21, 21.5)
    r = compute(at(0, 17, 48), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=20.5))
    assert r.send == 21.5
    # objectif atteint : plus de relance
    r = compute(at(0, 17, 48), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=21))
    assert (r.target, r.send) == (21, 21)
    # préchauffe pas encore commencée : on reste en Eco
    r = compute(at(0, 16, 30), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=17))
    assert (r.target, r.send, r.reason) == (18, 18, "eco")
    # aussi en absence
    r = compute(at(0, 17, 0), glob(mode="absence"), zone(), ZoneInputs(outdoor_temp=10, current_temp=17))
    assert (r.target, r.reason) == (20, "absence_preheat")
    assert "Préchauffe → 21 °C à 18:00" == describe(r, at(0, 17, 0))


def test_preheat_lone_small_zone():
    # Petite zone seule à demander : la PAC ne repart qu'à 3 °C d'écart.
    plan = normalize_planning({"mon": [{"start": "21:00", "end": "23:00", "preset": "comfort"}]})
    z = zone(eco=17.5, comfort=21, speed=2.5, planning=plan)
    r = compute(at(0, 19, 55), glob(), z, ZoneInputs(outdoor_temp=17, current_temp=18))
    assert (r.reason, r.send) == ("preheat", 21)  # 3 °C d'écart dès le départ
    r = compute(at(0, 20, 30), glob(), z, ZoneInputs(outdoor_temp=17, current_temp=19))
    assert (r.target, r.send) == (21, 22)  # relance : objectif + 1
    r = compute(at(0, 20, 45), glob(), z, ZoneInputs(outdoor_temp=17, current_temp=20))
    assert (r.target, r.send) == (21, 21.5)  # fin de montée : petite relance


def test_planning_catch_up():
    now = at(0, 19)  # plage confort 18:00-23:00 en cours
    for cur, sent in [(None, 21), (18, 21), (19, 22), (19.5, 22), (20, 21), (21.5, 21)]:
        r = compute(now, glob(), zone(), ZoneInputs(current_temp=cur))
        assert (r.reason, r.target, r.send) == ("planning", 21, sent), cur
        assert describe(r, now) == "Confort 21 °C jusqu'à 23:00"
    # pas de relance en mode forcé, boost ou manuel
    f = compute(now, glob(), zone(mode="comfort"), ZoneInputs(current_temp=18))
    assert f.send == 21


def test_preheat_no_drop_when_room_catches_up():
    # La température visée ne baisse jamais pendant la montée.
    z = zone(speed=2.0)
    prev = None
    temps = [18.5, 18.5, 19.0, 19.0, 19.5, 19.5, 20.0, 20.0, 20.5]
    for i, cur in enumerate(temps):
        now = at(0, 17, 0) + timedelta(minutes=6 * i)
        r = compute(now, glob(), z, ZoneInputs(outdoor_temp=15, current_temp=cur))
        if prev is not None:
            assert r.target >= prev, (now, cur, r.target, prev)
        assert r.target <= 21 and r.send <= 22
        prev = r.target


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


def test_planning_catch_up_no_finish_push():
    # pendant une plage, pas de petite relance à 0,5 °C : seulement au-delà de 1 °C d'écart
    r = compute(at(0, 19), glob(), zone(), ZoneInputs(outdoor_temp=10, current_temp=20.5))
    assert (r.target, r.send) == (21, 21)
