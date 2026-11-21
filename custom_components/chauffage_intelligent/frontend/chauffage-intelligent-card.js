/* Chauffage intelligent — carte Lovelace (pilotage + éditeur de planning)
 * Chargée automatiquement par l'intégration : aucune ressource à déclarer.
 */
(() => {
  const DOMAIN = "chauffage_intelligent";
  const CARD_VERSION = "1.2.9";
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
  const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
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
      const tabs = [["control", "Pilotage", "mdi:tune-variant"], ["planning", "Planning", "mdi:calendar-week"], ["history", "Historique", "mdi:chart-line"], ["settings", "Réglages", "mdi:cog-outline"]];
      const content = this._tab === "planning" ? this._planningHtml(a) : this._tab === "settings" ? this._settingsHtml(a) : this._tab === "history" ? this._historyHtml(a) : this._controlHtml(a);
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
      const off = a.temperature === null || a.temperature === undefined;
      const heating = a.hvac_action === "heating";
      const accent = off ? "var(--disabled-text-color, #8a8a8a)" : boost ? "var(--ci-comfort-plus)"
        : ["preheat", "absence_preheat", "vacation_preheat"].includes(a.reason) ? "#ffb300"
        : ({ eco: "var(--ci-eco)", comfort: "var(--ci-comfort)", comfort_plus: "var(--ci-comfort-plus)" }[a.preset_mode] || "var(--ci-custom)");
      // grand cadran
      const MIN = 14, MAX = 26, R = 84, C = 2 * Math.PI * R, ARC = 0.75 * C;
      const f = (v) => Math.max(0, Math.min(1, (Number(v) - MIN) / (MAX - MIN)));
      const ang = (v) => ((135 + 270 * f(v)) * Math.PI) / 180;
      const pt = (v, r = R) => [100 + r * Math.cos(ang(v)), 100 + r * Math.sin(ang(v))];
      const cur = a.current_temperature;
      const ticks = [];
      for (let v = MIN; v <= MAX; v++) {
        const [x1, y1] = pt(v, R - 14), [x2, y2] = pt(v, R - (v % 2 ? 18 : 22));
        ticks.push(`<line class="tk ${v % 2 ? "" : "mj"}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`);
      }
      const dial = `
        <div class="dial ${heating ? "heating" : ""}" style="--accent:${accent}">
          <button class="dbtn" data-manual="-0.5" aria-label="Baisser"><ha-icon icon="mdi:minus"></ha-icon></button>
          <div class="dial-c">
            <svg viewBox="0 0 200 200">
              <circle class="trk" cx="100" cy="100" r="${R}" stroke-dasharray="${ARC} ${C}" transform="rotate(135 100 100)"></circle>
              ${off ? "" : `<circle class="val" cx="100" cy="100" r="${R}" stroke-dasharray="${ARC * f(a.temperature)} ${C}" transform="rotate(135 100 100)"></circle>`}
              ${ticks.join("")}
              ${off ? "" : `<circle class="tgt" cx="${pt(a.temperature)[0]}" cy="${pt(a.temperature)[1]}" r="9"></circle>`}
              ${cur == null ? "" : `<circle class="cur" cx="${pt(cur)[0]}" cy="${pt(cur)[1]}" r="5"></circle>`}
            </svg>
            <div class="dial-in">
              <div class="d-lbl">${off ? "Chauffage coupé" : heating ? "En chauffe vers" : "Consigne"}</div>
              <div class="d-tgt">${off ? `<ha-icon icon="mdi:power"></ha-icon>` : `${Number(a.temperature).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}<span>°</span>`}</div>
              <div class="d-cur"><ha-icon icon="mdi:thermometer"></ha-icon>${fmtT(cur)} mesurés</div>
            </div>
          </div>
          <button class="dbtn" data-manual="0.5" aria-label="Monter"><ha-icon icon="mdi:plus"></ha-icon></button>
        </div>
        <div class="status" style="--accent:${accent}">
          <span class="chip-st"><ha-icon icon="${{ boost: "mdi:rocket-launch", manual: "mdi:hand-back-right", preheat: "mdi:clock-start", window: "mdi:window-open-variant", forced: "mdi:pin", eco: "mdi:leaf", planning: "mdi:calendar-clock", absence: "mdi:home-export-outline", vacation: "mdi:airplane" }[a.reason] || "mdi:information-outline"}"></ha-icon>${esc(a.reason_text || "")}</span>
          ${manual || boost ? `<button class="btn" data-resume><ha-icon icon="mdi:calendar-sync"></ha-icon>Reprendre le planning</button>` : ""}
        </div>
        <div class="hint center">${a.zone_mode === "auto" ? "− / + : réglage ponctuel jusqu'au prochain changement du planning." : "− / + : réglage ponctuel jusqu'au prochain changement de mode."}</div>`;

      // modes
      const modeSub = { auto: "Planning", eco: fmtT(a.eco), comfort: fmtT(a.comfort), comfort_plus: fmtT(a.comfort_plus), off: "Coupé" };
      const modeCol = { auto: "var(--primary-color)", eco: "var(--ci-eco)", comfort: "var(--ci-comfort)", comfort_plus: "var(--ci-comfort-plus)", off: "var(--disabled-text-color, #8a8a8a)" };
      const modes = `<div class="mgrid">${ZONE_MODES.map((m) => `
        <button class="mt ${a.zone_mode === m.key ? "on" : ""}" data-zmode="${m.key}" style="--c:${modeCol[m.key]}">
          <span class="mt-ic"><ha-icon icon="${m.icon}"></ha-icon></span><span class="mt-l">${m.label}</span><span class="mt-s">${modeSub[m.key]}</span>
        </button>`).join("")}</div>`;

      // boost
      let boostHtml;
      if (boost && a.boost_until) {
        const end = new Date(a.boost_until).getTime();
        const total = (Number(a.boost_duration) || 60) * 60000;
        const left = Math.max(0, end - Date.now());
        const pct = Math.max(0, Math.min(100, 100 - (left / total) * 100));
        boostHtml = `
          <div class="boost on">
            <span class="b-ic"><ha-icon icon="mdi:rocket-launch"></ha-icon></span>
            <div class="b-body"><div class="b-t">Boost ${fmtT(a.temperature)} · encore ${Math.ceil(left / 60000)} min</div>
              <div class="b-bar"><i style="width:${pct}%"></i></div><div class="b-s">jusqu'à ${fmtTime(a.boost_until)}</div></div>
            <button class="btn" data-cancel-boost><ha-icon icon="mdi:stop"></ha-icon>Arrêter</button>
          </div>`;
      } else {
        boostHtml = `
          <div class="boost">
            <span class="b-ic"><ha-icon icon="mdi:rocket-launch"></ha-icon></span>
            <div class="b-body"><div class="b-t">Boost à ${fmtT(a.boost_temp)}</div><div class="b-s">puis retour au fonctionnement normal</div></div>
            <div class="b-ch">${[30, 60, 120].map((m) => `<button data-boost="${m}">${m < 60 ? m + " min" : m / 60 + " h"}</button>`).join("")}</div>
          </div>`;
      }

      // aujourd'hui
      const hours = [0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${h}h</span>`).join("");
      const next = a.next_change ? `Prochain changement à ${fmtTime(a.next_change)}` : "Pas de changement prévu";
      return `
        <div class="section">${dial}</div>
        <div class="section"><div class="label">Mode de la pièce</div>${modes}</div>
        <div class="section"><div class="label">Boost</div>${boostHtml}</div>
        <div class="section">
          <div class="row" style="justify-content:space-between"><div class="label">Aujourd'hui</div><span class="hint">${next}</span></div>
          ${this._timelineRow(a, todayKey(), false)}
          <div class="hl tl">${hours}</div>
          <div class="hint">${a.preheat ? "Les heures du planning sont celles où la température doit être atteinte : la préchauffe démarre avant." : "Préchauffe désactivée : la chauffe démarre à l'heure du planning."}</div>
        </div>`;
    }

    // ------------------------------------------------------------ Historique
    async _loadHistory(days) {
      const key = `${this.entityId}|${days}`;
      const cached = this._hist && this._hist.key === key && Date.now() - this._hist.at < 300000;
      if (cached || this._histLoading === key) return;
      this._histLoading = key;
      try {
        const end = new Date();
        const start = new Date(end.getTime() - days * 86400000);
        const res = await this._hass.callWS({
          type: "history/history_during_period",
          start_time: start.toISOString(), end_time: end.toISOString(),
          entity_ids: [this.entityId], minimal_response: false, no_attributes: false,
          significant_changes_only: false, include_start_time_state: true,
        });
        let attrs = {};
        const pts = (res[this.entityId] || []).map((r) => {
          if (r.a) attrs = { ...attrs, ...r.a };
          const t = ((r.lu ?? r.lc) || 0) * 1000;
          return { t: Math.max(t, start.getTime()), cur: num(attrs.current_temperature), tgt: num(attrs.temperature),
                   heat: attrs.hvac_action === "heating", win: !!attrs.window_effective };
        }).filter((p) => p.t);
        this._hist = { key, at: Date.now(), start: start.getTime(), end: end.getTime(), days, pts };
      } catch (err) {
        this._hist = { key, at: Date.now(), error: err.message || String(err) };
      } finally {
        this._histLoading = null;
        if (this._tab === "history") this._render();
      }
    }

    _historyHtml(a) {
      const days = this._histDays || 1;
      const h = this._hist;
      if (!h || h.key !== `${this.entityId}|${days}`) { this._loadHistory(days); }
      const seg = `<div class="seg small">${[[1, "24 h"], [7, "7 jours"]].map(([d, l]) => `<button data-hdays="${d}" class="${days === d ? "on" : ""}">${l}</button>`).join("")}</div>`;
      if (!h || h.key !== `${this.entityId}|${days}`) return `<div class="section">${seg}<div class="hint">Chargement…</div></div>`;
      if (h.error) return `<div class="section">${seg}<div class="error">Historique indisponible : ${esc(h.error)}</div></div>`;
      const pts = h.pts;
      if (pts.length < 2) return `<div class="section">${seg}<div class="hint">Pas encore assez d'historique.</div></div>`;

      // segments [t0,t1) avec l'état du point
      const segs = pts.map((p, i) => ({ ...p, t1: i + 1 < pts.length ? pts[i + 1].t : h.end }));
      const dur = (pred) => segs.reduce((acc, p) => acc + (pred(p) ? p.t1 - p.t : 0), 0);
      const heatMs = dur((p) => p.heat);
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const todayMs = segs.reduce((acc, p) => acc + (p.heat ? Math.max(0, p.t1 - Math.max(p.t, midnight.getTime())) : 0), 0);
      const onMs = dur((p) => p.tgt != null);
      const okMs = dur((p) => p.tgt != null && p.cur != null && p.cur >= p.tgt - 0.3);
      const curW = segs.filter((p) => p.cur != null);
      const avg = curW.length ? curW.reduce((acc, p) => acc + p.cur * (p.t1 - p.t), 0) / curW.reduce((acc, p) => acc + (p.t1 - p.t), 0) : null;
      const fmtDur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };

      // graphique
      const W = Math.max(300, Math.min(760, window.innerWidth) - 40), H = 210, L = 34, R = 8, T = 10, B = 26;
      const vals = pts.flatMap((p) => [p.cur, p.tgt]).filter((v) => v != null);
      let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
      if (hi - lo < 3) { hi = lo + 3; }
      const x = (t) => L + ((t - h.start) / (h.end - h.start)) * (W - L - R);
      const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const bands = (pred, cls) => {
        const out = [];
        for (const p of segs) {
          if (!pred(p)) continue;
          const last = out[out.length - 1];
          if (last && p.t - last.t1 < 60000) last.t1 = p.t1; else out.push({ t: p.t, t1: p.t1 });
        }
        return out.map((b) => `<rect class="${cls}" x="${x(b.t)}" y="${T}" width="${Math.max(1, x(b.t1) - x(b.t))}" height="${H - T - B}"></rect>`).join("");
      };
      const step = (key) => {
        let d = "", pen = false;
        for (const p of segs) {
          const v = p[key];
          if (v == null) { pen = false; continue; }
          d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(v).toFixed(1)}L${x(p.t1).toFixed(1)},${y(v).toFixed(1)}`;
          pen = true;
        }
        return d;
      };
      const line = (key) => {
        let d = "", pen = false;
        for (const p of segs) {
          const v = p[key];
          if (v == null) { pen = false; continue; }
          d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
          pen = true;
        }
        const last = segs[segs.length - 1];
        if (last[key] != null) d += `L${x(last.t1).toFixed(1)},${y(last[key]).toFixed(1)}`;
        return d;
      };
      const yTicks = [];
      for (let v = lo; v <= hi; v += (hi - lo > 8 ? 2 : 1)) yTicks.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"></line><text class="lbl" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}°</text>`);
      const xTicks = [];
      if (days === 1) {
        const d0 = new Date(h.start); d0.setMinutes(0, 0, 0);
        for (let t = d0.getTime() + 3600000; t < h.end; t += 3600000) {
          const hr = new Date(t).getHours();
          if (hr % 6 === 0) xTicks.push(`<line class="grid v" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}"></line><text class="lbl" x="${x(t)}" y="${H - 8}" text-anchor="middle">${hr} h</text>`);
        }
      } else {
        const d0 = new Date(h.start); d0.setHours(24, 0, 0, 0);
        for (let t = d0.getTime(); t < h.end; t += 86400000) {
          const dd = new Date(t);
          xTicks.push(`<line class="grid v" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}"></line><text class="lbl" x="${x(t + 43200000)}" y="${H - 8}" text-anchor="middle">${DAY_SHORT[DAYS[(dd.getDay() + 6) % 7]]}</text>`);
        }
      }
      const chart = `
        <svg class="chart" viewBox="0 0 ${W} ${H}">
          ${bands((p) => p.heat, "heat")}${bands((p) => p.win, "win")}
          ${yTicks.join("")}${xTicks.join("")}
          <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--primary-color)" stop-opacity=".18"></stop><stop offset="1" stop-color="var(--primary-color)" stop-opacity="0"></stop></linearGradient></defs>
          ${(() => { const d = line("cur"); const m = d.match(/^M([\d.]+),/); const e = d.match(/L([\d.]+),[\d.]+$/); return m && e && !d.slice(1).includes("M") ? `<path class="area" d="${d}L${e[1]},${H - B}L${m[1]},${H - B}Z"></path>` : ""; })()}
          <path class="tgt" d="${step("tgt")}"></path>
          <path class="cur" d="${line("cur")}"></path>
        </svg>`;
      // temps de chauffe par jour (7 jours)
      let daily = "";
      if (days === 7) {
        const byDay = [];
        const d0 = new Date(h.end); d0.setHours(0, 0, 0, 0);
        for (let i = 6; i >= 0; i--) {
          const st = d0.getTime() - i * 86400000, en = st + 86400000;
          const ms = segs.reduce((acc, p) => acc + (p.heat ? Math.max(0, Math.min(p.t1, en) - Math.max(p.t, st)) : 0), 0);
          byDay.push({ st, ms });
        }
        const mx = Math.max(3600000, ...byDay.map((d) => d.ms));
        daily = `
          <div class="section">
            <div class="label">Temps de chauffe par jour</div>
            <div class="dbars">${byDay.map((d) => `
              <div class="dbar"><span class="dv">${fmtDur(d.ms)}</span><span class="db" style="height:${Math.max(3, (d.ms / mx) * 100)}%"></span>
              <span class="dl">${DAY_SHORT[DAYS[(new Date(d.st).getDay() + 6) % 7]]}</span></div>`).join("")}</div>
          </div>`;
      }
      const kpi = (icon, v, k, c) => `<div class="kpi" style="--c:${c}"><span class="k-ic"><ha-icon icon="${icon}"></ha-icon></span><div><div class="v">${v}</div><div class="k">${k}</div></div></div>`;
      return `
        <div class="kpis">
          ${kpi("mdi:fire", fmtDur(todayMs), "de chauffe aujourd'hui", "var(--ci-comfort)")}
          ${kpi("mdi:clock-outline", fmtDur(heatMs), `sur ${days === 1 ? "24 h" : "7 jours"}${days === 7 ? ` · ${fmtDur(heatMs / 7)}/j` : ""}`, "var(--ci-comfort-plus)")}
          ${kpi("mdi:thermometer", avg == null ? "—" : fmtT(avg), "température moyenne", "var(--primary-color)")}
          ${kpi("mdi:target", onMs ? Math.round((okMs / onMs) * 100) + " %" : "—", "du temps à la consigne", "var(--ci-eco)")}
        </div>
        <div class="section">
          <div class="row wrap" style="justify-content:space-between">${seg}
            <div class="legend"><span class="lg"><span class="ln cur"></span>Mesurée</span><span class="lg"><span class="ln tgt"></span>Consigne</span><span class="lg"><span class="sq heat"></span>Chauffe</span><span class="lg"><span class="sq win"></span>Fenêtre</span></div>
          </div>
          ${chart}
        </div>
        ${daily}
        <div class="hint">« Chauffe » : la pièce est sous sa consigne. La PAC peut moduler sa puissance pendant ces périodes.</div>`;
    }

    // ------------------------------------------------------------ Réglages
    _settingsHtml(a) {
      const n = (v, d = 1) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d });
      const presets = [
        ["eco", "Eco", "mdi:leaf", "var(--ci-eco)", "Hors plages"],
        ["comfort", "Confort", "mdi:sofa", "var(--ci-comfort)", "Plages du planning"],
        ["comfort_plus", "Confort +", "mdi:fire", "var(--ci-comfort-plus)", "Plages renforcées"],
      ];
      // échelle
      const vals = [a.eco, a.comfort, a.comfort_plus, a.current_temperature].filter((v) => v != null).map(Number);
      const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
      const pos = (v) => ((Number(v) - lo) / (hi - lo)) * 100;
      const ticks = [];
      for (let v = lo; v <= hi; v++) ticks.push(`<span class="sc-tick ${v % 2 ? "" : "major"}" style="left:${pos(v)}%">${v % 2 ? "" : `<i>${v}°</i>`}</span>`);
      const scale = `
        <div class="scale">
          <div class="sc-bar"></div>
          ${ticks.join("")}
          ${presets.map(([k, l, , c]) => `<span class="sc-pin" style="left:${pos(a[k])}%;--c:${c}" title="${l} ${fmtT(a[k])}"><b>${fmtT(a[k])}</b></span>`).join("")}
          ${a.current_temperature != null ? `<span class="sc-now" style="left:${pos(a.current_temperature)}%" title="Mesuré"><b>${fmtT(a.current_temperature)}</b></span>` : ""}
        </div>`;
      const cards = presets.map(([k, l, icon, c, hint]) => `
        <div class="pc" style="--c:${c}">
          <div class="pc-head"><span class="pc-ic"><ha-icon icon="${icon}"></ha-icon></span><span class="pc-l">${l}<small>${hint}</small></span></div>
          <div class="pc-v">${n(a[k])}<span>°</span></div>
          <div class="pc-btns">
            <button data-set="${k}" data-delta="-0.5" aria-label="${l} moins"><ha-icon icon="mdi:minus"></ha-icon></button>
            <button data-set="${k}" data-delta="0.5" aria-label="${l} plus"><ha-icon icon="mdi:plus"></ha-icon></button>
          </div>
        </div>`).join("");

      // préchauffe
      const samples = (a.speed_samples || []).map(Number);
      const maxS = Math.max(5, ...samples, Number(a.speed) || 0);
      const bars = samples.length
        ? `<div class="spark">${samples.map((v, i) => `<span class="sb ${i === samples.length - 1 ? "last" : ""}" style="height:${Math.max(8, (v / maxS) * 100)}%" title="${n(v, 2)} °C/h"></span>`).join("")}
             <span class="sp-line" style="bottom:${(Number(a.speed) / maxS) * 100}%"></span></div>`
        : `<div class="spark empty">Aucune mesure</div>`;
      const rise = Number(a.comfort) - Number(a.eco);
      const mins = a.speed ? Math.round((rise / Number(a.speed)) * 60) : null;
      const dur = (m) => (m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
      const ll = a.last_learning;
      const llHtml = ll ? `
        <div class="last">
          <div class="last-h"><ha-icon icon="mdi:history"></ha-icon>Dernière préchauffe · ${new Date(ll.at).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ${new Date(ll.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
          <div class="last-row">
            <span class="lt">${fmtT(ll.start_temp)}</span>
            <span class="arrow"><i style="width:${Math.min(100, Math.max(8, ((Number(ll.measured) - Number(ll.start_temp)) / Math.max(0.5, Number(ll.target) - Number(ll.start_temp))) * 100))}%"></i></span>
            <span class="lt">${fmtT(ll.measured)}<small>/ ${fmtT(ll.target)}</small></span>
          </div>
          <div class="last-meta">
            <span><ha-icon icon="mdi:timer-outline"></ha-icon>${dur(Math.round(Number(ll.hours) * 60))} de préchauffe</span>
            ${ll.reached_after != null ? `<span><ha-icon icon="mdi:flag-checkered"></ha-icon>objectif atteint en ${dur(Math.round(Number(ll.reached_after) * 60))}</span>` : ""}
            ${ll.outdoor != null ? `<span><ha-icon icon="mdi:weather-cloudy"></ha-icon>${fmtT(ll.outdoor)} dehors</span>` : ""}
            <span><ha-icon icon="mdi:speedometer"></ha-icon>${n(ll.old_speed, 2)} → ${n(ll.new_speed, 2)} °C/h</span>
          </div>
        </div>` : `<div class="hint">Aucune préchauffe mesurée pour l'instant.</div>`;

      // état
      const syncMap = { ok: ["Synchronisé", "ok"], pending: ["Envoi en cours…", "wait"], verifying: ["Vérification…", "wait"], failed: ["Consigne non prise", "err"], unavailable: ["Indisponible", "err"], engine_off: ["Moteur coupé", "wait"], init: ["Démarrage…", "wait"] };
      const [syncTxt, syncCls] = syncMap[a.sync_status] || [a.sync_status, "wait"];
      const nWin = (a.windows || []).length;
      return `
        <div class="section">
          <div class="label">Consignes</div>
          ${scale}
          <div class="pcs">${cards}</div>
        </div>
        <div class="section">
          <div class="row" style="justify-content:space-between">
            <div class="label">Préchauffe</div>
            <label class="sw"><input type="checkbox" data-preheat ${a.preheat ? "checked" : ""}><span></span>${a.preheat ? "Activée" : "Désactivée"}</label>
          </div>
          <div class="ph ${a.preheat ? "" : "off"}">
            <div class="ph-main">
              <div class="ph-v">${n(a.speed, 2)}<span> °C/h</span></div>
              <div class="ph-sub">Eco → Confort en ~${dur(mins)} <small>(à 10° dehors)</small></div>
              <div class="pc-btns small">
                <button data-set="speed" data-delta="-0.1" aria-label="Vitesse moins"><ha-icon icon="mdi:minus"></ha-icon></button>
                <button data-set="speed" data-delta="0.1" aria-label="Vitesse plus"><ha-icon icon="mdi:plus"></ha-icon></button>
              </div>
            </div>
            <div class="ph-spark">
              ${bars}
              <div class="hint">${samples.length} mesure${samples.length > 1 ? "s" : ""} · médiane des 7 dernières</div>
            </div>
          </div>
          ${llHtml}
          <div class="hint">Un réglage manuel de la vitesse repart de zéro pour l'apprentissage.</div>
        </div>
        <div class="section">
          <div class="label">Pièce</div>
          <div class="info">
            <div class="ir"><ha-icon icon="mdi:hvac"></ha-icon><span class="ik">Zone Koolnova</span><span class="iv">${esc(a.koolnova_entity)}</span><span class="st ${syncCls}">${esc(syncTxt)}</span></div>
            <div class="ir"><ha-icon icon="${a.window_open ? "mdi:window-open-variant" : "mdi:window-closed-variant"}"></ha-icon><span class="ik">Fenêtres</span><span class="iv">${nWin ? `${nWin} capteur${nWin > 1 ? "s" : ""}` : "Aucun capteur"}</span>${nWin ? `<span class="st ${a.window_open ? "wait" : "ok"}">${a.window_open ? "Ouverte" : "Fermées"}</span>` : ""}</div>
            <div class="ir"><ha-icon icon="mdi:home-variant-outline"></ha-icon><span class="ik">Type</span><span class="iv">${a.usage === "secondary" ? "Pièce peu utilisée" : "Pièce principale"}</span></div>
          </div>
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
          ${w >= 17 ? `<span class="st"><b>${fmtT(slotTemp(sl, a))}</b> ${sl.start}–${sl.end}</span>` : w >= 4.5 ? `<span class="st"><b>${fmtT(slotTemp(sl, a))}</b></span>` : ""}</div>`;
      }).join("");
      const now = day === todayKey() ? `<div class="nowline" style="left:${(nowMin() / 1440) * 100}%"></div>` : "";
      return `<div class="track ${editable ? "edit" : ""}" data-track="${day}">${ticks}${blocks}${now}</div>`;
    }

    _planningHtml(a) {
      const hours = [0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${h}h</span>`).join("");
      const today = todayKey();
      const dayTotal = (d) => (this._draft[d] || []).filter((sl) => sl.preset !== "eco").reduce((acc, sl) => acc + toMin(sl.end) - toMin(sl.start), 0);
      const fmtH = (m) => (m ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : "—");
      const rows = DAYS.map((d) => `
        <div class="prow ${d === today ? "today" : ""}">
          <span class="dname">${DAY_SHORT[d]}${d === today ? "<i>auj.</i>" : ""}</span>
          ${this._timelineRow(a, d, true)}
          <span class="dtot" title="Temps en Confort / Confort + / Perso">${fmtH(dayTotal(d))}</span>
        </div>`).join("");
      const week = DAYS.reduce((acc, d) => acc + dayTotal(d), 0);
      const legend = ["eco", "comfort", "comfort_plus", "custom"].map((p) => `<span class="lgc" style="--c:${PRESETS[p].color}"><ha-icon icon="${PRESETS[p].icon}"></ha-icon>${PRESETS[p].label}${p !== "custom" ? ` <b>${fmtT(a[p])}</b>` : ""}</span>`).join("");
      const others = (this.zones || []).filter((z) => z !== this.entityId && this._hass.states[z]);
      return `
        <div class="legend2">${legend}<span class="lg muted">Hors plage : Eco ${fmtT(a.eco)}</span></div>
        <div class="pgrid">
          <div class="hours"><span class="dname"></span><div class="hl">${hours}</div><span class="dtot muted">Confort</span></div>
          ${rows}
          <div class="pfoot"><span class="muted">${fmtH(week)} de confort sur la semaine</span></div>
        </div>
        ${this._sel ? this._slotEditor(a) : `<div class="hint center"><ha-icon icon="mdi:gesture-tap"></ha-icon> Touche une zone vide pour ajouter une plage · fais glisser une plage ou ses bords (pas de ${SNAP} min)</div>`}
        <div class="tools2">
          <div class="tool">
            <div class="tool-h"><ha-icon icon="mdi:content-copy"></ha-icon>Copier un jour</div>
            <select data-copy-from>${DAYS.map((d) => `<option value="${d}" ${d === (this._copyFrom || "mon") ? "selected" : ""}>Le ${DAY_LONG[d]}</option>`).join("")}</select>
            <div class="days">${DAYS.map((d) => `<button data-copy-to="${d}" class="${this._copyDays.has(d) ? "on" : ""}">${DAY_SHORT[d].slice(0, 2)}</button>`).join("")}</div>
            <button class="btn" data-copy ${this._copyDays.size ? "" : "disabled"}>Copier</button>
          </div>
          ${others.length ? `<div class="tool">
            <div class="tool-h"><ha-icon icon="mdi:import"></ha-icon>Autre pièce</div>
            <select data-from-zone>${others.map((z) => `<option value="${esc(z)}">${esc(this._hass.states[z].attributes.friendly_name)}</option>`).join("")}</select>
            <span class="hint">Reprend toutes ses plages</span>
            <button class="btn" data-import>Reprendre</button>
          </div>` : ""}
          <div class="tool">
            <div class="tool-h"><ha-icon icon="mdi:calendar-start"></ha-icon>Modèles</div>
            <button class="btn" data-preset-week>Semaine de travail</button>
            <span class="hint">6h30–7h30 et 18h–22h30, week-end 8h–22h30</span>
            <button class="btn danger" data-clear><ha-icon icon="mdi:delete-sweep-outline"></ha-icon>Tout effacer</button>
          </div>
        </div>
        <div class="savebar ${this._dirty ? "dirty" : ""}">
          <span class="sv-st"><ha-icon icon="${this._dirty ? "mdi:pencil-circle" : "mdi:check-circle"}"></ha-icon>${this._dirty ? "Modifications non enregistrées" : "Planning enregistré"}</span>
          <button class="btn" data-cancel ${this._dirty ? "" : "disabled"}>Annuler</button>
          <button class="btn primary" data-save ${this._dirty ? "" : "disabled"}><ha-icon icon="mdi:content-save"></ha-icon>Enregistrer</button>
        </div>`;
    }

    _slotEditor(a) {
      const { day, index } = this._sel;
      const sl = this._draft[day][index];
      if (!sl) return "";
      const c = PRESETS[sl.preset].color;
      return `
        <div class="editor editor2" style="--c:${c}">
          <div class="ed-h">
            <span class="ed-ic"><ha-icon icon="${PRESETS[sl.preset].icon}"></ha-icon></span>
            <div><div class="ed-t">Plage du ${DAY_LONG[day]}</div><div class="muted">${sl.start} – ${sl.end} · ${fmtT(slotTemp(sl, a))}</div></div>
            <button class="icon" data-desel title="Fermer"><ha-icon icon="mdi:check"></ha-icon></button>
          </div>
          <div class="ed-times">
            <label><span>Début</span><input type="time" step="900" data-f="start" value="${sl.start}"></label>
            <ha-icon icon="mdi:arrow-right"></ha-icon>
            <label><span>Fin</span><input type="time" step="900" data-f="end" value="${sl.end === "24:00" ? "23:59" : sl.end}"></label>
          </div>
          <div class="ed-p">${Object.entries(PRESETS).map(([k, p]) => `
            <button data-p="${k}" class="${sl.preset === k ? "on" : ""}" style="--c:${p.color}"><ha-icon icon="${p.icon}"></ha-icon>${p.label}<small>${k !== "custom" ? fmtT(a[k]) : sl.preset === "custom" ? fmtT(sl.temp) : "au choix"}</small></button>`).join("")}</div>
          ${sl.preset === "custom" ? `<label class="row">Température <input type="number" min="7" max="30" step="0.5" data-f="temp" value="${sl.temp ?? a.comfort}"> °C</label>` : ""}
          <button class="btn danger" data-del><ha-icon icon="mdi:delete-outline"></ha-icon>Supprimer la plage</button>
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
      root.querySelectorAll("[data-hdays]").forEach((b) => b.addEventListener("click", () => { this._histDays = Number(b.dataset.hdays); this._render(); }));
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
    .tabs { overflow-x: auto; scrollbar-width: none; }
    @media (max-width: 520px) { .tab { padding: 8px 7px; font-size: 13px; gap: 4px; } .tab ha-icon { --mdc-icon-size: 16px; } }
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
    .chart { width: 100%; height: auto; display: block; margin-top: 6px; }
    .chart .grid { stroke: var(--divider-color); stroke-width: 1; }
    .chart .grid.v { stroke-dasharray: 2 3; }
    .chart .lbl { fill: var(--secondary-text-color); font-size: 11px; }
    .chart .heat { fill: var(--ci-comfort); opacity: .14; }
    .chart .win { fill: #42a5f5; opacity: .22; }
    .chart .tgt { fill: none; stroke: var(--ci-comfort); stroke-width: 2; stroke-dasharray: 5 3; vector-effect: non-scaling-stroke; }
    .chart .cur { fill: none; stroke: var(--primary-text-color); stroke-width: 2.2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
    .ln { width: 16px; height: 0; border-top: 2px solid var(--primary-text-color); display: inline-block; }
    .ln.tgt { border-top: 2px dashed var(--ci-comfort); }
    .sq { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .sq.heat { background: var(--ci-comfort); opacity: .35; }
    .sq.win { background: #42a5f5; opacity: .5; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .stat { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px; background: var(--secondary-background-color); }
    .stat .v { font-size: 20px; font-weight: 500; }
    .stat .k { font-size: 12px; color: var(--secondary-text-color); }

    .scale { position: relative; height: 62px; margin: 6px 6px 4px; }
    .sc-bar { position: absolute; left: 0; right: 0; top: 30px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, #42a5f5, var(--ci-eco) 30%, var(--ci-comfort) 65%, var(--ci-comfort-plus)); opacity: .85; }
    .sc-tick { position: absolute; top: 40px; width: 1px; height: 5px; background: var(--divider-color); }
    .sc-tick.major { height: 7px; background: var(--secondary-text-color); opacity: .6; }
    .sc-tick i { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); font-style: normal; font-size: 10px; color: var(--secondary-text-color); }
    .sc-pin { position: absolute; top: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; }
    .sc-pin b { font-size: 11px; font-weight: 600; color: #fff; background: var(--c); padding: 2px 6px; border-radius: 8px; white-space: nowrap; }
    .sc-pin::after { content: ""; width: 2px; height: 14px; background: var(--c); }
    .sc-now { position: absolute; top: 26px; transform: translateX(-50%); width: 16px; height: 16px; border-radius: 50%; background: var(--card-background-color); border: 3px solid var(--primary-text-color); box-sizing: border-box; }
    .sc-now b { position: absolute; top: 26px; left: 50%; transform: translateX(-50%); font-size: 10px; white-space: nowrap; color: var(--primary-text-color); }
    .pcs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 18px; }
    .pc { border-radius: 14px; padding: 10px; background: linear-gradient(160deg, color-mix(in srgb, var(--c) 16%, var(--secondary-background-color)), var(--secondary-background-color) 70%); border: 1px solid color-mix(in srgb, var(--c) 25%, transparent); display: flex; flex-direction: column; gap: 6px; }
    .pc-head { display: flex; align-items: center; gap: 8px; }
    .pc-ic { width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--c); flex: none; }
    .pc-ic ha-icon { --mdc-icon-size: 17px; }
    .pc-l { font-size: 13px; font-weight: 500; display: flex; flex-direction: column; line-height: 1.15; }
    .pc-l small { font-size: 10.5px; font-weight: 400; color: var(--secondary-text-color); }
    .pc-v { font-size: 30px; font-weight: 400; letter-spacing: -.5px; line-height: 1; }
    .pc-v span { font-size: .55em; vertical-align: top; opacity: .7; }
    .pc-btns { display: flex; gap: 6px; }
    .pc-btns button { flex: 1; font: inherit; border: none; border-radius: 10px; padding: 6px 0; cursor: pointer; background: color-mix(in srgb, var(--c, var(--primary-color)) 18%, transparent); color: var(--primary-text-color); display: inline-flex; align-items: center; justify-content: center; }
    .pc-btns button:hover { background: color-mix(in srgb, var(--c, var(--primary-color)) 30%, transparent); }
    .pc-btns button ha-icon { --mdc-icon-size: 18px; }
    .pc-btns.small { max-width: 120px; --c: var(--primary-color); }
    @media (max-width: 460px) { .pc-l small { display: none; } .pc-v { font-size: 26px; } }
    .sw { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; color: var(--secondary-text-color); }
    .sw input { display: none; }
    .sw span { width: 36px; height: 20px; border-radius: 10px; background: var(--divider-color); position: relative; transition: background .2s; }
    .sw span::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
    .sw input:checked + span { background: var(--primary-color); }
    .sw input:checked + span::after { transform: translateX(16px); }
    .ph { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .ph.off { opacity: .45; }
    @media (max-width: 460px) { .ph { grid-template-columns: 1fr; } }
    .ph-main, .ph-spark, .last { border-radius: 14px; padding: 12px; background: var(--secondary-background-color); display: flex; flex-direction: column; gap: 6px; }
    .ph-v { font-size: 30px; line-height: 1; }
    .ph-v span { font-size: 14px; color: var(--secondary-text-color); }
    .ph-sub { font-size: 13px; }
    .ph-sub small { color: var(--secondary-text-color); }
    .spark { position: relative; display: flex; align-items: flex-end; gap: 5px; height: 64px; padding-bottom: 1px; border-bottom: 1px solid var(--divider-color); }
    .spark.empty { align-items: center; justify-content: center; font-size: 12px; color: var(--secondary-text-color); }
    .sb { flex: 1; max-width: 26px; border-radius: 5px 5px 2px 2px; background: color-mix(in srgb, var(--primary-color) 45%, transparent); }
    .sb.last { background: var(--primary-color); }
    .sp-line { position: absolute; left: 0; right: 0; border-top: 2px dashed var(--ci-comfort); }
    .last-h { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--secondary-text-color); }
    .last-h ha-icon, .last-meta ha-icon { --mdc-icon-size: 15px; }
    .last-row { display: flex; align-items: center; gap: 10px; }
    .lt { font-size: 18px; font-weight: 500; white-space: nowrap; }
    .lt small { font-size: 12px; font-weight: 400; color: var(--secondary-text-color); margin-left: 3px; }
    .arrow { flex: 1; height: 6px; border-radius: 3px; background: var(--divider-color); overflow: hidden; }
    .arrow i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--ci-eco), var(--ci-comfort)); }
    .last-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--secondary-text-color); }
    .last-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .info { display: flex; flex-direction: column; border-radius: 14px; background: var(--secondary-background-color); overflow: hidden; }
    .ir { display: flex; align-items: center; gap: 10px; padding: 10px 12px; font-size: 14px; }
    .ir + .ir { border-top: 1px solid var(--divider-color); }
    .ir ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
    .ik { color: var(--secondary-text-color); min-width: 110px; }
    .iv { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .st { font-size: 12px; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
    .st.ok { background: rgba(67, 160, 71, .18); color: #66bb6a; }
    .st.wait { background: rgba(255, 179, 0, .18); color: #ffb300; }
    .st.err { background: rgba(229, 57, 53, .18); color: #ef5350; }
    @media (max-width: 460px) { .ik { min-width: 0; } .ir .iv { font-size: 12px; } }

    .dial { display: flex; align-items: center; justify-content: center; gap: 18px; }
    .dial-c { position: relative; width: 230px; height: 230px; }
    .dial-c svg { width: 100%; height: 100%; overflow: visible; }
    .dial .trk, .dial .val { fill: none; stroke-width: 12; stroke-linecap: round; }
    .dial .trk { stroke: var(--divider-color); }
    .dial .val { stroke: var(--accent); transition: stroke-dasharray .4s; }
    .dial.heating .val { animation: dglow 2s ease-in-out infinite; }
    @keyframes dglow { 50% { opacity: .55; } }
    .dial .tk { stroke: var(--divider-color); stroke-width: 1.2; }
    .dial .tk.mj { stroke: var(--secondary-text-color); opacity: .6; stroke-width: 1.6; }
    .dial .tgt { fill: var(--card-background-color); stroke: var(--accent); stroke-width: 4; }
    .dial .cur { fill: var(--primary-text-color); }
    .dial-in { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
    .d-lbl { font-size: 12px; color: var(--secondary-text-color); }
    .d-tgt { font-size: 56px; font-weight: 300; line-height: 1; letter-spacing: -1.5px; color: var(--accent); }
    .d-tgt span { font-size: .45em; vertical-align: top; }
    .d-tgt ha-icon { --mdc-icon-size: 44px; }
    .d-cur { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--secondary-text-color); margin-top: 4px; }
    .d-cur ha-icon { --mdc-icon-size: 15px; }
    .dbtn { width: 52px; height: 52px; border-radius: 50%; border: 1px solid var(--divider-color); background: var(--secondary-background-color); color: var(--primary-text-color); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .dbtn:hover { border-color: var(--accent); color: var(--accent); }
    .dbtn ha-icon { --mdc-icon-size: 26px; }
    @media (max-width: 420px) { .dial { gap: 8px; } .dial-c { width: 200px; height: 200px; } .dbtn { width: 44px; height: 44px; } .d-tgt { font-size: 48px; } }
    .status { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; margin-top: 4px; }
    .chip-st { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; padding: 7px 14px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--primary-text-color); }
    .chip-st ha-icon { --mdc-icon-size: 18px; color: var(--accent); }
    .hint.center { text-align: center; }
    .mgrid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
    @media (max-width: 460px) { .mgrid { grid-template-columns: repeat(5, 1fr); gap: 4px; } .mt-l { font-size: 11px !important; } }
    .mt { font: inherit; border: 1px solid var(--divider-color); background: var(--secondary-background-color); color: var(--primary-text-color); border-radius: 14px; padding: 10px 4px 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; transition: border-color .15s, background .15s; }
    .mt-ic { width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); }
    .mt-ic ha-icon { --mdc-icon-size: 19px; }
    .mt-l { font-size: 12.5px; font-weight: 500; white-space: nowrap; }
    .mt-s { font-size: 11px; color: var(--secondary-text-color); }
    .mt.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, var(--secondary-background-color)); box-shadow: 0 0 0 1px var(--c) inset; }
    .mt.on .mt-ic { background: var(--c); color: #fff; }
    .boost { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; background: var(--secondary-background-color); flex-wrap: wrap; }
    .boost.on { background: color-mix(in srgb, var(--ci-comfort-plus) 14%, var(--secondary-background-color)); border: 1px solid color-mix(in srgb, var(--ci-comfort-plus) 40%, transparent); }
    .b-ic { width: 40px; height: 40px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--ci-comfort-plus) 18%, transparent); color: var(--ci-comfort-plus); flex: none; }
    .boost.on .b-ic { background: var(--ci-comfort-plus); color: #fff; }
    .b-body { flex: 1; min-width: 140px; display: flex; flex-direction: column; gap: 4px; }
    .b-t { font-size: 15px; font-weight: 500; }
    .b-s { font-size: 12px; color: var(--secondary-text-color); }
    .b-bar { height: 6px; border-radius: 3px; background: var(--divider-color); overflow: hidden; }
    .b-bar i { display: block; height: 100%; background: var(--ci-comfort-plus); }
    .b-ch { display: flex; gap: 6px; }
    .b-ch button { font: inherit; font-size: 13px; border: none; border-radius: 10px; padding: 8px 12px; cursor: pointer; background: color-mix(in srgb, var(--ci-comfort-plus) 18%, transparent); color: var(--primary-text-color); }
    .b-ch button:hover { background: color-mix(in srgb, var(--ci-comfort-plus) 32%, transparent); }
    .hl.tl { margin-top: 2px; }

    .legend2 { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 12px; font-size: 12px; }
    .lgc { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; background: color-mix(in srgb, var(--c) 16%, transparent); }
    .lgc ha-icon { --mdc-icon-size: 15px; color: var(--c); }
    .pgrid { border-radius: 14px; background: var(--secondary-background-color); padding: 10px 10px 6px; }
    .pgrid .hours, .pgrid .prow { grid-template-columns: 40px 1fr 46px; }
    .pgrid .track { background: var(--card-background-color); }
    .prow.today .dname { color: var(--primary-color); font-weight: 600; }
    .dname i { display: block; font-style: normal; font-size: 9.5px; font-weight: 400; }
    .dtot { font-size: 11.5px; text-align: right; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
    .prow.today .track { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--primary-color) 60%, transparent); }
    .slot .st b { font-weight: 600; }
    .pfoot { display: flex; justify-content: flex-end; font-size: 12px; padding: 4px 2px 0; }
    .hint.center { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 10px 0; }
    .hint.center ha-icon { --mdc-icon-size: 16px; }
    .editor2 { margin: 12px 0; padding: 12px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); background: linear-gradient(160deg, color-mix(in srgb, var(--c) 14%, var(--secondary-background-color)), var(--secondary-background-color) 70%); display: flex; flex-direction: column; gap: 12px; }
    .ed-h { display: flex; align-items: center; gap: 10px; }
    .ed-h > div { flex: 1; }
    .ed-ic { width: 36px; height: 36px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--c); color: #fff; }
    .ed-t { font-weight: 500; }
    .ed-times { display: flex; align-items: center; gap: 10px; }
    .ed-times label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--secondary-text-color); flex: 1; }
    .ed-times input { font: inherit; font-size: 18px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
    .ed-p { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .ed-p button { font: inherit; font-size: 12.5px; border: 1px solid var(--divider-color); border-radius: 12px; padding: 8px 4px; background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .ed-p button ha-icon { --mdc-icon-size: 18px; color: var(--c); }
    .ed-p button small { font-size: 11px; color: var(--secondary-text-color); }
    .ed-p button.on { border-color: var(--c); box-shadow: 0 0 0 1px var(--c) inset; background: color-mix(in srgb, var(--c) 14%, var(--card-background-color)); }
    .editor2 input[type=number] { font: inherit; width: 80px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
    .editor2 .btn.danger { align-self: flex-start; }
    .tools2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; margin-top: 12px; }
    .tool { border-radius: 14px; background: var(--secondary-background-color); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .tool-h { display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 14px; }
    .tool-h ha-icon { --mdc-icon-size: 18px; color: var(--primary-color); }
    .tool select { font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
    .tool .btn { justify-content: center; }
    .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
    .days button { font: inherit; font-size: 11.5px; padding: 6px 0; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer; }
    .days button.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
    .savebar .sv-st { margin-right: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--secondary-text-color); }
    .savebar .sv-st ha-icon { --mdc-icon-size: 18px; color: var(--ci-eco); }
    .savebar.dirty .sv-st { color: var(--warning-color, #ffa600); }
    .savebar.dirty .sv-st ha-icon { color: var(--warning-color, #ffa600); }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0 4px; }
    @media (max-width: 560px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
    .kpi { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: linear-gradient(160deg, color-mix(in srgb, var(--c) 14%, var(--secondary-background-color)), var(--secondary-background-color) 70%); }
    .k-ic { width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--c); flex: none; }
    .k-ic ha-icon { --mdc-icon-size: 18px; }
    .kpi .v { font-size: 19px; font-weight: 500; line-height: 1.1; }
    .kpi .k { font-size: 11.5px; color: var(--secondary-text-color); }
    .chart .area { fill: url(#ga); stroke: none; }
    .dbars { display: flex; align-items: flex-end; gap: 8px; height: 130px; padding-top: 4px; }
    .dbar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
    .db { width: 100%; max-width: 44px; border-radius: 8px 8px 3px 3px; background: linear-gradient(180deg, var(--ci-comfort-plus), var(--ci-comfort)); }
    .dbar:last-child .db { box-shadow: 0 0 0 2px var(--primary-text-color); }
    .dv { font-size: 10.5px; color: var(--secondary-text-color); white-space: nowrap; }
    .dl { font-size: 12px; }
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
