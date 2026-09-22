import { mkdir, readFile, rename, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AnalysisRecord } from "../shared/types";
import { librarySchema } from "./validation.js";
import { StorageError } from "./errors.js";

/** One application process owns a store. Mutations serialize across async requests. */
export class AnalysisStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(private readonly directory: string) {
    this.file = join(directory, "analyses.json");
  }

  private async read(): Promise<AnalysisRecord[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new StorageError();
    }
    try {
      return librarySchema.parse(JSON.parse(text));
    } catch {
      throw new StorageError();
    }
  }

  async list(): Promise<AnalysisRecord[]> {
    await this.queue;
    return (await this.read()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async mutate<T>(operation: (records: AnalysisRecord[]) => T): Promise<T> {
    const task = this.queue.then(async () => {
      const records = await this.read();
      const result = operation(records);
      librarySchema.parse(records);
      await mkdir(this.directory, { recursive: true });
      const temporary = join(this.directory, `.analyses-${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(JSON.stringify(records, null, 2));
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, this.file);
      } finally {
        await handle?.close().catch(() => {});
        await unlink(temporary).catch(() => {});
      }
      return structuredClone(result);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
