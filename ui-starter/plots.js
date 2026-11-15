const COLORS = {
  text: "#9db0bf",
  dim: "#617789",
  grid: "#203240",
  gridStrong: "#2b414f",
  terrain: "#536b7b",
  terrainFill: "rgba(66, 88, 103, 0.28)",
  sun: "#f4c96d",
  earth: "#65a9f5",
  cursor: "#d5e6ef",
};

function prepareCanvas(canvas) {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width < 20 || bounds.height < 20) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  return { context, width, height };
}

function emptyPlot(canvas, message) {
  const surface = prepareCanvas(canvas);
  if (!surface) return;
  const { context, width, height } = surface;
  context.fillStyle = COLORS.dim;
  context.font = "11px Consolas, monospace";
  context.textAlign = "center";
  context.fillText(message, width / 2, height / 2);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseUtc(value) {
  if (typeof value !== "string" || !value) return NaN;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return Date.parse(hasZone ? value : `${value}Z`);
}

function normalizedAzimuth(value) {
  return ((value % 360) + 360) % 360;
}

function drawBodyMarker(context, x, y, color, label, elevation, isSun) {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 12;
  context.beginPath();
  context.arc(x, y, isSun ? 6 : 5.5, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  if (isSun) {
    context.globalAlpha = 0.65;
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * 9, y + Math.sin(angle) * 9);
      context.lineTo(x + Math.cos(angle) * 12, y + Math.sin(angle) * 12);
      context.stroke();
    }
    context.globalAlpha = 1;
  } else {
    context.fillStyle = "#b9e2f4";
    context.beginPath();
    context.arc(x - 1.5, y - 1.5, 1.5, 0, Math.PI * 2);
    context.fill();
  }
  const text = `${label} ${elevation.toFixed(2)}°`;
  context.font = "9px Consolas, monospace";
  const textWidth = context.measureText(text).width;
  const canvasWidth = context.canvas.clientWidth;
  const textX = Math.max(5, Math.min(x + 10, canvasWidth - textWidth - 6));
  context.fillStyle = color;
  context.textAlign = "left";
  context.fillText(text, textX, y - 11);
  context.restore();
}

export function drawHorizon(canvas, data, sampleIndex) {
  const mask = Array.isArray(data?.terrain_horizon_mask)
    ? data.terrain_horizon_mask.filter(finite)
    : [];
  const samples = Array.isArray(data?.samples) ? data.samples : [];
  const sample = samples[sampleIndex];
  if (!mask.length && !sample) {
    emptyPlot(canvas, "Horizon and sample data are not available");
    return;
  }
  const surface = prepareCanvas(canvas);
  if (!surface) return;
  const { context, width, height } = surface;
  const margin = { left: 48, right: 22, top: 27, bottom: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const elevations = [...mask];
  for (const key of ["sun_elevation_deg", "earth_elevation_deg"]) {
    if (finite(sample?.[key])) elevations.push(sample[key]);
  }
  let minimum = Math.min(0, ...elevations);
  let maximum = Math.max(5, ...elevations);
  const padding = Math.max(1, (maximum - minimum) * 0.12);
  minimum -= padding;
  maximum += padding;
  const xForAzimuth = (azimuth) => margin.left + (azimuth / 360) * plotWidth;
  const yForElevation = (elevation) => margin.top + ((maximum - elevation) / (maximum - minimum)) * plotHeight;

  context.fillStyle = "#080e15";
  context.fillRect(0, 0, width, height);
  context.font = "8px Consolas, monospace";
  context.lineWidth = 1;

  for (let tick = 0; tick <= 5; tick += 1) {
    const elevation = minimum + ((maximum - minimum) * tick) / 5;
    const y = yForElevation(elevation);
    context.strokeStyle = Math.abs(elevation) < (maximum - minimum) / 10 ? COLORS.gridStrong : COLORS.grid;
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(width - margin.right, y);
    context.stroke();
    context.fillStyle = COLORS.dim;
    context.textAlign = "right";
    context.fillText(`${elevation.toFixed(0)}°`, margin.left - 8, y + 3);
  }

  const cardinals = [[0, "N"], [90, "E"], [180, "S"], [270, "W"], [360, "N"]];
  for (const [azimuth, label] of cardinals) {
    const x = xForAzimuth(azimuth);
    context.strokeStyle = COLORS.grid;
    context.beginPath();
    context.moveTo(x, margin.top);
    context.lineTo(x, height - margin.bottom);
    context.stroke();
    context.fillStyle = COLORS.text;
    context.textAlign = "center";
    context.fillText(`${label} ${azimuth % 360}°`, x, height - 20);
  }
  context.fillStyle = COLORS.dim;
  context.textAlign = "left";
  context.fillText("ELEVATION", 5, 14);
  context.textAlign = "right";
  context.fillText("AZIMUTH / 360°", width - margin.right, 14);

  if (mask.length) {
    const points = mask.map((elevation, index) => {
      const azimuth = mask.length === 360 ? index : (index / Math.max(1, mask.length - 1)) * 360;
      return [xForAzimuth(azimuth), yForElevation(elevation)];
    });
    if (mask.length === 360) points.push([xForAzimuth(360), points[0][1]]);
    context.beginPath();
    context.moveTo(points[0][0], height - margin.bottom);
    for (const [x, y] of points) context.lineTo(x, y);
    context.lineTo(points[points.length - 1][0], height - margin.bottom);
    context.closePath();
    context.fillStyle = COLORS.terrainFill;
    context.fill();
    context.beginPath();
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
    context.strokeStyle = "#8296a4";
    context.lineWidth = 1.5;
    context.stroke();
  }

  if (sample) {
    if (finite(sample.sun_azimuth_deg) && finite(sample.sun_elevation_deg)) {
      const azimuth = normalizedAzimuth(sample.sun_azimuth_deg);
      const x = xForAzimuth(azimuth);
      const y = yForElevation(sample.sun_elevation_deg);
      context.save();
      context.setLineDash([3, 5]);
      context.strokeStyle = "rgba(244, 201, 109, 0.25)";
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, height - margin.bottom);
      context.stroke();
      context.restore();
      drawBodyMarker(context, x, y, COLORS.sun, "SUN", sample.sun_elevation_deg, true);
    }
    if (finite(sample.earth_azimuth_deg) && finite(sample.earth_elevation_deg)) {
      const azimuth = normalizedAzimuth(sample.earth_azimuth_deg);
      const x = xForAzimuth(azimuth);
      const y = yForElevation(sample.earth_elevation_deg);
      context.save();
      context.setLineDash([3, 5]);
      context.strokeStyle = "rgba(101, 169, 245, 0.25)";
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, height - margin.bottom);
      context.stroke();
      context.restore();
      drawBodyMarker(context, x, y, COLORS.earth, "EARTH", sample.earth_elevation_deg, false);
    }
  }
}

function traceElevation(context, samples, key, times, domainStart, domainEnd, xForTime, yForElevation, color) {
  context.beginPath();
  let drawing = false;
  samples.forEach((sample, index) => {
    if (!finite(sample?.[key]) || !Number.isFinite(times[index])) {
      drawing = false;
      return;
    }
    const x = xForTime(times[index]);
    const y = yForElevation(sample[key]);
    if (!drawing || times[index] < domainStart || times[index] > domainEnd) {
      context.moveTo(x, y);
      drawing = true;
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = color;
  context.lineWidth = 1.4;
  context.stroke();
}

function drawWindowLanes(context, windows, label, y, laneHeight, color, xForTime, left, right) {
  context.fillStyle = COLORS.text;
  context.font = "8px Consolas, monospace";
  context.textAlign = "right";
  context.fillText(label, left - 10, y + 10);
  context.fillStyle = "#0d161e";
  context.fillRect(left, y, right - left, laneHeight);
  context.strokeStyle = COLORS.grid;
  context.strokeRect(left, y, right - left, laneHeight);
  let drawn = 0;
  for (const window of windows) {
    const start = parseUtc(window?.start_utc);
    const end = parseUtc(window?.end_utc);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const x1 = Math.max(left, xForTime(Math.min(start, end)));
    const x2 = Math.min(right, xForTime(Math.max(start, end)));
    if (x2 < left || x1 > right) continue;
    context.fillStyle = color;
    context.globalAlpha = 0.72;
    context.fillRect(x1, y + 3, Math.max(1.5, x2 - x1), laneHeight - 6);
    context.globalAlpha = 1;
    drawn += 1;
  }
  if (!drawn) {
    context.fillStyle = COLORS.dim;
    context.textAlign = "left";
    context.fillText("No windows reported", left + 7, y + 11);
  }
}

export function drawTimeline(canvas, data, sampleIndex) {
  const samples = Array.isArray(data?.samples) ? data.samples : [];
  const sunWindows = Array.isArray(data?.windows?.sun) ? data.windows.sun : [];
  const earthWindows = Array.isArray(data?.windows?.earth) ? data.windows.earth : [];
  if (!samples.length && !sunWindows.length && !earthWindows.length) {
    emptyPlot(canvas, "Timeline samples and windows are not available");
    return;
  }
  const surface = prepareCanvas(canvas);
  if (!surface) return;
  const { context, width, height } = surface;
  const times = samples.map((sample) => parseUtc(sample?.utc));
  const domainValues = times.filter(Number.isFinite);
  for (const window of [...sunWindows, ...earthWindows]) {
    const start = parseUtc(window?.start_utc);
    const end = parseUtc(window?.end_utc);
    if (Number.isFinite(start)) domainValues.push(start);
    if (Number.isFinite(end)) domainValues.push(end);
  }
  const metaStart = parseUtc(data?.meta?.start_utc || data?.metadata?.start_utc);
  const metaEnd = parseUtc(data?.meta?.end_utc || data?.metadata?.end_utc);
  if (Number.isFinite(metaStart)) domainValues.push(metaStart);
  if (Number.isFinite(metaEnd)) domainValues.push(metaEnd);
  if (!domainValues.length) {
    emptyPlot(canvas, "Timeline timestamps are not available");
    return;
  }
  const domainStart = Math.min(...domainValues);
  let domainEnd = Math.max(...domainValues);
  if (domainEnd === domainStart) domainEnd += 3_600_000;
  const margin = { left: 58, right: 22, top: 18, bottom: 28 };
  const right = width - margin.right;
  const plotWidth = right - margin.left;
  const laneHeight = 18;
  const sunLaneY = margin.top + 7;
  const earthLaneY = sunLaneY + 27;
  const chartTop = earthLaneY + 40;
  const chartBottom = height - margin.bottom;
  const chartHeight = Math.max(30, chartBottom - chartTop);
  const xForTime = (time) => margin.left + ((time - domainStart) / (domainEnd - domainStart)) * plotWidth;
  const elevations = [0];
  for (const sample of samples) {
    if (finite(sample?.sun_elevation_deg)) elevations.push(sample.sun_elevation_deg);
    if (finite(sample?.earth_elevation_deg)) elevations.push(sample.earth_elevation_deg);
  }
  let minimum = Math.min(...elevations);
  let maximum = Math.max(...elevations);
  const padding = Math.max(1, (maximum - minimum) * 0.15);
  minimum -= padding;
  maximum += padding;
  const yForElevation = (elevation) => chartTop + ((maximum - elevation) / (maximum - minimum)) * chartHeight;

  context.fillStyle = "#080e15";
  context.fillRect(0, 0, width, height);
  drawWindowLanes(context, sunWindows, "SUN", sunLaneY, laneHeight, COLORS.sun, xForTime, margin.left, right);
  drawWindowLanes(context, earthWindows, "EARTH", earthLaneY, laneHeight, COLORS.earth, xForTime, margin.left, right);

  context.font = "8px Consolas, monospace";
  for (let tick = 0; tick <= 4; tick += 1) {
    const elevation = minimum + ((maximum - minimum) * tick) / 4;
    const y = yForElevation(elevation);
    context.strokeStyle = COLORS.grid;
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(right, y);
    context.stroke();
    context.fillStyle = COLORS.dim;
    context.textAlign = "right";
    context.fillText(`${elevation.toFixed(0)}°`, margin.left - 8, y + 3);
  }
  for (let tick = 0; tick <= 5; tick += 1) {
    const time = domainStart + ((domainEnd - domainStart) * tick) / 5;
    const x = xForTime(time);
    context.strokeStyle = COLORS.grid;
    context.beginPath();
    context.moveTo(x, chartTop);
    context.lineTo(x, chartBottom);
    context.stroke();
    const date = new Date(time);
    const label = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
    context.fillStyle = COLORS.dim;
    context.textAlign = tick === 0 ? "left" : tick === 5 ? "right" : "center";
    context.fillText(label, x, height - 10);
  }

  traceElevation(context, samples, "sun_elevation_deg", times, domainStart, domainEnd, xForTime, yForElevation, COLORS.sun);
  traceElevation(context, samples, "earth_elevation_deg", times, domainStart, domainEnd, xForTime, yForElevation, COLORS.earth);

  const selectedTime = times[sampleIndex];
  if (Number.isFinite(selectedTime)) {
    const x = xForTime(selectedTime);
    context.save();
    context.setLineDash([4, 4]);
    context.strokeStyle = COLORS.cursor;
    context.globalAlpha = 0.7;
    context.beginPath();
    context.moveTo(x, margin.top);
    context.lineTo(x, chartBottom);
    context.stroke();
    context.restore();
    const sample = samples[sampleIndex];
    for (const [key, color] of [["sun_elevation_deg", COLORS.sun], ["earth_elevation_deg", COLORS.earth]]) {
      if (!finite(sample?.[key])) continue;
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, yForElevation(sample[key]), 3.5, 0, Math.PI * 2);
      context.fill();
    }
  }
}
