"""Configuration commune des simulations (M2 MIAS, sujet Pr E. Chazard, février 2026).

Par défaut, les scripts cherchent les fichiers du sujet dans DATA_DIR
(connaissances_externes.txt, out_direct_XX.txt, out_sample_XX.txt).
S'ils sont absents, `generate_fictive_data.py` produit une réplique fictive
de même structure dans FICTIVE_DIR afin que toute la chaîne reste exécutable.
"""
from pathlib import Path
import os

# Chemin demandé ; surcharge possible : export M2MIAS_DATA_DIR=/autre/chemin
DATA_DIR = Path(os.environ.get("M2MIAS_DATA_DIR", "/home/wajdi/Desktop/BDDS/M2MIAS/"))
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # dossier M2MIAS/ une fois l'archive décompressée
FICTIVE_DIR = ROOT / "data_fictive"
RESULTS_DIR = ROOT / "results"
FIGURES_DIR = ROOT / "figures"

EXTERNAL_FILE = "connaissances_externes.txt"
ID_COL = "id_sejour"
# Variables que l'attaquant n'est pas censé connaître (barrées dans le sujet)
HIDDEN_COLS = ["id_sejour", "liste_diag", "liste_acte"]

# Chaînes de variables imbriquées : l'ordre interne est imposé (grossier -> fin)
CHAINS = [
    ["age10", "age5", "age"],
    ["entree_date_y", "entree_date_ym", "entree_date_ymd"],
    ["sortie_date_y", "sortie_date_ym", "sortie_date_ymd"],
]
SINGLETONS_QI = ["sexe", "entree_mode", "sortie_mode", "specialite"]
SENSITIVE = ["chirurgie", "diabete", "insuffisance_renale", "demence"]

# Scénario A (individualisation, corrélation) : toutes les variables connaissables
SCENARIO_A_SINGLETONS = SINGLETONS_QI + SENSITIVE
# Scénario B (inférence) : l'attaquant connaît des quasi-identifiants et
# cherche à inférer les attributs sensibles (déséquilibrés) de SENSITIVE.
SCENARIO_B_SINGLETONS = SINGLETONS_QI

N_ORDERS = int(os.environ.get("M2MIAS_N_ORDERS", 25))  # ordres aléatoires de révélation
SEED = 20260214
