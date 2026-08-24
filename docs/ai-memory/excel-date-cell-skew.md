---
name: excel-date-cell-skew
description: Ô ngày/giờ kiểu Date của Excel đọc bằng SheetJS bị lệch ~30 giây ở múi giờ VN → lùi 1 ngày / hụt 1 phút
metadata:
  type: project
---

`XLSX.read(..., { cellDates: true })` dựng Date theo giờ địa phương và chỉ bù lệch múi giờ theo PHÚT NGUYÊN, trong khi giờ chuẩn Sài Gòn năm 1899 (mốc 30/12/1899) lẻ 30 giây. Hệ quả trên máy VN: ô ngày `14/05/2026` ra `13/05/2026 23:59:30` (lùi 1 ngày), ô giờ `10:30` ra `10:29:30` (hụt 1 phút). Ô TEXT `dd/mm/yyyy` không dính.

**Why:** Import lô hàng/CSHT/cập nhật lô đọc file người dùng điền bằng định dạng ngày thật của Excel → sai ngày giờ hàng loạt mà không báo lỗi.

**How to apply:** Mọi parser Excel phía client phải cắt/làm tròn phần giây theo giờ ĐỊA PHƯƠNG trước khi lấy Y/M/D/H/M (`snapToMinute` trong `resources/js/trucking2/components/lo-hang/excel.js`, dùng chung cho `cellDate`/`cellTime`). Viết parser Excel mới thì tái dùng 2 hàm này, đừng tự `getFullYear()/getHours()` trên Date thô. Liên quan: [[date-fields]].
