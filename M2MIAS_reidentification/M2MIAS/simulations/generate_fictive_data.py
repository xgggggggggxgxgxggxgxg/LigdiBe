"""Génère une réplique FICTIVE de la base du sujet (même schéma, mêmes mécanismes).

Aucune donnée réelle n'est utilisée : les séjours sont tirés de lois simples
inspirées de l'activité MCO française. Les fichiers produits ont exactement
le format attendu par `run_experiments.py` :

  connaissances_externes.txt   (une ligne par séjour, toutes les variables)
  out_direct_XX.txt            (même population, XX % des cellules de chaque
                                colonne permutées entre elles)
  out_sample_XX.txt            (tirage avec remise de N séjours, puis même
                                mélange de XX % par colonne)

Usage : python generate_fictive_data.py [--n 1500] [--levels 0 10 25 50 75 90 100]
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta

import numpy as np
import pandas as pd

from config import FICTIVE_DIR, ID_COL, SEED

SPECIALTIES = ["medecine", "chirurgie", "geriatrie", "obstetrique", "pediatrie", "psychiatrie"]
SPEC_P = [0.40, 0.25, 0.12, 0.10, 0.08, 0.05]
MEAN_LOS = {"medecine": 6, "chirurgie": 4, "geriatrie": 10, "obstetrique": 4, "pediatrie": 3, "psychiatrie": 15}
DIAG_BY_SPEC = {
    "medecine": ["I50.0", "J18.9", "I48.9", "K92.2", "A41.9"],
    "chirurgie": ["K80.2", "K35.8", "M16.1", "S72.0", "K40.9"],
    "geriatrie": ["R29.6", "S72.0", "J18.9", "E86", "N39.0"],
    "obstetrique": ["O80", "O82", "O70.0", "O24.4", "O13"],
    "pediatrie": ["J21.9", "A08.4", "J45.9", "R50.9", "S06.0"],
    "psychiatrie": ["F32.2", "F20.0", "F10.2", "F31.1", "F43.1"],
}
ACTS_SURG = ["HMFC004", "HHFA016", "NEKA020", "NBCA006", "JQGA003", "LMMA006"]
ACTS_MED = ["ZBQK002", "DEQP003", "YYYY600", "ZCQK002", "EBQM001"]


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def generate_population(n: int, rng: np.random.Generator) -> pd.DataFrame:
    spec = rng.choice(SPECIALTIES, size=n, p=SPEC_P)
    age = np.empty(n, dtype=int)
    for s, (lo, hi, mu, sd) in {
        "pediatrie": (0, 17, None, None), "obstetrique": (18, 44, None, None),
        "geriatrie": (75, 100, None, None), "medecine": (18, 100, 64, 18),
        "chirurgie": (1, 100, 56, 20), "psychiatrie": (16, 90, 40, 15),
    }.items():
        m = spec == s
        if mu is None:
            age[m] = rng.integers(lo, hi + 1, m.sum())
        else:
            age[m] = np.clip(np.round(rng.normal(mu, sd, m.sum())), lo, hi).astype(int)

    sexe = np.where(rng.random(n) < 0.52, "F", "M")
    sexe[spec == "obstetrique"] = "F"

    entree_mode = rng.choice(["urgences", "domicile", "mutation", "transfert"], size=n, p=[0.45, 0.40, 0.10, 0.05])
    entree_mode[spec == "obstetrique"] = rng.choice(["urgences", "domicile"], size=(spec == "obstetrique").sum(), p=[0.3, 0.7])

    start, span = date(2023, 1, 1), 730
    d_in = [start + timedelta(days=int(x)) for x in rng.integers(0, span, n)]
    los = np.array([0 if rng.random() < 0.10 else rng.geometric(1.0 / MEAN_LOS[s]) for s in spec])
    d_out = [d + timedelta(days=int(l)) for d, l in zip(d_in, los)]

    p_death = 0.005 + 0.10 * _sigmoid((age - 85) / 6)
    u = rng.random(n)
    sortie_mode = np.where(u < p_death, "deces",
                  np.where(u < p_death + 0.07, "mutation",
                  np.where(u < p_death + 0.13, "transfert", "domicile")))

    chirurgie = np.where(spec == "chirurgie", rng.random(n) < 0.95,
                np.where(spec == "obstetrique", rng.random(n) < 0.30, rng.random(n) < 0.04)).astype(int)
    diabete = (rng.random(n) < 0.02 + 0.22 * _sigmoid((age - 60) / 10)).astype(int)
    ir = (rng.random(n) < 0.01 + 0.15 * _sigmoid((age - 72) / 8) + 0.06 * diabete).astype(int)
    demence = (rng.random(n) < 0.002 + 0.25 * _sigmoid((age - 84) / 5)).astype(int)

    diags, acts = [], []
    for i in range(n):
        d = [rng.choice(DIAG_BY_SPEC[spec[i]])]
        if diabete[i]:
            d.append("E11.9")
        if ir[i]:
            d.append("N18.3")
        if demence[i]:
            d.append("F03")
        diags.append(";".join(d))
        a = list(rng.choice(ACTS_SURG, size=rng.integers(1, 3), replace=False)) if chirurgie[i] else []
        a += list(rng.choice(ACTS_MED, size=rng.integers(0, 3), replace=False))
        acts.append(";".join(a))

    df = pd.DataFrame({
        ID_COL: np.arange(1, n + 1),
        "age10": (age // 10) * 10, "age5": (age // 5) * 5, "age": age, "sexe": sexe,
        "entree_mode": entree_mode, "sortie_mode": sortie_mode,
        "entree_date_y": [d.strftime("%Y") for d in d_in],
        "entree_date_ym": [d.strftime("%Y-%m") for d in d_in],
        "entree_date_ymd": [d.strftime("%Y-%m-%d") for d in d_in],
        "sortie_date_y": [d.strftime("%Y") for d in d_out],
        "sortie_date_ym": [d.strftime("%Y-%m") for d in d_out],
        "sortie_date_ymd": [d.strftime("%Y-%m-%d") for d in d_out],
        "specialite": spec, "chirurgie": chirurgie, "diabete": diabete,
        "insuffisance_renale": ir, "demence": demence,
        "liste_diag": diags, "liste_acte": acts,
    })
    return df


def shuffle_columns(df: pd.DataFrame, pct: float, rng: np.random.Generator) -> pd.DataFrame:
    """Pour chaque colonne (sauf l'identifiant), permute pct % des cellules entre elles."""
    out = df.copy()
    n = len(out)
    k = int(round(pct / 100.0 * n))
    if k < 2:
        return out
    for c in out.columns:
        if c == ID_COL:
            continue
        rows = rng.choice(n, size=k, replace=False)
        vals = out[c].to_numpy().copy()
        vals[rows] = vals[rng.permutation(rows)]
        out[c] = vals
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1500)
    ap.add_argument("--levels", type=int, nargs="+", default=[0, 10, 25, 50, 75, 90, 100])
    ap.add_argument("--out", default=str(FICTIVE_DIR))
    args = ap.parse_args()

    rng = np.random.default_rng(SEED)
    from pathlib import Path
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    base = generate_population(args.n, rng)
    base.to_csv(out / "connaissances_externes.txt", sep="\t", index=False)
    for lv in args.levels:
        direct = base.sample(frac=1.0, random_state=int(rng.integers(1e9))).reset_index(drop=True)
        shuffle_columns(direct, lv, rng).to_csv(out / f"out_direct_{lv:02d}.txt", sep="\t", index=False)
        boot = base.iloc[rng.integers(0, len(base), len(base))].reset_index(drop=True)
        shuffle_columns(boot, lv, rng).to_csv(out / f"out_sample_{lv:02d}.txt", sep="\t", index=False)
    prev = base[["chirurgie", "diabete", "insuffisance_renale", "demence"]].mean().round(3).to_dict()
    print(f"{args.n} séjours fictifs écrits dans {out} ; prévalences : {prev}")


if __name__ == "__main__":
    main()
