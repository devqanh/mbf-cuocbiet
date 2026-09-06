---
name: asset-report
description: "/bao-cao-tai-san có 3 tab (Tổng quan cho sếp · Chi tiết theo xe · Sổ tài sản khấu hao); assetReport tính thêm kỳ trước, xu hướng tháng, cơ cấu theo TÊN khoản, sổ khấu hao, cảnh báo"
metadata: 
  node_type: memory
  type: project
  originSessionId: cc3184d1-0969-421d-a38d-aa4a564db3ad
  modified: 2026-09-06T07:41:27.173Z
---

**Báo cáo tài sản** `/trucking-v2/bao-cao-tai-san` (route `trucking2.assetReport`, quyền `tripCost.view`) — nâng cấp 2026-09-06 theo yêu cầu "sếp nhìn dễ hiểu": **bố cục Tabs** (user chọn) — *Tổng quan* | *Chi tiết theo xe* | *Sổ tài sản*. Tab nhớ ở localStorage `trk:bctaisan:tab`.

**Backend** `HandlesAssetReport::assetReport($fromYm,$toYm)` — 1 lần duyệt vehicles(with costs+deps) tính tất cả, ~7 query:
- Giữ NGUYÊN số theo xe cũ (thường/phân bổ/khấu hao theo kỳ — đã đối chiếu snapshot 0 lệch). Thêm per-row: `prevTotal`, `conts`+`perCont` (lô có `vehicle_id` + `gio_xe_ra` trong kỳ), `origPrice`/`nbv`, `name` (asset=info.name, xe=info.brand), `group` (loại TS / type xe).
- Ô THÁNG (`$buckets`) phủ kỳ trước cùng độ dài + ≥12 tháng kết tại tháng cuối → `prev{from,to,…}` và `trend[]{ym,label,costNormal,costAlloc,deprec,total,inPeriod,future}`. Tổng cột trong kỳ lệch totals vài đồng do làm tròn — chấp nhận.
- `byItem[]` gom theo **TÊN phiếu chi** (lowercase) — vì `cost_type_id` thực tế **0/415 phiếu** được điền, catalog "Loại chi phí xe" rỗng → gom theo loại sẽ ra 100% "chưa phân loại". `bySupplier[]` top 10. `split{material,service,vehicle,asset}`.
- `register[]` 1 dòng / hạng mục khấu hao, tính đến **HÔM NAY** độc lập kỳ: usedDays/pct/accrued/remain/monthly/status(active|done|future)/`soon` (≤3 tháng)/endDate; `registerTotals`.
- `alerts.docs` = hạn trong `info` JSON (xe: registrationDue/insuranceDue; tài sản: warrantyDue/inspectionDue) ≤ `due_warn_days` (setting, mặc định 30); `alerts.recurring` = `expiringVehicleCosts()` + hashid; `alerts.pending` = phiếu chưa duyệt/chưa chi (đếm từ costs đã load, toàn bộ).
- KHÔNG làm CP/km: `current_km` chỉ 45/415 phiếu → số sẽ sai.

**Frontend** `components/bao-cao-tai-san/` (entry `pages/bao-cao-tai-san.jsx` chỉ mount): `AssetReportApp` (header + tabs + In), `OverviewTab` (KPI + Delta so kỳ trước; TrendChart cột chồng, tháng ngoài kỳ mờ, đường TB; Donut "tiền đi vào đâu"; 3 SplitBar thực chi/khấu hao · vật tư/dịch vụ · xe/tài sản; Top 10 + badge ×N TB cùng loại, bấm → mở dòng ở tab Chi tiết; 3 card cảnh báo; nhà cung cấp), `DetailTab` (bảng cũ + So kỳ trước, Cont·CP/cont, Còn lại; sort cột; `focusId` auto mở+cuộn), `RegisterTab` (KPI + lọc trạng thái + progress), `parts.jsx` (COLS, MonthYear, AssetName, MiniBar, `fleetLink`; KPI/Delta/CardTitle/SplitBar… re-export từ `components/report-ui.jsx` dùng chung với /bao-cao).
- `fleetLink(fleetUrl,row,section)`: xe → `#<hashid>/<tab>` (info|deprec|cost…), tài sản → `#asset/<hashid>` (khác nhau! trước đây link tài sản sai).
- **Donut + PALETTE đã tách ra `components/charts.jsx`** dùng chung với `/bao-cao`.
- In: container nội dung có class `ke-print`, header `ke-noprint`, tiêu đề in `ke-printonly`; thêm `@media print .trk-report-scroll{overflow:visible}` — tái dùng CSS in của bảng kê.

**Cách verify không cần trình duyệt** (đã dùng): snapshot JSON hàm cũ → so sau khi sửa; SSR bằng `react-dom/server` + esbuild alias `@trk` với dữ liệu thật để bắt lỗi runtime/NaN; `app()->handle(Request::create(...))` sau `auth()->login` để test trang 200 (lỗi `unlink session` trong tinker là vô hại).

Liên quan [[cost-report]] [[asset-management]] [[trucking-report-schema]] [[trucking-perf-lazy-load]].
