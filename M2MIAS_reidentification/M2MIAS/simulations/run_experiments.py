"""Calcule les courbes « risque vs connaissance » pour chaque fichier publié.

  python run_experiments.py                 # utilise DATA_DIR si les fichiers y sont
  python run_experiments.py --data ./data_fictive
  M2MIAS_N_ORDERS=50 python run_experiments.py   # plus d'ordres Monte-Carlo

Sorties (agrégats uniquement) :
  results/raw_metrics.csv   une ligne par (fichier, scénario, ordre, k)
  results/summary.csv       moyenne et intervalle 2,5–97,5 % sur les ordres,
                            + indicateurs corrigés par le fichier nul (100 %)
"""
from __future__ import annotations

import argparse
import re
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd

import config as C
from indicators import evaluate_order, random_order

PATTERN = re.compile(r"out_(direct|sample)_(\d+)\.txt$")


def read_table(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=None, engine="python", dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]
    return df.apply(lambda s: s.str.strip())


def resolve_data_dir(cli: str | None) -> Path:
    for cand in [cli, C.DATA_DIR, C.FICTIVE_DIR]:
        if cand and (Path(cand) / C.EXTERNAL_FILE).exists():
            return Path(cand)
    raise SystemExit(
        f"{C.EXTERNAL_FILE} introuvable dans {C.DATA_DIR} ni {C.FICTIVE_DIR}.\n"
        "Lancez d'abord : python generate_fictive_data.py")


def encode(ext: pd.DataFrame, rel: pd.DataFrame, cols):
    E = np.empty((len(ext), len(cols)), dtype=np.int32)
    R = np.empty((len(rel), len(cols)), dtype=np.int32)
    for j, c in enumerate(cols):
        cats = pd.Index(pd.unique(pd.concat([ext[c], rel[c]]).fillna("NA")))
        E[:, j] = cats.get_indexer(ext[c].fillna("NA"))
        R[:, j] = cats.get_indexer(rel[c].fillna("NA"))
    return E, R


def to_binary(s: pd.Series) -> np.ndarray:
    return s.fillna("0").str.lower().isin(["1", "oui", "true", "vrai", "o", "yes"]).to_numpy(int)


def run_file(job):
    data_dir, fname, kind, level, n_orders = job
    ext = read_table(Path(data_dir) / C.EXTERNAL_FILE)
    rel = read_table(Path(data_dir) / fname)
    known_all = [c for c in ext.columns if c not in C.HIDDEN_COLS and c in rel.columns]
    chains = [[v for v in ch if v in known_all] for ch in C.CHAINS]
    chains = [ch for ch in chains if ch]
    singles_a = [v for v in C.SCENARIO_A_SINGLETONS if v in known_all]
    singles_b = [v for v in C.SCENARIO_B_SINGLETONS if v in known_all]
    sens = [v for v in C.SENSITIVE if v in known_all]

    cols = [v for ch in chains for v in ch] + sorted(set(singles_a) | set(singles_b))
    E, R = encode(ext, rel, cols)
    vidx = {c: j for j, c in enumerate(cols)}
    ext_ids = ext[C.ID_COL].to_numpy()
    rel_ids = rel[C.ID_COL].to_numpy()
    sens_ext = np.column_stack([to_binary(ext[s]) for s in sens])
    sens_rel = np.column_stack([to_binary(rel[s]) for s in sens])

    # Mêmes ordres de révélation pour tous les fichiers (nombres aléatoires communs) :
    # les écarts entre fichiers ne reflètent que le mélange, pas le tirage des ordres.
    rng = np.random.default_rng(C.SEED)
    out = []
    for o in range(n_orders):
        order_a = random_order(chains, singles_a, rng)
        for r in evaluate_order(E, R, ext_ids, rel_ids, vidx, order_a):
            out.append({"kind": kind, "level": level, "scenario": "A", "order": o, **r})
        order_b = random_order(chains, singles_b, rng)
        for r in evaluate_order(E, R, ext_ids, rel_ids, vidx, order_b, sens_ext, sens_rel, sens):
            out.append({"kind": kind, "level": level, "scenario": "B", "order": o, **r})
    print(f"  ok {fname} ({len(rel)} lignes)", flush=True)
    return out


def summarise(raw: pd.DataFrame) -> pd.DataFrame:
    metrics = [c for c in raw.columns if c not in ("kind", "level", "scenario", "order", "k", "variable")]
    long = raw.melt(id_vars=["kind", "level", "scenario", "order", "k"], value_vars=metrics,
                    var_name="metric").dropna(subset=["value"])
    g = long.groupby(["kind", "level", "scenario", "metric", "k"])["value"]
    summ = g.agg(mean="mean", q025=lambda x: x.quantile(0.025), q975=lambda x: x.quantile(0.975)).reset_index()

    # Correction par le fichier nul (mélange maximal du même type) : risque en excès,
    # normalisé comme un kappa : (R - R_nul) / (1 - R_nul).
    top = summ.groupby("kind")["level"].transform("max")
    null = summ[summ["level"] == top][["kind", "scenario", "metric", "k", "mean"]].rename(columns={"mean": "null"})
    summ = summ.merge(null, on=["kind", "scenario", "metric", "k"], how="left")
    denom = (1 - summ["null"]).where(lambda d: d.abs() > 1e-9)
    summ["excess_vs_null"] = (summ["mean"] - summ["null"]) / denom
    return summ


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=None)
    ap.add_argument("--orders", type=int, default=C.N_ORDERS)
    ap.add_argument("--jobs", type=int, default=4)
    args = ap.parse_args()

    data_dir = resolve_data_dir(args.data)
    files = sorted(p.name for p in data_dir.iterdir() if PATTERN.search(p.name))
    print(f"Données : {data_dir} — {len(files)} fichiers publiés, {args.orders} ordres", flush=True)
    jobs = []
    for f in files:
        kind, lv = PATTERN.search(f).groups()
        jobs.append((str(data_dir), f, kind, int(lv), args.orders))
    with Pool(args.jobs) as pool:
        chunks = pool.map(run_file, jobs)
    raw = pd.DataFrame([r for ch in chunks for r in ch])
    C.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    raw.to_csv(C.RESULTS_DIR / "raw_metrics.csv", index=False)
    summarise(raw).to_csv(C.RESULTS_DIR / "summary.csv", index=False)
    (C.RESULTS_DIR / "data_source.txt").write_text(str(data_dir) + "\n")
    print(f"Résultats écrits dans {C.RESULTS_DIR}")


if __name__ == "__main__":
    main()
