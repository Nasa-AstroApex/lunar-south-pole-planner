#!/usr/bin/env bash
set -euo pipefail

echo "[BUILD] Lunar South Pole Planner derleniyor..."
make -j"$(nproc 2>/dev/null || echo 2)"
echo "[TEST] Birim ve fizik dogrulama testleri calistiriliyor..."
make test
echo "[OK] Derleme ve testler basariyla tamamlandi."