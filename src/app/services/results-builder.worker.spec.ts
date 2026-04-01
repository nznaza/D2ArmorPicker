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

import {
  getSkillTier,
  getWaste,
  handlePermutation,
  applyMasterworkStats,
  isArtificeNonClass,
} from "./results-builder.worker";
import { DestinyClass, TierType } from "bungie-api-ts/destiny2";
import { ArmorSlot } from "../data/enum/armor-slot";
import {
  ArmorPerkOrSlot,
  ArmorStat,
  ARMORSTAT_ORDER,
  STAT_MOD_VALUES,
  StatModifier,
} from "../data/enum/armor-stat";
import { BuildConfiguration } from "../data/buildConfiguration";
import { InventoryArmorSource } from "../data/types/IInventoryArmor";
import { IPermutatorArmor } from "../data/types/IPermutatorArmor";
import { IPermutatorArmorSet } from "../data/types/IPermutatorArmorSet";
import { ArmorSystem } from "../data/types/IManifestArmor";
import {
  ResultDefinition,
  ResultItem,
} from "../components/authenticated-v2/results/results.component";

const plugs = [
  [1, 1, 10],
  [1, 1, 11],
  [1, 1, 12],
  [1, 1, 13],
  [1, 1, 14],
  [1, 1, 15],
  [1, 5, 5],
  [1, 5, 6],
  [1, 5, 7],
  [1, 5, 8],
  [1, 5, 9],
  [1, 5, 10],
  [1, 5, 11],
  [1, 6, 5],
  [1, 6, 6],
  [1, 6, 7],
  [1, 6, 8],
  [1, 6, 9],
  [1, 7, 5],
  [1, 7, 6],
  [1, 7, 7],
  [1, 7, 8],
  [1, 8, 5],
  [1, 8, 6],
  [1, 8, 7],
  [1, 9, 5],
  [1, 9, 6],
  [1, 10, 1],
  [1, 10, 5],
  [1, 11, 1],
  [1, 11, 5],
  [1, 12, 1],
  [1, 13, 1],
  [1, 14, 1],
  [1, 15, 1],
  [5, 1, 5],
  [5, 1, 6],
  [5, 1, 7],
  [5, 1, 8],
  [5, 1, 9],
  [5, 1, 10],
  [5, 1, 11],
  [5, 5, 1],
  [5, 5, 5],
  [5, 6, 1],
  [5, 7, 1],
  [5, 8, 1],
  [5, 9, 1],
  [5, 10, 1],
  [5, 11, 1],
  [6, 1, 5],
  [6, 1, 6],
  [6, 1, 7],
  [6, 1, 8],
  [6, 1, 9],
  [6, 5, 1],
  [6, 6, 1],
  [6, 7, 1],
  [6, 8, 1],
  [6, 9, 1],
  [7, 1, 5],
  [7, 1, 6],
  [7, 1, 7],
  [7, 1, 8],
  [7, 5, 1],
  [7, 6, 1],
  [7, 7, 1],
  [7, 8, 1],
  [8, 1, 5],
  [8, 1, 6],
  [8, 1, 7],
  [8, 5, 1],
  [8, 6, 1],
  [8, 7, 1],
  [9, 1, 5],
  [9, 1, 6],
  [9, 5, 1],
  [9, 6, 1],
  [10, 1, 1],
  [10, 1, 5],
  [10, 5, 1],
  [11, 1, 1],
  [11, 1, 5],
  [11, 5, 1],
  [12, 1, 1],
  [13, 1, 1],
  [14, 1, 1],
  [15, 1, 1],
];

function buildTestItem(
  slot: ArmorSlot,
  isExotic: boolean,
  stats: number[],
  perk: ArmorPerkOrSlot = ArmorPerkOrSlot.Any,
  overrides: Partial<IPermutatorArmor> = {}
): IPermutatorArmor {
  return {
    id: Math.floor(Math.random() * 1000000),
    armorSystem: ArmorSystem.Armor3,
    clazz: DestinyClass.Titan,
    source: InventoryArmorSource.Inventory,
    slot: slot,
    mobility: stats[0],
    resilience: stats[1],
    recovery: stats[2],
    discipline: stats[3],
    intellect: stats[4],
    strength: stats[5],
    hash: 0,
    exoticPerkHash: [],
    isExotic: isExotic ? 1 : 0,
    isSunset: false,
    masterworkLevel: 5,
    archetypeStats: [],
    tier: isExotic ? 0 : 3,
    gearSetHash: null,
    tuningStat: null,
    perk: perk,
    rarity: TierType.Superior,
    ...overrides,
  } as IPermutatorArmor;
}

function buildTestClassItem(
  stats: number[] = [0, 0, 0, 0, 0, 0],
  perk: ArmorPerkOrSlot = ArmorPerkOrSlot.SlotArtifice,
  overrides: Partial<IPermutatorArmor> = {}
): IPermutatorArmor {
  return buildTestItem(ArmorSlot.ArmorSlotClass, false, stats, perk, {
    tier: 4,
    archetypeStats: [3, 4, 5],
    ...overrides,
  });
}

function generateRandomStats() {
  // pick 4 random plugs
  const randomPlugs = [];
  for (let i = 0; i < 4; i++) {
    randomPlugs.push(plugs[Math.floor(Math.random() * plugs.length)]);
  }

  // calculate the stats
  const stats = [
    randomPlugs[0][0] + randomPlugs[1][0],
    randomPlugs[0][1] + randomPlugs[1][1],
    randomPlugs[0][2] + randomPlugs[1][2],
    randomPlugs[2][0] + randomPlugs[3][0],
    randomPlugs[2][1] + randomPlugs[3][1],
    randomPlugs[2][2] + randomPlugs[3][2],
  ];
  return stats;
}

function randomPerk() {
  // pick random number
  const random = Math.floor(Math.random() * 100);
  if (random < 50) {
    return ArmorPerkOrSlot.SlotArtifice;
  }
  return undefined;
}

function generateRandomBuild() {
  return [
    buildTestItem(ArmorSlot.ArmorSlotHelmet, false, generateRandomStats(), randomPerk()),
    buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, generateRandomStats(), randomPerk()),
    buildTestItem(ArmorSlot.ArmorSlotChest, false, generateRandomStats(), randomPerk()),
    buildTestItem(ArmorSlot.ArmorSlotLegs, false, generateRandomStats(), randomPerk()),
    buildTestClassItem(generateRandomStats(), randomPerk()),
  ];
}

function buildRuntime() {
  return {
    maximumPossibleTiers: [0, 0, 0, 0, 0, 0],
  };
}

// Wrapper that computes hoisted params from config, matching the new handlePermutation signature
function callHandlePermutation(
  runtime: any,
  config: BuildConfiguration,
  helmet: IPermutatorArmor,
  gauntlet: IPermutatorArmor,
  chest: IPermutatorArmor,
  leg: IPermutatorArmor,
  classItem: IPermutatorArmor,
  constantBonus: number[],
  doNotOutput: boolean
): IPermutatorArmorSet | null {
  const targetVals: number[] = new Array(6);
  const targetFixed: boolean[] = new Array(6);
  for (let n = 0; n < 6; n++) {
    targetVals[n] = (config.minimumStatTiers[n as ArmorStat].value || 0) * 10;
    targetFixed[n] = !!config.minimumStatTiers[n as ArmorStat].fixed;
  }
  const maxMajorMods = config.statModLimits?.maxMajorMods || 0;
  const maxMods = config.statModLimits?.maxMods || 0;
  const possibleIncreaseByMod = 10 * maxMajorMods + 5 * Math.max(0, maxMods - maxMajorMods);
  const assumeLegArt = !!config.assumeEveryLegendaryIsArtifice;
  const assumeExoArt = !!config.assumeEveryExoticIsArtifice;

  // Pre-bake masterwork stats into items (mirrors the worker's prebakeStats step)
  function prebake(item: IPermutatorArmor): void {
    const mw = [
      item.mobility,
      item.resilience,
      item.recovery,
      item.discipline,
      item.intellect,
      item.strength,
    ];
    applyMasterworkStats(item, config, mw);
    item.mobility = mw[0];
    item.resilience = mw[1];
    item.recovery = mw[2];
    item.discipline = mw[3];
    item.intellect = mw[4];
    item.strength = mw[5];
  }
  prebake(helmet);
  prebake(gauntlet);
  prebake(chest);
  prebake(leg);
  prebake(classItem);

  // H5: compute outer 4-item base stats (stats are pre-baked, no applyMasterworkStats needed)
  const outerBaseStats = [
    helmet.mobility + gauntlet.mobility + chest.mobility + leg.mobility,
    helmet.resilience + gauntlet.resilience + chest.resilience + leg.resilience,
    helmet.recovery + gauntlet.recovery + chest.recovery + leg.recovery,
    helmet.discipline + gauntlet.discipline + chest.discipline + leg.discipline,
    helmet.intellect + gauntlet.intellect + chest.intellect + leg.intellect,
    helmet.strength + gauntlet.strength + chest.strength + leg.strength,
  ];
  // chest resilience bonus
  if (!chest.isExotic && config.addConstent1Health) outerBaseStats[1] += 1;

  const outerArtifice =
    (isArtificeNonClass(helmet, assumeLegArt, assumeExoArt) ? 1 : 0) +
    (isArtificeNonClass(gauntlet, assumeLegArt, assumeExoArt) ? 1 : 0) +
    (isArtificeNonClass(chest, assumeLegArt, assumeExoArt) ? 1 : 0) +
    (isArtificeNonClass(leg, assumeLegArt, assumeExoArt) ? 1 : 0);

  return handlePermutation(
    runtime,
    config,
    helmet,
    gauntlet,
    chest,
    leg,
    classItem,
    outerBaseStats,
    outerArtifice,
    constantBonus,
    doNotOutput,
    targetVals,
    targetFixed,
    possibleIncreaseByMod,
    assumeLegArt,
    assumeExoArt
  );
}

describe("Results Worker", () => {
  it("should swap mods around to see replace old mods", () => {
    // this is an edge case in which the artifice mod, which initially will be applied to
    // mobility, must be moved to Recovery. Otherwise, this set would not be possible.

    const runtime = buildRuntime();

    const mockItems = [
      buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [2, 12, 20, 20, 9, 2]),
      buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [2, 30, 2, 26, 6, 2]),
      buildTestItem(ArmorSlot.ArmorSlotChest, true, [2, 11, 21, 17, 10, 8]),
      buildTestItem(ArmorSlot.ArmorSlotLegs, false, [2, 7, 24, 15, 15, 2]),
    ];
    const classItem = buildTestClassItem();

    const config = new BuildConfiguration();
    config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
    config.minimumStatTiers[ArmorStat.StatWeapon].value = 2;
    config.minimumStatTiers[ArmorStat.StatHealth].value = 10;
    config.minimumStatTiers[ArmorStat.StatClass].value = 8;
    config.minimumStatTiers[ArmorStat.StatGrenade].value = 9;
    config.minimumStatTiers[ArmorStat.StatSuper].value = 5;
    config.minimumStatTiers[ArmorStat.StatMelee].value = 2;

    let presult = callHandlePermutation(
      runtime,
      config,
      mockItems[0],
      mockItems[1],
      mockItems[2],
      mockItems[3],
      classItem,
      [0, 0, 0, 0, 0, 0], // constant bonus
      false // doNotOutput
    ) as IPermutatorArmorSet;
    let result = CreateResultDefinition(presult, mockItems, classItem);
    expect(result).toBeDefined();
    expect(result.mods.length).toBeLessThanOrEqual(5);
    expect(result.stats[0]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatWeapon].value * 10
    );
    expect(result.stats[1]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatHealth].value * 10
    );
    expect(result.stats[2]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatClass].value * 10
    );
    expect(result.stats[3]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatGrenade].value * 10
    );
    expect(result.stats[4]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatSuper].value * 10
    );
    expect(result.stats[5]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatMelee].value * 10
    );
  });
  it("should swap 3x artifice mods around to replace old mods", () => {
    // this is an edge case in which the artifice mod, which initially will be applied to
    // mobility, must be moved to Recovery. Otherwise, this set would not be possible.

    const runtime = buildRuntime();

    const mockItems = [
      buildTestItem(ArmorSlot.ArmorSlotHelmet, true, [6, 27, 3, 19, 7, 6]),
      buildTestItem(
        ArmorSlot.ArmorSlotGauntlet,
        false,
        [2, 10, 21, 24, 2, 7],
        ArmorPerkOrSlot.SlotArtifice
      ),
      buildTestItem(
        ArmorSlot.ArmorSlotChest,
        false,
        [6, 2, 23, 28, 2, 2],
        ArmorPerkOrSlot.SlotArtifice
      ),
      buildTestItem(
        ArmorSlot.ArmorSlotLegs,
        false,
        [11, 12, 10, 21, 8, 2],
        ArmorPerkOrSlot.SlotArtifice
      ),
    ];
    const classItem = buildTestClassItem();

    const config = new BuildConfiguration();
    config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
    config.minimumStatTiers[ArmorStat.StatWeapon].value = 6;
    config.minimumStatTiers[ArmorStat.StatHealth].value = 6;
    config.minimumStatTiers[ArmorStat.StatClass].value = 10;
    config.minimumStatTiers[ArmorStat.StatGrenade].value = 10;
    config.minimumStatTiers[ArmorStat.StatSuper].value = 0;
    config.minimumStatTiers[ArmorStat.StatMelee].value = 0;

    let presult = callHandlePermutation(
      runtime,
      config,
      mockItems[0],
      mockItems[1],
      mockItems[2],
      mockItems[3],
      classItem,
      [0, 0, 0, 0, 0, 0], // constant bonus
      false // doNotOutput
    ) as IPermutatorArmorSet;
    let result = CreateResultDefinition(presult, mockItems, classItem);
    expect(result).toBeDefined();
    expect(result.stats[0]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatWeapon].value * 10
    );
    expect(result.stats[1]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatHealth].value * 10
    );
    expect(result.stats[2]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatClass].value * 10
    );
    expect(result.stats[3]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatGrenade].value * 10
    );
    expect(result.stats[4]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatSuper].value * 10
    );
    expect(result.stats[5]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatMelee].value * 10
    );
  });
  it("should swap 3x artifice mods around to replace old mods v2", () => {
    // this is an edge case in which the artifice mod, which initially will be applied to
    // mobility, must be moved to Recovery. Otherwise, this set would not be possible.

    const runtime = buildRuntime();

    const mockItems = [
      buildTestItem(
        ArmorSlot.ArmorSlotHelmet,
        false,
        [13, 16, 2, 24, 2, 7],
        ArmorPerkOrSlot.SlotArtifice
      ),
      buildTestItem(
        ArmorSlot.ArmorSlotGauntlet,
        false,
        [26, 6, 2, 26, 2, 2],
        ArmorPerkOrSlot.SlotArtifice
      ),
      buildTestItem(ArmorSlot.ArmorSlotChest, true, [6, 24, 2, 17, 7, 7]),
      buildTestItem(
        ArmorSlot.ArmorSlotLegs,
        false,
        [22, 9, 2, 24, 2, 6],
        ArmorPerkOrSlot.SlotArtifice
      ),
    ];
    const classItem = buildTestClassItem();

    const config = new BuildConfiguration();
    config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
    config.minimumStatTiers[ArmorStat.StatWeapon].value = 9;
    config.minimumStatTiers[ArmorStat.StatHealth].value = 10;
    config.minimumStatTiers[ArmorStat.StatClass].value = 0;
    config.minimumStatTiers[ArmorStat.StatGrenade].value = 10;
    config.minimumStatTiers[ArmorStat.StatSuper].value = 0;
    config.minimumStatTiers[ArmorStat.StatMelee].value = 0;

    const constantBonus = [-10, 0, 10, 0, 0, -10];
    let presult = callHandlePermutation(
      runtime,
      config,
      mockItems[0],
      mockItems[1],
      mockItems[2],
      mockItems[3],
      classItem,
      constantBonus, // constant bonus
      false // doNotOutput
    ) as IPermutatorArmorSet;
    let result = CreateResultDefinition(presult, mockItems, classItem);
    expect(result).toBeDefined();
    console.log(result);
    expect(result.stats[0]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatWeapon].value * 10
    );
    expect(result.stats[1]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatHealth].value * 10
    );
    expect(result.stats[2]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatClass].value * 10
    );
    expect(result.stats[3]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatGrenade].value * 10
    );
    expect(result.stats[4]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatSuper].value * 10
    );
    expect(result.stats[5]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatMelee].value * 10
    );

    for (let n = 0; n < 6; n++) {
      const minor =
        1 * result.mods.filter((mod: number) => Math.floor(mod / 3) == n && mod % 3 == 1).length;
      const major =
        1 * result.mods.filter((mod: number) => Math.floor(mod / 3) == n && mod % 3 == 2).length;
      const artif =
        1 *
        result.artifice.filter((mod: number) => Math.floor(mod / 3) - 1 == n && mod % 3 == 0)
          .length;
      expect(result.stats[n]).toEqual(
        result.statsNoMods[n] + 5 * minor + 10 * major + 3 * artif + constantBonus[n]
      );
    }
  });

  it("should be able to keep plain zero-waste builds", () => {
    const runtime = buildRuntime();

    const mockItems = [
      buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [8, 9, 16, 23, 2, 8]),
      buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [2, 9, 20, 26, 6, 2]),
      buildTestItem(ArmorSlot.ArmorSlotChest, true, [7, 2, 23, 21, 10, 2]),
      buildTestItem(ArmorSlot.ArmorSlotLegs, false, [3, 20, 11, 20, 2, 8]),
    ];
    const classItem = buildTestClassItem();

    const config = BuildConfiguration.buildEmptyConfiguration();
    config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
    config.tryLimitWastedStats = true;
    config.onlyShowResultsWithNoWastedStats = true;

    let result = callHandlePermutation(
      runtime,
      config,
      mockItems[0],
      mockItems[1],
      mockItems[2],
      mockItems[3],
      classItem,
      [0, 0, 0, 0, 0, 0], // constant bonus
      false // doNotOutput
    );
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
  });

  it("should be able to solve complex zero-waste builds", () => {
    // this is an edge case in which the artifice mod, which initially will be applied to
    // mobility, must be moved to Recovery. Otherwise, this set would not be possible.

    const runtime = buildRuntime();

    const mockItems = [
      buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [8, 9, 16, 23, 2, 8]),
      buildTestItem(
        ArmorSlot.ArmorSlotGauntlet,
        false,
        [2, 9, 20, 26, 6, 2],
        ArmorPerkOrSlot.SlotArtifice
      ),
      buildTestItem(
        ArmorSlot.ArmorSlotChest,
        false,
        [7, 2, 23, 21, 10, 2],
        ArmorPerkOrSlot.SlotArtifice
      ),
      buildTestItem(ArmorSlot.ArmorSlotLegs, true, [3, 20, 11, 20, 2, 8]),
    ];
    const classItem = buildTestClassItem();

    // the numbers currently sum to 0; now we artifically reduce them to enforce wasted stats calculation
    mockItems[0].mobility -= 0;
    mockItems[0].resilience -= 5 + 3 + 3; // minor mod + two artifice mods
    mockItems[0].recovery -= 5; // minor mod
    mockItems[0].discipline -= 5; // minor mod
    mockItems[0].intellect -= 5; // minor mod
    mockItems[0].strength -= 5 + 3; // minor mod + artifice mod

    const config = new BuildConfiguration();
    config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
    config.tryLimitWastedStats = true;
    config.onlyShowResultsWithNoWastedStats = true;

    let presult = callHandlePermutation(
      runtime,
      config,
      mockItems[0],
      mockItems[1],
      mockItems[2],
      mockItems[3],
      classItem,
      [0, 0, 0, 0, 0, 0], // constant bonus
      false // doNotOutput
    ) as IPermutatorArmorSet;
    let result = CreateResultDefinition(presult, mockItems, classItem);
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result.waste).toEqual(0);
  });

  it("should be able to give correct build presets", () => {
    // this is an edge case in which the artifice mod, which initially will be applied to
    // mobility, must be moved to Recovery. Otherwise, this set would not be possible.

    for (let n = 0; n < 10000; n++) {
      let runtime = buildRuntime();
      const mockItems = generateRandomBuild();

      const config = new BuildConfiguration();
      config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
      config.tryLimitWastedStats = true;
      //config.onlyShowResultsWithNoWastedStats = true

      const constantBonus1 = [0, 0, 0, 0, 0, 0];
      callHandlePermutation(
        runtime,
        config,
        mockItems[0],
        mockItems[1],
        mockItems[2],
        mockItems[3],
        mockItems[4],
        constantBonus1,
        false
      );

      // grab the runtime.maximumPossibleTiers and iterate over them to see if it correctly fills them
      // first, pick a random order
      const order = ARMORSTAT_ORDER.sort(() => Math.random() - 0.5);

      for (let statId of order) {
        config.minimumStatTiers[statId as ArmorStat].value =
          runtime.maximumPossibleTiers[statId] / 10;

        runtime = buildRuntime();
        let presult = callHandlePermutation(
          runtime,
          config,
          mockItems[0],
          mockItems[1],
          mockItems[2],
          mockItems[3],
          mockItems[4],
          constantBonus1,
          false
        ) as IPermutatorArmorSet;
        let result = CreateResultDefinition(presult, mockItems.slice(0, 4), mockItems[4]);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result.mods.length).toBeLessThanOrEqual(5);
        if (!result) {
          console.log("Failed to find a build with minimumStatTiers", config.minimumStatTiers);
          console.log("RUN", n);
          console.log("base stats", [
            10 +
              mockItems[0].mobility +
              mockItems[1].mobility +
              mockItems[2].mobility +
              mockItems[3].mobility,
            10 +
              mockItems[0].resilience +
              mockItems[1].resilience +
              mockItems[2].resilience +
              mockItems[3].resilience,
            10 +
              mockItems[0].recovery +
              mockItems[1].recovery +
              mockItems[2].recovery +
              mockItems[3].recovery,
            10 +
              mockItems[0].discipline +
              mockItems[1].discipline +
              mockItems[2].discipline +
              mockItems[3].discipline,
            10 +
              mockItems[0].intellect +
              mockItems[1].intellect +
              mockItems[2].intellect +
              mockItems[3].intellect,
            10 +
              mockItems[0].strength +
              mockItems[1].strength +
              mockItems[2].strength +
              mockItems[3].strength,
          ]);
          console.log("target stats", [
            config.minimumStatTiers[ArmorStat.StatWeapon].value * 10,
            config.minimumStatTiers[ArmorStat.StatHealth].value * 10,
            config.minimumStatTiers[ArmorStat.StatClass].value * 10,
            config.minimumStatTiers[ArmorStat.StatGrenade].value * 10,
            config.minimumStatTiers[ArmorStat.StatSuper].value * 10,
            config.minimumStatTiers[ArmorStat.StatMelee].value * 10,
          ]);
          console.log(
            "Available artifice mods",
            mockItems.map((item) => (item.perk > 0 ? 1 : 0)).reduce((a, b) => a + b, 0 as number)
          );
          console.log("------------------------------------------------------------------------");
          console.log("------------------------------------------------------------------------");
          console.log("------------------------------------------------------------------------");
          break;
        }
      }
    }
  });

  it("should swap mods around", () => {
    // this is an edge case in which the artifice mod, which initially will be applied to
    // mobility, must be moved to Recovery. Otherwise, this set would not be possible.

    const runtime = buildRuntime();

    const mockItems = [
      buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [13, 14, 4, 17, 9, 8]),
      buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [8, 16, 11, 22, 4, 14]),
      buildTestItem(ArmorSlot.ArmorSlotChest, true, [9, 13, 10, 18, 4, 8]),
      buildTestItem(ArmorSlot.ArmorSlotLegs, false, [19, 4, 9, 12, 4, 17]),
    ];
    const classItem = buildTestClassItem();

    const config = new BuildConfiguration();
    config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
    config.assumeLegendariesMasterworked = true;
    config.assumeExoticsMasterworked = true;
    config.minimumStatTiers[ArmorStat.StatWeapon].value = 0;
    config.minimumStatTiers[ArmorStat.StatHealth].value = 9;
    config.minimumStatTiers[ArmorStat.StatClass].value = 6;
    config.minimumStatTiers[ArmorStat.StatGrenade].value = 7;
    config.minimumStatTiers[ArmorStat.StatSuper].value = 0;
    config.minimumStatTiers[ArmorStat.StatMelee].value = 0;

    // calculate the stat sum of mockItems
    const statSum = [
      mockItems[0].mobility + mockItems[1].mobility + mockItems[2].mobility + mockItems[3].mobility,
      mockItems[0].resilience +
        mockItems[1].resilience +
        mockItems[2].resilience +
        mockItems[3].resilience,
      mockItems[0].recovery + mockItems[1].recovery + mockItems[2].recovery + mockItems[3].recovery,
      mockItems[0].discipline +
        mockItems[1].discipline +
        mockItems[2].discipline +
        mockItems[3].discipline,
      mockItems[0].intellect +
        mockItems[1].intellect +
        mockItems[2].intellect +
        mockItems[3].intellect,
      mockItems[0].strength + mockItems[1].strength + mockItems[2].strength + mockItems[3].strength,
    ];
    console.log("statSum", statSum);

    //const constantBonus = [-10, -10, -10, -10, -10, -10];
    const constantBonus = [0, 0, 0, 0, 0, 0];
    let presult = callHandlePermutation(
      runtime,
      config,
      mockItems[0],
      mockItems[1],
      mockItems[2],
      mockItems[3],
      classItem,
      constantBonus, // constant bonus
      false // doNotOutput
    ) as IPermutatorArmorSet;
    let result = CreateResultDefinition(presult, mockItems, classItem);
    expect(result).toBeDefined();
    console.log(result);
    expect(result.mods.length).toBeLessThanOrEqual(5);
    expect(result.stats[0]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatWeapon].value * 10
    );
    expect(result.stats[1]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatHealth].value * 10
    );
    expect(result.stats[2]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatClass].value * 10
    );
    expect(result.stats[3]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatGrenade].value * 10
    );
    expect(result.stats[4]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatSuper].value * 10
    );
    expect(result.stats[5]).toBeGreaterThanOrEqual(
      config.minimumStatTiers[ArmorStat.StatMelee].value * 10
    );

    for (let n = 0; n < 6; n++) {
      const minor =
        1 * result.mods.filter((mod: number) => Math.floor(mod / 3) == n && mod % 3 == 1).length;
      const major =
        1 * result.mods.filter((mod: number) => Math.floor(mod / 3) == n && mod % 3 == 2).length;
      const artif =
        1 *
        result.artifice.filter((mod: number) => Math.floor(mod / 3) - 1 == n && mod % 3 == 0)
          .length;
      expect(result.stats[n]).toEqual(
        result.statsNoMods[n] + 5 * minor + 10 * major + 3 * artif + constantBonus[n]
      );
    }
  });

  it("should accept exotic class item as the sole exotic", () => {
    const runtime = buildRuntime();
    const config = new BuildConfiguration();

    const helmet = buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [10, 10, 12, 15, 8, 7]);
    const gauntlet = buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [8, 12, 12, 20, 6, 6]);
    const chest = buildTestItem(ArmorSlot.ArmorSlotChest, false, [6, 15, 10, 18, 10, 2]);
    const leg = buildTestItem(ArmorSlot.ArmorSlotLegs, false, [12, 8, 10, 14, 8, 10]);
    const classItem = buildTestClassItem([6, 10, 16, 12, 8, 10], ArmorPerkOrSlot.Any, {
      isExotic: 1,
      rarity: TierType.Exotic,
    });

    const result = callHandlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      classItem,
      [0, 0, 0, 0, 0, 0],
      false
    );

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("should allow exotic helmet with legendary class item", () => {
    const runtime = buildRuntime();
    const config = new BuildConfiguration();

    const helmet = buildTestItem(ArmorSlot.ArmorSlotHelmet, true, [10, 20, 6, 15, 8, 7]);
    const gauntlet = buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [8, 12, 12, 20, 6, 6]);
    const chest = buildTestItem(ArmorSlot.ArmorSlotChest, false, [6, 15, 10, 18, 10, 2]);
    const leg = buildTestItem(ArmorSlot.ArmorSlotLegs, false, [12, 8, 10, 14, 8, 10]);
    const legendaryClassItem = buildTestClassItem([4, 8, 14, 10, 6, 8]);

    const result = callHandlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      legendaryClassItem,
      [0, 0, 0, 0, 0, 0],
      false
    );
    expect(result).not.toBeNull();
  });

  it("should use class item stats to meet minimum stat targets", () => {
    const runtime = buildRuntime();
    const config = new BuildConfiguration();
    config.minimumStatTiers[ArmorStat.StatWeapon].value = 7;

    const helmet = buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [12, 10, 10, 15, 8, 7]);
    const gauntlet = buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [12, 12, 10, 20, 6, 6]);
    const chest = buildTestItem(ArmorSlot.ArmorSlotChest, false, [12, 15, 10, 18, 10, 2]);
    const leg = buildTestItem(ArmorSlot.ArmorSlotLegs, false, [14, 8, 10, 14, 8, 10]);
    const classItem = buildTestClassItem([10, 6, 16, 12, 8, 10]);

    const result = callHandlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      classItem,
      [0, 0, 0, 0, 0, 0],
      false
    );

    expect(result).not.toBeNull();
    if (result) {
      expect(result.statsWithMods[0]).toBeGreaterThanOrEqual(70);
    }
  });

  it("should not reject entire combo when one class item exceeds fixed tier", () => {
    const runtime = buildRuntime();
    const config = new BuildConfiguration();
    config.minimumStatTiers[ArmorStat.StatHealth].value = 10;
    config.minimumStatTiers[ArmorStat.StatHealth].fixed = true;

    // Base res from 4 items: 20+20+20+12 = 72
    // Masterwork: 4 items * +5 (archetypeStats=[]) = +20, class item (archetypeStats=[3,4,5]) +5
    // Total masterwork: +25
    const helmet = buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [2, 20, 6, 15, 8, 7]);
    const gauntlet = buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [2, 20, 6, 20, 6, 6]);
    const chest = buildTestItem(ArmorSlot.ArmorSlotChest, false, [2, 20, 6, 18, 10, 2]);
    const leg = buildTestItem(ArmorSlot.ArmorSlotLegs, false, [2, 12, 10, 14, 8, 10]);

    // Bad: 72 + 15 = 87 base, + 25 mw = 112 > 100 → busts fixed T10
    const badClassItem = buildTestClassItem([2, 15, 16, 12, 8, 10]);
    // Good: 72 + 2 = 74 base, + 25 mw = 99 ≤ 100 → within fixed T10
    const goodClassItem = buildTestClassItem([10, 2, 20, 12, 8, 10]);

    // Bad class item should return null (exceeds fixed tier)
    const badResult = callHandlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      badClassItem,
      [0, 0, 0, 0, 0, 0],
      false
    );
    expect(badResult).toBeNull();

    // Good class item should return a valid result
    const goodResult = callHandlePermutation(
      buildRuntime(),
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      goodClassItem,
      [0, 0, 0, 0, 0, 0],
      false
    );
    expect(goodResult).not.toBeNull();
  });

  it("should satisfy artifice requirement with class item perk", () => {
    const runtime = buildRuntime();
    const config = new BuildConfiguration();

    // No armor piece has artifice
    const helmet = buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [10, 10, 12, 15, 8, 7]);
    const gauntlet = buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [8, 12, 12, 20, 6, 6]);
    const chest = buildTestItem(ArmorSlot.ArmorSlotChest, false, [6, 15, 10, 18, 10, 2]);
    const leg = buildTestItem(ArmorSlot.ArmorSlotLegs, false, [12, 8, 10, 14, 8, 10]);
    // Only class item has artifice
    const classItem = buildTestClassItem([6, 10, 16, 12, 8, 10], ArmorPerkOrSlot.SlotArtifice);

    const result = callHandlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      classItem,
      [0, 0, 0, 0, 0, 0],
      false
    );
    expect(result).not.toBeNull();
  });

  it("should achieve zero waste with class item stat contribution", () => {
    const runtime = buildRuntime();
    const config = new BuildConfiguration();
    config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
    config.tryLimitWastedStats = true;
    config.onlyShowResultsWithNoWastedStats = true;

    // All items: Armor3, masterworkLevel=5, archetypeStats=[]
    // Masterwork: +5 to all stats per item (5 items) = +25 total per stat
    // Class item has archetypeStats=[3,4,5], so +5 to stats 0,1,2 only
    // Raw sums:  mob=50, res=50, rec=50, dis=100, int=40, str=40
    // + 4 items mw (+20 all) + class item mw (+5 to 0,1,2):
    //   mob=75, res=75, rec=75, dis=120, int=60, str=60
    // Waste = 5+5+5+0+0+0 = 15 per the raw stats
    // But with mods we can reach multiples of 10: mob=80, res=80, rec=80
    // Need 3 minor mods (5 each) → achievable with 3 mods
    const helmet = buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [8, 10, 12, 20, 8, 8]);
    const gauntlet = buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [10, 10, 8, 20, 2, 12]);
    const chest = buildTestItem(ArmorSlot.ArmorSlotChest, false, [12, 10, 10, 20, 10, 2]);
    const leg = buildTestItem(ArmorSlot.ArmorSlotLegs, false, [10, 10, 10, 20, 10, 8]);
    const classItem = buildTestClassItem([10, 10, 10, 20, 10, 10]);

    const result = callHandlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      classItem,
      [0, 0, 0, 0, 0, 0],
      false
    ) as IPermutatorArmorSet;

    expect(result).not.toBeNull();
    if (result) {
      expect(getWaste(result.statsWithMods)).toEqual(0);
    }
  });

  it("should include class item T5 tuning in tuning generation", () => {
    const runtime = buildRuntime();
    const config = new BuildConfiguration();
    config.calculateTierFiveTuning = true;
    config.minimumStatTiers[ArmorStat.StatWeapon].value = 10;

    const helmet = buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [20, 10, 2, 15, 8, 7]);
    const gauntlet = buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [20, 12, 2, 20, 6, 6]);
    const chest = buildTestItem(ArmorSlot.ArmorSlotChest, false, [20, 15, 2, 18, 10, 2]);
    const leg = buildTestItem(ArmorSlot.ArmorSlotLegs, false, [20, 8, 2, 14, 8, 10]);
    // Class item is T5 with tuning stat = mobility (stat 0)
    const classItem = buildTestClassItem([15, 8, 10, 12, 8, 10], ArmorPerkOrSlot.Any, {
      tier: 5,
      tuningStat: ArmorStat.StatWeapon,
      archetypeStats: [0, 1, 2],
      armorSystem: ArmorSystem.Armor3,
    });

    const result = callHandlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      classItem,
      [0, 0, 0, 0, 0, 0],
      false
    ) as IPermutatorArmorSet;

    expect(result).not.toBeNull();
    if (result) {
      expect(result.statsWithMods[0]).toBeGreaterThanOrEqual(100);
    }
  });

  it("should need fewer mods when class item has high stats", () => {
    const runtime = buildRuntime();
    const config = new BuildConfiguration();
    config.minimumStatTiers[ArmorStat.StatHealth].value = 10;

    const helmet = buildTestItem(ArmorSlot.ArmorSlotHelmet, false, [2, 20, 10, 15, 8, 7]);
    const gauntlet = buildTestItem(ArmorSlot.ArmorSlotGauntlet, false, [2, 20, 10, 20, 6, 6]);
    const chest = buildTestItem(ArmorSlot.ArmorSlotChest, false, [2, 20, 10, 18, 10, 2]);
    const leg = buildTestItem(ArmorSlot.ArmorSlotLegs, false, [2, 20, 10, 14, 8, 10]);

    // Low-stat class item: needs mods to reach T10 resilience
    const lowClassItem = buildTestClassItem([2, 2, 2, 2, 2, 2]);
    const lowResult = callHandlePermutation(
      runtime,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      lowClassItem,
      [0, 0, 0, 0, 0, 0],
      false
    ) as IPermutatorArmorSet;

    // High-stat class item: needs fewer/no mods
    const highClassItem = buildTestClassItem([2, 20, 10, 12, 8, 10]);
    const runtime2 = buildRuntime();
    const highResult = callHandlePermutation(
      runtime2,
      config,
      helmet,
      gauntlet,
      chest,
      leg,
      highClassItem,
      [0, 0, 0, 0, 0, 0],
      false
    ) as IPermutatorArmorSet;

    expect(lowResult).not.toBeNull();
    expect(highResult).not.toBeNull();
    if (lowResult && highResult) {
      expect(highResult.usedMods.length).toBeLessThanOrEqual(lowResult.usedMods.length);
    }
  });

  it("should produce valid 5-piece builds across 1000 random inventories", () => {
    for (let n = 0; n < 1000; n++) {
      let runtime = buildRuntime();
      const config = new BuildConfiguration();
      config.statModLimits = { maxMods: 5, maxMajorMods: 5 };
      config.tryLimitWastedStats = true;

      const mockItems = generateRandomBuild();
      const constantBonus = [0, 0, 0, 0, 0, 0];

      // First pass: discover maximumPossibleTiers
      callHandlePermutation(
        runtime,
        config,
        mockItems[0],
        mockItems[1],
        mockItems[2],
        mockItems[3],
        mockItems[4],
        constantBonus,
        false
      );

      // Incrementally set targets (same approach as existing 10k test)
      const order = ARMORSTAT_ORDER.slice().sort(() => Math.random() - 0.5);
      for (let statId of order) {
        config.minimumStatTiers[statId as ArmorStat].value =
          runtime.maximumPossibleTiers[statId] / 10;

        runtime = buildRuntime();
        let presult = callHandlePermutation(
          runtime,
          config,
          mockItems[0],
          mockItems[1],
          mockItems[2],
          mockItems[3],
          mockItems[4],
          constantBonus,
          false
        ) as IPermutatorArmorSet;

        expect(presult).not.toBeNull();
        if (presult) {
          expect(presult.usedMods.length).toBeLessThanOrEqual(5);
          for (let stat = 0; stat < 6; stat++) {
            expect(presult.statsWithMods[stat]).toBeGreaterThanOrEqual(
              config.minimumStatTiers[stat as ArmorStat].value * 10
            );
          }
        }
      }
    }
  });
});

function CreateResultDefinition(
  armorSet: IPermutatorArmorSet,
  items: IPermutatorArmor[],
  classItem: IPermutatorArmor
): ResultDefinition {
  const allItems: any[] = [...items, classItem];
  let exotic = allItems.find((x: any) => x.isExotic);

  if (armorSet == null) {
    console.error("ArmorSet is null", allItems);
  }

  return {
    exotic:
      exotic == null
        ? undefined
        : {
            icon: exotic?.icon || "",
            watermark: exotic?.watermarkIcon || "",
            name: exotic?.name || "",
            hash: exotic?.hash || 0,
          },
    artifice: armorSet.usedArtifice,
    tuningStats: armorSet.tuning,
    modCount: armorSet.usedMods.length,
    modCost: armorSet.usedMods.reduce((p, d: StatModifier) => p + STAT_MOD_VALUES[d][2], 0),
    mods: armorSet.usedMods,
    stats: armorSet.statsWithMods,
    statsNoMods: armorSet.statsWithoutMods,
    tiers: getSkillTier(armorSet.statsWithMods),
    waste: getWaste(armorSet.statsWithMods),
    loaded: true,
    items: allItems.map(
      (instance: any): ResultItem => ({
        energyLevel: instance.energyLevel || 10,
        hash: instance.hash,
        itemInstanceId: "",
        name: instance.name || "",
        exotic: !!instance.isExotic,
        masterworked: instance.masterworkLevel === 5,
        masterworkLevel: instance.masterworkLevel || 0,
        armorSystem: instance.armorSystem,
        archetypeStats: instance.archetypeStats || [],
        tuningStat: instance.tuningStat || null,
        tier: instance.tier || 0,
        slot: instance.slot,
        perk: instance.perk,
        transferState: 0, // TRANSFER_NONE
        stats: [
          instance.mobility,
          instance.resilience,
          instance.recovery,
          instance.discipline,
          instance.intellect,
          instance.strength,
        ],
        source: instance.source,
        statsNoMods: [],
      })
    ),
    usesCollectionRoll: allItems.some((v: any) => v.source === InventoryArmorSource.Collections),
    usesVendorRoll: allItems.some((v: any) => v.source === InventoryArmorSource.Vendor),
  } as ResultDefinition;
}
