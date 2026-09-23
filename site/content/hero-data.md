+++
title = "Hero Reference"
description = "How Heroes of the Storm defines heroes in XML and GalaxyScript: files, data model, resolution rules, record types, trigger libraries and mechanics."
template = "guides/single.html"
date = 2026-09-22
+++

## Prerequisites

This document assumes you are familiar with parsing XML, and basic programming concepts,
such as inheritance and event handling

## Overview

Heroes of the Storm runs on a modified StarCraft II engine. Two kinds of file define a hero's mechanics:

- **XML data files** describe the hero: its stats, abilities, effects, talents and buttons. Each of these definitions is a *record*.
- **Galaxy scripts** contain code for what the data cannot express. The code can also change record values during a match.

A data file is a flat list of records. Each XML element in the list is one record. Most examples in this document come from Ana.

[`AnaData.xml`][anadata] holds all of Ana's gameplay records. An example of some
record types from it:

```xml
<CAbilEffectTarget id="AnaSleepDart">...</CAbilEffectTarget>
<!-- ... -->
<CAccumulatorToken id="AnaShrikeDotDamageToken" parent="BaseAccumulator">...</CAccumulatorToken>
<!-- ... -->
<CBehaviorTokenCounter id="AnaShrikeDotDamageToken" parent="StormGenericToken">...</CBehaviorTokenCounter>
<!-- ... -->
<CEffectModifyTokenCount id="AnaShrikeDotDamageToken" parent="BaseEffectModifyTokenCount">...</CEffectModifyTokenCount>
<!-- ... -->
<CHero id="Ana">...</CHero>
<!-- ... -->
<CUnit id="HeroAna" parent="StormHeroMounted">...</CUnit>
```

Each record has three parts:

- A **class**, which is the element name, such as `CAbilEffectTarget`. The class sets the catalog and the fields of the record.
- An **id**, such as `AnaSleepDart`. Other records use the id to refer to this record.
- An optional **parent**. The record inherits the fields of its parent.

The engine puts each type of record in a *catalog*: Abil, Accumulator, Behavior, Effect, Hero, Unit and so on. The records above go into these catalogs:

| Record | Class | Catalog |
|---|---|---|
| [`AnaSleepDart`][sleep-dart-abil] | `CAbilEffectTarget` | Abil |
| [`AnaShrikeDotDamageToken`][shrike-token-accumulator] | `CAccumulatorToken` | Accumulator |
| [`AnaShrikeDotDamageToken`][shrike-token-behavior] | `CBehaviorTokenCounter` | Behavior |
| [`AnaShrikeDotDamageToken`][shrike-token-effect] | `CEffectModifyTokenCount` | Effect |
| [`Ana`][ana-hero] | `CHero` | Hero |
| [`HeroAna`][ana-unit] | `CUnit` | Unit |

An id is unique only inside its catalog. `AnaShrikeDotDamageToken` names three records: an accumulator, a behavior and an effect. To select one of them, Galaxy scripts give the catalog and the id. [`LibHANA.galaxy`][libhana] reads a field of the behavior:

```galaxy
CatalogFieldValueGet(c_gameCatalogBehavior, "AnaShrikeDotDamageToken", "TokenId", c_playerAny);
```

`c_gameCatalogBehavior` selects the `CBehaviorTokenCounter` record, not the accumulator or the effect. The file that contains a record has no effect on the record.

### Organization

Read the sections in order.

1. [Files](#files): where the hero data is, and the order in which it loads.
2. [Data model](#data-model): how a record looks in XML.
3. [Resolution](#resolution): how the game combines declarations, parents and defaults into the final record.
4. [Record reference](#record-reference): the fields of each record type.
5. [Trigger libraries](#trigger-libraries): the Galaxy script that runs alongside the data.
6. [Mechanics](#mechanics): examples that combine records and script.

### Terms

| Term | Meaning |
|---|---|
| Mod | A `.StormMod` folder of data, script and text files. Mods load in a fixed order, and a mod can change the records of an earlier mod. |
| Data file | An XML file that contains a list of records. One file can contain records of any kind. |
| Catalog | The engine's name for a kind of record, such as Abil or Effect. The class of a record sets its catalog. |
| Record | One object in a catalog. Its XML element name is its class, and its `id` attribute is its name. |
| Class | The type of a record, such as `CEffectDamage`. The class sets the catalog and the fields of the record. |
| Field | A child element of a record, such as `<Duration value="3" />`. |
| Template | A record that exists to be the parent of other records. |
| Galaxy | The script language of the engine. See [Galaxy](#galaxy). |
| Trigger library | A Galaxy source file that a mod loads. |
| Native | A function that the engine implements and Galaxy code calls. |
| GameStrings | The text of a mod in one language: names and tooltips as `key=value` lines. |
| Game loop | One step of the game simulation. One second of game time has 16 game loops. |


## Files

### Load order

The game data is in `.StormMod` folders. Three of them contain hero data. They load in this order:

1. [`Core.StormMod`][core-dir] contains the engine defaults: one id-less default record per class, such as `<CEffectDamage default="1">`. It also contains [`NativeLib`][nativelib], the trigger library that all other libraries use.
2. [`HeroesData.StormMod`][heroesdata-dir] contains the shared catalogs, the shared trigger libraries and many of the older heroes.
3. [`HeroMods/<Hero>.StormMod`][heromods-dir] contains one hero per mod, or two for Cho'gall.

HeroesData's [`Includes.xml`][heroesdata-includes] lists every hero mod:

```xml
<Includes id="Mods/HeroesData.StormMod">
  <Path value="Mods/HeroMods/Junkrat.StormMod" />
  <Path value="Mods/HeroMods/Firebat.StormMod" />
  <!-- ... -->
  <Path value="Mods/HeroMods/Ana.StormMod" />
</Includes>
```

Each hero mod's [`DocumentInfo`][ana-documentinfo] declares HeroesData as a dependency:

```xml
<DocInfo>
  <Flags>
    <Value>PreloadNoTrigger</Value>
  </Flags>
  <Dependencies>
    <Value>bnet:Heroes of the Storm (Data Mod)/0.0/999,file:Mods/HeroesData.StormMod</Value>
  </Dependencies>
</DocInfo>
```

You can treat paths inside the data as case-insensitive. HeroesData's [`GameData.xml`][heroesdata-gamedata] uses both `GameData/Mounts/...` and `Gamedata/Mounts/...`.

### Hero mods

A hero mod has the layout below. The examples come from [`HeroMods/Ana.StormMod`][ana-dir].

- [`DocumentInfo`][ana-documentinfo]: the mod's flags and dependencies.
- [`Base.StormData/GameData.xml`][ana-includes]: the `<Includes>` list of data files. `GameData/AnaData.xml` loads first, then the skin and voice files.
- [`Base.StormData/GameData/AnaData.xml`][anadata]: all gameplay records, plus the actors, models and sounds that they use.
- [`Base.StormData/GameData/GameData.xml`][ana-cgame]: registers the trigger library.
- [`Base.StormData/LibHANA.galaxy`][libhana] and [`LibHANA_h.galaxy`][libhana-h]: the trigger library and its header.
- [`enUS.StormData/LocalizedData/GameStrings.txt`][ana-gamestrings]: names and tooltips as `key=value` lines. Each locale has its own copy.

To register its Galaxy trigger library, the mod adds one element to the global `CGame` record:

```xml
<CGame id="Dflt">
  <TriggerLibs Id="HANA"/>
</CGame>
```

`HANA` loads `LibHANA.galaxy`, and all symbols in that library start with `libHANA_`. See [Naming](#naming).

Some mods declare the `CGame` record in the hero's main data file instead, for example [Chromie][chromie-cgame].

**Note:** Xal'atath is the newest hero (build 2.57.0.98217), and her mod uses a different layout. It splits the gameplay records across several files:

- `XalatathData.xml`: the hero, the unit, the talents and most abilities.
- `XalatathVoidEruptionData.xml`: the Void Eruption heroic ability.
- `XalatathVoidVolley2Data.xml`: effects and actors of Void Volley.
- `ButtonData.xml`, `ActorData.xml` and `MoverData.xml`: all of her buttons, and some actors and movers.

The last three files are not in her `<Includes>` list. HeroesData's `AbilData.xml` is not in its list either. A file with a standard catalog name seems to load without an entry.

### HeroesData heroes

Before Cho'gall, every hero was in the HeroesData mod, under [`GameData/Heroes/`][heroes-dir]. The triggers of these heroes are in the shared [`GameDataHelperLib`][gdhl].

Some heroes after Cho'gall are also in that folder. Since Dehaka, each hero has its own mod.

### Shared data files

HeroesData's `GameData/` folder contains the shared data files. Most of them contain one kind of record, as their names show. They declare the templates that hero records inherit from, such as `StormSpell`, `StormSleep`, `StormArmor`, `StormQuestToken` and [`CarryBehaviorParent`][carry-parent]:

- [`AbilData.xml`][abildata], [`AccumulatorData.xml`][accumulatordata], [`BehaviorData.xml`][behaviordata], [`ButtonData.xml`][buttondata], [`EffectData.xml`][effectdata], [`HeroData.xml`][herodata]
- [`RequirementData.xml`][requirementdata], [`TalentData.xml`][talentdata], [`UnitData.xml`][unitdata], [`ValidatorData.xml`][validatordata], [`WeaponData.xml`][weapondata]

### Internal names

These heroes have a `CHero` id or folder name that is different from their name in the game:

| Id | Hero | Location |
|---|---|---|
| `Amazon` | Cassia | [`HeroMods/Amazon.StormMod`](/gamedata/mods/heromods/amazon.stormmod/) |
| `Barbarian` | Sonya | [`Heroes/BarbarianData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/barbariandata/) |
| `Cho`, `Gall` | Cho'gall | [`HeroMods/ChoGall.StormMod`](/gamedata/mods/heromods/chogall.stormmod/) |
| `Crusader` | Johanna | [`Heroes/CrusaderData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/crusaderdata/) |
| `DemonHunter` | Valla | [`Heroes/DemonHunterData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/demonhunterdata/) |
| `Dryad` | Lunara | [`Heroes/DryadData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/dryaddata/) |
| `FaerieDragon` | Brightwing | [`Heroes/BrightwingData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/brightwingdata/) |
| `Firebat` | Blaze | [`HeroMods/Firebat.StormMod`](/gamedata/mods/heromods/firebat.stormmod/) |
| `Greymane` | Greymane | [`Heroes/GennData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/genndata/) |
| `L90ETC` | E.T.C. | [`Heroes/L90ETCData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/l90etcdata/) |
| `Medic` | Lt. Morales | [`Heroes/MedicData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/medicdata/) |
| `MeiOW` | Mei | [`HeroMods/MeiOW.StormMod`](/gamedata/mods/heromods/meiow.stormmod/) |
| `Monk` | Kharazim | [`Heroes/MonkData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/monkdata/) |
| `Necromancer` | Xul | [`Heroes/NecromancerData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/necromancerdata/) |
| `NexusHunter` | Qhira | [`HeroMods/NexusHunter.StormMod`](/gamedata/mods/heromods/nexushunter.stormmod/) |
| `Ragnaros` | Ragnaros | [`HeroMods/TheFirelords.StormMod`](/gamedata/mods/heromods/thefirelords.stormmod/) |
| `Tinker` | Gazlowe | [`Heroes/TinkerData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/tinkerdata/) |
| `WitchDoctor` | Nazeebo | [`Heroes/WitchDoctorData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/witchdoctordata/) |
| `Wizard` | Li-Ming | [`Heroes/WizardData`](/gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/wizarddata/) |

## Data model

### Records

Each record is one XML element. The element name is the record's class:

```xml
<CEffectDamage id="AnaSleepDartNightTerrorsDamage" parent="StormSpellPercentDamage">
  <Chance value="0" />
  <VitalFractionMax index="Life" value="0.08" />
</CEffectDamage>
```

[`AnaSleepDartNightTerrorsDamage`][night-terrors-damage] is a record of class `CEffectDamage`. The class prefix gives the catalog:

| Prefix | Catalog | Common classes |
|---|---|---|
| `CHero` | Hero | `CHero` |
| `CUnit` | Unit | `CUnit` |
| `CAbil` | Abil | `CAbilEffectTarget`, `CAbilEffectInstant` |
| `CEffect` | Effect | `CEffectSet`, `CEffectDamage`, `CEffectApplyBehavior` |
| `CBehavior` | Behavior | `CBehaviorBuff`, `CBehaviorTokenCounter` |
| `CValidator` | Validator | `CValidatorPlayerTalent`, `CValidatorCombine` |
| `CRequirement` | Requirement, RequirementNode | `CRequirement`, `CRequirementCountBehavior` |
| `CAccumulator` | Accumulator | `CAccumulatorToken`, `CAccumulatorDistance` |
| `CTalent` | Talent | `CTalent` |
| `CButton` | Button | `CButton` |
| `CWeapon` | Weapon | `CWeaponLegacy` |
| `CActor` | Actor | `CActorModel`, `CActorAction`, `CActorSound` |

A catalog and an id identify a record. The same id can name records in different catalogs: [`AnaSleepDart`][sleep-dart-abil] is an ability, a [buff][sleep-dart-buff] and a [button][sleep-dart-button].

### Record attributes

The attributes of a record element set its identity and its inheritance.

#### `id="name"`

Names the record. The id is unique in its catalog.

#### `parent="name"`

Inherits the fields of the named record in the same catalog. The record's own fields override the inherited fields. See [Resolution](#resolution).

#### `default="1"`

Marks a template, which is a record that exists to be a parent. A `default="1"` record without an id is the class default: the implicit parent of every record of that class that has no `parent`.

#### Other attributes

Any other attribute is a token value that templates read as `##name##`. See [Tokens](#tokens).

### Fields

Each child element of a record is a field. These records come from Ana's data. The example omits some fields:

```xml
<CAbilEffectTarget id="AnaSleepDart">
  <Effect value="AnaSleepDartInitialSet" />
  <Flags index="RequireTargetVision" value="0" />
  <Cost>
    <Vital index="Energy" value="50" />
    <Cooldown TimeUse="14" />
  </Cost>
  <!-- ... -->
</CAbilEffectTarget>
<CEffectSet id="AnaSleepDartInitialSet">
  <EffectArray value="AnaSleepDartSetFacing" />
  <EffectArray value="AnaSleepDartLaunchMissile" />
  <EffectArray value="AnaSleepDartJustUsedApplyBehavior" />
  <!-- ... -->
</CEffectSet>
<CEffectApplyBehavior id="AnaSleepDartApplyBehavior">
  <Behavior value="AnaSleepDart" />
  <!-- ... -->
</CEffectApplyBehavior>
<CBehaviorBuff id="AnaSleepDart" parent="StormSleep">
  <Duration value="3" />
  <!-- ... -->
</CBehaviorBuff>
<CEffectDamage id="AnaEyeOfHorusImpactEnemyDamage" parent="StormSpell">
  <Amount value="135" />
  <MultiplicativeModifierArray index="Deadeye" Validator="AnaHasEyeOfHorusDeadeyeTalent" Accumulator="AnaEyeOfHorusDeadeyeAccumulator" />
  <!-- ... -->
</CEffectDamage>
```

#### Scalar

A number or a string in `value`, as in `<Duration value="3" />`.

#### Link

A record id in `value`, as in `<Behavior value="AnaSleepDart" />`. The field name sets the target catalog. `Behavior` links to Behavior, `Effect` and `EffectArray` link to Effect, and `ValidatorArray` links to Validator. An attribute can also be a link, such as `Validator` and `Accumulator` on the `Deadeye` entry.

#### Struct

A field with named members. A member is a child element or an attribute. `Cost` has the members `Vital` and `Cooldown`, and `TimeUse` is an attribute member of `Cooldown`.

A member named `Value` keeps its capital V, as in `<WhichUnit Value="Caster" />`. The lowercase `value` belongs to scalars and links.

#### Array

One element per entry. `index` selects an entry by position (from 0), by enum name (`Flags index="RequireTargetVision"`) or, in some arrays, by a string key (`index="Deadeye"`). The engine appends an entry that has no `index`. `removed="1"` deletes the entry at `index`. See [Arrays](#arrays).

### Field paths

The engine, the trigger libraries and the tooltips use the same syntax to address a field. A dot enters a struct, and brackets select an array entry:

- `Cost[0].Charge.TimeUse`
- `Modification.DamageDealtFraction[Ability]`
- `AbilityModificationArray[0].Modifications[5].Value`

An array segment without brackets selects entry 0. Ana's Deadeye talent uses `Cost.Charge.TimeUse` and `Cost[0].Charge.HideCount` in the same record.

### Constants

A `<const>` record gives a value a name. A field refers to the constant by its `$` name. When the constant sets `evaluateAsExpression="1"`, its value is an expression:

```xml
<const id="$ArthasDeathCoilRange" value="8" />
<const id="$ArthasGorefiendsGraspRangeModifier" value="0.4" />
<const id="$ArthasGorefiendsGraspRangeIncrease" value="*($ArthasDeathCoilRange $ArthasGorefiendsGraspRangeModifier)" evaluateAsExpression="1" />
```

Expressions use function-call syntax, with spaces between arguments. Operators are functions too, so `*(a b)` means a × b. The operators are `+`, `-`, `*` and `/`. Functions include `negate`, `max` and `floor`. The last constant above is 8 × 0.4 = 3.2. [Gorefiend's Grasp][gorefiends-grasp] uses [`$ArthasGorefiendsGraspRangeIncrease`][arthas-const] to add 3.2 to the `Range` of Death Coil.

## Resolution

The XML of one record is rarely the whole record. The engine builds the final record from its declarations, its parents and its class defaults in four steps:

1. **Merge declarations.** Collect every declaration of the catalog and id, in load order. A later declaration overrides earlier fields one by one. Append the array entries that have no `index`.
2. **Resolve the parent chain.** Resolve the record's `parent` first. If the record has no `parent`, resolve the class default. Then apply the record's own fields. A class default inherits from the default of its base class.
3. **Substitute tokens.** Replace `##id##` with the record's id and `##name##` with the record's token values.
4. **Evaluate constants.** Replace `$name` values with the value of the constant.

### Merging

More than one file or mod can declare the same catalog and id. The declarations merge as step 1 describes. Every hero mod adds its `TriggerLibs` entry to the `CGame Dflt` record that HeroesData declares in [`GameData/GameData.xml`][heroesdata-cgame].

### Class defaults

Records with `default="1"` set default values for all records of their kind. Core declares these for effects:

```xml
<CEffect default="1">
  <Chance value="1" />
  <Marker Link="Effect/##id##" />
  <DamageModifierSource Value="Unknown" />
</CEffect>
<CEffectApplyBehavior default="1">
  <Behavior value="##id##" />
  <ValidatorArray value="##id##TargetFilters" />
  <WhichUnit Value="Target" />
  <Count value="1" />
</CEffectApplyBehavior>
```

These are [`CEffect`][core-effect-default] and [`CEffectApplyBehavior`][core-apply-default]. If you ignore class defaults, you may misread hero data. For example, the default `Type` of [`CValidatorCombine`][core-combine-default] is `Or`. In hero data, some `CValidatorCombine` records set `Type` to `And`. Others omit it, such as Rexxar's [`CasterIsMishaOrRexxar`][rexxar-or].

HeroesData adds class defaults of its own, which merge with Core's. [`<CHero default="1">`][hero-default] adds `<Unit value="Hero##id##" />` and the talent tier table.

### Arrays

An entry with `index` replaces the inherited entry at that position. An entry with `removed="1"` deletes it.

For example, [`StormSpellPercentDamage`][storm-spell-percent] deletes the crit validator that it inherits from `StormSpell`:

```xml
<CEffectDamage default="1" id="StormSpell" parent="StormDamage">
  <CritValidatorArray value="CritAliasSpellPower" />
  <Kind value="Ability" />
  <KindSplash value="Ability" />
</CEffectDamage>
<CEffectDamage default="1" id="StormSpellPercentDamage" parent="StormSpell">
  <Flags index="NoFractionDealtBonus" value="1" />
  <ArmorMitigationRule value="None" />
  <ResponseExclusionFlags index="Proc" value="1" />
  <Aliases value="PercentDamage" />
  <CritValidatorArray index="0" removed="1" />
</CEffectDamage>
```

### Tokens

#### `##id##`

Becomes the id of the record that the engine resolves. The engine replaces tokens after inheritance, so `##id##` in a template becomes the id of the child. Class defaults use it for implicit links:

- [Core's `CButton` default][core-button-default] sets `Name` to `Button/Name/##id##` and `Tooltip` to `Button/Tooltip/##id##`. Buttons rarely declare their string keys.
- [HeroesData's `CHero` default][hero-default] sets `Unit` to `Hero##id##`. `CHero Ana` does not name `HeroAna`.
- [Core's `CEffectApplyBehavior` default][core-apply-default] sets `Behavior` to `##id##`. An apply effect without a `Behavior` field applies the behavior that has its own id. For example, [`AnaNanoBoostMonitor`][nano-monitor-effect] applies the [`AnaNanoBoostMonitor`][nano-monitor-buff] buff:

```xml
<CEffectApplyBehavior id="AnaNanoBoostMonitor">
  <WhichUnit Value="Caster" />
</CEffectApplyBehavior>
```

#### `##name##`

Becomes the value of the record attribute `name`. Templates declare these placeholders, and records pass values as attributes. Actor templates use this often:

```xml
<CActorAction id="ChromieHeroAttack" parent="RangedHeroAttackMissile" effectImpact="ChromieHeroWeaponDamage" effectLaunch="ChromieHeroWeaponLaunchMissile">
```

The template chain of [`ChromieHeroAttack`][chromie-attack] has event terms such as `Effect.##effectImpact##.Start`.

## Record reference

The schemas below list the fields that matter for gameplay. They are not complete class definitions. The schemas use this notation:

| Notation | Meaning |
|---|---|
| `→Abil` | A link to a record in the Abil catalog. |
| `<!-- [] -->` | An array field. The element can repeat. |
| `0\|1`, `Basic\|Ability` | One of the listed values. |
| `int`, `fixed` | A number. `fixed` is a decimal. |
| `<!-- default X -->` | The value when the record does not set the field. |

### Heroes

`CHero` is the hero as a roster entry: its abilities for the interface, its talent tree and its scaling table. The unit on the map is the `CUnit` that `Unit` links to. Example: [`CHero Ana`][ana-hero].

```xml
<CHero id="Ana">
  <AttributeId value="HANA" />
  <Unit value="→Unit" />                                          <!-- default Hero##id## -->
  <ExpandedRole value="Tank|Bruiser|Healer|Support|MeleeAssassin|RangedAssassin" />
  <HeroAbilArray Abil="→Abil" Button="→Button" Unit="→Unit">     <!-- [] -->
    <Flags index="ShowInHeroSelect|Heroic|Trait|UsesCharges|AffectedByCooldownReduction" value="0|1" />  <!-- [] -->
  </HeroAbilArray>
  <HeroicAbilArray Abil="→Abil" />                                <!-- [] -->
  <TalentTreeArray Talent="→Talent" Tier="1-7" Column="1-5">      <!-- [] -->
    <PrerequisiteTalentArray value="→Talent" />                   <!-- [] -->
  </TalentTreeArray>
  <TalentTierArray Tier="1-7" Level="int" ContainsHeroic="0|1" /> <!-- [] -->
  <LevelScalingArray Ability="→Abil">                             <!-- [] -->
    <Modifications>...</Modifications>                            <!-- [] -->
  </LevelScalingArray>
  <Ratings Damage="int" Utility="int" Survivability="int" Complexity="int" />
</CHero>
```

- `HeroAbilArray` pairs each ability with its button and flags. A passive trait has a `Button` and no `Abil`.
- `TalentTreeArray` places each talent by `Tier` and `Column`. `PrerequisiteTalentArray` makes a talent require another one. Ana's `AnaNanoInfusion` requires `AnaHeroicAbilityNanaBoost`. The misspelling "Nana" is in the data.
- `TalentTierArray` maps tiers to levels. [HeroesData's class default][hero-default] uses levels 1, 4, 7, 10, 13, 16 and 20 and puts the heroic in tier 4. [Chromie][chromie-hero] replaces six entries by index to get levels 2, 5, 8, 11, 14 and 18. [Varian][varian-hero] moves the heroic to tier 2.
- `LevelScalingArray` is the scaling table. See [Level scaling](#level-scaling).

### Units

`CUnit` is the unit on the map. Example: [`CUnit HeroAna`][ana-unit], which inherits from [`StormHeroMounted`][storm-hero-mounted].

```xml
<CUnit id="HeroAna" parent="StormHeroMounted">
  <LifeMax value="fixed" />
  <LifeRegenRate value="fixed" />
  <AbilArray Link="→Abil" />                                      <!-- [] -->
  <BehaviorArray Link="→Behavior" />                              <!-- [] -->
  <WeaponArray Link="→Weapon" />                                  <!-- [] -->
  <CardLayouts index="0">
    <LayoutButtons Face="→Button" Type="AbilCmd|Passive" AbilCmd="→Abil,Execute" Slot="Ability1|Ability2|Ability3|Heroic|Trait" />  <!-- [] -->
  </CardLayouts>
  <InitializerFunction value="Galaxy function" />
  <DestructionFunction value="Galaxy function" />
</CUnit>
```

- `AbilArray` lists every ability the unit can cast, including helper abilities that have no button.
- `BehaviorArray` lists the behaviors the unit spawns with, such as Ana's trait passives.
- `CardLayouts` defines the command card. Each `LayoutButtons` entry puts a button in a key slot. `Ability1` to `Ability3` are Q, W and E. `Heroic` is R, and `Trait` is D. `Face` names the `CButton` that supplies the icon and tooltip. `AbilCmd` names the ability and command that the button issues. `Passive` buttons issue no command. A slot can hold more than one entry. The game shows the entry whose command requirements pass, so one key can switch between heroics, talent variants or ability states.
- `InitializerFunction` and `DestructionFunction` name Galaxy functions. See [Entry points](#entry-points).

### Abilities

`CAbil` classes define commands that a unit can issue. Example: [`CAbilEffectTarget AnaSleepDart`][sleep-dart-abil].

```xml
<CAbilEffectTarget id="AnaSleepDart">                             <!-- also CAbilEffectInstant, ... -->
  <PrepEffect value="→Effect" />
  <Effect value="→Effect" />
  <CursorEffect value="→Effect" />
  <Cost>
    <Vital index="Energy|Life" value="fixed" />
    <Cooldown TimeUse="fixed" />
    <Charge CountMax="int" CountStart="int" CountUse="int" Link="Abil/→Abil" />
  </Cost>
  <Range value="fixed" />
  <TargetFilters value="required;excluded" />
  <CastIntroTime value="fixed" />
  <CmdButtonArray index="Execute" DefaultButtonFace="→Button" Requirements="→Requirement" />  <!-- [] -->
</CAbilEffectTarget>
```

- `PrepEffect` runs before the cast. Most heroes use it to dismount and decloak.
- `Effect` is the root of the ability's effect tree.
- `CursorEffect` is the effect that the targeting preview uses.
- `Cost` contains the vital cost, the cooldown and the charges.
- `TargetFilters` limits what the player can target. See [Target selection](#target-selection).
- `CmdButtonArray` has one entry per command. `Requirements` gates the command. See [Talent gating](#talent-gating).

### Effects

`CEffect` classes are the actions in an ability's effect tree. Each effect does one thing and can run other effects. All effects in a tree share one context: caster, source, target and origin. Every effect has two gating fields:

- `ValidatorArray`: all validators must pass, or the effect does nothing.
- `Chance`: the probability that the effect runs. The class default is 1.

The common classes:

- `CEffectSet` runs its `EffectArray` in order.
- `CEffectSwitch` runs the first `CaseArray` entry whose `Validator` passes, or `CaseDefault`.
- `CEffectLaunchMissile` fires `AmmoUnit` toward `ImpactLocation`. `SearchEffect` runs during the flight. `ImpactEffect` runs when the missile arrives.
- `CEffectEnumArea` finds units that match `SearchFilters` and runs an `AreaArray` effect on each.
- `CEffectCreatePersistent` runs effects over time. It runs `InitialEffect` first. Then it runs `PeriodicEffectArray` `PeriodCount` times, on the `PeriodicPeriodArray` schedule. Then it runs `FinalEffect`.
- `CEffectApplyBehavior` and `CEffectRemoveBehavior` add and remove behaviors. The default link of both is `##id##` ([Core][core-remove-default]).
- `CEffectDamage` deals `Amount`, or `VitalFractionMax` of a vital as percent damage.
- `CEffectCreateHealer` heals a flat `RechargeVitalRate` or a `RechargeVitalFraction`.
- `CEffectModifyUnit` changes vitals and cooldowns on a unit.
- `CEffectModifyTokenCount` changes a token counter by `Value`.
- `CEffectModifyCatalogNumeric` changes a catalog field during the match. `CatalogModifications` takes a `Reference` path and an `Operation`. Most records use `Set`. Others use `Multiply`, `Divide` or `Subtract`.

### Behaviors

`CBehavior` classes are states on a unit. Examples: [`CBehaviorBuff AnaNanoBoostBuff`][nano-boost-buff] and [`CBehaviorTokenCounter AnaEyeOfHorusDeadeyeTokenCounter`][deadeye-counter].

```xml
<CBehaviorBuff id="AnaNanoBoostBuff" parent="StormDamageIncrease">
  <Duration value="fixed" />
  <Period value="fixed" />
  <InitialEffect value="→Effect" />                  <!-- also PeriodicEffect, FinalEffect, ExpireEffect, RefreshEffect -->
  <Modification>
    <UnifiedMoveSpeedFactor value="fixed" />
    <DamageDealtFraction index="Basic|Ability" value="fixed" />
    <HealDealtAdditiveMultiplier index="Life|Shields" value="fixed" />
    <StateFlags index="Cloak|SuppressCollision|..." value="0|1" />  <!-- [] -->
  </Modification>
  <ArmorModification>
    <ArmorSet index="Hero|Minion|Merc|Monster|Summon|Structure">
      <ArmorMitigationTable index="Basic|Ability" value="fixed" />
    </ArmorSet>
  </ArmorModification>
  <DamageResponse ModifyLimit="fixed" Handled="→Effect" />
  <BehaviorCategories index="..." value="0|1" />                   <!-- [] -->
  <BehaviorFlags index="Permanent|EnabledWhileDead|..." value="0|1" />  <!-- [] -->
  <RemoveValidatorArray value="→Validator" />                      <!-- [] -->
  <DisableValidatorArray value="→Validator" />                     <!-- [] -->
</CBehaviorBuff>

<CBehaviorTokenCounter id="AnaEyeOfHorusDeadeyeTokenCounter" parent="StormQuestToken">
  <TokenId value="id" />                                           <!-- StormQuestToken: ##id## -->
  <Max value="int" />
  <AtMaxEvents EventId="..." Effect="→Effect" />                   <!-- [] -->
</CBehaviorTokenCounter>
```

- `Duration` and `Period` are the lifetime and the tick interval in seconds.
- `InitialEffect`, `PeriodicEffect`, `FinalEffect`, `ExpireEffect` and `RefreshEffect` run at points in the behavior's life.
- `Modification` changes stats while the behavior is on the unit. `ArmorModification` changes armor. See [Spell Power and armor](#spell-power-and-armor).
- `RemoveValidatorArray` removes the behavior when a validator fails. `DisableValidatorArray` disables the behavior while a validator fails.
- `CBehaviorTokenCounter` is a counter with a `TokenId`. Quests, stacks and stored numbers use it.

### Validators

`CValidator` classes return pass or fail. Effects, behaviors, buttons, switches and actor events use them. The common classes:

- `CValidatorPlayerTalent` checks `WhichPlayer` for the talent in `Value`.
- `CValidatorUnitCompareBehaviorCount` compares the stack count of `Behavior` on `WhichUnit` with `Value`, using `Compare`.
- `CValidatorUnitCompareTokenCount` does the same for a `TokenId`.
- `CValidatorUnitFilters` tests `WhichUnit` against a `Filters` string.
- `CValidatorLocationCompareRange` compares a distance with `Range`.
- `CValidatorCombine` combines its `CombineArray` with `Type`, which is `And` or `Or`.

Two defaults need attention. `CValidatorCombine` without `Type` is an `Or`, as [Class defaults](#class-defaults) shows. `CValidatorPlayerTalent` without `Find` passes when the player does *not* have the talent.

### Requirements

`CRequirement` records gate commands and buttons. A requirement has `NodeArray` entries for `Show` and `Use`. Each entry links to a requirement node such as `CRequirementCountBehavior`, `CRequirementAnd` or `CRequirementNot`. The editor generates the node ids from the node tree, so an id describes its condition. [`Ultimate1Unlocked`][ultimate1-req] is an example:

```xml
<CRequirement id="Ultimate1Unlocked">
  <NodeArray index="Use" Link="EqCountBehaviorHeroGenericPregameAbilitySuppressionCompleteOnlyAtUnit0"/>
  <NodeArray index="Show" Link="AndGTECountBehaviorUltimate1UnlockedCompleteOnlyAtUnit14236449987EqCountBehaviorHeroicAbility1SurpressedCompleteOnlyAtUnit01081602903"/>
</CRequirement>
```

- `Show`: the command shows when the hero has at least one `Ultimate1Unlocked` stack (`GTE ... 1`) and no `HeroicAbility1Surpressed` stack (`Eq ... 0`).
- `Use`: the command is usable when the hero has no `HeroGenericPregameAbilitySuppression` stack. This is true after the pregame ends.

### Talents

`CTalent` records are talents. The talent tree in `CHero` decides which talents are available at which tiers. Example: [`CTalent AnaSleepDartNightTerrors`][night-terrors-talent].

```xml
<CTalent id="AnaSleepDartNightTerrors">
  <Face value="→Button" />
  <Abil value="→Abil" />
  <Trait value="0|1" />
  <Active value="0|1" />
  <QuestData StackBehavior="→Behavior" TargetCount="int" />
  <RankArray>
    <BehaviorArray value="→Behavior" />                             <!-- [] -->
  </RankArray>
  <AbilityModificationArray>                                        <!-- [] -->
    <Modifications>                                                 <!-- [] -->
      <Type value="FlatModification|MultiplyLevelModification|StringReplacement|CatalogReplacement" />
      <Catalog value="Abil|Effect|Behavior|Unit|Accumulator|Actor|..." />
      <Entry value="id" />
      <Field value="field path" />
      <Value value="fixed" />
    </Modifications>
  </AbilityModificationArray>
</CTalent>
```

- `Face` is the button with the talent's name, icon and tooltip.
- `Abil` is the ability that the talent belongs to.
- `Active` marks a talent that grants something the player activates.
- `QuestData` names the token counter that shows quest progress.
- `RankArray` lists behaviors that the hero gets when the player picks the talent.
- `AbilityModificationArray` lists catalog changes that apply when the player picks the talent. The default `Catalog` is Abil, so entries that omit it target an ability. See [Talent gating](#talent-gating).

### Buttons

`CButton` records hold names, icons and tooltips. Example: [`CButton AnaSleepDart`][sleep-dart-button], a child of [`StormButtonParent`][storm-button-parent].

- `Name` and `Tooltip` are GameStrings keys. [Core's class default][core-button-default] sets them to `Button/Name/##id##` and `Button/Tooltip/##id##`.
- `TooltipAppender` adds the text of another button to the tooltip while its validator passes. Picked talents appear in ability tooltips this way.
- `TooltipCooldownOverrideText` replaces the cooldown text.

### Accumulators

`CAccumulator` classes compute a number when an effect needs it. Example: [`CAccumulatorToken AnaEyeOfHorusDeadeyeAccumulator`][deadeye-accumulator].

```xml
<CAccumulatorToken id="AnaEyeOfHorusDeadeyeAccumulator" parent="BaseAccumulator">
  <TokenId value="AnaEyeOfHorusDeadeyeTokenCounter" />
  <Scale value="0.05" />
</CAccumulatorToken>
```

`CAccumulatorToken` multiplies a token count by `Scale`. Other classes measure distance (`CAccumulatorDistance`), time (`CAccumulatorTimed`), vitals (`CAccumulatorVitals`) or tracked units (`CAccumulatorTrackedUnitCount`). `MinAccumulation` and `MaxAccumulation` clamp the result. A field takes an accumulator as a child, as in `<Amount value="0"><AccumulatorArray value="..." /></Amount>`. Modifier arrays take one through an `Accumulator` attribute.

## Trigger libraries

Some hero logic is in the Galaxy trigger libraries, not in the XML. Heroes use script when the XML cannot express a mechanic, or can express it only with difficulty.

This section describes the language, the layout of a library and the library code that hero data depends on.

### Galaxy

Galaxy is the script language of the StarCraft II engine. Its syntax is close to C: functions, structs, arrays, `if`, `while` and `//` comments. The number types are `int` and `fixed`, a fixed-point decimal. Game objects have types of their own, such as `unit`, `point` and `trigger`. Source files end in `.galaxy`.

A trigger library contains functions, global variables and triggers. A trigger is a function that the engine runs when an event occurs, for example when a unit gets a behavior.

Scripts read and change the game through natives. A native is a function that the engine implements, such as `UnitBehaviorAdd` or `CatalogFieldValueSet`.

### Library files

A library has a source file and a header. The header declares the constants, structs, global variables, functions and triggers of the library. For example, this is part of [`LibHANA_h.galaxy`][libhana-h]:

```galaxy
include "TriggerLibs/natives"

// Constants
const fixed libHANA_gv_hero_Ana_NanoBoostCDRAmount_C = -0.0938;

// Structures
struct libHANA_gs_AnaUI {
    int lv_eyeOfHorusTargetAllianceLabel;
    int lv_EyeOfHorusTargetImage;
};

// Variable Declarations
int libHANA_gv_heroAnaTriggerRegistrationVariable;
// ...

// Function Declarations
void libHANA_gf_HeroAnaIncrementHeroCountFunction ();
// ...

// Trigger Declarations
trigger libHANA_gt_HeroAnaNanoBoostCDR;
// ...
```

The source file includes the libraries that it calls, then its own header. [`LibHANA.galaxy`][libhana] starts like this:

```galaxy
include "TriggerLibs/NativeLib"
include "TriggerLibs/HeroesLib"
include "TriggerLibs/GameLib"
include "TriggerLibs/AILib"
include "TriggerLibs/UILib"

include "LibHANA_h"
```

A hero mod registers its library in `CGame`, as [Hero mods](#hero-mods) shows.

### Shared libraries

HeroesData's [`TriggerLibs/`][triggerlibs-dir] folder contains the shared libraries. Its [`LibraryList.xml`][librarylist] maps each library id to a file. NativeLib is the exception: it is in Core. The id gives the symbol prefix of the library:

| Library | Id | Prefix | Contents |
|---|---|---|---|
| [NativeLib][nativelib] | `Ntve` | `libNtve_` | Helper functions around the natives |
| [HeroesLib][heroeslib] | `Core` | `libCore_` | Script copies of hero data, such as the level scaling table |
| [GameLib][gamelib] | `Game` | `libGame_` | Match rules: levels, talents, cooldowns and respawns |
| [GameDataHelperLib][gdhl] | `GDHL` | `libGDHL_` | Triggers of the heroes in HeroesData, and shared helpers |

The other shared libraries are `UILib`, `AILib`, `SoundLib`, `MapMechanicsLib`, `StartingExperienceLib` and `SupportLib`.

### Naming

A global symbol starts with `lib`, the library id and an underscore. A prefix for the kind of symbol follows:

| Prefix | Kind | Example |
|---|---|---|
| `gf_` | Function | `libHANA_gf_HeroAnaIncrementHeroCountFunction` |
| `gt_` | Trigger | `libHANA_gt_HeroAnaNanoBoostCDR` |
| `gv_` | Global variable or constant | `libHANA_gv_heroAnaTriggerRegistrationVariable` |
| `gs_` | Struct | `libHANA_gs_AnaUI` |
| `ge_` | Enum or enum value | `libAIAI_ge_DefenderAIState_Idle` |

Local variables start with `lv_` and parameters with `lp_`. Many constants end in `_C`. Engine constants start with `c_`, such as `c_timeGame`. The editor gives its helper variables generated names, as in `for ( ; ( (auto05955D95_ai >= 0 && ...`.

### Triggers

The editor generates each trigger as a global `trigger` variable and two functions. The `_Init` function creates the trigger and registers its events. This is [`libHANA_gt_HeroAnaNanoBoostCDR_Init`][nano-cdr-init]:

```galaxy
void libHANA_gt_HeroAnaNanoBoostCDR_Init () {
    libHANA_gt_HeroAnaNanoBoostCDR = TriggerCreate("libHANA_gt_HeroAnaNanoBoostCDR_Func");
    TriggerEnable(libHANA_gt_HeroAnaNanoBoostCDR, false);
    TriggerAddEventUnitBehaviorChange(libHANA_gt_HeroAnaNanoBoostCDR, null, "AnaNanoBoostBuff", c_unitBehaviorChangeActivate);
}
```

- `TriggerCreate` binds the trigger to its `_Func` function by name.
- `TriggerAddEvent*` natives register events. This trigger runs when `AnaNanoBoostBuff` becomes active on any unit.
- `TriggerEnable(..., false)` disables the trigger until an [entry point](#entry-points) enables it.

The `_Func` function is the body, with the signature `bool _Func (bool testConds, bool runActions)`. When `testConds` is true, the body checks its conditions first and returns `false` if one fails. Event natives such as `EventUnit()` read the data of the event that started the run. The library's `InitLib` function calls every `_Init` function.

Hero libraries mostly register three events: an effect runs, a behavior changes, and a unit uses an ability:

```galaxy
TriggerAddEventPlayerEffectUsed(libHANA_gt_HeroAnaShrikeTokenCounter, c_playerAny, "AnaShrikeDotDamage");
TriggerAddEventUnitBehaviorChange(libHANA_gt_HeroAnaNanoBoostCDR, null, "AnaNanoBoostBuff", c_unitBehaviorChangeActivate);
TriggerAddEventUnitAbility(libHANA_gt_HeroAnaConcentratedDoses, null, AbilityCommand("AnaHealingDart", 0), c_unitAbilStageAll, false);
```

Because an effect that runs is an event, hero files contain effects that do nothing, often with `Dummy` in the name. `AnaEyeOfHorusImpactHeroDummySet` exists only to give a trigger an event.

### Entry points

The hero's `CUnit` starts and stops the library. [`HeroAna`][ana-unit] names two functions:

```xml
<InitializerFunction value="libHANA_gf_HeroAnaIncrementHeroCountFunction" />
<DestructionFunction value="libHANA_gf_HeroAnaDecrementHeroCountFunction" />
```

[The initializer][ana-init] counts the Anas in the match and enables Ana's triggers when the first one spawns. The destructor disables them when the game removes the last one:

```galaxy
void libHANA_gf_HeroAnaIncrementHeroCountFunction () {
    // Automatic Variable Declarations
    // Implementation
    libHANA_gv_heroAnaTriggerRegistrationVariable += 1;
    if ((libHANA_gv_heroAnaTriggerRegistrationVariable == 1)) {
        TriggerEnable(libHANA_gt_CCRecognitionSleep, true);
        TriggerEnable(libHANA_gt_HeroAnaNanoBoostCDR, true);
        // ...
    }
}
```

### Catalog access

Triggers use natives that take the same catalog, entry and field path as the XML: `CatalogFieldValueGet`, `CatalogFieldValueSet` and `CatalogFieldValueModifyFixed`. They also use unit natives such as `UnitBehaviorAdd` and `UnitCreateEffectUnit`.

```galaxy
CatalogFieldValueSet(lv_catalog, lv_entry, lv_field, lp_player, CatalogFieldValueGet(lv_catalog, lv_entry, lv_field, 0));
```

Some values exist only in Galaxy. One example is the cooldown reduction of Nano Boost. While the buff is on a Hero, [`libHANA_gt_HeroAnaNanoBoostCDR_Func`][nano-cdr] adds `libHANA_gv_hero_Ana_NanoBoostCDRAmount_C` (-0.0938 seconds) to the Hero's cooldowns once per game loop (0.0625 seconds):

```galaxy
while ((UnitHasBehavior2(lv_hero, "AnaNanoBoostBuff") == true)) {
    while ((UnitHasBehaviorWithCategoryFlag(lv_hero, c_behaviorCategoryTimeStop) == true)) {
        Wait(0.0625, c_timeGame);
    }
    libGame_gf_StormUniversalModifyCooldownonUnitCDRforAbilities(lv_hero, libHANA_gv_hero_Ana_NanoBoostCDRAmount_C, false, false, false);
    Wait(0.0625, c_timeGame);
}
```

Hanzo's Storm Bow changes its range the same way. [`libHHAN_gt_HeroHanzoStormBowCharging_Func`][storm-bow] increases `ImpactLocation.ProjectionDistanceScale` on `HanzoStormBowLaunchMissile` every game loop while `HanzoStormBowCharging` is active.

## Mechanics

### Level scaling

`LevelScalingArray` on `CHero` lists the fields that scale with the hero's level. Ana's table starts like this:

```xml
<LevelScalingArray>
  <Modifications>
    <Catalog value="Unit" />
    <Entry value="HeroAna" />
    <Field value="LifeMax" />
    <Value value="0.040000" />
    <AffectedByOverdrive value="1" />
  </Modifications>
  <!-- LifeStart, LifeRegenRate, AnaRangedAttackDamage, AnaShrikeDotDamage -->
</LevelScalingArray>
<LevelScalingArray Ability="AnaHealingDart">
  <Modifications>
    <Catalog value="Effect" />
    <Entry value="AnaHealingDartCreateHealer" />
    <Field value="RechargeVitalRate" />
    <Value value="0.040000" />
    <AffectedByAbilityPower value="1" />
    <AffectedByOverdrive value="1" />
  </Modifications>
</LevelScalingArray>
```

The trigger libraries apply this table, not the engine. [`libCore_gf_DataLoadHeroDataIntoIndex`][load-hero-data] in [HeroesLib][heroeslib] copies it into script memory. [`libGame_gf_ApplyLevelUpHeroStatsForHeroSingleLevel`][level-up-stats] in [GameLib][gamelib] runs each time the hero unit gains a level. This is the main part of that function, with the array lookups shortened:

```galaxy
if ((libGame_gv_dEBUG_PercentScalingEnabled == true) && (lv_percentScaled == true)) {
    lv_newValue = (CatalogFieldValueGetAsFixed(lv_catalog, lv_entry, lv_field, lv_player) * lv_valueAddedPerLevel);
}
else {
    lv_newValue = lv_valueAddedPerLevel;
}
// FieldIsInteger entries use CatalogFieldValueModifyInt instead
CatalogFieldValueModifyFixed(lv_catalog, lv_entry, lv_field, lv_player, lv_newValue, c_upgradeOperationAdd);
```

- `lv_percentScaled` comes from `AffectedByOverdrive`. The flag selects compound scaling: each level adds `field × Value`, so after `n` level-ups the field is `base × (1 + Value)^n`. Without the flag, each level adds `Value`. All live entries set the flag.

### Spell Power and armor

`CEffectDamage` has a `Kind`. [Core's class default][core-damage-default] sets `Basic`, and HeroesData's [`StormSpell`][storm-spell] template sets `Ability`. Armor applies per damage kind and per attacker type. Physical Armor reduces `Basic` damage, and Spell Armor reduces `Ability` damage.

[`ZaryaPersonalBarrierSpellBarrier`][zarya-barrier] gives Spell Armor. Its [tooltip][zarya-tooltip] reads the value from `ArmorModification.ArmorSet[Hero].ArmorMitigationTable[Ability]`:

```xml
<CBehaviorBuff id="ZaryaPersonalBarrierSpellBarrier" parent="StormArmor">
  <!-- ... -->
  <Duration value="3" />
  <ArmorModification>
    <ArmorSet index="Hero">
      <ArmorMitigationTable index="Ability" value="75" />
    </ArmorSet>
    <!-- the same for Merc, Monster, Summon, Structure and Minion -->
  </ArmorModification>
</CBehaviorBuff>
```

Physical damage is not limited to basic attacks. For example, Maiev's [`MaievFanOfKnivesBladeDanceDamage`][maiev-blade-dance] inherits from `StormWeapon`, so it deals `Basic` damage from an ability.

Spell Power is a `Modification` on a behavior. Nano Boost gives it:

```xml
<CBehaviorBuff id="AnaNanoBoostBuff" parent="StormDamageIncrease">
  <!-- ... -->
  <BehaviorCategories index="BuffAbilityPower" value="1" />
  <Duration value="8" />
  <Modification>
    <HealDealtAdditiveMultiplier index="Life" value="0.3" />
    <HealDealtAdditiveMultiplier index="Shields" value="0.3" />
    <DamageDealtFraction index="Ability" value="0.3" />
    <VitalDamageLeechScoreArray Value="Healing" />
  </Modification>
  <!-- ... -->
  <Aliases value="CritAliasSpellPower" />
</CBehaviorBuff>
```

[`AnaNanoBoostBuff`][nano-boost-buff] increases `Ability` damage with `DamageDealtFraction` and healing with `HealDealtAdditiveMultiplier`.

### Target selection

Three parts of the data decide what an ability hits. The ability sets where the player can click. Search effects find units in an area. Other effects read the target they need from the shared context. Sleep Dart uses all three.

[The ability][sleep-dart-abil] has `Range` 500 and `Arc` 360. A range of 500 has no practical limit, because it is many screens wide. A 360 degree arc means that Ana does not turn before she casts. [The missile][sleep-dart-missile] sets how far the dart flies:

```xml
<CEffectLaunchMissile id="AnaSleepDartLaunchMissile">
  <ValidatorArray index="0" value="CasterNotDead" />
  <ImpactLocation>
    <Value value="TargetPoint" />
    <ProjectionMultiplier value="1" />
    <UsesLineDash value="1" />
    <ProjectionDistanceScale value="11.75" />
  </ImpactLocation>
  <SharedFlags index="DynamicSearchArea" value="1" />
  <!-- ... -->
  <SearchEffect value="AnaSleepDartMissileScan" />
  <AmmoUnit value="AnaSleepDartMissile" />
  <!-- ... -->
</CEffectLaunchMissile>
```

`ImpactLocation` puts the impact point 11.75 units from Ana, toward the point that the player clicked. The distance is the same for every click. While the missile flies, the [`SearchEffect`][sleep-dart-scan] looks for a target:

```xml
<CEffectEnumArea id="AnaSleepDartMissileScan">
  <ImpactLocation Value="TargetPoint" />
  <SearchFilters value="Heroic;Self,Player,Ally,Neutral,ImmuneToSkillshots,Missile,Item,Stasis,Dead,Hidden,Invulnerable" />
  <AreaArray MaxCount="2" Effect="AnaSleepDartImpactSet">
    <RectangleWidth value="0.5" />
    <RectangleHeight value="1.25" />
  </AreaArray>
  <!-- ... -->
  <TargetSorts RequestCount="2">
    <SortArray value="TSDistanceFromCaster" />
  </TargetSorts>
  <ResultsTrackingEffect value="AnaSleepDartLaunchMissile" />
</CEffectEnumArea>
```

- A filter string is `required;excluded`, with commas between flags. This one requires `Heroic`. It excludes allies, neutrals, `ImmuneToSkillshots` and the usual dead and untargetable states. `-` means an empty side: `TargetNotUnstoppable` uses `-;Unstoppable`.
- `AreaArray` sets the shape (`Radius`, or a rectangle, and an optional `Arc`) and the effect to run on each hit. `MaxCount` and `TargetSorts` limit and order the hits.

[Nano Boost's][nano-boost-abil] filter selects the opposite set: `Heroic,Visible;Self,Neutral,Enemy,Structure,ImmuneToFriendlyAbilities,Missile,Item,Stasis,Dead,Hallucination`. That is allied Heroes other than Ana.

Other effects in the tree select units and points from the shared context with `WhichUnit`, `ImpactUnit`, `ImpactLocation`, `LaunchLocation` and similar fields. The values are `Caster`, `Source`, `Target` and `Origin`, with `Unit` and `Point` variants for locations, such as `TargetUnit` or `CasterPoint`. `Effect="X"` reads the context as it was at effect X, an earlier effect in the same tree. [`AnaSleepDartSetFacing`][sleep-dart-facing] turns Ana toward the point she clicked:

```xml
<CEffectModifyUnit id="AnaSleepDartSetFacing">
  <ImpactUnit Value="Caster" />
  <FacingLocation Effect="AnaSleepDartInitialSet" Value="TargetPoint" />
  <FacingType value="LookAt" />
</CEffectModifyUnit>
```

`Effect="AnaSleepDartInitialSet"` does not run that effect again. It tells `FacingLocation` to read `TargetPoint` from the context of `AnaSleepDartInitialSet`.

Validators and switches add more checks on the target. [`AnaEyeOfHorusImpactSwitch`][eoh-switch] sends enemies and allies to different branches with `TargetIsEnemy` and `TargetIsAlly`. Other effects use validators such as `TargetIsHero` and `TargetNotUnstoppable`.

### Talent gating

When a player picks a talent, GameLib runs [`libGame_gf_TalentsChooseTalentForPlayer`][choose-talent]. With the lookups shortened, it does this:

```galaxy
UnitBehaviorAdd(lv_heroUnit, lv_behaviors[lv_itBehavior], lv_heroUnit, 1);
libGame_gf_SendEventHeroGainTalent(lv_talentCatalogLink, lp_player);
libGame_gf_ApplyAbilityModificationsForPlayerAtTalent(lp_player, lp_tierIndex, lp_buttonIndex);
// ...
PlayerAddTalent(lp_player, lv_talentCatalogLink);
```

Each line gives the data a different way to check for the talent:

| Line | Data checks | Section |
|---|---|---|
| `UnitBehaviorAdd` | Behaviors from `RankArray` | [Granted behaviors](#granted-behaviors) |
| `SendEventHeroGainTalent` | Trigger code | [Script events](#script-events) |
| `ApplyAbilityModificationsForPlayerAtTalent` | Changed catalog fields | [Catalog changes](#catalog-changes) |
| `PlayerAddTalent` | `CValidatorPlayerTalent` | [Talent validators](#talent-validators) |

#### Catalog changes

[`libGame_gf_ApplyAbilityModificationsForPlayerAtTalent`][apply-talent-mods] applies `AbilityModificationArray` to the player's copy of the catalogs:

| Type | Result | Note |
|---|---|---|
| `FlatModification` | `field + Value` | Adds to `y` for offset strings, as level scaling does |
| `MultiplyLevelModification` | `field × Value` | The level does not affect it |
| `StringReplacement` | `field = StringReplacement` | Skipped for the Button catalog |
| `CatalogReplacement` | `CatalogLinkReplace(Entry → StringReplacement)` | Replaces every link to one record with a link to another |

The most common pattern is a disabled effect. [`AnaSleepDartNightTerrorsDamage`][night-terrors-damage] has `Chance` 0 in [`AnaSleepEndSet`][sleep-end-set], which Sleep Dart's buff runs when the target wakes. [The talent][night-terrors-talent] adds 1:

```xml
<CTalent id="AnaSleepDartNightTerrors">
  <Face value="AnaSleepDartNightTerrors" />
  <Abil value="AnaSleepDart" />
  <AbilityModificationArray>
    <Modifications>
      <Type value="FlatModification" />
      <Catalog value="Effect" />
      <Entry value="AnaSleepDartNightTerrorsDamage" />
      <Field value="Chance" />
      <Value value="1.000000" />
    </Modifications>
  </AbilityModificationArray>
</CTalent>
```

#### Talent validators

`PlayerAddTalent` sets the state that `CValidatorPlayerTalent` checks. [The move speed bonus][night-terrors-speed] of Night Terrors uses one:

```xml
<CEffectApplyBehavior id="AnaSleepDartNightTerrorsApplyMoveSpeedBehavior">
  <ValidatorArray index="0" value="AnaHasSleepDartNightTerrorsTalent" />
  <WhichUnit Value="Caster" />
  <Behavior value="AnaSleepDartNightTerrorsMovementSpeedBuff" />
</CEffectApplyBehavior>
```

The same validator controls the tooltip. [Sleep Dart's button][sleep-dart-button] has `<TooltipAppender Validator="AnaHasSleepDartNightTerrorsTalent" Face="AnaSleepDartNightTerrors" />`. Actor events also use talent validators, in terms such as `Behavior.AnaAimDownSights.On; ValidatePlayer AnaHasDynamicOptics`.

#### Granted behaviors

The hero gets the `RankArray` behaviors when the player picks the talent. Validators and requirements then test for them. Heroic abilities work this way. [`AnaHeroicAbilityNanaBoost`][nana-boost-talent] grants the shared [`Ultimate1Unlocked`][ultimate1-buff] buff, and the Nano Boost command requires the [`Ultimate1Unlocked`][ultimate1-req] requirement:

```xml
<CmdButtonArray index="Execute" DefaultButtonFace="AnaNanoBoost" Requirements="Ultimate1Unlocked">
```

#### Script events

`libGame_gf_SendEventHeroGainTalent` sends an event that hero libraries receive through `libGame_gf_HeroGainTalent`. [Ana's Deadeye cooldown conversion][deadeye-gain] is one receiver. Triggers also call `PlayerHasTalent` directly. GameLib checks some talents by name, such as `SamuroHeroicAbilityIllusionMaster` and `JunkratIHateWaitingTalent`.

A respec reverses the catalog changes in [`libGame_gf_RemoveTalentAbilityModificationsForPlayerAtTalent`][remove-talent-mods]. See [Catalog access](#catalog-access).

### Quests and stacks

Ana's level 20 talent Deadeye uses most of the mechanisms above:

1. [The talent][deadeye-talent] sets `Chance` to 1 on three disabled effects and changes the charge and cooldown fields of Eye of Horus.
2. When Ana enters Eye of Horus, one of those effects, [`AnaEyeOfHorusDeadeyeTokenCounterApplyBehavior`][deadeye-apply], puts the [`AnaEyeOfHorusDeadeyeTokenCounter`][deadeye-counter] counter on her.
3. Each round that hits a Hero runs another, [`AnaEyeOfHorusDeadeyeDelayPersistent`][deadeye-delay]. It waits one game loop and then adds a token with [`AnaEyeOfHorusDeadeyeAddToken`][deadeye-add-token].
4. [`AnaEyeOfHorusDeadeyeAccumulator`][deadeye-accumulator] converts the token count to `count × 0.05`.
5. [The damage effect][eoh-damage] applies the result through a gated modifier:

```xml
<CEffectDamage id="AnaEyeOfHorusImpactEnemyDamage" parent="StormSpell">
  <Amount value="135" />
  <MultiplicativeModifierArray index="0" Validator="IsStructureTarget" Modifier="-0.5" />
  <MultiplicativeModifierArray index="Deadeye" Validator="AnaHasEyeOfHorusDeadeyeTalent" Accumulator="AnaEyeOfHorusDeadeyeAccumulator" />
  <SourceButtonFace value="AnaEyeOfHorusActivate" />
</CEffectDamage>
```

A modifier entry applies while its validator passes. Its value comes from `Modifier` or from the accumulator and adds to a multiplier of 1. The [tooltip][deadeye-tooltip] shows the `-0.5` as "50% less damage to Structures" and each token as 5% more damage. The heal effect for allies has the same `Deadeye` entry. The [validator][deadeye-validator] checks for the talent, so the tokens have no effect without it.

For quest talents, `QuestData` tells the interface which counter to show. [Vampiric Rounds][vampiric-rounds] names `AnaShrikeVampiricRoundsTokenCounter`. The counter inherits from [`StormQuestToken`][quest-token], which sets `TokenId` and `Face` to `##id##` and names the `QuestIncrease` and `QuestComplete` events. The counter's `DeltaEvents` and `AtMaxEvents` attach effects to those events.

### Tooltips

Tooltips are GameStrings entries under `Button/Tooltip/<id>`. Numbers are `<d ref>` tags that evaluate an expression over `Catalog,Entry,Field` references. This is [the Night Terrors tooltip][night-terrors-tooltip]:

```text
Button/Tooltip/AnaSleepDartNightTerrors=Gain <c val="#TooltipNumbers"><d ref="100*Behavior,AnaSleepDartNightTerrorsMovementSpeedBuff,Modification.UnifiedMoveSpeedFactor"/>%</c> Movement Speed for <c val="#TooltipNumbers"><d ref="Behavior,AnaSleepDartNightTerrorsMovementSpeedBuff,Duration"/></c> seconds for every Hero hit by Sleep Dart. Upon waking, enemy Heroes take <c val="#TooltipNumbers"><d ref="100*Effect,AnaSleepDartNightTerrorsDamage,VitalFractionMax[0]"/>%</c> of their Maximum Health in damage.
```

- `<d>` also takes the `player` and `precision` attributes. `<c val>` sets a color, `<n/>` breaks a line and `<img path>` inserts an icon.
- A reference can read talent data. [Deadeye's tooltip][deadeye-tooltip] computes its cooldown as `Abil,AnaEyeOfHorusActivate,Cost[0].Cooldown.TimeUse + Talent,AnaEyeOfHorusDeadeye,AbilityModificationArray[0].Modifications[5].Value`.
- Some records exist only for a tooltip. The cooldown speedup of Nano Boost is a Galaxy constant, so [its tooltip][nano-boost-tooltip] reads "150% faster" from [`AnaNanoBoostCDDummyEffect`][nano-cd-dummy]. No other record refers to this `CEffectModifyUnit`: `<Cost Abil="AnaNanoBoost,Execute" CooldownTimeUse="150" />`.
- Some values are text. Sleep Dart's button sets `TooltipCooldownOverrideText` to `14 seconds`.

[core-dir]: /gamedata/mods/core.stormmod/
[heroesdata-dir]: /gamedata/mods/heroesdata.stormmod/
[heromods-dir]: /gamedata/mods/heromods/
[herointeractions-dir]: /gamedata/mods/heromods/herointeractions.stormmod/
[heroes-dir]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/
[triggerlibs-dir]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/
[ana-dir]: /gamedata/mods/heromods/ana.stormmod/
[nativelib]: /gamedata/mods/core.stormmod/base.stormdata/triggerlibs/nativelib-galaxy/
[core-effect-default]: /gamedata/mods/core.stormmod/base.stormdata/gamedata/effectdata-xml/#CEffect.default
[core-apply-default]: /gamedata/mods/core.stormmod/base.stormdata/gamedata/effectdata-xml/#CEffectApplyBehavior.default
[core-damage-default]: /gamedata/mods/core.stormmod/base.stormdata/gamedata/effectdata-xml/#CEffectDamage.default
[core-remove-default]: /gamedata/mods/core.stormmod/base.stormdata/gamedata/effectdata-xml/#CEffectRemoveBehavior.default
[core-button-default]: /gamedata/mods/core.stormmod/base.stormdata/gamedata/buttondata-xml/#CButton.default
[core-combine-default]: /gamedata/mods/core.stormmod/base.stormdata/gamedata/validatordata-xml/#CValidatorCombine.default
[heroesdata-includes]: /gamedata/mods/heroesdata.stormmod/base.stormdata/includes-xml/
[heroesdata-gamedata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata-xml/
[heroesdata-cgame]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/gamedata-xml/#CGame.Dflt
[librarylist]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/librarylist-xml/
[heroeslib]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/heroeslib-galaxy/
[gamelib]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamelib-galaxy/
[gdhl]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamedatahelperlib-galaxy/
[abildata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/abildata-xml/
[accumulatordata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/accumulatordata-xml/
[behaviordata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/behaviordata-xml/
[buttondata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/buttondata-xml/
[effectdata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/effectdata-xml/
[herodata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/herodata-xml/
[requirementdata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/requirementdata-xml/
[talentdata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/talentdata-xml/
[unitdata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/unitdata-xml/
[validatordata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/validatordata-xml/
[weapondata]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/weapondata-xml/
[hero-default]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/herodata-xml/#CHero.default
[storm-button-parent]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/buttondata-xml/#CButton.StormButtonParent
[storm-hero-mounted]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/unitdata-xml/#CUnit.StormHeroMounted
[ultimate1-req]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/requirementdata-xml/#CRequirement.Ultimate1Unlocked
[hero-portraits-const]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/rewarddata-xml/#$HeroPortraits7
[carry-parent]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/behaviordata-xml/#CBehaviorBuff.CarryBehaviorParent
[ultimate1-buff]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/behaviordata-xml/#CBehaviorBuff.Ultimate1Unlocked
[quest-token]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/behaviordata-xml/#CBehaviorTokenCounter.StormQuestToken
[storm-spell]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/effectdata-xml/#CEffectDamage.StormSpell
[storm-spell-percent]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/effectdata-xml/#CEffectDamage.StormSpellPercentDamage
[storm-healing]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/effectdata-xml/#CEffectCreateHealer.StormHealingParent
[load-hero-data]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/heroeslib-galaxy/#libCore_gf_DataLoadHeroDataIntoIndex
[level-up-stats]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamelib-galaxy/#libGame_gf_ApplyLevelUpHeroStatsForHeroSingleLevel
[overdrive-talent]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/talentdata-xml/#CTalent.GenericTalentOverdrive
[choose-talent]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamelib-galaxy/#libGame_gf_TalentsChooseTalentForPlayer
[apply-talent-mods]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamelib-galaxy/#libGame_gf_ApplyAbilityModificationsForPlayerAtTalent
[remove-talent-mods]: /gamedata/mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamelib-galaxy/#libGame_gf_RemoveTalentAbilityModificationsForPlayerAtTalent
[tutorial-arthas]: /gamedata/mods/heroes.stormmod/base.stormmaps/maps/heroes/singleplayermaps/startingexperience/tutorial01.stormmap/base.stormdata/gamedata/herodata-xml/#CHero.Arthas
[chen-buff]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/chendata/chendata-xml/#CBehaviorBuff.ChenFortifyingBrewComboStrikesAttackSpeedBuff
[arthas-const]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/arthasdata/arthasdata-xml/#$ArthasGorefiendsGraspRangeIncrease
[gorefiends-grasp]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/arthasdata/arthasdata-xml/#CTalent.ArthasGorefiendsGrasp
[rexxar-or]: /gamedata/mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/rexxardata/rexxardata-xml/#CValidatorCombine.CasterIsMishaOrRexxar
[chromie-cgame]: /gamedata/mods/heromods/chromie.stormmod/base.stormdata/gamedata/chromiedata-xml/#CGame.Dflt
[chromie-hero]: /gamedata/mods/heromods/chromie.stormmod/base.stormdata/gamedata/chromiedata-xml/#CHero.Chromie
[chromie-attack]: /gamedata/mods/heromods/chromie.stormmod/base.stormdata/gamedata/chromiedata-xml/#CActorAction.ChromieHeroAttack
[varian-hero]: /gamedata/mods/heromods/varian.stormmod/base.stormdata/gamedata/variandata-xml/#CHero.Varian
[garrosh-decimate]: /gamedata/mods/heromods/garrosh.stormmod/base.stormdata/gamedata/garrosh-xml/#CValidatorPlayerTalent.GarroshDoesNotHaveDecimate
[garrosh-cd]: /gamedata/mods/heromods/garrosh.stormmod/base.stormdata/gamedata/garrosh-xml/#CBehaviorBuff.GarroshDecimateCooldownBehavior
[zarya-barrier]: /gamedata/mods/heromods/zarya.stormmod/base.stormdata/gamedata/zaryadata-xml/#CBehaviorBuff.ZaryaPersonalBarrierSpellBarrier
[zarya-tooltip]: /gamedata/mods/heromods/zarya.stormmod/enus.stormdata/localizeddata/gamestrings-txt/#Button/Tooltip/ZaryaPersonalBarrierSpellBarrierTalent
[maiev-blade-dance]: /gamedata/mods/heromods/maiev.stormmod/base.stormdata/gamedata/maievdata-xml/#CEffectDamage.MaievFanOfKnivesBladeDanceDamage
[storm-bow]: /gamedata/mods/heromods/hanzo.stormmod/base.stormdata/libhhan-galaxy/#libHHAN_gt_HeroHanzoStormBowCharging_Func
[storm-bow-reset]: /gamedata/mods/heromods/hanzo.stormmod/base.stormdata/gamedata/hanzodata-xml/#CEffectModifyCatalogNumeric.HanzoStormBowResetMinimumRange
[ana-documentinfo]: /gamedata/mods/heromods/ana.stormmod/documentinfo/
[ana-includes]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata-xml/
[ana-cgame]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/gamedata-xml/#CGame.Dflt
[ana-gamestrings]: /gamedata/mods/heromods/ana.stormmod/enus.stormdata/localizeddata/gamestrings-txt/
[anadata]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/
[shrike-token-accumulator]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CAccumulatorToken.AnaShrikeDotDamageToken
[shrike-token-behavior]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CBehaviorTokenCounter.AnaShrikeDotDamageToken
[shrike-token-effect]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectModifyTokenCount.AnaShrikeDotDamageToken
[libhana]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/libhana-galaxy/
[libhana-h]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/libhana_h-galaxy/
[ana-hero]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CHero.Ana
[ana-unit]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CUnit.HeroAna
[sleep-dart-abil]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CAbilEffectTarget.AnaSleepDart
[sleep-dart-buff]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CBehaviorBuff.AnaSleepDart
[sleep-dart-button]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CButton.AnaSleepDart
[sleep-dart-missile]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectLaunchMissile.AnaSleepDartLaunchMissile
[sleep-dart-scan]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectEnumArea.AnaSleepDartMissileScan
[sleep-dart-facing]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectModifyUnit.AnaSleepDartSetFacing
[sleep-end-set]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectSet.AnaSleepEndSet
[night-terrors-damage]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectDamage.AnaSleepDartNightTerrorsDamage
[night-terrors-talent]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CTalent.AnaSleepDartNightTerrors
[night-terrors-speed]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectApplyBehavior.AnaSleepDartNightTerrorsApplyMoveSpeedBehavior
[night-terrors-tooltip]: /gamedata/mods/heromods/ana.stormmod/enus.stormdata/localizeddata/gamestrings-txt/#Button/Tooltip/AnaSleepDartNightTerrors
[nano-boost-abil]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CAbilEffectTarget.AnaNanoBoost
[nano-boost-buff]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CBehaviorBuff.AnaNanoBoostBuff
[nano-boost-tooltip]: /gamedata/mods/heromods/ana.stormmod/enus.stormdata/localizeddata/gamestrings-txt/#Button/Tooltip/AnaNanoBoost
[nano-monitor-effect]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectApplyBehavior.AnaNanoBoostMonitor
[nano-monitor-buff]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CBehaviorBuff.AnaNanoBoostMonitor
[nano-cd-dummy]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectModifyUnit.AnaNanoBoostCDDummyEffect
[nana-boost-talent]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CTalent.AnaHeroicAbilityNanaBoost
[ana-no-overdose]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CValidatorPlayerTalent.AnaDoesNotHaveOverdose
[eoh-switch]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectSwitch.AnaEyeOfHorusImpactSwitch
[eoh-damage]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectDamage.AnaEyeOfHorusImpactEnemyDamage
[deadeye-talent]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CTalent.AnaEyeOfHorusDeadeye
[deadeye-apply]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectApplyBehavior.AnaEyeOfHorusDeadeyeTokenCounterApplyBehavior
[deadeye-counter]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CBehaviorTokenCounter.AnaEyeOfHorusDeadeyeTokenCounter
[deadeye-delay]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectCreatePersistent.AnaEyeOfHorusDeadeyeDelayPersistent
[deadeye-add-token]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CEffectModifyTokenCount.AnaEyeOfHorusDeadeyeAddToken
[deadeye-accumulator]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CAccumulatorToken.AnaEyeOfHorusDeadeyeAccumulator
[deadeye-validator]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CValidatorPlayerTalent.AnaHasEyeOfHorusDeadeyeTalent
[deadeye-tooltip]: /gamedata/mods/heromods/ana.stormmod/enus.stormdata/localizeddata/gamestrings-txt/#Button/Tooltip/AnaEyeOfHorusDeadeye
[piercing-darts]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CTalent.AnaPiercingDarts
[vampiric-rounds]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata-xml/#CTalent.AnaShrikeVampiricRounds
[vampiric-rounds-tooltip]: /gamedata/mods/heromods/ana.stormmod/enus.stormdata/localizeddata/gamestrings-txt/#Button/Tooltip/AnaShrikeVampiricRounds
[ana-init]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/libhana-galaxy/#libHANA_gf_HeroAnaIncrementHeroCountFunction
[nano-cdr]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/libhana-galaxy/#libHANA_gt_HeroAnaNanoBoostCDR_Func
[nano-cdr-init]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/libhana-galaxy/#libHANA_gt_HeroAnaNanoBoostCDR_Init
[deadeye-gain]: /gamedata/mods/heromods/ana.stormmod/base.stormdata/libhana-galaxy/#libHANA_gt_AnaGainsDeadeyeTalentCooldownConversion_Init
