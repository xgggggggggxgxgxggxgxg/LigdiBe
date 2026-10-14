"""Indicateurs de risque G29 (individualisation, corrélation, inférence),
corrigés du hasard et robustes au déséquilibre.

Notations (une cible i = une personne de connaissances_externes.txt) :
  S_k      ensemble des k premières variables connues (ordre aléatoire,
           respect des chaînes imbriquées âge / dates)
  A[i, j]  nombre de variables de S_k sur lesquelles la cible i et
           l'enregistrement publié j concordent
  C_i      candidats exacts       {j : A[i, j] = k}
  B_i      meilleurs candidats    {j : A[i, j] = max_j' A[i, j']}
  T[i, j]  vrai si j provient de i (id_sejour, utilisé SEULEMENT pour évaluer)

L'identifiant n'intervient jamais dans l'attaque ; il ne sert qu'au score.
Seuls des agrégats sont renvoyés (aucune liaison individuelle n'est écrite
sur disque), conformément au principe de minimisation.
"""
from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score


def random_order(chains, singletons, rng):
    """Ordre de révélation aléatoire respectant l'ordre interne des chaînes."""
    tokens = [("c", ci) for ci, ch in enumerate(chains) for _ in ch] + [("s", v) for v in singletons]
    rng.shuffle(tokens)
    pos = [0] * len(chains)
    order = []
    for kind, val in tokens:
        if kind == "c":
            order.append(chains[val][pos[val]])
            pos[val] += 1
        else:
            order.append(val)
    return order


def _safe_div(a, b):
    return float(a) / float(b) if b else 0.0


def _binary_metrics(y, score):
    """Accuracy brute vs. métriques robustes au déséquilibre, et gains sur la ligne de base."""
    y = y.astype(int)
    pred = (score >= 0.5).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum()); tn = int(((pred == 0) & (y == 0)).sum())
    fp = int(((pred == 1) & (y == 0)).sum()); fn = int(((pred == 0) & (y == 1)).sum())
    p = y.mean()
    acc = (tp + tn) / len(y)
    tpr = _safe_div(tp, tp + fn); tnr = _safe_div(tn, tn + fp)
    ba = 0.5 * (tpr + tnr)
    denom = np.sqrt(float(tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    mcc = (tp * tn - fp * fn) / denom if denom > 0 else 0.0
    f1 = _safe_div(2 * tp, 2 * tp + fp + fn)
    acc0 = max(p, 1 - p)  # prédicteur trivial « classe majoritaire »
    out = {
        "prevalence": p, "accuracy": acc, "balanced_accuracy": ba, "mcc": mcc, "f1": f1,
        "accuracy_gain": _safe_div(acc - acc0, 1 - acc0),  # gain type kappa sur l'accuracy
        "ba_gain": 2 * ba - 1,  # indice de Youden
    }
    if 0 < p < 1:
        ap = average_precision_score(y, score)
        out["auprc"] = ap
        out["auprc_gain"] = (ap - p) / (1 - p)
        out["auroc"] = roc_auc_score(y, score)
    else:
        out["auprc"] = out["auprc_gain"] = out["auroc"] = np.nan
    return out


def evaluate_order(E, R, ext_ids, rel_ids, var_index, order, sens_ext=None, sens_rel=None, sens_names=()):
    """Déroule une courbe de connaissance croissante pour un ordre donné.

    E (N x V), R (M x V) : codes entiers des variables ; var_index : nom -> colonne.
    Renvoie une liste de dicts (un par niveau de connaissance k = 0..len(order)).
    """
    N, M = E.shape[0], R.shape[0]
    T = ext_ids[:, None] == rel_ids[None, :]
    n_true = T.sum(1)
    present = n_true > 0
    n_present = int(present.sum())
    L0 = float(n_true.mean()) / M            # succès d'un tirage au hasard
    Lmax = float(present.mean())             # plafond (cibles absentes du fichier)
    A = np.zeros((N, M), dtype=np.int16)
    rows = []
    for k in range(len(order) + 1):
        if k > 0:
            v = var_index[order[k - 1]]
            A += E[:, v][:, None] == R[:, v][None, :]
        rec = {"k": k, "variable": order[k - 1] if k else ""}

        # --- attaquant strict : concordance exacte sur S_k
        exact = A == k
        cnt = exact.sum(1)
        cnt_true = (exact & T).sum(1)
        # --- attaquant tolérant : meilleure concordance (robuste au mélange)
        mx = A.max(1)
        best = A == mx[:, None]
        bcnt = best.sum(1)
        btrue = (best & T).sum(1)

        for tag, c, ct in (("exact", cnt, cnt_true), ("nn", bcnt, btrue)):
            so = c == 1
            cso = so & (ct >= 1)
            link = np.where(c > 0, ct / np.maximum(c, 1), 0.0)
            n_so, n_cso = int(so.sum()), int(cso.sum())
            prec = n_cso / n_so if n_so else np.nan  # indéfinie si aucun isolement revendiqué
            rec_ = _safe_div(n_cso, n_present)
            rec.update({
                # Individualisation
                f"so_rate_{tag}": n_so / N,                         # taux d'unicité apparente
                f"so_precision_{tag}": prec,                        # VPP des « isolements »
                f"so_recall_{tag}": rec_,
                f"so_f1_{tag}": _safe_div(2 * prec * rec_, prec + rec_) if n_so else 0.0,
                # Corrélation (liaison)
                f"link_{tag}": float(link.mean()),
                f"link_kappa_{tag}": _safe_div(float(link.mean()) - L0, Lmax - L0),
                f"anonset_median_{tag}": float(np.median(c[c > 0])) if (c > 0).any() else np.nan,
            })
        rec["link_chance"] = L0
        rec["link_ceiling"] = Lmax

        # --- inférence (vote des meilleurs candidats)
        if sens_ext is not None:
            bf = best.astype(np.float32)
            scores = (bf @ sens_rel.astype(np.float32)) / bcnt[:, None]
            for s_i, s_name in enumerate(sens_names):
                for mname, val in _binary_metrics(sens_ext[:, s_i], scores[:, s_i]).items():
                    rec[f"inf_{s_name}_{mname}"] = val
        rows.append(rec)
    return rows
