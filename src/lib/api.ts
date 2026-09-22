import type {
  AnalysisInput,
  AnalysisRecord,
  Capabilities,
} from "../../shared/types";
import { browserStore } from "./browser-store";
import { uploadLimitBytes } from "./media";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `The request could not be completed (${response.status}).`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
let healthCache:
  { promise: Promise<Capabilities>; expires: number } | undefined;
function health(): Promise<Capabilities> {
  if (healthCache && Date.now() < healthCache.expires)
    return healthCache.promise;
  const promise = request<Capabilities>("/api/health");
  healthCache = { promise, expires: Infinity };
  void promise.then(
    () => {
      if (healthCache?.promise === promise)
        healthCache.expires = Date.now() + 60_000;
    },
    () => {
      if (healthCache?.promise === promise) healthCache = undefined;
    },
  );
  return promise;
}

export const api = {
  health,
  list: async () =>
    (await health()).storageMode === "browser"
      ? browserStore.list()
      : request<AnalysisRecord[]>("/api/analyses"),
  analyze: async (input: AnalysisInput, file: File | null) => {
    const capabilities = await health();
    if (
      file &&
      file.size >
        uploadLimitBytes(capabilities.maxUploadMb, capabilities.maxUploadBytes)
    ) {
      throw new Error(
        `This server accepts files up to ${capabilities.maxUploadMb} MB. Choose a smaller file and try again.`,
      );
    }
    const body = new FormData();
    body.append("input", JSON.stringify(input));
    if (file) body.append("file", file);
    const record = await request<AnalysisRecord>("/api/analyze", {
      method: "POST",
      body,
    });
    return capabilities.storageMode === "browser"
      ? browserStore.add(record)
      : record;
  },
  update: async (id: string, changes: Record<string, unknown>) =>
    (await health()).storageMode === "browser"
      ? browserStore.update(id, changes)
      : request<AnalysisRecord>(`/api/analyses/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        }),
  remove: async (id: string) =>
    (await health()).storageMode === "browser"
      ? browserStore.remove(id)
      : request<void>(`/api/analyses/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
};
