import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTournaments } from "./tournaments.js";
import { exportExcelHtml } from "./xlsx.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 4173);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, date: new Date().toISOString() });
});

app.get("/api/diagnostics", async (_req, res) => {
  const targets = ["https://calendar.fide.com/calendar.php", "https://ratings.fide.com"];
  const checks = await Promise.all(targets.map(async (url) => {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: { "user-agent": "Mozilla/5.0 FIDE tournament finder diagnostics" }
      });
      return {
        url,
        ok: response.ok,
        status: response.status,
        ms: Date.now() - started
      };
    } catch (error) {
      return {
        url,
        ok: false,
        error: error.message,
        ms: Date.now() - started
      };
    }
  }));
  res.json({ ok: checks.every((check) => check.ok), checks });
});

app.get("/api/debug/fide-calendar", async (req, res) => {
  if (process.env.ENABLE_DEBUG !== "1") {
    res.status(404).json({ ok: false });
    return;
  }
  const response = await fetch("https://calendar.fide.com/calendar.php", {
    headers: { "user-agent": "Mozilla/5.0 FIDE tournament finder diagnostics" }
  });
  const html = await response.text();
  const start = Number(req.query.start || 0);
  const length = Math.min(Number(req.query.length || 50000), 200000);
  res.type("text/plain").send(html.slice(start, start + length));
});

app.get("/api/debug/fide-file", async (req, res) => {
  if (process.env.ENABLE_DEBUG !== "1") {
    res.status(404).json({ ok: false });
    return;
  }
  const file = String(req.query.file || "");
  if (!/^(js|css)\//.test(file)) {
    res.status(400).json({ ok: false, error: "Invalid file" });
    return;
  }
  const response = await fetch(new URL(file, "https://calendar.fide.com/"), {
    headers: { "user-agent": "Mozilla/5.0 FIDE tournament finder diagnostics" }
  });
  const text = await response.text();
  res.type("text/plain").send(text);
});

app.get("/api/debug/fide-calendar-server", async (req, res) => {
  if (process.env.ENABLE_DEBUG !== "1") {
    res.status(404).json({ ok: false });
    return;
  }
  const form = new URLSearchParams();
  form.set("country", String(req.query.country || "all"));
  form.set("name_filter", String(req.query.query || ""));
  form.set("event_type", "all");
  form.set("time_control", String(req.query.time_control || "all"));
  form.set("page", String(req.query.page || "1"));
  form.append("cat_cont[]", "0");
  form.set("from_date", String(req.query.from_date || new Date().toISOString().slice(0, 10)));
  form.set("to_date", String(req.query.to_date || "2026-12-31"));
  form.set("show", String(req.query.show || "table"));
  const landing = await fetch("https://calendar.fide.com/calendar.php", {
    headers: { "user-agent": "Mozilla/5.0 FIDE tournament finder diagnostics" }
  });
  const cookie = landing.headers.getSetCookie?.().join("; ") || landing.headers.get("set-cookie") || "";
  const response = await fetch("https://calendar.fide.com/calendar_server.php", {
    method: "POST",
    headers: {
      "accept": "*/*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "origin": "https://calendar.fide.com",
      "x-requested-with": "XMLHttpRequest",
      "referer": "https://calendar.fide.com/calendar.php",
      "cookie": cookie,
      "user-agent": "Mozilla/5.0 FIDE tournament finder diagnostics"
    },
    body: form
  });
  const text = await response.text();
  res.type("text/plain").send(text);
});

app.get("/api/tournaments", async (req, res) => {
  try {
    const result = await getTournaments({
      source: String(req.query.source || "calendar"),
      country: String(req.query.country || ""),
      fromYear: Number(req.query.fromYear || new Date().getFullYear()),
      toDate: String(req.query.toDate || new Date().toISOString().slice(0, 10)),
      type: String(req.query.type || "all"),
      query: String(req.query.query || "")
    });
    res.json(result);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "Không lấy được dữ liệu từ FIDE lúc này.",
      detail: error.message,
      hint: "Nếu server local vẫn mở được /api/health, hãy kiểm tra firewall/proxy/DNS hoặc thử lại trên mạng khác. FIDE không có API công khai ổn định nên app đang đọc HTML trực tiếp từ fide.com."
    });
  }
});

app.post("/api/export", (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const html = exportExcelHtml(rows);
  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=fide-tournaments.xls");
  res.send(html);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`FIDE tournament finder: http://localhost:${port}`);
});
