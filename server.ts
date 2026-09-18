import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import initSqlJs, { Database } from "sql.js";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "safaryar.db");

let db: Database;

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_FILE, buffer);
}

async function initDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS driver_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      vehicle_model TEXT NOT NULL,
      vehicle_capacity INTEGER NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      inspection_note TEXT,
      approved_by INTEGER,
      vehicle_color TEXT,
      license_plate TEXT,
      created_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      departure_time TEXT NOT NULL,
      available_seats INTEGER NOT NULL DEFAULT 0,
      price INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (driver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      city_name TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      type TEXT NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id)
    );

    CREATE TABLE IF NOT EXISTS ride_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      passenger_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (passenger_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspector_id INTEGER NOT NULL,
      trip_id INTEGER,
      inspector_type TEXT NOT NULL,
      result TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'approved',
      created_at TEXT NOT NULL,
      FOREIGN KEY (inspector_id) REFERENCES users(id),
      FOREIGN KEY (trip_id) REFERENCES trips(id)
    );
  `);

  try { db.run("DROP TABLE IF EXISTS reviews"); } catch {}
  try { db.run("DROP TABLE IF EXISTS violations"); } catch {}

  try { db.run("ALTER TABLE driver_profiles ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'"); } catch {}
  try { db.run("ALTER TABLE driver_profiles ADD COLUMN inspection_note TEXT"); } catch {}
  try { db.run("ALTER TABLE driver_profiles ADD COLUMN approved_by INTEGER"); } catch {}
  try { db.run("ALTER TABLE driver_profiles ADD COLUMN vehicle_color TEXT"); } catch {}
  try { db.run("ALTER TABLE driver_profiles ADD COLUMN license_plate TEXT"); } catch {}
  try { db.run("ALTER TABLE driver_profiles ADD COLUMN created_at TEXT"); } catch {}

  const userCountRes = db.exec("SELECT COUNT(*) as count FROM users");
  const userCount = userCountRes[0]?.values[0][0] as number;

  if (userCount === 0) {
    db.run("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)", [
      "مدیر سیستم",
      "09120000000",
      "1234",
      "admin",
    ]);
    db.run("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)", [
      "رضا کاظمی",
      "09121111111",
      "1234",
      "driver",
    ]);
    db.run("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)", [
      "سارا محمدی",
      "09122222222",
      "1234",
      "passenger",
    ]);

    db.run(
      "INSERT INTO driver_profiles (user_id, vehicle_model, vehicle_capacity, approval_status, created_at) VALUES (?, ?, ?, 'approved', ?)",
      [2, "پژو 206 | سفید | 12الف345 ایران67", 4, new Date().toISOString()]
    );

    const now = new Date().toISOString();
    db.run(
      "INSERT INTO trips (driver_id, status, departure_time, available_seats, price, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [2, "completed", now, 3, 180000, now]
    );

    const tripIdRes = db.exec("SELECT last_insert_rowid() as id");
    const tripId = tripIdRes[0]?.values[0][0] as number;

    db.run(
      'INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)',
      [tripId, "تهران", 0, "origin"]
    );
    db.run(
      'INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)',
      [tripId, "قم", 1, "stop"]
    );
    db.run(
      'INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)',
      [tripId, "اصفهان", 2, "destination"]
    );

    db.run(
      "INSERT INTO ride_requests (trip_id, passenger_id, status) VALUES (?, ?, 'approved')",
      [tripId, 3]
    );

    saveDb();
  }

  // Consolidate legacy inspector roles to unified 'inspector'
  db.run("UPDATE users SET role = 'inspector' WHERE role IN ('inspector_independent', 'inspector_managed')");

  const indepStmt = db.prepare("SELECT id FROM users WHERE phone = ?");
  indepStmt.bind(["09121111114"]);
  if (!indepStmt.step()) {
    db.run("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)", [
      "سهراب سپهری (بازرس)",
      "09121111114",
      "1234",
      "inspector",
    ]);
  }
  indepStmt.free();

  const managedStmt = db.prepare("SELECT id FROM users WHERE phone = ?");
  managedStmt.bind(["09121111115"]);
  if (!managedStmt.step()) {
    db.run("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)", [
      "پروین اعتصامی (بازرس)",
      "09121111115",
      "1234",
      "inspector",
    ]);
  }
  managedStmt.free();
  // Seed sample planned trips if trips count is 1
  const tripCountRes = db.exec("SELECT COUNT(*) as count FROM trips");
  const tripCount = tripCountRes[0]?.values[0][0] as number;
  if (tripCount <= 1) {
    const futureDate1 = new Date(Date.now() + 86400000).toISOString();
    const futureDate2 = new Date(Date.now() + 172800000).toISOString();

    // Driver 2 planned trip Tehran -> Rasht
    db.run(
      "INSERT INTO trips (driver_id, status, departure_time, available_seats, price, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [2, "planned", futureDate1, 3, 250000, new Date().toISOString()]
    );
    const t1Id = (db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0]) as number;
    db.run('INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)', [t1Id, "تهران", 0, "origin"]);
    db.run('INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)', [t1Id, "قزوین", 1, "stop"]);
    db.run('INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)', [t1Id, "رشت", 2, "destination"]);

    // Another trip Tehran -> Isfahan
    db.run(
      "INSERT INTO trips (driver_id, status, departure_time, available_seats, price, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [2, "planned", futureDate2, 4, 320000, new Date().toISOString()]
    );
    const t2Id = (db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0]) as number;
    db.run('INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)', [t2Id, "تهران", 0, "origin"]);
    db.run('INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)', [t2Id, "قم", 1, "stop"]);
    db.run('INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)', [t2Id, "اصفهان", 2, "destination"]);
  }

  saveDb();
}

async function startServer() {
  await initDatabase();

  const app = express();
  app.use(express.json());


  app.post("/users/register", (req: Request, res: Response) => {
    const { name, phone, password, role, vehicle_model, vehicle_color, vehicle_capacity, license_plate } = req.body || {};
    if (!name || !phone || !password || !role) {
      res.status(400).json({ detail: "تمام فیلدها الزامی هستند" });
      return;
    }

    if (role !== "passenger" && role !== "driver") {
      res.status(403).json({ detail: "ثبت‌نام مستقیم فقط برای نقش‌های مسافر و راننده مجاز است. بازرسین باید توسط مدیر سیستم اضافه شوند." });
      return;
    }

    const checkStmt = db.prepare("SELECT * FROM users WHERE phone = ?");
    checkStmt.bind([phone]);
    if (checkStmt.step()) {
      checkStmt.free();
      res.status(400).json({ detail: "این شماره موبایل قبلاً ثبت شده است" });
      return;
    }
    checkStmt.free();

    db.run("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)", [
      name,
      phone,
      password,
      role,
    ]);

    const idStmt = db.exec("SELECT last_insert_rowid() as id");
    const id = idStmt[0]?.values[0][0] as number;

    if (role === "driver") {
      const vModel = vehicle_model ? String(vehicle_model).trim() : "در انتظار تکمیل مشخصات خودرو";
      const vCap = Number(vehicle_capacity) || 4;
      const vColor = vehicle_color ? String(vehicle_color).trim() : "";
      const vPlate = license_plate ? String(license_plate).trim() : "";
      const combinedModel = vPlate ? `${vModel} | ${vColor || "رنگ نامشخص"} | ${vPlate}` : vModel;
      const now = new Date().toISOString();

      db.run(
        "INSERT INTO driver_profiles (user_id, vehicle_model, vehicle_capacity, approval_status, vehicle_color, license_plate, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
        [id, combinedModel, vCap, vColor || null, vPlate || null, now]
      );
    }

    saveDb();

    res.json({ id, name, phone, role });
  });

  app.post("/users/login", (req: Request, res: Response) => {
    const { phone, password } = req.body || {};
    const stmt = db.prepare("SELECT * FROM users WHERE phone = ? AND password = ?");
    stmt.bind([phone, password]);

    if (!stmt.step()) {
      stmt.free();
      res.status(401).json({ detail: "شماره موبایل یا رمز عبور اشتباه است" });
      return;
    }

    const row = stmt.getAsObject() as {
      id: number;
      name: string;
      phone: string;
      role: string;
    };
    stmt.free();

    res.json({ id: row.id, name: row.name, phone: row.phone, role: row.role });
  });

  app.get("/users/", (req: Request, res: Response) => {
    const stmt = db.prepare("SELECT id, name, phone, password, role FROM users");
    const users = [];
    while (stmt.step()) {
      users.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(users);
  });

  app.post("/admin/users", (req: Request, res: Response) => {
    const { name, phone, password, role } = req.body || {};
    if (!name || !phone || !password || !role) {
      res.status(400).json({ detail: "تمام فیلدها الزامی هستند" });
      return;
    }

    const checkStmt = db.prepare("SELECT * FROM users WHERE phone = ?");
    checkStmt.bind([phone]);
    if (checkStmt.step()) {
      checkStmt.free();
      res.status(400).json({ detail: "این شماره موبایل قبلاً ثبت شده است" });
      return;
    }
    checkStmt.free();

    db.run("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)", [
      name,
      phone,
      password,
      role,
    ]);

    const idStmt = db.exec("SELECT last_insert_rowid() as id");
    const id = idStmt[0]?.values[0][0] as number;

    if (role === "driver") {
      const now = new Date().toISOString();
      db.run(
        "INSERT INTO driver_profiles (user_id, vehicle_model, vehicle_capacity, approval_status, created_at) VALUES (?, ?, ?, 'pending', ?)",
        [id, "در انتظار ثبت و تایید مشخصات خودرو", 4, now]
      );
    }
    saveDb();

    res.json({ id, name, phone, password, role });
  });

  app.put("/users/:user_id", (req: Request, res: Response) => {
    const userId = Number(req.params.user_id);
    const { name, phone, password } = req.body || {};

    if (!name || !phone) {
      res.status(400).json({ detail: "نام و شماره موبایل الزامی هستند" });
      return;
    }

    const checkStmt = db.prepare("SELECT * FROM users WHERE id = ?");
    checkStmt.bind([userId]);
    if (!checkStmt.step()) {
      checkStmt.free();
      res.status(404).json({ detail: "کاربر یافت نشد" });
      return;
    }
    const user = checkStmt.getAsObject() as { role: string; phone: string };
    checkStmt.free();

    if (phone !== user.phone) {
      const dupStmt = db.prepare("SELECT id FROM users WHERE phone = ? AND id != ?");
      dupStmt.bind([phone, userId]);
      if (dupStmt.step()) {
        dupStmt.free();
        res.status(400).json({ detail: "این شماره موبایل قبلاً برای کاربر دیگری ثبت شده است" });
        return;
      }
      dupStmt.free();
    }

    if (password && password.trim()) {
      db.run("UPDATE users SET name = ?, phone = ?, password = ? WHERE id = ?", [
        name,
        phone,
        password.trim(),
        userId,
      ]);
    } else {
      db.run("UPDATE users SET name = ?, phone = ? WHERE id = ?", [name, phone, userId]);
    }
    saveDb();

    res.json({ id: userId, name, phone, role: user.role });
  });

  app.delete("/admin/users/:user_id", (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.user_id);
      const checkStmt = db.prepare("SELECT * FROM users WHERE id = ?");
      checkStmt.bind([userId]);
      if (!checkStmt.step()) {
        checkStmt.free();
        res.status(404).json({ detail: "کاربر یافت نشد" });
        return;
      }
      checkStmt.free();

      // Find all trips belonging to this driver
      const tripStmt = db.prepare("SELECT id FROM trips WHERE driver_id = ?");
      tripStmt.bind([userId]);
      const tripIds: number[] = [];
      while (tripStmt.step()) {
        const t = tripStmt.getAsObject() as { id: number };
        tripIds.push(t.id);
      }
      tripStmt.free();

      // Temporarily disable foreign keys for clean atomic cascading removal
      db.run("PRAGMA foreign_keys = OFF;");

      for (const tId of tripIds) {
        db.run("DELETE FROM checkpoints WHERE trip_id = ?", [tId]);
        db.run("DELETE FROM ride_requests WHERE trip_id = ?", [tId]);
        db.run("DELETE FROM inspections WHERE trip_id = ?", [tId]);
      }
      db.run("DELETE FROM trips WHERE driver_id = ?", [userId]);

      // Remove or nullify references to this user in profiles, inspections, and requests
      db.run("UPDATE driver_profiles SET approved_by = NULL WHERE approved_by = ?", [userId]);
      db.run("DELETE FROM driver_profiles WHERE user_id = ?", [userId]);
      db.run("DELETE FROM ride_requests WHERE passenger_id = ?", [userId]);
      db.run("DELETE FROM inspections WHERE inspector_id = ?", [userId]);
      db.run("DELETE FROM users WHERE id = ?", [userId]);

      db.run("PRAGMA foreign_keys = ON;");
      saveDb();

      res.json({ message: "کاربر با موفقیت حذف شد", id: userId });
    } catch (err: any) {
      db.run("PRAGMA foreign_keys = ON;");
      console.error("Delete user error:", err);
      res.status(500).json({ detail: "خطا در حذف کاربر: " + (err?.message || "خطای سرور") });
    }
  });

  app.delete("/admin/trips/:trip_id", (req: Request, res: Response) => {
    try {
      const tripId = Number(req.params.trip_id);
      const checkStmt = db.prepare("SELECT * FROM trips WHERE id = ?");
      checkStmt.bind([tripId]);
      if (!checkStmt.step()) {
        checkStmt.free();
        res.status(404).json({ detail: "سفر یافت نشد" });
        return;
      }
      checkStmt.free();

      db.run("PRAGMA foreign_keys = OFF;");
      db.run("DELETE FROM checkpoints WHERE trip_id = ?", [tripId]);
      db.run("DELETE FROM ride_requests WHERE trip_id = ?", [tripId]);
      db.run("DELETE FROM inspections WHERE trip_id = ?", [tripId]);
      db.run("DELETE FROM trips WHERE id = ?", [tripId]);
      db.run("PRAGMA foreign_keys = ON;");
      saveDb();

      res.json({ message: "سفر با موفقیت حذف شد", id: tripId });
    } catch (err: any) {
      db.run("PRAGMA foreign_keys = ON;");
      console.error("Delete trip error:", err);
      res.status(500).json({ detail: "خطا در حذف سفر: " + (err?.message || "خطای سرور") });
    }
  });


  app.post("/drivers/profile", (req: Request, res: Response) => {
    const { user_id, vehicle_model, vehicle_capacity, vehicle_color, license_plate } = req.body || {};

    const uStmt = db.prepare("SELECT * FROM users WHERE id = ?");
    uStmt.bind([user_id]);
    if (!uStmt.step()) {
      uStmt.free();
      res.status(404).json({ detail: "کاربر یافت نشد" });
      return;
    }
    const user = uStmt.getAsObject() as { role: string };
    uStmt.free();

    if (user.role !== "driver") {
      res.status(400).json({ detail: "فقط راننده می‌تواند پروفایل خودرو بسازد" });
      return;
    }

    const pStmt = db.prepare("SELECT * FROM driver_profiles WHERE user_id = ?");
    pStmt.bind([user_id]);
    if (pStmt.step()) {
      pStmt.free();
      res.status(400).json({ detail: "این راننده قبلاً پروفایل دارد" });
      return;
    }
    pStmt.free();

    const now = new Date().toISOString();
    db.run(
      "INSERT INTO driver_profiles (user_id, vehicle_model, vehicle_capacity, approval_status, vehicle_color, license_plate, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
      [user_id, vehicle_model, vehicle_capacity, vehicle_color || null, license_plate || null, now]
    );
    saveDb();

    const idStmt = db.exec("SELECT last_insert_rowid() as id");
    const id = idStmt[0]?.values[0][0] as number;

    res.json({ id, user_id, vehicle_model, vehicle_capacity, approval_status: "pending" });
  });

  app.get("/drivers/profile/:user_id", (req: Request, res: Response) => {
    const userId = Number(req.params.user_id);
    const stmt = db.prepare("SELECT * FROM driver_profiles WHERE user_id = ?");
    stmt.bind([userId]);

    if (!stmt.step()) {
      stmt.free();
      res.status(404).json({ detail: "پروفایل راننده یافت نشد" });
      return;
    }

    const profile = stmt.getAsObject();
    stmt.free();
    res.json(profile);
  });

  app.put("/drivers/profile/:user_id", (req: Request, res: Response) => {
    const userId = Number(req.params.user_id);
    const { vehicle_model, vehicle_capacity, vehicle_color, license_plate } = req.body || {};

    const pStmt = db.prepare("SELECT * FROM driver_profiles WHERE user_id = ?");
    pStmt.bind([userId]);
    const exists = pStmt.step();
    pStmt.free();

    const now = new Date().toISOString();
    if (exists) {
      db.run(
        "UPDATE driver_profiles SET vehicle_model = ?, vehicle_capacity = ?, vehicle_color = COALESCE(?, vehicle_color), license_plate = COALESCE(?, license_plate), approval_status = 'pending' WHERE user_id = ?",
        [vehicle_model, vehicle_capacity, vehicle_color || null, license_plate || null, userId]
      );
    } else {
      db.run(
        "INSERT INTO driver_profiles (user_id, vehicle_model, vehicle_capacity, approval_status, vehicle_color, license_plate, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
        [userId, vehicle_model, vehicle_capacity, vehicle_color || null, license_plate || null, now]
      );
    }
    saveDb();

    res.json({ user_id: userId, vehicle_model, vehicle_capacity, approval_status: "pending" });
  });


  function getCheckpointsForTrip(tripId: number) {
    const stmt = db.prepare('SELECT * FROM checkpoints WHERE trip_id = ? ORDER BY "order" ASC');
    stmt.bind([tripId]);
    const list = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject());
    }
    stmt.free();
    return list;
  }

  app.post("/trips/", (req: Request, res: Response) => {
    const { driver_id, departure_time, available_seats, price, checkpoints } = req.body || {};

    const dStmt = db.prepare("SELECT * FROM users WHERE id = ?");
    dStmt.bind([driver_id]);
    if (!dStmt.step()) {
      dStmt.free();
      res.status(404).json({ detail: "راننده یافت نشد" });
      return;
    }
    const driver = dStmt.getAsObject() as { role: string };
    dStmt.free();

    if (driver.role !== "driver") {
      res.status(400).json({ detail: "فقط راننده می‌تواند سفر ایجاد کند" });
      return;
    }

    const pStmt = db.prepare("SELECT * FROM driver_profiles WHERE user_id = ?");
    pStmt.bind([driver_id]);
    if (!pStmt.step()) {
      pStmt.free();
      res.status(403).json({ detail: "ابتدا باید اطلاعات و مدارک خودروی خود را تکمیل کنید." });
      return;
    }
    const profile = pStmt.getAsObject() as { approval_status: string };
    pStmt.free();

    if (profile.approval_status !== "approved") {
      res.status(403).json({
        detail: "حساب رانندگی و مشخصات خودروی شما هنوز در صف بررسی و تایید بازرسان است. لطفاً کمی صبور باشید؛ پس از تایید صلاحیت توسط بازرس، امکان تعریف سفر فعال خواهد شد.",
      });
      return;
    }

    if (!Array.isArray(checkpoints) || checkpoints.length < 2) {
      res.status(400).json({ detail: "حداقل 2 checkpoint لازم است" });
      return;
    }

    const sortedCps = [...checkpoints].sort((a, b) => a.order - b.order);
    const expectedOrders = sortedCps.map((_, i) => i);
    const actualOrders = sortedCps.map((c) => c.order);

    if (JSON.stringify(actualOrders) !== JSON.stringify(expectedOrders)) {
      res.status(400).json({
        detail: "ترتیب checkpointها باید از 0 شروع شود و به صورت 0,1,2,... باشد",
      });
      return;
    }

    if (sortedCps[0].type !== "origin") {
      res.status(400).json({ detail: "checkpoint اول باید از نوع origin باشد" });
      return;
    }

    if (sortedCps[sortedCps.length - 1].type !== "destination") {
      res.status(400).json({ detail: "checkpoint آخر باید از نوع destination باشد" });
      return;
    }

    for (let i = 1; i < sortedCps.length - 1; i++) {
      if (sortedCps[i].type !== "stop") {
        res.status(400).json({ detail: "checkpointهای میانی باید از نوع stop باشند" });
        return;
      }
    }

    const now = new Date().toISOString();
    db.run(
      "INSERT INTO trips (driver_id, status, departure_time, available_seats, price, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [driver_id, "planned", departure_time, available_seats, price, now]
    );

    const tripIdRes = db.exec("SELECT last_insert_rowid() as id");
    const tripId = tripIdRes[0]?.values[0][0] as number;

    for (const cp of sortedCps) {
      db.run(
        'INSERT INTO checkpoints (trip_id, city_name, "order", type) VALUES (?, ?, ?, ?)',
        [tripId, cp.city_name, cp.order, cp.type]
      );
    }
    saveDb();

    res.json({
      id: tripId,
      driver_id,
      status: "planned",
      departure_time,
      available_seats,
      price,
      created_at: now,
      checkpoints: getCheckpointsForTrip(tripId),
    });
  });

  app.get("/trips/", (req: Request, res: Response) => {
    const stmt = db.prepare("SELECT * FROM trips");
    const trips = [];
    while (stmt.step()) {
      const trip = stmt.getAsObject() as { id: number };
      trips.push({
        ...trip,
        checkpoints: getCheckpointsForTrip(trip.id),
      });
    }
    stmt.free();
    res.json(trips);
  });

  app.get("/trips/search", (req: Request, res: Response) => {
    const originCity = String(req.query.origin_city || "").trim();
    const destCity = String(req.query.destination_city || "").trim();
    const departureDate = String(req.query.departure_date || "").trim();
    const minSeats = Number(req.query.min_seats || 0);

    const stmt = db.prepare("SELECT * FROM trips WHERE status = 'planned' ORDER BY id DESC");
    const allTrips = [];
    while (stmt.step()) {
      const trip = stmt.getAsObject() as {
        id: number;
        driver_id: number;
        status: string;
        departure_time: string;
        available_seats: number;
        price: number;
        created_at: string;
      };
      if (trip.status !== "planned") continue;
      const checkpoints = getCheckpointsForTrip(trip.id) as Array<{ city_name: string; type: string; order: number }>;
      
      const originCp = checkpoints.find((c) => c.type === "origin");
      const destCp = checkpoints.find((c) => c.type === "destination");

      let matches = true;

      if (originCity) {
        if (!originCp || !originCp.city_name.includes(originCity)) {
          matches = false;
        }
      }

      if (destCity) {
        if (!destCp || !destCp.city_name.includes(destCity)) {
          matches = false;
        }
      }

      if (minSeats > 0) {
        if ((trip.available_seats || 0) < minSeats) {
          matches = false;
        }
      }

      if (departureDate && trip.departure_time) {
        const tripDateStr = trip.departure_time.slice(0, 10);
        if (!tripDateStr.includes(departureDate) && !departureDate.includes(tripDateStr)) {
          matches = false;
        }
      }

      if (matches) {
        allTrips.push({
          ...trip,
          checkpoints,
        });
      }
    }
    stmt.free();
    res.json(allTrips);
  });

  app.get("/trips/:trip_id", (req: Request, res: Response) => {
    const tripId = Number(req.params.trip_id);
    const stmt = db.prepare("SELECT * FROM trips WHERE id = ?");
    stmt.bind([tripId]);

    if (!stmt.step()) {
      stmt.free();
      res.status(404).json({ detail: "سفر یافت نشد" });
      return;
    }

    const trip = stmt.getAsObject() as { id: number };
    stmt.free();
    res.json({
      ...trip,
      checkpoints: getCheckpointsForTrip(trip.id),
    });
  });

  app.get("/trips/:trip_id/requests", (req: Request, res: Response) => {
    const tripId = Number(req.params.trip_id);
    const driverId = Number(req.query.driver_id);

    const tStmt = db.prepare("SELECT * FROM trips WHERE id = ?");
    tStmt.bind([tripId]);
    if (!tStmt.step()) {
      tStmt.free();
      res.status(404).json({ detail: "سفر یافت نشد" });
      return;
    }
    const trip = tStmt.getAsObject() as { driver_id: number };
    tStmt.free();

    const dStmt = db.prepare("SELECT * FROM users WHERE id = ?");
    dStmt.bind([driverId]);
    if (!dStmt.step()) {
      dStmt.free();
      res.status(404).json({ detail: "راننده یافت نشد" });
      return;
    }
    const driver = dStmt.getAsObject() as { role: string };
    dStmt.free();

    if (driver.role !== "driver") {
      res.status(400).json({ detail: "فقط راننده می‌تواند لیست را ببیند" });
      return;
    }

    if (trip.driver_id !== driverId) {
      res.status(403).json({ detail: "فقط راننده همین سفر مجاز است" });
      return;
    }

    const reqStmt = db.prepare("SELECT * FROM ride_requests WHERE trip_id = ? ORDER BY id ASC");
    reqStmt.bind([tripId]);
    const list = [];
    while (reqStmt.step()) {
      list.push(reqStmt.getAsObject());
    }
    reqStmt.free();
    res.json(list);
  });

  app.post("/trips/:trip_id/request", (req: Request, res: Response) => {
    const tripId = Number(req.params.trip_id);
    const { passenger_id } = req.body || {};

    const tStmt = db.prepare("SELECT * FROM trips WHERE id = ?");
    tStmt.bind([tripId]);
    if (!tStmt.step()) {
      tStmt.free();
      res.status(404).json({ detail: "سفر یافت نشد" });
      return;
    }
    const trip = tStmt.getAsObject() as { available_seats: number; status: string };
    tStmt.free();

    if (trip.status !== "planned" || Number(trip.available_seats) <= 0) {
      res.status(400).json({ detail: "ظرفیت صندلی‌های این سفر به اتمام رسیده است و امکان ارسال درخواست وجود ندارد." });
      return;
    }

    const pStmt = db.prepare("SELECT * FROM users WHERE id = ?");
    pStmt.bind([passenger_id]);
    if (!pStmt.step()) {
      pStmt.free();
      res.status(404).json({ detail: "مسافر یافت نشد" });
      return;
    }
    const passenger = pStmt.getAsObject() as { role: string };
    pStmt.free();

    if (passenger.role !== "passenger") {
      res.status(400).json({ detail: "فقط مسافر می‌تواند درخواست ثبت کند" });
      return;
    }

    const exStmt = db.prepare(
      "SELECT * FROM ride_requests WHERE trip_id = ? AND passenger_id = ?"
    );
    exStmt.bind([tripId, passenger_id]);
    if (exStmt.step()) {
      const existing = exStmt.getAsObject();
      exStmt.free();
      res.json(existing);
      return;
    }
    exStmt.free();

    db.run(
      "INSERT INTO ride_requests (trip_id, passenger_id, status) VALUES (?, ?, 'pending')",
      [tripId, passenger_id]
    );
    saveDb();

    const idStmt = db.exec("SELECT last_insert_rowid() as id");
    const id = idStmt[0]?.values[0][0] as number;

    res.json({ id, trip_id: tripId, passenger_id, status: "pending" });
  });

  app.patch("/trips/:trip_id/request/:request_id", (req: Request, res: Response) => {
    const tripId = Number(req.params.trip_id);
    const requestId = Number(req.params.request_id);
    const { driver_id, status } = req.body || {};

    const tStmt = db.prepare("SELECT * FROM trips WHERE id = ?");
    tStmt.bind([tripId]);
    if (!tStmt.step()) {
      tStmt.free();
      res.status(404).json({ detail: "سفر یافت نشد" });
      return;
    }
    const trip = tStmt.getAsObject() as { driver_id: number; available_seats: number };
    tStmt.free();

    const dStmt = db.prepare("SELECT * FROM users WHERE id = ?");
    dStmt.bind([driver_id]);
    if (!dStmt.step()) {
      dStmt.free();
      res.status(404).json({ detail: "راننده یافت نشد" });
      return;
    }
    const driver = dStmt.getAsObject() as { role: string };
    dStmt.free();

    if (driver.role !== "driver") {
      res.status(400).json({ detail: "فقط راننده می‌تواند وضعیت را تغییر دهد" });
      return;
    }

    if (trip.driver_id !== driver_id) {
      res.status(403).json({ detail: "فقط راننده همین سفر مجاز است" });
      return;
    }

    const rStmt = db.prepare(
      "SELECT * FROM ride_requests WHERE id = ? AND trip_id = ?"
    );
    rStmt.bind([requestId, tripId]);
    if (!rStmt.step()) {
      rStmt.free();
      res.status(404).json({ detail: "درخواست یافت نشد" });
      return;
    }
    const rideReq = rStmt.getAsObject() as { passenger_id: number; status: string };
    rStmt.free();

    // Check capacity before approving
    if (status === "approved" || status === "accepted") {
      if (rideReq.status !== "approved" && rideReq.status !== "accepted") {
        if (Number(trip.available_seats) <= 0) {
          res.status(400).json({ detail: "ظرفیت صندلی‌های این سفر تکمیل شده است و امکان پذیرش مسافر جدید وجود ندارد." });
          return;
        }
        // Deduct 1 seat from available_seats
        db.run("UPDATE trips SET available_seats = available_seats - 1 WHERE id = ? AND available_seats > 0", [tripId]);
      }
    } else if (status === "rejected" || status === "cancelled") {
      // If it was approved before, release 1 seat back
      if (rideReq.status === "approved" || rideReq.status === "accepted") {
        db.run("UPDATE trips SET available_seats = available_seats + 1 WHERE id = ?", [tripId]);
      }
    }

    db.run("UPDATE ride_requests SET status = ? WHERE id = ?", [status, requestId]);
    saveDb();

    res.json({ id: requestId, trip_id: tripId, passenger_id: rideReq.passenger_id, status });
  });

  app.patch("/trips/:trip_id/status", (req: Request, res: Response) => {
    const tripId = Number(req.params.trip_id);
    const { driver_id, status } = req.body || {};

    const tStmt = db.prepare("SELECT * FROM trips WHERE id = ?");
    tStmt.bind([tripId]);
    if (!tStmt.step()) {
      tStmt.free();
      res.status(404).json({ detail: "سفر یافت نشد" });
      return;
    }
    const trip = tStmt.getAsObject() as { driver_id: number };
    tStmt.free();

    if (trip.driver_id !== Number(driver_id)) {
      res.status(403).json({ detail: "فقط راننده همین سفر مجاز است" });
      return;
    }

    db.run("UPDATE trips SET status = ? WHERE id = ?", [status, tripId]);
    saveDb();

    res.json({ id: tripId, status });
  });


  app.get("/drivers/:driver_id/wallet", (req: Request, res: Response) => {
    const driverId = Number(req.params.driver_id);
    const tripStmt = db.prepare(
      "SELECT * FROM trips WHERE driver_id = ? AND status = 'completed' ORDER BY id DESC"
    );
    tripStmt.bind([driverId]);

    const completedTrips = [];
    let totalGross = 0;
    let totalCommission = 0;

    while (tripStmt.step()) {
      const trip = tripStmt.getAsObject() as {
        id: number;
        departure_time: string;
        price: number;
      };

      const checkpoints = getCheckpointsForTrip(trip.id);

      const reqStmt = db.prepare(
        "SELECT COUNT(*) as count FROM ride_requests WHERE trip_id = ? AND status = 'approved'"
      );
      reqStmt.bind([trip.id]);
      let approvedPassengers = 0;
      if (reqStmt.step()) {
        approvedPassengers = (reqStmt.getAsObject() as { count: number }).count;
      }
      reqStmt.free();

      const grossRevenue = trip.price * approvedPassengers;
      const commission = Math.round(grossRevenue * 0.20);
      const netEarnings = grossRevenue - commission;

      totalGross += grossRevenue;
      totalCommission += commission;

      completedTrips.push({
        trip_id: trip.id,
        departure_time: trip.departure_time,
        price_per_seat: trip.price,
        approved_passengers: approvedPassengers,
        gross_revenue: grossRevenue,
        commission_20: commission,
        net_earnings: netEarnings,
        checkpoints,
      });
    }
    tripStmt.free();

    const netBalance = totalGross - totalCommission;

    res.json({
      driver_id: driverId,
      total_completed_trips: completedTrips.length,
      total_gross_revenue: totalGross,
      total_commission: totalCommission,
      net_balance: netBalance,
      transactions: completedTrips,
    });
  });

  app.get("/passengers/:passenger_id/my-requests", (req: Request, res: Response) => {
    const passengerId = Number(req.params.passenger_id);
    const stmt = db.prepare(
      "SELECT req.id as request_id, req.status as request_status, t.* FROM ride_requests req JOIN trips t ON t.id = req.trip_id WHERE req.passenger_id = ? ORDER BY req.id DESC"
    );
    stmt.bind([passengerId]);
    const list = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        request_id: number;
        request_status: string;
        id: number;
        driver_id: number;
        status: string;
        departure_time: string;
        price: number;
        available_seats: number;
      };
      
      const checkpoints = getCheckpointsForTrip(row.id);

      const dUserStmt = db.prepare("SELECT name, phone FROM users WHERE id = ?");
      dUserStmt.bind([row.driver_id]);
      let driverName = `راننده #${row.driver_id}`;
      if (dUserStmt.step()) {
        driverName = (dUserStmt.getAsObject() as { name: string }).name;
      }
      dUserStmt.free();

      list.push({
        request_id: row.request_id,
        request_status: row.request_status,
        trip: {
          id: row.id,
          driver_id: row.driver_id,
          driver_name: driverName,
          status: row.status,
          departure_time: row.departure_time,
          price: row.price,
          available_seats: row.available_seats,
          checkpoints,
        },
      });
    }
    stmt.free();

    res.json(list);
  });

  app.get("/inspectors/drivers", (req: Request, res: Response) => {
    const stmt = db.prepare(`
      SELECT 
        u.id as user_id, 
        u.name, 
        u.phone, 
        u.role,
        dp.id as profile_id,
        dp.vehicle_model,
        dp.vehicle_capacity,
        COALESCE(dp.approval_status, 'pending') as approval_status,
        dp.inspection_note,
        dp.approved_by,
        dp.vehicle_color,
        dp.license_plate,
        dp.created_at as profile_created_at,
        inspector.name as approved_by_name
      FROM users u
      LEFT JOIN driver_profiles dp ON u.id = dp.user_id
      LEFT JOIN users inspector ON dp.approved_by = inspector.id
      WHERE u.role = 'driver'
      ORDER BY 
        CASE WHEN COALESCE(dp.approval_status, 'pending') = 'pending' THEN 0 ELSE 1 END,
        u.id DESC
    `);
    const drivers = [];
    while (stmt.step()) {
      drivers.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(drivers);
  });

  app.post("/inspectors/verify-driver", (req: Request, res: Response) => {
    const { inspector_id, driver_user_id, status, note } = req.body || {};
    if (!inspector_id || !driver_user_id || !status) {
      res.status(400).json({ detail: "شناسه بازرس، شناسه راننده و وضعیت تایید الزامی هستند" });
      return;
    }
    if (status !== "approved" && status !== "rejected") {
      res.status(400).json({ detail: "وضعیت باید approved یا rejected باشد" });
      return;
    }

    const checkStmt = db.prepare("SELECT * FROM driver_profiles WHERE user_id = ?");
    checkStmt.bind([Number(driver_user_id)]);
    const exists = checkStmt.step();
    checkStmt.free();

    const now = new Date().toISOString();
    if (!exists) {
      db.run(
        "INSERT INTO driver_profiles (user_id, vehicle_model, vehicle_capacity, approval_status, inspection_note, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [Number(driver_user_id), "اطلاعات ثبت‌نشده خودرو", 4, status, note || "", Number(inspector_id), now]
      );
    } else {
      db.run(
        "UPDATE driver_profiles SET approval_status = ?, inspection_note = ?, approved_by = ? WHERE user_id = ?",
        [status, note || "", Number(inspector_id), Number(driver_user_id)]
      );
    }

    db.run(
      "INSERT INTO inspections (inspector_id, trip_id, inspector_type, result, approval_status, created_at) VALUES (?, NULL, 'driver_verification', ?, ?, ?)",
      [Number(inspector_id), `بررسی و ارزیابی راننده #${driver_user_id}: ${note || (status === 'approved' ? 'تایید صلاحیت راننده و خودرو' : 'عدم تایید مدارک و خودرو')}`, status, now]
    );
    saveDb();

    res.json({
      message: status === "approved" ? "راننده با موفقیت تایید شد و امکان تعریف سفر فعال گردید." : "راننده رد صلاحیت شد.",
      driver_user_id: Number(driver_user_id),
      status,
      note: note || "",
    });
  });

  app.get("/inspections", (req: Request, res: Response) => {
    const stmt = db.prepare(`
      SELECT i.*, u.name as inspector_name
      FROM inspections i
      LEFT JOIN users u ON i.inspector_id = u.id
      ORDER BY i.id DESC
    `);
    const list = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(list);
  });

  app.post("/inspections", (req: Request, res: Response) => {
    const { inspector_id, trip_id, inspector_type, result, approval_status } = req.body || {};
    if (!inspector_id || !inspector_type || !result) {
      res.status(400).json({ detail: "شناسه بازرس، نوع بازرسی و نتیجه الزامی هستند" });
      return;
    }

    const now = new Date().toISOString();
    const status = approval_status || "approved";

    db.run(
      "INSERT INTO inspections (inspector_id, trip_id, inspector_type, result, approval_status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [Number(inspector_id), trip_id ? Number(trip_id) : null, inspector_type, result, status, now]
    );
    saveDb();

    const idStmt = db.exec("SELECT last_insert_rowid() as id");
    const id = idStmt[0]?.values[0][0] as number;

    res.json({
      id,
      inspector_id,
      trip_id,
      inspector_type,
      result,
      approval_status: status,
      created_at: now,
    });
  });

  app.get("/admin/stats", (req: Request, res: Response) => {
    const uCount = (db.exec("SELECT COUNT(*) FROM users")[0]?.values[0][0] as number) || 0;
    const tCount =
      (
        db.exec("SELECT COUNT(*) FROM trips WHERE status IN ('planned', 'in_progress')")[0]
          ?.values[0][0] as number
      ) || 0;
    const rCount =
      (db.exec("SELECT COUNT(*) FROM ride_requests")[0]?.values[0][0] as number) || 0;

    res.json({
      total_users: uCount,
      active_trips: tCount,
      total_requests: rCount,
    });
  });

  // تابع کمکی برای فراخوانی مقاوم Gemini با قابلیت تلاش مجدد خودکار در صورت نوسان ترافیک
  async function generateGeminiContentWithRetry(ai: GoogleGenAI, params: any, retries = 3, delayMs = 1200) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await ai.models.generateContent({
          model: "gemini-3.8-flash",
          ...params,
        });
      } catch (err: any) {
        if (attempt === retries - 1) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
    throw new Error("تلاش‌های مجدد ارتباط با مدل به پایان رسید.");
  }

  app.post("/api/ai/chat", async (req: Request, res: Response) => {
    const { message, history } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ detail: "پیام کاربر الزامی است." });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ detail: "کلید ارتباط با هوش مصنوعی (GEMINI_API_KEY) در سرور تنظیم نشده است." });
      return;
    }

    // ۱. استخراج سفرهای فعال از پایگاه داده
    let tripsList: any[] = [];
    try {
      // اجرای کوئری درخواستی کاربر
      const stmt = db.prepare(
        "SELECT origin, destination, departure_time, available_seats, price_per_seat FROM trips WHERE status = 'scheduled'"
      );
      while (stmt.step()) {
        tripsList.push(stmt.getAsObject());
      }
      stmt.free();
    } catch {
      // انطباق هوشمند با ساختار پایگاه داده سفریار (checkpoints برای مبدأ و مقصد)
      try {
        const fallbackStmt = db.prepare(`
          SELECT 
            t.id,
            (SELECT city_name FROM checkpoints WHERE trip_id = t.id AND type = 'origin' LIMIT 1) as origin,
            (SELECT city_name FROM checkpoints WHERE trip_id = t.id AND type = 'destination' LIMIT 1) as destination,
            t.departure_time,
            t.available_seats,
            t.price as price_per_seat,
            t.status
          FROM trips t
          WHERE t.status IN ('planned', 'scheduled') AND t.available_seats > 0
        `);
        while (fallbackStmt.step()) {
          tripsList.push(fallbackStmt.getAsObject());
        }
        fallbackStmt.free();
      } catch (e) {
        console.warn("خطا در استعلام سفرها برای دستیار هوش مصنوعی:", e);
      }
    }

    const systemInstruction = `
شما «دستیار هوشمند سفر و پشتیبانی آنلاین سفریار» (SafarYar) هستید.
وظیفه شما راهنمایی کاربران، پاسخ‌گویی به سوالات مربوط به نحوه کار با سامانه سفریار، استعلام سفرهای بین‌شهری، قوانین سفر اشتراکی و هماهنگی صندلی است.

اطلاعات سفرهای فعال موجود در سیستم به شرح زیر است:
${JSON.stringify(tripsList, null, 2)}

دستورالعمل‌ها:
۱. پاسخ‌های شما باید به زبان فارسی، مؤدبانه، شفاف، شیک و دقیق باشند.
۲. اگر کاربر درباره سفرهای موجود یا ظرفیت یا قیمت سوال کرد، بر اساس اطلاعات بالا دقیقاً پاسخ دهید. اگر سفری برای آن مبدأ/مقصد در لیست نبود، به کاربر بگویید که در حال حاضر سفری فعال برای این مسیر یافت نشد و پیشنهاد دهید دوباره جستجو کند.
۳. در صورتی که کاربر درباره ثبت‌نام، نحوه رزرو صندلی، یا تایید صلاحیت رانندگان توسط بازرس پرسید، طبق منطق سفریار او را راهنمایی کنید.
`;

    try {
      const ai = new GoogleGenAI({ apiKey });

      const contents: any[] = [];
      if (Array.isArray(history)) {
        for (const item of history) {
          if (item && item.role && item.text) {
            contents.push({
              role: item.role === "assistant" || item.role === "model" ? "model" : "user",
              parts: [{ text: String(item.text) }],
            });
          }
        }
      }

      contents.push({
        role: "user",
        parts: [{ text: message.trim() }],
      });

      const response = await generateGeminiContentWithRetry(ai, {
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      res.json({
        reply: response.text || "پاسخی از مدل دریافت نشد.",
      });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({
        detail: "خطا در پردازش هوش مصنوعی: " + (error?.message || "خطای نامشخص"),
      });
    }
  });

  // اندپوینت پیشنهاد هوشمند سفر (Smart Trip Recommendation) با استفاده از Gemini
  app.post("/api/ai/recommend-trips", async (req: Request, res: Response) => {
    const { origin_city, destination_city, departure_date, min_seats } = req.body || {};

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ detail: "کلید ارتباط با هوش مصنوعی (GEMINI_API_KEY) در سرور تنظیم نشده است." });
      return;
    }

    // ۱. واکشی کلیه سفرهای با وضعیت planned و صندلی خالی از دیتابیس
    const stmt = db.prepare(`
      SELECT 
        t.id,
        t.driver_id,
        t.departure_time,
        t.available_seats,
        t.price,
        t.status,
        u.name as driver_name,
        dp.vehicle_model,
        dp.vehicle_color
      FROM trips t
      JOIN users u ON t.driver_id = u.id
      LEFT JOIN driver_profiles dp ON dp.user_id = t.driver_id
      WHERE t.status = 'planned' AND t.available_seats > 0
      ORDER BY t.id DESC
    `);

    const candidateTrips: any[] = [];
    while (stmt.step()) {
      const trip = stmt.getAsObject() as any;
      const checkpoints = getCheckpointsForTrip(trip.id) as Array<{ city_name: string; type: string; order: number }>;
      candidateTrips.push({
        ...trip,
        checkpoints,
      });
    }
    stmt.free();

    if (candidateTrips.length === 0) {
      res.json({
        recommendations: [],
        ai_summary: "در حال حاضر هیچ سفر پیش‌رو با صندلی خالی در سامانه ثبت نشده است.",
      });
      return;
    }

    // ۲. ساخت پرامپت تخصصی تحلیلی و رتبه‌بندی برای Gemini
    const systemInstruction = `
شما «موتور پیشنهاد هوشمند سفر سفریار» (SafarYar Smart Trip Recommender) هستید.
وظیفه شما تحلیل سفرهای بین‌شهری موجود در پایگاه داده بر اساس خواسته‌های مسافر و معرفی ۳ تا ۵ سفر برتر با اولویت‌بندی دقیق و ارائه دلیل کوتاه، متقاعدکننده و شفاف به زبان فارسی است.

معیارهای کلیدی ارزیابی و رتبه‌بندی:
۱. میزان تطابق مسیر: آیا شهر مبدأ و مقصد دقیقاً یا به عنوان ایستگاه بین‌راهی در checkpoints وجود دارند؟ (بالاترین اولویت)
۲. مستقیم بودن مسیر و تعداد توقف‌های اضافی: سفرهایی با توقف کمتر برای مسافر سریع‌تر و راحت‌تر هستند.
۳. تناسب زمان حرکت: مناسب بودن ساعت و تاریخ حرکت.
۴. قیمت اقتصادی: نسبت قیمت هر صندلی به مسیر.
۵. تعداد صندلی باقیمانده: ظرفیت کافی و امن برای مسافر و همراهان.

خروجی شما باید حتماً و منحصراً یک شیء JSON با ساختار زیر باشد:
{
  "recommendations": [
    {
      "trip_id": 2,
      "rank": 1,
      "reason": "مسیر کاملاً مستقیم بدون توقف اضافی، قیمت اقتصادی و زمان حرکت مناسب.",
      "highlights": ["مسیر مستقیم", "قیمت اقتصادی", "ظرفیت خالی مطلوب"]
    }
  ],
  "ai_summary": "تحلیل خلاصه هوش مصنوعی درباره برترین گزینه‌ها"
}
`;

    const userPrompt = `
مشخصات جستجوی مسافر:
- مبدأ مورد نظر: ${origin_city ? String(origin_city).trim() : "مشخص نشده (هر مبدأ)"}
- مقصد مورد نظر: ${destination_city ? String(destination_city).trim() : "مشخص نشده (هر مقصد)"}
- تاریخ حرکت مورد نظر: ${departure_date ? String(departure_date).trim() : "هر تاریخی"}
- حداقل تعداد صندلی: ${min_seats ? Number(min_seats) : 1}

لیست تمام سفرهای برنامه‌ریزی‌شده و دارای ظرفیت خالی در سامانه:
${JSON.stringify(
  candidateTrips.map((t) => ({
    trip_id: t.id,
    driver_name: t.driver_name,
    vehicle: t.vehicle_model,
    departure_time: t.departure_time,
    available_seats: t.available_seats,
    price_toman: t.price,
    route: t.checkpoints.map((c: any) => `${c.city_name} (${c.type})`).join(" -> "),
  })),
  null,
  2
)}

لطفاً از بین سفرهای فوق، ۳ تا حداکثر ۵ سفر برتر را رتبه‌بندی و تحلیل کن و نتیجه را صرفاً در ساختار JSON خواسته شده برگردان.
`;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await generateGeminiContentWithRetry(ai, {
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction,
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      });

      const responseText = response.text || "{}";
      let parsedData: any = {};
      try {
        parsedData = JSON.parse(responseText);
      } catch {
        const cleanJson = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
        parsedData = JSON.parse(cleanJson);
      }

      const tripMap = new Map(candidateTrips.map((t) => [t.id, t]));
      const enrichedRecommendations = (parsedData.recommendations || [])
        .map((rec: any) => {
          const fullTrip = tripMap.get(rec.trip_id);
          return {
            ...rec,
            trip: fullTrip || null,
          };
        })
        .filter((rec: any) => rec.trip !== null);

      res.json({
        recommendations: enrichedRecommendations,
        ai_summary: parsedData.ai_summary || "پیشنهادهای برتر بر اساس تحلیل هوش مصنوعی از مسیر و شرایط سفر آماده شد.",
      });
    } catch (err: any) {
      console.warn("Gemini Recommendation Error, falling back to algorithmic ranking:", err?.message || err);

      // الگوریتم رتبه‌بندی پشتیبان در صورت افت موقت شبکه هوش مصنوعی
      const originQuery = String(origin_city || "").trim();
      const destQuery = String(destination_city || "").trim();
      const seatsQuery = Number(min_seats) || 1;

      const scored = candidateTrips.map((t) => {
        let score = 50;
        const originCp = t.checkpoints.find((c: any) => c.type === "origin");
        const destCp = t.checkpoints.find((c: any) => c.type === "destination");
        const allCities = t.checkpoints.map((c: any) => c.city_name);

        if (originQuery) {
          if (originCp && originCp.city_name.includes(originQuery)) score += 60;
          else if (allCities.some((c: string) => c.includes(originQuery))) score += 30;
          else score -= 40;
        }
        if (destQuery) {
          if (destCp && destCp.city_name.includes(destQuery)) score += 60;
          else if (allCities.some((c: string) => c.includes(destQuery))) score += 30;
          else score -= 40;
        }
        if (t.available_seats >= seatsQuery) score += 15;
        const stopsCount = t.checkpoints.filter((c: any) => c.type === "stop").length;
        score -= stopsCount * 5;

        let reason = "سفر با ظرفیت خالی مناسب، نرخ بهینه و مسیر معتبر.";
        if (originQuery && destQuery && originCp?.city_name.includes(originQuery) && destCp?.city_name.includes(destQuery)) {
          reason = `مسیر مستقیم و ایده‌آل از ${originQuery} به ${destQuery} با ${t.available_seats} صندلی خالی و بدون انحراف مسیر.`;
        }

        return {
          trip_id: t.id,
          score,
          reason,
          highlights: ["مسیر بهینه", `ظرفیت ${t.available_seats} صندلی`, `${Number(t.price).toLocaleString("fa-IR")} تومان`],
          trip: t,
        };
      });

      scored.sort((a, b) => b.score - a.score);
      const topRecs = scored.slice(0, 5).map((item, idx) => ({
        trip_id: item.trip_id,
        rank: idx + 1,
        reason: item.reason,
        highlights: item.highlights,
        trip: item.trip,
      }));

      res.json({
        recommendations: topRecs,
        ai_summary: "سفرهای برتر بر اساس الگوریتم تحلیل هوشمند مسیر و بهینه‌ترین شرایط سفر انتخاب شدند.",
      });
    }
  });

  app.use("/frontend/assets", express.static(path.join(process.cwd(), "frontend/assets")));
  app.use("/assets", express.static(path.join(process.cwd(), "assets")));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SafarYar server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
