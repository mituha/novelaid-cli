import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const DEFAULT_LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234/v1";

export interface LmStudioModelInfo {
  id: string;
  object?: string;
  owned_by?: string;
}

export interface ModelConnectionStatus {
  provider: string;
  connected: boolean;
  baseUrl?: string;
  models: Array<{ id: string; name: string; contextWindow: number }>;
  error?: string;
}

/**
 * LM Studio サーバーのエンドポイントから利用可能なモデル一覧を取得します。
 */
export async function fetchLmStudioModels(baseUrl: string = DEFAULT_LM_STUDIO_URL): Promise<LmStudioModelInfo[]> {
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = (await res.json()) as { data?: LmStudioModelInfo[] };
    return data.data ?? [];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`LM Studio サーバー (${url}) に接続できませんでした: ${message}`);
  }
}

/**
 * Pi SDK の ModelRuntime を初期化し、LM Studio プロバイダーを登録します。
 */
export async function initializeModelRuntime(options?: {
  lmStudioUrl?: string;
}): Promise<{
  runtime: ModelRuntime;
  lmStudioStatus: ModelConnectionStatus;
}> {
  const lmStudioUrl = options?.lmStudioUrl || DEFAULT_LM_STUDIO_URL;

  // ModelRuntime の初期化
  const runtime = await ModelRuntime.create({
    allowModelNetwork: true,
  });

  let lmStudioStatus: ModelConnectionStatus;

  try {
    const fetched = await fetchLmStudioModels(lmStudioUrl);

    const sdkModels = fetched.map((m) => ({
      id: m.id,
      name: m.id,
      api: "openai-completions" as const,
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      input: ["text" as const],
    }));

    // プロバイダー登録
    runtime.registerProvider("lm-studio", {
      name: "LM Studio",
      baseUrl: lmStudioUrl,
      apiKey: "lm-studio",
      api: "openai-completions",
      models: sdkModels,
    });

    const registeredModels = runtime.getModels("lm-studio");

    lmStudioStatus = {
      provider: "lm-studio",
      connected: true,
      baseUrl: lmStudioUrl,
      models: registeredModels.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    lmStudioStatus = {
      provider: "lm-studio",
      connected: false,
      baseUrl: lmStudioUrl,
      models: [],
      error: message,
    };
  }

  return { runtime, lmStudioStatus };
}
