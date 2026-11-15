const TAU = Math.PI * 2;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function vector(value) {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(finite)) return value.slice(0, 3);
  if (!value || typeof value !== "object") return null;
  return vector(value.pos_km ?? value.position_km ?? value.position ?? value.pos ?? value.vec);
}

function magnitude(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value) {
  const length = magnitude(value);
  return length > 0 ? value.map((part) => part / length) : [0, 0, 0];
}

function siteVector(site, scene, moonRadius) {
  const direct = vector(site);
  if (direct) return direct;
  const namedPositions = scene?.positions?.sites;
  if (namedPositions && site?.name) {
    const named = Array.isArray(namedPositions)
      ? namedPositions.find((entry) => entry?.name === site.name)
      : namedPositions[site.name];
    const position = vector(named);
    if (position) return position;
  }
  if (!finite(site?.lat) || !finite(site?.lon)) return null;
  // Display-only spherical marker placement from backend lat/lon; no terrain or physics is derived.
  const latitude = site.lat * Math.PI / 180;
  const longitude = site.lon * Math.PI / 180;
  return [
    moonRadius * Math.cos(latitude) * Math.cos(longitude),
    moonRadius * Math.cos(latitude) * Math.sin(longitude),
    moonRadius * Math.sin(latitude),
  ];
}

function moonRadius(scene) {
  const moon = scene?.spice_bodies?.find((body) => body?.naif_id === 301 || body?.name === "Moon");
  if (finite(moon?.radius_km) && moon.radius_km > 0) return moon.radius_km;
  const positioned = [
    ...(scene?.trajectory || []).map((point) => vector(point)).filter(Boolean),
    vector(scene?.spacecraft),
  ].filter(Boolean);
  const maximum = positioned.length ? Math.max(...positioned.map(magnitude)) : 1;
  return maximum > 0 ? maximum : 1;
}

function extractExtraPositions(scene) {
  const positions = scene?.positions;
  const list = Array.isArray(positions) ? positions : positions?.points;
  if (!Array.isArray(list)) return [];
  return list.map((entry, index) => ({
    name: String(entry?.name || `Position ${index + 1}`),
    color: typeof entry?.color === "string" ? entry.color : "#a9c7d8",
    position: vector(entry),
  })).filter((entry) => entry.position);
}

export class SceneView {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.selectedIndex = 0;
    this.yaw = -0.55;
    this.pitch = -0.32;
    this.zoom = 1;
    this.drag = null;
    this.bindControls();
  }

  bindControls() {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.drag = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.drag) return;
      const deltaX = event.clientX - this.drag.x;
      const deltaY = event.clientY - this.drag.y;
      this.drag = { x: event.clientX, y: event.clientY };
      this.yaw += deltaX * 0.008;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + deltaY * 0.008));
      this.draw();
    });
    const stopDrag = () => { this.drag = null; };
    this.canvas.addEventListener("pointerup", stopDrag);
    this.canvas.addEventListener("pointercancel", stopDrag);
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.setZoom(this.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
    }, { passive: false });
    this.canvas.addEventListener("keydown", (event) => {
      const actions = {
        ArrowLeft: () => { this.yaw -= 0.12; },
        ArrowRight: () => { this.yaw += 0.12; },
        ArrowUp: () => { this.pitch = Math.max(-1.45, this.pitch - 0.12); },
        ArrowDown: () => { this.pitch = Math.min(1.45, this.pitch + 0.12); },
        "+": () => this.setZoom(this.zoom * 1.15),
        "=": () => this.setZoom(this.zoom * 1.15),
        "-": () => this.setZoom(this.zoom / 1.15),
        Home: () => this.reset(),
      };
      if (!actions[event.key]) return;
      event.preventDefault();
      actions[event.key]();
      this.draw();
    });
  }

  setZoom(value) {
    this.zoom = Math.max(0.55, Math.min(3.5, value));
  }

  reset() {
    this.yaw = -0.55;
    this.pitch = -0.32;
    this.zoom = 1;
    this.draw();
  }

  setScene(scene, selectedIndex = 0) {
    this.scene = scene;
    this.selectedIndex = selectedIndex;
    this.draw();
  }

  setSelectedIndex(index) {
    this.selectedIndex = index;
    this.draw();
  }

  project(position, scale, centerX, centerY) {
    const [x, y, z] = position;
    const cosineYaw = Math.cos(this.yaw);
    const sineYaw = Math.sin(this.yaw);
    const x1 = cosineYaw * x - sineYaw * y;
    const y1 = sineYaw * x + cosineYaw * y;
    const cosinePitch = Math.cos(this.pitch);
    const sinePitch = Math.sin(this.pitch);
    const y2 = cosinePitch * y1 - sinePitch * z;
    const depth = sinePitch * y1 + cosinePitch * z;
    return { x: centerX + x1 * scale, y: centerY - y2 * scale, depth };
  }

  prepare() {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width < 20 || bounds.height < 20) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(bounds.width);
    const height = Math.round(bounds.height);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    const context = this.canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";
    return { context, width, height };
  }

  drawDirection(context, vectorValue, color, label, x, y) {
    const direction = vector(vectorValue);
    if (!direction) return;
    const unit = normalize(direction);
    const projected = this.project(unit, 33, 0, 0);
    const endX = x + (projected.x);
    const endY = y + (projected.y);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(endX, endY);
    context.stroke();
    context.beginPath();
    context.arc(endX, endY, 3, 0, TAU);
    context.fill();
    context.font = "8px Consolas, monospace";
    context.textAlign = "left";
    context.fillText(label, x - 13, y + 45);
  }

  draw() {
    const surface = this.prepare();
    if (!surface) return;
    const { context, width, height } = surface;
    const background = context.createRadialGradient(width * 0.45, height * 0.45, 10, width * 0.5, height * 0.5, Math.max(width, height) * 0.7);
    background.addColorStop(0, "#101d29");
    background.addColorStop(0.55, "#080e16");
    background.addColorStop(1, "#05090e");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    if (!this.scene) {
      context.fillStyle = "#718595";
      context.font = "11px Consolas, monospace";
      context.textAlign = "center";
      context.fillText("3B scene data is not available", width / 2, height / 2);
      return;
    }

    const scene = this.scene;
    const radius = moonRadius(scene);
    const trajectory = Array.isArray(scene.trajectory) ? scene.trajectory : [];
    const trajectoryPositions = trajectory.map((point) => vector(point));
    const spacecraftPosition = vector(scene.spacecraft) || vector(scene.positions?.spacecraft);
    const positionedMagnitudes = [...trajectoryPositions.filter(Boolean), spacecraftPosition].filter(Boolean).map(magnitude);
    const extent = Math.max(radius * 1.12, ...positionedMagnitudes) * 1.12;
    const scale = (Math.min(width, height) * 0.39 * this.zoom) / extent;
    const centerX = width * 0.49;
    const centerY = height * 0.49;
    const screenRadius = radius * scale;

    const halo = context.createRadialGradient(centerX, centerY, screenRadius * 0.65, centerX, centerY, screenRadius * 1.35);
    halo.addColorStop(0, "rgba(87, 133, 158, 0)");
    halo.addColorStop(0.78, "rgba(87, 133, 158, 0.07)");
    halo.addColorStop(1, "rgba(87, 133, 158, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(centerX, centerY, screenRadius * 1.35, 0, TAU);
    context.fill();

    const moonShade = context.createRadialGradient(
      centerX - screenRadius * 0.35,
      centerY - screenRadius * 0.4,
      screenRadius * 0.05,
      centerX,
      centerY,
      screenRadius,
    );
    moonShade.addColorStop(0, "#8796a0");
    moonShade.addColorStop(0.38, "#4d5c66");
    moonShade.addColorStop(0.78, "#202d36");
    moonShade.addColorStop(1, "#101820");
    context.fillStyle = moonShade;
    context.beginPath();
    context.arc(centerX, centerY, screenRadius, 0, TAU);
    context.fill();
    context.strokeStyle = "#78909e";
    context.globalAlpha = 0.55;
    context.stroke();
    context.globalAlpha = 1;

    context.save();
    context.strokeStyle = "rgba(151, 177, 192, 0.13)";
    context.lineWidth = 1;
    for (const factor of [0.33, 0.66]) {
      context.beginPath();
      context.ellipse(centerX, centerY, screenRadius, screenRadius * factor, 0, 0, TAU);
      context.stroke();
      context.beginPath();
      context.ellipse(centerX, centerY, screenRadius * factor, screenRadius, 0, 0, TAU);
      context.stroke();
    }
    context.restore();

    const drawTrajectoryPart = (endIndex, color, lineWidth) => {
      context.beginPath();
      let started = false;
      trajectoryPositions.slice(0, endIndex + 1).forEach((position) => {
        if (!position) { started = false; return; }
        const point = this.project(position, scale, centerX, centerY);
        if (!started) { context.moveTo(point.x, point.y); started = true; }
        else context.lineTo(point.x, point.y);
      });
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.stroke();
    };
    if (trajectoryPositions.some(Boolean)) {
      drawTrajectoryPart(trajectoryPositions.length - 1, "rgba(93, 170, 208, 0.35)", 1.2);
      drawTrajectoryPart(Math.min(this.selectedIndex, trajectoryPositions.length - 1), "#78d2f4", 2.2);
    }

    const sites = Array.isArray(scene.sites) ? scene.sites : [];
    const selectedName = scene.selected_site?.name;
    for (const site of sites) {
      const position = siteVector(site, scene, radius);
      if (!position) continue;
      const point = this.project(position, scale, centerX, centerY);
      const selected = site.name === selectedName;
      const front = point.depth >= 0;
      context.globalAlpha = front || selected ? 1 : 0.25;
      context.fillStyle = selected ? "#f4c96d" : "#b9d8e7";
      context.beginPath();
      context.arc(point.x, point.y, selected ? 4 : 2.5, 0, TAU);
      context.fill();
      if (selected) {
        context.strokeStyle = "#f4c96d";
        context.beginPath();
        context.arc(point.x, point.y, 8, 0, TAU);
        context.stroke();
      }
      if (front || selected) {
        context.font = selected ? "9px Consolas, monospace" : "8px Consolas, monospace";
        context.textAlign = "left";
        context.fillText(site.name || "Site", point.x + 8, point.y - 7);
      }
      context.globalAlpha = 1;
    }

    for (const entry of extractExtraPositions(scene)) {
      const point = this.project(entry.position, scale, centerX, centerY);
      context.fillStyle = entry.color;
      context.beginPath();
      context.arc(point.x, point.y, 3, 0, TAU);
      context.fill();
      context.font = "8px Consolas, monospace";
      context.textAlign = "left";
      context.fillText(entry.name, point.x + 7, point.y - 5);
    }

    const activePosition = trajectoryPositions[this.selectedIndex] || spacecraftPosition;
    if (activePosition) {
      const point = this.project(activePosition, scale, centerX, centerY);
      context.save();
      context.translate(point.x, point.y);
      context.rotate(Math.PI / 4);
      context.fillStyle = "#ffffff";
      context.shadowColor = "#63c5f2";
      context.shadowBlur = 12;
      context.fillRect(-4, -4, 8, 8);
      context.restore();
      context.fillStyle = "#d9f2ff";
      context.font = "9px Consolas, monospace";
      context.textAlign = "left";
      context.fillText("SPACECRAFT", point.x + 10, point.y + 3);
    }

    this.drawDirection(context, scene.sun?.vec, "#f4c96d", "SUN", 48, 54);
    this.drawDirection(context, scene.earth?.vec, "#65a9f5", "EARTH", 48, 124);

    context.fillStyle = "#60798b";
    context.font = "8px Consolas, monospace";
    context.textAlign = "left";
    context.fillText(scene.frame || "FRAME NOT REPORTED", 14, height - 16);
    context.textAlign = "right";
    context.fillText("DIRECT POSITION PROJECTION / NOT A PHYSICS REPLAY", width - 14, height - 16);
  }
}
