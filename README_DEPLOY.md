# FIDE Tournament Finder - chạy online

## Phương án khuyến nghị

Chạy app trên Render hoặc Railway. Lý do: máy local hiện ping được FIDE nhưng không mở được HTTPS cổng 443 tới `calendar.fide.com`, trong khi backend cloud thường không bị chặn đường này.

## Deploy lên Render

1. Đưa toàn bộ thư mục này lên GitHub.
2. Vào https://render.com, chọn **New Web Service**.
3. Kết nối GitHub repo.
4. Render thường tự đọc `render.yaml`. Nếu cần nhập tay:
   - Build command: `npm ci --omit=dev`
   - Start command: `npm start`
   - Health check path: `/api/health`
5. Sau khi deploy xong, mở URL Render cấp.
6. Kiểm tra kết nối FIDE tại:
   - `/api/diagnostics`
7. Nếu `calendar.fide.com` và `ratings.fide.com` trả `ok: true`, app có thể lấy dữ liệu thật.

## Deploy bằng Docker

```bash
docker build -t fide-tournament-finder .
docker run -p 4173:4173 fide-tournament-finder
```

Mở:

```text
http://localhost:4173
```

## Ghi chú nguồn dữ liệu

FIDE không có API công khai ổn định cho lịch giải/rated tournaments. App dùng backend để đọc HTML từ:

- https://calendar.fide.com/calendar.php
- https://ratings.fide.com/rated_tournaments.phtml

Backend có cache 30 phút để giảm request tới FIDE.
