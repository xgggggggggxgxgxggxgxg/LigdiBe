#!/usr/bin/env bash
# Chaîne complète : données -> indicateurs -> figures/tableaux.
# Si connaissances_externes.txt est présent dans /home/wajdi/Desktop/BDDS/M2MIAS/
# (ou $M2MIAS_DATA_DIR), ce sont ces fichiers qui sont analysés ; sinon une
# réplique fictive est générée dans data_fictive/.
set -euo pipefail
cd "$(dirname "$0")/simulations"
DATA="${M2MIAS_DATA_DIR:-/home/wajdi/Desktop/BDDS/M2MIAS/}"
if [ ! -f "$DATA/connaissances_externes.txt" ]; then
  echo "Fichiers du sujet absents de $DATA : génération d'une réplique fictive."
  python3 generate_fictive_data.py
fi
python3 run_experiments.py "$@"
python3 make_figures.py
echo "Terminé : voir ../results et ../figures"
