---
name: dev-no-build
description: Trước khi build frontend, kiểm tra public/hot — có = đang npm run dev (khỏi build), không có = phải npm run build
metadata:
  type: feedback
---

Đừng đoán, hãy **kiểm tra `public/hot`** trước khi quyết định build frontend:

- **Có `public/hot`** (hoặc 5173 đang LISTENING) → user đang chạy `npm run dev`, Vite HMR tự nạp. Sửa `.jsx`/`.js`/CSS xong **KHÔNG cần** `npm run build`.
- **Không có `public/hot`** → app đang chạy bằng bundle trong `public/build`. Sửa xong **PHẢI** `npm run build`, nếu không thay đổi sẽ không lên (~2-3s).

**Why:** trạng thái này thay đổi theo phiên làm việc. Ngày 2026-09-06 mình tưởng vẫn đang `npm run dev` (theo ghi nhớ cũ) nhưng thực tế dev server đã tắt — nếu không kiểm tra thì sửa `excel.js` xong user sẽ không thấy gì đổi.

**How to apply:** chạy `Test-Path public\hot` ngay trước khi báo kết quả cho user, rồi build hoặc không build theo đó. Xem thêm [[trucking-vite-architecture]], [[dev-tunnel-vite]], [[vite-port-conflict]].
