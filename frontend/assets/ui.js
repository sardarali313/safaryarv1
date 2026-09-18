import { isoToJalaliString } from "./jalali.js";

let loadingCount = 0;

export function ensureUi() {
  if (!document.getElementById("toast-root")) {
    const root = document.createElement("div");
    root.id = "toast-root";
    root.className =
      "fixed top-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2";
    document.body.appendChild(root);
  }

  if (!document.getElementById("loading-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "loading-overlay";
    overlay.className =
      "fixed inset-0 z-40 hidden items-center justify-center bg-slate-950/40 backdrop-blur-sm";
    overlay.innerHTML = `
      <div class="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-xl ring-1 ring-slate-200">
        <div class="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"></div>
        <div id="loading-text" class="text-sm font-medium text-slate-700">در حال پردازش…</div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
}

export function showToast(message, type = "info") {
  ensureUi();
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");

  const styles = {
    success: "bg-emerald-600",
    error: "bg-rose-600",
    info: "bg-slate-800",
    warning: "bg-amber-600",
  };

  el.className = `rounded-xl px-4 py-3 text-sm text-white shadow-lg ring-1 ring-white/10 ${styles[type] || styles.info}`;
  el.textContent = message;
  root.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.add("opacity-100");
  });

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
    el.style.transition = "all 250ms ease";
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

export function setLoading(isLoading, text = "در حال پردازش…") {
  ensureUi();
  const overlay = document.getElementById("loading-overlay");
  const label = document.getElementById("loading-text");

  if (isLoading) {
    loadingCount += 1;
    if (label) label.textContent = text;
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    return;
  }

  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  }
}

export async function withLoading(fn, text) {
  setLoading(true, text);
  try {
    return await fn();
  } finally {
    setLoading(false);
  }
}

export function renderEmpty(container, message) {
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center">
      <div class="text-base font-semibold text-slate-700">${escapeHtml(message)}</div>
      <div class="mt-2 text-sm text-slate-500">می‌توانید فیلتر را تغییر دهید یا دوباره تلاش کنید.</div>
    </div>
  `;
}

export function formatDateTime(value) {
  if (!value) return "—";
  return isoToJalaliString(value);
}

export function roleLabel(role) {
  if (role === "driver") return "راننده";
  if (role === "passenger") return "مسافر";
  if (role === "admin") return "مدیر سیستم";
  if (role === "inspector" || role === "inspector_independent" || role === "inspector_managed") return "بازرس";
  return role || "—";
}

export function tripStatusLabel(status, availableSeats) {
  if (status === "planned") {
    if (availableSeats !== undefined && Number(availableSeats) <= 0) {
      return "اتمام ظرفیت";
    }
    return "در حال مسافرگیری";
  }
  if (status === "completed") {
    return "تمام شده";
  }
  if (status === "in_progress" || status === "active") {
    return "در حال حرکت";
  }
  if (status === "cancelled") {
    return "لغو شده";
  }
  return status || "—";
}

export function tripStatusBadge(status, availableSeats) {
  const label = tripStatusLabel(status, availableSeats);
  let color = "bg-slate-100 text-slate-700 ring-slate-200";
  if (label === "در حال مسافرگیری") {
    color = "bg-emerald-50 text-emerald-700 ring-emerald-200";
  } else if (label === "اتمام ظرفیت") {
    color = "bg-amber-50 text-amber-800 ring-amber-200";
  } else if (label === "تمام شده") {
    color = "bg-slate-100 text-slate-600 ring-slate-200";
  } else if (label === "لغو شده") {
    color = "bg-rose-50 text-rose-700 ring-rose-200";
  } else if (label === "در حال حرکت") {
    color = "bg-blue-50 text-blue-700 ring-blue-200";
  }
  return `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${color}">${label}</span>`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
