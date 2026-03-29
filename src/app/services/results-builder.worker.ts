/*
 * Copyright (c) 2023 D2ArmorPicker by Mijago.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// region Imports
import { BuildConfiguration, FixableSelection } from "../data/buildConfiguration";
import { IDestinyArmor } from "../data/types/IInventoryArmor";
import { ArmorSlot } from "../data/enum/armor-slot";
import { FORCE_USE_ANY_EXOTIC, MAXIMUM_MASTERWORK_LEVEL } from "../data/constants";
import { ModInformation } from "../data/ModInformation";
import {
  ArmorPerkOrSlot,
  ArmorPerkSocketHashes,
  ArmorStat,
  SpecialArmorStat,
  STAT_MOD_VALUES,
  StatModifier,
} from "../data/enum/armor-stat";

import { environment } from "../../environments/environment";

import { ModOptimizationStrategy } from "../data/enum/mod-optimization-strategy";
import { IPermutatorArmor } from "../data/types/IPermutatorArmor";
import { IPermutatorArmorSet, Tuning, createArmorSet } from "../data/types/IPermutatorArmorSet";
import { ArmorSystem } from "../data/types/IManifestArmor";

import { precalculatedTuningModCombinations } from "../data/generated/precalculatedModCombinationsWithTunings";

// endregion Imports

type t5Improvement = {
  tuningStat: ArmorStat;
  archetypeStats: ArmorStat[];
};

function isT5WithTuning(i: IPermutatorArmor): boolean {
  return (
    i.armorSystem == ArmorSystem.Armor3 &&
    i.tier >= 5 &&
    i.archetypeStats &&
    i.tuningStat !== undefined
  );
}

function mapItemToTuning(i: IPermutatorArmor): t5Improvement {
  return {
    tuningStat: i.tuningStat!,
    archetypeStats: i.archetypeStats,
  };
}

// region Validation and Preparation Functions
// Pre-allocated working map for checkSlots — avoids cloning constantModslotRequirement per call
const _slotReqs = new Map<number, number>();

function checkSlotsItem(item: IPermutatorArmor, config: BuildConfiguration): void {
  if (item.armorSystem === ArmorSystem.Armor2) {
    if (
      (item.isExotic && config.assumeEveryExoticIsArtifice) ||
      (!item.isExotic && config.assumeEveryLegendaryIsArtifice) ||
      (!item.isExotic && item.slot == ArmorSlot.ArmorSlotClass && config.assumeClassItemIsArtifice)
    ) {
      _slotReqs.set(
        ArmorPerkOrSlot.SlotArtifice,
        (_slotReqs.get(ArmorPerkOrSlot.SlotArtifice) ?? 0) - 1
      );
      return;
    }
  }

  _slotReqs.set(item.perk, (_slotReqs.get(item.perk) ?? 0) - 1);
  if (item.gearSetHash != null)
    _slotReqs.set(item.gearSetHash, (_slotReqs.get(item.gearSetHash) ?? 0) - 1);
}

function checkSlots(
  config: BuildConfiguration,
  constantModslotRequirement: Map<number, number>,
  helmet: IPermutatorArmor,
  gauntlet: IPermutatorArmor,
  chest: IPermutatorArmor,
  leg: IPermutatorArmor,
  classItem: IPermutatorArmor
): boolean {
  // Reset working map from constant source (avoids new Map() allocation)
  _slotReqs.clear();
  for (const [k, v] of constantModslotRequirement) _slotReqs.set(k, v);

  checkSlotsItem(helmet, config);
  checkSlotsItem(gauntlet, config);
  checkSlotsItem(chest, config);
  checkSlotsItem(leg, config);
  checkSlotsItem(classItem, config);

  for (const [key, val] of _slotReqs) {
    if (key == ArmorPerkOrSlot.Any || key == ArmorPerkOrSlot.None) continue;
    if (val > 0) return false;
  }

  return true;
}

function prepareConstantStatBonus(config: BuildConfiguration) {
  const constantBonus = [0, 0, 0, 0, 0, 0];
  // Apply configurated mods to the stat value
  // Apply mods
  for (const mod of config.enabledMods) {
    for (const bonus of ModInformation[mod].bonus) {
      var statId =
        bonus.stat == SpecialArmorStat.ClassAbilityRegenerationStat
          ? [1, 0, 2][config.characterClass]
          : bonus.stat;
      constantBonus[statId] += bonus.value;
    }
  }
  return constantBonus;
}

function prepareConstantModslotRequirement(config: BuildConfiguration) {
  let constantPerkRequirement = new Map<ArmorPerkOrSlot, number>();

  for (let [key] of constantPerkRequirement) {
    constantPerkRequirement.set(key, 0);
  }

  for (const req of config.armorRequirements) {
    if ("perk" in req) {
      let perk = req.perk;

      const e = Object.entries(ArmorPerkSocketHashes).find(([, value]) => value == perk);
      if (e) perk = Number.parseInt(e[0]) as any as ArmorPerkOrSlot;

      if (perk != ArmorPerkOrSlot.Any && perk != ArmorPerkOrSlot.None) {
        constantPerkRequirement.set(perk, (constantPerkRequirement.get(perk) ?? 0) + 1);
      }
    } else if ("gearSetHash" in req) {
      // Gear set requirement
      constantPerkRequirement.set(
        req.gearSetHash,
        (constantPerkRequirement.get(req.gearSetHash) ?? 0) + 1
      );
    }
  }
  return constantPerkRequirement;
}

function forEachCombination(
  helmets: IPermutatorArmor[],
  gauntlets: IPermutatorArmor[],
  chests: IPermutatorArmor[],
  legs: IPermutatorArmor[],
  classItems: IPermutatorArmor[],
  requiresAtLeastOneExotic: boolean,
  callback: (
    helmet: IPermutatorArmor,
    gauntlet: IPermutatorArmor,
    chest: IPermutatorArmor,
    leg: IPermutatorArmor,
    classItem: IPermutatorArmor
  ) => void
) {
  for (let hi = 0; hi < helmets.length; hi++) {
    const helmet = helmets[hi];
    for (let gi = 0; gi < gauntlets.length; gi++) {
      const gauntlet = gauntlets[gi];
      if (helmet.isExotic && gauntlet.isExotic) continue;
      for (let ci = 0; ci < chests.length; ci++) {
        const chest = chests[ci];
        if ((helmet.isExotic || gauntlet.isExotic) && chest.isExotic) continue;
        for (let li = 0; li < legs.length; li++) {
          const leg = legs[li];
          if ((helmet.isExotic || gauntlet.isExotic || chest.isExotic) && leg.isExotic) continue;
          const anyExotic = helmet.isExotic || gauntlet.isExotic || chest.isExotic || leg.isExotic;
          for (let ki = 0; ki < classItems.length; ki++) {
            const classItem = classItems[ki];
            if (anyExotic && classItem.isExotic) continue;
            if (requiresAtLeastOneExotic && !anyExotic && !classItem.isExotic) continue;
            callback(helmet, gauntlet, chest, leg, classItem);
          }
        }
      }
    }
  }
}

function estimateCombinationsToBeChecked(
  helmets: IPermutatorArmor[],
  gauntlets: IPermutatorArmor[],
  chests: IPermutatorArmor[],
  legs: IPermutatorArmor[],
  classItems: IPermutatorArmor[]
) {
  let totalCalculations = 0;
  const exoticHelmets = helmets.filter((d) => d.isExotic).length;
  const legendaryHelmets = helmets.length - exoticHelmets;
  const exoticGauntlets = gauntlets.filter((d) => d.isExotic).length;
  const legendaryGauntlets = gauntlets.length - exoticGauntlets;
  const exoticChests = chests.filter((d) => d.isExotic).length;
  const legendaryChests = chests.length - exoticChests;
  const exoticLegs = legs.filter((d) => d.isExotic).length;
  const legendaryLegs = legs.length - exoticLegs;
  const exoticClassItems = classItems.filter((d) => d.isExotic).length;
  const legendaryClassItems = classItems.length - exoticClassItems;
  // all legendary
  totalCalculations +=
    legendaryHelmets * legendaryGauntlets * legendaryChests * legendaryLegs * legendaryClassItems;
  // exotic in exactly one slot
  totalCalculations +=
    exoticHelmets * legendaryGauntlets * legendaryChests * legendaryLegs * legendaryClassItems;
  totalCalculations +=
    legendaryHelmets * exoticGauntlets * legendaryChests * legendaryLegs * legendaryClassItems;
  totalCalculations +=
    legendaryHelmets * legendaryGauntlets * exoticChests * legendaryLegs * legendaryClassItems;
  totalCalculations +=
    legendaryHelmets * legendaryGauntlets * legendaryChests * exoticLegs * legendaryClassItems;
  totalCalculations +=
    legendaryHelmets * legendaryGauntlets * legendaryChests * legendaryLegs * exoticClassItems;
  return totalCalculations;
}
// endregion Validation and Preparation Functions

// region Main Worker Event Handler
addEventListener("message", async ({ data }) => {
  if (data.type != "builderRequest") return;

  const threadSplit = data.threadSplit as { count: number; current: number };
  const config = data.config as BuildConfiguration;
  const anyStatFixed = Object.values(config.minimumStatTiers).some(
    (v: FixableSelection<number>) => v.fixed
  );
  let items = data.items as IPermutatorArmor[];

  if (threadSplit == undefined || config == undefined || items == undefined) {
    return;
  }

  const startTime = Date.now();
  console.log(`Thread ${threadSplit.current} started with ${items.length} items to process.`);
  console.time(`Total run thread#${threadSplit.current}`);
  // toggle feature flags
  config.onlyShowResultsWithNoWastedStats =
    environment.featureFlags.enableZeroWaste && config.onlyShowResultsWithNoWastedStats;
  if (!environment.featureFlags.enableModslotLimitation) {
    config.statModLimits = {
      maxMods: 5, // M: total mods allowed (0–5)
      maxMajorMods: 5, // N: major mods allowed (0–maxMods)
    };
  }

  const fotlHashes = config.useFotlArmor
    ? new Set([199733460, 2545426109, 3224066584, 2390807586, 2462335932, 4095816113])
    : null;
  let helmets: IPermutatorArmor[] = [];
  let gauntlets: IPermutatorArmor[] = [];
  let chests: IPermutatorArmor[] = [];
  let legs: IPermutatorArmor[] = [];
  let classItems: IPermutatorArmor[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const i = items[idx];
    switch (i.slot) {
      case ArmorSlot.ArmorSlotHelmet:
        if (!fotlHashes || fotlHashes.has(i.hash)) helmets.push(i);
        break;
      case ArmorSlot.ArmorSlotGauntlet:
        gauntlets.push(i);
        break;
      case ArmorSlot.ArmorSlotChest:
        chests.push(i);
        break;
      case ArmorSlot.ArmorSlotLegs:
        legs.push(i);
        break;
      case ArmorSlot.ArmorSlotClass:
        classItems.push(i);
        break;
    }
  }

  // Sort by Masterwork, descending
  classItems = classItems.sort(
    (a, b) => (b.tier ?? 0) - (a.tier ?? 0) || (b.masterworkLevel ?? 0) - (a.masterworkLevel ?? 0)
  );

  // Filter exotic class items based on selected exotic perks if they are not "Any"
  if (config.selectedExoticPerks && config.selectedExoticPerks.length >= 2) {
    const firstPerkFilter = config.selectedExoticPerks[0];
    const secondPerkFilter = config.selectedExoticPerks[1];

    if (firstPerkFilter !== ArmorPerkOrSlot.Any || secondPerkFilter !== ArmorPerkOrSlot.Any) {
      classItems = classItems.filter((item) => {
        if (!item.isExotic || !item.exoticPerkHash || item.exoticPerkHash.length < 2) {
          return true; // Keep non-exotic items or items without proper perk data
        }

        const hasFirstPerk =
          firstPerkFilter === ArmorPerkOrSlot.Any || item.exoticPerkHash.includes(firstPerkFilter);
        const hasSecondPerk =
          secondPerkFilter === ArmorPerkOrSlot.Any ||
          item.exoticPerkHash.includes(secondPerkFilter);

        return hasFirstPerk && hasSecondPerk;
      });
    }
  }

  if (
    config.assumeEveryLegendaryIsArtifice ||
    config.assumeEveryExoticIsArtifice ||
    config.assumeClassItemIsArtifice
  ) {
    classItems = classItems.map((item) => {
      if (
        item.armorSystem == ArmorSystem.Armor2 &&
        ((config.assumeEveryLegendaryIsArtifice && !item.isExotic) ||
          (config.assumeEveryExoticIsArtifice && item.isExotic) ||
          (config.assumeClassItemIsArtifice && !item.isExotic))
      ) {
        return { ...item, perk: ArmorPerkOrSlot.SlotArtifice };
      }
      return item;
    });
  }

  // true if any armorPerks is not "any"
  const doesNotRequireArmorPerks = config.armorRequirements.length == 0;

  {
    const seen = new Set<string>();
    classItems = classItems.filter((item) => {
      const tuningPart = item.tier < 5 ? -1 : (item.tuningStat ?? -1);
      const mwPart =
        (item.isExotic && config.assumeExoticsMasterworked) ||
        (!item.isExotic && config.assumeLegendariesMasterworked) ||
        !anyStatFixed
          ? 0
          : (item.masterworkLevel ?? 0);
      const perkPart = doesNotRequireArmorPerks ? 0 : item.perk;
      const gearSetPart = doesNotRequireArmorPerks ? 0 : (item.gearSetHash ?? 0);
      const key = `${item.mobility}|${item.resilience}|${item.recovery}|${item.discipline}|${item.intellect}|${item.strength}|${item.isExotic}|${tuningPart}|${mwPart}|${perkPart}|${gearSetPart}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Support multithreading. Find the largest set and split it by N, ensuring even exotic distribution.
  if (threadSplit.count > 1) {
    // Find the largest slot array
    const slotArrays: [IPermutatorArmor[], number, string][] = [
      [helmets, helmets.length, "helmets"],
      [gauntlets, gauntlets.length, "gauntlets"],
      [chests, chests.length, "chests"],
      [legs, legs.length, "legs"],
      [classItems, classItems.length, "class"],
    ];
    slotArrays.sort((a, b) => b[1] - a[1]);
    const splitEntry = slotArrays[0][0];
    const splitEntryName = slotArrays[0][2];

    // Separate exotics and non-exotics
    const exotics = splitEntry.filter((i) => i.isExotic);
    const nonExotics = splitEntry.filter((i) => !i.isExotic);

    // Deterministically sort both groups (by hash, then by masterworkLevel, then by name if available)
    const stableSort = (arr: IPermutatorArmor[]) =>
      arr.slice().sort((a, b) => {
        if (a.hash !== b.hash) return a.hash - b.hash;
        if ((a.masterworkLevel ?? 0) !== (b.masterworkLevel ?? 0))
          return (a.masterworkLevel ?? 0) - (b.masterworkLevel ?? 0);
        return 0;
      });
    const sortedExotics = stableSort(exotics);
    const sortedNonExotics = stableSort(nonExotics);

    // Helper to split an array into N nearly equal, deterministic batches
    function splitIntoBatches<T>(arr: T[], batchCount: number): T[][] {
      const batches: T[][] = Array.from({ length: batchCount }, () => []);
      for (let i = 0; i < arr.length; ++i) {
        // Distribute round-robin for determinism
        batches[i % batchCount].push(arr[i]);
      }
      return batches;
    }

    const exoticBatches = splitIntoBatches(sortedExotics, threadSplit.count);
    const nonExoticBatches = splitIntoBatches(sortedNonExotics, threadSplit.count);

    // For this thread, combine the corresponding exotic and non-exotic batch
    const batch = [...exoticBatches[threadSplit.current], ...nonExoticBatches[threadSplit.current]];

    // Replace the original slot array with the batch for this thread
    switch (splitEntryName) {
      case "helmets":
        helmets = batch;
        break;
      case "gauntlets":
        gauntlets = batch;
        break;
      case "chests":
        chests = batch;
        break;
      case "legs":
        legs = batch;
        break;
      case "class":
        classItems = batch;
        break;
    }
  }

  // runtime variables
  const runtime = {
    maximumPossibleTiers: [0, 0, 0, 0, 0, 0],
  };

  if (classItems.length == 0) {
    console.warn(
      `Thread#${threadSplit.current} - No class items found with the current configuration.`
    );
    postMessage({
      runtime: runtime,
      results: [],
      done: true,
      checkedCalculations: 0,
      estimatedCalculations: 0,
      stats: {
        permutationCount: 0,
        itemCount: items.length - classItems.length,
        totalTime: Date.now() - startTime,
      },
    });
    return;
  }

  const constantBonus = prepareConstantStatBonus(config);
  const constantModslotRequirement = prepareConstantModslotRequirement(config);
  const hasSlotRequirements = config.armorRequirements.length > 0;

  // Pre-compute config-derived constants (H3: hoisted out of handlePermutation)
  const targetVals: number[] = new Array(6);
  const targetFixed: boolean[] = new Array(6);
  for (let n: ArmorStat = 0; n < 6; n++) {
    targetVals[n] = (config.minimumStatTiers[n].value || 0) * 10;
    targetFixed[n] = !!config.minimumStatTiers[n].fixed;
  }
  const maxMajorMods = config.statModLimits?.maxMajorMods || 0;
  const maxMods = config.statModLimits?.maxMods || 0;
  const possibleIncreaseByMod = 10 * maxMajorMods + 5 * Math.max(0, maxMods - maxMajorMods);
  const assumeEveryLegendaryIsArtifice = !!config.assumeEveryLegendaryIsArtifice;
  const assumeEveryExoticIsArtifice = !!config.assumeEveryExoticIsArtifice;

  const requiresAtLeastOneExotic = config.selectedExotics.indexOf(FORCE_USE_ANY_EXOTIC) > -1;

  let results: IPermutatorArmorSet[] = [];
  let resultsLength = 0;

  let listedResults = 0;
  let totalResults = 0;
  let doNotOutput = false;

  // contains the value of the total amount of combinations to be checked
  let estimatedCalculations = estimateCombinationsToBeChecked(
    helmets,
    gauntlets,
    chests,
    legs,
    classItems
  );
  let checkedCalculations = 0;
  let lastProgressReportTime = 0;
  // define the delay; it can be 75ms if the estimated calculations are low
  // if the estimated calculations >= 1e6, then we will use 125ms
  let progressBarDelay = estimatedCalculations >= 1e6 ? 125 : 75;

  let allTiersMaxed = false;

  forEachCombination(
    helmets,
    gauntlets,
    chests,
    legs,
    classItems,
    requiresAtLeastOneExotic,
    (helmet, gauntlet, chest, leg, classItem) => {
      checkedCalculations++;

      // Early termination: no more output needed and tier tracking fully converged
      if (doNotOutput && allTiersMaxed) return;

      if (
        hasSlotRequirements &&
        !checkSlots(config, constantModslotRequirement, helmet, gauntlet, chest, leg, classItem)
      )
        return;

      const result = handlePermutation(
        runtime,
        config,
        helmet,
        gauntlet,
        chest,
        leg,
        classItem,
        constantBonus,
        doNotOutput,
        targetVals,
        targetFixed,
        possibleIncreaseByMod,
        assumeEveryLegendaryIsArtifice,
        assumeEveryExoticIsArtifice
      );
      // Only add 50k to the list if the setting is activated.
      // We will still calculate the rest so that we get accurate results for the runtime values
      if (result !== null) {
        totalResults++;

        results.push(result);
        resultsLength++;
        listedResults++;
        doNotOutput =
          doNotOutput ||
          (config.limitParsedResults && listedResults >= 3e4 / threadSplit.count) ||
          listedResults >= 1e6 / threadSplit.count;
      }

      // Check if all tiers have reached the 200 cap — no further tier testing needed
      if (doNotOutput && !allTiersMaxed) {
        allTiersMaxed = runtime.maximumPossibleTiers.every((t: number) => t >= 200);
      }

      if (
        checkedCalculations % 5000 == 0 &&
        lastProgressReportTime + progressBarDelay < Date.now()
      ) {
        lastProgressReportTime = Date.now();
        postMessage({
          checkedCalculations,
          estimatedCalculations,
          reachableTiers: runtime.maximumPossibleTiers,
        });
      }

      if (resultsLength >= 5000) {
        // @ts-ignore
        postMessage({ runtime, results, done: false, checkedCalculations, estimatedCalculations });
        results = [];
        resultsLength = 0;
      }
    }
  );
  console.timeEnd(`Total run thread#${threadSplit.current}`);

  // @ts-ignore
  postMessage({
    runtime,
    results,
    done: true,
    checkedCalculations,
    estimatedCalculations,
    stats: {
      permutationCount: totalResults,
      itemCount: items.length - classItems.length,
      totalTime: Date.now() - startTime,
    },
  });
});
// endregion Main Worker Event Handler

// region Core Calculation Functions
// Pre-allocated buffer reused by getStatSum to avoid per-call allocation
const _statBuffer: number[] = [0, 0, 0, 0, 0, 0];

export function getStatSum(items: IDestinyArmor[], out: number[] = [0, 0, 0, 0, 0, 0]): number[] {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 0;
  for (const item of items) {
    out[0] += item.mobility;
    out[1] += item.resilience;
    out[2] += item.recovery;
    out[3] += item.discipline;
    out[4] += item.intellect;
    out[5] += item.strength;
  }
  return out;
}

function applyMasterworkStats(
  item: IPermutatorArmor,
  config: BuildConfiguration,
  stats: number[] = [0, 0, 0, 0, 0, 0]
): void {
  if (item.armorSystem == ArmorSystem.Armor2) {
    if (
      item.masterworkLevel == MAXIMUM_MASTERWORK_LEVEL ||
      (item.isExotic && config.assumeExoticsMasterworked) ||
      (!item.isExotic && config.assumeLegendariesMasterworked)
    ) {
      // Armor 2.0 Masterworked items give +10 to all stats
      for (let i = 0; i < 6; i++) {
        stats[i] += 2;
      }
    }
  } else if (item.armorSystem == ArmorSystem.Armor3) {
    let multiplier = item.masterworkLevel;
    if (
      (item.isExotic && config.assumeExoticsMasterworked) ||
      (!item.isExotic && config.assumeLegendariesMasterworked)
    )
      multiplier = MAXIMUM_MASTERWORK_LEVEL;
    if (multiplier == 0) return;

    // item.archetypeStats contains three stat indices. The OTHER THREE get +1 per multiplier
    for (let i = 0; i < 6; i++) {
      if (item.archetypeStats.includes(i)) continue;
      stats[i] += multiplier;
    }
  }
}

function generate_tunings(possibleImprovements: t5Improvement[]): Tuning[] {
  const impValues = possibleImprovements.map((imp) => {
    let l = [[0, 0, 0, 0, 0, 0]];

    let balancedTuning = [0, 0, 0, 0, 0, 0];
    for (let n = 0; n < 6; n++) {
      if (!imp.archetypeStats.includes(n)) balancedTuning[n] = 1;

      if (n == imp.tuningStat) continue;
      let p = [0, 0, 0, 0, 0, 0];
      p[imp.tuningStat] = 5;
      p[n] = -5;
      l.push(p);
    }
    l.push(balancedTuning);

    return l;
  });
  const tunings: Tuning[] = [];

  const seen = new Set<number>();

  function tuningKey(t: number[]): number {
    // Encode 6 values in [-30,30] as a single safe integer (base 61, offset 30)
    return (
      t[0] +
      30 +
      (t[1] + 30) * 61 +
      (t[2] + 30) * 3721 +
      (t[3] + 30) * 226981 +
      (t[4] + 30) * 13845841 +
      (t[5] + 30) * 844596301
    );
  }

  function addUniqueTuning(tuning: Tuning) {
    const key = tuningKey(tuning);
    if (!seen.has(key)) {
      tunings.push(tuning as Tuning);
      seen.add(key);
    }
  }

  if (impValues.length === 0) {
    addUniqueTuning([0, 0, 0, 0, 0, 0]);
  } else {
    function recurse(idx: number, acc: number[]) {
      if (idx === impValues.length) {
        addUniqueTuning(acc as Tuning);
        return;
      }
      for (const v of impValues[idx]) {
        const next = [
          acc[0] + v[0],
          acc[1] + v[1],
          acc[2] + v[2],
          acc[3] + v[3],
          acc[4] + v[4],
          acc[5] + v[5],
        ];
        recurse(idx + 1, next);
      }
    }
    recurse(0, [0, 0, 0, 0, 0, 0]);
  }

  return tunings;
}

// Pre-allocated reusable buffers for handlePermutation (H4)
const _distances: number[] = [0, 0, 0, 0, 0, 0];
const _tuningMax: number[] = [0, 0, 0, 0, 0, 0];
const _optionalDistances: number[] = [0, 0, 0, 0, 0, 0];

function isArtificeSlot(
  d: IPermutatorArmor,
  assumeEveryLegendaryIsArtifice: boolean,
  assumeEveryExoticIsArtifice: boolean,
  assumeClassItemIsArtifice: boolean
): boolean {
  return (
    d.perk == ArmorPerkOrSlot.SlotArtifice ||
    (d.armorSystem === ArmorSystem.Armor2 &&
      ((assumeEveryLegendaryIsArtifice && !d.isExotic) ||
        (assumeEveryExoticIsArtifice && !!d.isExotic))) ||
    (!d.isExotic &&
      d.slot == ArmorSlot.ArmorSlotClass &&
      d.armorSystem === ArmorSystem.Armor2 &&
      assumeClassItemIsArtifice)
  );
}

export function handlePermutation(
  runtime: any,
  config: BuildConfiguration,
  helmet: IPermutatorArmor,
  gauntlet: IPermutatorArmor,
  chest: IPermutatorArmor,
  leg: IPermutatorArmor,
  classItem: IPermutatorArmor,
  constantBonus: number[],
  doNotOutput: boolean,
  targetVals: number[],
  targetFixed: boolean[],
  possibleIncreaseByMod: number,
  assumeEveryLegendaryIsArtifice: boolean,
  assumeEveryExoticIsArtifice: boolean
): IPermutatorArmorSet | null {
  // H2: inline stat sum for 5 items — no array allocation
  const stats = _statBuffer;
  stats[0] =
    helmet.mobility + gauntlet.mobility + chest.mobility + leg.mobility + classItem.mobility;
  stats[1] =
    helmet.resilience +
    gauntlet.resilience +
    chest.resilience +
    leg.resilience +
    classItem.resilience;
  stats[2] =
    helmet.recovery + gauntlet.recovery + chest.recovery + leg.recovery + classItem.recovery;
  stats[3] =
    helmet.discipline +
    gauntlet.discipline +
    chest.discipline +
    leg.discipline +
    classItem.discipline;
  stats[4] =
    helmet.intellect + gauntlet.intellect + chest.intellect + leg.intellect + classItem.intellect;
  stats[5] =
    helmet.strength + gauntlet.strength + chest.strength + leg.strength + classItem.strength;
  stats[1] += !chest.isExotic && config.addConstent1Health ? 1 : 0;

  // H2: inline masterwork for 5 items — no items array
  applyMasterworkStats(helmet, config, stats);
  applyMasterworkStats(gauntlet, config, stats);
  applyMasterworkStats(chest, config, stats);
  applyMasterworkStats(leg, config, stats);
  applyMasterworkStats(classItem, config, stats);

  // snapshot base stats before adding constantBonus (needed for output only)
  const s0 = stats[0],
    s1 = stats[1],
    s2 = stats[2],
    s3 = stats[3],
    s4 = stats[4],
    s5 = stats[5];

  // fold constantBonus into stats in-place
  stats[0] += constantBonus[0];
  stats[1] += constantBonus[1];
  stats[2] += constantBonus[2];
  stats[3] += constantBonus[3];
  stats[4] += constantBonus[4];
  stats[5] += constantBonus[5];

  // early abort if fixed tiers exceeded
  for (let n: ArmorStat = 0; n < 6; n++) {
    if (targetFixed[n] && stats[n] > targetVals[n]) return null;
  }

  // H2: inline artifice count for 5 items
  const assumeClassItemIsArtifice = !!config.assumeClassItemIsArtifice;
  let availableArtificeCount = 0;
  if (
    isArtificeSlot(
      helmet,
      assumeEveryLegendaryIsArtifice,
      assumeEveryExoticIsArtifice,
      assumeClassItemIsArtifice
    )
  )
    availableArtificeCount++;
  if (
    isArtificeSlot(
      gauntlet,
      assumeEveryLegendaryIsArtifice,
      assumeEveryExoticIsArtifice,
      assumeClassItemIsArtifice
    )
  )
    availableArtificeCount++;
  if (
    isArtificeSlot(
      chest,
      assumeEveryLegendaryIsArtifice,
      assumeEveryExoticIsArtifice,
      assumeClassItemIsArtifice
    )
  )
    availableArtificeCount++;
  if (
    isArtificeSlot(
      leg,
      assumeEveryLegendaryIsArtifice,
      assumeEveryExoticIsArtifice,
      assumeClassItemIsArtifice
    )
  )
    availableArtificeCount++;
  if (
    isArtificeSlot(
      classItem,
      assumeEveryLegendaryIsArtifice,
      assumeEveryExoticIsArtifice,
      assumeClassItemIsArtifice
    )
  )
    availableArtificeCount++;

  // H4: reuse distances buffer
  const distances = _distances;
  for (let n: ArmorStat = 0; n < 6; n++) distances[n] = Math.max(0, targetVals[n] - stats[n]);

  if (config.onlyShowResultsWithNoWastedStats) {
    for (let stat: ArmorStat = 0; stat < 6; stat++) {
      const v = 10 - (stats[stat] % 10);
      distances[stat] = Math.max(distances[stat], v < 10 ? v : 0);
    }
  }

  // H2/H4: T5 improvements inlined for 5 items, reuse tuningMax buffer
  const t5Improvements: t5Improvement[] = [];
  const tuningMax = _tuningMax;
  tuningMax[0] = 0;
  tuningMax[1] = 0;
  tuningMax[2] = 0;
  tuningMax[3] = 0;
  tuningMax[4] = 0;
  tuningMax[5] = 0;

  if (config.calculateTierFiveTuning) {
    if (isT5WithTuning(helmet)) t5Improvements.push(mapItemToTuning(helmet));
    if (isT5WithTuning(gauntlet)) t5Improvements.push(mapItemToTuning(gauntlet));
    if (isT5WithTuning(chest)) t5Improvements.push(mapItemToTuning(chest));
    if (isT5WithTuning(leg)) t5Improvements.push(mapItemToTuning(leg));
    if (isT5WithTuning(classItem)) t5Improvements.push(mapItemToTuning(classItem));

    for (const t5 of t5Improvements) {
      const mask = [false, false, false, false, false, false];
      for (const s of t5.archetypeStats) if (s >= 0 && s < 6) mask[s] = true;
      const balanced: number[] = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) balanced[i] = mask[i] ? 0 : 1;
      for (let n = 0; n < 6; n++) {
        if (n === t5.tuningStat) continue;
        const p: number[] = [0, 0, 0, 0, 0, 0];
        p[t5.tuningStat] = 5;
        p[n] = -5;
        for (let i = 0; i < 6; i++) tuningMax[i] += Math.max(balanced[i], p[i]);
      }
    }
  }

  // H4: reuse optionalDistances buffer
  const optionalDistances = _optionalDistances;
  optionalDistances[0] = 0;
  optionalDistances[1] = 0;
  optionalDistances[2] = 0;
  optionalDistances[3] = 0;
  optionalDistances[4] = 0;
  optionalDistances[5] = 0;
  if (config.tryLimitWastedStats) {
    for (let stat: ArmorStat = 0; stat < 6; stat++) {
      if (
        distances[stat] === 0 &&
        !targetFixed[stat] &&
        stats[stat] < 200 &&
        stats[stat] % 10 > 0
      ) {
        optionalDistances[stat] = 10 - (stats[stat] % 10);
      }
    }
  }

  // cheap global bound check
  const distanceSum =
    distances[0] + distances[1] + distances[2] + distances[3] + distances[4] + distances[5];
  const totalOptionalDistances =
    optionalDistances[0] +
    optionalDistances[1] +
    optionalDistances[2] +
    optionalDistances[3] +
    optionalDistances[4] +
    optionalDistances[5];

  if (distanceSum > 10 * 5 + 3 * availableArtificeCount + 5 * t5Improvements.length) {
    return null;
  }

  // per-stat quick feasibility check (H3: possibleIncreaseByMod is pre-computed)
  for (let stat = 0; stat < 6; stat++) {
    const possibleIncrease = possibleIncreaseByMod + tuningMax[stat] + 3 * availableArtificeCount;
    if (possibleIncrease < distances[stat]) {
      return null;
    }
  }

  let availableTunings: Tuning[] = [[0, 0, 0, 0, 0, 0]];
  if (config.calculateTierFiveTuning) {
    availableTunings = generate_tunings(t5Improvements);
  }

  // heavy work: mod precalc
  let modResult: StatModifierPrecalc | null;
  if (distanceSum === 0 && totalOptionalDistances === 0) {
    modResult = { mods: [], tuning: [0, 0, 0, 0, 0, 0], modBonus: [0, 0, 0, 0, 0, 0] };
  } else {
    modResult = get_mods_precalc(
      stats,
      targetVals,
      config,
      distances,
      optionalDistances,
      availableArtificeCount,
      config.modOptimizationStrategy,
      availableTunings
    );
  }

  if (modResult === null) return null;

  performTierAvailabilityTesting(
    runtime,
    config,
    stats,
    targetVals,
    distances,
    availableArtificeCount,
    availableTunings
  );

  if (doNotOutput) return null;

  const usedArtifice: StatModifier[] = [];
  const usedMods: StatModifier[] = [];
  for (let mi = 0; mi < modResult.mods.length; mi++) {
    const d = modResult.mods[mi];
    if (d % 3 === 0) usedArtifice.push(d);
    else usedMods.push(d);
  }

  // Apply mods to stats for final calculation
  const finalStats = [stats[0], stats[1], stats[2], stats[3], stats[4], stats[5]];
  for (let statModifier of modResult.mods) {
    const stat = Math.floor((statModifier - 1) / 3);
    finalStats[stat] += STAT_MOD_VALUES[statModifier][1];
  }

  for (let n = 0; n < 6; n++) finalStats[n] += modResult.tuning[n];

  const waste = getWaste(finalStats);
  if (config.onlyShowResultsWithNoWastedStats && waste > 0) return null;

  // Reconstruct statsWithoutMods from snapshot (only on output path)
  const statsWithoutMods = [s0, s1, s2, s3, s4, s5];

  return createArmorSet(
    helmet,
    gauntlet,
    chest,
    leg,
    classItem,
    usedArtifice,
    usedMods,
    finalStats,
    statsWithoutMods,
    modResult.tuning
  );
}

function getStatVal(statId: ArmorStat, mods: StatModifierPrecalc, start: number) {
  return start + mods.tuning[statId] + mods.modBonus[statId];
}

// region Tier Availability Testing
const _testDistances: number[] = [0, 0, 0, 0, 0, 0];
const _zeroOptional: number[] = [0, 0, 0, 0, 0, 0];

function performTierAvailabilityTesting(
  runtime: any,
  config: BuildConfiguration,
  stats: number[],
  targetStats: number[],
  distances: number[],
  availableArtificeCount: number,
  availableTunings: Tuning[]
): void {
  for (let stat = 0; stat < 6; stat++) {
    const minStat = stats[stat];
    if (minStat >= 200) continue;

    // Inline minimumTuning — avoid .map().reduce() allocation
    let minimumTuning = 0;
    for (let t = 0; t < availableTunings.length; t++) {
      const v = availableTunings[t][stat];
      if (v < minimumTuning) minimumTuning = v;
    }

    const tmpTunings = availableTunings.slice().sort((a, b) => {
      const aVal = a[stat];
      const bVal = b[stat];
      const aNeg = aVal < 0;
      const bNeg = bVal < 0;
      if (aNeg && bNeg) {
        return bVal - aVal;
      } else if (!aNeg && !bNeg) {
        return aVal - bVal;
      } else {
        return aNeg ? 1 : -1;
      }
    });

    if (runtime.maximumPossibleTiers[stat] < minStat + minimumTuning) {
      runtime.maximumPossibleTiers[stat] = minStat + minimumTuning;
    }

    const minTier = config.minimumStatTiers[stat as ArmorStat].value * 10;

    // Binary search to find maximum possible value
    let low = Math.max(runtime.maximumPossibleTiers[stat], minTier);
    let high = 200;

    // Reuse testDistances buffer — copy distances once, restore stat slot after loop
    for (let i = 0; i < 6; i++) _testDistances[i] = distances[i];

    while (low <= high) {
      const mid = Math.min(200, Math.ceil((low + high) / 2));

      if (minStat >= mid && minimumTuning == 0) {
        low = mid + 1;
        continue;
      }

      _testDistances[stat] = Math.max(0, mid - minStat);

      const mods = get_mods_precalc(
        stats,
        targetStats,
        config,
        _testDistances,
        _zeroOptional,
        availableArtificeCount,
        ModOptimizationStrategy.None,
        tmpTunings
      );

      if (mods != null) {
        let val = getStatVal(stat, mods, minStat);
        runtime.maximumPossibleTiers[stat] = Math.max(val, runtime.maximumPossibleTiers[stat]);
        low = Math.max(runtime.maximumPossibleTiers[stat], mid) + 1;
      } else {
        high = mid - 1;
      }
    }

    // Verify the final value
    if (low > runtime.maximumPossibleTiers[stat] && low <= 200) {
      _testDistances[stat] = Math.max(low - minStat, 0);
      const mods = get_mods_precalc(
        stats,
        targetStats,
        config,
        _testDistances,
        _zeroOptional,
        availableArtificeCount,
        ModOptimizationStrategy.None,
        tmpTunings
      );
      if (mods != null) {
        runtime.maximumPossibleTiers[stat] = low;
        for (let otherStat = stat + 1; otherStat < 6; otherStat++) {
          runtime.maximumPossibleTiers[otherStat] = Math.max(
            getStatVal(otherStat, mods, stats[otherStat]),
            runtime.maximumPossibleTiers[otherStat]
          );
        }
      }
    }

    // Restore the original distance for this stat
    _testDistances[stat] = distances[stat];
  }
}

// region Mod Calculation Functions
// Pre-allocated buffers for tuning-stats recursion (M2)
const _tuningNewStats: number[] = [0, 0, 0, 0, 0, 0];
const _tuningNewDists: number[] = [0, 0, 0, 0, 0, 0];

function get_mods_recursive(
  currentStats: number[],
  targetStats: number[],

  distances_to_check: number[],
  availableTunings: Tuning[],
  statIdx: number,
  availableArtificeCount: number,
  availableMajorMods: number,
  availableMods: number,
  resultAccum: number[][]
): boolean {
  if (statIdx > 5) {
    // Now we have a valid set of mods and tunings, but we still have to check -5 values. This will happen in innermost loop

    // 2.1 If there is any stat where (currentStat - tuningValue) >= target value, then return
    outer: for (let tuning of availableTunings) {
      for (let i = 0; i < 6; i++) {
        if (tuning[i] >= 0) continue;
        if (currentStats[i] + tuning[i] < targetStats[i]) continue outer;
      }
      resultAccum.push(tuning);
      return true;
    }

    // 2.2 if we still have a few mods left, we can simply call the recursion again, but with the new "temp" stats
    if (availableMods > 0) {
      for (let tuning of availableTunings) {
        for (let i = 0; i < 6; i++) {
          _tuningNewStats[i] = currentStats[i] + tuning[i];
          _tuningNewDists[i] = Math.max(0, targetStats[i] - _tuningNewStats[i]);
        }
        if (
          get_mods_recursive(
            _tuningNewStats,
            targetStats,
            _tuningNewDists,
            [],
            0,
            availableArtificeCount,
            availableMajorMods,
            availableMods,
            resultAccum
          )
        ) {
          resultAccum.push(tuning);
          return true;
        }
      }
    }

    return false;
  }

  let maxValueOfAvailableTunings = 0;
  for (let ti = 0; ti < availableTunings.length; ti++) {
    const v = availableTunings[ti][statIdx];
    if (v > maxValueOfAvailableTunings) maxValueOfAvailableTunings = v;
  }

  const distance = distances_to_check[statIdx];

  const precalculatedMods = precalculatedTuningModCombinations[distance] || [[0, 0, 0, 0, 0, 0]];

  for (let mi = 0; mi < precalculatedMods.length; mi++) {
    const mod = precalculatedMods[mi];
    if (
      mod[0] > availableArtificeCount ||
      mod[2] > availableMajorMods ||
      mod[2] + mod[1] > availableMods ||
      mod[3] > maxValueOfAvailableTunings
    )
      continue;

    const totalMods = Math.max(0, availableMods - mod[1] - mod[2]);
    const majorMods = Math.min(totalMods, Math.max(0, availableMajorMods - mod[2]));
    const artifice = Math.max(0, availableArtificeCount - mod[0]);

    let selectedTuningsInner = availableTunings;
    const requiredTuningCount = mod[4];
    const requiredTuningValue = mod[3];
    if (requiredTuningCount > 0) {
      selectedTuningsInner = availableTunings.filter(
        (tuning) => tuning[statIdx] >= requiredTuningValue
      );
      if (selectedTuningsInner.length == 0) {
        continue;
      }
    }

    if (
      get_mods_recursive(
        currentStats,
        targetStats,
        distances_to_check,
        selectedTuningsInner,
        statIdx + 1,
        artifice,
        majorMods,
        totalMods,
        resultAccum
      )
    ) {
      resultAccum.push(mod);
      return true;
    }
  }
  return false;
}

type StatModifierPrecalc = {
  mods: StatModifier[];
  modBonus: number[];
  tuning: Tuning;
};

function get_mods_precalc(
  currentStats: number[],
  targetStats: number[],
  config: BuildConfiguration,
  distances: number[],
  optionalDistances: number[],
  availableArtificeCount: number,
  optimize: ModOptimizationStrategy = ModOptimizationStrategy.None,
  availableTunings: Tuning[]
): StatModifierPrecalc | null {
  const totalDistance =
    distances[0] + distances[1] + distances[2] + distances[3] + distances[4] + distances[5];
  if (totalDistance > 50 + 25) return null;

  const resultAccum: number[][] = [];
  const found = get_mods_recursive(
    currentStats,
    targetStats,
    distances,
    availableTunings,
    0,
    availableArtificeCount,
    config.statModLimits.maxMajorMods,
    config.statModLimits.maxMods,
    resultAccum
  );

  if (!found) return null;

  // resultAccum is in reverse order: [tuning, stat5_mod, ..., stat0_mod]
  const usedMods = [];
  const modBonus = [0, 0, 0, 0, 0, 0];
  // Iterate in reverse to get stat0..stat5, skip index 0 which is the tuning
  for (let ri = resultAccum.length - 1; ri >= 1; ri--) {
    const statIndex = resultAccum.length - 1 - ri;
    const mod = resultAccum[ri];
    for (let n = 0; n < mod[1]; n++) {
      usedMods.push(1 + 3 * statIndex);
      modBonus[statIndex] += 5;
    }
    for (let n = 0; n < mod[2]; n++) {
      usedMods.push(2 + 3 * statIndex);
      modBonus[statIndex] += 10;
    }
    for (let n = 0; n < mod[0]; n++) {
      usedMods.push(3 + 3 * statIndex);
      modBonus[statIndex] += 3;
    }
  }

  return {
    mods: usedMods,
    modBonus: modBonus,
    tuning: resultAccum[0] as Tuning,
  };
}

export function getSkillTier(stats: number[]) {
  return (
    Math.floor(Math.min(200, stats[ArmorStat.StatWeapon]) / 10) +
    Math.floor(Math.min(200, stats[ArmorStat.StatHealth]) / 10) +
    Math.floor(Math.min(200, stats[ArmorStat.StatClass]) / 10) +
    Math.floor(Math.min(200, stats[ArmorStat.StatGrenade]) / 10) +
    Math.floor(Math.min(200, stats[ArmorStat.StatSuper]) / 10) +
    Math.floor(Math.min(200, stats[ArmorStat.StatMelee]) / 10)
  );
}

export function getWaste(stats: number[]) {
  return (
    Math.max(0, stats[ArmorStat.StatWeapon] - 200) +
    Math.max(0, stats[ArmorStat.StatHealth] - 200) +
    Math.max(0, stats[ArmorStat.StatClass] - 200) +
    Math.max(0, stats[ArmorStat.StatGrenade] - 200) +
    Math.max(0, stats[ArmorStat.StatSuper] - 200) +
    Math.max(0, stats[ArmorStat.StatMelee] - 200)
  );
}
// endregion Core Calculation Functions
