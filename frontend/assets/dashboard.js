import {
  guardPage,
  mountHeader,
  loadAdminPanel,
  loadDriverPanel,
  loadPassengerPanel,
  loadInspectorPanel,
} from "./app.js";
import { ensureUi, showToast } from "./ui.js";

ensureUi();

const session = guardPage();
if (!session) {
  throw new Error("No session");
}

mountHeader(session);

async function boot() {
  try {
    if (session.role === "driver") {
      await loadDriverPanel(session);
      return;
    }
    if (session.role === "passenger") {
      await loadPassengerPanel(session);
      return;
    }
    if (session.role === "admin") {
      await loadAdminPanel(session);
      return;
    }
    if (session.role === "inspector" || session.role === "inspector_independent" || session.role === "inspector_managed") {
      await loadInspectorPanel(session);
      return;
    }
    showToast("نقش کاربر نامعتبر است.", "error");
  } catch (e) {
    showToast(e?.message || "خطا در بارگذاری داشبورد", "error");
  }
}

boot();
