import { load } from "cheerio";

const FIDE_CALENDAR = "https://calendar.fide.com/calendar.php";
const FIDE_RATED = "https://ratings.fide.com/rated_tournaments.phtml";
const FIDE_RATED_DATA = "https://ratings.fide.com/a_tournaments.php";
const CACHE_TTL_MS = 1000 * 60 * 30;
const cache = new Map();

const typeLabels = {
  all: "Tất cả",
  standard: "Cờ chuẩn",
  rapid: "Cờ nhanh",
  blitz: "Cờ chớp",
  chess960: "Fischer Random"
};

export async function getTournaments(filters) {
  const source = ["rated", "sample"].includes(filters.source) ? filters.source : "calendar";
  if (source === "sample") {
    const rows = applyFilters(sampleTournaments(), filters);
    return {
      ok: true,
      source,
      generatedAt: new Date().toISOString(),
      count: rows.length,
      rows,
      notes: "Đây là dữ liệu mẫu để kiểm tra giao diện, bộ lọc và xuất Excel. Chưa phải dữ liệu thật từ FIDE."
    };
  }

  const raw = source === "rated"
    ? await fetchRatedTournaments(filters)
    : await fetchCalendarTournaments(filters);
  const rows = applyFilters(raw, filters);

  return {
    ok: true,
    source,
    generatedAt: new Date().toISOString(),
    count: rows.length,
    rows,
    notes: source === "rated"
      ? "Nguồn FIDE Rated Tournaments là danh sách giải đã/đang được đưa vào rating list theo tháng và quốc gia; không phải lịch đăng ký thi đấu đầy đủ."
      : "Nguồn FIDE Calendar là lịch sự kiện FIDE. FIDE không công bố API chính thức ổn định cho endpoint này, backend đang đọc HTML và có cache 30 phút."
  };
}

async function fetchCalendarTournaments(filters) {
  const from = `${filters.fromYear}-01-01`;
  const to = filters.toDate || new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    search: filters.query || "",
    from,
    to,
    display: "table"
  });
  if (filters.country) params.set("country", filters.country);
  if (filters.type && filters.type !== "all") params.set("time", filters.type);

  const url = `${FIDE_CALENDAR}?${params.toString()}`;
  const html = await cachedFetch(url);
  const $ = load(html);
  const rows = [];

  $("table tr").each((_, tr) => {
    const cells = $(tr).find("td").map((__, td) => clean($(td).text())).get();
    if (cells.length < 3) return;
    const link = absolutize($(tr).find("a[href]").first().attr("href"), FIDE_CALENDAR);
    const parsed = parseCalendarCells(cells);
    if (parsed.name) rows.push({ ...parsed, source: "FIDE Calendar", url: link });
  });

  if (rows.length) return dedupe(rows);

  $(".calendar-event, .event, .tile, .item").each((_, el) => {
    const text = clean($(el).text());
    const name = clean($(el).find("a, h3, h2").first().text()) || text.split(/\s{2,}/)[0];
    if (!name || name.length < 4) return;
    const type = inferType(text);
    rows.push({
      name,
      type: type.label,
      typeKey: type.key,
      country: inferCountry(text),
      city: "",
      startDate: inferDate(text),
      endDate: "",
      status: "",
      source: "FIDE Calendar",
      url: absolutize($(el).find("a[href]").first().attr("href"), FIDE_CALENDAR),
      raw: text
    });
  });

  return dedupe(rows);
}

async function fetchRatedTournaments(filters) {
  const country = filters.country || "USA";
  const months = monthsBetween(filters.fromYear, filters.toDate);
  const pages = await Promise.all(months.map(async (period) => {
    const params = new URLSearchParams({ country, period });
    const url = `${FIDE_RATED_DATA}?${params.toString()}`;
    const json = await cachedFetch(url, {
      accept: "application/json, text/javascript, */*; q=0.01",
      referer: `${FIDE_RATED}?${params.toString()}`,
      requestedWith: "XMLHttpRequest"
    });
    return { period, url: `${FIDE_RATED}?${params.toString()}`, json };
  }));

  const rows = [];
  for (const page of pages) {
    const data = JSON.parse(page.json);
    const items = Array.isArray(data?.data) ? data.data : [];
    for (const item of items) {
      const parsed = parseRatedDataRow(item, country, page.period);
      if (parsed.name) rows.push({ ...parsed, source: "FIDE Rated Tournaments" });
    }
  }
  return dedupe(rows);
}

async function cachedFetch(url, options = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.html;

  const response = await fetch(url, {
    headers: {
      "accept": options.accept || "text/html,application/xhtml+xml",
      ...(options.referer ? { "referer": options.referer } : {}),
      ...(options.requestedWith ? { "x-requested-with": options.requestedWith } : {}),
      "user-agent": "Mozilla/5.0 FIDE tournament finder for family planning"
    }
  });
  if (!response.ok) throw new Error(`FIDE trả HTTP ${response.status} cho ${url}`);
  const html = await response.text();
  cache.set(url, { time: Date.now(), html });
  return html;
}

function parseCalendarCells(cells) {
  const joined = cells.join(" ");
  const dates = cells.map(inferDate).filter(Boolean);
  const type = inferType(joined);
  return {
    name: pickName(cells),
    type: type.label,
    typeKey: type.key,
    country: inferCountry(joined),
    city: pickCity(cells),
    startDate: dates[0] || "",
    endDate: dates[1] || "",
    status: joined.match(/cancel|postpon|current|upcoming/i)?.[0] || "",
    raw: joined
  };
}

function parseRatedCells(cells, country, period) {
  const start = cells.find((cell) => /\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4}/.test(cell)) || "";
  const type = inferType(cells.join(" "));
  return {
    name: pickName(cells),
    type: type.label,
    typeKey: type.key,
    country,
    city: pickCity(cells),
    startDate: normalizeDate(start),
    endDate: "",
    status: `FRL ${period}`,
    raw: cells.join(" ")
  };
}

function parseRatedDataRow(item, country, period) {
  const [id, nameHtml, city, eventKind, startDate, endHtml, listName] = item;
  const $ = load(String(nameHtml || ""));
  const name = clean($.text());
  const href = $("a[href]").first().attr("href") || `/report.phtml?event=${id}`;
  const endDate = clean(load(String(endHtml || "")).text());
  const type = inferType(`${name} ${eventKind}`);
  return {
    id: String(id || ""),
    name,
    type: type.label,
    typeKey: type.key,
    country,
    city: clean(city),
    startDate: normalizeDate(clean(startDate)),
    endDate: normalizeDate(endDate),
    status: clean(listName || period),
    url: absolutize(href, "https://ratings.fide.com/"),
    raw: `${name} ${city} ${eventKind} ${listName}`
  };
}

function applyFilters(rows, filters) {
  const q = String(filters.query || "").trim().toLowerCase();
  const type = String(filters.type || "all");
  const from = new Date(`${filters.fromYear || new Date().getFullYear()}-01-01`);
  const to = new Date(filters.toDate || new Date());

  return rows.filter((row) => {
    const haystack = `${row.name} ${row.country} ${row.city} ${row.raw || ""}`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (type !== "all" && row.typeKey !== type) return false;
    if (row.startDate) {
      const date = new Date(row.startDate);
      if (!Number.isNaN(date.valueOf()) && (date < from || date > to)) return false;
    }
    return true;
  }).map((row) => ({
    ...row,
    typeLabel: row.type || typeLabels[row.typeKey] || "Chưa rõ"
  }));
}

function inferType(text) {
  const lower = text.toLowerCase();
  const parts = lower.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const specific = parts.length > 1 ? parts.at(-1) : lower;
  let key = "";
  if (/960|fischer|random/.test(specific)) key = "chess960";
  else if (/blitz|chớp/.test(specific)) key = "blitz";
  else if (/rapid|nhanh/.test(specific)) key = "rapid";
  else if (/standard|classical|chuẩn|regular/.test(specific)) key = "standard";
  else if (/960|fischer|random/.test(lower)) key = "chess960";
  else if (/blitz|chớp/.test(lower)) key = "blitz";
  else if (/rapid|nhanh/.test(lower)) key = "rapid";
  else if (/standard|classical|chuẩn|regular/.test(lower)) key = "standard";
  return { key, label: key ? typeLabels[key] : "Chưa rõ" };
}

function inferCountry(text) {
  const match = text.match(/\b[A-Z]{3}\b/);
  return match?.[0] || "";
}

function inferDate(text) {
  const match = text.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4}/);
  return normalizeDate(match?.[0] || "");
}

function normalizeDate(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function pickName(cells) {
  return cells.find((cell) => cell.length > 4 && !/^(inf\.?|name|city|start|rcvd|frl|country)$/i.test(cell)) || "";
}

function pickCity(cells) {
  return cells.find((cell) => /^[A-Za-zÀ-ỹ\s.'-]{3,}$/.test(cell) && !/standard|rapid|blitz|event|tournament/i.test(cell)) || "";
}

function monthsBetween(fromYear, toDate) {
  const end = new Date(toDate || new Date());
  const months = [];
  for (let year = Number(fromYear); year <= end.getFullYear(); year += 1) {
    const lastMonth = year === end.getFullYear() ? end.getMonth() : 11;
    for (let month = 0; month <= lastMonth; month += 1) {
      months.push(`${year}-${String(month + 1).padStart(2, "0")}-01`);
    }
  }
  return months.slice(-36);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function absolutize(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    row.typeKey ||= typeKeyFromLabel(row.type);
    const key = `${row.name}|${row.startDate}|${row.country}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function typeKeyFromLabel(label) {
  return Object.entries(typeLabels).find(([, value]) => value === label)?.[0] || "";
}

function sampleTournaments() {
  return [
    {
      name: "Vietnam Junior FIDE Rated Open",
      type: "Cờ chuẩn",
      typeKey: "standard",
      country: "VIE",
      city: "Ho Chi Minh City",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
      status: "Dữ liệu mẫu",
      source: "Sample",
      url: "",
      raw: "standard junior fide rated vietnam"
    },
    {
      name: "Bangkok Rapid Rating Festival",
      type: "Cờ nhanh",
      typeKey: "rapid",
      country: "THA",
      city: "Bangkok",
      startDate: "2026-07-20",
      endDate: "2026-07-21",
      status: "Dữ liệu mẫu",
      source: "Sample",
      url: "",
      raw: "rapid fide rated thailand"
    },
    {
      name: "Singapore Blitz Youth Challenge",
      type: "Cờ chớp",
      typeKey: "blitz",
      country: "SGP",
      city: "Singapore",
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      status: "Dữ liệu mẫu",
      source: "Sample",
      url: "",
      raw: "blitz youth singapore"
    },
    {
      name: "Asian Chess960 Open",
      type: "Fischer Random",
      typeKey: "chess960",
      country: "MAS",
      city: "Kuala Lumpur",
      startDate: "2026-09-12",
      endDate: "2026-09-13",
      status: "Dữ liệu mẫu",
      source: "Sample",
      url: "",
      raw: "chess960 fischer random malaysia"
    }
  ];
}
