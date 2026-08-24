// Xuất Excel BẢNG GIÁ (1 price book) — data vào → workbook ra, không đụng React state.
// Dùng XLSX global (nạp sẵn ở blade bang-gia).

export const PRICE_COLS = ["ĐIỂM HẠ", "TRẠNG THÁI", "KIND", "FROM", "TO", "TO 2", "TO 3", "TO 4", "KM", "CƯỚC 40FT", "CƯỚC 20FT", "DẦU 40FT", "DẦU 20FT"];

const num = (v) => { const d = String(v == null ? "" : v).replace(/[^\d]/g, ""); return d ? +d : ""; };
// Bỏ ký tự Excel cấm trong tên sheet + cắt 31 ký tự.
const safeSheet = (s) => (String(s || "Bảng giá").replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Bảng giá");

/** Dựng workbook bảng giá: 1 dòng = 1 tuyến, sắp theo Điểm hạ → Trạng thái → KIND (giữ thứ tự trong nhóm). */
export function buildPriceBookWb(rows, meta = {}) {
  const list = (rows || []).map((r, i) => ({ r, i }));
  const key = (r) => [r.loc || "", r.conn || "Connect", r.kind || "Chưa phân nhóm"];
  list.sort((a, b) => {
    const ka = key(a.r), kb = key(b.r);
    for (let n = 0; n < ka.length; n++) { const c = ka[n].localeCompare(kb[n], "vi"); if (c) return c; }
    return a.i - b.i;   // ổn định: giữ thứ tự gốc trong cùng nhóm
  });
  const data = list.map(({ r }) => ({
    "ĐIỂM HẠ": r.loc || "",
    "TRẠNG THÁI": r.conn || "Connect",
    "KIND": r.kind || "Chưa phân nhóm",
    "FROM": r.from || "",
    "TO": r.to1 || "",
    "TO 2": r.to2 || "",
    "TO 3": r.to3 || "",
    "TO 4": r.to4 || "",
    "KM": num(r.distance),
    "CƯỚC 40FT": num(r.transFee40),
    "CƯỚC 20FT": num(r.transFee20),
    "DẦU 40FT": num(r.fuelFee40),
    "DẦU 20FT": num(r.fuelFee20),
  }));
  const ws = XLSX.utils.json_to_sheet(data, { header: PRICE_COLS });
  ws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 38 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  if (data.length) {
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: PRICE_COLS.length - 1 } }) };
    // Cột tiền hiện dấu phân cách nghìn (dữ liệu vẫn là SỐ để Excel tính được).
    for (let i = 0; i < data.length; i++) {
      for (let c = 9; c <= 12; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c })];
        if (cell && cell.t === "n") cell.z = "#,##0";
      }
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, safeSheet(meta.sheetName));

  // Sheet thông tin: bảng giá này của khách nào, áp dụng khoảng ngày nào — để file rời vẫn tra được nguồn.
  const info = [
    { "Mục": "Khách hàng", "Giá trị": meta.customer || "" },
    { "Mục": "Bảng giá", "Giá trị": meta.label || "" },
    { "Mục": "Khoảng ngày áp dụng", "Giá trị": meta.range || "Mọi ngày" },
    { "Mục": "Số tuyến", "Giá trị": data.length },
    { "Mục": "Ngày xuất", "Giá trị": meta.exportedAt || "" },
    { "Mục": "Ghi chú", "Giá trị": "File để XEM/đối chiếu. Sửa giá thì sửa trên trang Bảng giá — file này không import ngược lại được." },
  ];
  const wi = XLSX.utils.json_to_sheet(info, { header: ["Mục", "Giá trị"] });
  wi["!cols"] = [{ wch: 24 }, { wch: 76 }];
  XLSX.utils.book_append_sheet(wb, wi, "Thông tin");
  return wb;
}
