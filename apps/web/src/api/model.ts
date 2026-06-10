import { http } from "./http";

export interface ModelOption {
  model: string;
  id: string;
  name: string;
  provider: string;
  channels: Array<{
    name: string;
    provider: string;
    priority: number;
  }>;
}

export const modelApi = {
  list: (silent = false) =>
    http.get<{ items: ModelOption[] }>(
      "/api/models",
      undefined,
      silent ? { silent: true } : undefined,
    ),
};
