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

import { Injectable } from "@angular/core";
import { DatabaseService } from "./database.service";
import { IManifestArmor } from "../data/types/IManifestArmor";
import { ConfigurationService } from "./configuration.service";
import { debounceTime } from "rxjs/operators";
import { BehaviorSubject, Observable, ReplaySubject, Subject } from "rxjs";
import { BuildConfiguration } from "../data/buildConfiguration";
import { ArmorPerkOrSlot, ArmorStat, STAT_MOD_VALUES, StatModifier } from "../data/enum/armor-stat";
import { StatusProviderService } from "./status-provider.service";
import { BungieApiService } from "./bungie-api.service";
import { AuthService } from "./auth.service";
import { ArmorSlot } from "../data/enum/armor-slot";
import { NavigationEnd, Router } from "@angular/router";
import { ResultDefinition } from "../components/authenticated-v2/results/results.component";
import {
  IInventoryArmor,
  InventoryArmorSource,
  isEqualItem,
  totalStats,
} from "../data/types/IInventoryArmor";
import { DestinyClass, TierType } from "bungie-api-ts/destiny2";
import { IPermutatorArmorSet } from "../data/types/IPermutatorArmorSet";
import { getSkillTier, getWaste } from "./results-builder.worker";
import { IPermutatorArmor } from "../data/types/IPermutatorArmor";
import { FORCE_USE_ANY_EXOTIC, FORCE_USE_NO_EXOTIC } from "../data/constants";
import { VendorsService } from "./vendors.service";
import { ModOptimizationStrategy } from "../data/enum/mod-optimization-strategy";

type info = {
  results: ResultDefinition[];
  totalResults: number;
  minimumMaximumExoticPossibleTiers: number[];
  maximumPossibleTiers: number[];
  statCombo3x100: ArmorStat[][];
  statCombo4x100: ArmorStat[][];
  itemCount: number;
  totalTime: number;
};

export type ClassExoticInfo = {
  inInventory: boolean;
  inCollection: boolean;
  inVendor: boolean;
  item: IManifestArmor;
};

@Injectable({
  providedIn: "root",
})
export class InventoryService {
  /**
   * An Int32Array that holds all permutations for the currently selected class, before filters are applied.
   * It consists of N items of length 11:
   * helmetHash, gauntletHash, chestHash, legHash, mobility, resilience, recovery, discipline, intellect, strength, exoticHash
   * @private
   */
  private allArmorResults: ResultDefinition[] = [];
  private currentClass: DestinyClass = DestinyClass.Unknown;

  private _manifest: ReplaySubject<null>;
  public readonly manifest: Observable<null>;
  private _inventory: ReplaySubject<null>;
  public readonly inventory: Observable<null>;

  private _armorResults: BehaviorSubject<info>;
  public readonly armorResults: Observable<info>;

  private _calculationProgress: Subject<number> = new Subject<number>();
  public readonly calculationProgress: Observable<number> =
    this._calculationProgress.asObservable();

  private _config: BuildConfiguration = BuildConfiguration.buildEmptyConfiguration();
  private workers: Worker[];

  private results: IPermutatorArmorSet[] = [];
  private totalPermutationCount = 0;
  private resultMaximumTiers: number[][] = [];
  private resultMaximumExoticPossibleTiers: Map<number, number[]>[] = [];
  private resultStatCombo3x100 = new Set<number>();
  private resultStatCombo4x100 = new Set<number>();
  private selectedExotics: IManifestArmor[] = [];
  private InventoryArmorItems: IInventoryArmor[] = [];
  private PermutatorArmorItems: IPermutatorArmor[] = [];
  private endResults: ResultDefinition[] = [];

  constructor(
    private db: DatabaseService,
    private config: ConfigurationService,
    private status: StatusProviderService,
    private api: BungieApiService,
    private auth: AuthService,
    private router: Router,
    private vendors: VendorsService
  ) {
    this._inventory = new ReplaySubject(1);
    this.inventory = this._inventory.asObservable();
    this._manifest = new ReplaySubject(1);
    this.manifest = this._manifest.asObservable();

    this._armorResults = new BehaviorSubject({
      results: this.allArmorResults,
    } as info);
    this.armorResults = this._armorResults.asObservable();

    this.workers = [];
    let dataAlreadyFetched = false;
    let isUpdating = false;

    // TODO: This gives a race condition on some parts.
    router.events.pipe(debounceTime(5)).subscribe(async (val) => {
      if (this.auth.refreshTokenExpired || !(await this.auth.autoRegenerateTokens())) {
        await this.auth.logout();
        return;
      }
      if (!auth.isAuthenticated()) return;

      if (val instanceof NavigationEnd) {
        this.killWorkers();
        this.clearResults();
        console.debug("Trigger refreshAll due to router.events");
        await this.refreshAll(!dataAlreadyFetched);
        dataAlreadyFetched = true;
      }
    });

    config.configuration.pipe(debounceTime(500)).subscribe(async (c) => {
      if (this.auth.refreshTokenExpired || !(await this.auth.autoRegenerateTokens())) {
        await this.auth.logout();
        return;
      }
      if (!auth.isAuthenticated()) return;

      this._config = c;

      isUpdating = true;
      console.debug("Trigger refreshAll due to config change");
      await this.refreshAll(!dataAlreadyFetched);
      dataAlreadyFetched = true;

      isUpdating = false;
    });
  }

  private clearResults() {
    this.allArmorResults = [];
    this._armorResults.next({
      results: this.allArmorResults,
      totalResults: 0,
      totalTime: 0,
      itemCount: 0,
      minimumMaximumExoticPossibleTiers: [0, 0, 0, 0, 0, 0],
      maximumPossibleTiers: [0, 0, 0, 0, 0, 0],
      statCombo3x100: [],
      statCombo4x100: [],
    });
  }

  shouldCalculateResults(): boolean {
    return this.router.url == "/";
  }

  private refreshing: boolean = false;

  async refreshAll(forceArmor: boolean = false, forceManifest = false) {
    if (this.refreshing) return;
    console.debug("Execute refreshAll");
    try {
      this.refreshing = true;
      let manifestUpdated = await this.updateManifest(forceManifest);
      let armorUpdated = await this.updateInventoryItems(manifestUpdated || forceArmor);
      this.updateVendorsAsync();

      await this.triggerArmorUpdateAndUpdateResults(armorUpdated);
    } finally {
      this.refreshing = false;
    }
  }

  private async triggerArmorUpdateAndUpdateResults(
    triggerInventoryUpdate: boolean = false,
    triggerResultsUpdate: boolean = true
  ) {
    // trigger armor update behaviour
    if (triggerInventoryUpdate) this._inventory.next(null);

    // Do not update results in Help and Cluster pages
    if (this.shouldCalculateResults()) {
      await this.updateResults();
    }
  }

  private updateVendorsAsync() {
    if (this.status.getStatus().updatingVendors) return;

    if (!this.vendors.isVendorCacheValid()) {
      this.status.modifyStatus((s) => (s.updatingVendors = true));
      this.vendors
        .updateVendorArmorItemsCache()
        .then((success) => {
          if (!success) return;
          this.triggerArmorUpdateAndUpdateResults(success, this._config.includeVendorRolls);
        })
        .finally(() => {
          this.status.modifyStatus((s) => (s.updatingVendors = false));
        });
    }
  }

  private killWorkers() {
    console.log("killing workers");
    this.workers.forEach((w) => {
      w.terminate();
    });
    this.workers = [];
  }

  private estimateCombinationsToBeChecked(
    helmets: IPermutatorArmor[],
    gauntlets: IPermutatorArmor[],
    chests: IPermutatorArmor[],
    legs: IPermutatorArmor[]
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

    totalCalculations += exoticHelmets * legendaryGauntlets * legendaryChests * legendaryLegs;
    totalCalculations += legendaryHelmets * exoticGauntlets * legendaryChests * legendaryLegs;
    totalCalculations += legendaryHelmets * legendaryGauntlets * exoticChests * legendaryLegs;
    totalCalculations += legendaryHelmets * legendaryGauntlets * legendaryChests * exoticLegs;
    totalCalculations += legendaryHelmets * legendaryGauntlets * legendaryChests * legendaryLegs;
    return totalCalculations;
  }

  async updateResults(nthreads: number = 3) {
    this.clearResults();
    this.killWorkers();

    try {
      console.time("updateResults with WebWorker");
      this.status.modifyStatus((s) => (s.calculatingResults = true));
      let doneWorkerCount = 0;

      this.results = [];
      this.totalPermutationCount = 0;
      this.resultMaximumExoticPossibleTiers = [];
      this.resultMaximumTiers = [];
      this.resultMaximumExoticPossibleTiers = [];
      this.resultStatCombo3x100 = new Set<number>();
      this.resultStatCombo4x100 = new Set<number>();
      const startTime = Date.now();

      let config = this._config;
      this.selectedExotics = await Promise.all(
        config.selectedExotics
          .filter((hash) => hash != FORCE_USE_NO_EXOTIC)
          .map(
            async (hash) =>
              (await this.db.manifestArmor.where("hash").equals(hash).first()) as IManifestArmor
          )
      );
      this.selectedExotics = this.selectedExotics.filter((i) => !!i);

      this.InventoryArmorItems = (await this.db.inventoryArmor
        .where("clazz")
        .equals(config.characterClass)
        .distinct()
        .toArray()) as IInventoryArmor[];

      this.InventoryArmorItems = this.InventoryArmorItems
        // only armor :)
        .filter((item) => item.slot != ArmorSlot.ArmorSlotNone)
        // filter disabled items
        .filter((item) => config.disabledItems.indexOf(item.itemInstanceId) == -1)
        // filter collection/vendor rolls if not allowed
        .filter((item) => {
          switch (item.source) {
            case InventoryArmorSource.Collections:
              return config.includeCollectionRolls;
            case InventoryArmorSource.Vendor:
              return config.includeVendorRolls;
            default:
              return true;
          }
        })
        // filter the selected exotic right here
        .filter(
          (item) =>
            !item.isExotic ||
            config.selectedExotics.indexOf(item.hash) != -1 ||
            config.selectedExotics.indexOf(FORCE_USE_ANY_EXOTIC) != -1 ||
            config.selectedExotics.length == 0
        )
        .filter(
          (item) =>
            this.selectedExotics.length != 1 ||
            this.selectedExotics[0].slot != item.slot ||
            this.selectedExotics[0].hash == item.hash
        )

        // config.OnlyUseMasterworkedExotics - only keep exotics that are masterworked
        .filter(
          (item) =>
            !config.onlyUseMasterworkedExotics ||
            !(item.rarity == TierType.Exotic && !item.masterworked)
        )

        // config.OnlyUseMasterworkedLegendaries - only keep legendaries that are masterworked
        .filter(
          (item) =>
            !config.onlyUseMasterworkedLegendaries ||
            !(item.rarity == TierType.Superior && !item.masterworked)
        )

        // non-legendaries and non-exotics
        .filter(
          (item) =>
            config.allowBlueArmorPieces ||
            item.rarity == TierType.Exotic ||
            item.rarity == TierType.Superior
        )
        // sunset armor
        .filter((item) => !config.ignoreSunsetArmor || !item.isSunset)
        // armor perks
        .filter((item) => {
          return (
            item.isExotic ||
            !config.armorPerks[item.slot].fixed ||
            config.armorPerks[item.slot].value == ArmorPerkOrSlot.None ||
            config.armorPerks[item.slot].value == item.perk
          );
        });
      // console.log(items.map(d => "id:'"+d.itemInstanceId+"'").join(" or "))

      // Remove collection items if they are in inventory
      this.InventoryArmorItems = this.InventoryArmorItems.filter((item) => {
        if (item.source === InventoryArmorSource.Inventory) return true;

        const purchasedItemInstance = this.InventoryArmorItems.find(
          (rhs) => rhs.source === InventoryArmorSource.Inventory && isEqualItem(item, rhs)
        );

        // If this item is a collection/vendor item, ignore it if the player
        // already has a real copy of the same item.
        return purchasedItemInstance === undefined;
      });

      this.PermutatorArmorItems = this.InventoryArmorItems.map((armor) => {
        return {
          id: armor.id,
          hash: armor.hash,
          slot: armor.slot,
          clazz: armor.clazz,
          perk: armor.perk,
          isExotic: !!armor.isExotic,
          rarity: armor.rarity,
          isSunset: armor.isSunset,
          masterworked: armor.masterworked,
          mobility: armor.mobility,
          resilience: armor.resilience,
          recovery: armor.recovery,
          discipline: armor.discipline,
          intellect: armor.intellect,
          strength: armor.strength,
          source: armor.source,
        } as IPermutatorArmor;
      });

      nthreads = this.estimateRequiredThreads();

      console.log("nthreads for calculation", nthreads);

      // Values to calculate ETA
      const threadCalculationAmountArr = [...Array(nthreads).keys()].map(() => 0);
      const threadCalculationDoneArr = [...Array(nthreads).keys()].map(() => 0);
      let oldProgressValue = 0;

      // Improve per thread performance by shuffling the inventory
      // sorting is a naive aproach that can be optimized
      // in my test is better than the default order from the db
      this.PermutatorArmorItems = this.PermutatorArmorItems.sort(
        (a, b) => totalStats(b) - totalStats(a)
      );
      this._calculationProgress.next(0);

      for (let n = 0; n < nthreads; n++) {
        this.workers[n] = new Worker(new URL("./results-builder.worker", import.meta.url), {
          name: n.toString(),
        });
        this.workers[n].onmessage = async (ev) => {
          let data = ev.data;
          threadCalculationDoneArr[n] = data.checkedCalculations;
          threadCalculationAmountArr[n] = data.estimatedCalculations;
          const sumTotal = threadCalculationAmountArr.reduce((a, b) => a + b, 0);
          const sumDone = threadCalculationDoneArr.reduce((a, b) => a + b, 0);

          if (
            threadCalculationDoneArr[0] > 0 &&
            threadCalculationDoneArr[1] > 0 &&
            threadCalculationDoneArr[2] > 0
          ) {
            const newProgress = (sumDone / sumTotal) * 100;
            if (newProgress > oldProgressValue + 0.25) {
              oldProgressValue = newProgress;
              this._calculationProgress.next(newProgress);
            }
          }
          if (data.runtime == null) return;

          this.results.push(...(data.results as IPermutatorArmorSet[]));
          if (data.done == true) {
            doneWorkerCount++;
            this.totalPermutationCount += data.stats.permutationCount;
            this.resultMaximumTiers.push(data.runtime.maximumPossibleTiers);
            this.resultMaximumExoticPossibleTiers.push(data.runtime.maximumExoticPossibleTiers);
            for (let elem of data.runtime.statCombo3x100) this.resultStatCombo3x100.add(elem);
            for (let elem of data.runtime.statCombo4x100) this.resultStatCombo4x100.add(elem);
          }
          if (data.done == true && doneWorkerCount == nthreads) {
            this.status.modifyStatus((s) => (s.calculatingResults = false));
            this._calculationProgress.next(0);

            this.endResults = [];
            let permutationHashes = new Map<bigint, number>();
            let permutationSlots = new Set(
              this.results
                .flatMap((a) => a.armor.map((x) => this.InventoryArmorItems.find((y) => y.id == x)))
                .filter((a) => a !== undefined)
                .filter((a) => a!.isExotic)
                .map((a) => a!.slot)
            );

            for (let armorSet of this.results) {
              let items = armorSet.armor.map((x) =>
                this.InventoryArmorItems.find((y) => y.id == x)
              ) as IInventoryArmor[];
              let exotic = items.find((x) => x.isExotic);
              // if the exotics are in 1 slot use the non exotic armor to allow "hotswappability"
              // if the exotics are in 2 different slots, generate the Hash with the other 2 armor pieces, to allow "hotswappability" to cluster near
              // if the exotics are in neither slot we don't care, use all armor
              // if the exotics are in 3 or 4 slots there's no good strategy, cluster for it's non exotic parts
              let legendaryArmor =
                permutationSlots.size == 2
                  ? items.filter((x) => !permutationSlots.has(x.slot))
                  : items.filter((x) => !x.isExotic);

              let R = 0x9e3779b97f4a7c13n; //64bit golden ratio
              let permHash =
                legendaryArmor.reduce(
                  (previousValue, currentValue) =>
                    BigInt(previousValue) *
                    (R + (BigInt((currentValue.itemInstanceId as any) | 0) << 1n)),
                  1n
                ) / 2n;
              let permutationHash = permHash;
              permutationHashes.set(
                permutationHash,
                (permutationHashes.get(permutationHash) ?? 0) + 1
              );
              //let stats = getStatSum(items);
              let tiers = getSkillTier(armorSet.statsWithMods);

              let v = {
                loaded: false,
                exotic:
                  exotic == null
                    ? undefined
                    : {
                        icon: exotic?.icon,
                        watermark: exotic?.watermarkIcon,
                        name: exotic?.name,
                        hash: exotic?.hash,
                      },

                artifice: armorSet.usedArtifice,
                modCount: armorSet.usedMods.length,
                modCost: armorSet.usedMods.reduce(
                  (p, d: StatModifier) => p + STAT_MOD_VALUES[d][2],
                  0
                ),
                mods: armorSet.usedMods,
                stats: armorSet.statsWithMods,
                statsNoMods: armorSet.statsWithoutMods,
                tiers: tiers,
                maxTiers: 10 * (tiers + (5 - armorSet.usedMods.length)),
                waste: getWaste(armorSet.statsWithMods),
                items: items.reduce(
                  (p: any, instance) => {
                    p[instance.slot - 1].push({
                      energyLevel: instance.energyLevel,
                      hash: instance.hash,
                      itemInstanceId: instance.itemInstanceId,
                      name: instance.name,
                      exotic: !!instance.isExotic,
                      masterworked: instance.masterworked,
                      mayBeBugged: instance.mayBeBugged,
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
                    });
                    return p;
                  },
                  [[], [], [], []]
                ),
                classItem: { perk: armorSet.classItemPerk },
                usesCollectionRoll: items.some(
                  (y) => y.source === InventoryArmorSource.Collections
                ),
                usesVendorRoll: items.some((y) => y.source === InventoryArmorSource.Vendor),
                nonExoticsSetHash: permutationHash,
                nonExoticsSetCount: 1,
              } as ResultDefinition;
              this.endResults.push(v);
            }

            //Sort to keep sets with same legendary pieces together
            this.endResults.sort((ob1, ob2) => ob2.tiers - ob1.tiers);
            this.endResults.forEach(
              (item) => (item.nonExoticsSetCount = permutationHashes.get(item.nonExoticsSetHash)!)
            );
            this.endResults.sort((ob1, ob2) => {
              if (ob1.nonExoticsSetHash > ob2.nonExoticsSetHash) {
                return 1;
              } else if (ob1.nonExoticsSetHash < ob2.nonExoticsSetHash) {
                return -1;
              }
              return 0;
            });
            this.endResults.sort((ob1, ob2) => ob2.nonExoticsSetCount - ob1.nonExoticsSetCount);

            console.debug("endResults", this.endResults);
            let minimumMaximumExoticPossibleTiers = [10, 10, 10, 10, 10, 10];
            let maximumExoticPossibleTiersMap = new Map<number, number[]>();
            this.resultMaximumExoticPossibleTiers.forEach((m) => {
              m.forEach((v, k) => {
                let knownMaxForExotic = maximumExoticPossibleTiersMap.get(k) || [0, 0, 0, 0, 0, 0];
                for (let stat = 0; stat < 6; stat++) {
                  knownMaxForExotic[stat] = Math.max(knownMaxForExotic[stat], v[stat]);
                }
                maximumExoticPossibleTiersMap.set(k, knownMaxForExotic);
              });
            });

            maximumExoticPossibleTiersMap.forEach((values, key) => {
              for (let stat = 0; stat < 6; stat++) {
                minimumMaximumExoticPossibleTiers[stat] = Math.min(
                  minimumMaximumExoticPossibleTiers[stat],
                  Math.floor(Math.min(100, values[stat]) / 10)
                );
              }
            });

            console.log(`Values for ${minimumMaximumExoticPossibleTiers}`);

            this._armorResults.next({
              results: this.endResults,
              totalResults: this.totalPermutationCount, // Total amount of results, differs from the real amount if the memory save setting is active
              itemCount: data.stats.itemCount,
              totalTime: Date.now() - startTime,
              minimumMaximumExoticPossibleTiers: minimumMaximumExoticPossibleTiers,
              maximumPossibleTiers: this.resultMaximumTiers
                .reduce(
                  (p, v) => {
                    for (let k = 0; k < 6; k++) if (p[k] < v[k]) p[k] = v[k];
                    return p;
                  },
                  [0, 0, 0, 0, 0, 0]
                )
                .map((k) => Math.floor(Math.min(100, k) / 10)),
              statCombo3x100:
                Array.from(this.resultStatCombo3x100).map((d: number) => {
                  let r: ArmorStat[] = [];
                  for (let n = 0; n < 6; n++) if ((d & (1 << n)) > 0) r.push(n);
                  return r;
                }) || [],
              statCombo4x100:
                Array.from(this.resultStatCombo4x100).map((d: number) => {
                  let r = [];
                  for (let n = 0; n < 6; n++) if ((d & (1 << n)) > 0) r.push(n);
                  return r;
                }, []) || [],
            });
            console.timeEnd("updateResults with WebWorker");
            this.workers[n].terminate();
          } else if (data.done == true && doneWorkerCount != nthreads) this.workers[n].terminate();
        };
        this.workers[n].onerror = (ev) => {
          this.workers[n].terminate();
        };
        this.workers[n].postMessage({
          type: "builderRequest",
          currentClass: this.currentClass,
          config: this._config,
          threadSplit: {
            count: nthreads,
            current: n,
          },
          items: this.PermutatorArmorItems,
          selectedExotics: this.selectedExotics,
        });
      }
    } finally {
    }
  }

  estimateRequiredThreads(): number {
    const helmets = this.PermutatorArmorItems.filter((d) => d.slot == ArmorSlot.ArmorSlotHelmet);
    const gauntlets = this.PermutatorArmorItems.filter(
      (d) => d.slot == ArmorSlot.ArmorSlotGauntlet
    );
    const chests = this.PermutatorArmorItems.filter((d) => d.slot == ArmorSlot.ArmorSlotChest);
    const legs = this.PermutatorArmorItems.filter((d) => d.slot == ArmorSlot.ArmorSlotLegs);
    const estimatedCalculations = this.estimateCombinationsToBeChecked(
      helmets,
      gauntlets,
      chests,
      legs
    );

    const largestArmorBucket = Math.max(
      helmets.length,
      gauntlets.length,
      chests.length,
      legs.length
    );

    let calculationMultiplier = 1.0;
    // very expensive calculations reduce the amount per thread
    if (
      this._config.tryLimitWastedStats &&
      this._config.modOptimizationStrategy != ModOptimizationStrategy.None
    ) {
      calculationMultiplier = 0.7;
    }

    let minimumCalculationPerThread = calculationMultiplier * 5e4;
    let maximumCalculationPerThread = calculationMultiplier * 2.5e5;

    const nthreads = Math.max(
      3, // Enforce a minimum of 3 threads
      Math.min(
        Math.max(1, Math.ceil(estimatedCalculations / minimumCalculationPerThread)),
        Math.ceil(estimatedCalculations / maximumCalculationPerThread),
        Math.floor((navigator.hardwareConcurrency || 2) * 0.75), // limit it to the amount of cores, and only use 75%
        20, // limit it to a maximum of 20 threads
        largestArmorBucket // limit it to the largest armor bucket, as we will split the work by this value
      )
    );

    return nthreads;
  }

  async getItemCountForClass(clazz: DestinyClass, slot?: ArmorSlot) {
    let pieces = await this.db.inventoryArmor.where("clazz").equals(clazz).toArray();
    if (!!slot) pieces = pieces.filter((i) => i.slot == slot);
    //if (!this._config.includeVendorRolls) pieces = pieces.filter((i) => i.source != InventoryArmorSource.Vendor);
    //if (!this._config.includeCollectionRolls) pieces = pieces.filter((i) => i.source != InventoryArmorSource.Collections);
    pieces = pieces.filter((i) => i.source == InventoryArmorSource.Inventory);
    return pieces.length;
  }

  async getExoticsForClass(clazz: DestinyClass, slot?: ArmorSlot): Promise<ClassExoticInfo[]> {
    let inventory = await this.db.inventoryArmor.where("isExotic").equals(1).toArray();
    inventory = inventory.filter(
      (d) => d.clazz == (clazz as any) && d.armor2 && (!slot || d.slot == slot)
    );

    let exotics = await this.db.manifestArmor.where("isExotic").equals(1).toArray();
    exotics = exotics.filter(
      (d) => d.clazz == (clazz as any) && d.armor2 && (!slot || d.slot == slot)
    );

    return exotics.map((ex) => {
      const instances = inventory.filter((i) => i.hash == ex.hash);
      return {
        item: ex,
        inCollection:
          instances.find((i) => i.source === InventoryArmorSource.Collections) !== undefined,
        inInventory:
          instances.find((i) => i.source === InventoryArmorSource.Inventory) !== undefined,
        inVendor: instances.find((i) => i.source === InventoryArmorSource.Vendor) !== undefined,
      };
    });
  }

  async updateManifest(force: boolean = false): Promise<boolean> {
    if (this.status.getStatus().updatingManifest) {
      console.error("Already updating the manifest - abort");
      return false;
    }

    console.debug("updateManifest", "Set s.updatingManifest = true");
    this.status.modifyStatus((s) => (s.updatingManifest = true));
    console.debug("updateManifest", "Call this.api.updateManifest(force) with force=" + force);
    let r = await this.api.updateManifest(force);
    console.debug("updateManifest", "Result is ", r);
    if (!!r) this._manifest.next(null);

    console.debug("updateManifest", "Set s.updatingManifest = false");
    this.status.modifyStatus((s) => (s.updatingManifest = false));
    return !!r;
  }

  async updateInventoryItems(force: boolean = false, errorLoop = 0): Promise<boolean> {
    console.debug("updateManifest", "Set s.updatingInventory = true");
    this.status.modifyStatus((s) => (s.updatingInventory = true));

    try {
      let r = await this.api.updateArmorItems(force);
      console.debug("updateManifest", "Result is ", r);
      console.debug("updateManifest", "Set s.updatingInventory = false");
      this.status.modifyStatus((s) => (s.updatingInventory = false));
      return !!r;
    } catch (e) {
      // After three tries, call it a day.
      if (errorLoop > 3) {
        alert(
          "You encountered a strange error with the inventory update. Please log out and log in again. If that does not fix it, please message Mijago."
        );
        return false;
      }

      this.status.modifyStatus((s) => (s.updatingInventory = false));
      console.error(e);
      console.warn("Automatically re-fetching manifest");
      await this.updateManifest(true);
      return await this.updateInventoryItems(true, errorLoop++);
    }
  }
}
