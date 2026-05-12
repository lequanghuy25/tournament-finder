export function exportExcelHtml(rows) {
  const headers = ["Tên giải", "Loại", "Quốc gia", "Thành phố", "Ngày bắt đầu", "Ngày kết thúc", "Trạng thái/Ghi chú", "Nguồn", "Link"];
  const body = rows.map((row) => [
    row.name,
    row.typeLabel || row.type,
    row.country,
    row.city,
    row.startDate,
    row.endDate,
    row.status,
    row.source,
    row.url
  ]);

  return `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<table border="1">
<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
<tbody>${body.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell || "")}</td>`).join("")}</tr>`).join("")}</tbody>
</table>
</body>
</html>`;
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
