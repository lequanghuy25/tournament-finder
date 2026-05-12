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

app.get("/api/debug/fide-calendar", async (_req, res) => {
  if (process.env.ENABLE_DEBUG !== "1") {
    res.status(404).json({ ok: false });
    return;
  }
  const response = await fetch("https://calendar.fide.com/calendar.php", {
    headers: { "user-agent": "Mozilla/5.0 FIDE tournament finder diagnostics" }
  });
  const html = await response.text();
  res.type("text/plain").send(html.slice(0, 20000));
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
