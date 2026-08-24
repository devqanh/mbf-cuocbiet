# Import Excel để CẬP NHẬT lô hàng

Trạng thái: **đã triển khai** (2026-07-25, chưa commit) · Trang: `/trucking-v2/lo-hang`

Đã làm: trait `HandlesShipmentUpdateImport` + 2 route `permission:shipments.update` + nút
"Cập nhật lô" (xuất để cập nhật → sửa → nhập lại, có bảng diff cũ→mới) + nhật ký giá trị cũ ở
`storage/app/private/imports/` + 10 test trong `dev/test_features.php` mục H (48/48 pass).
Áp dụng cho cả 2 sheet ICD/HPH — HPH không có số cont riêng nên chỉ khớp được theo ID.

## Mục tiêu

Nhân viên sửa hàng loạt lô đã có bằng file Excel thay vì mở popup từng lô. Khác với
"Import lô" hiện tại (chỉ TẠO lô mới từ bảng kế hoạch), luồng này chỉ **cập nhật lô đã có**,
không tạo và không xóa lô.

Không làm: tạo lô mới, xóa lô, sửa chi phí/doanh thu (đã có Import CSHT và popup riêng).

## Quyết định đã chốt (user, 2026-07-25)

| Vấn đề | Chốt |
|---|---|
| Khóa khớp dòng ↔ lô | **ID lô ưu tiên**, thiếu ID thì khớp **Số cont**; cont trùng/không thấy → lỗi, chặn import |
| Ô để trống trong file | **Giữ nguyên** giá trị cũ. Muốn xóa phải gõ `--` |
| Lô đã nằm trong bảng kê | **Cảnh báo** trong bản xem trước, vẫn cho sửa |
| Nhóm cột được sửa | Cả 4: lịch trình · định danh cont · tuyến · khác |

## Hiện trạng (đã đọc code + đo dữ liệu)

- `saveShipment($data, $sheet, $s, $only)` đã hỗ trợ **lưu từng phần**: chỉ field trong `$only`
  mới ghi đè → chống lost-update, tự suy `is_barge/barge_cont`, và tự gọi
  `recomputeShipmentDerived()`. `bulkUpdateShipments()` là tiền lệ dùng đúng cách này.
- `HandlesCshtImport` là khuôn mẫu gần nhất: dry-run `validate*` → all-or-nothing trong
  transaction → khớp theo cont (cont trùng = lỗi) → recompute lô đã đụng.
- Parser Excel client sẵn có ở `resources/js/trucking2/components/lo-hang/excel.js`
  (`cellDate`/`cellTime` xử lý Date object của SheetJS, không phụ thuộc locale).
- Đo trên DB (399 lô): **55 lô chưa có số cont**, **6 số cont trùng trong cùng sheet**,
  **83 booking trùng**, **71 lô đã vào bảng kê khách**. → Số cont/booking không đủ làm khóa;
  ID lô là khóa chính, cont chỉ là dự phòng.

## Thiết kế

### 1. File Excel

Thêm chế độ **"Xuất để cập nhật"** trong popup Xuất Excel: cột `ID` (đầu tiên, khóa) + đúng
các cột được phép sửa, đổ sẵn giá trị hiện tại. Nhân viên sửa ô cần đổi rồi nhập lại.
File ngoài (không có cột ID) vẫn dùng được nếu có cột Số cont.

Cột nhận diện theo TỪ KHÓA như các parser hiện có (không phụ thuộc hoa/thường/dấu):

| Nhóm | Cột | Field client → cột DB |
|---|---|---|
| Khóa | ID, SỐ CONT | `id` / `cont_no` |
| Lịch trình | GIỜ XE ĐẾN, GIỜ XE RA, NGÀY + GIỜ (đến dự kiến), BKS VÀO, BKS RA | `gioXeDen`, `gioXeRa`, `gioDenDuKien`, `bksVao`, `bksRa` |
| Định danh | SỐ CONT, LOẠI CONT, SỐ TỜ KHAI, INVOICE | `contNo`, `contType`, `declNo`, `inv` |
| Tuyến | NƠI LẤY, NƠI HẠ, KHO, NƠI HẠ SÀ LAN | `from`, `to`, `kho`, `bargeDrop` |
| Khác | CẮT MÁNG, GHI CHÚ, TÀI XẾ, NHÀ XE NGOÀI | `cutOff`, `rev.ghiChu`, `driver`, `extVendor` |

Không nhận: khách hàng, số lượng, sheet, chi phí, doanh thu (đổi khách/số lượng làm lệch
bảng kê đã chốt; chi phí đã có luồng riêng).

### 2. Quy tắc ghi

- `$only` = danh sách field **có cột trong file VÀ ô có nội dung** → ô trống không đụng tới.
- `--` = xóa giá trị (ghi null/rỗng).
- Ghi qua `saveShipment(...)` để hưởng nguyên chuẩn hóa + derive + recompute sẵn có.
- All-or-nothing: 1 dòng lỗi là không ghi gì (giống 2 import hiện có).

### 3. Kiểm tra trước khi ghi (dry-run)

`POST /shipment-update/check` trả về:

- `errors[]` — lỗi từng dòng kèm lý do (chặn import).
- `changes[]` — **diff từng ô: lô, cột, giá trị cũ → mới**. Đây là chốt an toàn chính:
  nhân viên thấy đúng cái sẽ đổi trước khi bấm.
- `warnings[]` — lô nằm trong bảng kê nào; số cont mới trùng lô khác; giờ ra đổi làm
  đổi Connect/Disconnect (ảnh hưởng giá).

Luật kiểm tra từng dòng:

| Kiểm tra | Xử lý |
|---|---|
| ID không tồn tại / khác sheet đang xem | lỗi |
| Không ID: cont không thấy, hoặc trùng >1 lô | lỗi |
| Cùng 1 lô bị 2 dòng file sửa | lỗi |
| Ngày/giờ sai định dạng (`isValidDateStr`/`isValidTimeStr`) | lỗi |
| Giờ xe ra < giờ xe đến (sau khi áp) | lỗi |
| Nơi lấy/hạ/kho không có trong danh mục | lỗi (KHÔNG tự tạo — theo nguyên tắc đã chốt ở bảng giá) |
| Nơi hạ sà lan khác HPP/LHP | lỗi |
| Loại cont / nhà xe ngoài không có trong danh mục | lỗi |
| Dòng không đổi gì | bỏ qua, đếm riêng |
| Lô đã trong bảng kê | cảnh báo |

### 4. Điểm chạm code

| Việc | File |
|---|---|
| Parser + dựng file xuất-để-cập-nhật | `resources/js/trucking2/components/lo-hang/excel.js` |
| Popup Import cập nhật + bảng diff | `resources/js/trucking2/components/lo-hang/ShipmentsApp.jsx` |
| Service (trait mới, cùng ranh giới với `HandlesCshtImport`) | `app/Services/Trucking/Concerns/HandlesShipmentUpdateImport.php` |
| 2 action check/import | `app/Http/Controllers/Trucking/ShipmentController.php` |
| Route `permission:shipments.update` | `routes/web.php` (cạnh `csht-import`) |

## Rủi ro & cách chặn

| Rủi ro | Cách chặn |
|---|---|
| Ghi nhầm lô (cont trùng/quay vòng) | Khóa ID; khớp cont chỉ khi duy nhất, trùng là lỗi |
| Dán thiếu cột → xóa sạch dữ liệu | Ô trống = giữ nguyên; xóa phải gõ `--` |
| Sửa nhầm hàng loạt | Bản xem trước dạng diff cũ→mới + all-or-nothing |
| Lệch bảng kê đã chốt | Cảnh báo kèm tên bảng kê; trang Bảng kê đã có sẵn cảnh báo lệch để bấm Tính lại |
| Ghi đè việc người khác đang sửa | `$only` chỉ ghi cột có trong file |
| Rác danh mục địa điểm/kho | Validate trước, không tự tạo |
| Sai định dạng ngày do locale Excel | Dùng lại `cellDate`/`cellTime` (`raw:true` + Date object) |
| Không có nhật ký để truy lại | Ghi `storage/app/imports/shipment-update-{time}.json` chứa giá trị CŨ của các ô đã đổi + người import |

## Các bước

1. **Backend**: trait `HandlesShipmentUpdateImport` (resolve khóa → build patch → diff → validate → import), 2 action, 2 route.
2. **Frontend**: chế độ "Xuất để cập nhật", popup Import cập nhật với bảng diff + cảnh báo.
3. **Nhật ký**: ghi file JSON giá trị cũ trước khi ghi đè.
4. **Test**: bổ sung mục vào `dev/test_features.php` — **chỉ thao tác trên lô tạo mới rồi xóa,
   không đụng lô thật** (bài học từ sự cố 2026-07-25: `savePriceBookRows` xóa-hết-ghi-lại và
   rollback lồng transaction không cứu được).

## Tiêu chí nghiệm thu

- File xuất-để-cập-nhật nhập lại nguyên vẹn → 0 ô thay đổi.
- Sửa 1 ô giờ xe ra của 1 lô → diff hiện đúng 1 ô, ghi xong đúng 1 lô đổi, cột khác nguyên vẹn.
- Ô trống không xóa dữ liệu; `--` xóa được.
- Cont trùng/ID sai → chặn, không ghi gì.
- Lô trong bảng kê → có cảnh báo, vẫn ghi được.
- Sau import: `cuocDau`/free time/derived tính lại đúng (recompute chạy qua `saveShipment`).

## Bổ sung 2026-07-30 (user chốt)

- File cập nhật thêm 2 cột **chỉ đọc** `KHÁCH HÀNG` / `SỐ BOOKING/BILL` để nhận ra dòng nào là lô
  nào (lô chưa điền cont thì nhìn vào đây). Parser không gửi 2 cột này lên server.
- **Bỏ** cột `CẮT MÁNG` và `TÀI XẾ`.
- **Thêm** cột `CƯỚC XE NGOÀI` — không phải cột DB: ghi vào dòng chi phí `src=extTruck`
  (item "Cước xe ngoài"), `ext_fee` tự chốt lại qua recompute. Bắt buộc có Nhà xe ngoài.
- **Tách 2 luồng** (user chốt): file "Cập nhật lô" KHÔNG có cột tờ khai; tờ khai đi qua nút riêng
  **"Cập nhật tờ khai"** — mỗi tờ khai là 1 DÒNG Excel (lặp lại ID LÔ), mỗi ô đúng 1 giá trị.
  Lý do bỏ cách "nhiều giá trị trong 1 ô cách nhau dấu phẩy": dấu phẩy đụng dấu phân cách nghìn
  của Excel (`250,000` bị tách thành 2 giá trị). Frontend gom theo lô → `values.declPairs`, dùng
  chung endpoint `shipment-update` nên không thêm route/quyền mới.
- File cập nhật lô kèm **6 sheet giá trị hợp lệ** (Địa điểm · Kho · Loại cont · Nhà xe ngoài ·
  Biển số · Sà lan) và **BKS vào/ra nay bắt buộc khớp danh mục Xe** (recompute map `vehicle_id`
  bằng so khớp chuỗi chính xác — gõ sai là lô mất liên kết xe, báo cáo theo xe hụt).
- Khoản `Phí mở tờ khai` + `Cước xe ngoài` được khai sẵn vào danh mục Khoản chi phí
  (migration `2026_08_04_000001`) — trước đây 2 khoản hệ thống này không có trong danh mục nên
  dòng chi phí bị `cost_item_id` rỗng.
- **1 lô nhiều tờ khai, mỗi tờ khai 1 phí**: cột JSON `declarations` = `[{no, fee}]`
  (migration `2026_07_30_000001`, backfill từ `declaration_no` + dòng `thanhLyFee`).
  `declaration_no` vẫn được sinh (danh sách số cách nhau ", ") nên tìm kiếm / bảng kê / xuất Excel
  không phải đổi. Tổng phí đồng bộ sang 1 dòng chi phí `src=thanhLyFee` → cột "Thanh lí" của bảng kê
  và báo cáo chạy y như trước. Popup: repeater "Tờ khai" (số + phí + xóa), bỏ ô "Phí thanh lý tờ khai" cũ.
  File Excel giữ **1 dòng/lô**: 2 cột song song `SỐ TỜ KHAI` / `PHÍ TỜ KHAI` khớp theo thứ tự,
  lệch số lượng là lỗi; chỉ sửa cột phí thì danh sách số giữ nguyên.
- Nút "Xuất để cập nhật" tách 3 phạm vi: **theo bộ lọc đang xem · chỉ lô chưa ra · tất cả**.
- `recomputeShipmentDerived` coi `declarations` là nhóm đụng chi phí (nếu không, sửa phí tờ khai
  sẽ không tính lại `cost_total`).

## Ghi chú khi triển khai

- Nơi lấy/hạ: nhập KÝ HIỆU dùng chung cho nhiều địa điểm (vd mã HPP có TÂN VŨ, GIC, ĐÌNH VŨ…)
  thì **báo lỗi đòi ghi rõ TÊN**, không tự chọn bừa 1 cảng. `locationNameMap()` sẵn có quy
  ký hiệu → tên theo bản ghi cuối cùng nên không dùng được cho luồng này.
- `ghi_chu` nằm trong nhóm `rev` của `saveShipment` mà nhóm đó xóa-tạo lại doanh thu/thanh toán
  → gán thẳng vào model trước khi lưu, không bật `$only='rev'`.
- Cắt máng kiểm được định dạng vì 364/364 lô đang lưu đúng dạng ISO.
- **Chỉ kiểm tra ô THỰC SỰ ĐỔI.** Bản đầu kiểm cả ô giữ nguyên nên xuất→nhập lại báo 22 lỗi:
  loại cont `20DC`/`40RHC` đang dùng thật (38 lô) mà danh mục không có, và 7/172 lô có giờ ra
  sớm hơn giờ đến (chủ yếu `ra_mode=other` — giờ ra hiệu lực nằm ở cont khác).
- Giờ ra sớm hơn giờ đến hạ xuống **cảnh báo** và chỉ nhắc khi người dùng động vào 2 ô đó.
