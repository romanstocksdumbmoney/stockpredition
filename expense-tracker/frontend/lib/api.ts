const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type JsonLike = Record<string, unknown> | Array<unknown>;

type ApiOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: BodyInit | JsonLike;
  headers?: HeadersInit;
  rawResponse?: boolean;
};

export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { rawResponse, headers, body, ...rest } = options;
  const nextHeaders = new Headers(headers || {});
  let finalBody: BodyInit | undefined;

  if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
    finalBody = body;
  } else if (body !== undefined) {
    if (!nextHeaders.has("Content-Type")) {
      nextHeaders.set("Content-Type", "application/json");
    }
    finalBody = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: nextHeaders,
    body: finalBody,
    ...rest,
  });

  if (rawResponse) {
    return response as unknown as T;
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? String((payload as { detail?: string }).detail || "Request failed")
        : "Request failed";
    throw new Error(detail);
  }

  return payload as T;
}

export function apiBaseUrl() {
  return API_BASE;
}
