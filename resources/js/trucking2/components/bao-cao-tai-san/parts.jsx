import React from "react";
import { fmtVND, fmtShort } from "@trk/lib.jsx";
export { card, pctOf, CardTitle, Delta, KPI, Empty, SplitBar } from "@trk/components/report-ui.jsx";

/* Mảnh dùng chung cho 3 tab Báo cáo tài sản: hằng số cột, chọn tháng/năm, ô KPI, chênh lệch kỳ trước, badge. */

const B = (window.__TRK || {}).boot || {};

export const COLS = [
  { k: "costNormal", label: "Chi phí thường", color: "#2a6fdb", hint: "Phiếu chi không phân bổ · theo Ngày chi" },
  { k: "costAlloc", label: "Chi phí phân bổ", color: "#9333ea", hint: "Phần phân bổ rơi vào kỳ (Số tiền ÷ số tháng)" },
  { k: "deprec", label: "Khấu hao", color: "#e08600", hint: "Nguyên giá ÷ (30 × số tháng) × số ngày trong kỳ" },
];

export const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const ymLabel = (ym) => { if (!ym) return ""; const p = String(ym).split("-"); return p.length === 2 ? `${p[1]}/${p[0]}` : String(ym); };
const ymSplit = (ym) => { const p = String(ym || "").split("-"); return [p[0] || String(new Date().getFullYear()), p[1] || "01"]; };
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
// NĂM lấy theo dữ liệu thật (boot.years: mới → cũ); fallback năm hiện tại.
const YEARS = (B.years && B.years.length ? B.years : [new Date().getFullYear()]).map(String);

const selBox = { appearance: "none", WebkitAppearance: "none", padding: "7px 24px 7px 10px", fontSize: 13, fontWeight: 700, border: "1px solid var(--line)", borderRadius: 9, background: "#fff", cursor: "pointer", color: "var(--ink)" };
const chev = { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none", fontSize: 10 };

/* Chọn THÁNG + NĂM riêng (thay vì 1 select dài liệt kê từng tháng) */
export function MonthYear({ value, onChange }) {
  const [y, m] = ymSplit(value);
  const years = YEARS.includes(y) ? YEARS : [y, ...YEARS];   // giữ năm đang chọn dù ngoài danh sách
  return (
    <span style={{ display: "inline-flex", gap: 5 }}>
      <span style={{ position: "relative" }}>
        <select value={m} onChange={(e) => onChange(`${y}-${e.target.value}`)} style={selBox} title="Tháng">
          {MONTHS.map((o) => <option key={o} value={o}>Th {o}</option>)}
        </select>
        <span style={chev}><i className="bi bi-chevron-down" /></span>
      </span>
      <span style={{ position: "relative" }}>
        <select value={y} onChange={(e) => onChange(`${e.target.value}-${m}`)} style={selBox} title="Năm">
          {years.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <span style={chev}><i className="bi bi-chevron-down" /></span>
      </span>
    </span>
  );
}

export function KindBadge({ kind }) {
  const asset = kind === "asset";
  return <span style={{ fontSize: 10, fontWeight: 700, color: asset ? "#7c5b16" : "var(--accent)", background: asset ? "#fbf0d3" : "var(--accent-weak)", padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>{asset ? "Tài sản" : "Xe"}</span>;
}

/* Deep-link hồ sơ ở trang Quản lý tài sản: xe = #<hashid>/<tab> (info|deprec|cost…); tài sản = #asset/<hashid> (mở tab Chi phí). */
export const fleetLink = (fleetUrl, row, section = "cost") =>
  fleetUrl + "#" + (row.kind === "asset" ? "asset/" + row.hashid : row.hashid + "/" + section);

/* Tên xe/tài sản: biển số (hoặc mã) + tên phụ + badge + link hồ sơ */
export function AssetName({ row, fleetUrl, section = "cost" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flexWrap: "wrap" }}>
      <b className="tnum">{row.plate}</b>
      {row.name && row.name !== row.plate && <span style={{ fontSize: 11.5, color: "var(--ink-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{row.name}</span>}
      <KindBadge kind={row.kind} />
      {fleetUrl && <a href={fleetLink(fleetUrl, row, section)} onClick={(e) => e.stopPropagation()} title="Mở hồ sơ" className="ke-noprint" style={{ color: "var(--accent)", fontSize: 11 }}><i className="bi bi-box-arrow-up-right" /></a>}
    </div>
  );
}

/* Thanh tỉ lệ 3 nhóm (thường / phân bổ / khấu hao) */
export function MiniBar({ row, height = 6, minWidth = 90 }) {
  const t = row.total || 1;
  return (
    <div style={{ display: "flex", height, borderRadius: 999, overflow: "hidden", background: "var(--line-2)", minWidth }}>
      {COLS.map((c) => { const w = (row[c.k] || 0) * 100 / t; return w > 0 ? <div key={c.k} title={`${c.label}: ${fmtVND(row[c.k])}`} style={{ width: w + "%", background: c.color }} /> : null; })}
    </div>
  );
}

export const shortMoney = (n) => (n ? fmtShort(n) : "0");
