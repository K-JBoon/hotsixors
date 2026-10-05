import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogIndex, readBuffModification, readWeaponDamageMultiplier } from "../scripts/lib/weapon-timing.ts";

const catalog = (body: string) => buildCatalogIndex([{ content: `<Catalog>${body}</Catalog>` }]);

test("weapon damage multiplier applies only modifiers without a validator", () => {
  const index = catalog(`
    <CWeaponLegacy id="WorgenWeapon"><DisplayEffect value="WorgenDamage" /></CWeaponLegacy>
    <CEffectDamage id="WorgenDamage">
      <Amount value="148" />
      <MultiplicativeModifierArray index="WorgenForm" Modifier="0.4" />
      <MultiplicativeModifierArray index="LordofHisPack" Validator="HasTalent" Modifier="0.5" />
      <MultiplicativeModifierArray index="Talent" />
    </CEffectDamage>
  `);
  assert.equal(readWeaponDamageMultiplier(index, "WorgenWeapon"), 1.4);
});

test("weapon damage multiplier merges modifier entries through the parent chain", () => {
  const index = catalog(`
    <CWeaponLegacy id="Weapon"><DisplayEffect value="Child" /></CWeaponLegacy>
    <CEffectDamage id="Parent"><MultiplicativeModifierArray index="Form" Modifier="0.4" /></CEffectDamage>
    <CEffectDamage id="Child" parent="Parent"><MultiplicativeModifierArray index="Form" Validator="Gate" /></CEffectDamage>
  `);
  assert.equal(readWeaponDamageMultiplier(index, "Weapon"), 1);
});

test("buff modification reads max life and weapon toggles", () => {
  const index = catalog(`
    <const id="$Bonus" value="500" />
    <CBehaviorBuff id="Form">
      <Modification>
        <VitalMaxArray index="Life" value="$Bonus" />
        <WeaponEnableArray value="FormWeapon" />
        <WeaponDisableArray value="RangedWeapon" />
        <WeaponDisableArray value="MeleeWeapon" />
      </Modification>
    </CBehaviorBuff>
  `);
  assert.deepEqual(readBuffModification(index, "Form"), {
    lifeMax: 500,
    weaponEnable: ["FormWeapon"],
    weaponDisable: ["RangedWeapon", "MeleeWeapon"],
  });
  assert.equal(readBuffModification(index, "Missing"), null);
});
