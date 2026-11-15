/* Chauffage intelligent — carte Lovelace (pilotage + éditeur de planning)
 * Chargée automatiquement par l'intégration : aucune ressource à déclarer.
 */
(() => {
  const DOMAIN = "chauffage_intelligent";
  const CARD_VERSION = "1.1.0";
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DAY_SHORT = { mon: "Lun", tue: "Mar", wed: "Mer", thu: "Jeu", fri: "Ven", sat: "Sam", sun: "Dim" };
  const DAY_LONG = { mon: "lundi", tue: "mardi", wed: "mercredi", thu: "jeudi", fri: "vendredi", sat: "samedi", sun: "dimanche" };
  const PRESETS = {
    eco: { label: "Eco", color: "#43a047", icon: "mdi:leaf" },
    comfort: { label: "Confort", color: "#fb8c00", icon: "mdi:sofa" },
    comfort_plus: { label: "Confort +", color: "#e53935", icon: "mdi:fire" },
    custom: { label: "Perso", color: "#8e24aa", icon: "mdi:thermometer" },
  };
  const ZONE_MODES = [
    { key: "auto", label: "Auto", icon: "mdi:calendar-clock" },
    { key: "eco", label: "Eco", icon: "mdi:leaf" },
    { key: "comfort", label: "Confort", icon: "mdi:sofa" },
    { key: "comfort_plus", label: "Confort +", icon: "mdi:fire" },
    { key: "off", label: "Arrêt", icon: "mdi:power" },
  ];
  const GLOBAL_MODES = [
    { key: "auto", label: "Auto", icon: "mdi:home-thermometer" },
    { key: "absence", label: "Absence", icon: "mdi:home-export-outline" },
    { key: "vacation", label: "Vacances", icon: "mdi:airplane" },
    { key: "off", label: "Arrêt", icon: "mdi:power" },
  ];
  const SNAP = 15;

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
  const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const fmtT = (v) => (v === null || v === undefined || isNaN(v) ? "—" : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}°`);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const todayKey = () => DAYS[(new Date().getDay() + 6) % 7];
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const slotTemp = (slot, a) => slot.preset === "custom" ? slot.temp : slot.preset === "eco" ? a.eco : slot.preset === "comfort_plus" ? a.comfort_plus : a.comfort;
  const fmtTime = (iso) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };

  function zoneEntities(hass, config) {
    if (config && Array.isArray(config.zones) && config.zones.length) return config.zones.filter((e) => hass.states[e]);
    return Object.keys(hass.states)
      .filter((eid) => eid.startsWith("climate.") && hass.states[eid].attributes.zone_id && hass.states[eid].attributes.entry_id)
      .filter((eid) => !hass.entities || !hass.entities[eid] || hass.entities[eid].platform === DOMAIN)
      .sort((a, b) => (hass.states[a].attributes.friendly_name || a).localeCompare(hass.states[b].attributes.friendly_name || b, "fr"));
  }

  const BASE_CSS = `
    :host { --ci-eco: ${PRESETS.eco.color}; --ci-comfort: ${PRESETS.comfort.color}; --ci-comfort-plus: ${PRESETS.comfort_plus.color}; --ci-custom: ${PRESETS.custom.color}; }
    * { box-sizing: border-box; }
    .seg { display: flex; flex-wrap: wrap; gap: 6px; }
    .seg button, .btn, .chip {
      font: inherit; border: 1px solid var(--divider-color, #ddd); background: var(--card-background-color, #fff);
      color: var(--primary-text-color); border-radius: 999px; padding: 6px 12px; cursor: pointer; display: inline-flex;
      align-items: center; gap: 6px; font-size: 13px; line-height: 18px; transition: background .15s, border-color .15s;
    }
    .seg button ha-icon, .btn ha-icon, .chip ha-icon { --mdc-icon-size: 18px; }
    .seg button.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
    .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
    .btn.danger { color: var(--error-color, #db4437); }
    .btn:disabled { opacity: .45; cursor: default; }
    .chip { cursor: default; padding: 4px 10px; font-size: 12px; }
    .chip.click { cursor: pointer; }
    .chip.on { border-color: var(--primary-color); color: var(--primary-color); }
    .chip.warn { border-color: var(--warning-color, #ffa600); color: var(--warning-color, #ffa600); }
    .muted { color: var(--secondary-text-color); }
    .bar { position: relative; height: 10px; border-radius: 5px; background: var(--secondary-background-color, #eee); overflow: hidden; }
    .bar .s { position: absolute; top: 0; bottom: 0; }
    .bar .now { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--primary-text-color); opacity: .7; }
  `;

  // ======================================================================
  // Carte principale
  // ======================================================================
  class ChauffageIntelligentCard extends HTMLElement {
    static getStubConfig() { return { title: "Chauffage" }; }
    static getConfigForm() {
      return {
        schema: [
          { name: "title", selector: { text: {} } },
          { name: "show_global", selector: { boolean: {} } },
          { name: "group", selector: { boolean: {} } },
          { name: "zones", selector: { entity: { multiple: true, filter: { integration: DOMAIN, domain: "climate" } } } },
        ],
        computeLabel: (s) => ({ title: "Titre", show_global: "Afficher le mode maison", group: "Grouper par type de pièce", zones: "Pièces (vide = toutes)" }[s.name]),
      };
    }

    setConfig(config) {
      this._config = { show_global: true, group: true, ...config };
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this._sig = null;
      if (this._hass) this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._dialog) this._dialog.hass = hass;
      const sig = this._signature();
      if (sig !== this._sig) { this._sig = sig; this._render(); }
    }

    getCardSize() { return 6; }
    getGridOptions() { return { columns: 12, min_columns: 6 }; }

    connectedCallback() {
      this._timer = setInterval(() => { this._sig = null; if (this._hass) this.hass = this._hass; }, 60000);
    }
    disconnectedCallback() { clearInterval(this._timer); }

    _signature() {
      const h = this._hass;
      if (!h) return "";
      const ids = zoneEntities(h, this._config);
      const glob = this._globalEntities();
      return [...ids, ...Object.values(glob)].map((e) => { const s = h.states[e]; return s ? e + s.last_updated : e; }).join("|");
    }

    _globalEntities() {
      const ids = zoneEntities(this._hass, this._config);
      if (!ids.length) return {};
      return this._hass.states[ids[0]].attributes.global_entities || {};
    }

    _call(domain, service, data) { return this._hass.callService(domain, service, data); }

    _render() {
      if (!this.shadowRoot || !this._hass) return;
      const hass = this._hass;
      const ids = zoneEntities(hass, this._config);
      const g = this._globalEntities();
      const first = ids.length ? hass.states[ids[0]].attributes : null;
      const st = (k) => (g[k] ? hass.states[g[k]] : null);
      const mode = st("global_mode")?.state;
      const engineOn = st("engine")?.state === "on";
      const absAuto = st("absence_auto")?.state === "on";
      const presence = st("presence")?.state;
      const outdoor = st("outdoor_temp")?.state;
      const vacEnd = st("vacation_end")?.state;

      const groups = this._config.group
        ? [["main", "Pièces principales"], ["secondary", "Pièces peu utilisées"]]
        : [[null, null]];

      const tiles = (usage) => ids
        .filter((e) => usage === null || (hass.states[e].attributes.usage || "main") === usage)
        .map((e) => this._tile(e)).join("");

      let body = "";
      if (!ids.length) {
        body = `<div class="empty"><ha-icon icon="mdi:home-plus-outline"></ha-icon><div>Aucune pièce.<br><span class="muted">Ajoute des pièces dans Paramètres → Appareils et services → Chauffage intelligent → « Ajouter une pièce ».</span></div></div>`;
      } else {
        for (const [usage, label] of groups) {
          const t = tiles(usage);
          if (!t) continue;
          if (label && this._config.group) body += `<div class="group">${label}</div>`;
          body += `<div class="grid">${t}</div>`;
        }
      }

      const curs = ids.map((e) => Number(hass.states[e].attributes.current_temperature)).filter((v) => !isNaN(v));
      const avg = curs.length ? curs.reduce((x, y) => x + y, 0) / curs.length : null;
      const heatingCount = ids.filter((e) => hass.states[e].attributes.hvac_action === "heating").length;
      const offCount = ids.filter((e) => hass.states[e].attributes.temperature == null).length;
      const modeIdx = Math.max(0, GLOBAL_MODES.findIndex((m) => m.key === mode));
      const globalHtml = this._config.show_global && mode ? `
        <div class="hero">
          <div class="hero-main">
            <div class="hero-temp">${avg == null ? "—" : avg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}<span>°</span></div>
            <div class="hero-sub">
              <div class="hero-title">${esc(this._config.title || "Maison")}</div>
              <div class="muted">${heatingCount ? `${heatingCount} pièce${heatingCount > 1 ? "s" : ""} en chauffe` : "Aucune pièce en chauffe"}${offCount ? ` · ${offCount} coupée${offCount > 1 ? "s" : ""}` : ""}</div>
            </div>
          </div>
          <div class="hero-side">
            ${outdoor && !isNaN(outdoor) ? `<span class="pill"><ha-icon icon="mdi:weather-cloudy"></ha-icon>${fmtT(outdoor)} dehors</span>` : ""}
            ${presence ? `<span class="pill"><ha-icon icon="${presence === "on" ? "mdi:home" : "mdi:home-outline"}"></ha-icon>${presence === "on" ? "Présents" : "Absents"}</span>` : ""}
          </div>
        </div>
        <div class="modes" data-act="global" style="--n:${GLOBAL_MODES.length};--i:${modeIdx}">
          <span class="slider"></span>
          ${GLOBAL_MODES.map((m) => `<button class="${mode === m.key ? "on" : ""}" data-mode="${m.key}"><ha-icon icon="${m.icon}"></ha-icon><span>${m.label}</span></button>`).join("")}
        </div>
        <div class="toggles">
          <button class="tg ${engineOn ? "on" : "warn"}" data-toggle="engine"><ha-icon icon="mdi:engine${engineOn ? "" : "-off"}"></ha-icon>Moteur ${engineOn ? "actif" : "coupé"}</button>
          <button class="tg ${absAuto ? "on" : ""}" data-toggle="absence_auto"><ha-icon icon="mdi:home-account"></ha-icon>Absence auto</button>
        </div>
        ${mode === "vacation" && g.vacation_end ? `
          <div class="vac"><ha-icon icon="mdi:airplane-landing"></ha-icon>Retour le
            <input type="datetime-local" data-act="vac" value="${vacEnd && vacEnd !== "unknown" ? esc(this._localInput(vacEnd)) : ""}">
            <span class="muted">préchauffe pour l'arrivée puis retour en Auto</span></div>` : ""}` : "";

      this.shadowRoot.innerHTML = `
        <style>${BASE_CSS}${CARD_CSS}</style>
        <ha-card>
          ${!(this._config.show_global && mode) && this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : ""}
          ${globalHtml}
          ${body}
          ${first && !first.engine ? `<div class="banner">Moteur coupé : les consignes sont calculées mais pas envoyées.</div>` : ""}
        </ha-card>`;
      this._bind();
    }

    _localInput(iso) {
      const d = new Date(iso);
      if (isNaN(d)) return "";
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    _accent(a) {
      if (a.temperature === null || a.temperature === undefined) return "var(--ci-off)";
      if (a.reason === "boost") return "var(--ci-comfort-plus)";
      if (["preheat", "absence_preheat", "vacation_preheat"].includes(a.reason)) return "var(--ci-preheat)";
      return { eco: "var(--ci-eco)", comfort: "var(--ci-comfort)", comfort_plus: "var(--ci-comfort-plus)" }[a.preset_mode] || "var(--ci-custom)";
    }

    _ring(a, accent) {
      const MIN = 14, MAX = 26, R = 40, C = 2 * Math.PI * R, ARC = 0.75 * C;
      const f = (v) => Math.max(0, Math.min(1, (Number(v) - MIN) / (MAX - MIN)));
      const off = a.temperature === null || a.temperature === undefined;
      const cur = a.current_temperature;
      const tgt = off ? null : a.temperature;
      const ang = (v) => ((135 + 270 * f(v)) * Math.PI) / 180;
      const dot = (v, cls) => v == null ? "" : `<circle class="${cls}" cx="${50 + R * Math.cos(ang(v))}" cy="${50 + R * Math.sin(ang(v))}" r="${cls === "cur" ? 5.5 : 3}"></circle>`;
      const heating = a.hvac_action === "heating";
      return `
        <div class="ring ${heating ? "heating" : ""}">
          <svg viewBox="0 0 100 100">
            <circle class="track" cx="50" cy="50" r="${R}" stroke-dasharray="${ARC} ${C}" transform="rotate(135 50 50)"></circle>
            ${tgt != null ? `<circle class="val" style="stroke:${accent}" cx="50" cy="50" r="${R}" stroke-dasharray="${ARC * f(tgt)} ${C}" transform="rotate(135 50 50)"></circle>` : ""}
            ${dot(tgt, "tgt")}
            ${dot(cur, "cur")}
          </svg>
          <div class="ring-c">
            <div class="ring-cur">${cur == null ? "—" : Number(cur).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}<span>°</span></div>
            <div class="ring-tgt" style="color:${accent}">${off ? `<ha-icon icon="mdi:power"></ha-icon>Arrêt` : `<ha-icon icon="${heating ? "mdi:fire" : "mdi:thermometer"}"></ha-icon>${fmtT(tgt)}`}</div>
          </div>
        </div>`;
    }

    _statusIcon(a) {
      if (a.window_effective) return "mdi:window-open-variant";
      return {
        boost: "mdi:rocket-launch", manual: "mdi:hand-back-right", preheat: "mdi:clock-start", absence_preheat: "mdi:clock-start",
        vacation_preheat: "mdi:clock-start", absence: "mdi:home-export-outline", absence_arrival: "mdi:home-account",
        vacation: "mdi:airplane", global_off: "mdi:power", zone_off: "mdi:power", forced: "mdi:pin", eco: "mdi:leaf", planning: "mdi:calendar-clock",
      }[a.reason] || "mdi:information-outline";
    }

    _tile(eid) {
      const s = this._hass.states[eid];
      const a = s.attributes;
      const accent = this._accent(a);
      const alerts = [];
      if (!a.window_effective && a.window_open) alerts.push(`<ha-icon title="Fenêtre ouverte : coupure dans quelques minutes" icon="mdi:window-open"></ha-icon>`);
      if (a.sync_status === "failed") alerts.push(`<ha-icon class="err" title="Le Koolnova n'a pas pris la consigne" icon="mdi:alert"></ha-icon>`);
      if (a.sync_status === "unavailable") alerts.push(`<ha-icon class="err" title="Koolnova indisponible" icon="mdi:lan-disconnect"></ha-icon>`);
      const boost = a.reason === "boost";
      return `
        <div class="tile" style="--accent:${accent}" data-zone="${esc(eid)}">
          <div class="t-head">
            <span class="t-name">${esc(a.friendly_name || eid)}</span>
            <span class="t-alerts">${alerts.join("")}</span>
          </div>
          ${this._ring(a, accent)}
          <div class="t-status" title="${esc(a.reason_text || "")}"><ha-icon icon="${this._statusIcon(a)}"></ha-icon><span>${esc(a.reason_text || "")}</span></div>
          <div class="t-foot">
            ${this._dayBar(a, todayKey(), true)}
            <button class="icon ${boost ? "on" : ""}" data-boost="${esc(eid)}" title="${boost ? "Arrêter le boost" : "Boost"}"><ha-icon icon="mdi:rocket-launch"></ha-icon></button>
            ${a.reason === "manual" || boost ? `<button class="icon" data-resume="${esc(eid)}" title="Reprendre le planning"><ha-icon icon="mdi:calendar-sync"></ha-icon></button>` : ""}
          </div>
        </div>`;
    }

    _dayBar(a, day, now) {
      const slots = (a.planning && a.planning[day]) || [];
      const parts = slots.map((sl) => {
        const l = (toMin(sl.start) / 1440) * 100, w = ((toMin(sl.end) - toMin(sl.start)) / 1440) * 100;
        return `<div class="s" style="left:${l}%;width:${w}%;background:${PRESETS[sl.preset]?.color}"></div>`;
      }).join("");
      const marker = now ? `<div class="now" style="left:${(nowMin() / 1440) * 100}%"></div>` : "";
      return `<div class="bar" title="Planning d'aujourd'hui">${parts}${marker}</div>`;
    }

    _bind() {
      const root = this.shadowRoot;
      const g = this._globalEntities();
      root.querySelectorAll('[data-act="global"] button').forEach((b) =>
        b.addEventListener("click", () => this._call("select", "select_option", { entity_id: g.global_mode, option: b.dataset.mode })));
      root.querySelectorAll("[data-toggle]").forEach((c) =>
        c.addEventListener("click", () => this._call("switch", "toggle", { entity_id: g[c.dataset.toggle] })));
      const vac = root.querySelector('[data-act="vac"]');
      if (vac) vac.addEventListener("change", () => {
        if (!vac.value) return;
        this._call("datetime", "set_value", { entity_id: g.vacation_end, datetime: vac.value.replace("T", " ") + ":00" });
      });
      root.querySelectorAll(".tile").forEach((t) => t.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        this._openDialog(t.dataset.zone);
      }));
      root.querySelectorAll("[data-boost]").forEach((b) => b.addEventListener("click", () => {
        const a = this._hass.states[b.dataset.boost].attributes;
        this._call(DOMAIN, a.reason === "boost" ? "cancel_boost" : "boost", { entity_id: b.dataset.boost });
      }));
      root.querySelectorAll("[data-resume]").forEach((b) => b.addEventListener("click", () =>
        this._call(DOMAIN, "resume", { entity_id: b.dataset.resume })));
    }

    _openDialog(eid) {
      if (this._dialog) this._dialog.close();
      const d = document.createElement("chauffage-intelligent-dialog");
      d.zones = zoneEntities(this._hass, this._config);
      d.entityId = eid;
      d.hass = this._hass;
      d.onClose = () => { this._dialog = null; };
      document.body.appendChild(d);
      this._dialog = d;
    }
  }

  const CARD_CSS = `
    :host { --ci-preheat: #ffb300; --ci-off: var(--disabled-text-color, #8a8a8a); }
    ha-card { padding: 18px; overflow: hidden; color: var(--primary-text-color); }
    .title { font-size: 20px; font-weight: 500; margin-bottom: 12px; }
    .hero { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .hero-main { display: flex; align-items: center; gap: 14px; }
    .hero-temp { font-size: 44px; font-weight: 300; line-height: 1; letter-spacing: -1px; }
    .hero-temp span, .ring-cur span { font-size: .5em; vertical-align: top; margin-left: 1px; opacity: .7; }
    .hero-title { font-size: 17px; font-weight: 500; }
    .hero-sub .muted { font-size: 13px; margin-top: 2px; }
    .hero-side { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; padding: 6px 12px; border-radius: 999px; background: var(--secondary-background-color); }
    .pill ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
    .modes { position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); margin: 16px 0 10px; padding: 4px; border-radius: 14px; background: var(--secondary-background-color); }
    .modes .slider { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / var(--n)); transform: translateX(calc(100% * var(--i))); border-radius: 10px; background: var(--primary-color); transition: transform .25s ease; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
    .modes button { position: relative; z-index: 1; font: inherit; font-size: 13px; border: none; background: none; color: var(--primary-text-color); padding: 8px 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 10px; }
    .modes button ha-icon { --mdc-icon-size: 18px; }
    .modes button.on { color: var(--text-primary-color, #fff); font-weight: 500; }
    @media (max-width: 420px) { .modes button span { display: none; } .modes button.on span { display: inline; } }
    .toggles { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
    .tg { font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; cursor: pointer; border: 1px solid var(--divider-color); background: none; color: var(--secondary-text-color); }
    .tg ha-icon { --mdc-icon-size: 16px; }
    .tg.on { color: var(--primary-color); border-color: color-mix(in srgb, var(--primary-color) 50%, transparent); background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
    .tg.warn { color: var(--warning-color, #ffa600); border-color: var(--warning-color, #ffa600); }
    .vac { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; margin-top: 8px; }
    .vac input { font: inherit; padding: 4px 6px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
    .group { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--secondary-text-color); margin: 18px 2px 10px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 10px; }
    .tile { position: relative; border-radius: 18px; padding: 12px 12px 10px; cursor: pointer; overflow: hidden;
      background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 14%, var(--secondary-background-color)) 0%, var(--secondary-background-color) 55%);
      border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); display: flex; flex-direction: column; gap: 4px; transition: transform .12s, box-shadow .12s; }
    .tile:hover { box-shadow: 0 4px 14px rgba(0,0,0,.12); }
    .tile:active { transform: scale(.98); }
    .t-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; min-height: 22px; }
    .t-name { font-weight: 500; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t-alerts { display: flex; gap: 2px; color: var(--warning-color, #ffa600); }
    .t-alerts ha-icon { --mdc-icon-size: 18px; }
    .t-alerts ha-icon.err { color: var(--error-color, #db4437); }
    .ring { position: relative; width: 118px; height: 118px; margin: 2px auto -10px; }
    .ring svg { width: 100%; height: 100%; overflow: visible; }
    .ring circle { fill: none; stroke-width: 7; stroke-linecap: round; }
    .ring .track { stroke: var(--divider-color, rgba(127,127,127,.25)); }
    .ring .val { transition: stroke-dasharray .4s; }
    .ring .cur { fill: var(--card-background-color, #fff); stroke: var(--primary-text-color); stroke-width: 2.5; }
    .ring .tgt { fill: var(--accent); stroke: none; }
    .ring.heating .val { animation: glow 2s ease-in-out infinite; }
    @keyframes glow { 50% { opacity: .55; } }
    .ring-c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .ring-cur { font-size: 30px; font-weight: 400; line-height: 1; letter-spacing: -.5px; }
    .ring-tgt { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; font-weight: 500; margin-top: 4px; }
    .ring-tgt ha-icon { --mdc-icon-size: 15px; }
    .ring.heating .ring-tgt ha-icon { animation: glow 1.6s infinite; }
    .t-status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--secondary-text-color); min-height: 30px; }
    .t-status ha-icon { --mdc-icon-size: 16px; color: var(--accent); flex: none; }
    .t-status span { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 15px; }
    .t-foot { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
    .t-foot .bar { flex: 1; height: 6px; background: var(--divider-color, #ddd); }
    button.icon { border: none; background: none; color: var(--secondary-text-color); cursor: pointer; padding: 5px; border-radius: 50%; display: inline-flex; }
    button.icon:hover { background: var(--divider-color); }
    button.icon.on { color: var(--ci-comfort-plus); }
    button.icon ha-icon { --mdc-icon-size: 18px; }
    .empty { display: flex; gap: 12px; align-items: center; padding: 8px; }
    .banner { margin-top: 12px; padding: 8px 12px; border-radius: 10px; background: rgba(255, 166, 0, .15); font-size: 13px; }
  `;

  // ======================================================================
  // Fenêtre de détail d'une pièce
  // ======================================================================
  class ChauffageIntelligentDialog extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._tab = "control";
      this._draft = null;
      this._dirty = false;
      this._sel = null; // {day, index}
      this._copyDays = new Set();
      this._error = "";
    }

    set hass(hass) {
      this._hass = hass;
      const s = hass.states[this.entityId];
      const sig = s ? s.last_updated : "";
      if (sig !== this._sig) {
        this._sig = sig;
        if (!this._dirty) this._draft = null;
        const focused = this.shadowRoot.activeElement && ["INPUT", "SELECT"].includes(this.shadowRoot.activeElement.tagName);
        if (!this._dragging && !focused) this._render();
      }
    }

    connectedCallback() {
      this._esc = (e) => { if (e.key === "Escape") this.close(); };
      window.addEventListener("keydown", this._esc);
      history.pushState({ ciDialog: true }, "");
      this._pop = () => this.close(true);
      window.addEventListener("popstate", this._pop);
    }

    close(fromPop) {
      if (this._dirty && !confirm("Le planning a été modifié sans être enregistré. Fermer quand même ?")) {
        if (fromPop) history.pushState({ ciDialog: true }, "");
        return;
      }
      window.removeEventListener("keydown", this._esc);
      window.removeEventListener("popstate", this._pop);
      if (!fromPop && history.state && history.state.ciDialog) history.back();
      this.remove();
      if (this.onClose) this.onClose();
    }

    get _a() { return this._hass.states[this.entityId]?.attributes || {}; }
    _call(domain, service, data) {
      return this._hass.callService(domain, service, { entity_id: this.entityId, ...data }).catch((err) => {
        this._error = err.message || String(err);
        this._render();
      });
    }

    _render() {
      const a = this._a;
      if (!this._hass || !a.zone_id) return;
      if (!this._draft) this._draft = clone(a.planning || {});
      const tabs = [["control", "Pilotage", "mdi:tune-variant"], ["planning", "Planning", "mdi:calendar-week"], ["settings", "Réglages", "mdi:cog-outline"]];
      const content = this._tab === "planning" ? this._planningHtml(a) : this._tab === "settings" ? this._settingsHtml(a) : this._controlHtml(a);
      this.shadowRoot.innerHTML = `
        <style>${BASE_CSS}${DIALOG_CSS}</style>
        <div class="backdrop"></div>
        <div class="dlg" role="dialog" aria-modal="true">
          <div class="head">
            <div>
              <div class="name">${esc(a.friendly_name)}</div>
              <div class="sub">${fmtT(a.current_temperature)} mesurés · ${a.temperature == null ? "chauffage coupé" : "consigne " + fmtT(a.temperature)}</div>
              <div class="reason">${esc(a.reason_text)}</div>
            </div>
            <button class="icon close" title="Fermer"><ha-icon icon="mdi:close"></ha-icon></button>
          </div>
          <div class="tabs">${tabs.map(([k, l, i]) => `<button class="tab ${this._tab === k ? "on" : ""}" data-tab="${k}"><ha-icon icon="${i}"></ha-icon>${l}${k === "planning" && this._dirty ? " •" : ""}</button>`).join("")}</div>
          ${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}
          <div class="body">${content}</div>
        </div>`;
      this._bind();
    }

    // ------------------------------------------------------------ Pilotage
    _controlHtml(a) {
      const manual = a.reason === "manual";
      const boost = a.reason === "boost";
      return `
        <div class="section">
          <div class="label">Mode de la pièce</div>
          <div class="seg">${ZONE_MODES.map((m) => `<button data-zmode="${m.key}" class="${a.zone_mode === m.key ? "on" : ""}"><ha-icon icon="${m.icon}"></ha-icon>${m.label}</button>`).join("")}</div>
          <div class="hint">Auto suit le planning avec préchauffe. Les autres modes maintiennent la consigne jusqu'à ce que tu changes de mode.</div>
        </div>
        <div class="section">
          <div class="label">Réglage ponctuel</div>
          <div class="stepper big">
            <button class="icon" data-manual="-0.5"><ha-icon icon="mdi:minus"></ha-icon></button>
            <span class="val">${a.temperature == null ? "Arrêt" : fmtT(a.temperature)}</span>
            <button class="icon" data-manual="0.5"><ha-icon icon="mdi:plus"></ha-icon></button>
          </div>
          <div class="hint">${a.zone_mode === "auto" ? "Valable jusqu'au prochain changement du planning." : "Valable jusqu'au prochain changement de mode."}</div>
          ${manual ? `<button class="btn" data-resume><ha-icon icon="mdi:calendar-sync"></ha-icon>Reprendre le planning</button>` : ""}
        </div>
        <div class="section">
          <div class="label">Boost</div>
          ${boost
            ? `<div class="row">Boost à ${fmtT(a.temperature)} jusqu'à ${fmtTime(a.boost_until)} <button class="btn" data-cancel-boost><ha-icon icon="mdi:stop"></ha-icon>Arrêter</button></div>`
            : `<div class="seg">${[30, 60, 120].map((m) => `<button data-boost="${m}"><ha-icon icon="mdi:rocket-launch"></ha-icon>${m < 60 ? m + " min" : m / 60 + " h"}</button>`).join("")}</div>
               <div class="hint">Chauffe à ${fmtT(a.boost_temp)} puis reprend le fonctionnement normal.</div>`}
        </div>
        <div class="section">
          <div class="label">Aujourd'hui</div>
          ${this._timelineRow(a, todayKey(), false)}
          <div class="hint">${a.preheat ? "Les heures du planning sont celles où la température doit être atteinte : la préchauffe démarre avant." : "Préchauffe désactivée : la chauffe démarre à l'heure du planning."}</div>
        </div>`;
    }

    // ------------------------------------------------------------ Réglages
    _settingsHtml(a) {
      const stepper = (key, label, val, step = 0.5, unit = "°") => `
        <div class="set">
          <span class="set-label">${label}</span>
          <div class="stepper">
            <button class="icon" data-set="${key}" data-delta="${-step}"><ha-icon icon="mdi:minus"></ha-icon></button>
            <span class="val">${Number(val).toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${unit}</span>
            <button class="icon" data-set="${key}" data-delta="${step}"><ha-icon icon="mdi:plus"></ha-icon></button>
          </div>
        </div>`;
      const ll = a.last_learning;
      const sync = { ok: "Synchronisé", pending: "Envoi en cours…", verifying: "Vérification…", failed: "Consigne non prise par le Koolnova", unavailable: "Koolnova indisponible", engine_off: "Moteur coupé", init: "Démarrage…" }[a.sync_status] || a.sync_status;
      return `
        <div class="section">
          <div class="label">Consignes</div>
          ${stepper("eco", `<span class="dot" style="background:var(--ci-eco)"></span>Eco`, a.eco)}
          ${stepper("comfort", `<span class="dot" style="background:var(--ci-comfort)"></span>Confort`, a.comfort)}
          ${stepper("comfort_plus", `<span class="dot" style="background:var(--ci-comfort-plus)"></span>Confort +`, a.comfort_plus)}
        </div>
        <div class="section">
          <div class="label">Préchauffe</div>
          <label class="switch-row"><input type="checkbox" data-preheat ${a.preheat ? "checked" : ""}> Anticiper pour que la température soit atteinte à l'heure du planning</label>
          ${stepper("speed", "Vitesse de chauffe", a.speed, 0.1, " °C/h")}
          <div class="hint">Apprise automatiquement après chaque préchauffe.${ll ? ` Dernier ajustement le ${new Date(ll.at).toLocaleDateString("fr-FR")} : ${fmtT(ll.measured)} mesurés pour ${fmtT(ll.target)} visés → ${ll.old_speed} → ${ll.new_speed} °C/h.` : ""}</div>
        </div>
        <div class="section">
          <div class="label">État</div>
          <div class="kv"><span>Koolnova</span><span>${esc(a.koolnova_entity)} · ${esc(sync)}</span></div>
          <div class="kv"><span>Fenêtres</span><span>${(a.windows || []).length ? (a.window_open ? "ouverte" : "fermées") : "aucun capteur"}</span></div>
          <a class="btn" href="/config/integrations/integration/${DOMAIN}" data-nav><ha-icon icon="mdi:cog"></ha-icon>Capteurs et options de la pièce</a>
        </div>`;
    }

    // ------------------------------------------------------------ Planning
    _timelineRow(a, day, editable) {
      const slots = (editable ? this._draft[day] : (a.planning || {})[day]) || [];
      const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span class="tick" style="left:${(h / 24) * 100}%"></span>`).join("");
      const blocks = slots.map((sl, i) => {
        const l = (toMin(sl.start) / 1440) * 100, w = ((toMin(sl.end) - toMin(sl.start)) / 1440) * 100;
        const sel = editable && this._sel && this._sel.day === day && this._sel.index === i;
        return `<div class="slot ${sel ? "sel" : ""}" title="${sl.start} – ${sl.end} · ${fmtT(slotTemp(sl, a))}" data-day="${day}" data-i="${i}" style="left:${l}%;width:${w}%;background:${PRESETS[sl.preset].color}">
          ${editable ? `<span class="h l" data-h="l"></span><span class="h r" data-h="r"></span>` : ""}
          ${w >= 4.5 ? `<span class="st">${fmtT(slotTemp(sl, a))}</span>` : ""}</div>`;
      }).join("");
      const now = day === todayKey() ? `<div class="nowline" style="left:${(nowMin() / 1440) * 100}%"></div>` : "";
      return `<div class="track ${editable ? "edit" : ""}" data-track="${day}">${ticks}${blocks}${now}</div>`;
    }

    _planningHtml(a) {
      const hours = [0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${h}h</span>`).join("");
      const rows = DAYS.map((d) => `
        <div class="prow">
          <span class="dname">${DAY_SHORT[d]}</span>
          ${this._timelineRow(a, d, true)}
        </div>`).join("");
      const legend = ["eco", "comfort", "comfort_plus"].map((p) => `<span class="lg"><span class="dot" style="background:${PRESETS[p].color}"></span>${PRESETS[p].label} ${fmtT(a[p])}</span>`).join("") +
        `<span class="lg"><span class="dot" style="background:${PRESETS.custom.color}"></span>Perso</span>`;
      const others = (this.zones || []).filter((z) => z !== this.entityId && this._hass.states[z]);
      return `
        <div class="legend">${legend}<span class="lg muted">Hors plage : Eco</span></div>
        <div class="hours"><span class="dname"></span><div class="hl">${hours}</div></div>
        ${rows}
        <div class="hint">Touche une zone vide pour ajouter une plage, fais glisser une plage ou ses bords pour la déplacer (pas de ${SNAP} min). Les heures sont celles où la température doit être atteinte.</div>
        ${this._sel ? this._slotEditor(a) : ""}
        <div class="section tools">
          <div class="label">Copier</div>
          <div class="row wrap">
            <select data-copy-from>${DAYS.map((d) => `<option value="${d}" ${d === (this._copyFrom || "mon") ? "selected" : ""}>Le ${DAY_LONG[d]}</option>`).join("")}</select>
            <span>vers</span>
            <div class="seg small">${DAYS.map((d) => `<button data-copy-to="${d}" class="${this._copyDays.has(d) ? "on" : ""}">${DAY_SHORT[d]}</button>`).join("")}</div>
            <button class="btn" data-copy ${this._copyDays.size ? "" : "disabled"}><ha-icon icon="mdi:content-copy"></ha-icon>Copier</button>
          </div>
          ${others.length ? `<div class="row wrap">
            <select data-from-zone>${others.map((z) => `<option value="${esc(z)}">${esc(this._hass.states[z].attributes.friendly_name)}</option>`).join("")}</select>
            <button class="btn" data-import><ha-icon icon="mdi:import"></ha-icon>Reprendre le planning de cette pièce</button>
          </div>` : ""}
          <div class="row wrap">
            <button class="btn" data-preset-week><ha-icon icon="mdi:calendar-start"></ha-icon>Modèle semaine de travail</button>
            <button class="btn danger" data-clear><ha-icon icon="mdi:delete-sweep-outline"></ha-icon>Tout effacer</button>
          </div>
        </div>
        <div class="savebar">
          <span class="muted">${this._dirty ? "Modifications non enregistrées" : "Planning à jour"}</span>
          <button class="btn" data-cancel ${this._dirty ? "" : "disabled"}>Annuler</button>
          <button class="btn primary" data-save ${this._dirty ? "" : "disabled"}><ha-icon icon="mdi:content-save"></ha-icon>Enregistrer</button>
        </div>`;
    }

    _slotEditor(a) {
      const { day, index } = this._sel;
      const sl = this._draft[day][index];
      if (!sl) return "";
      return `
        <div class="editor">
          <div class="row wrap">
            <strong>${DAY_LONG[day][0].toUpperCase() + DAY_LONG[day].slice(1)}</strong>
            <label>de <input type="time" step="900" data-f="start" value="${sl.start}"></label>
            <label>à <input type="time" step="900" data-f="end" value="${sl.end === "24:00" ? "23:59" : sl.end}"></label>
          </div>
          <div class="seg">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}" class="${sl.preset === k ? "on" : ""}"><span class="dot" style="background:${p.color}"></span>${p.label}${k !== "custom" ? " " + fmtT(a[k]) : ""}</button>`).join("")}</div>
          ${sl.preset === "custom" ? `<label class="row">Température <input type="number" min="7" max="30" step="0.5" data-f="temp" value="${sl.temp ?? a.comfort}"> °C</label>` : ""}
          <div class="row">
            <button class="btn danger" data-del><ha-icon icon="mdi:delete-outline"></ha-icon>Supprimer</button>
            <button class="btn" data-desel>OK</button>
          </div>
        </div>`;
    }

    _setDraft(fn) {
      fn(this._draft);
      for (const d of DAYS) (this._draft[d] = this._draft[d] || []).sort((x, y) => toMin(x.start) - toMin(y.start));
      this._dirty = true;
      this._render();
    }

    _gap(day, index, startMin) {
      // bornes libres autour d'une plage (ou d'un point si index = null)
      const slots = this._draft[day] || [];
      let lo = 0, hi = 1440;
      slots.forEach((s, i) => {
        if (i === index) return;
        const a = toMin(s.start), b = toMin(s.end);
        if (b <= startMin) lo = Math.max(lo, b);
        if (a >= startMin) hi = Math.min(hi, a);
      });
      return [lo, hi];
    }

    _addAt(day, minute) {
      const m = Math.round(minute / 30) * 30;
      const slots = this._draft[day] || [];
      if (slots.some((s) => toMin(s.start) <= minute && minute < toMin(s.end))) return;
      const [lo, hi] = this._gap(day, null, minute);
      if (hi - lo < SNAP) return;
      let start = Math.max(lo, Math.min(m - 30, hi - 60));
      let end = Math.min(hi, start + 60);
      start = Math.max(lo, end - 60);
      this._setDraft((d) => { d[day] = [...(d[day] || []), { start: toHHMM(start), end: toHHMM(end), preset: "comfort" }]; });
      const idx = this._draft[day].findIndex((s) => s.start === toHHMM(start));
      this._sel = { day, index: idx };
      this._render();
    }

    _bindPlanning(root) {
      root.querySelectorAll(".track.edit").forEach((track) => {
        const day = track.dataset.track;
        track.addEventListener("pointerdown", (ev) => {
          const slotEl = ev.target.closest(".slot");
          const rect = track.getBoundingClientRect();
          const minuteAt = (x) => Math.max(0, Math.min(1440, ((x - rect.left) / rect.width) * 1440));
          if (!slotEl) { this._addAt(day, minuteAt(ev.clientX)); return; }
          ev.preventDefault();
          const i = Number(slotEl.dataset.i);
          const sl = this._draft[day][i];
          const handle = ev.target.dataset.h || "move";
          const s0 = toMin(sl.start), e0 = toMin(sl.end), x0 = ev.clientX;
          const [lo, hi] = this._gap(day, i, s0);
          let moved = false;
          this._dragging = true;
          slotEl.setPointerCapture(ev.pointerId);
          const onMove = (e) => {
            const dm = Math.round((((e.clientX - x0) / rect.width) * 1440) / SNAP) * SNAP;
            if (dm !== 0) moved = true;
            let ns = s0, ne = e0;
            if (handle === "l") ns = Math.min(Math.max(lo, s0 + dm), e0 - SNAP);
            else if (handle === "r") ne = Math.max(Math.min(hi, e0 + dm), s0 + SNAP);
            else { const len = e0 - s0; ns = Math.min(Math.max(lo, s0 + dm), hi - len); ne = ns + len; }
            sl.start = toHHMM(ns); sl.end = toHHMM(ne);
            slotEl.style.left = `${(ns / 1440) * 100}%`;
            slotEl.style.width = `${((ne - ns) / 1440) * 100}%`;
            slotEl.title = `${sl.start} – ${sl.end}`;
            const tip = this.shadowRoot.querySelector(".dragtip");
            if (tip) tip.textContent = `${DAY_SHORT[day]} ${sl.start} – ${sl.end}`;
          };
          const onUp = () => {
            slotEl.removeEventListener("pointermove", onMove);
            slotEl.removeEventListener("pointerup", onUp);
            slotEl.removeEventListener("pointercancel", onUp);
            this._dragging = false;
            if (moved) this._dirty = true;
            this._sel = { day, index: i };
            this._setDraft(() => {});
            if (!moved) this._dirty = this._dirtyCheck();
            this._render();
          };
          slotEl.addEventListener("pointermove", onMove);
          slotEl.addEventListener("pointerup", onUp);
          slotEl.addEventListener("pointercancel", onUp);
        });
      });

      const ed = root.querySelector(".editor");
      if (ed && this._sel) {
        const { day, index } = this._sel;
        ed.querySelectorAll("[data-f]").forEach((inp) => inp.addEventListener("change", () => {
          const sl = this._draft[day][index];
          const f = inp.dataset.f;
          if (f === "temp") { sl.temp = Math.round(Number(inp.value) * 2) / 2; this._setDraft(() => {}); return; }
          let v = inp.value;
          if (!v) return;
          let m = toMin(v);
          if (f === "end" && m === 1439) m = 1440;
          m = Math.round(m / SNAP) * SNAP;
          const [lo, hi] = this._gap(day, index, toMin(sl.start));
          if (f === "start") m = Math.max(lo, Math.min(m, toMin(sl.end) - SNAP));
          else m = Math.min(hi, Math.max(m, toMin(sl.start) + SNAP));
          sl[f] = toHHMM(m);
          this._setDraft(() => {});
          this._sel = { day, index: this._draft[day].indexOf(sl) };
          this._render();
        }));
        ed.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
          const sl = this._draft[day][index];
          sl.preset = b.dataset.p;
          if (sl.preset === "custom") sl.temp = sl.temp ?? this._a.comfort; else delete sl.temp;
          this._setDraft(() => {});
        }));
        ed.querySelector("[data-del]").addEventListener("click", () => {
          this._setDraft((d) => d[day].splice(index, 1));
          this._sel = null; this._render();
        });
        ed.querySelector("[data-desel]").addEventListener("click", () => { this._sel = null; this._render(); });
      }

      const from = root.querySelector("[data-copy-from]");
      if (from) from.addEventListener("change", () => { this._copyFrom = from.value; });
      root.querySelectorAll("[data-copy-to]").forEach((b) => b.addEventListener("click", () => {
        const d = b.dataset.copyTo;
        this._copyDays.has(d) ? this._copyDays.delete(d) : this._copyDays.add(d);
        this._render();
      }));
      root.querySelector("[data-copy]")?.addEventListener("click", () => {
        const src = this._copyFrom || "mon";
        this._setDraft((d) => { for (const t of this._copyDays) if (t !== src) d[t] = clone(d[src] || []); });
        this._copyDays.clear(); this._sel = null; this._render();
      });
      root.querySelector("[data-import]")?.addEventListener("click", () => {
        const z = root.querySelector("[data-from-zone]").value;
        const p = this._hass.states[z]?.attributes.planning;
        if (p) { this._setDraft((d) => { for (const k of DAYS) d[k] = clone(p[k] || []); }); this._sel = null; this._render(); }
      });
      root.querySelector("[data-preset-week]")?.addEventListener("click", () => {
        const wk = [{ start: "06:30", end: "07:30", preset: "comfort" }, { start: "18:00", end: "22:30", preset: "comfort" }];
        const we = [{ start: "08:00", end: "22:30", preset: "comfort" }];
        this._setDraft((d) => { for (const k of DAYS) d[k] = clone(k === "sat" || k === "sun" ? we : wk); });
        this._sel = null; this._render();
      });
      root.querySelector("[data-clear]")?.addEventListener("click", () => {
        if (!confirm("Effacer toutes les plages ? La pièce restera en Eco.")) return;
        this._setDraft((d) => { for (const k of DAYS) d[k] = []; });
        this._sel = null; this._render();
      });
      root.querySelector("[data-cancel]")?.addEventListener("click", () => {
        this._draft = clone(this._a.planning || {}); this._dirty = false; this._sel = null; this._error = ""; this._render();
      });
      root.querySelector("[data-save]")?.addEventListener("click", async () => {
        const planning = {};
        for (const d of DAYS) planning[d] = (this._draft[d] || []).map((s) => ({ ...s }));
        this._error = "";
        try {
          await this._hass.callService(DOMAIN, "set_planning", { entity_id: this.entityId, planning });
          this._dirty = false; this._sel = null; this._draft = null;
        } catch (err) { this._error = err.message || String(err); }
        this._render();
      });
    }

    _dirtyCheck() {
      return JSON.stringify(this._draft) !== JSON.stringify(this._a.planning || {});
    }

    _bind() {
      const root = this.shadowRoot;
      root.querySelector(".backdrop").addEventListener("click", () => this.close());
      root.querySelector(".close").addEventListener("click", () => this.close());
      root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { this._tab = b.dataset.tab; this._error = ""; this._render(); }));
      root.querySelectorAll("[data-zmode]").forEach((b) => b.addEventListener("click", () => this._call(DOMAIN, "set_zone_mode", { mode: b.dataset.zmode })));
      root.querySelectorAll("[data-manual]").forEach((b) => b.addEventListener("click", () => {
        const a = this._a;
        const base = a.temperature ?? a.comfort;
        const v = Math.min(30, Math.max(7, base + Number(b.dataset.manual)));
        this._call("climate", "set_temperature", { temperature: v });
      }));
      root.querySelector("[data-resume]")?.addEventListener("click", () => this._call(DOMAIN, "resume", {}));
      root.querySelectorAll("[data-boost]").forEach((b) => b.addEventListener("click", () => this._call(DOMAIN, "boost", { duration: Number(b.dataset.boost) })));
      root.querySelector("[data-cancel-boost]")?.addEventListener("click", () => this._call(DOMAIN, "cancel_boost", {}));
      root.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.set;
        const step = Number(b.dataset.delta);
        const v = Math.round((Number(this._a[k]) + step) * 100) / 100;
        this._call(DOMAIN, "set_zone_settings", { [k]: v });
      }));
      root.querySelector("[data-preheat]")?.addEventListener("change", (e) => this._call(DOMAIN, "set_zone_settings", { preheat: e.target.checked }));
      root.querySelector("[data-nav]")?.addEventListener("click", (e) => {
        e.preventDefault();
        this._dirty = false;
        this.close();
        history.pushState(null, "", e.currentTarget.getAttribute("href"));
        window.dispatchEvent(new CustomEvent("location-changed"));
      });
      if (this._tab === "planning") this._bindPlanning(root);
    }
  }

  const DIALOG_CSS = `
    :host { position: fixed; inset: 0; z-index: 8; display: flex; align-items: center; justify-content: center; font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); color: var(--primary-text-color); }
    .backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); }
    .dlg { position: relative; width: min(760px, 100vw); max-height: min(92vh, 100%); overflow: auto; background: var(--card-background-color, #fff);
      border-radius: 20px; box-shadow: 0 12px 40px rgba(0, 0, 0, .3); padding: 18px 18px 12px; }
    @media (max-width: 600px) { .dlg { border-radius: 18px 18px 0 0; align-self: flex-end; max-height: 94vh; } }
    .head { display: flex; justify-content: space-between; gap: 10px; }
    .name { font-size: 22px; font-weight: 500; }
    .sub { color: var(--secondary-text-color); font-size: 14px; margin-top: 2px; }
    .reason { margin-top: 6px; font-size: 14px; }
    .tabs { display: flex; gap: 4px; margin: 14px 0 6px; border-bottom: 1px solid var(--divider-color); }
    .tab { font: inherit; background: none; border: none; border-bottom: 2px solid transparent; color: var(--secondary-text-color); padding: 8px 12px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
    .tab ha-icon { --mdc-icon-size: 18px; }
    .tab.on { color: var(--primary-color); border-color: var(--primary-color); }
    .body { padding-top: 6px; }
    .section { padding: 10px 0; border-bottom: 1px solid var(--divider-color); display: flex; flex-direction: column; gap: 8px; }
    .section:last-child { border-bottom: none; }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); }
    .hint { font-size: 12px; color: var(--secondary-text-color); }
    .row { display: flex; align-items: center; gap: 8px; }
    .row.wrap { flex-wrap: wrap; }
    .stepper { display: inline-flex; align-items: center; gap: 4px; }
    .stepper .val { min-width: 74px; text-align: center; font-size: 16px; font-variant-numeric: tabular-nums; }
    .stepper.big .val { font-size: 28px; min-width: 110px; }
    button.icon { border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); cursor: pointer; padding: 6px; border-radius: 50%; display: inline-flex; }
    button.icon.close { border: none; align-self: flex-start; }
    .set { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .set-label { display: inline-flex; align-items: center; gap: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .kv { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
    .kv span:first-child { color: var(--secondary-text-color); }
    .switch-row { display: flex; gap: 8px; align-items: center; font-size: 14px; }
    a.btn { text-decoration: none; align-self: flex-start; }
    .error { background: rgba(219, 68, 55, .12); color: var(--error-color, #db4437); padding: 8px 12px; border-radius: 10px; font-size: 13px; margin: 6px 0; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; margin: 4px 0 10px; }
    .lg { display: inline-flex; align-items: center; gap: 6px; }
    .hours, .prow { display: grid; grid-template-columns: 36px 1fr; align-items: center; gap: 8px; }
    .hl { position: relative; height: 16px; font-size: 11px; color: var(--secondary-text-color); }
    .hl span { position: absolute; transform: translateX(-50%); }
    .hl span:first-child { transform: none; } .hl span:last-child { transform: translateX(-100%); }
    .prow { margin: 5px 0; }
    .dname { font-size: 13px; color: var(--secondary-text-color); }
    .track { position: relative; height: 34px; border-radius: 8px; background: var(--secondary-background-color, #f2f2f2); touch-action: none; user-select: none; }
    .track.edit { cursor: copy; }
    .tick { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--divider-color); }
    .slot { position: absolute; top: 3px; bottom: 3px; border-radius: 6px; color: #fff; font-size: 11px; display: flex; align-items: center; justify-content: center; overflow: hidden; cursor: grab; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
    .slot.sel { outline: 2px solid var(--primary-text-color); outline-offset: 1px; z-index: 1; }
    .slot .st { pointer-events: none; white-space: nowrap; padding: 0 4px; text-shadow: 0 1px 1px rgba(0,0,0,.3); }
    .slot .h { position: absolute; top: 0; bottom: 0; width: 10px; cursor: ew-resize; }
    .slot .h.l { left: 0; } .slot .h.r { right: 0; }
    .track:not(.edit) .slot { cursor: default; }
    .nowline { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--primary-text-color); opacity: .6; pointer-events: none; }
    .editor { margin: 10px 0; padding: 12px; border-radius: 12px; border: 1px solid var(--divider-color); display: flex; flex-direction: column; gap: 10px; }
    .editor input, .tools select, .editor select { font: inherit; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
    .editor input[type=number] { width: 80px; }
    .seg.small button { padding: 4px 9px; }
    .savebar { position: sticky; bottom: -12px; background: var(--card-background-color); display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 10px 0; border-top: 1px solid var(--divider-color); margin-top: 6px; }
    .savebar .muted { margin-right: auto; font-size: 13px; }
  `;

  customElements.get("chauffage-intelligent-card") || customElements.define("chauffage-intelligent-card", ChauffageIntelligentCard);
  customElements.get("chauffage-intelligent-dialog") || customElements.define("chauffage-intelligent-dialog", ChauffageIntelligentDialog);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "chauffage-intelligent-card")) {
    window.customCards.push({
      type: "chauffage-intelligent-card",
      name: "Chauffage intelligent",
      description: "Pilotage des pièces, mode maison et éditeur de planning.",
      preview: true,
      documentationURL: "https://github.com/Geoffrey33/chauffage-intelligent",
    });
  }
  console.info(`%c CHAUFFAGE-INTELLIGENT %c ${CARD_VERSION} `, "background:#fb8c00;color:#fff;border-radius:3px 0 0 3px", "background:#555;color:#fff;border-radius:0 3px 3px 0");
})();
