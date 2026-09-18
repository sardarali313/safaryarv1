export const API_BASE_URL = "http://127.0.0.1:8000";

export class ApiError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function buildUrl(path, query) {
  const isPort8000 = window.location.port === "8000";
  const baseUrl = isPort8000 ? API_BASE_URL : window.location.origin;
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiFetch(path, { method = "GET", query, body } = {}) {
  const url = buildUrl(path, query);

  const init = {
    method,
    headers: { Accept: "application/json" },
  };

  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("اتصال به سرور ممکن نیست. لطفاً بک‌اند را اجرا کنید.", {
      status: 0,
    });
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const detail =
      (data && (data.detail || data.message)) || "خطای ناشناخته از سمت سرور";
    throw new ApiError(String(detail), { status: res.status, detail });
  }

  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
