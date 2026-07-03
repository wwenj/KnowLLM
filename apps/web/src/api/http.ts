import { toast } from "sonner";

const API_BASE = "http://localhost:39247";

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
  silent?: boolean;
}

interface ApiEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}

function buildUrl(endpoint: string, params?: RequestOptions["params"]): string {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  let url = `${API_BASE}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) url += `?${queryString}`;
  }
  return url;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { params, silent, ...fetchOptions } = options;
  const url = buildUrl(endpoint, params);
  const isFormData =
    typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...fetchOptions.headers,
      },
      ...fetchOptions,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "网络异常";
    if (!silent) toast.error(msg);
    throw new ApiError(-1, msg);
  }

  let payload: ApiEnvelope<T> | null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || typeof payload.code !== "number") {
    const msg = payload?.msg ?? response.statusText ?? "响应格式错误";
    if (!silent) toast.error(msg);
    throw new ApiError(payload?.code ?? response.status, msg, payload?.data);
  }

  if (payload.code !== 0) {
    const msg = payload.msg ?? "请求失败";
    if (!silent) toast.error(msg);
    throw new ApiError(payload.code, msg, payload.data);
  }

  return (payload.data ?? ({} as T)) as T;
}

export const http = {
  get: <T>(
    endpoint: string,
    params?: RequestOptions["params"],
    options?: Omit<RequestOptions, "params" | "method" | "body">,
  ) => request<T>(endpoint, { ...options, method: "GET", params }),
  post: <T>(
    endpoint: string,
    data?: unknown,
    options?: Omit<RequestOptions, "method" | "body">,
  ) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    }),
  postForm: <T>(
    endpoint: string,
    data: FormData,
    options?: Omit<RequestOptions, "method" | "body">,
  ) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: data,
    }),
  delete: <T>(
    endpoint: string,
    options?: Omit<RequestOptions, "method" | "body">,
  ) => request<T>(endpoint, { ...options, method: "DELETE" }),
};
