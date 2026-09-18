import assert from "node:assert/strict";
import test from "node:test";

import { buildXrefSidecars, scanXrefFile } from "../scripts/lib/gamedata-xref.ts";

const EFFECT_FILE = `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
  <CEffectApplyBehavior id="AlarakDiscordStrikeApply" parent="AlarakBase">
    <Behavior value="AlarakDiscordStrikeBehavior"/>
    <WhichUnit Value="Caster"/>
  </CEffectApplyBehavior>
  <CEffectSet id="AlarakDiscordStrikeSet">
    <EffectArray index="0" value="AlarakDiscordStrikeApply"/>
    <EffectArray index="1" value="AlarakDiscordStrikeDamage"/>
  </CEffectSet>
  <CAbilEffectTarget id="AlarakDiscordStrike" Effect="AlarakDiscordStrikeSet"/>
</Catalog>`;

const BEHAVIOR_FILE = `<Catalog>
  <CBehaviorBuff id="AlarakBase"/>
  <CBehaviorBuff id="AlarakDiscordStrikeBehavior" parent="AlarakBase"/>
</Catalog>`;

function scanAll() {
  return [
    { path: "mods/effectdata-xml", scan: scanXrefFile(EFFECT_FILE) },
    { path: "mods/behaviordata-xml", scan: scanXrefFile(BEHAVIOR_FILE) },
  ];
}

test("scan records C-element definitions with their line and parent", () => {
  const { defs } = scanXrefFile(EFFECT_FILE);

  assert.deepEqual(defs[0], {
    id: "AlarakDiscordStrikeApply",
    line: 3,
    tag: "CEffectApplyBehavior",
    parent: "AlarakBase",
  });
  assert.deepEqual(defs.map((def) => def.id), [
    "AlarakDiscordStrikeApply",
    "AlarakDiscordStrikeSet",
    "AlarakDiscordStrike",
  ]);
});

test("scan collects ref fields as attributes, child elements, and parent links", () => {
  const { refs } = scanXrefFile(EFFECT_FILE);

  assert.deepEqual(
    refs.map(({ line, field, value, from }) => [line, field, value, from]),
    [
      [3, "parent", "AlarakBase", "AlarakDiscordStrikeApply"],
      [4, "Behavior", "AlarakDiscordStrikeBehavior", "AlarakDiscordStrikeApply"],
      [8, "EffectArray", "AlarakDiscordStrikeApply", "AlarakDiscordStrikeSet"],
      [9, "EffectArray", "AlarakDiscordStrikeDamage", "AlarakDiscordStrikeSet"],
      [11, "Effect", "AlarakDiscordStrikeSet", "AlarakDiscordStrike"],
    ]
  );
});

test("scan skips backref elements", () => {
  const { refs } = scanXrefFile(`<Catalog>
  <CEffectDamage id="X">
    <WhichUnit Effect="NotARef"/>
    <Target Effect="AlsoNotARef"/>
  </CEffectDamage>
</Catalog>`);

  assert.deepEqual(refs, []);
});

test("Abil refs drop the catalog prefix and command suffix", () => {
  const { refs } = scanXrefFile(`<Catalog>
  <CValidatorUnitAbil id="V" Abil="Abil/AlarakDiscordStrike,Execute"/>
</Catalog>`);

  assert.deepEqual(refs.map((ref) => ref.value), ["AlarakDiscordStrike"]);
});

test("sidecar links each ref to its definition site", () => {
  const { sidecar } = buildXrefSidecars(scanAll()).get("mods/effectdata-xml")!;

  const refs = sidecar.refs.map(([line, value, fieldIndex, from]) => [line, value, sidecar.fields[fieldIndex], from]);
  assert.deepEqual(refs, [
    [3, "AlarakBase", "parent", "AlarakDiscordStrikeApply"],
    [4, "AlarakDiscordStrikeBehavior", "Behavior", "AlarakDiscordStrikeApply"],
    [8, "AlarakDiscordStrikeApply", "EffectArray", "AlarakDiscordStrikeSet"],
    [11, "AlarakDiscordStrikeSet", "Effect", "AlarakDiscordStrike"],
  ]);

  const [target] = sidecar.targets["AlarakDiscordStrikeBehavior"];
  assert.equal(sidecar.files[target[0]], "mods/behaviordata-xml");
  assert.deepEqual(target.slice(1), [3, "CBehaviorBuff"]);
});

test("refs to undefined ids are not linkable", () => {
  const { sidecar } = buildXrefSidecars(scanAll()).get("mods/effectdata-xml")!;

  assert.equal(sidecar.targets["AlarakDiscordStrikeDamage"], undefined);
  assert.equal(sidecar.refs.some(([, value]) => value === "AlarakDiscordStrikeDamage"), false);
});

test("sidecar carries the inheritance chain across files", () => {
  const { sidecar } = buildXrefSidecars(scanAll()).get("mods/behaviordata-xml")!;

  assert.deepEqual(sidecar.chains["AlarakDiscordStrikeBehavior"], ["AlarakBase"]);
  assert.equal(sidecar.chains["AlarakBase"], undefined);
});

test("incoming refs are grouped per defined id with counts", () => {
  const { sidecar, incoming } = buildXrefSidecars(scanAll()).get("mods/behaviordata-xml")!;

  assert.equal(sidecar.refCounts["AlarakBase"], 2);
  const entries = incoming.incoming["AlarakBase"];
  assert.deepEqual(entries.map(([fileIndex, line, field, from]) => [incoming.files[fileIndex], line, field, from]), [
    ["mods/effectdata-xml", 3, "parent", "AlarakDiscordStrikeApply"],
    ["mods/behaviordata-xml", 3, "parent", "AlarakDiscordStrikeBehavior"],
  ]);
});

test("incoming refs are capped and report the full count", () => {
  const referrers = Array.from({ length: 5 }, (_, i) =>
    `  <CEffectApplyBehavior id="Ref${i}"><Behavior value="Target"/></CEffectApplyBehavior>`
  ).join("\n");
  const files = [
    { path: "mods/targets-xml", scan: scanXrefFile(`<Catalog>\n  <CBehaviorBuff id="Target"/>\n</Catalog>`) },
    { path: "mods/refs-xml", scan: scanXrefFile(`<Catalog>\n${referrers}\n</Catalog>`) },
  ];

  const { sidecar, incoming } = buildXrefSidecars(files, 2).get("mods/targets-xml")!;

  assert.equal(sidecar.refCounts["Target"], 5);
  assert.equal(incoming.incoming["Target"].length, 2);
  assert.equal(incoming.truncated?.["Target"], 5);
});

test("entry index groups per file and orders abilities before talents", async () => {
  const { groupEntriesByFile } = await import("../scripts/gen-gamedata-entries.ts");
  const byFile = groupEntriesByFile({
    A: { name: "Sadism", anchor: "AlarakSadism", xmlPath: "mods/alarakdata-xml", type: "talent", abilityType: "Trait", icon: "sadism.png" } as never,
    B: { name: "Discord Strike", anchor: "AlarakDiscordStrike", xmlPath: "mods/alarakdata-xml", type: "ability", abilityType: "Q", icon: "ds.png" } as never,
    C: { name: "Discord Strike", anchor: "AlarakDiscordStrike", xmlPath: "mods/alarakdata-xml", type: "ability", abilityType: "Q", icon: "ds.png" } as never,
  });

  assert.deepEqual(byFile.get("mods/alarakdata-xml")?.map((entry) => [entry.id, entry.kind, entry.abilityType]), [
    ["AlarakDiscordStrike", "ability", "Q"],
    ["AlarakSadism", "talent", "Trait"],
  ]);
});

test("talents are indexed in tier order", async () => {
  const { groupEntriesByFile, talentOrderFromHeroes } = await import("../scripts/gen-gamedata-entries.ts");
  const order = talentOrderFromHeroes([{
    talents: [
      { nameId: "TalentB", tier: "level4", sort: 1 },
      { nameId: "TalentC", tier: "level1", sort: 2 },
      { nameId: "TalentA", tier: "level1", sort: 1 },
    ],
  }]);

  const byFile = groupEntriesByFile({
    A: { name: "Alpha", anchor: "TalentA", xmlPath: "mods/data-xml", type: "talent", abilityType: "Q", icon: "" } as never,
    B: { name: "Bravo", anchor: "TalentB", xmlPath: "mods/data-xml", type: "talent", abilityType: "W", icon: "" } as never,
    C: { name: "Charlie", anchor: "TalentC", xmlPath: "mods/data-xml", type: "talent", abilityType: "E", icon: "" } as never,
  }, order);

  assert.deepEqual(byFile.get("mods/data-xml")?.map((entry) => [entry.id, entry.level]), [
    ["TalentA", 1],
    ["TalentC", 1],
    ["TalentB", 4],
  ]);
});
