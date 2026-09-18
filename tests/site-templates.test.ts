import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Pages hand most of their markup to components, so an assertion about what a page renders has to
// see the components it calls too. Returns the template followed by every component file it uses.
const TEMPLATE_ROOT = new URL("../site/templates/", import.meta.url);

function componentFiles(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, TEMPLATE_ROOT), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else if (entry.name.endsWith(".html")) {
        const source = readFileSync(new URL(path, TEMPLATE_ROOT), "utf-8");
        for (const m of source.matchAll(/\{%-?\s*component\s+([\w.]+)\(/g)) found.set(m[1], path);
      }
    }
  };
  walk("");
  return found;
}

const COMPONENTS = componentFiles();

function renderedBy(templatePath: string, seen = new Set<string>()): string {
  if (seen.has(templatePath)) return "";
  seen.add(templatePath);
  const source = readFileSync(new URL(templatePath, TEMPLATE_ROOT), "utf-8");
  const used = [...source.matchAll(/\{[{%]\s*<([\w.]+)[\s/>]/g)].map((m) => COMPONENTS.get(m[1]));
  return [source, ...used.filter((path): path is string => Boolean(path)).map((path) => renderedBy(path, seen))].join("\n");
}

test("base navigation exposes the approved player-first IA", () => {
  const template = readFileSync(new URL("../site/templates/base.html", import.meta.url), "utf-8");

  assert.match(template, /get_url\(path='\/'\)[^>]*>Heroes<\/a>/);
  assert.match(template, /get_url\(path='guides'\)[^>]*>Guides<\/a>/);
  assert.match(template, /get_url\(path='@\/battlegrounds\/_index\.md'\)[^>]*>Battlegrounds<\/a>/);
  assert.match(template, /get_url\(path='library'\)[^>]*>Library<\/a>/);
  assert.match(template, /get_url\(path='about'\)[^>]*>About<\/a>/);

  assert.doesNotMatch(template, /get_url\(path='status-effects'\)[^>]*>Status Effects<\/a>/);
  assert.doesNotMatch(template, /get_url\(path='effect-index'\)[^>]*>Effect Index<\/a>/);
  assert.doesNotMatch(template, /get_url\(path='minions-and-mercs'\)[^>]*>Minions &amp; Mercs<\/a>/);
  assert.doesNotMatch(template, /get_url\(path='structures'\)[^>]*>Structures<\/a>/);
  assert.doesNotMatch(template, /get_url\(path='gamedata'\)[^>]*>Game Data<\/a>/);
});

test("base navigation exposes mobile menu toggle hooks", () => {
  const template = readFileSync(new URL("../site/templates/base.html", import.meta.url), "utf-8");
  const styles = readFileSync(new URL("../site/sass/main.scss", import.meta.url), "utf-8");
  const script = readFileSync(new URL("../site/static/hotsixors.js", import.meta.url), "utf-8");

  assert.match(template, /class="nav-toggle"/);
  assert.match(template, /aria-controls="site-nav-menu"/);
  assert.match(template, /data-nav-toggle/);
  assert.match(template, /class="site-nav__menu" id="site-nav-menu" data-nav-menu/);
  assert.match(styles, /\.site-nav__menu\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.js \.nav-toggle\s*\{\s*display:\s*inline-flex;/);
  assert.match(styles, /\.nav-toggle\s*\{[^}]*touch-action:\s*manipulation;/s);
  assert.doesNotMatch(styles, /\.nav-toggle__bar\s*\{[^}]*transition:/s);
  assert.match(script, /function initPrimaryNav\(\)/);
  assert.match(script, /initPrimaryNav\(\);/);
});

test("base navigation exposes persisted datamining toggle", () => {
  const template = readFileSync(new URL("../site/templates/base.html", import.meta.url), "utf-8");
  const styles = readFileSync(new URL("../site/sass/main.scss", import.meta.url), "utf-8");
  const script = readFileSync(new URL("../site/static/hotsixors.js", import.meta.url), "utf-8");
  const storage = readFileSync(new URL("../site/static/js/storage.js", import.meta.url), "utf-8");

  assert.match(template, /hotsixors\.datamining/);
  assert.match(template, /data-datamining-toggle/);
  assert.match(styles, /html:not\(\.datamining-enabled\) \[data-datamining\]/);
  assert.match(storage, /const DATAMINING_STORAGE_KEY = "hotsixors\.datamining"/);
  assert.match(script, /function initDataminingToggle\(\)/);
  assert.match(script, /initDataminingToggle\(\);/);
});


test("fonts are vendored and loaded without blocking first render", () => {
  const baseTemplate = readFileSync(new URL("../site/templates/base.html", import.meta.url), "utf-8");
  const styles = readFileSync(new URL("../site/sass/main.scss", import.meta.url), "utf-8");
  const fontStyles = readFileSync(new URL("../site/static/fonts.css", import.meta.url), "utf-8");

  assert.match(baseTemplate, /get_url\(path='fonts\.css', cachebust=true\)/);
  assert.match(baseTemplate, /rel="preload"[^>]+as="style"/);
  assert.match(baseTemplate, /media="print" onload="this\.media='all'"/);
  assert.match(baseTemplate, /<noscript><link rel="stylesheet" href="\{\{ get_url\(path='fonts\.css', cachebust=true\) \}\}"><\/noscript>/);

  assert.doesNotMatch(styles, /fonts\.googleapis|fonts\.gstatic|@import url/);
  assert.doesNotMatch(baseTemplate, /fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(fontStyles, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(fontStyles, /url\("\/fonts\/inter-latin-400-500\.woff2"\)/);
  assert.match(fontStyles, /url\("\/fonts\/rajdhani-latin-700\.woff2"\)/);
});

test("site images are routed through Zola resize_image", () => {
  const imageComponent = readFileSync(new URL("../site/templates/components/images.html", import.meta.url), "utf-8");
  const homeTemplate = renderedBy("index.html");
  const heroListTemplate = renderedBy("heroes/list.html");
  const heroTemplate = renderedBy("heroes/single.html");
  const effectIndexTemplate = readFileSync(new URL("../site/templates/effect-index.html", import.meta.url), "utf-8");
  const abilityShortcode = readFileSync(new URL("../site/templates/components/ability.html", import.meta.url), "utf-8");

  assert.match(imageComponent, /resize_image\(path=path/);
  assert.match(imageComponent, /format="webp"/);
  assert.match(imageComponent, /srcset="\{\{ image_1x\.url \}\} 1x, \{\{ image_2x\.url \}\} 2x"/);

  assert.match(homeTemplate, /<images\.optimized/);
  assert.match(heroListTemplate, /<images\.optimized/);
  assert.match(heroTemplate, /<images\.optimized/);
  assert.match(effectIndexTemplate, /<images\.optimized/);
  assert.match(abilityShortcode, /resize_image\(path='images\/abilitytalents\/' ~ entry\.icon/);
});

test("library template groups deep-dive reference pages", () => {
  const template = readFileSync(new URL("../site/templates/library.html", import.meta.url), "utf-8");

  assert.match(template, /<h1>Library<\/h1>/);
  assert.match(template, />Status Effects<\/h2>/);
  assert.match(template, />Minions, Mercs &amp; Structures<\/h2>/);
  assert.match(template, />Game Data<\/h2>/);
  assert.match(template, /get_url\(path='status-effects'\)/);
  assert.match(template, /get_url\(path='effect-index'\)/);
  assert.match(template, /get_url\(path='minions-and-mercs'\)/);
  assert.match(template, /get_url\(path='structures'\)/);
  assert.match(template, /get_url\(path='gamedata'\)/);
});

test("search generation includes Library as a reference entry", () => {
  const script = readFileSync(new URL("../scripts/gen-search.ts", import.meta.url), "utf-8");

  assert.match(script, /title:\s*"Library"/);
  assert.match(script, /url:\s*"\/library\/"/);
  assert.match(script, /type:\s*"Reference"/);
  assert.match(script, /Status Effects Effect Index Minions Mercs Structures Game Data/);
});

test("effect index template consumes cross-reference data and exposes filter hooks", () => {
  const template = readFileSync(new URL("../site/templates/effect-index.html", import.meta.url), "utf-8");

  assert.match(template, /load_data\(path="data\/cross-references\.json"\)/);
  assert.match(template, /class="effect-index-layout"/);
  assert.match(template, /class="effect-index-sidebar"/);
  assert.match(template, /href="#\{\{ mechanic\.category \| slugify \}\}"/);
  assert.match(template, /data-effect-search/);
  assert.match(template, />Show all<\/button>/);
  assert.match(template, />Hide all<\/button>/);
  assert.match(template, /data-effect-enable-all/);
  assert.match(template, /data-effect-disable-all/);
  assert.match(template, /data-effect-mechanic/);
  assert.match(template, /data-effect-category/);
  assert.match(template, /data-effect-chip/);
});

test("mechanic generation uses intent-based effect categories", () => {
  const script = readFileSync(new URL("../scripts/gen-mechanics.ts", import.meta.url), "utf-8");

  assert.match(script, /"Defensive Buffs"/);
  assert.match(script, /"Offensive Debuffs"/);
  assert.doesNotMatch(script, /category:\s*"Protection"/);
  assert.doesNotMatch(script, /category:\s*"Armor"/);
  assert.doesNotMatch(script, /category:\s*"Other"/);
});

test("generated mechanic categories are contiguous", () => {
  const data = JSON.parse(readFileSync(new URL("../site/data/mechanics.json", import.meta.url), "utf-8"));
  const closed = new Set();
  let current = "";

  for (const mechanic of data.mechanics) {
    if (mechanic.category === current) continue;
    assert.equal(closed.has(mechanic.category), false, `${mechanic.category} appears in multiple groups`);
    if (current) closed.add(current);
    current = mechanic.category;
  }
});

test("status effect names link to filtered effect index entries", () => {
  const template = readFileSync(new URL("../site/templates/status-effects.html", import.meta.url), "utf-8");

  assert.match(template, /href="\{\{ get_url\(path='effect-index'\) \}\}\?effects=\{\{ mechanic\.slug \}\}"/);
  assert.doesNotMatch(template, /class="mechanics-table__status" href="#\{\{ mechanic\.slug \}\}"/);
});

test("structures table does not render context column", () => {
  const template = readFileSync(new URL("../site/templates/structures.html", import.meta.url), "utf-8");

  assert.doesNotMatch(template, />Context<\/th>/);
  assert.doesNotMatch(template, /unit\.context/);
});

test("about page renders generated build and source version metadata", () => {
  const template = readFileSync(new URL("../site/templates/about.html", import.meta.url), "utf-8");

  assert.match(template, /load_data\(path="data\/build-info\.json"\)/);
  assert.match(template, /Website build date/);
  assert.match(template, /build_info\.sources/);
  assert.match(template, /Game version:/);
  assert.match(template, /Source version:/);
});

test("minion and structure tables render compact scaling summaries", () => {
  const minionsTemplate = readFileSync(new URL("../site/templates/minions-and-mercs.html", import.meta.url), "utf-8");
  const structuresTemplate = readFileSync(new URL("../site/templates/structures.html", import.meta.url), "utf-8");
  const styles = readFileSync(new URL("../site/sass/main.scss", import.meta.url), "utf-8");

  assert.match(minionsTemplate, /unit\.scalingRows/);
  assert.match(minionsTemplate, /class="scaling-summary"/);
  assert.match(minionsTemplate, /unit\.xpScalingSummary/);
  assert.match(structuresTemplate, /unit\.scalingRows/);
  assert.match(structuresTemplate, /class="scaling-summary"/);
  assert.match(styles, /\.scaling-summary/);
  assert.match(styles, /\.minions-xp-summary/);
});

test("battleground summon XML paths use generated gamedata URLs", () => {
  const volskaya = JSON.parse(readFileSync(new URL("../site/data/battlegrounds/volskaya-foundry.json", import.meta.url), "utf-8"));
  const paths = volskaya.summons.flatMap((summon) => summon.variants.map((variant) => variant.xmlPath).filter(Boolean));

  assert.ok(paths.includes("mods/heroesdata.stormmod/base.stormdata/gamedata/maps/protectors-xml"));
  assert.ok(paths.every((xmlPath) => !/\.(?:xml|galaxy)$/i.test(xmlPath)));
});

test("hero banner loading images cap width and crop from the left", () => {
  const styles = readFileSync(new URL("../site/sass/main.scss", import.meta.url), "utf-8");

  assert.match(styles, /&__loading\s*\{[^}]*flex:\s*0\s+1\s+33%/s);
  assert.match(styles, /&__loading\s*\{[^}]*max-width:\s*33%/s);
  assert.match(styles, /&__loading\s*\{[^}]*width:\s*33%/s);
  assert.match(styles, /&__loading\s*\{[^}]*object-position:\s*right\s+center/s);
});

test("hero and battleground lists expose typeahead select search hooks without search bars", () => {
  const heroTemplate = renderedBy("heroes/list.html");
  const homeTemplate = renderedBy("index.html");
  const battlegroundTemplate = renderedBy("battlegrounds/list.html");
  const styles = readFileSync(new URL("../site/sass/main.scss", import.meta.url), "utf-8");

  assert.match(heroTemplate, /data-select-search/);
  assert.match(heroTemplate, /Start typing to search/);
  assert.match(heroTemplate, /class="select-search-hint"/);
  assert.match(heroTemplate, /data-select-search-card/);
  assert.match(heroTemplate, /data-select-search-text="\{\{\s*page\.extra\.hero_name/);
  assert.doesNotMatch(heroTemplate, /data-select-search-input/);
  assert.doesNotMatch(heroTemplate, /type="search"/);
  assert.match(homeTemplate, /data-select-search/);
  assert.match(homeTemplate, /Start typing to search/);
  assert.match(homeTemplate, /class="select-search-hint"/);
  assert.doesNotMatch(homeTemplate, /data-select-search-input/);
  assert.doesNotMatch(homeTemplate, /type="search"/);
  assert.match(battlegroundTemplate, /data-select-search/);
  assert.doesNotMatch(battlegroundTemplate, /Start typing to search/);
  assert.doesNotMatch(battlegroundTemplate, /class="select-search-hint"/);
  assert.match(battlegroundTemplate, /data-select-search-card/);
  assert.match(battlegroundTemplate, /data-select-search-text="\{\{\s*page\.title/);
  assert.doesNotMatch(battlegroundTemplate, /data-select-search-input/);
  assert.doesNotMatch(battlegroundTemplate, /type="search"/);
  assert.match(styles, /\.select-search-hint/);
  assert.match(styles, /\.select-search-status/);
  assert.match(styles, /\.select-search-card--match/);
  assert.match(styles, /\.select-search-card--dim/);
});
