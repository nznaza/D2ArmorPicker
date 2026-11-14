import { Injectable } from "@angular/core";
import Dexie from "dexie";
import { packT5Arrangements, T5SavedRun, unpackT5Arrangements } from "../data/theorizer";

type StoredRun = Omit<T5SavedRun, "schemaVersion" | "arrangements"> & { schemaVersion: 2 };
type StoredArrangements = { id: number; data: Uint16Array; names?: string[] };

@Injectable({ providedIn: "root" })
export class T5SavedRunsService extends Dexie {
  private runs!: Dexie.Table<StoredRun, number>;
  // Kept apart so listing runs never loads their arrangements.
  private arrangements!: Dexie.Table<StoredArrangements, number>;

  constructor() {
    super("d2ap-t5-saved-runs");
    this.version(1).stores({ runs: "++id, name, createdAt" });
    this.version(2)
      .stores({ runs: "++id, name, createdAt", arrangements: "id" })
      .upgrade(async (transaction) => {
        const runs = transaction.table("runs");
        const arrangements = transaction.table("arrangements");
        for (const run of (await runs.toArray()) as T5SavedRun[]) {
          if (run.schemaVersion !== 1) continue;
          const { arrangements: saved, ...metadata } = run;
          await arrangements.put({ id: run.id!, data: packT5Arrangements(saved) });
          await runs.put({ ...metadata, schemaVersion: 2 });
        }
      });
    // Early v2 records indexed archetypes through a per-run names table.
    this.version(3)
      .stores({ runs: "++id, name, createdAt", arrangements: "id" })
      .upgrade(async (transaction) => {
        const arrangements = transaction.table("arrangements");
        for (const record of (await arrangements.toArray()) as StoredArrangements[]) {
          if (!record.names) continue;
          const data = packT5Arrangements(
            unpackT5Arrangements(Uint16Array.from(Object.values(record.data)), record.names)
          );
          await arrangements.put({ id: record.id, data });
        }
      });
  }

  async list(): Promise<Pick<T5SavedRun, "id" | "name" | "createdAt" | "complete">[]> {
    return (await this.runs.orderBy("createdAt").reverse().toArray()).map(
      ({ id, name, createdAt, complete }) => ({ id, name, createdAt, complete })
    );
  }

  async save(run: T5SavedRun): Promise<number> {
    const name = run.name.trim();
    if (!name) throw new Error("Enter a name for the saved run.");
    const data = packT5Arrangements(run.arrangements);
    return this.transaction("rw", this.runs, this.arrangements, async () => {
      const id = await this.runs.add({
        name,
        createdAt: run.createdAt,
        configuration: run.configuration,
        options: { ...run.options, prioritizeMatches: run.options.prioritizeMatches ?? true },
        complete: run.complete,
        schemaVersion: 2,
      });
      await this.arrangements.put({ id, data });
      return id;
    });
  }

  async get(id: number): Promise<T5SavedRun> {
    const [run, packed] = await Promise.all([this.runs.get(id), this.arrangements.get(id)]);
    if (!run || !packed) throw new Error("The saved run could not be found.");
    if (run.schemaVersion !== 2) throw new Error("This saved run uses an unsupported format.");
    return {
      ...run,
      schemaVersion: 1,
      arrangements: unpackT5Arrangements(packed.data, packed.names),
    };
  }

  async remove(id: number): Promise<void> {
    await this.transaction("rw", this.runs, this.arrangements, async () => {
      await this.runs.delete(id);
      await this.arrangements.delete(id);
    });
  }
}
