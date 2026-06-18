import { http } from "./http";

export interface ModelOption {
  model: string;
  id: string;
  name: string;
  provider: string;
  providerName: string;
  priority: number;
  channels: Array<{
    name: string;
    provider: string;
    priority: number;
  }>;
}

export function modelOptionLabel(option: ModelOption): string {
  return option.providerName ? `${option.providerName} / ${option.model}` : option.model;
}

export const modelApi = {
  list: (silent = false) =>
    http.get<{ items: ModelOption[] }>(
      "/api/models",
      undefined,
      silent ? { silent: true } : undefined,
    ),
};
