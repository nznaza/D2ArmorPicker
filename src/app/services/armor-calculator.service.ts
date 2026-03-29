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

import { Injectable, OnDestroy } from "@angular/core";
import { NGXLogger } from "ngx-logger";
import { Router } from "@angular/router";
import { DatabaseService } from "./database.service";
import { IManifestArmor } from "../data/types/IManifestArmor";
import { BehaviorSubject, Observable, Subject } from "rxjs";
import { BuildConfiguration } from "../data/buildConfiguration";
import { STAT_MOD_VALUES } from "../data/enum/armor-stat";
import { StatusProviderService } from "./status-provider.service";
import { ConfigurationService } from "./configuration.service";
import { UserInformationService } from "./user-information.service";
import { ArmorSlot } from "../data/enum/armor-slot";
import {
  ResultDefinition,
  ResultItem,
} from "../components/authenticated-v2/results/results.component";
import { IInventoryArmor, InventoryArmorSource, totalStats } from "../data/types/IInventoryArmor";
import { DestinyClass, TierType } from "bungie-api-ts/destiny2";
import { IPermutatorArmorSet } from "../data/types/IPermutatorArmorSet";
import { getSkillTier, getWaste } from "./results-builder.worker";
import { IPermutatorArmor } from "../data/types/IPermutatorArmor";
import { FORCE_USE_NO_EXOTIC, MAXIMUM_MASTERWORK_LEVEL } from "../data/constants";
import { ModOptimizationStrategy } from "../data/enum/mod-optimization-strategy";
import { ArmorSystem } from "../data/types/IManifestArmor";
import { combineLatest, Subscription } from "rxjs";
import { debounceTime, distinctUntilChanged, catchError, startWith } from "rxjs/operators";
import { of } from "rxjs";

type info = {
  results: ResultDefinition[];
  totalResults: number;
  maximumPossibleTiers: number[];
  itemCount: number;
  totalTime: number;
};

@Injectable({
  providedIn: "root",
})
export class ArmorCalculatorService implements OnDestroy {
  private _armorResults: BehaviorSubject<info>;
  public readonly armorResults: Observable<info>;
  private _reachableTiers: BehaviorSubject<number[]>;
  public readonly reachableTiers: Observable<number[]>;
  private _calculationProgress: Subject<number> = new Subject<number>();
  public readonly calculationProgress: Observable<number> =
    this._calculationProgress.asObservable();

  private workers: Worker[];
  private totalPermutationCount = 0;
  private resultMaximumTiers: number[][] = [];
  private selectedExotics: IManifestArmor[] = [];
  private inventoryArmorItems: IInventoryArmor[] = [];
  private permutatorArmorItems: IPermutatorArmor[] = [];
  private endResults: ResultDefinition[] = [];
  private allArmorResults: ResultDefinition[] = [];

  private calculationSubscription?: Subscription;

  constructor(
    private db: DatabaseService,
    private status: StatusProviderService,
    private userInfo: UserInformationService,
    private config: ConfigurationService,
    private logger: NGXLogger,
    private router: Router
  ) {
    this.logger.debug(
      "ArmorCalculatorService",
      "constructor",
      "Initializing ArmorCalculatorService"
    );

    this._armorResults = new BehaviorSubject({
      results: this.allArmorResults,
    } as info);
    this.armorResults = this._armorResults.asObservable();

    this._reachableTiers = new BehaviorSubject([0, 0, 0, 0, 0, 0]);
    this.reachableTiers = this._reachableTiers.asObservable();

    this.workers = [];

    // Setup calculation triggers - use longer delay to ensure services are ready
    setTimeout(() => this.setupCalculationTriggers(), 100);

    this.logger.debug(
      "ArmorCalculatorService",
      "constructor",
      "Finished initializing ArmorCalculatorService"
    );
  }

  ngOnDestroy() {
    this.logger.debug("ArmorCalculatorService", "ngOnDestroy", "Destroying ArmorCalculatorService");
    this.calculationSubscription?.unsubscribe();
    this.killWorkers();
    this.logger.debug(
      "ArmorCalculatorService",
      "ngOnDestroy",
      "Finished destroying ArmorCalculatorService"
    );
  }

  private setupCalculationTriggers() {
    this.logger.debug(
      "ArmorCalculatorService",
      "setupCalculationTriggers",
      "Setting up calculation triggers"
    );

    try {
      // Verify services are available
      if (!this.userInfo) {
        this.logger.error(
          "ArmorCalculatorService",
          "setupCalculationTriggers",
          "UserInformationService not available"
        );
        return;
      }

      if (!this.config) {
        this.logger.error(
          "ArmorCalculatorService",
          "setupCalculationTriggers",
          "ConfigurationService not available"
        );
        return;
      }

      this.logger.debug(
        "ArmorCalculatorService",
        "setupCalculationTriggers",
        "Services available, setting up observables"
      );

      // this.router.events
      //   .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      //   .subscribe((event) => {
      //     this.logger.debug(
      //       "ArmorCalculatorService",
      //       "setupCalculationTriggers",
      //       "Route changed to: " + event.url
      //     );
      //   });

      // Set up single subscription that persists throughout the service lifecycle
      // Use startWith to ensure all observables have initial values for combineLatest
      this.calculationSubscription = combineLatest([
        this.userInfo.inventory.pipe(startWith(null)), // Start with null to ensure emission
        this.config.configuration,
      ])
        .pipe(
          debounceTime(100),
          distinctUntilChanged(),
          catchError((error) => {
            this.logger.error(
              "ArmorCalculatorService",
              "setupCalculationTriggers",
              "Error in observable stream: " + error
            );
            return of([null, null]); // Return empty values to continue the stream
          })
        )
        .subscribe({
          next: ([inventory, config]) => {
            // Only perform calculations if we're on the main page
            if (!this.isMainPage()) {
              this.logger.debug(
                "ArmorCalculatorService",
                "setupCalculationTriggers",
                "Not on main page, skipping calculation"
              );
              return;
            }

            if (!config) {
              return;
            }

            const buildConfig = config as BuildConfiguration;
            if (buildConfig.characterClass !== DestinyClass.Unknown) {
              this.logger.info(
                "ArmorCalculatorService",
                "setupCalculationTriggers",
                "Triggering calculation for class: " + buildConfig.characterClass
              );
              this.updateResults(buildConfig, buildConfig.characterClass);
            }
          },
          error: (error) => {
            this.logger.error(
              "ArmorCalculatorService",
              "setupCalculationTriggers",
              "Subscription error: " + error
            );
          },
        });

      this.logger.debug(
        "ArmorCalculatorService",
        "setupCalculationTriggers",
        "Calculation triggers set up successfully"
      );
    } catch (error) {
      this.logger.error(
        "ArmorCalculatorService",
        "setupCalculationTriggers",
        "Failed to setup triggers: " + error
      );
    }
  }

  private isMainPage(): boolean {
    const currentUrl = this.router.url;
    // Main page is either empty path or just '/'
    return currentUrl === "/" || currentUrl === "" || currentUrl.split("?")[0] === "/";
  }

  private clearResults() {
    this.allArmorResults = [];
    this._armorResults.next({
      results: this.allArmorResults,
      totalResults: 0,
      totalTime: 0,
      itemCount: 0,
      maximumPossibleTiers: [0, 0, 0, 0, 0, 0],
    });
  }

  private killWorkers() {
    this.logger.debug("ArmorCalculatorService", "killWorkers", "Terminating all workers");
    this.workers.forEach((w) => {
      w.terminate();
    });
    this.workers = [];
  }

  private estimateCombinationsToBeChecked(
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

    totalCalculations +=
      legendaryHelmets * legendaryGauntlets * legendaryChests * legendaryLegs * legendaryClassItems;
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

  cancelCalculation() {
    this.logger.info("ArmorCalculatorService", "cancelCalculation", "Cancelling calculation");
    this.killWorkers();
    this.status.modifyStatus((s) => (s.calculatingResults = false));
    this.status.modifyStatus((s) => (s.cancelledCalculation = true));

    this._calculationProgress.next(0);
    this.clearResults();
  }

  private bucketBySlot(): Map<ArmorSlot, IPermutatorArmor[]> {
    const buckets = new Map<ArmorSlot, IPermutatorArmor[]>([
      [ArmorSlot.ArmorSlotHelmet, []],
      [ArmorSlot.ArmorSlotGauntlet, []],
      [ArmorSlot.ArmorSlotChest, []],
      [ArmorSlot.ArmorSlotLegs, []],
      [ArmorSlot.ArmorSlotClass, []],
    ]);
    for (const item of this.permutatorArmorItems) {
      buckets.get(item.slot)?.push(item);
    }
    return buckets;
  }

  estimateRequiredThreads(
    config: BuildConfiguration,
    buckets: Map<ArmorSlot, IPermutatorArmor[]>
  ): number {
    const helmets = buckets.get(ArmorSlot.ArmorSlotHelmet)!;
    const gauntlets = buckets.get(ArmorSlot.ArmorSlotGauntlet)!;
    const chests = buckets.get(ArmorSlot.ArmorSlotChest)!;
    const legs = buckets.get(ArmorSlot.ArmorSlotLegs)!;
    const classItems = buckets.get(ArmorSlot.ArmorSlotClass)!;
    const estimatedCalculations = this.estimateCombinationsToBeChecked(
      helmets,
      gauntlets,
      chests,
      legs,
      classItems
    );

    const largestArmorBucket = Math.max(
      helmets.length,
      gauntlets.length,
      chests.length,
      legs.length,
      classItems.length
    );

    let calculationMultiplier = 1.0;
    // very expensive calculations reduce the amount per thread
    if (
      config.tryLimitWastedStats &&
      config.modOptimizationStrategy != ModOptimizationStrategy.None
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

  // Manual trigger method for testing
  manualTriggerCalculation() {
    this.logger.info(
      "ArmorCalculatorService",
      "manualTriggerCalculation",
      "Manually triggering calculation"
    );
    const config = this.config.readonlyConfigurationSnapshot;
    if (config && config.characterClass !== DestinyClass.Unknown) {
      this.updateResults(config, config.characterClass);
    } else {
      this.logger.warn(
        "ArmorCalculatorService",
        "manualTriggerCalculation",
        "No valid config available for manual trigger"
      );
    }
  }

  async updateResults(
    config: BuildConfiguration,
    currentClass: DestinyClass,
    nthreads: number = 3
  ) {
    if (config.characterClass == DestinyClass.Unknown) {
      this.logger.info(
        "ArmorCalculatorService",
        "updateResults",
        "Character class is unknown, probably not loaded yet, skipping updateResults"
      );
      return;
    }
    this.clearResults();
    this.killWorkers();

    try {
      const updateResultsStart = performance.now();
      this.status.modifyStatus((s) => (s.calculatingResults = true));
      this.status.modifyStatus((s) => (s.cancelledCalculation = false));
      let doneWorkerCount = 0;

      this.endResults = [];
      this.totalPermutationCount = 0;
      this.resultMaximumTiers = [];
      const startTime = Date.now();

      this.selectedExotics = await Promise.all(
        config.selectedExotics
          .filter((hash) => hash != FORCE_USE_NO_EXOTIC)
          .map(
            async (hash) =>
              (await this.db.manifestArmor.where("hash").equals(hash).first()) as IManifestArmor
          )
      );
      this.selectedExotics = this.selectedExotics.filter((i) => !!i);

      this.inventoryArmorItems = (await this.db.inventoryArmor
        .where("clazz")
        .equals(config.characterClass)
        .distinct()
        .toArray()) as IInventoryArmor[];

      const disabledItemsSet = new Set(config.disabledItems);
      const noExoticSelected = config.selectedExotics.indexOf(FORCE_USE_NO_EXOTIC) > -1;
      const selectedExoticHashes = new Set(this.selectedExotics.map((e) => e.hash));
      const selectedExoticSlots = new Set(this.selectedExotics.map((e) => e.slot));
      const hasSelectedExotics = this.selectedExotics.length > 0;

      // Build inventory key set for collection/vendor dedup (first pass)
      const inventoryItemKeys = new Set<string>();
      for (const item of this.inventoryArmorItems) {
        if (item.source === InventoryArmorSource.Inventory) {
          inventoryItemKeys.add(
            `${item.slot}:${item.hash}:${item.mobility}:${item.resilience}:${item.recovery}:${item.discipline}:${item.intellect}:${item.strength}`
          );
        }
      }

      // Single-pass filter + field stripping (replaces 12 chained .filter() + .map())
      const rawItems = this.inventoryArmorItems;
      this.permutatorArmorItems = [];
      this.inventoryArmorItems = [];

      for (let idx = 0; idx < rawItems.length; idx++) {
        const item = rawItems[idx];
        if (item.slot == ArmorSlot.ArmorSlotNone) continue;
        if (disabledItemsSet.has(item.itemInstanceId)) continue;
        if (!item.isExotic && config.enforceFeaturedLegendaryArmor && !item.isFeatured) continue;
        if (item.isExotic && config.enforceFeaturedExoticArmor && !item.isFeatured) continue;
        if (
          item.armorSystem !== ArmorSystem.Armor3 &&
          !item.isExotic &&
          !config.allowLegacyLegendaryArmor
        )
          continue;
        if (
          item.armorSystem !== ArmorSystem.Armor3 &&
          item.isExotic &&
          !config.allowLegacyExoticArmor
        )
          continue;
        if (item.source === InventoryArmorSource.Collections && !config.includeCollectionRolls)
          continue;
        if (item.source === InventoryArmorSource.Vendor && !config.includeVendorRolls) continue;
        if (noExoticSelected && item.isExotic) continue;
        if (hasSelectedExotics) {
          if (item.isExotic && !selectedExoticHashes.has(item.hash)) continue;
          if (!item.isExotic && selectedExoticSlots.has(item.slot)) continue;
        }
        if (
          config.onlyUseMasterworkedExotics &&
          item.rarity == TierType.Exotic &&
          item.masterworkLevel != MAXIMUM_MASTERWORK_LEVEL
        )
          continue;
        if (
          config.onlyUseMasterworkedLegendaries &&
          item.rarity == TierType.Superior &&
          item.masterworkLevel != MAXIMUM_MASTERWORK_LEVEL
        )
          continue;
        if (
          !config.allowBlueArmorPieces &&
          item.rarity != TierType.Exotic &&
          item.rarity != TierType.Superior
        )
          continue;
        if (config.ignoreSunsetArmor && item.isSunset) continue;
        // Collection/vendor dedup
        if (item.source !== InventoryArmorSource.Inventory) {
          const key = `${item.slot}:${item.hash}:${item.mobility}:${item.resilience}:${item.recovery}:${item.discipline}:${item.intellect}:${item.strength}`;
          if (inventoryItemKeys.has(key)) continue;
        }

        this.inventoryArmorItems.push(item);
        // Inline field stripping (avoids separate .map() pass)
        this.permutatorArmorItems.push({
          id: item.id,
          hash: item.hash,
          slot: item.slot,
          perk: item.perk,
          isExotic: item.isExotic,
          masterworkLevel: item.masterworkLevel,
          archetypeStats: item.archetypeStats,
          mobility: item.mobility,
          resilience: item.resilience,
          recovery: item.recovery,
          discipline: item.discipline,
          intellect: item.intellect,
          strength: item.strength,
          source: item.source,
          exoticPerkHash: item.exoticPerkHash,
          gearSetHash: item.gearSetHash ?? null,
          tuningStat: item.tuningStat,
          energyLevel: item.energyLevel,
          tier: item.tier,
          armorSystem: item.armorSystem,
        } as unknown as IPermutatorArmor);
      }

      // Sort by total stats descending before bucketing so bucket arrays inherit the order
      this.permutatorArmorItems = this.permutatorArmorItems.sort(
        (a, b) => totalStats(b) - totalStats(a)
      );

      const slotBuckets = this.bucketBySlot();
      if (
        this.permutatorArmorItems.length == 0 ||
        slotBuckets.get(ArmorSlot.ArmorSlotHelmet)!.length == 0 ||
        slotBuckets.get(ArmorSlot.ArmorSlotGauntlet)!.length == 0 ||
        slotBuckets.get(ArmorSlot.ArmorSlotChest)!.length == 0 ||
        slotBuckets.get(ArmorSlot.ArmorSlotLegs)!.length == 0 ||
        slotBuckets.get(ArmorSlot.ArmorSlotClass)!.length == 0
      ) {
        this.logger.warn(
          "ArmorCalculatorService",
          "updateResults",
          "Incomplete armor items available for permutation, skipping calculation"
        );
        this.status.modifyStatus((s) => (s.calculatingResults = false));
        return;
      }
      nthreads = this.estimateRequiredThreads(config, slotBuckets);
      this.logger.info("ArmorCalculatorService", "updateResults", "Estimated threads: " + nthreads);

      // Values to calculate ETA
      const threadCalculationAmountArr = [...Array(nthreads).keys()].map(() => 0);
      const threadCalculationDoneArr = [...Array(nthreads).keys()].map(() => 0);
      const threadCalculationReachableTiers: number[][] = [...Array(nthreads).keys()].map(() =>
        Array(6).fill(0)
      );
      let oldProgressValue = 0;
      let runningTotal = 0;
      let runningDone = 0;
      this._calculationProgress.next(0);

      // Build ID→item map once before workers start for O(1) lookups during result mapping
      const itemById = new Map<number, IInventoryArmor>();
      for (const item of this.inventoryArmorItems) {
        itemById.set(item.id, item);
      }

      for (let n = 0; n < nthreads; n++) {
        this.workers[n] = new Worker(new URL("./results-builder.worker", import.meta.url), {
          name: n.toString(),
        });
        this.workers[n].onmessage = async (ev) => {
          let data = ev.data;
          runningTotal += data.estimatedCalculations - threadCalculationAmountArr[n];
          runningDone += data.checkedCalculations - threadCalculationDoneArr[n];
          threadCalculationAmountArr[n] = data.estimatedCalculations;
          threadCalculationDoneArr[n] = data.checkedCalculations;
          threadCalculationReachableTiers[n] =
            data.reachableTiers || data.runtime.maximumPossibleTiers;
          const maxReachableTiers: number[] = [0, 0, 0, 0, 0, 0];
          for (let t = 0; t < nthreads; t++) {
            const arr = threadCalculationReachableTiers[t];
            for (let s = 0; s < 6; s++) {
              if (arr[s] > maxReachableTiers[s]) maxReachableTiers[s] = arr[s];
            }
          }
          for (let s = 0; s < 6; s++) {
            maxReachableTiers[s] = Math.min(200, maxReachableTiers[s]) / 10;
          }
          this._reachableTiers.next(maxReachableTiers);

          if (threadCalculationDoneArr.every((v) => v > 0)) {
            const newProgress = (runningDone / runningTotal) * 100;
            if (newProgress > oldProgressValue + 0.25) {
              oldProgressValue = newProgress;
              this._calculationProgress.next(newProgress);
            }
          }
          if (data.runtime == null) return;

          const batchResults = data.results as IPermutatorArmorSet[];
          for (let ri = 0; ri < batchResults.length; ri++) {
            const armorSet = batchResults[ri];
            const armorIds = armorSet.armor;
            const resultItems: ResultItem[] = new Array(armorIds.length);
            let exotic: IInventoryArmor | undefined;
            let usesCollectionRoll = false;
            let usesVendorRoll = false;

            for (let ii = 0; ii < armorIds.length; ii++) {
              const instance = itemById.get(armorIds[ii])!;
              if (instance.isExotic) exotic = instance;
              if (instance.source === InventoryArmorSource.Collections) usesCollectionRoll = true;
              if (instance.source === InventoryArmorSource.Vendor) usesVendorRoll = true;
              resultItems[ii] = {
                tuningStat: instance.tuningStat,
                energyLevel: instance.energyLevel,
                hash: instance.hash,
                itemInstanceId: instance.itemInstanceId,
                name: instance.name,
                exotic: !!instance.isExotic,
                masterworked: instance.masterworkLevel == MAXIMUM_MASTERWORK_LEVEL,
                archetypeStats: instance.archetypeStats,
                armorSystem: instance.armorSystem,
                masterworkLevel: instance.masterworkLevel,
                slot: instance.slot,
                perk: instance.perk,
                transferState: 0,
                tier: instance.tier,
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
              };
            }

            const usedMods = armorSet.usedMods;
            let modCost = 0;
            for (let mi = 0; mi < usedMods.length; mi++) {
              modCost += STAT_MOD_VALUES[usedMods[mi]][2];
            }

            this.endResults.push({
              loaded: false,
              tuningStats: armorSet.tuning,
              exotic:
                exotic == null
                  ? undefined
                  : {
                      icon: exotic.icon,
                      watermark: exotic.watermarkIcon,
                      name: exotic.name,
                      hash: exotic.hash,
                    },
              artifice: armorSet.usedArtifice,
              modCount: usedMods.length,
              modCost,
              mods: usedMods,
              stats: armorSet.statsWithMods,
              statsNoMods: armorSet.statsWithoutMods,
              tiers: getSkillTier(armorSet.statsWithMods),
              waste: getWaste(armorSet.statsWithMods),
              items: resultItems,
              usesCollectionRoll,
              usesVendorRoll,
            });
          }
          if (data.done == true) {
            doneWorkerCount++;
            this.totalPermutationCount += data.stats.permutationCount;
            this.resultMaximumTiers.push(data.runtime.maximumPossibleTiers);
          }
          if (data.done == true && doneWorkerCount == nthreads) {
            this.status.modifyStatus((s) => (s.calculatingResults = false));
            this._calculationProgress.next(0);

            this._armorResults.next({
              results: this.endResults,
              totalResults: this.totalPermutationCount, // Total amount of results, differs from the real amount if the memory save setting is active
              itemCount: data.stats.itemCount,
              totalTime: Date.now() - startTime,
              maximumPossibleTiers: (() => {
                const maxTiers = [0, 0, 0, 0, 0, 0];
                for (let t = 0; t < this.resultMaximumTiers.length; t++) {
                  const v = this.resultMaximumTiers[t];
                  for (let k = 0; k < 6; k++) if (v[k] > maxTiers[k]) maxTiers[k] = v[k];
                }
                for (let k = 0; k < 6; k++) maxTiers[k] = Math.min(200, maxTiers[k]) / 10;
                return maxTiers;
              })(),
            });
            const updateResultsEnd = performance.now();
            this.logger.info(
              "ArmorCalculatorService",
              "updateResults",
              `updateResults with WebWorker took ${updateResultsEnd - updateResultsStart} ms`
            );
            this.workers[n].terminate();
          } else if (data.done == true && doneWorkerCount != nthreads) this.workers[n].terminate();
        };
        this.workers[n].onerror = (ev) => {
          this.workers[n].terminate();
        };

        // Strip fields the worker never reads to reduce structured clone cost
        const workerConfig = { ...config, disabledItems: [] as string[] };
        this.workers[n].postMessage({
          type: "builderRequest",
          config: workerConfig,
          threadSplit: {
            count: nthreads,
            current: n,
          },
          helmets: slotBuckets.get(ArmorSlot.ArmorSlotHelmet)!,
          gauntlets: slotBuckets.get(ArmorSlot.ArmorSlotGauntlet)!,
          chests: slotBuckets.get(ArmorSlot.ArmorSlotChest)!,
          legs: slotBuckets.get(ArmorSlot.ArmorSlotLegs)!,
          classItems: slotBuckets.get(ArmorSlot.ArmorSlotClass)!,
        });
      }
    } finally {
    }
  }
}
