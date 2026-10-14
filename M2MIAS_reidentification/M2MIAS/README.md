# M2 MIAS – Indicateurs de risque de réidentification (sujet Pr E. Chazard, février 2026)

Simulations Python de l'article *Chance-corrected, imbalance-aware indicators of
re-identification risk* (dossier `overleaf/`). Décompressez l'archive dans
`/home/wajdi/Desktop/BDDS/` : vous obtenez `/home/wajdi/Desktop/BDDS/M2MIAS/`.

## Lancement rapide

```bash
cd /home/wajdi/Desktop/BDDS/M2MIAS
pip install -r requirements.txt
./run_all.sh                 # ou : ./run_all.sh --orders 50
```

* Si `connaissances_externes.txt`, `out_direct_XX.txt` et `out_sample_XX.txt`
  sont dans `/home/wajdi/Desktop/BDDS/M2MIAS/` (ou dans `$M2MIAS_DATA_DIR`), ce
  sont **ces fichiers du cours** qui sont analysés (séparateur détecté
  automatiquement, niveaux XX découverts automatiquement).
* Sinon, `generate_fictive_data.py` crée une **réplique fictive** de même schéma
  dans `data_fictive/` (1 500 séjours, niveaux 0/10/25/50/75/90/100 %).
  Les chiffres de l'article viennent de cette réplique ; relancez sur les
  fichiers du cours pour obtenir les vôtres (les figures, les tableaux et les
  macros `numbers.tex` se régénèrent ; copiez-les avec
  `python simulations/make_figures.py --latex ../overleaf`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `simulations/config.py` | chemins, variables connues/cachées, chaînes imbriquées, attributs sensibles |
| `simulations/generate_fictive_data.py` | réplique fictive + mélange de XX % des cellules par colonne + bootstrap |
| `simulations/indicators.py` | attaques (stricte / plus proche concordance) et indicateurs G29 |
| `simulations/run_experiments.py` | courbes risque–connaissance, Monte-Carlo sur les ordres de révélation |
| `simulations/make_figures.py` | figures PDF, tableaux LaTeX, `numbers.tex` |
| `results/summary.csv` | moyenne et IC 2,5–97,5 % par (fichier, indicateur, k) + excès vs fichier nul |

## Indicateurs (correspondance avec l'avis G29 / CNIL, WP216)

| Critère G29 | Indicateur naïf | Indicateur proposé (robuste au déséquilibre) |
|---|---|---|
| Individualisation | taux d'unicité apparente | **VPP de l'isolement** (part des isolements qui désignent la bonne personne), rappel, F1 |
| Corrélation | taux de liaison exacte | **κ_L** : succès de liaison corrigé du hasard (1/N) et du plafond (cibles absentes du bootstrap) ; attaquant tolérant (plus proche concordance) |
| Inférence | accuracy | **MCC, accuracy équilibrée, gain d'AUPRC** `(AP − p)/(1 − p)`, gain d'accuracy sur la classe majoritaire |
| Synthèse | — | **nAUKC** : aire normalisée sous la courbe risque–connaissance ; excès vs fichier nul (100 %) |

## Conformité (RGPD, avis G29 05/2014, CNIL)

* `id_sejour`, `liste_diag`, `liste_acte` ne sont **jamais** utilisés par l'attaque ;
  l'identifiant sert uniquement à noter le succès.
* Seuls des **agrégats** sont écrits sur disque : aucune table de liaison
  individu ↔ enregistrement n'est produite.
* Les données sont fictives ; aucune donnée réelle de patient n'est nécessaire.
