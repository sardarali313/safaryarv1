import { apiFetch } from "./api.js";
import { showToast, withLoading, formatDateTime, renderEmpty, roleLabel, tripStatusBadge, tripStatusLabel } from "./ui.js";
import { getCurrentJalali, jalaliToIsoString, parseJalaliDateToIso } from "./jalali.js";

export function getSession() {
  const userIdRaw = localStorage.getItem("user_id");
  const role = localStorage.getItem("role");
  const name = localStorage.getItem("name");
  const user_id = userIdRaw ? Number(userIdRaw) : null;
  if (!user_id || !role || !name) return null;
  return { user_id, role, name };
}

export function setSession({ id, role, name }) {
  localStorage.setItem("user_id", String(id));
  localStorage.setItem("role", String(role));
  localStorage.setItem("name", String(name));
}

export function clearSession() {
  localStorage.removeItem("user_id");
  localStorage.removeItem("role");
  localStorage.removeItem("name");
}

export function guardPage() {
  const session = getSession();
  if (!session) {
    window.location.href = "./login.html";
    return null;
  }
  return session;
}

const cache = {
  usersById: null,
  driverProfilesByUserId: new Map(),
};

export async function getUsersById() {
  if (cache.usersById) return cache.usersById;
  const users = await apiFetch("/users/");
  const map = new Map();
  for (const u of users) map.set(u.id, u);
  cache.usersById = map;
  return map;
}

export async function getDriverProfile(userId) {
  if (cache.driverProfilesByUserId.has(userId)) {
    return cache.driverProfilesByUserId.get(userId);
  }
  try {
    const profile = await apiFetch(`/drivers/profile/${userId}`);
    cache.driverProfilesByUserId.set(userId, profile);
    return profile;
  } catch {
    cache.driverProfilesByUserId.set(userId, null);
    return null;
  }
}

export function showConfirmDialog(title, message, onConfirm) {
  const modal = document.getElementById("modal-confirm-delete");
  const titleEl = document.getElementById("confirm-delete-title");
  const msgEl = document.getElementById("confirm-delete-message");
  const btnCancel = document.getElementById("btn-cancel-delete");
  const btnDo = document.getElementById("btn-do-delete");

  if (!modal || !btnDo) {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  const close = () => {
    modal.classList.add("hidden");
    btnCancel?.removeEventListener("click", onCancel);
    btnDo?.removeEventListener("click", onDo);
  };

  const onCancel = () => close();
  const onDo = async () => {
    close();
    await onConfirm();
  };

  btnCancel?.addEventListener("click", onCancel);
  btnDo?.addEventListener("click", onDo);
  modal.classList.remove("hidden");
}

export function checkpointsToRoute(checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) return "—";
  const ordered = [...checkpoints].sort((a, b) => a.order - b.order);
  const parts = ordered.map((c) => c.city_name);
  return parts.join(" ← ");
}

export function tripTitle(trip) {
  const route = checkpointsToRoute(trip.checkpoints);
  return `سفر #${trip.id} | ${route}`;
}

export function mountHeader(session) {
  const nameEl = document.getElementById("hdr-name");
  const roleEl = document.getElementById("hdr-role");
  const avatarInitEl = document.getElementById("hdr-avatar-initial");
  const logoutBtn = document.getElementById("btn-logout");
  const avatarBtn = document.getElementById("btn-user-avatar");
  const editLink = document.getElementById("btn-edit-profile-link");

  if (nameEl) nameEl.textContent = session.name;
  if (roleEl) roleEl.textContent = roleLabel(session.role);
  if (avatarInitEl) avatarInitEl.textContent = session.name ? session.name.trim()[0].toUpperCase() : "؟";

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "./login.html";
    });
  }

  const openEditModal = async () => {
    const modal = document.getElementById("modal-edit-profile");
    if (!modal) return;

    try {
      const users = await apiFetch("/users/");
      const me = users.find((u) => u.id === session.user_id);

      document.getElementById("edit-profile-name").value = me ? me.name : session.name;
      document.getElementById("edit-profile-phone").value = me ? me.phone : "";
      document.getElementById("edit-profile-password").value = me ? me.password || "" : "";

      const driverFields = document.getElementById("edit-driver-fields");
      if (session.role === "driver") {
        driverFields.classList.remove("hidden");
        const dp = await getDriverProfile(session.user_id);
        if (dp) {
          document.getElementById("edit-driver-vehicle-model").value = dp.vehicle_model || "";
          document.getElementById("edit-driver-vehicle-capacity").value = dp.vehicle_capacity || "";
        }
      } else {
        driverFields.classList.add("hidden");
      }

      modal.classList.remove("hidden");
    } catch (e) {
      showToast("خطا در دریافت اطلاعات پروفایل", "error");
    }
  };

  if (avatarBtn) avatarBtn.addEventListener("click", openEditModal);
  if (editLink) editLink.addEventListener("click", openEditModal);

  const modalEdit = document.getElementById("modal-edit-profile");
  const btnClose = document.getElementById("btn-close-edit-modal");
  const btnCancel = document.getElementById("btn-cancel-edit-modal");
  const formEdit = document.getElementById("form-edit-profile");

  const closeModal = () => modalEdit && modalEdit.classList.add("hidden");

  if (btnClose) btnClose.addEventListener("click", closeModal);
  if (btnCancel) btnCancel.addEventListener("click", closeModal);

  if (formEdit) {
    formEdit.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("edit-profile-name").value.trim();
      const phone = document.getElementById("edit-profile-phone").value.trim();
      const password = document.getElementById("edit-profile-password").value.trim();

      if (!name || !phone) {
        showToast("نام و شماره موبایل الزامی هستند.", "warning");
        return;
      }

      await withLoading(async () => {
        await apiFetch(`/users/${session.user_id}`, {
          method: "PUT",
          body: { name, phone, password: password || undefined },
        });

        if (session.role === "driver") {
          const vehicle_model = document.getElementById("edit-driver-vehicle-model").value.trim();
          const vehicle_capacity = Number(document.getElementById("edit-driver-vehicle-capacity").value);
          if (vehicle_model && vehicle_capacity) {
            await apiFetch(`/drivers/profile/${session.user_id}`, {
              method: "PUT",
              body: { vehicle_model, vehicle_capacity },
            });
            cache.driverProfilesByUserId.delete(session.user_id);
          }
        }
      }, "در حال ویرایش حساب…");

      setSession({ id: session.user_id, role: session.role, name });
      cache.usersById = null;
      showToast("اطلاعات حساب با موفقیت ویرایش شد.", "success");
      closeModal();
      window.location.reload();
    };
  }
}

export async function loadDriverPanel(session) {
  const section = document.getElementById("panel-driver");
  const profileBox = document.getElementById("driver-profile-box");
  const profileForm = document.getElementById("driver-profile-form");
  const profileSummary = document.getElementById("driver-profile-summary");
  const walletCard = document.getElementById("driver-wallet-card");

  const tripForm = document.getElementById("driver-trip-form");
  const stopList = document.getElementById("stop-list");
  const addStopBtn = document.getElementById("btn-add-stop");

  const tripsSelect = document.getElementById("driver-trip-select");
  const refreshRequestsBtn = document.getElementById("btn-refresh-requests");
  const requestsList = document.getElementById("driver-requests-list");
  const tripActionsBox = document.getElementById("driver-trip-actions");
  const completeTripBtn = document.getElementById("btn-complete-trip");

  section.classList.remove("hidden");

  async function refreshDriverWallet() {
    if (!walletCard) return;
    try {
      const wallet = await apiFetch(`/drivers/${session.user_id}/wallet`);
      const totalNet = wallet.net_balance || 0;
      const totalGross = wallet.total_gross_revenue || 0;
      const totalComm = wallet.total_commission || 0;
      const transactions = wallet.transactions || [];

      let txHtml = "";
      if (transactions.length === 0) {
        txHtml = `<div class="mt-2 text-xs text-slate-500">هنوز سفر پایان‌یافته‌ای برای محاسبه تسویه مالی ثبت نشده است.</div>`;
      } else {
        txHtml = `
          <div class="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
            ${transactions
              .map(
                (tx) => `
              <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">
                <div class="flex items-center justify-between font-bold text-slate-800">
                  <span>سفر #${tx.trip_id} (${checkpointsToRoute(tx.checkpoints)})</span>
                  <span class="text-emerald-700 font-extrabold">+${Number(tx.net_earnings).toLocaleString("fa-IR")} تومان</span>
                </div>
                <div class="mt-1 flex flex-wrap justify-between text-slate-500">
                  <span>مسافران تایید شده: ${tx.approved_passengers} نفر • قیمت صندلی: ${Number(tx.price_per_seat).toLocaleString("fa-IR")} تومان</span>
                  <span>کارمزد ٪۲۰: -${Number(tx.commission_20).toLocaleString("fa-IR")} تومان</span>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        `;
      }

      walletCard.innerHTML = `
        <div class="rounded-3xl border border-emerald-100 bg-gradient-to-l from-emerald-50 via-teal-50/30 to-white p-5 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-xs font-bold text-emerald-700">کیف پول و درآمد راننده (با کسر ۲۰٪ سهم سامانه)</div>
              <div class="mt-1 flex items-center gap-2">
                <span class="text-2xl font-extrabold text-emerald-800">${Number(totalNet).toLocaleString("fa-IR")}</span>
                <span class="text-sm font-bold text-emerald-600">تومان</span>
              </div>
            </div>
            <div class="flex flex-col text-left text-xs text-slate-500">
              <span>درآمد ناخالص کل: <strong class="text-slate-800">${Number(totalGross).toLocaleString("fa-IR")} تومان</strong></span>
              <span>کسورات کارمزد (٪۲۰): <strong class="text-rose-600">-${Number(totalComm).toLocaleString("fa-IR")} تومان</strong></span>
            </div>
          </div>
          ${txHtml}
        </div>
      `;
    } catch {
      walletCard.innerHTML = "";
    }
  }

  await refreshDriverWallet();

  const profile = await withLoading(
    () => getDriverProfile(session.user_id),
    "در حال بررسی پروفایل خودرو…"
  );

  const approvalAlert = document.getElementById("driver-approval-alert");
  if (approvalAlert) {
    if (!profile || profile.approval_status === "pending") {
      approvalAlert.innerHTML = `
        <div class="rounded-3xl border border-amber-200 bg-amber-50/90 p-5 shadow-sm text-amber-900">
          <div class="flex items-start gap-3.5">
            <span class="text-2xl mt-0.5">⏳</span>
            <div class="space-y-1">
              <div class="text-base font-extrabold text-amber-900">حساب کاربری و اطلاعات خودرو در صف بررسی بازرسان است</div>
              <div class="text-xs text-amber-800 leading-relaxed font-medium">
                راننده گرامی، مشخصات هویتی و اطلاعات خودروی شما با موفقیت در سامانه ثبت شده است. 
                طبق ضوابط، برای شروع فعالیت و ثبت سفر جدید، اطلاعات شما باید توسط بازرس بررسی و احراز صلاحیت گردد.
                <strong>لطفاً کمی صبور باشید؛ پس از تایید توسط بازرس، امکان تعریف سفر بلافاصله فعال خواهد شد.</strong>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (profile.approval_status === "rejected") {
      approvalAlert.innerHTML = `
        <div class="rounded-3xl border border-rose-200 bg-rose-50/90 p-5 shadow-sm text-rose-900">
          <div class="flex items-start gap-3.5">
            <span class="text-2xl mt-0.5">❌</span>
            <div class="space-y-1">
              <div class="text-base font-extrabold text-rose-900">عدم تایید مدارک و مشخصات خودرو توسط بازرس</div>
              <div class="text-xs text-rose-800 leading-relaxed font-medium">
                ${profile.inspection_note ? `علت رد صلاحیت: <strong>${escapeAttr(profile.inspection_note)}</strong>` : "مدارک یا مشخصات خودرو با قوانین سامانه انطباق نداشته است."}
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (profile.approval_status === "approved") {
      approvalAlert.innerHTML = `
        <div class="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-emerald-900 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <div class="flex items-center gap-2 text-xs font-bold">
            <span class="text-base">✅</span>
            <span>صلاحیت رانندگی و مشخصات خودروی شما توسط بازرس تایید شده است (مجاز به ثبت سفر).</span>
          </div>
          <span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800">تایید شده توسط بازرس</span>
        </div>
      `;
    }
  }

  if (!profile) {
    profileBox.classList.remove("hidden");
    profileSummary.classList.add("hidden");
  } else {
    profileBox.classList.add("hidden");
    profileSummary.classList.remove("hidden");
    const statusText = profile.approval_status === "approved" ? "تایید شده" : (profile.approval_status === "rejected" ? "رد شده" : "در انتظار تایید بازرس");
    const statusColor = profile.approval_status === "approved" ? "text-emerald-700 font-bold" : (profile.approval_status === "rejected" ? "text-rose-700 font-bold" : "text-amber-700 font-bold");
    profileSummary.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <div class="text-sm font-semibold text-slate-700">خودرو ثبت شده</div>
          <div class="mt-1 text-sm text-slate-600">${escapeAttr(profile.vehicle_model)} • ظرفیت: ${profile.vehicle_capacity} نفر</div>
          <div class="mt-1 text-xs ${statusColor}">وضعیت تایید: ${statusText}</div>
        </div>
        <div class="text-xs text-slate-500">ویرایش خودرو در سیستم محفوظ است.</div>
      </div>
    `;
  }

  if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(profileForm);
      const brand = String(form.get("brand") || "").trim();
      const model = String(form.get("model") || "").trim();
      const plate = String(form.get("plate") || "").trim();
      const color = String(form.get("color") || "").trim();
      const capacity = Number(form.get("capacity"));

      if (!brand || !model || !plate || !color || !capacity) {
        showToast("لطفاً همه فیلدهای خودرو را کامل کنید.", "warning");
        return;
      }

      const vehicle_model = `${brand} ${model} | ${color} | ${plate}`;

      await withLoading(
        () =>
          apiFetch("/drivers/profile", {
            method: "POST",
            body: {
              user_id: session.user_id,
              vehicle_model,
              vehicle_capacity: capacity,
            },
          }),
        "در حال ثبت پروفایل خودرو…"
      );

      cache.driverProfilesByUserId.delete(session.user_id);
      showToast("پروفایل خودرو با موفقیت ثبت شد.", "success");
      window.location.reload();
    });
  }

  let stopIndex = 0;
  function addStopInput(value = "") {
    if (stopIndex >= 3) {
      showToast("حداکثر ۳ ایستگاه بین‌راهی می‌توانید ثبت کنید.", "warning");
      return;
    }
    stopIndex += 1;
    const currentStopNum = stopIndex;
    const row = document.createElement("div");
    row.id = `stop-row-${currentStopNum}`;
    row.className = "flex items-center gap-2";
    row.innerHTML = `
      <span class="text-xs font-bold text-amber-600 w-16">ایستگاه ${currentStopNum}:</span>
      <input id="driver-input-stop-${currentStopNum}" name="stop_${currentStopNum}" value="${escapeAttr(value)}" class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none ring-indigo-500 focus:ring-2" placeholder="نام شهر ایستگاه ${currentStopNum}">
      <button type="button" class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100">حذف</button>
    `;
    const btn = row.querySelector("button");
    btn.addEventListener("click", () => {
      row.remove();
    });
    stopList.appendChild(row);
  }

  if (addStopBtn) addStopBtn.addEventListener("click", () => addStopInput(""));

  const driverMapContainer = document.getElementById("driver-trip-map");
  const driverOriginInput = document.getElementById("driver-input-origin");
  const driverDestInput = document.getElementById("driver-input-dest");

  let driverMapMode = "origin";
  let dOriginMarker = null;
  let dDestMarker = null;
  let dStopMarkers = [];
  let dMapPolyline = null;

  if (driverMapContainer && window.L) {
    try {
      const dMap = window.L.map("driver-trip-map").setView([32.4279, 53.6880], 5);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap"
      }).addTo(dMap);

      const greenIcon = window.L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      const redIcon = window.L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      const yellowIcon = window.L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      const updateDriverPolyline = () => {
        if (dMapPolyline) dMap.removeLayer(dMapPolyline);
        const points = [];
        if (dOriginMarker) points.push(dOriginMarker.getLatLng());
        dStopMarkers.forEach((m) => m && points.push(m.getLatLng()));
        if (dDestMarker) points.push(dDestMarker.getLatLng());

        if (points.length >= 2) {
          dMapPolyline = window.L.polyline(points, { color: '#059669', weight: 4, dashArray: '6, 6' }).addTo(dMap);
          dMap.fitBounds(dMapPolyline.getBounds(), { padding: [40, 40] });
        }
      };

      const setDriverMode = (mode) => {
        driverMapMode = mode;
        const btnO = document.getElementById("driver-map-mode-origin");
        const btnD = document.getElementById("driver-map-mode-dest");
        const btnS1 = document.getElementById("driver-map-mode-stop1");
        const btnS2 = document.getElementById("driver-map-mode-stop2");
        const btnS3 = document.getElementById("driver-map-mode-stop3");

        const inactiveCls = "rounded-lg bg-slate-200 px-2.5 py-1 font-bold text-slate-700 hover:bg-slate-300";
        if (btnO) btnO.className = mode === "origin" ? "rounded-lg bg-emerald-600 px-2.5 py-1 font-bold text-white shadow-sm ring-2 ring-emerald-300" : inactiveCls;
        if (btnD) btnD.className = mode === "dest" ? "rounded-lg bg-rose-600 px-2.5 py-1 font-bold text-white shadow-sm ring-2 ring-rose-300" : inactiveCls;
        if (btnS1) btnS1.className = mode === "stop1" ? "rounded-lg bg-amber-500 px-2.5 py-1 font-bold text-white shadow-sm ring-2 ring-amber-300" : inactiveCls;
        if (btnS2) btnS2.className = mode === "stop2" ? "rounded-lg bg-amber-500 px-2.5 py-1 font-bold text-white shadow-sm ring-2 ring-amber-300" : inactiveCls;
        if (btnS3) btnS3.className = mode === "stop3" ? "rounded-lg bg-amber-500 px-2.5 py-1 font-bold text-white shadow-sm ring-2 ring-amber-300" : inactiveCls;
      };

      document.getElementById("driver-map-mode-origin")?.addEventListener("click", () => setDriverMode("origin"));
      document.getElementById("driver-map-mode-dest")?.addEventListener("click", () => setDriverMode("dest"));
      document.getElementById("driver-map-mode-stop1")?.addEventListener("click", () => setDriverMode("stop1"));
      document.getElementById("driver-map-mode-stop2")?.addEventListener("click", () => setDriverMode("stop2"));
      document.getElementById("driver-map-mode-stop3")?.addEventListener("click", () => setDriverMode("stop3"));

      const setDriverPointOnMap = (lat, lng, cityName, mode) => {
        if (mode === "origin") {
          if (dOriginMarker) dMap.removeLayer(dOriginMarker);
          dOriginMarker = window.L.marker([lat, lng], { icon: greenIcon }).addTo(dMap).bindPopup(`<b>مبدأ:</b> ${cityName}`).openPopup();
          if (driverOriginInput) driverOriginInput.value = cityName;
        } else if (mode === "dest") {
          if (dDestMarker) dMap.removeLayer(dDestMarker);
          dDestMarker = window.L.marker([lat, lng], { icon: redIcon }).addTo(dMap).bindPopup(`<b>مقصد:</b> ${cityName}`).openPopup();
          if (driverDestInput) driverDestInput.value = cityName;
        } else if (mode.startsWith("stop")) {
          const stopNum = Number(mode.replace("stop", ""));
          let stopInp = document.getElementById(`driver-input-stop-${stopNum}`);
          if (!stopInp) {
            while (stopIndex < stopNum) {
              addStopInput();
            }
            stopInp = document.getElementById(`driver-input-stop-${stopNum}`);
          }
          if (stopInp) stopInp.value = cityName;

          if (dStopMarkers[stopNum - 1]) dMap.removeLayer(dStopMarkers[stopNum - 1]);
          dStopMarkers[stopNum - 1] = window.L.marker([lat, lng], { icon: yellowIcon }).addTo(dMap).bindPopup(`<b>ایستگاه ${stopNum}:</b> ${cityName}`).openPopup();
        }
        updateDriverPolyline();
      };

      document.querySelectorAll(".btn-driver-city-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
          const city = btn.getAttribute("data-city");
          const lat = Number(btn.getAttribute("data-lat"));
          const lng = Number(btn.getAttribute("data-lng"));
          setDriverPointOnMap(lat, lng, city, driverMapMode);
        });
      });

      dMap.on("click", async (e) => {
        const { lat, lng } = e.latlng;
        let cityName = `موقعیت (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=fa`);
          const data = await res.json();
          if (data && data.address) {
            cityName = data.address.city || data.address.town || data.address.state || data.address.county || cityName;
          }
        } catch {}

        setDriverPointOnMap(lat, lng, cityName, driverMapMode);
      });
    } catch (e) {
      console.error("Driver Map Error:", e);
    }
  }

  const shamsiDateInput = document.getElementById("driver-input-date-shamsi");
  const shamsiTimeInput = document.getElementById("driver-input-time");
  if (shamsiDateInput && !shamsiDateInput.value) {
    const curJalali = getCurrentJalali();
    const pad = (n) => String(n).padStart(2, "0");
    shamsiDateInput.value = `${curJalali.year}/${pad(curJalali.month)}/${pad(curJalali.day)}`;
  }
  if (shamsiTimeInput && !shamsiTimeInput.value) {
    const curJalali = getCurrentJalali();
    const pad = (n) => String(n).padStart(2, "0");
    const h = (curJalali.hours + 1) % 24;
    shamsiTimeInput.value = `${pad(h)}:00`;
  }

  if (tripForm) {
    tripForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!profile || profile.approval_status !== "approved") {
        showToast(
          "راننده گرامی، حساب شما در انتظار بررسی و تایید بازرسان است. لطفاً تا زمان تایید صلاحیت توسط بازرس صبور باشید.",
          "warning"
        );
        if (approvalAlert) {
          approvalAlert.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }

      const form = new FormData(tripForm);
      const origin = String(form.get("origin") || "").trim();
      const destination = String(form.get("destination") || "").trim();
      const dateShamsi = String(form.get("departure_date_shamsi") || "").trim();
      const timeClock = String(form.get("departure_time_clock") || "").trim();
      const seats = Number(form.get("available_seats"));
      const price = Number(form.get("price"));

      const stops = [];
      for (const [k, v] of form.entries()) {
        if (!String(k).startsWith("stop_")) continue;
        const val = String(v || "").trim();
        if (val) stops.push(val);
      }

      if (!origin || !destination || !dateShamsi || !timeClock || !seats || price < 0) {
        showToast("لطفاً اطلاعات سفر از جمله تاریخ و ساعت شمسی را کامل وارد کنید.", "warning");
        return;
      }

      const dateParts = dateShamsi.split("/").map((s) => s.trim());
      if (dateParts.length !== 3) {
        showToast("فرمت تاریخ شمسی باید به صورت سال/ماه/روز باشد (مثلاً ۱۴۰۴/۰۱/۱۵).", "warning");
        return;
      }

      const jy = Number(dateParts[0]);
      const jm = Number(dateParts[1]);
      const jd = Number(dateParts[2]);
      if (isNaN(jy) || isNaN(jm) || isNaN(jd) || jm < 1 || jm > 12 || jd < 1 || jd > 31) {
        showToast("تاریخ شمسی وارد شده معتبر نیست.", "warning");
        return;
      }

      const timeParts = timeClock.split(":");
      const hour = Number(timeParts[0]) || 0;
      const minute = Number(timeParts[1]) || 0;

      const departure_time = jalaliToIsoString(jy, jm, jd, hour, minute);

      const checkpoints = [
        { city_name: origin, order: 0, type: "origin" },
        ...stops.map((c, idx) => ({ city_name: c, order: idx + 1, type: "stop" })),
        {
          city_name: destination,
          order: stops.length + 1,
          type: "destination",
        },
      ];

      try {
        await withLoading(
          () =>
            apiFetch("/trips/", {
              method: "POST",
              body: {
                driver_id: session.user_id,
                departure_time,
                available_seats: seats,
                price,
                checkpoints,
              },
            }),
          "در حال ثبت سفر…"
        );

        showToast("سفر با موفقیت ثبت شد.", "success");
        tripForm.reset();
        stopList.innerHTML = "";
        stopIndex = 0;
        if (shamsiDateInput) {
          const curJalali = getCurrentJalali();
          const pad = (n) => String(n).padStart(2, "0");
          shamsiDateInput.value = `${curJalali.year}/${pad(curJalali.month)}/${pad(curJalali.day)}`;
        }
        await refreshDriverTrips();
      } catch (err) {
        showToast(err?.message || "خطا در ثبت سفر", "error");
      }
    });
  }

  async function refreshDriverTrips() {
    const trips = await withLoading(() => apiFetch("/trips/"), "در حال دریافت سفرهای شما…");
    const activeTrips = trips.filter((t) => t.driver_id === session.user_id && t.status !== "completed");

    tripsSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "انتخاب سفر…";
    tripsSelect.appendChild(opt);

    for (const t of activeTrips.sort((a, b) => b.id - a.id)) {
      const o = document.createElement("option");
      o.value = String(t.id);
      const seatText = Number(t.available_seats) <= 0 ? "⚠️ اتمام ظرفیت" : `${t.available_seats} صندلی خالی`;
      o.textContent = `${tripTitle(t)} • ${formatDateTime(t.departure_time)} (${seatText})`;
      tripsSelect.appendChild(o);
    }

    if (activeTrips.length === 0) {
      renderEmpty(
        document.getElementById("driver-trips-empty"),
        "هنوز سفر فعال یا در انتطاری ثبت نکرده‌اید."
      );
    } else {
      document.getElementById("driver-trips-empty").innerHTML = "";
    }
  }

  async function refreshRequests() {
    const tripId = Number(tripsSelect.value);
    if (tripActionsBox) {
      if (tripId) {
        tripActionsBox.classList.remove("hidden");
      } else {
        tripActionsBox.classList.add("hidden");
      }
    }

    if (!tripId) {
      requestsList.innerHTML = "";
      renderEmpty(requestsList, "برای مشاهده درخواست‌ها یک سفر را انتخاب کنید.");
      return;
    }

    const [requests, allTrips] = await withLoading(
      async () => {
        return await Promise.all([
          apiFetch(`/trips/${tripId}/requests`, {
            query: { driver_id: session.user_id },
          }),
          apiFetch("/trips/"),
        ]);
      },
      "در حال دریافت درخواست‌ها…"
    );

    const currentTrip = allTrips?.find((t) => t.id === tripId);
    const isFull = currentTrip ? Number(currentTrip.available_seats) <= 0 : false;

    if (!requests.length) {
      requestsList.innerHTML = "";
      if (isFull) {
        requestsList.insertAdjacentHTML(
          "beforeend",
          `
            <div class="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs font-bold text-amber-900 flex items-center justify-between gap-2 shadow-sm">
              <div class="flex items-center gap-2">
                <span>⚠️</span>
                <span>ظرفیت صندلی‌های این سفر تکمیل شده است (اتمام ظرفیت).</span>
              </div>
              <span class="rounded-full bg-amber-200/80 px-2.5 py-0.5 text-[11px] text-amber-900">۰ صندلی خالی</span>
            </div>
          `
        );
      }
      renderEmpty(requestsList, "هنوز درخواستی برای این سفر ثبت نشده است.");
      return;
    }

    requestsList.innerHTML = "";

    if (isFull) {
      requestsList.insertAdjacentHTML(
        "beforeend",
        `
          <div class="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs font-bold text-amber-900 flex items-center justify-between gap-2 shadow-sm">
            <div class="flex items-center gap-2">
              <span>⚠️</span>
              <span>ظرفیت این سفر تکمیل شده است (اتمام ظرفیت). برای پذیرش مسافر جدید، باید ظرفیت خالی داشته باشید یا درخواستی را لغو کنید.</span>
            </div>
            <span class="rounded-full bg-amber-200/80 px-2.5 py-0.5 text-[11px] text-amber-900">اتمام ظرفیت</span>
          </div>
        `
      );
    }

    for (const req of requests) {
      const row = document.createElement("div");
      row.className =
        "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

      const statusBadge = badge(req.status);

      const passengerDisplayName = `مسافر #${req.passenger_id}`;
      const disableApprove = req.status !== "pending" || (req.status === "pending" && isFull);

      row.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold text-slate-800">${passengerDisplayName}</div>
            <div class="mt-1 text-xs text-slate-500">شناسه درخواست: #${req.id}</div>
          </div>
          <div class="flex items-center gap-2">
            ${statusBadge}
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button data-act="approve" class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed" ${disableApprove ? "disabled" : ""} title="${isFull && req.status === 'pending' ? 'ظرفیت صندلی‌های این سفر به اتمام رسیده است' : ''}">تایید درخواست</button>
          <button data-act="reject" class="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-40" ${req.status !== "pending" ? "disabled" : ""}>رد درخواست</button>
        </div>
      `;

      const approveBtn = row.querySelector('[data-act="approve"]');
      const rejectBtn = row.querySelector('[data-act="reject"]');

      approveBtn.addEventListener("click", () =>
        updateReqStatus(tripId, req.id, "approved")
      );
      rejectBtn.addEventListener("click", () =>
        updateReqStatus(tripId, req.id, "rejected")
      );

      requestsList.appendChild(row);
    }
  }

  if (completeTripBtn) {
    completeTripBtn.addEventListener("click", async () => {
      const tripId = Number(tripsSelect.value);
      if (!tripId) return;
      await withLoading(
        () =>
          apiFetch(`/trips/${tripId}/status`, {
            method: "PATCH",
            body: { driver_id: session.user_id, status: "completed" },
          }),
        "در حال به‌روزرسانی وضعیت سفر…"
      );
      showToast("سفر با موفقیت به‌عنوان پایان‌یافته علامت‌گذاری شد.", "success");
      await refreshDriverTrips();
      await refreshDriverWallet();
      tripsSelect.value = "";
      await refreshRequests();
    });
  }

  async function updateReqStatus(tripId, requestId, status) {
    try {
      await withLoading(
        () =>
          apiFetch(`/trips/${tripId}/request/${requestId}`, {
            method: "PATCH",
            body: { driver_id: session.user_id, status },
          }),
        "در حال ثبت نتیجه…"
      );
      showToast(
        status === "approved"
          ? "درخواست با موفقیت تایید شد و ۱ صندلی از ظرفیت سفر کسر گردید."
          : "درخواست رد شد.",
        "success"
      );
      const currentSelected = tripsSelect.value;
      await refreshDriverTrips();
      if (currentSelected) {
        tripsSelect.value = currentSelected;
      }
      await refreshRequests();
      await refreshDriverWallet();
    } catch (err) {
      showToast(err?.message || "خطا در به‌روزرسانی درخواست", "error");
    }
  }

  tripsSelect.addEventListener("change", refreshRequests);
  refreshRequestsBtn.addEventListener("click", refreshRequests);

  await refreshDriverTrips();
  await refreshRequests();
}

export async function loadPassengerPanel(session) {
  const section = document.getElementById("panel-passenger");
  const form = document.getElementById("passenger-search-form");
  const results = document.getElementById("passenger-results");
  const myTripsContainer = document.getElementById("passenger-my-trips");
  const refreshMyTripsBtn = document.getElementById("btn-refresh-my-trips");

  section.classList.remove("hidden");

  const usersById = await withLoading(() => getUsersById(), "در حال آماده‌سازی…");

  const mapContainer = document.getElementById("passenger-map");
  const originInput = document.getElementById("input-origin-city");
  const destInput = document.getElementById("input-dest-city");
  const modeOriginBtn = document.getElementById("map-mode-origin");
  const modeDestBtn = document.getElementById("map-mode-dest");

  let mapMode = "origin";
  let originMarker = null;
  let destMarker = null;
  let mapPolyline = null;

  if (mapContainer && window.L) {
    try {
      const map = window.L.map("passenger-map").setView([32.4279, 53.6880], 5);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap"
      }).addTo(map);

      const greenIcon = window.L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      const redIcon = window.L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      const updatePolyline = () => {
        if (mapPolyline) map.removeLayer(mapPolyline);
        if (originMarker && destMarker) {
          const p1 = originMarker.getLatLng();
          const p2 = destMarker.getLatLng();
          mapPolyline = window.L.polyline([p1, p2], { color: '#4f46e5', weight: 4, dashArray: '8, 8' }).addTo(map);
          map.fitBounds(mapPolyline.getBounds(), { padding: [40, 40] });
        }
      };

      if (modeOriginBtn && modeDestBtn) {
        modeOriginBtn.addEventListener("click", () => {
          mapMode = "origin";
          modeOriginBtn.className = "rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm ring-2 ring-emerald-300";
          modeDestBtn.className = "rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-300";
        });
        modeDestBtn.addEventListener("click", () => {
          mapMode = "dest";
          modeDestBtn.className = "rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm ring-2 ring-rose-300";
          modeOriginBtn.className = "rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-300";
        });
      }

      const setPointOnMap = (lat, lng, cityName, isOrigin) => {
        if (isOrigin) {
          if (originMarker) map.removeLayer(originMarker);
          originMarker = window.L.marker([lat, lng], { icon: greenIcon }).addTo(map).bindPopup(`<b>مبدأ:</b> ${cityName}`).openPopup();
          if (originInput) originInput.value = cityName;
        } else {
          if (destMarker) map.removeLayer(destMarker);
          destMarker = window.L.marker([lat, lng], { icon: redIcon }).addTo(map).bindPopup(`<b>مقصد:</b> ${cityName}`).openPopup();
          if (destInput) destInput.value = cityName;
        }
        updatePolyline();
      };

      document.querySelectorAll(".btn-city-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
          const city = btn.getAttribute("data-city");
          const lat = Number(btn.getAttribute("data-lat"));
          const lng = Number(btn.getAttribute("data-lng"));
          setPointOnMap(lat, lng, city, mapMode === "origin");
        });
      });

      map.on("click", async (e) => {
        const { lat, lng } = e.latlng;
        let cityName = `موقعیت (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=fa`);
          const data = await res.json();
          if (data && data.address) {
            cityName = data.address.city || data.address.town || data.address.state || data.address.county || cityName;
          }
        } catch {}

        setPointOnMap(lat, lng, cityName, mapMode === "origin");
      });
    } catch (e) {
      console.error("Map error:", e);
    }
  }

  async function refreshMyTrips() {
    if (!myTripsContainer) return;
    try {
      const myRequests = await apiFetch(`/passengers/${session.user_id}/my-requests`);
      if (!myRequests || !myRequests.length) {
        renderEmpty(myTripsContainer, "شما هنوز هیچ درخواست یا سفری ثبت نکرده‌اید.");
        return;
      }

      myTripsContainer.innerHTML = "";
      for (const item of myRequests) {
        const { request_status, trip } = item;
        const card = document.createElement("div");
        card.className =
          "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3";

        card.innerHTML = `
          <div class="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div>
              <div class="text-xs text-slate-500">مسیر سفر</div>
              <div class="text-sm font-bold text-slate-800 mt-0.5">${checkpointsToRoute(trip.checkpoints)}</div>
            </div>
            <div>${badge(request_status)}</div>
          </div>
          <div class="flex items-center justify-between text-xs text-slate-600">
            <span>راننده: <strong class="text-slate-800">${escapeAttr(trip.driver_name)}</strong></span>
            <span>زمان: ${formatDateTime(trip.departure_time)}</span>
          </div>
        `;

        myTripsContainer.appendChild(card);
      }
    } catch {
      renderEmpty(myTripsContainer, "خطا در دریافت سفرهای من.");
    }
  }

  if (refreshMyTripsBtn) {
    refreshMyTripsBtn.addEventListener("click", refreshMyTrips);
  }
  await refreshMyTrips();

  async function executeSearch(queryObj = {}) {
    const trips = await withLoading(
      () => apiFetch("/trips/search", { query: queryObj }),
      "در حال دریافت و فیلتر سفرها…"
    );

    // Only display planned upcoming trips to passengers (not completed or cancelled)
    const visibleTrips = trips.filter((t) => t.status === "planned");

    if (!visibleTrips.length) {
      renderEmpty(results, "هیچ سفر پیش‌رویی با مشخصات انتخابی یافت نشد.");
      return;
    }

    results.innerHTML = "";
    for (const trip of visibleTrips) {
      const driver = usersById.get(trip.driver_id);
      const profile = await getDriverProfile(trip.driver_id);
      const isCapacityFull = Number(trip.available_seats) <= 0;

      const card = document.createElement("div");
      card.className =
        "relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm";

      card.innerHTML = `
        <div class="mt-2 flex flex-col gap-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-sm text-slate-500">راننده</div>
              <div class="mt-1 text-lg font-bold text-slate-900">${driver ? escapeAttr(driver.name) : `#${trip.driver_id}`}</div>
              <div class="mt-1 text-sm text-slate-600">${profile ? escapeAttr(profile.vehicle_model) : "پروفایل خودرو نامشخص"}</div>
            </div>
            <div class="flex flex-col items-end gap-1">
              <div class="text-sm text-slate-500">تاریخ/زمان حرکت</div>
              <div class="text-sm font-semibold text-slate-800">${formatDateTime(trip.departure_time)}</div>
            </div>
          </div>

          <div class="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <div class="text-xs text-slate-500">مسیر کامل</div>
            <div class="mt-1 text-sm font-semibold text-slate-700">${checkpointsToRoute(trip.checkpoints)}</div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div class="text-xs text-slate-500">قیمت هر صندلی</div>
              <div class="mt-1 text-sm font-bold text-slate-900">${Number(trip.price).toLocaleString("fa-IR")} تومان</div>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div class="text-xs text-slate-500">ظرفیت باقی‌مانده</div>
              <div class="mt-1 text-sm font-bold ${isCapacityFull ? 'text-amber-700' : 'text-slate-900'}">${trip.available_seats} صندلی</div>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-500">وضعیت سفر:</span>
              ${tripStatusBadge(trip.status, trip.available_seats)}
            </div>
            ${
              isCapacityFull
                ? `<button disabled class="rounded-2xl bg-amber-50 px-5 py-3 text-sm font-bold text-amber-800 ring-1 ring-amber-200 cursor-not-allowed">اتمام ظرفیت</button>`
                : `<button class="btn-request rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">ارسال درخواست صندلی</button>`
            }
          </div>
        </div>
      `;

      if (!isCapacityFull) {
        const btn = card.querySelector(".btn-request");
        btn?.addEventListener("click", async () => {
          await withLoading(
            () =>
              apiFetch(`/trips/${trip.id}/request`, {
                method: "POST",
                body: { passenger_id: session.user_id },
              }),
            "در حال ارسال درخواست…"
          );
          showToast("درخواست صندلی برای راننده ارسال شد.", "success");
          await refreshMyTrips();
        });
      }

      results.appendChild(card);
    }
  }

  const aiRecContainer = document.getElementById("passenger-ai-recommendations");
  const aiRecBtn = document.getElementById("btn-ai-recommend-trips");

  async function executeAiRecommendations(criteria = {}) {
    if (!aiRecContainer) return;
    aiRecContainer.classList.remove("hidden");
    aiRecContainer.innerHTML = `
      <div class="rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/80 p-6 shadow-sm">
        <div class="flex items-center gap-3.5">
          <div class="flex h-10 w-10 shrink-0 animate-spin items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md">
            ✨
          </div>
          <div>
            <div class="text-sm font-extrabold text-indigo-950">دستیار هوشمند Gemini در حال پردازش و رتبه‌بندی سفرها…</div>
            <div class="text-xs text-indigo-700 mt-1">بررسی تطابق مسیر، حداقل توقف‌های بین‌راهی، مناسب‌ترین زمان حرکت و قیمت هر صندلی</div>
          </div>
        </div>
      </div>
    `;

    try {
      const data = await apiFetch("/api/ai/recommend-trips", {
        method: "POST",
        body: criteria,
      });

      if (!data || !data.recommendations || !data.recommendations.length) {
        aiRecContainer.innerHTML = `
          <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div class="flex items-start gap-3 text-slate-700">
              <span class="text-2xl shrink-0">🤖</span>
              <div>
                <div class="text-sm font-bold text-slate-900">پیشنهاد هوشمندی برای این مسیر یافت نشد</div>
                <div class="text-xs text-slate-500 mt-1 leading-relaxed">${escapeAttr(data?.ai_summary || "در حال حاضر هیچ سفر فعالی با صندلی خالی برای مشخصات درخواستی در سامانه ثبت نشده است.")}</div>
              </div>
            </div>
          </div>
        `;
        return;
      }

      aiRecContainer.innerHTML = "";

      // هدر و باکس تحلیل کلی هوش مصنوعی
      const headerBox = document.createElement("div");
      headerBox.className =
        "rounded-3xl border border-indigo-300 bg-gradient-to-r from-violet-700 via-indigo-600 to-sky-600 p-5 text-white shadow-md";
      headerBox.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/20 text-base backdrop-blur-sm shadow-inner">✨</span>
            <div>
              <div class="text-sm font-black tracking-wide">پیشنهادهای هوشمند سفر (Gemini AI)</div>
              <div class="text-xs text-indigo-100 mt-0.5">تحلیل هوشمند بر اساس کمترین توقف، تطابق ایستگاه‌ها و قیمت اقتصادی</div>
            </div>
          </div>
          <span class="rounded-full bg-white/20 px-3.5 py-1 text-xs font-bold text-white backdrop-blur-sm border border-white/20">
            ${data.recommendations.length} سفر برگزیده هوش مصنوعی
          </span>
        </div>
        ${
          data.ai_summary
            ? `
          <div class="mt-3.5 rounded-2xl bg-white/10 p-3.5 backdrop-blur-md border border-white/10 text-xs leading-relaxed text-indigo-50 flex items-start gap-2.5">
            <span class="text-sm shrink-0">💡</span>
            <span><strong class="text-white font-bold">جمع‌بندی تحلیلی مدل Gemini:</strong> ${escapeAttr(data.ai_summary)}</span>
          </div>
        `
            : ""
        }
      `;
      aiRecContainer.appendChild(headerBox);

      // رندر هر یک از سفرهای رتبه‌بندی شده توسط هوش مصنوعی
      for (const rec of data.recommendations) {
        const trip = rec.trip;
        if (!trip) continue;
        const driver = usersById.get(trip.driver_id);
        const profile = await getDriverProfile(trip.driver_id);
        const isCapacityFull = Number(trip.available_seats) <= 0;

        const rankBadge =
          rec.rank === 1
            ? `<span class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-800 ring-1 ring-amber-500/30">🥇 انتخاب برتر هوشمند (#1)</span>`
            : rec.rank === 2
            ? `<span class="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-3 py-1 text-xs font-bold text-slate-800 ring-1 ring-slate-400/30">🥈 رتبه دوم (#2)</span>`
            : `<span class="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-3 py-1 text-xs font-bold text-indigo-800 ring-1 ring-indigo-500/30">✨ پیشنهاد رتبه ${rec.rank}</span>`;

        const highlightsHtml = (rec.highlights || [])
          .map(
            (h) =>
              `<span class="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200/80">${escapeAttr(h)}</span>`
          )
          .join(" ");

        const card = document.createElement("div");
        card.className =
          "relative overflow-hidden rounded-3xl border-2 border-indigo-400/50 bg-white p-5 shadow-sm ring-4 ring-indigo-50 transition hover:shadow-md";

        card.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div class="flex flex-wrap items-center gap-2">
              ${rankBadge}
              <div class="flex flex-wrap gap-1">${highlightsHtml}</div>
            </div>
            <div class="text-xs font-semibold text-slate-400">
              کد سفر: #${trip.id}
            </div>
          </div>

          <div class="mt-3 rounded-2xl bg-gradient-to-r from-violet-50 to-indigo-50 p-3.5 border border-indigo-100 text-xs">
            <div class="flex items-start gap-2">
              <span class="text-sm shrink-0">🎯</span>
              <div class="text-slate-800 leading-relaxed">
                <strong class="font-bold text-indigo-950">چرا این پیشنهاد؟</strong> ${escapeAttr(rec.reason)}
              </div>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-xs text-slate-500">راننده تاییدشده</div>
              <div class="mt-1 text-base font-bold text-slate-900">${driver ? escapeAttr(driver.name) : trip.driver_name ? escapeAttr(trip.driver_name) : `#${trip.driver_id}`}</div>
              <div class="mt-0.5 text-xs text-slate-600">${profile ? escapeAttr(profile.vehicle_model) : trip.vehicle_model ? escapeAttr(trip.vehicle_model) : "پروفایل خودرو نامشخص"}</div>
            </div>
            <div class="flex flex-col items-end gap-1">
              <div class="text-xs text-slate-500">زمان حرکت</div>
              <div class="text-sm font-bold text-slate-800">${formatDateTime(trip.departure_time)}</div>
            </div>
          </div>

          <div class="mt-3 rounded-2xl bg-slate-50 px-4 py-2.5 ring-1 ring-slate-200">
            <div class="text-[11px] text-slate-500">مسیر حرکت و ایستگاه‌ها</div>
            <div class="mt-0.5 text-sm font-bold text-slate-800">${checkpointsToRoute(trip.checkpoints)}</div>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-3">
            <div class="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5">
              <div class="text-[11px] text-slate-500">هزینه هر صندلی</div>
              <div class="mt-0.5 text-sm font-extrabold text-indigo-700">${Number(trip.price).toLocaleString("fa-IR")} تومان</div>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5">
              <div class="text-[11px] text-slate-500">ظرفیت صندلی خالی</div>
              <div class="mt-0.5 text-sm font-bold text-emerald-700">${trip.available_seats} صندلی خالی</div>
            </div>
          </div>

          <div class="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <div class="text-xs text-slate-500">
              وضعیت سفر: ${tripStatusBadge(trip.status, trip.available_seats)}
            </div>
            ${
              isCapacityFull
                ? `<button disabled class="rounded-xl bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-200 cursor-not-allowed">اتمام ظرفیت</button>`
                : `<button class="btn-request-ai rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-xs font-bold text-white shadow hover:opacity-95 transition">ارسال درخواست صندلی</button>`
            }
          </div>
        `;

        if (!isCapacityFull) {
          const btn = card.querySelector(".btn-request-ai");
          btn?.addEventListener("click", async () => {
            await withLoading(
              () =>
                apiFetch(`/trips/${trip.id}/request`, {
                  method: "POST",
                  body: { passenger_id: session.user_id },
                }),
              "در حال ارسال درخواست…"
            );
            showToast("درخواست صندلی برای راننده با موفقیت ارسال شد.", "success");
            await refreshMyTrips();
          });
        }

        aiRecContainer.appendChild(card);
      }

      aiRecContainer.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error("AI Recommendation fetch error:", err);
      aiRecContainer.innerHTML = `
        <div class="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          ⚠️ بروز خطا در دریافت پیشنهاد هوشمند: ${escapeAttr(err?.message || "خطای نامشخص")}
        </div>
      `;
    }
  }

  // Load all available trips initially so passenger can browse all rides
  await executeSearch({});

  const clearBtn = document.getElementById("btn-clear-search-filters");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      form.reset();
      if (aiRecContainer) {
        aiRecContainer.classList.add("hidden");
        aiRecContainer.innerHTML = "";
      }
      await executeSearch({});
    });
  }

  if (aiRecBtn) {
    aiRecBtn.addEventListener("click", async () => {
      const fd = new FormData(form);
      const origin = String(fd.get("origin_city") || originInput?.value || "").trim();
      const destination = String(fd.get("destination_city") || destInput?.value || "").trim();
      const departureDateShamsi = String(fd.get("departure_date") || "").trim();
      const minSeats = Number(fd.get("min_seats")) || 0;

      const criteria = {};
      if (origin) criteria.origin_city = origin;
      if (destination) criteria.destination_city = destination;
      if (minSeats > 0) criteria.min_seats = minSeats;

      if (departureDateShamsi) {
        const isoDate = parseJalaliDateToIso(departureDateShamsi);
        if (isoDate) {
          criteria.departure_date = isoDate;
        }
      }

      await executeAiRecommendations(criteria);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const origin = String(fd.get("origin_city") || originInput?.value || "").trim();
    const destination = String(fd.get("destination_city") || destInput?.value || "").trim();
    const departureDateShamsi = String(fd.get("departure_date") || "").trim();
    const minSeats = Number(fd.get("min_seats")) || 0;

    const query = {};
    if (origin) query.origin_city = origin;
    if (destination) query.destination_city = destination;
    if (minSeats > 0) query.min_seats = minSeats;

    if (departureDateShamsi) {
      const isoDate = parseJalaliDateToIso(departureDateShamsi);
      if (!isoDate) {
        showToast("فرمت تاریخ شمسی نامعتبر است (مثلاً ۱۴۰۴/۰۱/۱۵).", "warning");
        return;
      }
      query.departure_date = isoDate;
    }

    // اگر مسافر مبدأ یا مقصدی تعیین کرده باشد، همزمان تحلیل هوشمند را نیز به روز می‌کنیم
    if (origin || destination) {
      executeAiRecommendations(query);
    } else if (aiRecContainer) {
      aiRecContainer.classList.add("hidden");
    }

    await executeSearch(query);
  });
}

export async function loadAdminPanel(session) {
  const section = document.getElementById("panel-admin");
  const statsBox = document.getElementById("admin-stats");
  const usersTbody = document.getElementById("admin-users-body");
  const tripsTbody = document.getElementById("admin-trips-body");
  const addUserForm = document.getElementById("admin-add-user-form");

  const filterRoleSelect = document.getElementById("admin-users-role-filter");
  const searchInput = document.getElementById("admin-users-search");

  section.classList.remove("hidden");

  let allUsersList = [];

  if (filterRoleSelect) {
    filterRoleSelect.addEventListener("change", () => renderFilteredUsers());
  }
  if (searchInput) {
    searchInput.addEventListener("input", () => renderFilteredUsers());
  }

  if (addUserForm) {
    addUserForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(addUserForm);
      const name = String(fd.get("name") || "").trim();
      const phone = String(fd.get("phone") || "").trim();
      const password = String(fd.get("password") || "").trim();
      const role = String(fd.get("role") || "").trim();

      if (!name || !phone || !password || !role) {
        showToast("لطفاً تمام اطلاعات کاربر را وارد کنید.", "warning");
        return;
      }

      await withLoading(
        () =>
          apiFetch("/admin/users", {
            method: "POST",
            body: { name, phone, password, role },
          }),
        "در حال ثبت کاربر جدید…"
      );
      cache.usersById = null;
      showToast("کاربر جدید با موفقیت اضافه شد.", "success");
      addUserForm.reset();
      await refreshAdminData();
    });
  }

  function renderFilteredUsers() {
    if (!usersTbody) return;
    const roleFilter = filterRoleSelect ? filterRoleSelect.value : "all";
    const q = searchInput ? searchInput.value.trim().toLowerCase() : "";

    const filtered = allUsersList.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (q) {
        const matchName = String(u.name || "").toLowerCase().includes(q);
        const matchPhone = String(u.phone || "").toLowerCase().includes(q);
        return matchName || matchPhone;
      }
      return true;
    });

    usersTbody.innerHTML = "";
    if (!filtered.length) {
      usersTbody.innerHTML = `<tr><td colspan="5" class="px-4 py-6 text-center text-sm text-slate-500">هیچ کاربری با این مشخصات یافت نشد</td></tr>`;
      return;
    }

    for (const u of filtered) {
      const tr = document.createElement("tr");
      tr.className = "border-t border-slate-100 hover:bg-slate-50/50";
      tr.innerHTML = `
        <td class="px-4 py-3 text-sm font-semibold text-slate-800">
          ${escapeAttr(u.name)}
          ${u.role === "driver" ? `<button data-driver-detail-id="${u.id}" type="button" class="block text-[11px] font-bold text-indigo-600 hover:underline mt-0.5">🔍 جزییات راننده</button>` : ""}
        </td>
        <td class="px-4 py-3 text-sm text-slate-600">${roleLabel(u.role)}</td>
        <td class="px-4 py-3 text-sm text-slate-600">${escapeAttr(u.phone)}</td>
        <td class="px-4 py-3 text-sm font-mono font-bold text-indigo-600">${escapeAttr(u.password || "—")}</td>
        <td class="px-4 py-3 text-sm">
          ${
            session && u.id === session.user_id
              ? `<span class="text-xs text-slate-400">حساب خودتان</span>`
              : `<button data-del-id="${u.id}" class="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100">حذف کاربر</button>`
          }
        </td>
      `;
      usersTbody.appendChild(tr);
    }

    const driverBtns = usersTbody.querySelectorAll("[data-driver-detail-id]");
    for (const btn of driverBtns) {
      btn.addEventListener("click", () => {
        const dId = Number(btn.getAttribute("data-driver-detail-id"));
        openDriverDetailsModal(dId);
      });
    }

    const delBtns = usersTbody.querySelectorAll("[data-del-id]");
    for (const btn of delBtns) {
      btn.addEventListener("click", () => {
        const uId = Number(btn.getAttribute("data-del-id"));
        const userObj = allUsersList.find((u) => u.id === uId);
        const uName = userObj ? userObj.name : `#${uId}`;

        showConfirmDialog(
          "حذف کاربر",
          `آیا از حذف کامل کاربر «${escapeAttr(uName)}» و کلیه سفرهای ثبت‌شده و سوابق وی اطمینان دارید؟ این عملیات غیرقابل بازگشت است.`,
          async () => {
            try {
              await withLoading(
                () => apiFetch(`/admin/users/${uId}`, { method: "DELETE" }),
                "در حال حذف کاربر…"
              );
              cache.usersById = null;
              showToast("کاربر با موفقیت حذف شد.", "success");
              await refreshAdminData();
            } catch (err) {
              showToast(err?.message || "خطا در حذف کاربر", "error");
            }
          }
        );
      });
    }
  }

  async function openDriverDetailsModal(driverId) {
    const modal = document.getElementById("modal-driver-details");
    const body = document.getElementById("driver-modal-body");
    const title = document.getElementById("driver-details-modal-title");
    if (!modal || !body) return;

    modal.classList.remove("hidden");
    body.innerHTML = `<div class="p-6 text-center text-sm text-slate-500">در حال دریافت جزییات راننده…</div>`;

    try {
      const driver = allUsersList.find((u) => u.id === driverId);
      if (title) title.textContent = `اطلاعات راننده: ${driver ? driver.name : `#${driverId}`}`;

      const profile = await getDriverProfile(driverId);

      body.innerHTML = `
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div class="text-xs font-bold text-slate-500">مشخصات راننده</div>
            <div class="mt-2 text-sm font-bold text-slate-900">${driver ? driver.name : "—"}</div>
            <div class="mt-1 text-xs text-slate-600">شماره همراه: ${driver ? driver.phone : "—"}</div>
            <div class="mt-1 text-xs text-slate-600">رمز عبور: ${driver ? driver.password : "—"}</div>
          </div>

          <div class="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div class="text-xs font-bold text-indigo-700">اطلاعات خودرو</div>
            <div class="mt-2 text-sm font-bold text-slate-900">${profile ? profile.vehicle_model : "بدون خودرو"}</div>
            <div class="mt-1 text-xs text-slate-600">ظرفیت خودرو: ${profile ? profile.vehicle_capacity : "—"} نفر</div>
            <div class="mt-1 text-xs text-slate-600">وضعیت تایید: ${profile ? (profile.approval_status === "approved" ? "تایید شده ✅" : (profile.approval_status === "rejected" ? "رد شده ❌" : "در انتظار بررسی ⏳")) : "ثبت نشده"}</div>
          </div>
        </div>
      `;
    } catch (e) {
      body.innerHTML = `<div class="p-6 text-center text-sm text-rose-600">خطا در دریافت اطلاعات راننده</div>`;
    }
  }

  const driverModal = document.getElementById("modal-driver-details");
  const btnCloseD = document.getElementById("btn-close-driver-modal");
  const btnDoneD = document.getElementById("btn-done-driver-modal");
  const closeDModal = () => driverModal && driverModal.classList.add("hidden");
  if (btnCloseD) btnCloseD.addEventListener("click", closeDModal);
  if (btnDoneD) btnDoneD.addEventListener("click", closeDModal);

  async function refreshAdminData() {
    const [stats, users, trips] = await withLoading(
      async () => {
        const s = await apiFetch("/admin/stats");
        const u = await apiFetch("/users/");
        const t = await apiFetch("/trips/");
        return [s, u, t];
      },
      "در حال دریافت اطلاعات ادمین…"
    );

    allUsersList = users || [];

    statsBox.innerHTML = `
      <div class="grid gap-4 sm:grid-cols-3">
        ${statCard("تعداد کل کاربران", stats.total_users, "indigo")}
        ${statCard("تعداد سفرهای فعال", stats.active_trips, "emerald")}
        ${statCard("تعداد کل درخواست‌ها", stats.total_requests, "slate")}
      </div>
    `;

    renderFilteredUsers();

    tripsTbody.innerHTML = "";
    if (!trips.length) {
      tripsTbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-sm text-slate-500">هیچ سفری یافت نشد</td></tr>`;
    } else {
      for (const t of trips.sort((a, b) => b.id - a.id)) {
        tripsTbody.insertAdjacentHTML(
          "beforeend",
          `
            <tr class="border-t border-slate-100 align-top hover:bg-slate-50/50">
              <td class="px-4 py-3 text-sm font-semibold text-slate-800">#${t.id}</td>
              <td class="px-4 py-3 text-sm">${tripStatusBadge(t.status, t.available_seats)}</td>
              <td class="px-4 py-3 text-sm text-slate-600">${formatDateTime(t.departure_time)}</td>
              <td class="px-4 py-3 text-sm text-slate-600">${Number(t.price).toLocaleString("fa-IR")} تومان • ${t.available_seats} صندلی</td>
              <td class="px-4 py-3 text-sm text-slate-700">${checkpointsToRoute(t.checkpoints)}</td>
              <td class="px-4 py-3 text-sm">
                <button data-del-trip-id="${t.id}" class="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100 transition">حذف سفر</button>
              </td>
            </tr>
          `
        );
      }

      const delTripBtns = tripsTbody.querySelectorAll("[data-del-trip-id]");
      for (const btn of delTripBtns) {
        btn.addEventListener("click", () => {
          const tId = Number(btn.getAttribute("data-del-trip-id"));
          showConfirmDialog(
            "حذف سفر",
            `آیا از حذف کامل سفر #${tId} و تمام سوابق و رزروهای آن اطمینان دارید؟`,
            async () => {
              try {
                await withLoading(
                  () => apiFetch(`/admin/trips/${tId}`, { method: "DELETE" }),
                  "در حال حذف سفر…"
                );
                showToast("سفر با موفقیت حذف شد.", "success");
                await refreshAdminData();
              } catch (err) {
                showToast(err?.message || "خطا در حذف سفر", "error");
              }
            }
          );
        });
      }
    }

    const inspectionsTbody = document.getElementById("admin-inspections-body");
    if (inspectionsTbody) {
      inspectionsTbody.innerHTML = "";
      const inspections = await apiFetch("/inspections").catch(() => []);
      if (!inspections.length) {
        inspectionsTbody.innerHTML = `<tr><td colspan="7" class="px-4 py-6 text-center text-sm text-slate-500">هیچ گزارش بازرسی ثبت نشده است</td></tr>`;
      } else {
        for (const insp of inspections) {
          const roleTxt = insp.inspector_type === "independent" ? "بازرس مستقل" : "بازرس تحت‌نظر";
          inspectionsTbody.insertAdjacentHTML(
            "beforeend",
            `
              <tr class="border-t border-slate-100 text-xs">
                <td class="px-4 py-3 font-bold text-slate-900">#${insp.id}</td>
                <td class="px-4 py-3 font-semibold text-slate-800">${escapeAttr(insp.inspector_name || `کاربر #${insp.inspector_id}`)}</td>
                <td class="px-4 py-3 text-slate-600"><span class="rounded-lg bg-slate-100 px-2 py-1 font-semibold">${roleTxt}</span></td>
                <td class="px-4 py-3 font-semibold text-indigo-600">${insp.trip_id ? `#${insp.trip_id}` : "عمومی / تخلف"}</td>
                <td class="px-4 py-3 text-slate-700 max-w-xs truncate" title="${escapeAttr(insp.result)}">${escapeAttr(insp.result)}</td>
                <td class="px-4 py-3">${badge(insp.approval_status)}</td>
                <td class="px-4 py-3 text-slate-500">${formatDateTime(insp.created_at)}</td>
              </tr>
            `
          );
        }
      }
    }
  }

  await refreshAdminData();
}

export async function loadInspectorPanel(session) {
  const panel = document.getElementById("panel-inspector");
  if (!panel) return;
  panel.classList.remove("hidden");

  const driversListEl = document.getElementById("inspector-drivers-list");
  const btnRefreshDrivers = document.getElementById("btn-refresh-inspector-drivers");
  const filterSelect = document.getElementById("inspector-driver-filter");

  let cachedDrivers = [];

  function renderFilteredDrivers() {
    if (!driversListEl) return;
    const filterVal = filterSelect ? filterSelect.value : "pending";

    const filtered = cachedDrivers.filter((d) => {
      const status = d.approval_status || "pending";
      if (filterVal === "all") return true;
      return status === filterVal;
    });

    if (!filtered.length) {
      const msg =
        filterVal === "pending"
          ? "در حال حاضر هیچ راننده جدیدی در انتظار بررسی بازرس نیست."
          : "هیچ راننده‌ای در این دسته‌بندی یافت نشد.";
      driversListEl.innerHTML = `<div class="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">${msg}</div>`;
      return;
    }

    driversListEl.innerHTML = "";
    for (const d of filtered) {
      const card = document.createElement("div");
      card.className = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4";

      const status = d.approval_status || "pending";
      let statusBadge = "";
      if (status === "pending") {
        statusBadge = `<span class="rounded-full bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-700 ring-1 ring-inset ring-amber-200">⏳ در انتظار تایید بازرس</span>`;
      } else if (status === "approved") {
        statusBadge = `<span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700 ring-1 ring-inset ring-emerald-200">✅ تایید صلاحیت شده</span>`;
      } else {
        statusBadge = `<span class="rounded-full bg-rose-50 px-3 py-1 text-xs font-extrabold text-rose-700 ring-1 ring-inset ring-rose-200">❌ رد صلاحیت شده</span>`;
      }

      card.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div class="flex items-center gap-2">
            <span class="rounded-xl bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700">راننده #${d.user_id}</span>
            <span class="text-sm font-bold text-slate-900">${escapeAttr(d.name)}</span>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div class="grid gap-3 sm:grid-cols-3 text-xs">
          <div class="rounded-xl bg-slate-50 p-3 space-y-1">
            <div class="font-bold text-slate-500">اطلاعات تماس</div>
            <div class="text-sm font-bold text-slate-800">${escapeAttr(d.phone)}</div>
            <div class="text-slate-500 text-[11px]">شناسه کاربری: #${d.user_id}</div>
          </div>

          <div class="rounded-xl bg-slate-50 p-3 space-y-1">
            <div class="font-bold text-slate-500">خودرو و ظرفیت</div>
            <div class="text-sm font-bold text-slate-800">${escapeAttr(d.vehicle_model || "نامشخص")}</div>
            <div class="text-indigo-600 font-semibold">ظرفیت مسافر: ${d.vehicle_capacity || 4} نفر ${d.vehicle_color ? `• رنگ: ${escapeAttr(d.vehicle_color)}` : ""}</div>
          </div>

          <div class="rounded-xl bg-slate-50 p-3 space-y-1">
            <div class="font-bold text-slate-500">پلاک و وضعیت فعلی</div>
            <div class="text-sm font-bold text-slate-800">${escapeAttr(d.license_plate || "پلاک ثبت‌نشده")}</div>
            <div class="text-slate-600 text-[11px]">${d.approved_by_name ? `بررسی شده توسط: ${escapeAttr(d.approved_by_name)}` : "هنوز بررسی نشده"}</div>
          </div>
        </div>

        ${
          d.inspection_note
            ? `<div class="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-xs text-slate-700">
                <span class="font-bold text-slate-800">یادداشت ارزیابی قبلی بازرس:</span> ${escapeAttr(d.inspection_note)}
              </div>`
            : ""
        }

        <div class="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
          <label class="block text-xs font-bold text-slate-700 mb-1">ارزیابی مدارک و خودرو توسط بازرس:</label>
          <textarea id="note-driver-${d.user_id}" rows="2" class="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="توضیحات و نتیجه ارزیابی خودرو، مدارک شناسایی، بیمه‌نامه و معاینه فنی..."></textarea>
          
          <div class="mt-3 flex flex-wrap items-center gap-2 justify-end">
            <button data-action="approve" data-driver-user-id="${d.user_id}" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition flex items-center gap-1.5">
              <span>✅</span>
              <span>تایید صلاحیت راننده و مجوز ثبت سفر</span>
            </button>
            <button data-action="reject" data-driver-user-id="${d.user_id}" class="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-rose-700 transition flex items-center gap-1.5">
              <span>❌</span>
              <span>رد صلاحیت راننده / مدارک</span>
            </button>
          </div>
        </div>
      `;

      card.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const action = btn.getAttribute("data-action");
          const driverUserId = Number(btn.getAttribute("data-driver-user-id"));
          const noteEl = document.getElementById(`note-driver-${driverUserId}`);
          const note = noteEl ? noteEl.value.trim() : "";

          try {
            await withLoading(async () => {
              await apiFetch("/inspectors/verify-driver", {
                method: "POST",
                body: {
                  inspector_id: session.user_id,
                  driver_user_id: driverUserId,
                  status: action === "approve" ? "approved" : "rejected",
                  note: note || (action === "approve" ? "صلاحیت راننده و مشخصات خودرو تایید شد." : "مدارک یا مشخصات خودرو رد شد."),
                },
              });
            }, "در حال ثبت نتیجه ارزیابی…");

            cache.driverProfilesByUserId.delete(driverUserId);
            showToast(
              action === "approve"
                ? "صلاحیت راننده با موفقیت تایید شد و امکان تعریف سفر برای او فعال گردید."
                : "راننده رد صلاحیت شد.",
              "success"
            );
            await refreshDrivers();
          } catch (err) {
            showToast(err?.message || "خطا در ثبت تایید صلاحیت راننده", "error");
          }
        });
      });

      driversListEl.appendChild(card);
    }
  }

  async function refreshDrivers() {
    if (!driversListEl) return;
    driversListEl.innerHTML = `<div class="p-8 text-center text-sm text-slate-500">در حال دریافت لیست رانندگان…</div>`;
    try {
      const drivers = await apiFetch("/inspectors/drivers").catch(() => []);
      cachedDrivers = drivers || [];
      renderFilteredDrivers();
    } catch (err) {
      driversListEl.innerHTML = `<div class="p-6 text-center text-sm text-rose-600">خطا در بارگذاری لیست رانندگان</div>`;
    }
  }

  btnRefreshDrivers?.addEventListener("click", refreshDrivers);
  filterSelect?.addEventListener("change", renderFilteredDrivers);
  await refreshDrivers();
}

export const loadInspectorIndependentPanel = loadInspectorPanel;
export const loadInspectorManagedPanel = loadInspectorPanel;

function statCard(title, value, accent) {
  const colors = {
    indigo: "from-indigo-600 to-indigo-500 ring-indigo-200",
    emerald: "from-emerald-600 to-emerald-500 ring-emerald-200",
    slate: "from-slate-800 to-slate-700 ring-slate-200",
  };
  const c = colors[accent] || colors.slate;
  return `
    <div class="relative overflow-hidden rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-l ${c}"></div>
      <div class="text-sm font-semibold text-slate-600">${title}</div>
      <div class="mt-2 text-3xl font-extrabold text-slate-900">${Number(value).toLocaleString("fa-IR")}</div>
    </div>
  `;
}

function badge(status) {
  const map = {
    pending: ["در انتظار", "bg-amber-100 text-amber-700 ring-amber-200"],
    approved: ["تایید شده", "bg-emerald-100 text-emerald-700 ring-emerald-200"],
    rejected: ["رد شده", "bg-rose-100 text-rose-700 ring-rose-200"],
  };
  const [label, cls] = map[status] || [status, "bg-slate-100 text-slate-700 ring-slate-200"];
  return `<span class="rounded-full px-3 py-1 text-xs font-semibold ring-1 ${cls}">${label}</span>`;
}

function escapeAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
