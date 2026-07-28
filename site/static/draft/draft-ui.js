
import { teamOnClock, teamForRole, currentPhase, heroIsUsed, chogallIsPickable } from "./draft-state.js";
import { matchesSearchEntry, normalizeSearchValue } from "../js/search.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "disabled") node.disabled = !!v;
    else node.setAttribute(k, String(v));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function normalizeLobbyCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

function heroById(draftData, id) { return draftData.heroes.find(h => h.id === id); }

function boardStyleForBattleground(bg) {
  if (!bg?.background) return null;
  return `--draft-map-bg: url("${bg.background}")`;
}

export function renderLanding(root, { onCreate, onJoin, prefilledCode = "", prefilledName = "", message = null }) {
  root.innerHTML = "";
  root.dataset.state = "landing";

  const nameInput = el("input", { type: "text", placeholder: "Your name", class: "draft-input", maxlength: "20", value: prefilledName });
  const codeInput = el("input", { type: "text", placeholder: "ABCD", class: "draft-input draft-input--code", maxlength: "4", value: prefilledCode });

  codeInput.addEventListener("input", () => {
    const norm = normalizeLobbyCode(codeInput.value);
    if (codeInput.value !== norm) codeInput.value = norm;
  });

  const hasPrefill = !!prefilledCode;
  const createBtn = el("button", {
    class: hasPrefill ? "draft-btn" : "draft-btn draft-btn--primary",
    onClick: () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      onCreate({ name });
    },
  }, "Create lobby");

  const joinBtn = el("button", {
    class: hasPrefill ? "draft-btn draft-btn--primary" : "draft-btn",
    onClick: () => {
      const name = nameInput.value.trim();
      const lobbyCode = normalizeLobbyCode(codeInput.value);
      if (!name) { nameInput.focus(); return; }
      if (lobbyCode.length !== 4) { codeInput.focus(); return; }
      onJoin({ name, lobbyCode });
    },
  }, "Join lobby");

  const joinSection = el("div", { class: "draft-form" }, [
    el("label", {}, ["Lobby code", codeInput]),
    el("div", { class: "draft-actions" }, [joinBtn]),
  ]);
  const createSection = el("div", { class: "draft-actions" }, [createBtn]);

  root.appendChild(el("section", { class: "draft-landing" }, [
    message ? el("p", { class: "draft-message draft-message--warn" }, message) : null,
    el("p", { class: "draft-blurb" }, hasPrefill
      ? "You were invited to a lobby. Enter your name and join."
      : "Practice drafts against another captain. Create a lobby and share the code, or paste a code to join."),
    el("div", { class: "draft-form" }, [
      el("label", {}, ["Name", nameInput]),
      ...(hasPrefill ? [joinSection, el("hr", { class: "draft-sep" }), createSection] : [createSection, el("hr", { class: "draft-sep" }), joinSection]),
    ]),
  ]));
}

export function renderLobby(root, {
  lobbyCode,
  captains,
  role,
  isHost,
  hostConfig,
  draftData,
  onConfigChange,
  onPickMap,
  onStartDraft,
  onLeave,
}) {
  root.innerHTML = "";
  root.dataset.state = "lobby";
  const lobbyUrl = `${location.origin}${location.pathname}?lobby=${lobbyCode}`;

  const header = el("div", { class: "draft-lobby__header" }, [
    el("div", { class: "draft-lobby__code" }, ["Lobby ", el("strong", {}, lobbyCode)]),
    el("div", { class: "draft-actions" }, [
      el("button", {
        class: "draft-btn",
        onClick: () => { navigator.clipboard?.writeText(lobbyUrl); },
      }, "Copy link"),
      el("button", { class: "draft-btn", onClick: () => onLeave?.() }, "Leave"),
    ]),
  ]);

  function seat(team, info) {
    return el("div", { class: `draft-seat draft-seat--${team}` }, [
      el("div", { class: "draft-seat__label" }, team === "blue" ? "Blue" : "Red"),
      el("div", { class: "draft-seat__name" }, info ? info.name : "Waiting…"),
    ]);
  }

  const seats = el("div", { class: "draft-seats" }, [seat("blue", captains.blue), seat("red", captains.red)]);

  let configNode = null;
  if (isHost) {
    const timerSel = el("select", {
      onChange: (e) => onConfigChange({ ...hostConfig, timerMode: e.target.value }),
    }, [
      el("option", { value: "timed",   selected: hostConfig.timerMode === "timed" }, "Timed"),
      el("option", { value: "untimed", selected: hostConfig.timerMode === "untimed" }, "Untimed"),
    ]);
    const fpSel = el("select", {
      onChange: (e) => onConfigChange({ ...hostConfig, firstPick: e.target.value, map: null }),
    }, [
      el("option", { value: "blue",   selected: hostConfig.firstPick === "blue" }, "Blue first"),
      el("option", { value: "red",    selected: hostConfig.firstPick === "red" }, "Red first"),
    ]);
    const mapModeSel = el("select", {
      onChange: (e) => onConfigChange({ ...hostConfig, mapPickMode: e.target.value, map: null }),
    }, [
      el("option", { value: "captain", selected: hostConfig.mapPickMode === "captain" }, "Second-pick captain picks"),
      el("option", { value: "random",  selected: hostConfig.mapPickMode === "random" }, "Random"),
    ]);
    configNode = el("div", { class: "draft-config" }, [
      el("label", {}, ["Timer mode", timerSel]),
      el("label", {}, ["First pick",  fpSel]),
      el("label", {}, ["Map selection", mapModeSel]),
    ]);
  } else {
    configNode = el("div", { class: "draft-config" }, [
      el("div", {}, `Timer mode: ${hostConfig.timerMode}`),
      el("div", {}, `First pick: ${hostConfig.firstPick}`),
      el("div", {}, `Map selection: ${hostConfig.mapPickMode === "captain" ? "second-pick captain" : "random"}`),
    ]);
  }

  const secondPickCaptainRole =
    (hostConfig.firstPick === "blue") ? "captain-red"
    : (hostConfig.firstPick === "red") ? "captain-blue"
    : null;

  const canPickMap =
    hostConfig.mapPickMode === "captain"
    && secondPickCaptainRole != null
    && role === secondPickCaptainRole
    && !hostConfig.map;

  let mapNode;
  if (hostConfig.map) {
    const bg = draftData.battlegrounds.find(b => b.slug === hostConfig.map);
    mapNode = el("div", { class: "draft-map draft-map--locked" }, ["Map: ", el("strong", {}, bg?.name ?? hostConfig.map)]);
  } else if (canPickMap) {
    mapNode = el("div", { class: "draft-map draft-map--pick" }, [
      el("div", {}, "Pick the battleground:"),
      el("div", { class: "draft-map__grid" },
        draftData.battlegrounds.map(b =>
          el("button", { class: "draft-map__btn", onClick: () => onPickMap({ map: b.slug }) }, b.name)
        )),
    ]);
  } else if (hostConfig.mapPickMode === "random" && isHost) {
    mapNode = el("div", { class: "draft-map draft-map--pick" }, [
      el("button", {
        class: "draft-btn",
        onClick: () => {
          const pool = draftData.battlegrounds;
          const choice = pool[Math.floor(Math.random() * pool.length)];
          onPickMap({ map: choice.slug });
        },
      }, "Roll random map"),
    ]);
  } else {
    const label = hostConfig.firstPick === "random"
      ? "First pick must be set before the map can be selected."
      : hostConfig.mapPickMode === "random"
        ? "Waiting for host to roll map…"
        : `Waiting for ${secondPickCaptainRole === "captain-blue" ? "blue" : "red"} captain to pick map…`;
    mapNode = el("div", { class: "draft-map draft-map--waiting" }, label);
  }

  const canStart = !!captains.blue && !!captains.red && !!hostConfig.map && hostConfig.firstPick !== "random";
  const fpResolved = hostConfig.firstPick !== "random";
  const startNode = isHost
    ? el("button", {
        class: "draft-btn draft-btn--primary",
        disabled: !canStart,
        onClick: () => { if (canStart) onStartDraft(); },
      }, canStart ? "Start draft" : (fpResolved ? "Waiting…" : "Pick first-pick team"))
    : el("div", { class: "draft-await" }, canStart ? "Ready — host will start." : "Waiting for players & map…");

  root.appendChild(el("section", { class: "draft-lobby" }, [
    header,
    seats,
    configNode,
    mapNode,
    el("div", { class: "draft-start" }, [startNode]),
  ]));
}
const ROLE_ROWS = [
  { key: "tank",    label: "Tank",            icon: "tank.webp",    roles: ["Tank"] },
  { key: "bruiser", label: "Bruiser",         icon: "bruiser.webp", roles: ["Bruiser"] },
  { key: "melee",   label: "Melee Assassin",  icon: "melee.webp",   roles: ["Melee Assassin"] },
  { key: "ranged",  label: "Ranged Assassin", icon: "ranged.webp",  roles: ["Ranged Assassin"] },
  { key: "healer",  label: "Healer",          icon: "healer.webp",  roles: ["Healer"] },
  { key: "support", label: "Support",         icon: "support.webp", roles: ["Support"] },
];

function pickSlot(state, draftData, team, idx, isNextPickSlot) {
  const heroId = state.picks[team][idx];
  const h = heroId ? heroById(draftData, heroId) : null;
  const cls = ["draft-pickhex", `draft-pickhex--${team}`, idx % 2 === 0 ? "draft-pickhex--even" : "draft-pickhex--odd"];
  if (!h) cls.push("draft-pickhex--empty");
  if (isNextPickSlot) cls.push("draft-pickhex--next");
  return el("div", { class: cls.join(" "), title: h ? h.name : (isNextPickSlot ? "On the clock" : "Empty") }, [
    el("div", { class: "draft-pickhex__inner" }, [
      h
        ? el("img", { src: `/images/heroportraits/${h.portrait}`, alt: h.name })
        : el("div", { class: "draft-pickhex__placeholder" }, isNextPickSlot ? "?" : ""),
    ]),
  ]);
}

function banStrip(state, draftData, team) {
  return el("div", { class: `draft-banstrip draft-banstrip--${team}` },
    Array.from({ length: 3 }, (_, i) => {
      const heroId = state.bans[team][i];
      const h = heroId ? heroById(draftData, heroId) : null;
      return el("div", { class: "draft-banslot" + (h ? "" : " draft-banslot--empty") },
        h ? el("img", { src: `/images/heroportraits/${h.portrait}`, alt: h.name, title: `Banned: ${h.name}` }) : null);
    })
  );
}

function captainColumn(state, draftData, team, side, onClock) {
  const isOnClock = onClock === team;
  const phase = currentPhase(state);
  const nextPickIdx = isOnClock && phase?.action === "pick"
    ? state.picks[team].length
    : -1;
  const slots = Array.from({ length: 5 }, (_, i) =>
    pickSlot(state, draftData, team, i, i === nextPickIdx));
  return el("div", { class: `draft-captain draft-captain--${side} draft-captain--${team}` + (isOnClock ? " draft-captain--onclock" : "") }, [
    el("div", { class: "draft-captain__picks" }, slots),
  ]);
}

export function renderDraft(root, { state, draftData, role, highlight, searchQuery = "", focusSearch = false, focusHero = null, onHighlight, onLockIn, onSearchQueryChange, timerSeconds }) {
  root.innerHTML = "";
  root.dataset.state = "drafting";

  const onClock = teamOnClock(state);
  const phase = currentPhase(state);
  const myTeam = teamForRole(role);
  const leftTeam = myTeam ?? "blue";
  const rightTeam = leftTeam === "blue" ? "red" : "blue";
  const iAmOnClock = !!myTeam && onClock === myTeam;

  let timerCls = "draft-timer";
  let timerText = "—";
  if (state.timerMode === "timed") {
    const sec = Math.max(0, Math.ceil(timerSeconds));
    timerText = `${sec}`;
    if (sec <= 5) timerCls += " draft-timer--critical";
    else if (sec <= 10) timerCls += " draft-timer--warn";
  }

  const phaseAction = phase?.action === "ban" ? "BAN" : "PICK";
  const phaseLine = onClock
    ? `${onClock === leftTeam ? "YOUR TEAM" : "ENEMY TEAM"} · ${phaseAction}`
    : "";

  const bg = draftData.battlegrounds.find(b => b.slug === state.map);

  const leftName  = state.captains[leftTeam]?.name  ?? "—";
  const rightName = state.captains[rightTeam]?.name ?? "—";

  const header = el("div", { class: "draft-header" }, [
    el("div", { class: `draft-header__team draft-header__team--left draft-header__team--${leftTeam}` + (onClock === leftTeam ? " draft-header__team--onclock" : "") }, leftName),
    el("div", { class: `draft-header__bans draft-header__bans--left draft-header__bans--${leftTeam}` }, [banStrip(state, draftData, leftTeam)]),
    el("div", { class: "draft-header__center" }, [
      el("div", { class: timerCls }, timerText),
      el("div", { class: "draft-header__phase" + (iAmOnClock ? " draft-header__phase--mine" : "") }, phaseLine),
      el("div", { class: "draft-header__map" }, (bg?.name ?? state.map ?? "").toUpperCase()),
    ]),
    el("div", { class: `draft-header__bans draft-header__bans--right draft-header__bans--${rightTeam}` }, [banStrip(state, draftData, rightTeam)]),
    el("div", { class: `draft-header__team draft-header__team--right draft-header__team--${rightTeam}` + (onClock === rightTeam ? " draft-header__team--onclock" : "") }, rightName),
  ]);

  const sq = normalizeSearchValue(searchQuery);
  const heroMatches = (h) => matchesSearchEntry({ name: h.name }, searchQuery);
  const heroRows = ROLE_ROWS.map(row => {
    const heroes = draftData.heroes.filter(h => row.roles.includes(h.role));
    return el("div", { class: `draft-roleRow draft-roleRow--${row.key}` }, [
      el("div", { class: "draft-roleRow__label" }, [
        el("img", { class: "draft-roleRow__icon", src: `/draft/roles/${row.icon}`, alt: row.label, title: row.label }),
      ]),
      el("div", { class: "draft-roleRow__heroes" },
        heroes.map(h => {
          const used = heroIsUsed(state, h.id);
          const isChogallHero = h.id === "Chogall" || h.id === "Gall";
          const chogallBlocked = isChogallHero && phase?.action === "pick" && !chogallIsPickable(state);
          const isHighlight = iAmOnClock && highlight === h.id;
          const isDim = sq && !heroMatches(h);
          return el("button", {
            class: "draft-hero" + (used ? " draft-hero--used" : "") + (isHighlight ? " draft-hero--highlight" : "") + (isDim ? " draft-hero--dim" : ""),
            "data-hero-id": h.id,
            disabled: used || !iAmOnClock || chogallBlocked,
            tabindex: isDim ? "-1" : null,
            onClick: () => { if (!used && iAmOnClock && !chogallBlocked) onHighlight({ hero: h.id }); },
            onFocus: () => { if (!used && iAmOnClock && !chogallBlocked && !isHighlight) onHighlight({ hero: h.id, focusHero: true }); },
            onKeyDown: (e) => {
              if (e.key !== "Enter" || used || !iAmOnClock || chogallBlocked) return;
              e.preventDefault();
              onLockIn({ hero: h.id });
            },
            title: h.name,
          }, [
            el("img", { src: `/images/heroportraits/${h.portrait}`, alt: h.name }),
          ]);
        })
      ),
    ]);
  });

  let matchCount = 0;
  let availableCount = 0;
  for (const h of draftData.heroes) {
    if (!heroIsUsed(state, h.id)) availableCount++;
  }
  if (sq) {
    for (const h of draftData.heroes) {
      if (!heroIsUsed(state, h.id) && heroMatches(h)) matchCount++;
    }
  }
  const searchInput = el("input", {
    type: "search",
    class: "draft-search__input",
    value: searchQuery,
    placeholder: "Search heroes",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Search heroes",
    onInput: (e) => onSearchQueryChange?.({ query: e.target.value }),
    onKeyDown: (e) => {
      if (e.key === "Escape" && searchQuery) {
        e.preventDefault();
        onSearchQueryChange?.({ query: "" });
        return;
      }
      if (e.key === "Enter" && iAmOnClock && highlight) {
        e.preventDefault();
        onLockIn({ hero: highlight });
      }
    },
  });
  const searchBar = el("div", { class: "draft-search" }, [
    searchInput,
    el(
      "span",
      { class: "draft-search__count" },
      sq
        ? `${matchCount} match${matchCount !== 1 ? "es" : ""}`
        : `${availableCount} available`
    ),
    el("span", { class: "draft-search__hint" }, sq ? "Esc to clear" : "Type to filter"),
  ]);

  const lockBtn = el("button", {
    class: "draft-lockin draft-lockin--" + phaseAction.toLowerCase() + (iAmOnClock && highlight ? " draft-lockin--ready" : ""),
    disabled: !iAmOnClock || !highlight,
    onClick: () => { if (iAmOnClock && highlight) onLockIn({ hero: highlight }); },
  }, phaseAction);
  let indicatorText, indicatorMine;
  if (!onClock) {
    indicatorText = "Draft complete";
    indicatorMine = false;
  } else if (iAmOnClock) {
    indicatorText = phaseAction === "BAN" ? "Your turn — ban a hero" : "Your turn — pick a hero";
    indicatorMine = true;
  } else {
    const who = state.captains[onClock]?.name ?? (onClock === leftTeam ? leftName : rightName);
    indicatorText = `${who} is ${phaseAction === "BAN" ? "banning" : "picking"}…`;
    indicatorMine = false;
  }
  const indicator = el("div", {
    class: "draft-indicator draft-indicator--" + phaseAction.toLowerCase() + (indicatorMine ? " draft-indicator--mine" : ""),
  }, indicatorText);

  root.appendChild(el("section", { class: "draft-board", style: boardStyleForBattleground(bg) }, [
    header,
    el("div", { class: "draft-stage" }, [
      captainColumn(state, draftData, leftTeam, "left", onClock),
      el("div", { class: "draft-grid" }, [indicator, searchBar, ...heroRows]),
      captainColumn(state, draftData, rightTeam, "right", onClock),
    ]),
    el("div", { class: "draft-lockbar" }, [lockBtn]),
  ]));

  const heroToFocus = focusHero
    ? root.querySelector(`.draft-hero[data-hero-id="${focusHero}"]`)
    : null;
  if (heroToFocus) {
    heroToFocus.focus({ preventScroll: true });
  } else if (focusSearch) {
    searchInput.focus({ preventScroll: true });
    const end = searchInput.value.length;
    searchInput.setSelectionRange(end, end);
  }
}

export function renderResult(root, { state, draftData, shareUrl }) {
  root.innerHTML = "";
  root.dataset.state = "result";
  const leftTeam = "blue";
  const rightTeam = "red";

  const bg = draftData.battlegrounds.find(b => b.slug === state.map);
  const leftName  = state.captains[leftTeam]?.name  ?? "Blue";
  const rightName = state.captains[rightTeam]?.name ?? "Red";

  const header = el("div", { class: "draft-header" }, [
    el("div", { class: `draft-header__team draft-header__team--left draft-header__team--${leftTeam}` }, leftName),
    el("div", { class: `draft-header__bans draft-header__bans--left draft-header__bans--${leftTeam}` }, [banStrip(state, draftData, leftTeam)]),
    el("div", { class: "draft-header__center" }, [
      el("div", { class: "draft-header__map" }, (bg?.name ?? state.map ?? "").toUpperCase()),
    ]),
    el("div", { class: `draft-header__bans draft-header__bans--right draft-header__bans--${rightTeam}` }, [banStrip(state, draftData, rightTeam)]),
    el("div", { class: `draft-header__team draft-header__team--right draft-header__team--${rightTeam}` }, rightName),
  ]);

  const panel = el("div", { class: "draft-result__panel" }, [
    el("div", { class: "draft-result__heading" }, "Draft Complete"),
    shareUrl
      ? el("div", { class: "draft-actions draft-result__actions" }, [
          el("button", {
            class: "draft-btn draft-btn--primary",
            onClick: () => navigator.clipboard?.writeText(shareUrl),
          }, "Copy result link"),
          el("a", { class: "draft-btn", href: location.pathname }, "New draft"),
        ])
      : el("div", { class: "draft-actions draft-result__actions" }, [
          el("a", { class: "draft-btn draft-btn--primary", href: location.pathname }, "Start your own draft"),
        ]),
  ]);

  root.appendChild(el("section", { class: "draft-board draft-board--result", style: boardStyleForBattleground(bg) }, [
    header,
    el("div", { class: "draft-stage" }, [
      captainColumn(state, draftData, leftTeam, "left", null),
      panel,
      captainColumn(state, draftData, rightTeam, "right", null),
    ]),
  ]));
}
