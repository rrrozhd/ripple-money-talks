from ripple.evaluate import answers, calibration, rubric
import numpy as np


def test_rubric_full_partial_none():
    assert rubric({"A", "B"}, {"A", "B"})["score"] == 1.0
    r = rubric({"A", "C"}, {"A", "B"})
    assert r["score"] == 0.5 and r["precision"] == 0.5 and r["recall"] == 0.5
    assert rubric({"C"}, {"A"})["score"] == 0.0 and rubric(set(), {"A"})["f1"] == 0.0


def test_answers_respect_direction_and_filer():
    links = [("NVDA", "x:tsmc", "NVDA", "SUPPLIES"),   # NVIDIA says TSMC supplies it
             ("LRCX", "LRCX", "MU", "SUPPLIES"),       # Lam says Micron buys from it
             ("INTC", "AMD", "INTC", "COMPETES_WITH"),
             ("AMD", "NVDA", "INTC", "PARTNERS")]      # AMD's filing about two other companies: ignored
    a = answers(links)
    assert a[("NVDA", "suppliers")] == {"x:tsmc"}
    assert a[("LRCX", "customers")] == {"MU"}
    assert a[("INTC", "competitors")] == {"AMD"}
    assert ("AMD", "partners") not in a


def test_calibration_perfect_and_wrong():
    y = np.array([1, 0, 1, 0.0])
    assert calibration(y.copy(), y)["brier"] == 0.0
    assert calibration(1 - y, y)["brier"] == 1.0
