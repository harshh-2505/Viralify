import type { AnalysisRecord } from "../../shared/types";
// This validation module is deliberately browser-safe: it imports only Zod and
// uses no server runtime APIs. Sharing it keeps cloud and local edits identical.
import { patchSchema, recordSchema } from "../../server/validation";

const STORE_NAME = "analyses";

export class BrowserStorageError extends Error {
  constructor(
    message = "Your browser could not save or read the library. Check available storage and browser permissions, then try again.",
  ) {
    super(message);
    this.name = "BrowserStorageError";
  }
}

function storageError(error: unknown): BrowserStorageError {
  if (error instanceof BrowserStorageError) return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new BrowserStorageError(
      "Your browser storage is full. Export reports you want to keep, remove unneeded reports, and try again.",
    );
  }
  return new BrowserStorageError();
}

function readRecord(value: unknown): AnalysisRecord {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) {
    throw new BrowserStorageError(
      "A saved browser report is invalid and could not be read. Your stored data has not been replaced.",
    );
  }
  return parsed.data;
}

interface BrowserStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  now?: () => number;
}

/** Per-origin persistence. Writes resolve only after the IndexedDB transaction commits. */
export class BrowserAnalysisStore {
  private connection?: Promise<IDBDatabase>;
  private readonly name: string;
  private readonly clock: () => number;

  constructor(private readonly options: BrowserStoreOptions = {}) {
    this.name = options.databaseName ?? "viralify-library";
    this.clock = options.now ?? Date.now;
  }

  private database(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    const factory = this.options.indexedDB ?? globalThis.indexedDB;
    if (!factory)
      return Promise.reject(
        new BrowserStorageError(
          "Browser storage is unavailable. Enable IndexedDB in this browser to save your reports.",
        ),
      );
    const connection = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let failed = false;
      try {
        request = factory.open(this.name, 1);
      } catch (error) {
        reject(storageError(error));
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onerror = () => {
        failed = true;
        reject(storageError(request.error));
      };
      request.onblocked = () => {
        failed = true;
        reject(
          new BrowserStorageError(
            "A different Viralify tab is blocking a library update. Close other tabs for this site and try again.",
          ),
        );
      };
      request.onsuccess = () => {
        const database = request.result;
        if (failed) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          this.connection = undefined;
        };
        database.onclose = () => {
          this.connection = undefined;
        };
        resolve(database);
      };
    });
    this.connection = connection;
    void connection.catch(() => {
      if (this.connection === connection) this.connection = undefined;
    });
    return connection;
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    operation: (
      store: IDBObjectStore,
      result: (value: T) => void,
      fail: (error: Error) => void,
    ) => void,
  ): Promise<T> {
    const database = await this.database();
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      let result: T;
      let hasResult = false;
      let failure: Error | undefined;
      try {
        transaction = database.transaction(STORE_NAME, mode);
      } catch (error) {
        reject(storageError(error));
        return;
      }
      const fail = (error: Error) => {
        failure = error;
        try {
          transaction.abort();
        } catch {
          reject(error);
        }
      };
      transaction.oncomplete = () => {
        if (hasResult) resolve(result);
        else reject(new BrowserStorageError());
      };
      transaction.onabort = () =>
        reject(failure ?? storageError(transaction.error));
      transaction.onerror = () => {
        /* The transaction abort handler reports the failure. */
      };
      try {
        operation(
          transaction.objectStore(STORE_NAME),
          (value) => {
            result = value;
            hasResult = true;
          },
          fail,
        );
      } catch (error) {
        fail(error instanceof Error ? error : storageError(error));
      }
    });
  }

  async list(): Promise<AnalysisRecord[]> {
    return this.transaction("readonly", (store, result, fail) => {
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          result(
            request.result
              .map(readRecord)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          );
        } catch (error) {
          fail(storageError(error));
        }
      };
    });
  }

  async add(record: AnalysisRecord): Promise<AnalysisRecord> {
    const parsed = recordSchema.safeParse(record);
    if (!parsed.success)
      throw new BrowserStorageError(
        "The analysis response was invalid and could not be saved. Your existing reports have not changed.",
      );
    return this.transaction("readwrite", (store, result) => {
      const request = store.add(parsed.data);
      request.onsuccess = () => result(parsed.data);
    });
  }

  async update(
    id: string,
    changes: Record<string, unknown>,
  ): Promise<AnalysisRecord> {
    const parsed = patchSchema.safeParse(changes);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues.map((issue) => issue.message).join(" "),
      );
    const patch = parsed.data;
    return this.transaction("readwrite", (store, result, fail) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          if (!request.result)
            throw new Error("Analysis not found in this browser.");
          const record = readRecord(request.result);
          const now = this.clock();
          if (patch.scheduledAt && new Date(patch.scheduledAt).getTime() <= now)
            throw new Error("Choose a release time in the future.");
          if (patch.scheduledAt === null) {
            delete record.scheduledAt;
            if (record.status === "scheduled") record.status = "analyzed";
          } else if (patch.scheduledAt) {
            record.scheduledAt = new Date(patch.scheduledAt).toISOString();
            record.status = "scheduled";
          }
          if (patch.status) record.status = patch.status;
          if (
            record.status === "scheduled" &&
            (!record.scheduledAt ||
              new Date(record.scheduledAt).getTime() <= now)
          ) {
            throw new Error(
              "A scheduled item must have a release time in the future.",
            );
          }
          if (patch.status === "analyzed") delete record.scheduledAt;
          if (patch.outcomes) record.outcomes = patch.outcomes;
          record.updatedAt = new Date(now).toISOString();
          const validated = readRecord(record);
          const saved = store.put(validated);
          saved.onsuccess = () => result(validated);
        } catch (error) {
          fail(error instanceof Error ? error : storageError(error));
        }
      };
    });
  }

  async remove(id: string): Promise<void> {
    return this.transaction("readwrite", (store, result, fail) => {
      const request = store.getKey(id);
      request.onsuccess = () => {
        if (request.result === undefined) {
          fail(new Error("Analysis not found in this browser."));
          return;
        }
        store.delete(id).onsuccess = () => result(undefined);
      };
    });
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (connection) (await connection).close();
  }
}

export const browserStore = new BrowserAnalysisStore();
