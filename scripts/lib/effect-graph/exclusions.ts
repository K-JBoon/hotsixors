// Per-mechanic exclusion tables.

import type { MechanicLike, AbilTalentEntry } from "./types.ts";

export function excludedBehaviorDescendantsForMechanic(mechanic: MechanicLike): string[] {
  if (mechanic.slug === "time-stop") {
    return [
      "FenixPlasmaCutterUnitTimestopBehavior",
      "FenixPurificationSalvoScannerTimeStopBuff",
      "FirebatBunkerDropPassengerUnitTimeStop",
      "FirebatBunkerDropTurretTimeStop",
      "HeroGenericTimeStop",
      "HeroGenericTimeStopListener",
      "HoggerHoggWildMissileTimeStopController",
      "HoggerHoardapultMissileTimeStopController",
      "KerriganChrysalisTimeStopListener",
    ];
  }
  return [];
}

export function excludedAppliedBehaviorDescendantsForMechanic(mechanic: MechanicLike): string[] {
  if (mechanic.slug === "invulnerable") return ["StormStasis"];
  // Taunt interruption stuns are excluded from CC tracking.
  if (mechanic.slug === "stunned") {
    return ["VarianTauntInterruptionStun", "GarroshWarlordsChallengeInterruptionStun"];
  }
  return [];
}

export function excludedEntryIdsForMechanic(mechanic: MechanicLike): string[] {
  switch (mechanic.slug) {
    case "time-stop":
      return ["ChromieTimeTrapDetonate", "MedivhLeyLineSealMedivhCheats"];
    case "slowed":
      return [
        "HoggerDenseBlastingPowder",
        "HoggerSecretStash",
        "IllidanMasteryFriendOrFoeDive",
        "LeoricUndyingTrait",
        "ZaryaExpulsionZoneClearOut",
      ];
    case "stunned":
      return ["SylvanasWailingArrow", "SylvanasHeroicAbilityWailingArrow"];
    case "shield":
      // This talent only increases the capacity of the existing Personal Barrier shield.
      return ["ZaryaPersonalBarrierIAmTheStrongest"];
    case "physical-damage-increase":
      // Powerslide itself is not a damage increase.
      return ["L90ETCPowerslide"];
    case "spell-power-increase":
      // Siegebreaker increases both spell and summon-unit weapon damage.
      return ["AzmodanSiegebreaker"];
    default:
      return [];
  }
}

// Damage buffs applied via SpawnEffect target the summoned unit, not the hero.
export function ignoreSpawnSetupRefsForMechanic(mechanic: MechanicLike): boolean {
  return mechanic.slug === "stasis"
    || mechanic.slug === "unstoppable"
    || mechanic.slug === "invulnerable"
    || mechanic.statModifier === "damage";
}

export function isCancelEntry(entry: AbilTalentEntry): boolean {
  // Match "cancel" as a whole token.
  return entry.kind === "ability" && /(?:^|[^a-z])cancel|cancel(?:$|[^a-z])/i.test(`${entry.nameId} ${entry.name}`);
}
