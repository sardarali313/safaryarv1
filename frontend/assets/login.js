const API_BASE_URL = "http://127.0.0.1:8000";

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const paneLogin = document.getElementById("pane-login");
const paneRegister = document.getElementById("pane-register");

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const driverRegisterFields = document.getElementById("driver-register-fields");

function updateDriverFieldsVisibility() {
  const selectedRole = registerForm?.querySelector('input[name="role"]:checked')?.value;
  if (selectedRole === "driver") {
    driverRegisterFields?.classList.remove("hidden");
  } else {
    driverRegisterFields?.classList.add("hidden");
  }
}

registerForm?.querySelectorAll('input[name="role"]').forEach((radio) => {
  radio.addEventListener("change", updateDriverFieldsVisibility);
});
updateDriverFieldsVisibility();

function setTab(which) {
  const isLogin = which === "login";
  tabLogin?.setAttribute("aria-selected", String(isLogin));
  tabRegister?.setAttribute("aria-selected", String(!isLogin));
  paneLogin?.classList.toggle("hidden", !isLogin);
  paneRegister?.classList.toggle("hidden", isLogin);
}

tabLogin?.addEventListener("click", () => setTab("login"));
tabRegister?.addEventListener("click", () => setTab("register"));
setTab("login");

function setSession({ id, role, name }) {
  localStorage.setItem("user_id", String(id));
  localStorage.setItem("role", String(role));
  localStorage.setItem("name", String(name));
}

function setTokenFromResponse(data) {
  const token = data?.access_token || data?.token || data?.jwt || "";
  localStorage.setItem("token", String(token));
}

function dashboardByRole(role) {
  if (role === "driver") return "./dashboard.html#driver";
  if (role === "admin") return "./dashboard.html#admin";
  if (role === "inspector" || role === "inspector_managed" || role === "inspector_independent") return "./dashboard.html#inspector";
  return "./dashboard.html#passenger";
}

function mountToastRoot() {
  let root = document.getElementById("toast-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "toast-root";
  root.className = "toast-root";
  document.body.appendChild(root);
  return root;
}

function toast(message, type = "info") {
  const root = mountToastRoot();
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <div class="toast__content">
      <p class="toast__title">${escapeHtml(message)}</p>
    </div>
    <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.45rem 0.7rem" aria-label="بستن">بستن</button>
  `;
  const btn = el.querySelector("button");
  btn?.addEventListener("click", () => el.remove());
  root.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setLoading(isLoading) {
  let overlay = document.getElementById("loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loading-overlay";
    overlay.className = "loading-overlay hidden";
    overlay.innerHTML = `<div class="loading-box">در حال پردازش…</div>`;
    document.body.appendChild(overlay);
  }
  overlay.classList.toggle("hidden", !isLoading);
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const isPort8000 = window.location.port === "8000";
  const baseUrl = isPort8000 ? API_BASE_URL : window.location.origin;
  const url = new URL(path, baseUrl);

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
    res = await fetch(url.toString(), init);
  } catch {
    throw new Error("اتصال به سرور ممکن نیست. لطفاً بک‌اند را اجرا کنید.");
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || "خطای ناشناخته از سمت سرور";
    throw new Error(String(detail));
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

async function handleLogin({ phone, password }) {
  const data = await apiRequest("/users/login", {
    method: "POST",
    body: { phone, password },
  });

  setTokenFromResponse(data);
  setSession(data);
  window.location.href = dashboardByRole(data.role);
}

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(loginForm);
  const phone = String(fd.get("phone") || "").trim();
  const password = String(fd.get("password") || "").trim();

  if (!phone || !password) {
    toast("شماره همراه و رمز عبور را وارد کنید.", "warning");
    return;
  }

  setLoading(true);
  try {
    await handleLogin({ phone, password });
  } catch (err) {
    toast(err?.message || "خطا در ورود.", "danger");
  } finally {
    setLoading(false);
  }
});

registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(registerForm);
  const name = String(fd.get("name") || "").trim();
  const phone = String(fd.get("phone") || "").trim();
  const password = String(fd.get("password") || "").trim();
  const role = String(fd.get("role") || "").trim();

  if (!name || !phone || !password || !role) {
    toast("لطفاً همه فیلدها را کامل کنید.", "warning");
    return;
  }

  const payload = { name, phone, password, role };
  if (role === "driver") {
    payload.vehicle_model = String(fd.get("vehicle_model") || "").trim();
    payload.vehicle_color = String(fd.get("vehicle_color") || "").trim();
    payload.vehicle_capacity = Number(fd.get("vehicle_capacity") || 4);
    payload.license_plate = String(fd.get("license_plate") || "").trim();
  }

  setLoading(true);
  try {
    await apiRequest("/users/register", {
      method: "POST",
      body: payload,
    });
    await handleLogin({ phone, password });
  } catch (err) {
    toast(err?.message || "خطا در ثبت‌نام.", "danger");
  } finally {
    setLoading(false);
  }
});
