---
name: ra-status-rule
description: "Quy tắc \"đã ra/chưa ra\" của lô CHỈ dựa Giờ xe ra (gio_xe_ra); ra_mode gọi theo cắt móc"
metadata: 
  node_type: memory
  type: project
  originSessionId: abfdb9c6-78f0-4c41-acce-4ab00891767b
---

Trạng thái **"đã ra"** của lô hàng = **CHỈ có `gio_xe_ra` (Giờ xe ra)** — KHÔNG xét `bks_ra` (BKS chỉ là xe kéo, chưa chắc cont đã ra) và KHÔNG xét `gio_xe_ra_xe`.

**Why:** xe thuê ngoài nhiều khi không cập nhật được biển số, nên chỉ cần có **Giờ xe ra** là coi như đã ra. Trước đây hệ thống chỉ dựa `bks_ra` → cont có giờ ra nhưng thiếu BKS bị tính nhầm "chưa ra".

**How to apply:** dùng quy tắc này nhất quán ở:
- Badge "Đã ra/Chưa ra" + cột danh sách lô (resources/js/trucking2/pages/lo-hang.jsx — table + card).
- Tab lọc & đếm `filterCounts` out/notout (HandlesShipments::pagedShipments — `$applyOut`/`$applyNotOut`).
- Ô "Chọn cont ra cùng chuyến" trong popup Thông tin lô (popups.jsx): chỉ liệt kê cont CHƯA RA = chưa có gio_xe_ra.
- **Excel "Cập nhật lô" — khối XE RA (2026-09-06, user chốt):** 4 cột đọc CÙNG NHAU `KIỂU RA · SỐ CONT RA (CẮT MÓC) · GIỜ XE RA · BKS RA`, GIỜ XE RA/BKS RA **hiểu theo KIỂU RA đúng như ô nhập popup**: self→của chính cont (`gio_xe_ra/bks_ra`) · other→của CONT RA HỘ (qua `raOtherGioXeRa/raOtherBksRa`, saveShipment đẩy theo `ra_other_id`) · none→giờ XE (`gio_xe_ra_xe`) + `bks_ra`. Đã **bỏ cột GIỜ XE RA (XE)** và đưa giờ xe ra của chính cont TRỞ LẠI Excel (đảo quyết định commit b61d7fb, user đồng ý). Xuất: GIỜ XE RA = `gioXeRaEff`, BKS RA = `raOtherBksRa` khi other. Toàn bộ khối đi qua `saveShipment` với `$only` (không còn block gán tay). Code: `collectRaChange` + `collectRaOtherCont` + `resolveRaOtherSibling` (HandlesShipmentUpdateImport).
- **Cont ra hộ**: tìm theo ĐÚNG 2 điều kiện **số cont khớp + lô đó CHƯA RA**, cùng sheet, KHÔNG ràng buộc cùng booking. Id chốt lúc kiểm tra → `patch['raOtherId']`. **1 cont chỉ ra 1 lần**: đã là ra hộ của lô khác → CẢNH BÁO (không chặn) ở cả Excel (`$notes`) lẫn popup (`siblingsList` trả `raOtherId`, picker đánh dấu "đã là cont ra hộ của …"); 2 dòng cùng file chọn trùng → cảnh báo. Có SỐ CONT RA mà KIỂU RA ≠ Cont khác ra → lỗi.
- **BKS ra = BKS vào (xe vào chính là xe ra), cả 3 kiểu, cả popup lẫn Excel.** Excel: BKS RA trống + vừa điền giờ ra → tự lấy BKS VÀO khi: bks_ra trống · **cont ra hộ CHƯA RA** (bks_ra cũ của nó chỉ là xe vào tự điền/xe tay không, giữ là lộ trình gắn nhầm xe kéo — ghi đè) · đổi BKS vào mà bks_ra = BKS vào cũ. Popup: `setRa` (other) và `setGioXeRaXe` (none) tự điền như `setGioXeRa`; other ghi đè khi cont chưa ra trừ khi user vừa gõ tay (`typed`). Lộ trình (`routeTripByDate`) vốn giả định `refBksRa = t.bks_ra ?: s.bks_vao` nên dữ liệu giờ khớp.

Phân biệt 3 field dễ nhầm: `gio_xe_ra` (Giờ xe ra, tính free time) ≠ `cont_ra` (Ngày cont ra — ĐÃ BỎ khỏi UI) ≠ `bks_ra` (Biển số ra). siblingsList trả kèm gioXeRa+bksRa cho popup lọc. Liên quan [[trucking-report-schema]].

**Trường hợp giờ xe ra (`ra_mode`) — 3 lựa chọn trong popup (mục "Xe vào – xe ra"), gọi theo MÓC:**
- `self` ("Không cắt móc" = xe vào kéo luôn cont này ra) → `gio_xe_ra` = giờ ra **của cont** (lô này).
- `other` ("Cắt móc — cont khác ra") → ghi `gio_xe_ra`+`bks_ra` vào **cont khác** (`ra_other_id`) qua field transient `raOtherGioXeRa`/`raOtherBksRa` trên payload lô hiện tại → **backend đẩy theo id** (`TruckingShipment::find(ra_other_id)`) nên cập nhật được CẢ KHI cont kia ở trang khác (commit 92ab438; trước đây dùng patchOther vào `data` trang hiện tại → off-page bị bỏ qua).
- **Ô "Giờ xe ra (cont này)" LUÔN nhập được** (ở chế độ cắt móc thì nằm trong khối gấp "Giờ ra riêng của chính cont này") (DTField, ghi `gio_xe_ra` của chính cont) — KỂ CẢ khi chọn "cont khác ra" (commit ba32a27, user yêu cầu). Đã **bỏ guard backend ép null** + bỏ onPick xóa gioXeRa. Phần "cont khác ra" chỉ ghi giờ ra/BKS cho cont ĐƯỢC CHỌN, độc lập với giờ ra của cont hiện tại. Migration `2026_06_18_000001` đã dọn dữ liệu cũ (other/none còn dính gio_xe_ra → list "đã ra" sai).

**FREE TIME (user 2026-06-22, sửa lại): = Giờ xe ra − Giờ xe đến (`gio_xe_den`), KHÔNG còn dùng giờ đến kế hoạch (`gio_den_du_kien` chỉ để theo dõi kế hoạch).** "Giờ xe ra" lấy theo `ra_mode` (follow theo XE ra): `self`→`gio_xe_ra` (cont), `none`→`gio_xe_ra_xe` (đầu kéo), `other`→`gio_xe_ra` của **cont KHÁC thực sự ra** (`ra_other_id`). Backend: relation `TruckingShipment::raOther()` + field `gioXeRaEff` (shipmentToArray) + `freeTimeOf` (HandlesStatementPricing, bảng kê) — eager-load `raOther:id,gio_xe_ra`. Frontend: `freeTimeRaOf(s)`/`calcFreeTime` (lib.jsx) — popup live qua transient `raOtherGioXeRa`, list qua `gioXeRaEff`.
- **"đã ra" CHỈ xét `gio_xe_ra`** (bỏ `bks_ra`, commit 2b3fcca): badge/cột + filter out/notout (`$applyOut`/`$applyNotOut`) + picker "cont ra cùng chuyến" đều chỉ dựa `gio_xe_ra`.
- `none` ("Cắt móc — không kéo ra") → xe ra nhưng KHÔNG kéo cont nào; ghi vào **cột RIÊNG `gio_xe_ra_xe`** (giờ ra của XE/đầu kéo) để sau tính phí hạng mục khác. `gio_xe_ra` (cont) GIỮ TRỐNG → lô vẫn "**chưa ra**" (đúng: cont không ra). Migration `2026_06_15_000002`.

**Ngưỡng free time (Connect/Disconnect) theo KHOẢNG NGÀY cont ra** (commit ac50299): mặc định `free_time_hours` (setting); cộng `free_time_rules` (JSON setting = [{from,to,hours}]) — cont ra rơi vào khoảng nào dùng ngưỡng đó (vd 12/6–30/6=2h, 1/7–20/7=4h), không khớp → mặc định. `calcFreeTime(s, default, rules)` (lib.jsx) chọn theo ngày `gioXeRa`; backend `freeTimeThresholdForDate` (HandlesStatementPricing) cho bảng kê. UI: tab Cấu hình chung có repeater "Ngưỡng theo khoảng ngày".

**`gio_xe_ra` LUÔN là giờ của CONT; `gio_xe_ra_xe` là giờ của XE (chỉ dùng khi ra_mode='none').** Quy tắc "đã ra" CHỈ xét `gio_xe_ra` — đừng nhầm. UI: nhãn ô đổi động "Giờ xe ra (của cont)" / "(của XE)"; đổi trường hợp thì tự dọn field còn lại (popups.jsx) để 2 mốc không lẫn.

**Cập nhật:** đã **bỏ field "Ngày cont ra"** khỏi popup Lô hàng (gio_xe_ra là mốc cont rời đi). Cột "Ra:" trong list + badge hiện theo `gio_xe_ra`. **Bảng kê** (trang Tạo) lấy NGÀY KỲ = ngày của `gio_xe_ra` (fallback sail_date/cont_den) — sửa ở `HandlesStatementPricing::candidatesForStatement` + `statementReprice` (đã ghi chú trong code). Trang Tạo bảng kê: **chưa chọn kỳ (ngày ra) thì không tải lô**, hiện ghi chú "Vui lòng chọn ngày ra của lô hàng".

**Bố cục popup (2026-08-05):** BKS vào/BKS ra đã CHUYỂN từ mục Container sang khối "Xe vào – xe ra" (dòng VÀO: giờ xe đến + BKS vào + giờ đến kế hoạch · dòng RA: chip cắt móc + ô giờ/BKS theo đúng chế độ). Chọn BKS vào khi "Không cắt móc" tự điền BKS ra nếu ô đang trống (không ghi đè giá trị đã gõ).
