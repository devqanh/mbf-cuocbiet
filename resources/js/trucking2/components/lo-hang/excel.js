// Logic Excel THUẦN cho Lô hàng (data vào → workbook/rows ra; KHÔNG đụng React state).
// Dùng XLSX (global, nạp sẵn ở layout). Tách khỏi ShipmentsApp cho gọn/dễ đọc.

// (*) = BẮT BUỘC: Khách hàng, Số booking, Số lượng cont. Khớp cột khi import theo TỪ KHÓA (không phụ thuộc dấu *).
export const IMP_COLS = ["Khách hàng *", "SỐ BOOKING/BILL *", "NHẬP/XUẤT", "SỐ LƯỢNG CONT *", "LOẠI CONT", "SỐ CONTAINER", "CẮT MÁNG", "NƠI LẤY", "NƠI HẠ", "NƠI HẠ SÀ LAN", "NGÀY ĐẾN DỰ KIẾN", "GIỜ ĐẾN DỰ KIẾN", "KHO", "INVOICE"];
// Nơi hạ sà lan (điểm đến) — CHỈ nhận 2 cảng này (hoặc để trống = không đi sà lan).
export const BARGE_DROPS = ["HPP", "LHP"];

// Đếm số LÔ thực tế sẽ tạo (bung theo số container, hoặc nhân theo số lượng cont) — đúng quy tắc backend.
export const loCountOf = (rows) => (rows || []).reduce((a, r) => { const cs = String(r.contNo || "").split(/[\r\n;,]+/).map((s) => s.trim()).filter(Boolean); return a + (cs.length || Math.max(1, parseInt(String(r.qty || "").replace(/[^\d]/g, ""), 10) || 1)); }, 0);

const normH = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
const p2 = (n) => String(n).padStart(2, "0");

// --- Xử lý ngày/giờ an toàn cho mọi dạng ô Excel (Date object, serial number, text dd/mm/yyyy) ---
// Excel + cellDates:true → Date object tường minh, không phụ thuộc locale. Text giữ dd/mm/yyyy (file mẫu).

// Ô ngày/giờ ĐỊNH DẠNG NGÀY THẬT của Excel bị lệch ~30 giây khi đổi sang Date: thư viện quy đổi
// mốc 30/12/1899 sang giờ địa phương và chỉ bù lệch múi giờ theo PHÚT NGUYÊN, trong khi giờ chuẩn
// Sài Gòn năm 1899 lẻ 30 giây. Hệ quả: 14/05/2026 thành 13/05/2026 23:59:30 (lùi 1 ngày) và
// 10:30 thành 10:29:30 (hụt 1 phút). Người dùng chỉ nhập tới PHÚT nên cắt/làm tròn phần giây
// theo giờ địa phương là trả lại đúng giá trị trong file.
function snapToMinute(d) {
  const rest = d.getSeconds() * 1000 + d.getMilliseconds();
  return rest === 0 ? d : new Date(d.getTime() + (rest >= 30000 ? 60000 - rest : -rest));
}

function cellDate(v) {
  if (v == null || v === "") return { iso: "", display: "" };
  if (v instanceof Date && !isNaN(v)) {
    v = snapToMinute(v);
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    if (y < 2000 || y > 2099) return { iso: "", display: String(v) };   // năm vô lý → cảnh báo
    return { iso: `${y}-${p2(m)}-${p2(d)}`, display: `${p2(d)}/${p2(m)}/${y}` };
  }
  if (typeof v === "number" && v > 0 && v < 100000) {
    // Serial date (fallback nếu cellDates miss)
    try { const dt = XLSX.SSF.parse_date_code(v); if (dt && dt.y >= 2000 && dt.y <= 2099) return { iso: `${dt.y}-${p2(dt.m)}-${p2(dt.d)}`, display: `${p2(dt.d)}/${p2(dt.m)}/${dt.y}` }; } catch (e) {}
    return { iso: "", display: String(v) };
  }
  // Text: parse dd/mm/yyyy (format file mẫu)
  const s = String(v).trim();
  const mx = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
  if (!mx) return { iso: "", display: s };
  let [, d, mo, y] = mx;
  if (y.length === 2) y = "20" + y;
  if (+y < 2000 || +y > 2099 || +mo < 1 || +mo > 12 || +d < 1 || +d > 31) return { iso: "", display: s };
  return { iso: `${y}-${p2(+mo)}-${p2(+d)}`, display: s };
}
function cellTime(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v)) { const t = snapToMinute(v); return `${p2(t.getHours())}:${p2(t.getMinutes())}`; }
  const m = /(\d{1,2}):(\d{2})/.exec(String(v));
  return m ? `${p2(+m[1])}:${m[2]}` : "";
}

// Parse 1 sheet Excel → mảng dòng lô (khớp cột theo từ khóa header). wb = workbook đã đọc (cellDates:true), sheetName = tên sheet.
export function parseImportRows(wb, sheetName) {
  // raw:true để nhận Date objects từ cellDates:true (tường minh, không phụ thuộc locale); text cells vẫn là string.
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
  let hi = aoa.findIndex((r) => (r || []).some((c) => { const h = normH(c); return h.includes("khách") || h.includes("nhà máy"); }));
  if (hi < 0) hi = 0;
  const header = (aoa[hi] || []).map(normH);
  const col = (...kws) => header.findIndex((h) => kws.some((k) => h.includes(k)));
  const C = { customer: col("khách", "nhà máy"), booking: col("booking", "bill"), io: col("nhập", "xuất"), qty: col("lượng"), contType: col("loại"), contNo: col("container", "tên cont", "số cont"), cutOff: col("máng"), from: col("lấy"), bargeDrop: col("sà lan", "sa lan"), to: col("hạ"), ngay: col("ngày"), gio: col("giờ"), kho: col("kho"), inv: col("invoice", "inv") };
  // "NƠI HẠ" và "NƠI HẠ SÀ LAN" đều chứa "hạ" → nếu col("hạ") trùng cột sà lan thì bỏ (để to lấy đúng cột Nơi hạ).
  if (C.to >= 0 && C.to === C.bargeDrop) C.to = header.findIndex((h, idx) => h.includes("hạ") && idx !== C.bargeDrop);
  const out = [];
  for (let r = hi + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    // Text getter (an toàn với Date objects — toString cho display, nhưng ngày/giờ dùng hàm riêng bên dưới).
    const g = (i) => { if (i < 0) return ""; const v = row[i]; return v instanceof Date ? "" : String(v == null ? "" : v).trim(); };
    if (!g(C.customer) && !g(C.booking) && !g(C.from) && !g(C.to)) continue;
    // Ngày: Date object → tường minh; text → dd/mm/yyyy; năm ngoài 2000-2099 → lỗi.
    const ngay = cellDate(C.ngay >= 0 ? row[C.ngay] : null);
    // Giờ lấy ở cột GIỜ; cột trống thì lấy phần giờ nằm trong chính ô NGÀY (người dùng hay gộp
    // "14/05/2026 08:00" vào 1 ô) — ô chỉ có ngày thì phần giờ là 00:00 nên không đổi kết quả.
    const hm = cellTime(C.gio >= 0 ? row[C.gio] : null) || cellTime(C.ngay >= 0 ? row[C.ngay] : null);
    const gioDenDuKien = ngay.iso ? `${ngay.iso}T${hm || "00:00"}` : "";
    const cm = cellDate(C.cutOff >= 0 ? row[C.cutOff] : null);
    const cmHm = cellTime(C.cutOff >= 0 ? row[C.cutOff] : null);
    const cutOff = cm.iso ? `${cm.iso}T${cmHm || "00:00"}` : "";
    out.push({ customer: g(C.customer), booking: g(C.booking), io: g(C.io), qty: String(row[C.qty] == null ? "" : row[C.qty]).replace(/[^\d]/g, ""), qtyRaw: g(C.qty) || String(row[C.qty] ?? ""), contType: g(C.contType), contNo: g(C.contNo), cutOff, cutOffRaw: cm.display || g(C.cutOff), from: g(C.from), to: g(C.to), bargeDrop: g(C.bargeDrop).toUpperCase(), kho: g(C.kho), inv: g(C.inv), gioDenDuKien, ngayRaw: ngay.display || g(C.ngay), gioRaw: hm || g(C.gio) });
  }
  return out;
}

// ===================== IMPORT CSHT (phí CSHT + Thanh lý theo số cont) =====================
// Cột file CSHT. (*) = bắt buộc: Số cont. Khớp cột theo TỪ KHÓA (không phụ thuộc dấu/hoa thường).
export const CSHT_COLS = ["NGÀY HĐ", "SỐ CONT *", "NHẬP/XUẤT", "PHÍ CSHT", "SỐ TIỀN THANH LÝ", "GHI CHÚ", "SỐ HĐ"];

// Đếm số dòng CSHT có dữ liệu (có số cont) — để hiện số lượng trước khi import.
export const cshtRowCount = (rows) => (rows || []).filter((r) => String(r.contNo || "").trim() !== "").length;

// Số tiền: bỏ mọi ký tự không phải số → chuỗi digit (backend tự parse). "" nếu trống.
const money = (v) => { if (v == null) return ""; if (typeof v === "number") return String(Math.round(v)); return String(v).replace(/[^\d]/g, ""); };

// Parse 1 sheet Excel CSHT → mảng dòng { date, dateRaw, contNo, io, csht, thanhLy, note, invoiceNo }.
export function parseCshtRows(wb, sheetName) {
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
  let hi = aoa.findIndex((r) => (r || []).some((c) => { const h = normH(c); return h.includes("cont") || h.includes("csht"); }));
  if (hi < 0) hi = 0;
  const header = (aoa[hi] || []).map(normH);
  const col = (...kws) => header.findIndex((h) => kws.some((k) => h.includes(k)));
  const C = { date: col("ngày", "ngay"), cont: col("cont"), io: col("nhập", "xuất", "nhap", "xuat"), csht: col("csht"), thanhLy: col("thanh lý", "thanh ly", "thanh lí", "thanh li"), note: col("ghi chú", "ghi chu"), inv: col("hđ", "hd", "hóa đơn", "hoa don") };
  // "SỐ HĐ" và "NGÀY HĐ" đều chứa "hđ" → nếu inv trùng cột ngày thì lấy cột hđ KHÁC cột ngày.
  if (C.inv >= 0 && C.inv === C.date) C.inv = header.findIndex((h, idx) => (h.includes("hđ") || h.includes("hd") || h.includes("hóa đơn") || h.includes("hoa don")) && idx !== C.date);
  const out = [];
  for (let r = hi + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const g = (i) => { if (i < 0) return ""; const v = row[i]; return v instanceof Date ? "" : String(v == null ? "" : v).trim(); };
    const cont = g(C.cont);
    const csht = money(C.csht >= 0 ? row[C.csht] : null);
    const thanhLy = money(C.thanhLy >= 0 ? row[C.thanhLy] : null);
    // Bỏ dòng trắng (không cont + không tiền)
    if (!cont && !csht && !thanhLy) continue;
    const d = cellDate(C.date >= 0 ? row[C.date] : null);
    out.push({ date: d.iso, dateRaw: d.display || g(C.date), contNo: cont, io: g(C.io), csht, thanhLy, note: g(C.note), invoiceNo: g(C.inv) });
  }
  return out;
}

// Dựng workbook FILE MẪU import CSHT (1 sheet mẫu + Hướng dẫn).
export function buildCshtTemplateWb() {
  const ex1 = { "NGÀY HĐ": "20/06/2026", "SỐ CONT *": "TGHU1234567", "NHẬP/XUẤT": "Nhập", "PHÍ CSHT": 250000, "SỐ TIỀN THANH LÝ": 180000, "GHI CHÚ": "CSHT tháng 6", "SỐ HĐ": "0001234" };
  const ex2 = { "NGÀY HĐ": "21/06/2026", "SỐ CONT *": "MSKU9981122", "NHẬP/XUẤT": "Xuất", "PHÍ CSHT": 250000, "SỐ TIỀN THANH LÝ": "", "GHI CHÚ": "", "SỐ HĐ": "0001235" };
  const ws = XLSX.utils.json_to_sheet([ex1, ex2], { header: CSHT_COLS });
  ws["!cols"] = CSHT_COLS.map((col) => ({ wch: Math.max(12, col.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CSHT");
  const guide = [
    { "Cột": "NGÀY HĐ", "Bắt buộc": "không", "Ý nghĩa": "Ngày hóa đơn / ngày thanh toán (dd/mm/yyyy) — ghi vào Ngày hóa đơn của khoản chi phí" },
    { "Cột": "SỐ CONT *", "Bắt buộc": "CÓ", "Ý nghĩa": "Số container — phải trùng ĐÚNG 1 lô đang có (trùng nhiều lô hoặc không có sẽ báo lỗi)" },
    { "Cột": "NHẬP/XUẤT", "Bắt buộc": "không", "Ý nghĩa": "Nhập hoặc Xuất — đối chiếu với lô; LỆCH sẽ báo lỗi (để trống = không đối chiếu)" },
    { "Cột": "PHÍ CSHT", "Bắt buộc": "không*", "Ý nghĩa": "Số tiền khoản CSHT (đã gồm VAT) — ghi/ghi đè dòng CSHT của lô" },
    { "Cột": "SỐ TIỀN THANH LÝ", "Bắt buộc": "không*", "Ý nghĩa": "Số tiền khoản Thanh lí — ghi/ghi đè dòng Thanh lí của lô" },
    { "Cột": "GHI CHÚ", "Bắt buộc": "không", "Ý nghĩa": "Ghi chú — áp cho cả khoản CSHT & Thanh lí của dòng" },
    { "Cột": "SỐ HĐ", "Bắt buộc": "không", "Ý nghĩa": "Số hóa đơn — áp cho cả khoản CSHT & Thanh lí của dòng" },
    { "Cột": "(*) lưu ý", "Bắt buộc": "", "Ý nghĩa": "Mỗi dòng phải có ít nhất 1 trong 2: PHÍ CSHT hoặc SỐ TIỀN THANH LÝ. Import lại sẽ GHI ĐÈ dòng cũ (không nhân đôi)." },
  ];
  const wg = XLSX.utils.json_to_sheet(guide, { header: ["Cột", "Bắt buộc", "Ý nghĩa"] });
  wg["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wg, "Hướng dẫn");
  return wb;
}

// Dựng workbook FILE MẪU import (gồm sheet mẫu + tham chiếu Địa điểm/Khách/Kho hợp lệ + Hướng dẫn). c = cfg đầy đủ.
export function buildTemplateWb(c) {
  c = c || {};
  const locs = c.locations || [];
  const codeOf = c.locationCode || {};
  const custs = c.customers || [];
  const whs = c.warehouses || [];
  const whCodeOf = c.warehouseCode || {};
  const exFrom = locs[0] || "ICD Quế Võ";
  const exTo = locs[1] || locs[0] || "KCN Tiên Sơn";
  const exCust = custs[0] || "Canon Vietnam";
  // Loại cont ví dụ phải LẤY TỪ DANH MỤC — import chặn loại ngoài danh mục, mẫu gõ cứng sẽ lỗi ngay.
  const cts = c.contTypes || [];
  const exCT1 = cts[0] || "40HC";
  const exCT2 = cts[1] || exCT1;
  // KHO ví dụ = ký hiệu kho CÓ THẬT (tránh import mẫu bị lỗi "chưa có trong danh mục kho")
  const whTok = (n) => whCodeOf[n] || n;
  const exKho1 = whs.length >= 2 ? `${whTok(whs[0])}, ${whTok(whs[1])}` : (whs[0] ? whTok(whs[0]) : "");
  const exKho2 = whs[0] ? whTok(whs[0]) : "";
  const ex1 = { "Khách hàng *": exCust, "SỐ BOOKING/BILL *": "BL-ICD-0001", "NHẬP/XUẤT": "Nhập", "SỐ LƯỢNG CONT *": 3, "LOẠI CONT": exCT1, "SỐ CONTAINER": "TGHU1234567\nMSKU9981122\nCSNU4567788", "CẮT MÁNG": "14/05/2026 10:00", "NƠI LẤY": exFrom, "NƠI HẠ": exTo, "NƠI HẠ SÀ LAN": "HPP", "NGÀY ĐẾN DỰ KIẾN": "14/05/2026", "GIỜ ĐẾN DỰ KIẾN": "08:00", "KHO": exKho1, "INVOICE": "INV-001" };
  const ex2 = { "Khách hàng *": exCust, "SỐ BOOKING/BILL *": "BL-ICD-0002", "NHẬP/XUẤT": "Xuất", "SỐ LƯỢNG CONT *": 2, "LOẠI CONT": exCT2, "SỐ CONTAINER": "", "CẮT MÁNG": "15/05/2026 09:00", "NƠI LẤY": codeOf[exFrom] || exFrom, "NƠI HẠ": exTo, "NƠI HẠ SÀ LAN": "", "NGÀY ĐẾN DỰ KIẾN": "15/05/2026", "GIỜ ĐẾN DỰ KIẾN": "07:30", "KHO": exKho2, "INVOICE": "INV-002" };
  const ws = XLSX.utils.json_to_sheet([ex1, ex2], { header: IMP_COLS });
  ws["!cols"] = IMP_COLS.map((col) => ({ wch: Math.max(12, col.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lô hàng");
  const locRows = locs.map((n) => ({ "Tên địa điểm": n, "Ký hiệu": codeOf[n] || "" }));
  if (locRows.length) {
    const wl = XLSX.utils.json_to_sheet(locRows, { header: ["Tên địa điểm", "Ký hiệu"] });
    wl["!cols"] = [{ wch: 32 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wl, "Địa điểm hợp lệ");
  }
  if (custs.length) {
    const wc = XLSX.utils.json_to_sheet(custs.map((n) => ({ "Khách hàng": n })), { header: ["Khách hàng"] });
    wc["!cols"] = [{ wch: 36 }];
    XLSX.utils.book_append_sheet(wb, wc, "Khách hàng hợp lệ");
  }
  if (whs.length) {
    const whRows = whs.map((n) => ({ "Tên kho": n, "Ký hiệu": whCodeOf[n] || "" }));
    const ww = XLSX.utils.json_to_sheet(whRows, { header: ["Tên kho", "Ký hiệu"] });
    ww["!cols"] = [{ wch: 28 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ww, "Kho hợp lệ");
  }
  if (cts.length) {
    const wct = XLSX.utils.json_to_sheet(cts.map((n) => ({ "Loại cont": n })), { header: ["Loại cont"] });
    wct["!cols"] = [{ wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wct, "Loại cont hợp lệ");
  }
  // Nơi hạ sà lan hợp lệ — địa điểm có ký hiệu HPP hoặc LHP
  const bargeLocRows = locs.map((n) => ({ name: n, code: codeOf[n] || "" })).filter((r) => BARGE_DROPS.includes(r.code));
  const bargeSheet = XLSX.utils.json_to_sheet(bargeLocRows.map((r) => ({ "Tên địa điểm": r.name, "Ký hiệu": r.code })), { header: ["Tên địa điểm", "Ký hiệu"] });
  bargeSheet["!cols"] = [{ wch: 22 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, bargeSheet, "Sà lan hợp lệ");
  const guide = [
    { "Cột": "Khách hàng *", "Bắt buộc": "CÓ", "Ý nghĩa": "Tên khách — phải trùng danh mục (xem sheet 'Khách hàng hợp lệ')" },
    { "Cột": "SỐ BOOKING/BILL *", "Bắt buộc": "CÓ", "Ý nghĩa": "Số booking / số bill" },
    { "Cột": "SỐ LƯỢNG CONT *", "Bắt buộc": "CÓ", "Ý nghĩa": "Số lượng container (số ≥ 1) — cont để trống sẽ nhân bản theo số này" },
    { "Cột": "NƠI LẤY", "Bắt buộc": "không", "Ý nghĩa": "Điểm lấy hàng — TÊN hoặc KÝ HIỆU trong danh mục Địa điểm (nếu nhập sai sẽ báo lỗi)" },
    { "Cột": "NƠI HẠ", "Bắt buộc": "không", "Ý nghĩa": "Điểm hạ hàng — TÊN hoặc KÝ HIỆU trong danh mục Địa điểm (nếu nhập sai sẽ báo lỗi)" },
    { "Cột": "NƠI HẠ SÀ LAN", "Bắt buộc": "không", "Ý nghĩa": "Điểm đến sà lan — nhập TÊN hoặc KÝ HIỆU địa điểm có mã HPP/LHP (xem sheet 'Sà lan hợp lệ'). Có giá trị = lô đi sà lan; để trống = không đi sà lan" },
    { "Cột": "NGÀY ĐẾN DỰ KIẾN", "Bắt buộc": "không", "Ý nghĩa": "Ngày xe DỰ KIẾN đến (dd/mm/yyyy)" },
    { "Cột": "GIỜ ĐẾN DỰ KIẾN", "Bắt buộc": "không", "Ý nghĩa": "Giờ xe DỰ KIẾN đến (HH:MM) — ghép với Ngày đến dự kiến" },
    { "Cột": "CẮT MÁNG", "Bắt buộc": "không", "Ý nghĩa": "Hạn cắt máng/tàu (dd/mm/yyyy HH:MM)" },
    { "Cột": "NHẬP/XUẤT", "Bắt buộc": "không", "Ý nghĩa": "Nhập hoặc Xuất" },
    { "Cột": "LOẠI CONT", "Bắt buộc": "không", "Ý nghĩa": "Phải có trong danh mục Loại cont (xem sheet 'Loại cont hợp lệ'); nhập loại chưa khai sẽ báo lỗi — thêm ở Cài đặt → Loại cont" },
    { "Cột": "SỐ CONTAINER", "Bắt buộc": "không", "Ý nghĩa": "Số cont — nhiều cont thì XUỐNG DÒNG trong 1 ô" },
    { "Cột": "KHO", "Bắt buộc": "không", "Ý nghĩa": "Tuyến kho — TÊN hoặc KÝ HIỆU trong danh mục Kho (xem sheet 'Kho hợp lệ'); nhiều đoạn nối bằng dấu phẩy (vd TL, TS); dùng khớp phí xe; nhập sai sẽ báo lỗi" },
    { "Cột": "INVOICE", "Bắt buộc": "không", "Ý nghĩa": "Số invoice (nếu có)" },
  ];
  const wg = XLSX.utils.json_to_sheet(guide, { header: ["Cột", "Bắt buộc", "Ý nghĩa"] });
  wg["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(wb, wg, "Hướng dẫn");
  return wb;
}

// ===================== IMPORT CẬP NHẬT LÔ ĐÃ CÓ =====================
// Vòng lặp an toàn: Xuất để cập nhật (kèm cột ID) → sửa ô cần đổi → Import cập nhật.
// Ô TRỐNG = giữ nguyên; gõ "--" mới xóa giá trị. Backend là nơi kiểm tra/quyết định cuối.
export const CLEAR_TOKEN = "--";

// key = field backend · col = tiêu đề cột · kw = từ khóa nhận diện cột ở file ngoài · dt = ô ngày+giờ
// ro = CHỈ ĐỌC: chỉ để người sửa file biết dòng nào là lô nào (lô chưa điền cont thì nhìn vào
// đây mới nhận ra), KHÔNG gửi lên server nên sửa nhầm cũng không đụng dữ liệu.
const UPD_FIELDS = [
  { key: "id",           col: "ID",              kw: ["id"] },
  { key: "customer",     col: "KHÁCH HÀNG (không sửa)",     kw: ["khách", "khach"], ro: true },
  { key: "booking",      col: "SỐ BOOKING/BILL (không sửa)", kw: ["booking", "bill"], ro: true },
  { key: "contNo",       col: "SỐ CONT",         kw: ["số cont", "so cont", "container"] },
  { key: "contType",     col: "LOẠI CONT",       kw: ["loại", "loai"] },
  { key: "io",           col: "NHẬP/XUẤT",       kw: ["nhập/xuất", "nhap/xuat", "nhập", "xuất"] },
  { key: "gioDenDuKien", col: "GIỜ ĐẾN DỰ KIẾN", kw: ["dự kiến", "du kien"], dt: true },
  { key: "gioXeDen",     col: "GIỜ XE ĐẾN",      kw: ["xe đến", "xe den"], dt: true },
  { key: "bksVao",       col: "BKS VÀO",         kw: ["bks vào", "bks vao", "biển số vào"] },
  // ---- Khối XE RA: 4 cột đọc CÙNG NHAU, theo đúng thứ tự thao tác ở popup: KIỂU RA → (cont ra hộ) → giờ → BKS.
  // Kiểu ra: "Không cắt móc" / "Cont khác ra" / "Không kéo ra" — trống = giữ nguyên.
  { key: "raMode",        col: "KIỂU RA",              kw: ["kiểu ra", "kieu ra"] },
  // Cont khác ra: điền SỐ CONT ra hộ → backend tìm lô CHƯA RA khớp cont đó (booking nào cũng được), gán liên kết.
  // Để trống = giữ nguyên; gõ -- = bỏ liên kết.
  { key: "raOtherContNo", col: "SỐ CONT RA (CẮT MÓC)", kw: ["cont ra", "cắt móc", "cat moc"] },
  // GIỜ XE RA + BKS RA hiểu theo KIỂU RA (như ô nhập của popup): Không cắt móc → của chính cont này ·
  // Cont khác ra → của CONT RA HỘ (ghi sang lô cont đó) · Không kéo ra → giờ/BKS của XE (đầu kéo).
  // BKS RA trống + có giờ ra mới → backend tự lấy BKS VÀO. Xuất: giờ ra HIỆU LỰC theo kiểu ra (gioXeRaEff).
  { key: "gioXeRa",       col: "GIỜ XE RA",            kw: ["xe ra", "giờ ra", "gio ra"], dt: true },
  { key: "bksRa",         col: "BKS RA",               kw: ["bks ra", "biển số ra"] },
  // Nhiều tờ khai / lô: 2 cột SONG SONG theo thứ tự (giữ 1 dòng/lô cho dễ sửa hàng loạt).
  { key: "inv",          col: "INVOICE",         kw: ["invoice", "inv"] },
  { key: "from",         col: "NƠI LẤY",         kw: ["lấy", "lay"] },
  { key: "to",           col: "NƠI HẠ",          kw: ["hạ", "ha"] },
  { key: "bargeDrop",    col: "NƠI HẠ SÀ LAN",   kw: ["sà lan", "sa lan"] },
  { key: "kho",          col: "KHO",             kw: ["kho"] },
  { key: "extVendor",    col: "NHÀ XE NGOÀI",    kw: ["nhà xe", "nha xe"] },
  { key: "extFee",       col: "CƯỚC XE NGOÀI",   kw: ["cước xe", "cuoc xe"], money: true },
  { key: "infoNote",     col: "GHI CHÚ LÔ HÀNG", kw: ["ghi chú", "ghi chu"] },
];
export const UPD_COLS = UPD_FIELDS.map((f) => f.col);

// "2026-06-29T21:45" → "29/06/2026 21:45" (định dạng người dùng đọc/sửa trong Excel)
const dtOut = (iso) => {
  const s = String(iso || "");
  if (s.length < 16) return s.length >= 10 ? s.slice(0, 10).split("-").reverse().join("/") : "";
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;
};

// Dựng workbook "Xuất để cập nhật": ID + các cột sửa được, đổ sẵn giá trị hiện tại.
// c = cfg (danh mục Cài đặt) → kèm các sheet GIÁ TRỊ HỢP LỆ cho mọi cột có ánh xạ danh mục,
// vì import chặn giá trị ngoài danh mục — người sửa file phải tra được ngay trong file.
export function buildUpdateWb(list, c) {
  c = c || {};
  const val = (s, k) => {
    if (k === "id") return s.id;
    if (k === "infoNote") return s.infoNote || "";
    if (k === "raMode") return ({ self: "Không cắt móc", other: "Cont khác ra", none: "Không kéo ra" })[s.raMode || "self"] || "";
    // Số cont ra hộ lấy thẳng từ payload (raOtherContNo), KHÔNG tra theo id trong `list`:
    // lô ra hộ đã ra rồi nên thường không nằm trong tập xuất → tra theo id là ra ô trống.
    if (k === "raOtherContNo") return s.raMode === "other" ? (s.raOtherContNo || "") : "";
    // Giờ ra HIỆU LỰC theo kiểu ra (self→cont này · other→cont ra hộ · none→xe) — backend tính sẵn, cũng là giờ Free time.
    if (k === "gioXeRa") return s.gioXeRaEff || "";
    if (k === "bksRa") return s.raMode === "other" ? (s.raOtherBksRa || "") : (s.bksRa || "");
    const v = s[k];
    return v == null ? "" : v;
  };
  const data = (list || []).map((s) => {
    const o = {};
    for (const f of UPD_FIELDS) {
      const v = val(s, f.key);
      // Tiền xuất ra dạng SỐ để Excel tính/sửa được (rỗng nếu chưa có, không ghi 0 gây nhầm).
      o[f.col] = f.dt ? dtOut(v)
        : f.date ? (String(v).length >= 10 ? String(v).slice(0, 10).split("-").reverse().join("/") : "")
        : (f.money ? (String(v).replace(/[^\d]/g, "") ? +String(v).replace(/[^\d]/g, "") : "") : v);
    }
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: UPD_COLS });
  ws["!cols"] = UPD_COLS.map((c) => ({ wch: Math.max(12, c.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cập nhật lô");

  const guide = [
    { "Quy tắc": "Cột ID", "Ý nghĩa": "KHÓA khớp lô — ĐỪNG sửa, đừng xóa cột này. Xóa ID thì hệ thống khớp theo SỐ CONT (cont trùng nhiều lô sẽ báo lỗi)" },
    { "Quy tắc": "KHÁCH HÀNG / SỐ BOOKING (không sửa)", "Ý nghĩa": "Chỉ để bạn nhận ra dòng nào là lô nào — hệ thống KHÔNG đọc 2 cột này, sửa cũng không có tác dụng. Đổi khách/booking thì mở popup lô" },
    { "Quy tắc": "File này chỉ CẬP NHẬT", "Ý nghĩa": "Không tạo lô mới. Dòng không khớp lô nào sẽ báo lỗi — muốn thêm lô thì dùng nút Import lô" },
    { "Quy tắc": "Ô để trống", "Ý nghĩa": "GIỮ NGUYÊN giá trị đang có — không xóa dữ liệu" },
    { "Quy tắc": `Gõ ${CLEAR_TOKEN}`, "Ý nghĩa": "XÓA giá trị của ô đó" },
    { "Quy tắc": "Ngày giờ", "Ý nghĩa": "Cột giờ: dd/mm/yyyy HH:MM (vd 29/06/2026 21:45) · Cột ngày: dd/mm/yyyy" },
    { "Quy tắc": "KIỂU RA", "Ý nghĩa": "3 giá trị: Không cắt móc (xe vào kéo luôn cont này ra) · Cont khác ra (cắt móc, xe kéo cont khác ra) · Không kéo ra (cắt móc, xe ra tay không). Để trống = giữ nguyên" },
    { "Quy tắc": "SỐ CONT RA (CẮT MÓC)", "Ý nghĩa": "Chỉ khi KIỂU RA = Cont khác ra: số cont của lô ra thay. Hệ thống tìm theo 2 điều kiện — đúng số cont VÀ lô đó CHƯA RA (booking nào cũng được) — rồi tự gán liên kết. Gõ -- = bỏ liên kết" },
    { "Quy tắc": "GIỜ XE RA", "Ý nghĩa": "Hiểu theo KIỂU RA, giống ô nhập trong popup: Không cắt móc → giờ ra của chính cont này · Cont khác ra → giờ ra của CONT RA HỘ (ghi sang lô cont đó) · Không kéo ra → giờ xe (đầu kéo) rời đi. Đây cũng là giờ tính Free time" },
    { "Quy tắc": "BKS RA", "Ý nghĩa": "Cũng hiểu theo KIỂU RA như GIỜ XE RA. Để trống mà có điền giờ ra → tự lấy BKS VÀO (xe vào chính là xe ra). Chỉ gõ khi xe ra là xe khác" },
    { "Quy tắc": "Tờ khai", "Ý nghĩa": "KHÔNG sửa ở file này — 1 lô có thể nhiều tờ khai, mỗi tờ khai một phí mở, nên có luồng riêng: nút Cập nhật tờ khai ở trang Lô hàng" },
    { "Quy tắc": "CƯỚC XE NGOÀI", "Ý nghĩa": "Chỉ dùng khi thuê xe ngoài — ghi vào dòng chi phí Cước xe ngoài của lô (các khoản chi phí khác không bị đụng). Phải có NHÀ XE NGOÀI mới nhập được cước" },
    { "Quy tắc": "Cột ánh xạ danh mục", "Ý nghĩa": "Nơi lấy · Nơi hạ · Kho · Loại cont · Nhà xe ngoài · BKS vào/ra — chỉ nhận giá trị CÓ SẴN trong danh mục Cài đặt (xem các sheet hợp lệ trong file này). Sai là báo lỗi, hệ thống KHÔNG tự thêm" },
    { "Quy tắc": "Nơi hạ sà lan", "Ý nghĩa": "TÊN hoặc KÝ HIỆU địa điểm có mã HPP/LHP (sheet Sà lan hợp lệ)" },
    { "Quy tắc": "Cột nhập tự do", "Ý nghĩa": "Số cont · Invoice · Ghi chú · Cước xe ngoài · các cột giờ — không ràng buộc danh mục" },
    { "Quy tắc": "Kiểm tra trước", "Ý nghĩa": "Hệ thống liệt kê từng ô cũ → mới để bạn duyệt; 1 dòng lỗi là KHÔNG ghi gì cả" },
    { "Quy tắc": "Không sửa được ở đây", "Ý nghĩa": "Khách hàng, số lượng, chi phí, doanh thu — sửa trong popup lô hoặc luồng riêng" },
  ];
  const wg = XLSX.utils.json_to_sheet(guide, { header: ["Quy tắc", "Ý nghĩa"] });
  wg["!cols"] = [{ wch: 42 }, { wch: 78 }];
  XLSX.utils.book_append_sheet(wb, wg, "Hướng dẫn");

  // ---- Sheet GIÁ TRỊ HỢP LỆ: mỗi cột ánh xạ danh mục đều phải tra được ngay trong file ----
  const addSheet = (name, rows, header, widths) => {
    if (!rows.length) return;
    const ws2 = XLSX.utils.json_to_sheet(rows, { header });
    ws2["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws2, name);
  };
  const locCode = c.locationCode || {};
  const whCode = c.warehouseCode || {};
  addSheet("Địa điểm hợp lệ", (c.locations || []).map((n) => ({ "Tên địa điểm": n, "Ký hiệu": locCode[n] || "" })),
    ["Tên địa điểm", "Ký hiệu"], [32, 14]);
  addSheet("Kho hợp lệ", (c.warehouses || []).map((n) => ({ "Tên kho": n, "Ký hiệu": whCode[n] || "" })),
    ["Tên kho", "Ký hiệu"], [28, 14]);
  addSheet("Loại cont hợp lệ", (c.contTypes || []).map((n) => ({ "Loại cont": n })), ["Loại cont"], [16]);
  addSheet("Nhà xe ngoài hợp lệ", (c.extVendors || []).map((n) => ({ "Đơn vị xe ngoài": n })), ["Đơn vị xe ngoài"], [34]);
  addSheet("Biển số hợp lệ", (c.vehicles || []).map((n) => ({ "Biển số": n })), ["Biển số"], [18]);
  addSheet("Kiểu ra hợp lệ", [
    { "Giá trị": "Không cắt móc", "Ý nghĩa": "Xe vào kéo luôn chính cont này ra (mặc định) — GIỜ XE RA / BKS RA là của cont này" },
    { "Giá trị": "Cont khác ra", "Ý nghĩa": "Cắt móc, xe kéo cont khác ra — điền SỐ CONT RA (CẮT MÓC); GIỜ XE RA / BKS RA ghi cho cont đó" },
    { "Giá trị": "Không kéo ra", "Ý nghĩa": "Cắt móc, xe ra tay không — GIỜ XE RA là giờ xe (đầu kéo) rời đi, cont vẫn chưa ra" },
  ], ["Giá trị", "Ý nghĩa"], [20, 55]);
  addSheet("Sà lan hợp lệ", (c.locations || []).filter((n) => BARGE_DROPS.includes(locCode[n])).map((n) => ({ "Tên địa điểm": n, "Ký hiệu": locCode[n] || "" })), ["Tên địa điểm", "Ký hiệu"], [22, 10]);
  return wb;
}

// Parse sheet cập nhật → [{ line, id, contNo, values:{field:giá trị}, raws:{field:chữ gốc} }].
// Chỉ gửi ô CÓ nội dung (ô trống = giữ nguyên nên không cần gửi).
export function parseUpdateRows(wb, sheetName) {
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
  let hi = aoa.findIndex((r) => (r || []).some((c) => { const h = normH(c); return h === "id" || h.includes("cont"); }));
  if (hi < 0) hi = 0;
  const header = (aoa[hi] || []).map(normH);
  // Ưu tiên khớp CHÍNH XÁC tiêu đề (file do hệ thống xuất), rồi mới tới từ khóa (file ngoài).
  const used = new Set();
  const C = {};
  for (const f of UPD_FIELDS) {
    let idx = header.findIndex((h, i) => !used.has(i) && h === normH(f.col));
    if (idx < 0) idx = header.findIndex((h, i) => !used.has(i) && f.kw.some((k) => h.includes(k)));
    if (idx >= 0) { C[f.key] = idx; used.add(idx); }
  }
  const out = [];
  for (let r = hi + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const cell = (i) => (i == null || i < 0 ? null : row[i]);
    const text = (i) => { const v = cell(i); return v instanceof Date ? "" : String(v == null ? "" : v).trim(); };
    const id = text(C.id).replace(/[^\d]/g, "");
    const contNo = text(C.contNo);
    if (!id && !contNo) continue;   // dòng trắng

    const values = {}; const raws = {};
    for (const f of UPD_FIELDS) {
      if (f.key === "id" || f.ro || C[f.key] == null) continue;   // cột khóa + cột chỉ đọc: không gửi lên
      const v = cell(C[f.key]);
      const raw = v instanceof Date ? "" : String(v == null ? "" : v).trim();
      if (v instanceof Date || (typeof v === "number" && (f.dt || f.date))) {
        // ô ngày thật của Excel
        const d = cellDate(v); const t = cellTime(v);
        values[f.key] = d.iso ? (f.date ? d.iso : `${d.iso}T${t || "00:00"}`) : "";
        raws[f.key] = d.display || String(v);
        if (!values[f.key]) values[f.key] = raws[f.key];   // để backend báo sai định dạng
        continue;
      }
      if (raw === "") continue;
      if (raw.startsWith("(")) continue;   // ô chỉ dẫn kiểu "(xem sheet Tờ khai)" — không phải dữ liệu
      if (raw === CLEAR_TOKEN) { values[f.key] = CLEAR_TOKEN; continue; }
      if (f.money) { values[f.key] = raw.replace(/[^\d]/g, ""); raws[f.key] = raw; continue; }   // tiền: chỉ giữ chữ số
      if (f.dt || f.date) {
        const d = cellDate(raw); const t = cellTime(raw);
        values[f.key] = d.iso ? (f.date ? d.iso : `${d.iso}T${t || "00:00"}`) : raw;   // không parse được → gửi nguyên để backend báo lỗi
        raws[f.key] = raw;
        continue;
      }
      values[f.key] = raw;
    }
    out.push({ line: r + 1, id, contNo, values, raws });
  }

  return out;
}

// ===================== CẬP NHẬT TỜ KHAI (luồng riêng) =====================
// 1 lô nhiều tờ khai, mỗi tờ khai 1 phí mở → mỗi TỜ KHAI là 1 dòng, mỗi ô đúng 1 giá trị.
// Tách khỏi file cập nhật lô để không phải nhồi danh sách vào 1 ô (dấu phẩy đụng dấu phân cách nghìn).
export const DECL_COLS = ["ID LÔ", "SỐ CONT (không sửa)", "KHÁCH HÀNG (không sửa)", "SỐ TỜ KHAI", "PHÍ MỞ TỜ KHAI"];

// Dựng workbook "Xuất tờ khai": mỗi tờ khai 1 dòng; lô CHƯA có tờ khai vẫn có 1 dòng trống để điền.
export function buildDeclarationWb(list) {
  const rows = [];
  for (const s of (list || [])) {
    const base = { "ID LÔ": s.id, "SỐ CONT (không sửa)": s.contNo || "", "KHÁCH HÀNG (không sửa)": s.customer || "" };
    const ds = Array.isArray(s.declarations) ? s.declarations : [];
    if (!ds.length) { rows.push({ ...base, "SỐ TỜ KHAI": "", "PHÍ MỞ TỜ KHAI": "" }); continue; }
    for (const d of ds) {
      const fee = String(d.fee || "").replace(/[^\d]/g, "");
      rows.push({ ...base, "SỐ TỜ KHAI": d.no || "", "PHÍ MỞ TỜ KHAI": fee ? +fee : "" });
    }
  }
  const ws = XLSX.utils.json_to_sheet(rows, { header: DECL_COLS });
  ws["!cols"] = [{ wch: 9 }, { wch: 20 }, { wch: 24 }, { wch: 22 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tờ khai");
  const guide = [
    { "Quy tắc": "Cột ID LÔ", "Ý nghĩa": "KHÓA khớp lô — đừng sửa. Một lô nhiều tờ khai thì lặp lại ID ở nhiều dòng" },
    { "Quy tắc": "Thêm tờ khai", "Ý nghĩa": "Chèn dòng mới, điền ID LÔ + SỐ TỜ KHAI + PHÍ MỞ TỜ KHAI" },
    { "Quy tắc": "Sửa phí", "Ý nghĩa": "Sửa thẳng ô PHÍ MỞ TỜ KHAI của dòng đó (mỗi ô 1 số, gõ 250000 hay 250.000 đều được)" },
    { "Quy tắc": "Xóa 1 tờ khai", "Ý nghĩa": "Xóa dòng đó đi — các tờ khai còn lại của lô vẫn giữ" },
    { "Quy tắc": `Xóa HẾT tờ khai của 1 lô`, "Ý nghĩa": `Để lại 1 dòng của lô đó và gõ ${CLEAR_TOKEN} ở ô SỐ TỜ KHAI` },
    { "Quy tắc": "Lô không đụng tới", "Ý nghĩa": "Giữ nguyên dòng (hoặc xóa khỏi file) — chỉ lô có mặt trong file mới bị ghi" },
    { "Quy tắc": "Phí mở tờ khai", "Ý nghĩa": "Tổng phí các tờ khai của lô tự vào chi phí lô ở khoản Phí mở tờ khai" },
    { "Quy tắc": "Kiểm tra trước", "Ý nghĩa": "Hệ thống liệt kê từng lô cũ → mới để bạn duyệt; 1 dòng lỗi là KHÔNG ghi gì cả" },
  ];
  const wg = XLSX.utils.json_to_sheet(guide, { header: ["Quy tắc", "Ý nghĩa"] });
  wg["!cols"] = [{ wch: 30 }, { wch: 84 }];
  XLSX.utils.book_append_sheet(wb, wg, "Hướng dẫn");
  return wb;
}

// Parse sheet tờ khai → gom theo lô: [{ line, id, values: { declPairs: [{no, fee}] } }].
// Gửi lên CÙNG endpoint cập nhật lô (backend đã hiểu declPairs).
export function parseDeclarationRows(wb, sheetName) {
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
  let hi = aoa.findIndex((r) => (r || []).some((c) => normH(c).includes("id")));
  if (hi < 0) hi = 0;
  const header = (aoa[hi] || []).map(normH);
  const col = (...kws) => header.findIndex((h) => kws.some((k) => h.includes(k)));
  const cId = col("id"), cNo = col("số tờ khai", "so to khai", "tờ khai"), cFee = col("phí", "phi");

  const byId = {}; const lineOf = {};
  for (let r = hi + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const g = (i) => (i < 0 ? "" : String(row[i] == null ? "" : row[i]).trim());
    const id = g(cId).replace(/[^\d]/g, "");
    if (!id) continue;
    const no = g(cNo);
    if (lineOf[id] == null) lineOf[id] = r + 1;
    if (!byId[id]) byId[id] = [];
    if (no === CLEAR_TOKEN) { byId[id] = "clear"; continue; }      // xóa hết tờ khai của lô
    if (no === "" || byId[id] === "clear") continue;               // dòng trống = lô chưa có tờ khai
    byId[id].push({ no, fee: g(cFee).replace(/[^\d]/g, "") });
  }
  return Object.entries(byId)
    .filter(([, v]) => v === "clear" || v.length)                  // lô không điền gì → không gửi
    .map(([id, v]) => ({ line: lineOf[id], id, contNo: "", raws: {}, values: { declPairs: v === "clear" ? [] : v } }));
}

// Đếm dòng có dữ liệu (hiện số trước khi gửi kiểm tra).
export const updRowCount = (rows) => (rows || []).length;
