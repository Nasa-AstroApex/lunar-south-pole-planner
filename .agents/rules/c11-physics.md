---
trigger: glob
globs: "src/**/*.c, src/**/*.h, Makefile"
---
- Fizik, NAIF CSPICE efemeris, IAU_MOON donusumleri ve ZEM/ZEV inis hesaplamalari C11 cekirdeginde tek kaynaktir.
- Derleme ve dogrulama icin yalnizca `make`, `make test` ve `make asan` komutlarini kullan.
