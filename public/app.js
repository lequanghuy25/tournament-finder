const form = document.querySelector("#filters");
const rowsEl = document.querySelector("#rows");
const countEl = document.querySelector("#count");
const noteEl = document.querySelector("#note");
const exportButton = document.querySelector("#exportButton");
let currentRows = [];

const today = new Date();
form.elements.fromDate.value = today.toISOString().slice(0, 10);
form.elements.toDate.value = `${today.getFullYear()}-12-31`;
loadCountries();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await search();
});

exportButton.addEventListener("click", async () => {
  if (!currentRows.length) return;
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: currentRows })
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fide-tournaments.xls";
  link.click();
  URL.revokeObjectURL(url);
});

async function search() {
  rowsEl.innerHTML = `<tr><td colspan="8" class="empty">Đang lấy dữ liệu từ FIDE...</td></tr>`;
  const params = new URLSearchParams(new FormData(form));
  try {
    const response = await fetch(`/api/tournaments?${params.toString()}`);
    const text = await response.text();
    const data = parseJsonResponse(text);
    if (!response.ok || !data.ok) throw new Error([data.error, data.detail, data.hint].filter(Boolean).join(" "));
    currentRows = data.rows;
    countEl.textContent = String(data.count);
    noteEl.textContent = data.notes;
    renderRows(currentRows);
    enrichCountries(currentRows);
  } catch (error) {
    currentRows = [];
    countEl.textContent = "0";
    noteEl.textContent = error.message;
    rowsEl.innerHTML = `<tr><td colspan="8" class="empty">Không lấy được dữ liệu từ FIDE. Server app vẫn chạy, nhưng mạng hiện tại không truy cập được nguồn FIDE.</td></tr>`;
  }
}

function parseJsonResponse(text) {
  const value = String(text || "").trim();
  if (value.startsWith("<!DOCTYPE") || value.startsWith("<html")) {
    throw new Error("Máy chủ đang trả HTML thay vì JSON. Hãy tải lại trang hoặc thử lại sau vài giây.");
  }
  return JSON.parse(value);
}

async function loadCountries() {
  try {
    const response = await fetch("/api/countries");
    const data = await response.json();
    if (!data.ok) return;
    document.querySelector("#countries").innerHTML = data.countries.map((country) =>
      `<option value="${escapeAttr(country.code)}">${escapeHtml(country.name)}</option>`
    ).join("");
  } catch {
    // Keep the built-in fallback list.
  }
}

function renderRows(rows) {
  if (!rows.length) {
    rowsEl.innerHTML = `<tr><td colspan="8" class="empty">Không có kết quả phù hợp.</td></tr>`;
    return;
  }
  rowsEl.innerHTML = rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>
        <a href="${escapeAttr(row.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(row.name || "Chưa rõ tên")}</a>
        ${row.status ? `<span>${escapeHtml(row.status)}</span>` : ""}
      </td>
      <td>${escapeHtml(row.typeLabel || row.type || "Chưa rõ")}${row.typeNote ? `<span>${escapeHtml(row.typeNote)}</span>` : ""}</td>
      <td class="country-cell" data-row-index="${index}">${escapeHtml(row.country || "")}</td>
      <td>${escapeHtml(row.city || "")}</td>
      <td>${escapeHtml(row.startDate || "")}</td>
      <td>${escapeHtml(row.endDate || "")}</td>
      <td>${escapeHtml(row.source || "")}</td>
    </tr>
  `).join("");
}

async function enrichCountries(rows) {
  const targets = rows
    .map((row, index) => ({ row, index }))
    .filter((item) => item.row.id && item.row.country === "Đang xác định");
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, targets.length) }, async () => {
    while (cursor < targets.length) {
      const item = targets[cursor];
      cursor += 1;
      try {
        const response = await fetch(`/api/event-country?event=${encodeURIComponent(item.row.id)}`);
        const data = await response.json();
        if (!data.ok) continue;
        item.row.country = data.country || "Chưa rõ";
        const cell = document.querySelector(`.country-cell[data-row-index="${item.index}"]`);
        if (cell) cell.textContent = item.row.country;
      } catch {
        item.row.country = "Chưa rõ";
      }
    }
  });
  await Promise.all(workers);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value || "#");
}

search();
