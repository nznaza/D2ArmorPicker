import { ArmorStat } from "../data/enum/armor-stat";
import {
  buildTuningAcc,
  canCoverRemainingDistance,
  extendTuningAcc,
  filterTuningsBySharedBudget,
  filterTuningsForLockedStats,
  findTuningModHashes,
  generate_tunings,
  t5Improvement,
} from "./results-builder.worker";

describe("results builder tuning cache", () => {
  const legendary = (tuningStat: ArmorStat, balancedBonus: number[]): t5Improvement => ({
    tuningStat,
    archetypeStats: [],
    flexible: false,
    balancedBonus,
  });

  const flexibleExotic = (balancedBonus: number[]): t5Improvement => ({
    tuningStat: null,
    archetypeStats: [],
    flexible: true,
    balancedBonus,
  });

  it("extends a cached legendary base with the same ordered tunings as a full build", () => {
    const base = [
      legendary(0 as ArmorStat, [0, 0, 0, 1, 1, 1]),
      legendary(3 as ArmorStat, [1, 1, 1, 0, 0, 0]),
    ];
    const exotic = flexibleExotic([1, 1, 1, 0, 0, 0]);
    const baseAccumulator = buildTuningAcc(base);
    const baseBeforeExtension = Array.from(baseAccumulator.values());

    const extended = Array.from(extendTuningAcc(baseAccumulator, exotic).values());

    expect(extended).toEqual(generate_tunings([...base, exotic]));
    expect(Array.from(baseAccumulator.values())).toEqual(baseBeforeExtension);
  });

  it("preserves the no-op tuning for an empty cached base", () => {
    expect(Array.from(buildTuningAcc([]).values())).toEqual([[0, 0, 0, 0, 0, 0]]);
  });

  it("returns the exact directional and balanced mod hashes for a selected tuning", () => {
    const improvements = [
      legendary(ArmorStat.StatWeapon, [0, 1, 1, 1, 0, 0]),
      legendary(ArmorStat.StatHealth, [1, 0, 1, 0, 1, 0]),
    ];

    expect(findTuningModHashes(improvements, [5, -5, 0, 0, 0, 0])).toEqual([3121760799]);
    expect(findTuningModHashes(improvements, [1, 1, 2, 1, 1, 0])).toEqual([3122197216, 3122197216]);
  });

  it("ignores untunable armor slots in the DIM mod list", () => {
    expect(
      findTuningModHashes(
        [null, legendary(ArmorStat.StatHealth, [1, 0, 1, 0, 1, 0])],
        [0, 5, 0, 0, 0, -5]
      )
    ).toEqual([388618952]);
  });

  it("removes only tunings that overshoot a locked stat", () => {
    const tunings = [
      [0, 0, 0, 0, 0, 0],
      [5, -5, 0, 0, 0, 0],
      [-5, 5, 0, 0, 0, 0],
      [0, 0, 5, -5, 0, 0],
    ] as any;

    expect(
      filterTuningsForLockedStats(
        tunings,
        [100, 90, 50, 50, 50, 50],
        [true, false, false, false, false, false],
        [100, 0, 0, 0, 0, 0]
      )
    ).toEqual([tunings[0], tunings[2], tunings[3]]);
  });

  it("returns the original tuning array when no stats are locked", () => {
    const tunings = [[5, -5, 0, 0, 0, 0]] as any;
    expect(
      filterTuningsForLockedStats(
        tunings,
        [100, 100, 100, 100, 100, 100],
        [false, false, false, false, false, false],
        [0, 0, 0, 0, 0, 0]
      )
    ).toBe(tunings);
  });

  it("removes tunings whose total remaining target gap exceeds the shared budget", () => {
    const tunings = [
      [5, 5, 0, 0, 0, 0],
      [5, -5, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ] as any;

    expect(
      filterTuningsBySharedBudget(tunings, [90, 90, 100, 100, 100, 100], [100, 100, 0, 0, 0, 0], 10)
    ).toEqual([tunings[0]]);
  });

  it("keeps negative tunings when the shared budget can compensate for them", () => {
    const tunings = [[5, -5, 0, 0, 0, 0]] as any;
    expect(
      filterTuningsBySharedBudget(tunings, [95, 105, 100, 100, 100, 100], [100, 100, 0, 0, 0, 0], 5)
    ).toEqual(tunings);
  });

  it("returns the original tuning array when there are no targets", () => {
    const tunings = [[5, -5, 0, 0, 0, 0]] as any;
    expect(
      filterTuningsBySharedBudget(tunings, [50, 50, 50, 50, 50, 50], [0, 0, 0, 0, 0, 0], 0)
    ).toBe(tunings);
  });

  it("rejects recursion branches that cannot cover their remaining distance", () => {
    expect(
      canCoverRemainingDistance([0, 0, 20, 20, 20, 0], 2, [0, 0, 5, 5, 5, 0], 1, 2, 3)
    ).toBeFalse();
  });

  it("keeps recursion branches within the optimistic resource bound", () => {
    expect(
      canCoverRemainingDistance([0, 0, 14, 14, 14, 0], 2, [0, 0, 5, 5, 5, 0], 1, 2, 3)
    ).toBeTrue();
  });
});
