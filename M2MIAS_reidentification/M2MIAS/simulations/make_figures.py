"""Figures et tableaux LaTeX à partir de results/summary.csv.

  python make_figures.py [--latex ../../overleaf]   # copie aussi vers le projet Overleaf
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker
import numpy as np
import pandas as pd

import config as C

# Rampe séquentielle bleue (clair -> foncé = mélange faible -> fort)
BLUE_RAMP = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"]
INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"
NICE = {"chirurgie": "surgery", "diabete": "diabetes", "insuffisance_renale": "renal failure", "demence": "dementia"}
KIND_LABEL = {"direct": "out_direct (same population)", "sample": "out_sample (bootstrap)"}

plt.rcParams.update({
    "font.family": "serif", "font.size": 8.5, "axes.titlesize": 9, "axes.labelsize": 8.5,
    "axes.edgecolor": INK2, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "axes.spines.top": False,
    "axes.spines.right": False, "legend.frameon": False, "savefig.bbox": "tight", "pdf.fonttype": 42,
})


def level_colors(levels):
    idx = np.linspace(0, len(BLUE_RAMP) - 1, len(levels)).round().astype(int)
    return {lv: BLUE_RAMP[i] for lv, i in zip(sorted(levels), idx)}


def curve_grid(summ, scenario, metrics, ylabels, fname, title_suffix="", ylim=None, null_line=None):
    kinds = [k for k in ("direct", "sample") if k in summ["kind"].unique()]
    fig, axes = plt.subplots(len(metrics), len(kinds), figsize=(3.4 * len(kinds), 2.2 * len(metrics)),
                             sharex=True, squeeze=False)
    levels = sorted(summ["level"].unique())
    cols = level_colors(levels)
    for r, (m, yl) in enumerate(zip(metrics, ylabels)):
        for c, kind in enumerate(kinds):
            ax = axes[r, c]
            d = summ[(summ.scenario == scenario) & (summ.metric == m) & (summ.kind == kind)]
            for lv in levels:
                s = d[d.level == lv].sort_values("k")
                if s.empty:
                    continue
                ax.fill_between(s.k, s.q025, s.q975, color=cols[lv], alpha=0.12, linewidth=0)
                ax.plot(s.k, s["mean"], color=cols[lv], lw=1.6, marker="o", ms=2.6, label=f"{lv}%")
            if null_line and m in null_line:
                ax.axhline(null_line[m], color=INK2, lw=0.9, ls="--")
            if ylim:
                ax.set_ylim(*ylim[r] if isinstance(ylim[0], tuple) else ylim)
            if r == 0:
                ax.set_title(KIND_LABEL[kind] + title_suffix, color=INK)
            if c == 0:
                ax.set_ylabel(yl)
            ax.xaxis.set_major_locator(matplotlib.ticker.MaxNLocator(integer=True))
            if r == len(metrics) - 1:
                ax.set_xlabel("number of known variables $k$")
    h, l = axes[0, 0].get_legend_handles_labels()
    fig.legend(h, l, title="shuffled cells", loc="center left", bbox_to_anchor=(1.0, 0.5), fontsize=7.5, title_fontsize=7.5)
    fig.tight_layout()
    fig.savefig(C.FIGURES_DIR / fname)
    plt.close(fig)


def fig_prevalence(ext_path: Path):
    from run_experiments import read_table, to_binary
    ext = read_table(ext_path)
    names = [s for s in C.SENSITIVE if s in ext.columns]
    prev = [to_binary(ext[s]).mean() for s in names]
    fig, ax = plt.subplots(figsize=(3.4, 1.9))
    y = np.arange(len(names))
    ax.barh(y, prev, color="#2a78d6", height=0.55)
    ax.barh(y, [1 - p for p in prev], left=prev, color="#d9d8d3", height=0.55)
    for i, p in enumerate(prev):
        ax.text(1.01, i, f"{p:.1%} | trivial acc. {max(p, 1 - p):.1%}", va="center", fontsize=7, color=INK2)
    ax.set_yticks(y, [NICE.get(n, n) for n in names])
    ax.set_xlim(0, 1); ax.set_xlabel("share of stays (blue = positive class)")
    ax.grid(axis="y", visible=False)
    fig.savefig(C.FIGURES_DIR / "fig1_prevalence.pdf")
    plt.close(fig)


def aukc(summ):
    """Aire normalisée sous la courbe risque-connaissance (moyenne sur k>=1)."""
    d = summ[summ.k >= 1]
    return d.groupby(["kind", "level", "scenario", "metric"])["mean"].mean().reset_index(name="aukc")


def fig_heatmap(summ):
    a = aukc(summ)
    rows = [("A", "so_rate_exact", "Uniqueness rate (naive)"),
            ("A", "so_precision_exact", "Singling-out PPV"),
            ("A", "link_kappa_nn", r"Linkage $\kappa_L$ (NN)"),
            ("B", "inf_diabete_accuracy", "Diabetes: accuracy"),
            ("B", "inf_diabete_mcc", "Diabetes: MCC"),
            ("B", "inf_demence_accuracy", "Dementia: accuracy"),
            ("B", "inf_demence_mcc", "Dementia: MCC"),
            ("B", "inf_demence_auprc_gain", "Dementia: AUPRC gain")]
    kinds = [k for k in ("direct", "sample") if k in a.kind.unique()]
    fig, axes = plt.subplots(1, len(kinds), figsize=(3.5 * len(kinds), 3.0), sharey=True, squeeze=False)
    for c, kind in enumerate(kinds):
        levels = sorted(a[a.kind == kind].level.unique())
        M = np.array([[a[(a.kind == kind) & (a.level == lv) & (a.scenario == s) & (a.metric == m)]["aukc"].mean()
                       for lv in levels] for s, m, _ in rows])
        ax = axes[0, c]
        ax.imshow(np.clip(M, 0, 1), cmap=matplotlib.colors.LinearSegmentedColormap.from_list(
            "b", ["#f4f8fd", "#86b6ef", "#2a78d6", "#0d366b"]), vmin=0, vmax=1, aspect="auto")
        for i in range(M.shape[0]):
            for j in range(M.shape[1]):
                ax.text(j, i, "–" if np.isnan(M[i, j]) else f"{M[i, j]:.2f}", ha="center", va="center", fontsize=6.5,
                        color="white" if M[i, j] > 0.55 else INK)
        ax.set_xticks(range(len(levels)), [f"{lv}%" for lv in levels])
        ax.set_yticks(range(len(rows)), [r[2] for r in rows])
        ax.set_title(KIND_LABEL[kind], color=INK); ax.grid(False)
        ax.set_xlabel("shuffled cells")
    fig.tight_layout()
    fig.savefig(C.FIGURES_DIR / "fig5_aukc_heatmap.pdf")
    plt.close(fig)


def tables(summ, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    kmaxA = summ[summ.scenario == "A"].k.max()
    kmaxB = summ[summ.scenario == "B"].k.max()
    a = aukc(summ)

    def get(kind, lv, sc, m, k, col="mean"):
        v = summ[(summ.kind == kind) & (summ.level == lv) & (summ.scenario == sc) & (summ.metric == m) & (summ.k == k)][col]
        x = float(v.iloc[0]) if len(v) else np.nan
        return 0.0 if abs(x) < 5e-4 else x  # évite l'affichage « -0.000 »

    lines = []
    for kind in ("direct", "sample"):
        for lv in sorted(summ[summ.kind == kind].level.unique()):
            au = a[(a.kind == kind) & (a.level == lv) & (a.scenario == "A") & (a.metric == "link_kappa_nn")]["aukc"]
            lines.append(" & ".join([
                kind, f"{lv}",
                f"{get(kind, lv, 'A', 'so_rate_exact', kmaxA):.3f}",
                (lambda x: "--" if np.isnan(x) else f"{x:.3f}")(get(kind, lv, 'A', 'so_precision_exact', kmaxA)),
                f"{get(kind, lv, 'A', 'link_exact', kmaxA):.3f}",
                f"{get(kind, lv, 'A', 'link_nn', kmaxA):.3f}",
                f"{get(kind, lv, 'A', 'link_kappa_nn', kmaxA):.3f}",
                f"{max(au.iloc[0], 0.0) if abs(au.iloc[0]) < 5e-4 else au.iloc[0]:.3f}" if len(au) else "--"]) + r" \\")
    (out_dir / "tab_individualisation_linkage.tex").write_text("\n".join(lines) + "\n")

    lines = []
    for s in C.SENSITIVE:
        for kind in ("direct", "sample"):
            for lv in sorted(summ[summ.kind == kind].level.unique()):
                if lv not in (0, 50, 100) and lv != summ[summ.kind == kind].level.max():
                    continue
                g = lambda m: get(kind, lv, "B", f"inf_{s}_{m}", kmaxB)
                lines.append(" & ".join([
                    NICE.get(s, s.replace("_", r"\_")), kind, f"{lv}", f"{g('prevalence'):.3f}",
                    f"{g('accuracy'):.3f}", f"{g('accuracy_gain'):+.3f}", f"{g('balanced_accuracy'):.3f}",
                    f"{g('mcc'):+.3f}", f"{g('auprc_gain'):+.3f}"]) + r" \\")
        lines.append(r"\midrule")
    (out_dir / "tab_inference.tex").write_text("\n".join(lines[:-1]) + "\n")
    a.to_csv(C.RESULTS_DIR / "aukc.csv", index=False)


WORDS = {0: "Zero", 10: "Ten", 20: "Twenty", 25: "TwentyFive", 30: "Thirty", 40: "Forty", 50: "Fifty",
         60: "Sixty", 70: "Seventy", 75: "SeventyFive", 80: "Eighty", 90: "Ninety", 100: "Hundred"}


def numbers(summ, out_dir: Path, n_records: int, n_orders: int):
    """Macros LaTeX (\\newcommand) pour citer les résultats dans le texte sans recopie manuelle."""
    kA = int(summ[summ.scenario == "A"].k.max()); kB = int(summ[summ.scenario == "B"].k.max())
    a = aukc(summ)
    m = [f"\\newcommand{{\\Nrec}}{{{n_records}}}", f"\\newcommand{{\\Norders}}{{{n_orders}}}",
         f"\\newcommand{{\\kmaxA}}{{{kA}}}", f"\\newcommand{{\\kmaxB}}{{{kB}}}"]

    def val(kind, lv, sc, met, k):
        v = summ[(summ.kind == kind) & (summ.level == lv) & (summ.scenario == sc) & (summ.metric == met) & (summ.k == k)]["mean"]
        return float(v.iloc[0]) if len(v) else float("nan")

    for kind, K in (("direct", "Dir"), ("sample", "Smp")):
        for lv in sorted(summ[summ.kind == kind].level.unique()):
            W = WORDS.get(int(lv), f"L{int(lv)}")
            for met, P in (("so_rate_exact", "Uniq"), ("so_precision_exact", "Ppv"), ("link_exact", "LinkEx"),
                           ("link_nn", "LinkNN"), ("link_kappa_nn", "Kappa")):
                m.append(f"\\newcommand{{\\{P}{K}{W}}}{{{val(kind, lv, 'A', met, kA):.2f}}}")
            d = summ[(summ.kind == kind) & (summ.level == lv) & (summ.scenario == "A") & (summ.metric == "so_rate_exact")]
            m.append(f"\\newcommand{{\\UniqPeak{K}{W}}}{{{d['mean'].max():.2f}}}")
            au = a[(a.kind == kind) & (a.level == lv) & (a.scenario == "A") & (a.metric == "link_kappa_nn")]["aukc"]
            m.append(f"\\newcommand{{\\Aukc{K}{W}}}{{{float(au.iloc[0]):.2f}}}")
            for sname, S in (("demence", "Dem"), ("diabete", "Dia"), ("insuffisance_renale", "Ren"), ("chirurgie", "Chi")):
                for met, P in (("accuracy", "Acc"), ("mcc", "Mcc"), ("balanced_accuracy", "Ba"),
                               ("auprc_gain", "Ap"), ("accuracy_gain", "AccGain"), ("prevalence", "Prev")):
                    m.append(f"\\newcommand{{\\Inf{S}{P}{K}{W}}}{{{val(kind, lv, 'B', f'inf_{sname}_{met}', kB):.2f}}}")
        m.append(f"\\newcommand{{\\Ceil{K}}}{{{val(kind, 0, 'A', 'link_ceiling', 0):.2f}}}")
    (out_dir / "numbers.tex").write_text("\n".join(m) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--latex", default=None, help="dossier du projet Overleaf (copie figures/ et tables/)")
    args = ap.parse_args()
    summ = pd.read_csv(C.RESULTS_DIR / "summary.csv")
    C.FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    data_dir = Path((C.RESULTS_DIR / "data_source.txt").read_text().strip())
    if not (data_dir / C.EXTERNAL_FILE).exists():  # résultats calculés sur une autre machine
        from run_experiments import resolve_data_dir
        data_dir = resolve_data_dir(None)

    fig_prevalence(data_dir / C.EXTERNAL_FILE)
    curve_grid(summ, "A", ["so_rate_exact", "so_precision_exact"],
               ["apparent uniqueness rate", "PPV of singling-out"], "fig2_individualisation.pdf", ylim=(0, 1.02))
    curve_grid(summ, "A", ["link_nn", "link_kappa_nn"],
               [r"linkage success $L$ (NN)", r"chance-corrected $\kappa_L$"], "fig3_linkability.pdf",
               ylim=(-0.02, 1.02))
    for s, nice in (("demence", "dementia"), ("diabete", "diabetes")):
        prev = summ[(summ.metric == f"inf_{s}_prevalence")]["mean"].mean()
        curve_grid(summ, "B", [f"inf_{s}_accuracy", f"inf_{s}_balanced_accuracy", f"inf_{s}_mcc"],
                   ["accuracy", "balanced accuracy", "MCC"], f"fig4_inference_{s}.pdf",
                   title_suffix=f" — {nice}",
                   null_line={f"inf_{s}_accuracy": max(prev, 1 - prev), f"inf_{s}_balanced_accuracy": 0.5,
                              f"inf_{s}_mcc": 0.0})
    fig_heatmap(summ)
    tex_tables = Path(args.latex) / "tables" if args.latex else C.RESULTS_DIR / "tables"
    tables(summ, tex_tables)
    raw_orders = pd.read_csv(C.RESULTS_DIR / "raw_metrics.csv", usecols=["order"])["order"].nunique()
    from run_experiments import read_table
    numbers(summ, tex_tables, len(read_table(data_dir / C.EXTERNAL_FILE)), raw_orders)
    if args.latex:
        dst = Path(args.latex) / "figures"
        dst.mkdir(parents=True, exist_ok=True)
        for f in C.FIGURES_DIR.glob("*.pdf"):
            shutil.copy(f, dst / f.name)
    print(f"Figures : {C.FIGURES_DIR} ; tableaux : {tex_tables}")


if __name__ == "__main__":
    main()
