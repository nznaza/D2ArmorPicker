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
import {
  FORCE_USE_ANY_EXOTIC,
  FORCE_USE_NO_EXOTIC,
  MAXIMUM_MASTERWORK_LEVEL,
} from "../data/constants";
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
import {
  IPermutatorArmorSet,
  Tuning,
  createArmorSet,
  isIPermutatorArmorSet,
} from "../data/types/IPermutatorArmorSet";
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
function checkSlots(
  config: BuildConfiguration,
  requiredPerkSlotCounts: Map<number, number>,
  helmet: IPermutatorArmor,
  gauntlet: IPermutatorArmor,
  chest: IPermutatorArmor,
  leg: IPermutatorArmor,
  classItem: IPermutatorArmor
): boolean {
  let requirements = new Map(requiredPerkSlotCounts);
  const items = [helmet, gauntlet, chest, leg, classItem];

  for (let item of items) {
    let effectivePerk = item.perk;

    if (item.armorSystem === ArmorSystem.Armor2) {
      if (
        (item.isExotic && config.assumeEveryExoticIsArtifice) ||
        (!item.isExotic &&
          (config.assumeEveryLegendaryIsArtifice ||
            (item.slot == ArmorSlot.ArmorSlotClass && config.assumeClassItemIsArtifice)))
      ) {
        effectivePerk = ArmorPerkOrSlot.SlotArtifice;
      }
    }

    requirements.set(effectivePerk, (requirements.get(effectivePerk) ?? 0) - 1);
    if (item.gearSetHash != null)
      requirements.set(item.gearSetHash, (requirements.get(item.gearSetHash) ?? 0) - 1);
  }

  let SlotRequirements = 0;
  for (let [key] of requirements) {
    if (key == ArmorPerkOrSlot.Any || key == ArmorPerkOrSlot.None) continue;
    SlotRequirements += Math.max(0, requirements.get(key) ?? 0);
  }

  return SlotRequirements === 0;
}

function computeEnabledModBonuses(config: BuildConfiguration) {
  const enabledModBonuses = [0, 0, 0, 0, 0, 0];
  // Apply configurated mods to the stat value
  // Apply mods
  for (const mod of config.enabledMods) {
    for (const bonus of ModInformation[mod].bonus) {
      var statId =
        bonus.stat == SpecialArmorStat.ClassAbilityRegenerationStat
          ? [1, 0, 2][config.characterClass]
          : bonus.stat;
      enabledModBonuses[statId] += bonus.value;
    }
  }
  return enabledModBonuses;
}

function calculateRequiredPerkCounts(config: BuildConfiguration) {
  let constantPerkRequirement = new Map<ArmorPerkOrSlot, number>();

  for (let [key] of constantPerkRequirement) {
    constantPerkRequirement.set(key, 0);
  }

  for (const requirement of config.armorRequirements) {
    if ("perk" in requirement) {
      let perk = requirement.perk;

      const e = Object.entries(ArmorPerkSocketHashes).find(([, value]) => value == perk);
      if (e) perk = Number.parseInt(e[0]) as any as ArmorPerkOrSlot;

      if (perk != ArmorPerkOrSlot.Any && perk != ArmorPerkOrSlot.None) {
        constantPerkRequirement.set(perk, (constantPerkRequirement.get(perk) ?? 0) + 1);
      }
    } else if ("gearSetHash" in requirement) {
      // Gear set requirement
      constantPerkRequirement.set(
        requirement.gearSetHash,
        (constantPerkRequirement.get(requirement.gearSetHash) ?? 0) + 1
      );
    }
  }
  return constantPerkRequirement;
}

function* generateArmorCombinations(
  helmets: IPermutatorArmor[],
  gauntlets: IPermutatorArmor[],
  chests: IPermutatorArmor[],
  legs: IPermutatorArmor[],
  classItems: IPermutatorArmor[],
  yieldExoticCombinations: boolean,
  yieldAllLegendary: boolean
) {
  const legendaryHelmets = helmets.filter((h) => !h.isExotic);
  const legendaryGauntlets = gauntlets.filter((g) => !g.isExotic);
  const legendaryChests = chests.filter((c) => !c.isExotic);
  const legendaryLegs = legs.filter((l) => !l.isExotic);
  const legendaryClassItems = classItems.filter((d) => !d.isExotic);

  // Yield combinations with exactly one exotic item and legendaries in all other slots
  if (yieldExoticCombinations) {
    const exoticHelmets = helmets.filter((h) => h.isExotic);
    const exoticGauntlets = gauntlets.filter((g) => g.isExotic);
    const exoticChests = chests.filter((c) => c.isExotic);
    const exoticLegs = legs.filter((l) => l.isExotic);
    const exoticClassItems = classItems.filter((d) => d.isExotic);

    for (const helmet of exoticHelmets)
      for (const gauntlet of legendaryGauntlets)
        for (const chest of legendaryChests)
          for (const leg of legendaryLegs)
            for (const classItem of legendaryClassItems)
              yield [helmet, gauntlet, chest, leg, classItem] as const;

    for (const helmet of legendaryHelmets)
      for (const gauntlet of exoticGauntlets)
        for (const chest of legendaryChests)
          for (const leg of legendaryLegs)
            for (const classItem of legendaryClassItems)
              yield [helmet, gauntlet, chest, leg, classItem] as const;

    for (const helmet of legendaryHelmets)
      for (const gauntlet of legendaryGauntlets)
        for (const chest of exoticChests)
          for (const leg of legendaryLegs)
            for (const classItem of legendaryClassItems)
              yield [helmet, gauntlet, chest, leg, classItem] as const;

    for (const helmet of legendaryHelmets)
      for (const gauntlet of legendaryGauntlets)
        for (const chest of legendaryChests)
          for (const leg of exoticLegs)
            for (const classItem of legendaryClassItems)
              yield [helmet, gauntlet, chest, leg, classItem] as const;

    for (const helmet of legendaryHelmets)
      for (const gauntlet of legendaryGauntlets)
        for (const chest of legendaryChests)
          for (const leg of legendaryLegs)
            for (const classItem of exoticClassItems)
              yield [helmet, gauntlet, chest, leg, classItem] as const;
  }

  // Yield all-legendary combinations
  if (yieldAllLegendary) {
    for (const helmet of legendaryHelmets)
      for (const gauntlet of legendaryGauntlets)
        for (const chest of legendaryChests)
          for (const leg of legendaryLegs)
            for (const classItem of legendaryClassItems)
              yield [helmet, gauntlet, chest, leg, classItem] as const;
  }
}

function estimateCombinationsToBeChecked(
  helmets: IPermutatorArmor[],
  gauntlets: IPermutatorArmor[],
  chests: IPermutatorArmor[],
  legs: IPermutatorArmor[],
  classItems: IPermutatorArmor[],
  yieldExoticCombinations: boolean,
  yieldAllLegendary: boolean
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
  const exoticClassItemCount = classItems.filter((d) => d.isExotic).length;
  const legendaryClassItemCount = classItems.length - exoticClassItemCount;

  if (yieldExoticCombinations) {
    totalCalculations +=
      exoticHelmets *
      legendaryGauntlets *
      legendaryChests *
      legendaryLegs *
      legendaryClassItemCount;
    totalCalculations +=
      legendaryHelmets *
      exoticGauntlets *
      legendaryChests *
      legendaryLegs *
      legendaryClassItemCount;
    totalCalculations +=
      legendaryHelmets *
      legendaryGauntlets *
      exoticChests *
      legendaryLegs *
      legendaryClassItemCount;
    totalCalculations +=
      legendaryHelmets *
      legendaryGauntlets *
      legendaryChests *
      exoticLegs *
      legendaryClassItemCount;
    totalCalculations +=
      legendaryHelmets *
      legendaryGauntlets *
      legendaryChests *
      legendaryLegs *
      exoticClassItemCount;
  }

  if (yieldAllLegendary) {
    totalCalculations +=
      legendaryHelmets *
      legendaryGauntlets *
      legendaryChests *
      legendaryLegs *
      legendaryClassItemCount;
  }

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

  let helmets = items
    .filter((i) => i.slot == ArmorSlot.ArmorSlotHelmet)
    .filter((k) => {
      return (
        !config.useFotlArmor ||
        [
          199733460, // titan masq
          2545426109, // warlock
          3224066584, // hunter
          2390807586, // titan new fotl
          2462335932, // hunter new fotl
          4095816113, // warlock new fotl
        ].indexOf(k.hash) > -1
      );
    });
  let gauntlets = items.filter((i) => i.slot == ArmorSlot.ArmorSlotGauntlet);
  let chests = items.filter((i) => i.slot == ArmorSlot.ArmorSlotChest);
  let legs = items.filter((i) => i.slot == ArmorSlot.ArmorSlotLegs);
  let classItems = items.filter((i) => i.slot == ArmorSlot.ArmorSlotClass);

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

  classItems = classItems.filter(
    (item, index, self) =>
      index ===
      self.findIndex(
        (i) =>
          i.mobility === item.mobility &&
          i.resilience === item.resilience &&
          i.recovery === item.recovery &&
          i.discipline === item.discipline &&
          i.intellect === item.intellect &&
          i.strength === item.strength &&
          i.isExotic === item.isExotic &&
          //i.tier >= (item.tier ?? 0) &&
          ((i.tier < 5 && item.tier < 5) || i.tuningStat == item.tuningStat) &&
          ((i.isExotic && config.assumeExoticsMasterworked) ||
            (!i.isExotic && config.assumeLegendariesMasterworked) ||
            // If there is any stat fixed, we check if the masterwork level is the same as the first item
            (anyStatFixed && i.masterworkLevel === item.masterworkLevel) ||
            // If there is no stat fixed, then we just use the masterwork level of the first item.
            // As it is already sorted descending, we can just check if the masterwork level is the same
            !anyStatFixed) &&
          (doesNotRequireArmorPerks || (i.perk === item.perk && i.gearSetHash === item.gearSetHash))
      )
  );
  //*/

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

  const enabledModBonuses = computeEnabledModBonuses(config);
  const requiredPerkSlotCounts = calculateRequiredPerkCounts(config);

  let results: IPermutatorArmorSet[] = [];
  let resultsLength = 0;

  let listedResults = 0;
  let totalResults = 0;
  let doNotOutput = false;

  // Determine exotic combination mode from selectedExotics:
  // - FORCE_USE_ANY_EXOTIC or specific exotic hash(es): yield only 1-exotic combinations
  // - FORCE_USE_NO_EXOTIC: yield only all-legendary combinations
  // - Empty array (no selection): yield both
  const hasForceNoExotic = config.selectedExotics[0] === FORCE_USE_NO_EXOTIC;
  const hasForceAnyExotic = config.selectedExotics[0] === FORCE_USE_ANY_EXOTIC;
  const hasSpecificExotic =
    config.selectedExotics.length > 0 && !hasForceNoExotic && !hasForceAnyExotic;
  const noSelection = config.selectedExotics.length === 0;

  const yieldExoticCombinations = hasForceAnyExotic || hasSpecificExotic || noSelection;
  const yieldAllLegendary = hasForceNoExotic || noSelection;

  let estimatedCalculations = estimateCombinationsToBeChecked(
    helmets,
    gauntlets,
    chests,
    legs,
    classItems,
    yieldExoticCombinations,
    yieldAllLegendary
  );

  let checkedCalculations = 0;
  let lastProgressReportTime = 0;

  // define the delay; it can be 75ms if the estimated calculations are low
  // if the estimated calculations >= 1e6, then we will use 125ms
  let progressBarDelay = estimatedCalculations >= 1e6 ? 500 : 125;

  for (let [helmet, gauntlet, chest, leg, classItem] of generateArmorCombinations(
    helmets,
    gauntlets,
    chests,
    legs,
    classItems,
    yieldExoticCombinations,
    yieldAllLegendary
  )) {
    checkedCalculations++;
    if (!checkSlots(config, requiredPerkSlotCounts, helmet, gauntlet, chest, leg, classItem))
      continue;

    const result = handlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      classItem,
      enabledModBonuses,
      doNotOutput
    );
    // Only add 50k to the list if the setting is activated.
    // We will still calculate the rest so that we get accurate results for the runtime values
    if (isIPermutatorArmorSet(result)) {
      totalResults++;

      results.push(result);
      resultsLength++;
      listedResults++;
      doNotOutput =
        doNotOutput ||
        (config.limitParsedResults && listedResults >= 3e4 / threadSplit.count) ||
        listedResults >= 1e6 / threadSplit.count;
    }

    if (resultsLength >= 5000) {
      // @ts-ignore
      postMessage({ runtime, results, done: false, checkedCalculations, estimatedCalculations });
      results = [];
      resultsLength = 0;
    } else if (
      resultsLength > 100 &&
      lastProgressReportTime + progressBarDelay < performance.now()
    ) {
      lastProgressReportTime = performance.now();
      postMessage({
        checkedCalculations,
        estimatedCalculations,
        reachableTiers: runtime.maximumPossibleTiers,
      });
    }
  }
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
export function getStatSum(
  items: IDestinyArmor[]
): [number, number, number, number, number, number] {
  let mob = 0,
    res = 0,
    rec = 0,
    dis = 0,
    int_ = 0,
    str = 0;
  for (const item of items) {
    mob += item.mobility;
    res += item.resilience;
    rec += item.recovery;
    dis += item.discipline;
    int_ += item.intellect;
    str += item.strength;
  }
  return [mob, res, rec, dis, int_, str];
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

  const seen = new Set<string>();

  function addUniqueTuning(tuning: Tuning) {
    const key = tuning.join(",");
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

export function handlePermutation(
  runtime: any,
  config: BuildConfiguration,
  helmet: IPermutatorArmor,
  gauntlet: IPermutatorArmor,
  chest: IPermutatorArmor,
  leg: IPermutatorArmor,
  classItem: IPermutatorArmor,
  enabledModBonuses: number[],
  doNotOutput = false
): never[] | IPermutatorArmorSet | null {
  const items = [helmet, gauntlet, chest, leg, classItem];

  // base stats and apply constant health tweak
  const baseStats = getStatSum(items);
  baseStats[1] += !chest.isExotic && config.addConstent1Health ? 1 : 0;

  // apply masterwork effects to baseStats (assumed idempotent)
  for (const it of items) applyMasterworkStats(it, config, baseStats);

  // precompute targets and fixed flags
  const targetVals: number[] = new Array(6);
  const targetFixed: boolean[] = new Array(6);
  for (let n: ArmorStat = 0; n < 6; n++) {
    targetVals[n] = (config.minimumStatTiers[n].value || 0) * 10;
    targetFixed[n] = !!config.minimumStatTiers[n].fixed;
  }

  // stats without mods, and stats with mod bonuses
  const statsWithoutMods: number[] = [...baseStats];
  const stats: number[] = baseStats.map((s, i) => s + (enabledModBonuses[i] || 0));

  // early abort if fixed tiers exceeded
  for (let n: ArmorStat = 0; n < 6; n++) {
    if (targetFixed[n] && stats[n] > targetVals[n]) return null;
  }

  // count available artifice slots
  const assumeEveryLegendaryIsArtifice = !!config.assumeEveryLegendaryIsArtifice;
  const assumeEveryExoticIsArtifice = !!config.assumeEveryExoticIsArtifice;
  let artificeCount = 0;
  for (const d of items) {
    if (
      d.perk == ArmorPerkOrSlot.SlotArtifice ||
      (d.armorSystem === ArmorSystem.Armor2 &&
        ((assumeEveryLegendaryIsArtifice && !d.isExotic) ||
          (assumeEveryExoticIsArtifice && d.isExotic)))
    ) {
      artificeCount++;
    }
  }

  // distances to target
  const distances: number[] = new Array(6);
  for (let n: ArmorStat = 0; n < 6; n++) distances[n] = Math.max(0, targetVals[n] - stats[n]);

  if (config.onlyShowResultsWithNoWastedStats) {
    for (let stat: ArmorStat = 0; stat < 6; stat++) {
      const v = 10 - (stats[stat] % 10);
      distances[stat] = Math.max(distances[stat], v < 10 ? v : 0);
    }
  }

  // T5 tuning improvements (all items including class item)
  const t5Improvements: t5Improvement[] = [];
  const tuningMax: number[] = [0, 0, 0, 0, 0, 0];

  if (config.calculateTierFiveTuning) {
    for (const item of items) {
      if (isT5WithTuning(item)) t5Improvements.push(mapItemToTuning(item));
    }

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

  // optional distances for waste limiting
  const optionalDistances = [0, 0, 0, 0, 0, 0];
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

  if (distanceSum > 10 * 5 + 3 * artificeCount + 5 * t5Improvements.length) {
    return null;
  }

  // mod caps
  const maxMajorMods = config.statModLimits?.maxMajorMods || 0;
  const maxMods = config.statModLimits?.maxMods || 0;
  const possibleIncreaseByMod = 10 * maxMajorMods + 5 * Math.max(0, maxMods - maxMajorMods);

  // per-stat quick feasibility check
  for (let stat = 0; stat < 6; stat++) {
    if (possibleIncreaseByMod + tuningMax[stat] + 3 * artificeCount < distances[stat]) {
      return null;
    }
  }

  let availableTunings: Tuning[] = [[0, 0, 0, 0, 0, 0]];
  if (config.calculateTierFiveTuning) {
    availableTunings = generate_tunings(t5Improvements);
  }

  // heavy work: mod precalc
  let result: StatModifierPrecalc | null;
  if (distanceSum === 0 && totalOptionalDistances === 0) {
    result = { mods: [], tuning: [0, 0, 0, 0, 0, 0], modBonus: [0, 0, 0, 0, 0, 0] };
  } else {
    result = get_mods_precalc(
      stats,
      targetVals,
      config,
      distances,
      optionalDistances,
      artificeCount,
      config.modOptimizationStrategy,
      availableTunings
    );
  }

  if (result === null) return null;

  performTierAvailabilityTesting(
    runtime,
    config,
    stats,
    targetVals,
    distances,
    artificeCount,
    availableTunings
  );

  return tryCreateArmorSetWithClassItem(
    runtime,
    config,
    helmet,
    gauntlet,
    chest,
    leg,
    classItem,
    result,
    stats,
    statsWithoutMods,
    distances,
    artificeCount,
    doNotOutput
  );
}

function getStatVal(statId: ArmorStat, mods: StatModifierPrecalc, start: number) {
  return start + mods.tuning[statId] + mods.modBonus[statId];
}

// region Tier Availability Testing
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
    const minimumTuning = availableTunings.map((t) => t[stat]).reduce((a, b) => Math.min(a, b), 0);
    const minStat = stats[stat];

    const tmpTunings = availableTunings.slice().sort((a, b) => {
      const aVal = a[stat];
      const bVal = b[stat];
      const aNeg = aVal < 0;
      const bNeg = bVal < 0;
      if (aNeg && bNeg) {
        // Both negative: sort descending
        return bVal - aVal;
      } else if (!aNeg && !bNeg) {
        // Both zero or positive: sort ascending
        return aVal - bVal;
      } else {
        // Zero/positive first, then negative
        return aNeg ? 1 : -1;
      }
    });

    if (runtime.maximumPossibleTiers[stat] < stats[stat] + minimumTuning) {
      runtime.maximumPossibleTiers[stat] = stats[stat] + minimumTuning;
    }
    //const tuningsWithoutNegatives = tmpTunings.filter((t) => t[stat] >= 0);

    if (minStat >= 200) continue; // Already at max value, no need to test

    const minTier = config.minimumStatTiers[stat as ArmorStat].value * 10;

    // Binary search to find maximum possible value
    let low = Math.max(runtime.maximumPossibleTiers[stat], minTier);
    let high = 200;

    while (low <= high) {
      // Try middle value, rounded to nearest 10 for tier optimization
      const mid = Math.min(200, Math.ceil((low + high) / 2));

      if (minStat >= mid && minimumTuning == 0) {
        // We can already reach this value naturally
        low = mid + 1;
        continue;
      }

      // Calculate distance needed to reach this value
      const testDistances = [...distances];
      testDistances[stat] = Math.max(0, mid - minStat);

      // Check if this value is achievable with mods
      const mods = get_mods_precalc(
        stats,
        targetStats,
        config,
        testDistances,
        [0, 0, 0, 0, 0, 0],
        availableArtificeCount,
        ModOptimizationStrategy.None,
        tmpTunings
      );

      if (mods != null) {
        let val = getStatVal(stat, mods, minStat);
        runtime.maximumPossibleTiers[stat] = Math.max(val, runtime.maximumPossibleTiers[stat]);
        low = Math.max(runtime.maximumPossibleTiers[stat], mid) + 1;
      } else {
        // This value is not achievable, try lower
        high = mid - 1;
      }
    }

    // Verify the final value
    if (low > runtime.maximumPossibleTiers[stat] && low <= 200) {
      const testDistances = [...distances];
      testDistances[stat] = Math.max(low - minStat, 0);
      const mods = get_mods_precalc(
        stats,
        targetStats,
        config,
        testDistances,
        [0, 0, 0, 0, 0, 0],
        availableArtificeCount,
        ModOptimizationStrategy.None,
        tmpTunings
      );
      if (mods != null) {
        runtime.maximumPossibleTiers[stat] = low;
        // also set the other stats
        // This may reduce the amount of required calculations for the stats that will be checked later on
        for (let otherStat = stat + 1; otherStat < 6; otherStat++) {
          runtime.maximumPossibleTiers[otherStat] = Math.max(
            getStatVal(otherStat, mods, stats[otherStat]),
            runtime.maximumPossibleTiers[otherStat]
          );
        }
      }
    }
  }
}

function tryCreateArmorSetWithClassItem(
  runtime: any,
  config: BuildConfiguration,
  helmet: IPermutatorArmor,
  gauntlet: IPermutatorArmor,
  chest: IPermutatorArmor,
  leg: IPermutatorArmor,
  classItem: IPermutatorArmor,
  result: StatModifierPrecalc,
  adjustedStats: number[],
  statsWithoutMods: number[],
  newDistances: number[],
  availableArtificeCount: number,
  doNotOutput: boolean
): IPermutatorArmorSet | never[] {
  if (doNotOutput) return [];

  const usedArtifice = result.mods.filter((d: StatModifier) => 0 == d % 3);
  const usedMods = result.mods.filter((d: StatModifier) => 0 != d % 3);

  // Apply mods to stats for final calculation
  const finalStats = [...adjustedStats];
  for (let statModifier of result.mods) {
    const stat = Math.floor((statModifier - 1) / 3);
    finalStats[stat] += STAT_MOD_VALUES[statModifier][1];
  }

  for (let n = 0; n < 6; n++) finalStats[n] += result.tuning[n];

  const waste1 = getWaste(finalStats);
  if (config.onlyShowResultsWithNoWastedStats && waste1 > 0) return [];

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
    result.tuning
  );
}

// region Mod Calculation Functions
function get_mods_recursive(
  currentStats: number[],
  targetStats: number[],

  distances_to_check: number[],
  availableTunings: Tuning[],
  statIdx: number,
  availableArtificeCount: number,
  availableMajorMods: number,
  availableMods: number
): number[][] | null {
  if (statIdx > 5) {
    // Now we have a valid set of mods and tunings, but we still have to check -5 values. This will happen in innermost loop
    // statIdx is no longer useful here

    // 1. If there is any tuning with no negative in any value, then return []
    //    if (availableTunings.some(tuning => tuning.every(v => v >= 0))) {
    //      return [];
    //    }

    // Now there are only tunings with negative values left.
    // 2.1 If there is any stat where (currentStat - tuningValue) >= target value, then return
    const validTuning = availableTunings.find((tuning) => {
      for (let i = 0; i < 6; i++) {
        if (tuning[i] >= 0) continue;
        if (currentStats[i] + tuning[i] < targetStats[i]) return false;
      }
      return true;
    });
    if (validTuning) {
      return [validTuning];
    }

    // 2.2 if we still have a few mods left, we can simply call the recursion again, but with the new "temp" stats
    if (availableMods > 0) {
      for (let tuning of availableTunings) {
        const newStats = currentStats.map((s, i) => s + tuning[i]);
        const newDists = distances_to_check.map((d, i) =>
          Math.max(0, targetStats[i] - newStats[i])
        );
        const otherMods = get_mods_recursive(
          newStats,
          targetStats,
          newDists,
          [],
          0,
          availableArtificeCount,
          availableMajorMods,
          availableMods
        );
        if (otherMods !== null) {
          return [...otherMods, tuning];
        }
      }
    }

    return null;
  }

  const maxValueOfAvailableTunings = availableTunings.reduce(
    (max, tuning) => Math.max(max, tuning[statIdx]),
    0
  );

  const distance = distances_to_check[statIdx];

  //let precalculatedMods = precalculatedModCombinations[distance] || [[0, 0, 0, 0, 0, 0]];
  let precalculatedMods = precalculatedTuningModCombinations[distance] || [[0, 0, 0, 0, 0, 0]];
  precalculatedMods = precalculatedMods.filter(
    (mod) =>
      mod[0] <= availableArtificeCount &&
      mod[2] <= availableMajorMods &&
      mod[2] + mod[1] <= availableMods &&
      mod[3] <= maxValueOfAvailableTunings
  );

  if (precalculatedMods.length == 0) {
    return null;
  }

  for (const pickedMod of precalculatedMods) {
    const totalMods = Math.max(0, availableMods - pickedMod[1] - pickedMod[2]);
    const majorMods = Math.min(totalMods, Math.max(0, availableMajorMods - pickedMod[2]));
    const artifice = Math.max(0, availableArtificeCount - pickedMod[0]);

    let selectedTuningsInner = availableTunings;
    const requiredTuningCount = pickedMod[4];
    const requiredTuningValue = pickedMod[3];
    if (requiredTuningCount > 0) {
      selectedTuningsInner = availableTunings.filter(
        (tuning) => tuning[statIdx] >= requiredTuningValue
      );
      if (selectedTuningsInner.length == 0) {
        continue;
        // return null; // we could also return, if the table is sorted ascending to tuningCount
      }
    }

    const otherMods = get_mods_recursive(
      currentStats,
      targetStats,
      distances_to_check, //.slice(1),
      selectedTuningsInner,
      statIdx + 1,
      artifice,
      majorMods,
      totalMods
    );
    if (otherMods !== null) {
      return [pickedMod, ...otherMods];
    }
  }
  return null;
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

  if (totalDistance == 0 && optionalDistances.every((d) => d == 0)) {
    // no mods needed, return empty array
    return { mods: [], tuning: [0, 0, 0, 0, 0, 0], modBonus: [0, 0, 0, 0, 0, 0] };
  }

  let pickedMods = get_mods_recursive(
    currentStats,
    targetStats,
    distances,
    availableTunings,
    0,
    availableArtificeCount,
    config.statModLimits.maxMajorMods,
    config.statModLimits.maxMods
  );

  if (pickedMods === null) return null;

  const usedMods = [];
  const modBonus = [0, 0, 0, 0, 0, 0];
  // The last entry is always the tuning
  for (let i = 0; i < pickedMods.length - 1; i++) {
    for (let n = 0; n < pickedMods[i][1]; n++) {
      usedMods.push(1 + 3 * i);
      modBonus[i] += 5;
    }
    for (let n = 0; n < pickedMods[i][2]; n++) {
      usedMods.push(2 + 3 * i);
      modBonus[i] += 10;
    }
    for (let n = 0; n < pickedMods[i][0]; n++) {
      usedMods.push(3 + 3 * i);
      modBonus[i] += 3;
    }
  }

  return {
    mods: usedMods,
    modBonus: modBonus,
    tuning: pickedMods[pickedMods.length - 1] as Tuning,
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
