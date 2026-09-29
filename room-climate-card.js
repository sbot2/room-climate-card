/* Room Climate Card
 * Dynamically discovers rooms, floors, temperature and humidity sensors.
 * No Jinja, auto-entities or manually maintained entity lists are required.
 */

class RoomClimateCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {};
    this._areas = [];
    this._floors = [];
    this._entities = [];
    this._devices = [];
    this._selectedArea = null;
    this._registryLoaded = false;
    this._loading = false;
    this._subscriptions = [];
    this._bound = false;
    this._history = new Map();
    this._historyLoading = false;
    this._range = 24;
  }

  setConfig(config) {
    this._config = {
      title: "Temperaturen/Luftfeuchtigkeit",
      columns: 2,
      ...config,
    };
    if (this._config.exclude_areas === undefined) {
      this._config.exclude_areas = ["fussboden", "fußboden"];
    }
    if (typeof this._config.exclude_areas === "string") {
      this._config.exclude_areas = this._config.exclude_areas
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    } else if (!Array.isArray(this._config.exclude_areas)) {
      this._config.exclude_areas = [];
    }
    this._render();
  }

  set hass(value) {
    this._hass = value;
    if (!this._registryLoaded && !this._loading) {
      this._loadRegistry();
    }
    this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._render();
    if (this._hass && !this._registryLoaded && !this._loading) {
      this._loadRegistry();
    }
    this._subscribeRegistryEvents();
  }

  disconnectedCallback() {
    for (const unsubscribe of this._subscriptions) {
      try {
        unsubscribe();
      } catch (_) {}
    }
    this._subscriptions = [];
    this._bound = false;
    this._history = new Map();
    this._historyLoading = false;
  }

  getGridOptions() {
    return {
      columns: 12,
      rows: 6,
      min_columns: 6,
      min_rows: 3,
    };
  }

  getCardSize() {
    return 5;
  }

  async _loadRegistry() {
    if (!this._hass || this._loading) return;
    this._loading = true;

    try {
      const [areas, floors, entities, devices] = await Promise.all([
        this._hass.callWS({ type: "config/area_registry/list" }),
        this._hass.callWS({ type: "config/floor_registry/list" }),
        this._hass.callWS({ type: "config/entity_registry/list" }),
        this._hass.callWS({ type: "config/device_registry/list" }),
      ]);

      this._areas = areas || [];
      this._floors = floors || [];
      this._entities = entities || [];
      this._devices = devices || [];
      this._registryLoaded = true;
    } catch (error) {
      console.error("Room Climate Card: registry loading failed", error);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _subscribeRegistryEvents() {
    if (this._bound || !this._hass?.connection) return;
    this._bound = true;

    const eventTypes = [
      "area_registry_updated",
      "floor_registry_updated",
      "entity_registry_updated",
      "device_registry_updated",
    ];

    for (const eventType of eventTypes) {
      try {
        const unsubscribe = await this._hass.connection.subscribeEvents(
          () => {
            this._registryLoaded = false;
            this._loadRegistry();
          },
          eventType
        );
        this._subscriptions.push(unsubscribe);
      } catch (error) {
        console.warn(
          `Room Climate Card: could not subscribe to ${eventType}`,
          error
        );
      }
    }
  }

  _excludedArea(area) {
    const excluded = this._config.exclude_areas.map((x) =>
      String(x).trim().toLowerCase()
    );
    const floor = this._floorForArea(area);
    const candidates = [
      area.name,
      area.area_id,
      floor?.name,
      floor?.floor_id,
    ]
      .filter((x) => x != null)
      .map((x) => String(x).trim().toLowerCase());
    return candidates.some((candidate) => excluded.includes(candidate));
  }

  _deviceAreaId(deviceId) {
    const seen = new Set();
    let id = deviceId;

    for (let i = 0; i < 20 && id && !seen.has(id); i++) {
      seen.add(id);
      const device = this._devices.find((d) => d.id === id);
      if (!device) return null;

      if (device.area_id) return device.area_id;

      id = device.parent_device_id || device.via_device_id || null;
    }

    return null;
  }

  _entityAreaId(entry) {
    return entry.area_id || this._deviceAreaId(entry.device_id);
  }

  _numericState(entityId) {
    const state = this._hass?.states?.[entityId];
    if (!state) return null;

    const value = Number.parseFloat(state.state);
    if (!Number.isFinite(value)) return null;

    if (state.state === "unknown" || state.state === "unavailable") {
      return null;
    }

    return value;
  }

  _friendlyName(entityId) {
    const state = this._hass?.states?.[entityId];
    return state?.attributes?.friendly_name || entityId;
  }

  _roomData() {
    const areas = new Map(
      this._areas
        .filter((area) => !this._excludedArea(area))
        .map((area) => [area.area_id, area])
    );
    const roomMap = new Map();
    for (const entry of this._entities) {
      const entityId = entry.entity_id;
      if (!entityId) continue;
      if (entry.disabled_by) continue;
      const state = this._hass?.states?.[entityId];
      if (!state) continue;

      const isSensor = entityId.startsWith("sensor.");
      const isClimate = entityId.startsWith("climate.");
      if (!isSensor && !isClimate) continue;

      const areaId = this._entityAreaId(entry);
      if (!areaId || !areas.has(areaId)) continue;

      if (!roomMap.has(areaId)) {
        roomMap.set(areaId, {
          area: areas.get(areaId),
          temperature: [],
          humidity: [],
          climate: [],
          deviceIds: new Set(),
        });
      }
      const room = roomMap.get(areaId);

      if (isClimate) {
        room.climate.push({
          entityId,
          name: this._friendlyName(entityId),
          deviceId: entry.device_id || null,
        });
        continue;
      }

      const deviceClass = state.attributes?.device_class;
      if (deviceClass !== "temperature" && deviceClass !== "humidity") {
        continue;
      }

      // Gerät IMMER zum Set hinzufügen
      if (entry.device_id) {
        room.deviceIds.add(entry.device_id);
      } else {
        // Für Templatesensoren ohne Gerätezuordnung die entity_id als eindeutige ID verwenden
        room.deviceIds.add(`sensor:${entityId}`);
      }

      // Wert nur zum Array hinzufügen, wenn er gültig ist
      const value = this._numericState(entityId);
      if (value === null) continue;

      room[deviceClass === "temperature" ? "temperature" : "humidity"].push({
        entityId,
        name: this._friendlyName(entityId),
        value,
        deviceId: entry.device_id || null,
      });
    }
    return [...roomMap.values()]
      .filter(
        (room) =>
          room.temperature.length > 0 ||
          room.humidity.length > 0 ||
          room.climate.length > 0
      )
      .map((room) => ({
        ...room,
        tempAverage: this._average(room.temperature),
        humidityAverage: this._average(room.humidity),
        deviceCount: room.deviceIds.size,
      }));
  }

  _average(items) {
    if (!items.length) return null;
    return items.reduce((sum, item) => sum + item.value, 0) / items.length;
  }

  _climateState(climate) {
    return this._hass?.states?.[climate.entityId];
  }

  _callService(domain, service, entityIds, data) {
    return this._hass?.callService(domain, service, {
      entity_id: entityIds,
      ...data,
    });
  }

  _setTemperature(climate, value) {
    return this._callService("climate", "set_temperature", [climate.entityId], {
      temperature: value,
    });
  }

  _setHvacMode(climate, mode) {
    return this._callService("climate", "set_hvac_mode", [climate.entityId], {
      hvac_mode: mode,
    });
  }

  _climateControl(room) {
    if (!room.climate.length) return "";

    const controls = room.climate.map((climate) => {
      const st = this._climateState(climate);
      if (!st) return "";
      const a = st.attributes || {};
      const minTemp = Number(a.min_temp);
      const maxTemp = Number(a.max_temp);
      const current = Number(a.temperature);
      const target = Number(a.temperature ?? this._hass.states?.[climate.entityId]?.state);

      const hvacModes = Array.isArray(a.hvac_modes)
        ? a.hvac_modes
        : ["off", "heat", "cool", "auto"];
      const currentMode = st.state;

      const modeButtons = hvacModes.map(
        (mode) => `
          <button
            class="hvac-mode ${mode === currentMode ? "active" : ""}"
            data-hvac="${this._escape(climate.entityId)}"
            data-mode="${this._escape(mode)}"
          >${this._escape(mode)}</button>
        `
      ).join("");

      const tempButtons = [];
      if (Number.isFinite(minTemp) && Number.isFinite(maxTemp) && Number.isFinite(target)) {
        tempButtons.push(
          `<button class="temp-btn minus" data-temp="${this._escape(climate.entityId)}" data-delta="-1">−</button>`,
          `<span class="temp-value">${this._format(target, 1)} °C</span>`,
          `<button class="temp-btn plus" data-temp="${this._escape(climate.entityId)}" data-delta="1">+</button>`
        );
      } else {
        tempButtons.push(`<span class="temp-value">${this._format(current, 1)} °C</span>`);
      }

      return `
        <div class="climate-control">
          <div class="climate-name">${this._escape(climate.name)}</div>
          <div class="climate-modes">${modeButtons}</div>
          <div class="climate-temp">${tempButtons.join("")}</div>
        </div>
      `;
    });

    return `
      <section class="climate-section">
        <h3>🌡 Klimasteuerung</h3>
        ${controls.join("")}
      </section>
    `;
  }

  _floorForArea(area) {
    return this._floors.find((floor) => floor.floor_id === area.floor_id) || null;
  }

  _groupRooms() {
    const groups = new Map();

    for (const room of this._roomData()) {
      const floor = this._floorForArea(room.area);
      const key = floor?.floor_id || "__no_floor__";

      if (!groups.has(key)) {
        groups.set(key, {
          floor,
          rooms: [],
        });
      }

      groups.get(key).rooms.push(room);
    }

    const result = [...groups.values()];

    result.sort((a, b) => {
      if (!a.floor && b.floor) return 1;
      if (a.floor && !b.floor) return -1;

      const levelA = a.floor?.level;
      const levelB = b.floor?.level;

      if (Number.isFinite(levelA) && Number.isFinite(levelB) && levelA !== levelB) {
        return levelA - levelB;
      }

      return String(a.floor?.name || "Ohne Etage").localeCompare(
        String(b.floor?.name || "Ohne Etage"),
        "de"
      );
    });

    for (const group of result) {
      group.rooms.sort((a, b) =>
        String(a.area.name).localeCompare(String(b.area.name), "de")
      );
    }

    return result;
  }

  _format(value, digits) {
    if (value === null || value === undefined) return "–";
    return Number(value).toLocaleString("de-DE", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async _loadHistory(room) {
    if (!this._hass || !room) return;

    const entityIds = [...room.temperature, ...room.humidity].map((x) => x.entityId);
    if (!entityIds.length) return;

    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const key = room.area.area_id;

    this._historyLoading = true;
    this._render();

    try {
      const history = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: entityIds,
        include_start_time_state: true,
        minimal_response: false,
        significant_changes_only: false,
      });
      this._history.set(key, { history, start, end });
    } catch (error) {
      console.error("Room Climate Card: history loading failed", error);
      this._history.set(key, { history: {}, start, end, error });
    } finally {
      this._historyLoading = false;
      this._render();
    }
  }

_historySeries(room, hours) {
    const cached = this._history.get(room.area.area_id);
    if (!cached?.history) return { temp: [], humidity: [], start: null, end: null };
    const end = cached.end || new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    const totalHours = Math.round((end.getTime() - start.getTime()) / 3600000) || hours;
    const bins = [];
    for (let i = 0; i <= totalHours; i++) {
      bins.push(new Date(start.getTime() + i * 60 * 60 * 1000));
    }
    const build = (sensors) => bins.map((time) => {
      const values = [];
      for (const sensor of sensors) {
        const entries = cached.history[sensor.entityId] || [];
        let latest = null;
        for (const item of entries) {
          // Verwende item.lu (Unix-Timestamp) und item.s (state)
          const ts = Number(item.lu) * 1000; // Konvertiere Sekunden in Millisekunden
          if (!Number.isFinite(ts) || ts > time.getTime()) break;
          const value = Number.parseFloat(item.s);
          if (Number.isFinite(value)) latest = value;
        }
        if (latest !== null) values.push(latest);
      }
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    });
    return { temp: build(room.temperature), humidity: build(room.humidity), start, end };
  }

  _periodAverage(series, hours) {
    const values = [];
    const cutoff = series.end.getTime() - hours * 60 * 60 * 1000;
    const step = 60 * 60 * 1000;
    series.temp.forEach((value, index) => {
      if (value !== null && series.start.getTime() + index * step >= cutoff) values.push(value);
    });
    return values.length ? this._average(values.map((value) => ({ value }))) : null;
  }

  _humidityPeriodAverage(series, hours) {
    const values = [];
    const cutoff = series.end.getTime() - hours * 60 * 60 * 1000;
    const step = 60 * 60 * 1000;
    series.humidity.forEach((value, index) => {
      if (value !== null && series.start.getTime() + index * step >= cutoff) values.push(value);
    });
    return values.length ? this._average(values.map((value) => ({ value }))) : null;
  }

  _historyGraph(series, hours) {
    const width = 760;
    const height = 200;
    const pad = { l: 44, lr: 44, t: 18, b: 28 };
    const end = series.end || new Date();
    const start = series.start || new Date(end.getTime() - (hours || 24) * 60 * 60 * 1000);
    const totalHours = Math.round((end.getTime() - start.getTime()) / 3600000) || hours || 24;

    const tempValues = series.temp.filter((v) => v !== null);
    const humValues = series.humidity.filter((v) => v !== null);
    if (!tempValues.length && !humValues.length) {
      return `<div class="graph-empty">Keine historischen Werte verfügbar.</div>`;
    }

    const scale = (values, unit) => {
      let min = Math.min(...values);
      let max = Math.max(...values);
      if (min === max) {
        min -= unit === "%" ? 2 : 1;
        max += unit === "%" ? 2 : 1;
      }
      const margin = Math.max((max - min) * 0.12, unit === "%" ? 1 : 0.3);
      min -= margin;
      max += margin;
      return { min, max };
    };

    const tempScale = tempValues.length ? scale(tempValues, "°C") : null;
    const humScale = humValues.length ? scale(humValues, "%") : null;

    const y = (value, sc) => pad.t + ((sc.max - value) / (sc.max - sc.min)) * (height - pad.t - pad.b);
    const x = (index, count) => pad.l + (index / (count > 1 ? count - 1 : 1)) * (width - pad.l - pad.lr);

    const pathFor = (values, sc, count) => {
      const points = values.map((value, index) => {
        if (value === null) return null;
        return `${x(index, count).toFixed(1)},${y(value, sc).toFixed(1)}`;
      });
      const paths = [];
      let current = [];
      for (const point of points) {
        if (point) current.push(point);
        else if (current.length) {
          paths.push(current.join(" "));
          current = [];
        }
      }
      if (current.length) paths.push(current.join(" "));
      return paths.map(
        (path) =>
          `<polyline points="${path}" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />`
      ).join("");
    };

    const count = Math.max(series.temp.length, series.humidity.length);

    const tempPath = tempScale ? pathFor(series.temp, tempScale, count) : "";
    const humPath = humScale ? pathFor(series.humidity, humScale, count) : "";

    const tempPathSvg = tempPath
      ? `<g stroke="#e57373">${tempPath}</g>`
      : "";
    const humPathSvg = humPath
      ? `<g stroke="#64b5f6">${humPath}</g>`
      : "";

    const axisFor = (sc, unit, side) => {
      if (!sc) return "";
      const steps = 4;
      const tickY = [];
      for (let i = 0; i <= steps; i++) {
        const value = sc.min + ((sc.max - sc.min) / steps) * i;
        const ty = y(value, sc);
        const text = this._format(value, unit === "%" ? 0 : 1);
        tickY.push(`
          <line class="gridline" ${
            side === "left"
              ? `x1="${pad.l - 6}" x2="${width - pad.lr}"`
              : `x1="${pad.l}" x2="${width - pad.lr + 6}"`
          } y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}" ${
            i === 0 ? `stroke="var(--divider-color)"` : ""
          } />
          <text class="axis" text-anchor="${
            side === "left" ? "end" : "start"
          }" ${
            side === "left" ? `x="${pad.l - 9}"` : `x="${width - pad.lr + 9}"`
          } y="${(ty + 4).toFixed(1)}">${text}${unit}</text>
        `);
      }
      return tickY.join("");
    };

    const xLabels = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
      const hour = frac * totalHours;
      const xx = pad.l + (hour / totalHours) * (width - pad.l - pad.lr);
      const d = new Date(start.getTime() + hour * 60 * 60 * 1000);
      const text = d.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `<text x="${xx}" y="${height - 7}" text-anchor="middle" class="axis">${text}</text>`;
    }).join("");

    return `
      <div class="graphs">
        <div class="graph-title">Temperatur & Luftfeuchtigkeit – letzte ${hours} Stunden</div>
        <svg class="graph" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Temperatur und Luftfeuchtigkeit">
          ${axisFor(tempScale, "°C", "left")}
          ${axisFor(humScale, "%", "right")}
          ${tempPathSvg}
          ${humPathSvg}
          ${xLabels}
        </svg>
        <div class="graph-legend">
          <span class="legend-item" style="color:#e57373;">🌡 Temperatur</span>
          <span class="legend-item" style="color:#64b5f6;">💧 Luftfeuchtigkeit</span>
        </div>
        <div class="graph-axis-label left">Temperatur (°C)</div>
        <div class="graph-axis-label right">Luftfeuchtigkeit (%)</div>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot) return;

    const title = this._config.title || "Temperaturen/Luftfeuchtigkeit";

    if (this._selectedArea) {
      const room = this._roomData().find(
        (item) => item.area.area_id === this._selectedArea
      );

      if (room) {
        if (!this._history.has(room.area.area_id) && !this._historyLoading) {
          this._loadHistory(room);
        }
        const hours = this._range === 12 ? 12 : 24;
        const series = this._historySeries(room, hours);
        const tempAvg = series.start ? this._periodAverage(series, hours) : null;
        const humAvg = series.start ? this._humidityPeriodAverage(series, hours) : null;

        this.shadowRoot.innerHTML = `
          ${this._styles()}
          <ha-card>
            <div class="header">
              <button class="back" data-action="back" title="Zurück">‹</button>
              <div>
                <div class="title">${this._escape(room.area.name)}</div>
                <div class="subtitle">${this._escape(
                  this._floorForArea(room.area)?.name || "Ohne Etage"
                )}</div>
              </div>
            </div>

            <div class="summary">
              <div class="summary-value">
                <span class="summary-icon">🌡</span>
                <span>${this._format(room.tempAverage, 1)} °C</span>
                <small>Durchschnitt</small>
              </div>
              <div class="summary-value">
                <span class="summary-icon">💧</span>
                <span>${this._format(room.humidityAverage, 0)} %</span>
                <small>Durchschnitt</small>
              </div>
            </div>

            <div class="range-toggle" role="group" aria-label="Zeitraum wählen">
              <button data-range="12" class="${hours === 12 ? "active" : ""}">12 Std</button>
              <button data-range="24" class="${hours === 24 ? "active" : ""}">24 Std</button>
            </div>

            <div class="periods">
              <div class="period-card">
                <div class="period-title">🌡 Temperatur (${hours} h)</div>
                <div class="period-row"><span>Durchschnitt</span><strong>${this._format(tempAvg, 1)} °C</strong></div>
              </div>
              <div class="period-card">
                <div class="period-title">💧 Luftfeuchtigkeit (${hours} h)</div>
                <div class="period-row"><span>Durchschnitt</span><strong>${this._format(humAvg, 0)} %</strong></div>
              </div>
            </div>

            ${this._climateControl(room)}

            ${this._historyLoading ? `<div class="loading">Verlauf wird geladen …</div>` : this._historyGraph(series, hours)}

            <div class="detail-grid">
              ${this._sensorSection(
                "Temperatur",
                "🌡",
                room.temperature,
                "°C",
                1
              )}
              ${this._sensorSection(
                "Luftfeuchtigkeit",
                "💧",
                room.humidity,
                "%",
                0
              )}
            </div>
          </ha-card>
        `;

        this.shadowRoot
          .querySelector("[data-action='back']")
          ?.addEventListener("click", () => {
            this._selectedArea = null;
            this._render();
          });

        this.shadowRoot.querySelectorAll("[data-range]").forEach((button) => {
          button.addEventListener("click", () => {
            this._range = Number(button.dataset.range);
            this._render();
          });
        });

        this.shadowRoot.querySelectorAll("[data-hvac]").forEach((button) => {
          button.addEventListener("click", () => {
            const climate = room.climate.find(
              (c) => c.entityId === button.dataset.hvac
            );
            if (climate) this._setHvacMode(climate, button.dataset.mode);
          });
        });

        this.shadowRoot.querySelectorAll("[data-temp]").forEach((button) => {
          button.addEventListener("click", () => {
            const climate = room.climate.find(
              (c) => c.entityId === button.dataset.temp
            );
            if (!climate) return;
            const st = this._climateState(climate);
            const a = st?.attributes || {};
            const min = Number(a.min_temp);
            const max = Number(a.max_temp);
            const delta = Number(button.dataset.delta);
            const base = Number(a.temperature);
            if (!Number.isFinite(base)) return;
            let next = base + delta;
            if (Number.isFinite(min)) next = Math.max(min, next);
            if (Number.isFinite(max)) next = Math.min(max, next);
            this._setTemperature(climate, next);
          });
        });

        return;
      }

      this._selectedArea = null;
    }

    const groups = this._groupRooms();

    this.shadowRoot.innerHTML = `
      ${this._styles()}
      <ha-card>
        <div class="card-title">${this._escape(title)}</div>

        ${
          !this._registryLoaded
            ? `<div class="loading">Raumdaten werden geladen …</div>`
            : groups.length
              ? groups.map((group) => this._floorSection(group)).join("")
              : `<div class="empty">Keine Temperatur- oder Luftfeuchtigkeitssensoren mit Bereich gefunden.</div>`
        }
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll("[data-area]").forEach((button) => {
      button.addEventListener("click", () => {
        this._selectedArea = button.dataset.area;
        this._render();
      });
    });
  }

  _floorSection(group) {
    const floorName = group.floor?.name || "Ohne Etage";

    return `
      <section class="floor">
        <h2>${this._escape(floorName)}</h2>
        <div
          class="rooms"
          style="grid-template-columns: repeat(${Math.max(
            1,
            Math.min(4, Number(this._config.columns) || 2)
          )}, minmax(0, 1fr));"
        >
          ${group.rooms.map((room) => this._roomCard(room)).join("")}
        </div>
      </section>
    `;
  }

  _roomCard(room) {
    return `
      <button class="room" data-area="${this._escape(room.area.area_id)}">
        <div class="room-name">
          ${this._escape(room.area.name)}
        </div>

        <div class="room-values">
          ${
            room.tempAverage !== null
              ? `<div><span>🌡</span><strong>${this._format(
                  room.tempAverage,
                  1
                )}</strong><span class="unit">°C</span></div>`
              : ""
          }

          ${
            room.humidityAverage !== null
              ? `<div><span>💧</span><strong>${this._format(
                  room.humidityAverage,
                  0
                )}</strong><span class="unit">%</span></div>`
              : ""
          }
        </div>

        <div class="sensor-count">
          ${room.deviceCount}
          ${room.deviceCount === 1 ? "Gerät" : "Geräte"}
        </div>
      </button>
    `;
  }

  _sensorSection(title, icon, sensors, unit, digits) {
    if (!sensors.length) {
      return `
        <section class="sensor-section">
          <h3>${icon} ${this._escape(title)}</h3>
          <div class="none">Keine Werte verfügbar</div>
        </section>
      `;
    }

    return `
      <section class="sensor-section">
        <h3>${icon} ${this._escape(title)}</h3>
        <div class="sensor-list">
          ${sensors
            .map(
              (sensor) => `
                <button
                  class="sensor-row"
                  data-entity="${this._escape(sensor.entityId)}"
                >
                  <span class="sensor-name">${this._escape(sensor.name)}</span>
                  <strong>${this._format(sensor.value, digits)} ${unit}</strong>
                </button>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  _styles() {
    return `
      <style>
        :host {
          display: block;
          --room-card-bg: var(
            --ha-card-background,
            var(--card-background-color, white)
          );
          --room-border: var(
            --divider-color,
            rgba(127, 127, 127, 0.22)
          );
        }

        ha-card {
          overflow: hidden;
          padding: 0;
        }

        .card-title {
          font-size: 1.35rem;
          font-weight: 500;
          padding: 18px 20px 8px;
        }

        .floor {
          padding: 8px 20px 18px;
        }

        .floor + .floor {
          padding-top: 0;
        }

        h2 {
          font-size: 1.05rem;
          margin: 8px 0 10px;
          font-weight: 600;
        }

        .rooms {
          display: grid;
          gap: 12px;
        }

        .room {
          appearance: none;
          border: 1px solid var(--room-border);
          border-radius: 14px;
          background: var(--room-card-bg);
          color: inherit;
          text-align: left;
          padding: 14px;
          min-height: 104px;
          cursor: pointer;
          font: inherit;
          transition:
            transform 120ms ease,
            box-shadow 120ms ease;
        }

        .room:hover {
          transform: translateY(-1px);
          box-shadow: var(--ha-card-box-shadow);
        }

        .room-name {
          font-weight: 600;
          font-size: 1rem;
          margin-bottom: 12px;
        }

        .room-values {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          align-items: center;
        }

        .room-values div {
          display: flex;
          align-items: baseline;
          gap: 4px;
          white-space: nowrap;
        }

        .room-values strong {
          font-size: 1.15rem;
          font-weight: 500;
        }

        .unit {
          color: var(--secondary-text-color);
          font-size: 0.9rem;
        }

        .sensor-count {
          margin-top: 9px;
          color: var(--secondary-text-color);
          font-size: 0.75rem;
        }

        .header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px 8px;
        }

        .back {
          width: 42px;
          height: 42px;
          border: 0;
          border-radius: 50%;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          font-size: 32px;
          line-height: 1;
          cursor: pointer;
        }

        .title {
          font-size: 1.35rem;
          font-weight: 500;
        }

        .subtitle {
          color: var(--secondary-text-color);
          font-size: 0.85rem;
          margin-top: 2px;
        }

        .summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          padding: 8px 16px 16px;
        }

        .summary-value {
          border: 1px solid var(--room-border);
          border-radius: 14px;
          padding: 14px;
          display: grid;
          grid-template-columns: auto 1fr;
          column-gap: 8px;
          align-items: center;
        }

        .summary-icon {
          grid-row: span 2;
          font-size: 1.35rem;
        }

        .summary-value > span:not(.summary-icon) {
          font-size: 1.2rem;
          font-weight: 500;
        }

        .summary-value small {
          color: var(--secondary-text-color);
          grid-column: 2;
        }

        .detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          padding: 0 16px 18px;
        }

        .sensor-section {
          border: 1px solid var(--room-border);
          border-radius: 14px;
          overflow: hidden;
        }

        h3 {
          margin: 0;
          padding: 12px 14px;
          font-size: 0.95rem;
          font-weight: 600;
          background: var(--secondary-background-color);
        }

        .sensor-list {
          display: flex;
          flex-direction: column;
        }

        .climate-section {
          border: 1px solid var(--room-border);
          border-radius: 14px;
          overflow: hidden;
          margin: 0 16px 14px;
        }

        .climate-control {
          padding: 12px 14px;
          border-top: 1px solid var(--room-border);
        }

        .climate-control:first-of-type {
          border-top: 0;
        }

        .climate-name {
          font-weight: 600;
          font-size: 0.9rem;
          margin-bottom: 9px;
        }

        .climate-modes {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 10px;
        }

        .hvac-mode {
          appearance: none;
          border: 1px solid var(--room-border);
          border-radius: 999px;
          background: transparent;
          color: var(--secondary-text-color);
          font: inherit;
          font-size: 0.78rem;
          font-weight: 600;
          text-transform: capitalize;
          padding: 5px 12px;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
        }

        .hvac-mode.active {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color);
        }

        .climate-temp {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }

        .temp-btn {
          appearance: none;
          width: 36px;
          height: 36px;
          border: 1px solid var(--room-border);
          border-radius: 10px;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          font: inherit;
          font-size: 1.1rem;
          line-height: 1;
          cursor: pointer;
        }

        .temp-value {
          font-weight: 600;
          font-size: 1rem;
          min-width: 64px;
          text-align: center;
        }

        .sensor-row {
          appearance: none;
          border: 0;
          border-top: 1px solid var(--room-border);
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          padding: 11px 14px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          cursor: pointer;
        }

        .sensor-row:hover {
          background: var(--secondary-background-color);
        }

        .sensor-name {
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .none,
        .loading,
        .empty {
          padding: 14px 20px 20px;
          color: var(--secondary-text-color);
        }

        .periods {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          padding: 0 16px 14px;
        }

        .range-toggle {
          display: flex;
          gap: 8px;
          padding: 0 16px 12px;
        }

        .range-toggle button {
          flex: 1;
          appearance: none;
          border: 1px solid var(--room-border);
          border-radius: 999px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          font: inherit;
          font-size: 0.85rem;
          font-weight: 600;
          padding: 8px 0;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
        }

        .range-toggle button.active {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color);
        }

        .period-card {
          border: 1px solid var(--room-border);
          border-radius: 14px;
          padding: 12px 14px;
        }

        .period-title {
          font-weight: 600;
          margin-bottom: 7px;
        }

        .period-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding-top: 4px;
          color: var(--secondary-text-color);
        }

        .period-row strong {
          color: var(--primary-text-color);
          font-weight: 500;
        }

        .graphs {
          padding: 0 16px 18px;
          display: grid;
          gap: 12px;
        }

        .graph-title {
          font-weight: 600;
          font-size: 0.95rem;
          margin-bottom: 4px;
        }

        .graph {
          width: 100%;
          height: 200px;
          display: block;
          overflow: visible;
          color: var(--primary-color);
          margin-top: 6px;
        }

        .gridline {
          stroke: var(--divider-color);
          stroke-width: 1;
        }

        .axis {
          fill: var(--secondary-text-color);
          font-size: 11px;
        }

        .graph-legend {
          display: flex;
          gap: 18px;
          margin-top: 4px;
          font-size: 0.8rem;
          font-weight: 600;
          flex-wrap: wrap;
        }

        .graph-axis-label {
          color: var(--secondary-text-color);
          font-size: 0.72rem;
          margin-top: 2px;
        }

        .graph-axis-label.right {
          text-align: right;
        }

        .graph-empty {
          color: var(--secondary-text-color);
          padding: 12px 0;
        }

        @media (max-width: 700px) {
          .rooms {
            grid-template-columns: 1fr !important;
          }

          .detail-grid,
          .summary,
          .periods {
            grid-template-columns: 1fr;
          }
        }
      </style>
    `;
  }

  static getConfigElement() {
    return document.createElement("room-climate-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Temperaturen/Luftfeuchtigkeit",
      columns: 2,
      exclude_areas: ["fussboden", "fußboden"],
    };
  }
}

class RoomClimateCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
  }

  setConfig(config) {
    this._config = { ...config };
    if (!this.shadowRoot.querySelector("#title")) {
      this._render();
    } else {
      this._syncFields();
    }
  }

  _syncFields() {
    if (!this.shadowRoot) return;
    const config = this._config || {};
    const titleField = this.shadowRoot.querySelector("#title");
    const excludeField = this.shadowRoot.querySelector("#exclude");
    const valueEl = this.shadowRoot.querySelector("#cols-value");
    const exclude = Array.isArray(config.exclude_areas)
      ? config.exclude_areas.join(", ")
      : typeof config.exclude_areas === "string"
        ? config.exclude_areas
        : "";
    if (titleField && document.activeElement !== titleField) {
      titleField.value = typeof config.title === "string" ? config.title : "";
    }
    if (excludeField && document.activeElement !== excludeField) {
      excludeField.value = exclude;
    }
    const columns = Number.isFinite(Number(config.columns))
      ? Math.min(4, Math.max(1, Number(config.columns)))
      : 2;
    if (valueEl) valueEl.textContent = columns;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._render();
  }

  _update(patch) {
    this._config = { ...this._config, ...patch };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _render() {
    if (!this.shadowRoot) return;

    const config = this._config || {};
    const title = typeof config.title === "string" ? config.title : "";
    const columns = Number.isFinite(Number(config.columns))
      ? Math.min(4, Math.max(1, Number(config.columns)))
      : 2;
    const exclude = Array.isArray(config.exclude_areas)
      ? config.exclude_areas.join(", ")
      : typeof config.exclude_areas === "string"
        ? config.exclude_areas
        : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          --content-padding: 0;
        }
        .editor {
          display: grid;
          gap: 20px;
          padding: 8px 0;
        }
        .row {
          display: grid;
          gap: 6px;
        }
        .row label {
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .row .hint {
          font-size: 0.8rem;
          color: var(--secondary-text-color);
        }
        .columns-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .columns-row button {
          width: 36px;
          height: 36px;
          border: 1px solid var(--divider-color, rgba(127,127,127,0.35));
          border-radius: 8px;
          background: var(--secondary-background-color, rgba(0,0,0,0.05));
          color: var(--primary-text-color);
          font-size: 1.2rem;
          line-height: 1;
          cursor: pointer;
        }
        .columns-row .value {
          min-width: 24px;
          text-align: center;
          font-weight: 600;
        }
        input[type="text"] {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          border: 1px solid var(--divider-color, rgba(127,127,127,0.35));
          border-radius: 8px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          font: inherit;
        }
      </style>
      <div class="editor">
        <div class="row">
          <label>Titel</label>
          <input type="text" id="title" value="${this._attr(title)}" />
        </div>

        <div class="row">
          <label>Spalten</label>
          <div class="columns-row">
            <button id="cols-minus" type="button" data-delta="-1">−</button>
            <span class="value" id="cols-value">${columns}</span>
            <button id="cols-plus" type="button" data-delta="1">+</button>
          </div>
        </div>

        <div class="row">
          <label>Ausgeschlossene Bereiche</label>
          <input
            type="text"
            id="exclude"
            value="${this._attr(exclude)}"
            placeholder="Kommagetrennt, z. B. fussboden, fußboden"
          />
        </div>
      </div>
    `;

    const titleField = this.shadowRoot.querySelector("#title");
    if (titleField) {
      titleField.addEventListener("input", (ev) =>
        this._update({ title: ev.target.value })
      );
    }

    const excludeField = this.shadowRoot.querySelector("#exclude");
    if (excludeField) {
      excludeField.addEventListener("input", (ev) =>
        this._update({
          exclude_areas: ev.target.value
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        })
      );
    }

    this.shadowRoot.querySelectorAll(".columns-row button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const delta = Number(btn.dataset.delta);
        const current = Number.isFinite(Number(this._config.columns))
          ? Number(this._config.columns)
          : 2;
        const next = Math.min(4, Math.max(1, current + delta));
        this._config = { ...this._config, columns: next };
        const valueEl = this.shadowRoot.querySelector("#cols-value");
        if (valueEl) valueEl.textContent = next;
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          })
        );
      });
    });
  }

  _attr(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
}

customElements.define("room-climate-card", RoomClimateCard);
customElements.define("room-climate-card-editor", RoomClimateCardEditor);

window.customEditors = window.customEditors || [];
window.customEditors.push({
  type: "room-climate-card",
  name: "Room Climate Card",
  element: "room-climate-card-editor",
});

window.customCards = window.customCards || [];
window.customCards.push({
  type: "room-climate-card",
  name: "Room Climate Card",
  description:
    "Dynamische Raumklima-Karte mit Etagen, Durchschnittswerten und Detailansicht.",
  preview: false,
});
