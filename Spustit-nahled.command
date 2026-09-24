#!/bin/zsh
# Dvojklikem spustí místní náhled webu janrehacek.com a otevře ho v prohlížeči.
# Nic se nenasazuje — běží to jen na tomhle počítači.
cd "$(dirname "$0")"
echo ""
echo "  Spouštím náhled webu janrehacek.com…"
echo ""
(sleep 1 && open "http://localhost:4200") &
node nahled.js
