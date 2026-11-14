/*
 * ESKİ STATİK MOCK — GERÇEK BACKEND'E BAĞLI DEĞİLDİR.
 *
 * Bu dosyadaki değerler demo/örnek veridir; fizik hesabı değildir.
 * Yeni frontend işleri ui-starter/ ve test_3b_viewer.html üzerinden yürür.
 * Buraya yeni özellik, API bağlantısı veya fizik eklemeyin.
 * Kurallar: AGENTS.md ve docs/FRONTEND_GUIDE.md.
 */
const profiles = {
  "Shackleton Rim": {
    light: 64, windows: 2, overlap: 18, dark: 11, sun: 8, earth: 14
  },
  "Connecting Ridge": {
    light: 58, windows: 3, overlap: 21, dark: 14, sun: 5, earth: 19
  },
  "Malapert Massif": {
    light: 71, windows: 1, overlap: 11, dark: 8, sun: 12, earth: 7
  },
  "Güney Ay (örnek)": {
    light: 52, windows: 2, overlap: 9, dark: 18, sun: 3, earth: 10
  },
  "Doğu Ay (örnek)": {
    light: 61, windows: 1, overlap: 13, dark: 13, sun: 9, earth: 4
  }
};

const $ = id => document.getElementById(id);

const main = {
  site: $("site"),
  date: $("date"),
  duration: $("duration")
};

const compare = {
  date: $("compareDate"),
  duration: $("compareDuration")
};

let playTimer = null;
let currentScenario;

function dateSeed(date) {
  return [...(date || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function formatDate(date) {
  if (!date) return "Tarih seçilmedi";

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}

async function syncWithCore() {
  if (typeof window.calculateMission !== "function") {
    console.warn("[JS UI] calculateMission köprüsü henüz hazır değil.");
    return;
  }

  const site = document.getElementById("site") ? document.getElementById("site").value : "Shackleton Rim";
  const date = document.getElementById("date") ? document.getElementById("date").value : "2026-10-18";
  const duration = document.getElementById("duration") ? document.getElementById("duration").value : "14";

  const requestData = JSON.stringify({ site: site, date: date, duration: duration });

  try {
    const responseJson = await window.calculateMission(requestData);
    const data = typeof responseJson === "string" ? JSON.parse(responseJson) : responseJson;

    console.log("[JS UI] Yanıt alındı:", data);

    if (document.getElementById("sunAngle") && data.sunAngle !== undefined) {
      document.getElementById("sunAngle").textContent = (data.sunAngle >= 0 ? "+" : "") + data.sunAngle + "°";
    }
    if (document.getElementById("earthAngle") && data.earthAngle !== undefined) {
      document.getElementById("earthAngle").textContent = (data.earthAngle >= 0 ? "+" : "") + data.earthAngle + "°";
    }
  } catch (err) {
    console.error("[JS UI] Köprü Çağrı Hatası:", err);
  }
}

// Olay Dinleyicileri
document.addEventListener("DOMContentLoaded", () => {
  const siteSelect = document.getElementById("site");
  const dateInput = document.getElementById("date");
  const durationSelect = document.getElementById("duration");

  if (siteSelect) siteSelect.addEventListener("change", syncWithCore);
  if (dateInput) dateInput.addEventListener("change", syncWithCore);
  if (durationSelect) durationSelect.addEventListener("change", syncWithCore);

  // Köprünün oturması için küçük bir gecikmeyle ilk senkronizasyonu yap
  setTimeout(syncWithCore, 100);
});

function makeSegments(result, type) {
  const count = type === "sun"
    ? Math.max(2, Math.round(result.days / 3))
    : result.windows;

  const width = type === "sun"
    ? Math.max(6, result.light / 5)
    : Math.max(5, result.overlap / Math.max(2, result.windows * 2));

  return Array.from({ length: count }, (_, i) => {
    const start = (
      i * (type === "sun" ? 29 : 37) +
      result.seed % 19 +
      (type === "earth" ? 12 : 0)
    ) % 90;

    return `<i class="segment ${type}"
      style="left:${start}%;width:${Math.min(width, 100 - start)}%"></i>`;
  }).join("");
}

function renderChart(result) {
  const ticks = [...new Set([
    1,
    Math.ceil(result.days / 4),
    Math.ceil(result.days / 2),
    Math.ceil(result.days * 0.75),
    result.days
  ])];

  $("timelineAxis").innerHTML =
    ticks.map(day => `<span>G${day}</span>`).join("");

  const sun = makeSegments(result, "sun");
  const earth = makeSegments(result, "earth");
  const overlap = makeSegments({
    ...result,
    windows: Math.max(1, Math.floor(result.windows / 2))
  }, "overlap");

  $("timelineRows").innerHTML = `
    <div class="chart-row">
      <label>Güneş ışığı</label>
      <div class="track">${sun}</div>
    </div>
    <div class="chart-row">
      <label>Dünya görüşü</label>
      <div class="track">${earth}</div>
    </div>
    <div class="chart-row">
      <label>Çakışma</label>
      <div class="track">${overlap}</div>
    </div>
  `;
}

function renderTable(site, date, days) {
  const rows = Object.keys(profiles)
    .map(name => ({ name, data: scenario(name, date, days) }))
    .sort((a, b) => b.data.overlap - a.data.overlap);

  $("comparisonRows").innerHTML = rows.map(({ name, data }, index) => `
    <tr class="${name === site ? "selected-row" : ""}">
      <td>
        <span class="rank">${index + 1}</span>
        ${name}${name === site ? " · seçili" : ""}
      </td>
      <td>${data.light}%</td>
      <td>${data.windows} aralık</td>
      <td>${data.overlap} sa</td>
      <td>${data.dark} sa</td>
      <td class="assessment">
        ${data.light > 65 ? "Aydınlanma yüksek" :
          data.windows > 2 ? "DTE aralığı sık" : "Dengeli profil"}
      </td>
    </tr>
  `).join("");
}

function syncControls(fromCompare = false) {
  if (fromCompare) {
    main.date.value = compare.date.value;
    main.duration.value = compare.duration.value;
  } else {
    compare.date.value = main.date.value;
    compare.duration.value = main.duration.value;
  }
}

function render(fromCompare = false) {
  syncControls(fromCompare);

  const site = main.site.value;
  const date = main.date.value;
  const days = Number(main.duration.value);

  currentScenario = scenario(site, date, days);
  const result = currentScenario;

  $("skySite").textContent = site.toUpperCase();
  $("dateLabel").textContent = formatDate(date);
  $("timelineTitle").textContent = `${days} günlük zaman çizelgesi`;
  $("illum").textContent = `${result.light}%`;
  $("windows").textContent = result.windows;
  $("overlap").textContent = `${result.overlap} sa`;
  $("darkGap").textContent = `${result.dark} sa`;

  const sunAngle = result.sun + (result.seed % 5) - 2;
  const earthAngle = result.earth + (result.seed % 7) - 3;

  $("sunAngle").textContent =
    `${sunAngle >= 0 ? "+" : ""}${sunAngle}°`;
  $("earthAngle").textContent =
    `${earthAngle >= 0 ? "+" : ""}${earthAngle}°`;

  $("sunObject").style.left = `${25 + result.seed % 27}%`;
  $("sunObject").style.top = `${48 - Math.min(21, result.sun)}%`;

  const terrain = Number($("terrain").value);
  $("terrainValue").textContent = terrain;
  $("terrainCaption").textContent = `${terrain}°`;

  const blocked = result.sun <= terrain;
  const alert = $("missionAlert");
  alert.className = `alert-box ${
    result.dark > 14 || blocked ? "warning" : "clear"
  }`;

  $("alertText").textContent = blocked
    ? "Seçilen örnek arazi ufku Güneş ışığını kısıtlıyor."
    : `En uzun karanlık dönem: ${result.dark} saat · DTE aralıkları: ${result.windows}.`;

  renderChart(result);
  renderTable(site, date, days);

  $("compareHeading").textContent =
    `${days} günlük saha özeti · ${formatDate(date)}`;
  $("durationLabel").textContent = `${days} gün`;

  updateTime();
}

function showPage(id) {
  document.querySelectorAll(".page").forEach(page => {
    page.hidden = page.id !== id;
  });

  document.querySelectorAll(".side-link").forEach(button => {
    button.classList.toggle("active", button.dataset.page === id);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateTime() {
  if (!currentScenario) return;

  const progress = Number($("timeSlider").value);
  const totalHours = Math.round(
    progress / 100 * currentScenario.days * 24
  );
  const day = Math.floor(totalHours / 24) + 1;
  const hour = totalHours % 24;

  const date = new Date(`${main.date.value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + day - 1);

  $("simDate").textContent =
    `${formatDate(date.toISOString().slice(0, 10))} · Görev günü ${day}`;
  $("timeReadout").textContent =
    `${String(hour).padStart(2, "0")}:00 UTC`;

  const phase = progress / 100 * Math.PI * 2;
  const sunHeight = Math.sin(phase - Math.PI / 2);
  const earthHeight = Math.sin(phase + 0.7);

  $("simSun").style.left = `${12 + (progress * 0.83) % 76}%`;
  $("simSun").style.top =
    `${Math.max(12, 48 - sunHeight * 30)}%`;
  $("simEarth").style.left = `${15 + (progress * 0.61 + 43) % 75}%`;
  $("simEarth").style.top =
    `${Math.max(10, 42 - earthHeight * 24)}%`;

  $("simSunAngle").textContent = `${Math.round(sunHeight * 25)}°`;
  $("simEarthAngle").textContent = `${Math.round(earthHeight * 20)}°`;

  const visibleSun =
    sunHeight * 25 > Number($("terrain").value);

  $("instantStatus").textContent = visibleSun
    ? "Güneş arazi ufkunun üzerinde"
    : "Güneş arazi ufkunun altında";

  $("instantDetail").textContent = earthHeight > 0
    ? "Dünya geometrik ufuk üzerinde; bağlantı garantisi değildir."
    : "Dünya bu örnek anda geometrik ufkun altında.";

  const watts = Math.max(0, Number($("panelWatts").value) || 0);
  const wattHours = Math.round(
    watts * currentScenario.light / 100 *
    currentScenario.days * 0.72
  );

  $("powerEstimate").textContent =
    `${wattHours.toLocaleString("tr-TR")} Wh`;
}

document.querySelectorAll(".side-link, [data-page]").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

$("compareBtn").addEventListener("click", () => {
  render();
  showPage("compare");
});

[main.site, main.date, main.duration].forEach(control => {
  control.addEventListener("change", () => render());
});

[compare.date, compare.duration].forEach(control => {
  control.addEventListener("change", () => render(true));
});

$("terrain").addEventListener("input", () => render());
$("timeSlider").addEventListener("input", updateTime);
$("panelWatts").addEventListener("input", updateTime);

$("playBtn").addEventListener("click", () => {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    $("playBtn").textContent = "▶ Başlat";
    return;
  }

  $("playBtn").textContent = "Ⅱ Duraklat";

  playTimer = setInterval(() => {
    const slider = $("timeSlider");
    slider.value = Number(slider.value) >= 100
      ? 0
      : Number(slider.value) + 1;

    updateTime();
  }, 250);
});

document.addEventListener("keydown", event => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;

  if (event.key === "1") showPage("overview");
  if (event.key === "2") showPage("timeline");
  if (event.key === "3") showPage("compare");
  if (event.key === "4") showPage("method");
  if (event.key === "Escape") showPage("overview");
});

render();


