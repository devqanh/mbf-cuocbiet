import React from "react";
const { useState, useEffect, useRef } = React;
import { I, Money, Num, Txt, Combo, DateField, Btn, Modal, fmtVND, fmtNum, fmtDate, toNum, useIsMobile } from "@trk/lib.jsx";
import { ChkBox } from "@trk/pop.jsx";

const num = (v) => parseFloat((v ?? "").toString().replace(/[^\d.-]/g, "")) || 0;
const daysUsed = (iso) => { if (!iso) return 0; const s = new Date(iso + "T00:00:00"); const now = new Date(); const d = Math.floor((now - s) / 86400000); return d > 0 ? d : 0; };
const COST_KINDS = [["fixed", "Cố định"], ["recurring", "Định kỳ"]];
const normKind = (k) => (k === "fixed" ? "fixed" : "recurring");   // gộp monthly/yearly cũ → recurring
const TAB_KEYS = ["info", "allowance", "deprec", "deprecMonthly", "usage", "cost", "fuel"];
const SECTION_OF = { deprec: "depreciations", deprecMonthly: "depreciations", usage: "usages", cost: "costs" };   // tab → nhóm lazy-load (allowance + info nằm trong base; fuel lazy riêng)

// Ngưỡng cảnh báo "sắp hết hạn" (số ngày) — cấu hình ở Cài đặt → Cấu hình chung
const WARN_DAYS = (() => { try { const n = parseInt((window.__TRK || {}).boot?.dueWarnDays, 10); return n > 0 ? n : 30; } catch (e) { return 30; } })();
// Trạng thái hạn (đăng kiểm / bảo hiểm / bảo hành / kiểm định): chưa có < còn hạn < sắp hết < hết hạn
const DUE_NONE = { key: "none", label: "Chưa có", color: "var(--ink-4)", bg: "var(--line-2)", rank: 0 };
const dueStatus = (iso) => {
  if (!iso) return DUE_NONE;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return DUE_NONE;
  const days = Math.floor((d - today) / 86400000);
  if (days < 0) return { key: "expired", label: "Hết hạn", color: "var(--danger)", bg: "#fce8e8", rank: 3, days };
  if (days <= WARN_DAYS) return { key: "soon", label: "Sắp hết hạn", color: "var(--warn)", bg: "#fcf3e2", rank: 2, days };
  return { key: "ok", label: "Còn hạn", color: "var(--good)", bg: "var(--good-weak)", rank: 1, days };
};
const vehRank = (v) => Math.max(dueStatus(v.registrationDue).rank, dueStatus(v.insuranceDue).rank);
// Ô hạn trong bảng: ngày + chip trạng thái
const DueCell = ({ iso }) => {
  const s = dueStatus(iso);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span className="tnum" style={{ fontSize: 12.5, color: iso ? "var(--ink-2)" : "var(--ink-4)" }}>{iso ? fmtDate(iso) : "—"}</span>
      <span style={{ alignSelf: "flex-start", fontSize: 11, fontWeight: 700, color: s.color, background: s.bg, padding: "1px 8px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 4 }}>
        {s.key === "expired" && <i className="bi bi-exclamation-triangle-fill" />}
        {s.key === "soon" && <i className="bi bi-clock-fill" />}
        {s.label}{s.key === "soon" && s.days != null ? ` · ${s.days}n` : ""}
      </span>
    </div>
  );
};

// Chip thống kê nhỏ: icon + số + tooltip (0 thì mờ) — cho cột Khấu hao/Chi phí/Lượt
const StatChip = ({ icon, n, title }) => (
  <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: n > 0 ? "var(--ink-2)" : "var(--ink-4)" }}>
    <i className={"bi " + icon} style={{ fontSize: 13, opacity: n > 0 ? 0.85 : 0.45 }} />{n || 0}
  </span>
);

const lbl = (t) => <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 4, fontWeight: 500 }}>{t}</div>;
const card = { border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", background: "#fafbfc" };
const delBtn = (onClick) => (
  <button type="button" onClick={onClick} title="Xóa"
    style={{ flexShrink: 0, width: 34, height: 34, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 9, background: "#fff", color: "var(--ink-4)", cursor: "pointer" }}
    onMouseEnter={(e) => { e.currentTarget.style.background = "#fce8e8"; e.currentTarget.style.color = "var(--danger)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "var(--ink-4)"; }}><I.trash /></button>
);
const addBtn = (onClick, text) => (
  <button type="button" onClick={onClick}
    style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, border: "1px dashed var(--accent)", borderRadius: 10, background: "var(--accent-weak-2)", color: "var(--accent)", cursor: "pointer" }}>
    <I.plus /> {text}
  </button>
);

/* Phân trang client-side dùng chung (Xe / Tài sản) — hiện X–Y/Tổng + nút trang. */
function Pager({ page, perPage, total, onPage }) {
  const last = Math.max(1, Math.ceil(total / perPage));
  if (last <= 1) return null;
  const from = total ? (page - 1) * perPage + 1 : 0, to = Math.min(total, page * perPage);
  const nums = [];
  const win = 2;   // số trang quanh trang hiện tại
  for (let p = 1; p <= last; p++) { if (p === 1 || p === last || (p >= page - win && p <= page + win)) nums.push(p); else if (nums[nums.length - 1] !== "…") nums.push("…"); }
  const btn = (label, p, dis, on) => (
    <button type="button" key={label + p} disabled={dis} onClick={() => !dis && onPage(p)}
      style={{ minWidth: 30, height: 30, padding: "0 8px", border: "1px solid " + (on ? "var(--accent)" : "var(--line)"), borderRadius: 8, background: on ? "var(--accent)" : "#fff", color: on ? "#fff" : (dis ? "var(--ink-4)" : "var(--ink-2)"), cursor: dis ? "default" : "pointer", fontSize: 12.5, fontWeight: 600 }}>{label}</button>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--line-2)", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, color: "var(--ink-4)" }} className="tnum">{from}–{to} / {total}</span>
      <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        {btn("‹", page - 1, page <= 1, false)}
        {nums.map((n, i) => n === "…" ? <span key={"d" + i} style={{ color: "var(--ink-4)", padding: "0 2px" }}>…</span> : btn(String(n), n, false, n === page))}
        {btn("›", page + 1, page >= last, false)}
      </div>
    </div>
  );
}

/* ---- Tab: Thông tin xe / Khấu hao ---- */
function DeprecTab({ rows, onChange }) {
  const set = (i, np) => onChange(rows.map((r, j) => (j === i ? { ...r, ...np } : r)));
  const add = () => onChange([...(rows || []), { id: Date.now() + Math.random(), name: "", origPrice: "", startDate: "", months: "" }]);
  const del = (i) => onChange(rows.filter((_, j) => j !== i));
  let totalAccrued = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5 }}>
        Khấu hao/ngày = <b>Nguyên giá ÷ (30 × số tháng)</b>. Đã khấu hao = khấu hao/ngày × số ngày sử dụng (từ ngày bắt đầu đến hôm nay, tối đa hết kỳ).
      </div>
      {(rows || []).length === 0 && <div style={{ padding: "12px 2px", fontSize: 12.5, color: "var(--ink-4)" }}>Chưa có hạng mục khấu hao — bấm <b>+ Thêm hạng mục</b>.</div>}
      {(rows || []).map((r, i) => {
        const orig = num(r.origPrice), months = num(r.months);
        const perDay = months > 0 && orig > 0 ? orig / (30 * months) : 0;
        const totalDays = 30 * months;
        const used = Math.min(daysUsed(r.startDate), totalDays || Infinity);
        const accrued = Math.round(perDay * used);
        const remain = Math.max(0, Math.round(orig - accrued));
        totalAccrued += accrued;
        return (
          <div key={r.id || i} style={card}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>{lbl("Tên hạng mục khấu hao")}<Txt value={r.name} onChange={(x) => set(i, { name: x })} placeholder="VD: Khấu hao đầu kéo" /></div>
              {delBtn(() => del(i))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <div>{lbl("Nguyên giá")}<Money value={r.origPrice} onChange={(x) => set(i, { origPrice: x })} dim /></div>
              <div>{lbl("Ngày bắt đầu sử dụng")}<DateField value={r.startDate} onChange={(x) => set(i, { startDate: x })} /></div>
              <div>{lbl("Số tháng khấu hao")}<Num value={r.months} onChange={(x) => set(i, { months: x })} suffix="tháng" /></div>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 12, color: "var(--ink-3)" }} className="tnum">
              <span>Khấu hao/ngày: <b style={{ color: "var(--ink-2)" }}>{fmtNum(Math.round(perDay))} đ</b></span>
              <span>Số ngày đã dùng: <b style={{ color: "var(--ink-2)" }}>{used || 0}</b>{totalDays ? " / " + totalDays : ""}</span>
              <span>Đã khấu hao: <b style={{ color: "var(--accent)" }}>{fmtNum(accrued)} đ</b></span>
              <span>Còn lại: <b style={{ color: "var(--ink-2)" }}>{fmtNum(remain)} đ</b></span>
            </div>
          </div>
        );
      })}
      {(rows || []).length > 0 && <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700 }} className="tnum">Tổng đã khấu hao: <span style={{ color: "var(--accent)" }}>{fmtVND(totalAccrued)}</span></div>}
      {addBtn(add, "Thêm hạng mục")}
    </div>
  );
}

/* ---- Tab: Theo dõi khấu hao THEO THÁNG (read-only) — gom theo NĂM, CHỈ tính đến tháng hiện tại ---- */
const DmStat = ({ label, val, color }) => (
  <div style={{ flex: 1, minWidth: 150, background: "#fff", border: "1px solid var(--line)", borderRadius: 11, padding: "11px 14px" }}>
    <div style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em" }}>{label}</div>
    <div className="tnum" style={{ fontSize: 18, fontWeight: 800, marginTop: 3, color }}>{val}</div>
  </div>
);
function DeprecMonthlyTab({ rows }) {
  const ymOf = (iso) => { const p = (iso || "").split("-"); return p.length >= 2 ? parseInt(p[0], 10) * 12 + (parseInt(p[1], 10) - 1) : null; };
  const mLabel = (idx) => String(idx % 12 + 1).padStart(2, "0");
  const items = (rows || []).filter((r) => num(r.origPrice) > 0 && num(r.months) > 0 && ymOf(r.startDate) !== null);
  if (!items.length) return <div style={{ padding: "14px 2px", fontSize: 12.5, color: "var(--ink-4)" }}>Chưa có hạng mục khấu hao nào (cần Nguyên giá + Ngày bắt đầu + Số tháng). Thêm ở tab <b>Khấu hao</b>.</div>;

  const nowIdx = ymOf(today10());
  // Khấu hao THEO NGÀY = Nguyên giá ÷ (30 × số tháng). Mỗi tháng = khấu hao/ngày × số NGÀY thực tế của tháng
  // nằm trong kỳ (từ ngày bắt đầu, tối đa 30 × số tháng ngày, chỉ tính tới hôm nay) → khớp tuyệt đối tab Khấu hao.
  const dOnly = (iso) => new Date(iso + "T00:00:00");
  const DAY = 86400000;
  const perMonth = {}; let totalOrig = 0;
  items.forEach((it) => {
    const orig = num(it.origPrice), months = num(it.months);
    totalOrig += orig;
    const perDay = orig / (30 * months);
    const usedTotal = Math.min(daysUsed(it.startDate), 30 * months);   // số ngày đã khấu hao (giống tab Khấu hao)
    if (usedTotal <= 0) return;
    const start = dOnly(it.startDate);
    const activeEnd = new Date(start.getTime() + usedTotal * DAY);      // hết ngày đã khấu hao (exclusive)
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);       // ngày 1 của tháng bắt đầu
    while (cur < activeEnd) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);  // ngày 1 tháng kế
      const from = start > cur ? start : cur;
      const to = activeEnd < next ? activeEnd : next;
      const days = Math.max(0, Math.round((to - from) / DAY));
      if (days > 0) { const idx = cur.getFullYear() * 12 + cur.getMonth(); perMonth[idx] = (perMonth[idx] || 0) + perDay * days; }
      cur = next;
    }
  });
  const idxs = Object.keys(perMonth).map(Number).sort((a, b) => a - b);
  const accNow = idxs.reduce((a, i) => a + perMonth[i], 0);
  const remain = Math.max(0, Math.round(totalOrig - accNow));
  const pct = totalOrig > 0 ? Math.min(100, Math.round(accNow * 100 / totalOrig)) : 0;
  const nowLabel = `${mLabel(nowIdx)}/${Math.floor(nowIdx / 12)}`;

  if (! idxs.length) return <div style={{ padding: "14px 2px", fontSize: 12.5, color: "var(--ink-4)" }}>Chưa phát sinh khấu hao đến tháng <b>{nowLabel}</b> (các hạng mục bắt đầu ở tương lai).</div>;

  // Gom theo NĂM, năm mới nhất lên trước.
  const byYear = {};
  idxs.forEach((i) => { const y = Math.floor(i / 12); (byYear[y] = byYear[y] || []).push(i); });
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <DmStat label="Nguyên giá" val={fmtVND(totalOrig)} color="var(--ink-1)" />
        <DmStat label={`Đã khấu hao đến ${nowLabel}`} val={fmtVND(Math.round(accNow))} color="var(--accent)" />
        <DmStat label="Giá trị còn lại" val={fmtVND(remain)} color="var(--good)" />
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--ink-4)", marginBottom: 4 }}><span>Tiến độ khấu hao</span><span className="tnum" style={{ fontWeight: 700, color: "var(--accent)" }}>{pct}%</span></div>
        <div style={{ height: 8, background: "var(--line-2)", borderRadius: 999, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: "var(--accent)", borderRadius: 999 }} /></div>
      </div>
      {years.map((y) => {
        const yIdxs = byYear[y];
        const yTotal = yIdxs.reduce((a, i) => a + perMonth[i], 0);
        return (
          <div key={y} style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: "#fafbfc", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}><i className="bi bi-calendar3" style={{ color: "var(--accent)", marginRight: 6 }} />Năm {y}</span>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Khấu hao trong năm: <b className="tnum" style={{ color: "var(--accent)" }}>{fmtVND(Math.round(yTotal))}</b></span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 8, padding: 12 }}>
              {yIdxs.map((i) => {
                const isNow = i === nowIdx;
                return (
                  <div key={i} style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid " + (isNow ? "var(--accent)" : "var(--line)"), background: isNow ? "var(--accent-weak-2)" : "#fff" }}>
                    <div style={{ fontSize: 11, color: isNow ? "var(--accent)" : "var(--ink-4)", fontWeight: 700 }} className="tnum">Tháng {mLabel(i)}{isNow ? " · nay" : ""}</div>
                    <div className="tnum" style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{fmtVND(Math.round(perMonth[i]))}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>Khấu hao <b>theo ngày</b> = Nguyên giá ÷ (30 × Số tháng); mỗi tháng cộng theo <b>số ngày thực tế</b> nằm trong kỳ (tháng hiện tại tính tới hôm nay). Khớp với tab <b>Khấu hao</b>.</div>
    </div>
  );
}

/* ---- Tab: Thời gian sử dụng xe ---- */
function UsageTab({ rows, onChange, drivers }) {
  const isMobile = useIsMobile();
  const set = (i, np) => onChange(rows.map((r, j) => (j === i ? { ...r, ...np } : r)));
  const add = () => onChange([...(rows || []), { id: Date.now() + Math.random(), driver: "", from: "", to: "", note: "" }]);
  const del = (i) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5 }}>Gán lái xe (danh mục Lái xe) theo khoảng thời gian dùng xe — để sau tính lương theo phí tuyến đường.</div>
      {(rows || []).length === 0 && <div style={{ padding: "12px 2px", fontSize: 12.5, color: "var(--ink-4)" }}>Chưa có lịch sử — bấm <b>+ Thêm lượt sử dụng</b>.</div>}
      {(rows || []).map((r, i) => (
        <div key={r.id || i} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 150px 150px 1fr 34px", gap: 10, alignItems: "end", ...card }}>
          <div>{lbl("Lái xe")}<Combo value={r.driver} onChange={(x) => set(i, { driver: x })} options={drivers || []} placeholder="Chọn lái xe…" /></div>
          <div>{lbl("Từ ngày")}<DateField value={r.from} onChange={(x) => set(i, { from: x })} /></div>
          <div>{lbl("Đến ngày")}<DateField value={r.to} onChange={(x) => set(i, { to: x })} /></div>
          <div>{lbl("Ghi chú")}<Txt value={r.note} onChange={(x) => set(i, { note: x })} placeholder="…" /></div>
          {delBtn(() => del(i))}
        </div>
      ))}
      {addBtn(add, "Thêm lượt sử dụng")}
    </div>
  );
}

/* ---- Tab: Chi phí — BẢNG hiển thị cột chính, bấm dòng → modal sửa, Thêm phiếu chi → modal ---- */
const today10 = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const blankCost = () => ({ id: Date.now() + Math.random(), name: "", invoiceNo: "", kind: "fixed", spendDate: today10(), dueDate: "", amount: "", currentKm: "", supplier: "", payer: "", material: false, alloc: false, allocMonths: "", note: "", paid: false, paidDate: "", paidMethod: "", paidRef: "", paidNote: "", approved: false });
const PAY_METHODS = ["Chuyển khoản", "Tiền mặt", "Khác"];

/* Modal DUYỆT THANH TOÁN — kế toán điền thông tin rồi mới duyệt */
function PayModal({ row, onConfirm, onClose, payMethods }) {
  const { useState } = React;
  const methods = (payMethods && payMethods.length) ? payMethods : PAY_METHODS;
  // amount = số THỰC TẾ chi (mặc định = số hiện có, vốn = dự kiến nếu phiếu từ yêu cầu chi). estAmount = dự kiến lái xe gửi.
  const [d, setD] = useState({ amount: row.amount || "", paidDate: row.paidDate || today10(), paidMethod: row.paidMethod || methods[0] || "Chuyển khoản", paidRef: row.paidRef || "", paidNote: row.paidNote || "" });
  const set = (np) => setD((x) => ({ ...x, ...np }));
  const [err, setErr] = useState("");
  const confirm = () => { if (toNum(d.amount) <= 0) return setErr("Vui lòng nhập số tiền thực tế (lớn hơn 0)."); setErr(""); onConfirm(d); };
  return (
    <Modal title="Duyệt thanh toán" subtitle={`${row.name || "(phiếu chi)"}${row.invoiceNo ? " · # " + row.invoiceNo : ""}`} width={560} icon={<I.check />} onClose={onClose}
      footer={<div style={{ display: "flex", justifyContent: "flex-end", gap: 10, width: "100%" }}><Btn onClick={onClose}>Hủy</Btn><Btn variant="primary" onClick={confirm}>Xác nhận đã thanh toán</Btn></div>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "6px 0 2px" }}>
        {err && <div style={{ gridColumn: "1 / -1", display: "flex", gap: 7, alignItems: "center", fontSize: 12.5, color: "#b42318", background: "#fdecec", border: "1px solid #f3c9c9", borderRadius: 9, padding: "8px 12px" }}><i className="bi bi-exclamation-triangle-fill" /> {err}</div>}
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Số tiền thực tế (chi)")}
          <Money value={d.amount} onChange={(x) => set({ amount: x })} dim />
          {row.estAmount != null && <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11.5, fontWeight: 600, color: "var(--accent)" }}>
            <i className="bi bi-receipt" /> Dự kiến lái xe gửi: <span className="tnum">{fmtVND(row.estAmount)}</span>
            {toNum(d.amount) !== toNum(row.estAmount) && <button type="button" onClick={() => set({ amount: row.estAmount })} style={{ border: "none", background: "transparent", color: "var(--ink-4)", cursor: "pointer", fontSize: 11, textDecoration: "underline", padding: 0 }}>dùng số này</button>}
          </div>}
        </div>
        <div>{lbl("Ngày thanh toán")}<DateField value={d.paidDate} onChange={(x) => set({ paidDate: x })} /></div>
        <div>{lbl("Hình thức")}
          <div style={{ display: "inline-flex", background: "#f1f2f4", borderRadius: 8, padding: 2, flexWrap: "wrap" }}>
            {methods.map((m) => { const on = (d.paidMethod || "") === m; return <button key={m} type="button" onClick={() => set({ paidMethod: m })} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 6, background: on ? "#fff" : "transparent", color: on ? "var(--accent)" : "var(--ink-4)", boxShadow: on ? "0 1px 2px rgba(16,19,23,.14)" : "none" }}>{m}</button>; })}
          </div>
        </div>
        <div>{lbl("Số chứng từ / UNC")}<Txt value={d.paidRef} onChange={(x) => set({ paidRef: x })} placeholder="VD: UNC-2026-0123" /></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Ghi chú kế toán")}<Txt value={d.paidNote} onChange={(x) => set({ paidNote: x })} placeholder="Diễn giải, tài khoản chi, người duyệt…" /></div>
      </div>
    </Modal>
  );
}

/* Modal điền 1 phiếu chi */
function CostModal({ data, isNew, onChange, onSave, onClose, costTypes = [], payMethods, payers = [], onUploadPhotos }) {
  const { useState, useRef, useEffect } = React;
  const methods = (payMethods && payMethods.length) ? payMethods : PAY_METHODS;
  const d = data; const set = (np) => onChange({ ...d, ...np });
  const rec = normKind(d.kind) === "recurring";
  const [err, setErr] = useState("");
  const errRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const photoRef = useRef(null);
  const photos = Array.isArray(d.photos) ? d.photos : [];
  // dataRef: luôn giữ data MỚI NHẤT để upload (dán/kéo-thả) không đè mất field đang sửa / ảnh vừa thêm.
  const dataRef = useRef(d); dataRef.current = d;
  // Tải LÊN 1 loạt File ảnh (từ chọn file / dán clipboard / kéo-thả) — lọc đúng ảnh, gộp vào ảnh sẵn có.
  const uploadFiles = async (fileList) => {
    const imgs = Array.from(fileList || []).filter((f) => f && f.type && f.type.indexOf("image/") === 0);
    if (!imgs.length || !onUploadPhotos) return;
    setPhotoBusy(true);
    try {
      const added = await onUploadPhotos(imgs);
      if (added && added.length) {
        const cur = Array.isArray(dataRef.current.photos) ? dataRef.current.photos : [];
        onChange({ ...dataRef.current, photos: [...cur, ...added] });
      }
    } finally { setPhotoBusy(false); }
  };
  // "latest ref" cho listener paste (gắn 1 lần) luôn gọi được uploadFiles mới nhất.
  const uploadRef = useRef(uploadFiles); uploadRef.current = uploadFiles;
  const pickPhotos = (e) => { const files = Array.from(e.target.files || []); e.target.value = ""; uploadFiles(files); };
  // Dán ảnh (Ctrl+V) ở BẤT KỲ đâu trong khi popup mở → tự tải lên. Không có ảnh trong clipboard thì để yên (paste text).
  useEffect(() => {
    if (!onUploadPhotos) return;
    const onPaste = (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      const imgs = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type && it.type.indexOf("image/") === 0) { const f = it.getAsFile(); if (f) imgs.push(f); }
      }
      if (!imgs.length) return;
      e.preventDefault();
      uploadRef.current(imgs);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onUploadPhotos]);
  const removePhoto = (i) => set({ photos: photos.filter((_, j) => j !== i) });
  const reqLbl = (t) => <span>{t} <span style={{ color: "var(--bad, #d6453d)" }}>*</span></span>;
  // Báo thiếu: popup cuộn dài nên chỉ hiện dải đỏ ở đầu form là KHÔNG THẤY (tưởng bấm Lưu không ăn)
  // → kèm toast + cuộn tới đúng chỗ báo lỗi.
  const fail = (msg) => {
    setErr(msg);
    window.trkToast && window.trkToast(msg, "error");
    setTimeout(() => errRef.current && errRef.current.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };
  const trySave = () => {
    if (!String(d.name || "").trim()) return fail("Vui lòng chọn hoặc nhập tên chi phí.");
    if (toNum(d.amount) <= 0) return fail("Vui lòng nhập số tiền (lớn hơn 0).");
    setErr(""); onSave();
  };
  const f = (label, node, full) => <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>{lbl(label)}{node}</div>;
  return (
    <Modal title={isNew ? "Thêm phiếu chi" : "Sửa phiếu chi"} subtitle={d.invoiceNo ? "# " + d.invoiceNo : "# hóa đơn tự sinh khi lưu"} width={640} icon={<I.fx />} onClose={onClose}
      footer={<div style={{ display: "flex", justifyContent: "flex-end", gap: 10, width: "100%" }}><Btn onClick={onClose}>Hủy</Btn><Btn variant="primary" onClick={trySave}>Lưu phiếu</Btn></div>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "6px 0 2px" }}>
        {err && <div ref={errRef} style={{ gridColumn: "1 / -1", display: "flex", gap: 7, alignItems: "center", fontSize: 12.5, color: "#b42318", background: "#fdecec", border: "1px solid #f3c9c9", borderRadius: 9, padding: "8px 12px" }}><i className="bi bi-exclamation-triangle-fill" /> {err}</div>}
        {f(reqLbl("Loại chi phí (chọn danh mục để nhóm báo cáo — hoặc gõ riêng)"), <Combo value={d.name} onChange={(x) => set({ name: x })} options={costTypes} placeholder="Chọn loại chi phí xe…" />, true)}
        {f("Loại", (
          <div style={{ display: "inline-flex", background: "#f1f2f4", borderRadius: 8, padding: 2 }}>
            {COST_KINDS.map(([k, t]) => { const on = normKind(d.kind) === k; return <button key={k} type="button" onClick={() => set({ kind: k })} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 14px", borderRadius: 6, background: on ? "#fff" : "transparent", color: on ? "var(--accent)" : "var(--ink-4)", boxShadow: on ? "0 1px 2px rgba(16,19,23,.14)" : "none" }}>{t}</button>; })}
          </div>
        ))}
        {f("# Hóa đơn (tự sinh)", <div style={{ padding: "8px 11px", fontSize: 13.5, fontWeight: 600, border: "1px dashed var(--line)", borderRadius: 9, background: "#fafbfc", color: d.invoiceNo ? "var(--ink-2)" : "var(--ink-4)" }} className="tnum">{d.invoiceNo || "Tự sinh khi lưu"}</div>)}
        {f("Ngày chi", <DateField value={d.spendDate} onChange={(x) => set({ spendDate: x })} />)}
        {f(reqLbl(d.estAmount != null ? "Số tiền thực tế (chi)" : "Số tiền"), <>
          <Money value={d.amount} onChange={(x) => set({ amount: x })} dim />
          {d.estAmount != null && <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11.5, fontWeight: 600, color: "var(--accent)" }}>
            <i className="bi bi-receipt" /> Dự kiến lái xe gửi: <span className="tnum">{fmtVND(d.estAmount)}</span>
            {toNum(d.amount) !== toNum(d.estAmount) && <button type="button" onClick={() => set({ amount: d.estAmount })} title="Dùng số dự kiến làm thực tế" style={{ border: "none", background: "transparent", color: "var(--ink-4)", cursor: "pointer", fontSize: 11, textDecoration: "underline", padding: 0 }}>dùng số này</button>}
          </div>}
        </>)}
        {rec && f(<span style={{ color: "var(--accent)" }}>Ngày hết hạn ★</span>, <DateField value={d.dueDate} onChange={(x) => set({ dueDate: x })} />)}
        {f("Nhà cung cấp", <Txt value={d.supplier} onChange={(x) => set({ supplier: x })} placeholder="…" />)}
        {f("Người chi", <Combo value={d.payer} onChange={(x) => set({ payer: x })} options={payers} placeholder="Chọn hoặc gõ người chi…" clearable />)}
        {f("KM hiện tại", <Num value={d.currentKm} onChange={(x) => set({ currentKm: x })} suffix="km" />)}
        {f("Ghi chú", <Txt value={d.note} onChange={(x) => set({ note: x })} placeholder="…" />, true)}

        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <ChkBox checked={!!d.material} onChange={(v) => set({ material: v })} label="Chi phí này là vật tư (lốp, ắc quy, lọc dầu…)" />
          <ChkBox checked={!!d.alloc} onChange={(v) => set(v ? { alloc: true } : { alloc: false, allocMonths: "" })} label="Chi phí phân bổ (chia đều nhiều tháng)" />
        </div>
        {d.alloc && (() => {
          const m = num(d.allocMonths), amt = toNum(d.amount);
          const per = m > 0 && amt > 0 ? Math.round(amt / m) : 0;
          return (
            <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "minmax(180px, 220px) 1fr", gap: 12, alignItems: "center", padding: "11px 13px", background: "var(--accent-weak-2)", border: "1px solid var(--accent-weak)", borderRadius: 10 }}>
              <div>{lbl("Số tháng phân bổ")}<Num value={d.allocMonths} onChange={(x) => set({ allocMonths: x })} suffix="tháng" /></div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.6 }}>
                {per > 0
                  ? <>Chi phí <b style={{ color: "var(--accent)" }}>{fmtVND(per)}/tháng</b> <span style={{ color: "var(--ink-4)" }}>= {fmtVND(amt)} ÷ {m} tháng</span></>
                  : <span style={{ color: "var(--ink-4)" }}>Nhập <b>Số tiền</b> và <b>Số tháng</b> để tính chi phí mỗi tháng.</span>}
              </div>
            </div>
          );
        })()}

        {/* Ảnh thực tế (hóa đơn / đồng hồ km / phụ tùng) */}
        <div style={{ gridColumn: "1 / -1" }}>
          {lbl("Ảnh thực tế")}
          {onUploadPhotos && <div style={{ fontSize: 11.5, color: "var(--ink-4)", margin: "-2px 0 7px", display: "flex", alignItems: "center", gap: 6 }}>
            <i className="bi bi-clipboard-check" style={{ color: "var(--accent)" }} /> Dán ảnh <b style={{ color: "var(--ink-3)" }}>(Ctrl+V)</b> · kéo-thả · hoặc chọn nhiều ảnh cùng lúc — tự tải lên.
          </div>}
          <div
            onDragOver={onUploadPhotos ? (e) => { e.preventDefault(); if (!dragOver) setDragOver(true); } : undefined}
            onDragLeave={onUploadPhotos ? (e) => { if (e.currentTarget === e.target) setDragOver(false); } : undefined}
            onDrop={onUploadPhotos ? (e) => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); } : undefined}
            style={{ display: "flex", flexWrap: "wrap", gap: 9, padding: onUploadPhotos ? 8 : 0, borderRadius: 12, border: onUploadPhotos ? ("1.5px dashed " + (dragOver ? "var(--accent)" : "transparent")) : "none", background: dragOver ? "var(--accent-weak-2)" : "transparent", transition: "background .12s, border-color .12s" }}>
            {photos.map((p, i) => (
              <div key={i} style={{ position: "relative", width: 84, height: 84, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}>
                <a href={p.url} target="_blank" rel="noreferrer" title={p.name}><img src={p.url} alt={p.name || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /></a>
                <button type="button" onClick={() => removePhoto(i)} title="Xóa ảnh" style={{ position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(20,24,30,.62)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 11 }}><i className="bi bi-x-lg" /></button>
              </div>
            ))}
            {onUploadPhotos && (
              <button type="button" onClick={() => photoRef.current && photoRef.current.click()} disabled={photoBusy}
                style={{ width: 84, height: 84, borderRadius: 10, border: "1.5px dashed var(--line)", background: "#fafbfc", cursor: photoBusy ? "default" : "pointer", display: "grid", placeItems: "center", color: "var(--ink-4)", gap: 3 }}>
                {photoBusy ? <span style={{ width: 16, height: 16, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", display: "inline-block", animation: "trk-spin .7s linear infinite" }} />
                  : <span style={{ display: "grid", placeItems: "center" }}><i className="bi bi-camera" style={{ fontSize: 19 }} /><span style={{ fontSize: 10.5, fontWeight: 600, marginTop: 3 }}>Thêm ảnh</span></span>}
              </button>
            )}
            {!onUploadPhotos && photos.length === 0 && <span style={{ fontSize: 12, color: "var(--ink-4)" }}>Chưa có ảnh.</span>}
          </div>
          <input ref={photoRef} type="file" accept="image/*" multiple onChange={pickPhotos} style={{ display: "none" }} />
        </div>

        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 20, marginTop: 2, alignItems: "center" }}>
          <ChkBox checked={!!d.approved} onChange={(v) => set(v ? { approved: true } : { approved: false, paid: false })} label="Đã duyệt" />
          {d.approved
            ? <ChkBox checked={!!d.paid} onChange={(v) => set({ paid: v })} label="Đã thanh toán" />
            : <span style={{ fontSize: 12, color: "var(--ink-4)", display: "inline-flex", alignItems: "center", gap: 5 }}><i className="bi bi-lock-fill" /> Duyệt trước khi thanh toán</span>}
        </div>
        {d.paid && (
          <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "12px 14px", background: "#f3f9f4", border: "1px solid #cde9d6", borderRadius: 10 }}>
            <div style={{ gridColumn: "1 / -1", fontSize: 12.5, fontWeight: 700, color: "var(--good)" }}><i className="bi bi-cash-coin me-1" /> Thông tin thanh toán (kế toán)</div>
            <div>{lbl("Ngày thanh toán")}<DateField value={d.paidDate} onChange={(x) => set({ paidDate: x })} /></div>
            <div>{lbl("Hình thức")}
              <select value={d.paidMethod || ""} onChange={(e) => set({ paidMethod: e.target.value })} style={{ width: "100%", padding: "8px 11px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, background: "#fff" }}>
                <option value="">— chọn —</option>{methods.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>{lbl("Số chứng từ / UNC")}<Txt value={d.paidRef} onChange={(x) => set({ paidRef: x })} placeholder="VD: UNC-2026-0123" /></div>
            <div>{lbl("Ghi chú kế toán")}<Txt value={d.paidNote} onChange={(x) => set({ paidNote: x })} placeholder="Diễn giải, TK chi, người duyệt…" /></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CostTab({ rows, onChange, costTypes, payMethods, payers = [], saving, onUploadPhotos, highlightId, onCancel }) {
  const { useState } = React;
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState("all");   // all | fixed | recurring | due
  const [edit, setEdit] = useState(null);         // { i, d }  (i < 0 = thêm mới)
  const [payIdx, setPayIdx] = useState(null);     // index phiếu đang duyệt thanh toán
  const all = rows || [];
  const isRec = (r) => normKind(r.kind) === "recurring";
  const isDue = (r) => isRec(r) && r.dueDate && dueStatus(r.dueDate).rank >= 2;
  const latestByName = {};
  all.forEach((r) => { if (isRec(r) && r.dueDate) { const n = (r.name || "").trim().toLowerCase(); if (!latestByName[n] || r.dueDate > latestByName[n].due) latestByName[n] = { due: r.dueDate, invoice: (r.invoiceNo || "").trim() }; } });
  const supLatest = (r) => { if (!isRec(r)) return null; const L = latestByName[(r.name || "").trim().toLowerCase()]; return (L && (!r.dueDate || L.due > r.dueDate)) ? L : null; };
  const match = (r) => filter === "fixed" ? !isRec(r) : filter === "recurring" ? isRec(r) : filter === "due" ? isDue(r)
    : filter === "material" ? !!r.material : filter === "alloc" ? !!r.alloc : filter === "normal" ? !r.alloc : true;
  const matCount = all.filter((r) => r.material).length;
  const allocCount = all.filter((r) => r.alloc).length;
  const FILTERS = [["all", "Tất cả", all.length], ["fixed", "Cố định", all.filter((r) => !isRec(r)).length], ["recurring", "Định kỳ", all.filter(isRec).length], ["due", "Hết / sắp hết hạn", all.filter(isDue).length],
    ...(matCount > 0 ? [["material", "Vật tư", matCount]] : []),
    // Chi phí thường (không phân bổ) vs Chi phí phân bổ — chỉ hiện khi có phiếu phân bổ
    ...(allocCount > 0 ? [["normal", "Chi phí thường", all.length - allocCount], ["alloc", "Chi phí phân bổ", allocCount]] : [])];
  const shown = all.filter(match).length;

  // KM chênh lệch theo TÊN: so KM phiếu này với phiếu CŨ HƠN gần nhất cùng tên có KM → "+X km".
  const kmDelta = {};
  const byName = {};
  all.forEach((r, i) => { const n = (r.name || "").trim().toLowerCase(); if (!n) return; (byName[n] = byName[n] || []).push({ i, km: toNum(r.currentKm), date: r.spendDate || "" }); });
  Object.values(byName).forEach((arr) => {
    arr.sort((a, b) => (a.date || "").localeCompare(b.date || ""));   // cũ → mới
    let prev = null;
    arr.forEach((x) => { if (x.km > 0) { if (prev != null && x.km > prev) kmDelta[x.i] = x.km - prev; prev = x.km; } });
  });
  // Thứ tự hiển thị: theo SỐ HÓA ĐƠN (PC-XXXX) MỚI → CŨ (số lớn lên trước). Giữ index gốc để sửa/xóa đúng dòng.
  const invNum = (r) => { const m = /(\d+)/.exec(String(r.invoiceNo || "")); return m ? parseInt(m[1], 10) : -1; };
  const order = all.map((_, i) => i).filter((i) => match(all[i])).sort((a, b) =>
    invNum(all[b]) - invNum(all[a]) || (all[b].spendDate || "").localeCompare(all[a].spendDate || ""));

  const openAdd = () => setEdit({ i: -1, d: blankCost() });
  const openEdit = (i) => setEdit({ i, d: { ...all[i] } });
  const openDup = (i) => { const r = all[i]; setEdit({ i: -1, d: { ...blankCost(), name: r.name || "", supplier: r.supplier || "", kind: "recurring" } }); };
  const del = (i) => onChange(all.filter((_, j) => j !== i));
  const setRow = (i, np) => onChange(all.map((r, j) => (j === i ? { ...r, ...np } : r)));
  const saveModal = () => { if (!edit) return; const next = [...all]; if (edit.i < 0) next.push(edit.d); else next[edit.i] = edit.d; onChange(next); setEdit(null); };
  // Duyệt (kế toán xác nhận hợp lệ) — hỏi xác nhận
  const approve = async (i) => {
    const ok = await window.confirmAction({ title: "Duyệt phiếu chi?", text: `Xác nhận <b>duyệt</b> phiếu chi <b>${esc(all[i].name || all[i].invoiceNo || "")}</b>? Phiếu sẽ được <b>lưu ngay</b>.`, confirmText: '<i class="bi bi-check2-circle me-1"></i> Duyệt' });
    if (ok) setRow(i, { approved: true });
  };
  // Duyệt thanh toán — mở modal điền thông tin kế toán rồi mới duyệt
  const confirmPay = (info) => { if (payIdx == null) return; setRow(payIdx, { paid: true, ...info }); setPayIdx(null); };

  const th = (t, w, align) => <th style={{ textAlign: align || "left", padding: "10px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", width: w }}>{t}</th>;
  const cell = { padding: "11px 12px", verticalAlign: "middle" };
  const iconBtn = (onClick, icon, title, accent) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} title={title}
      style={{ width: 30, height: 30, display: "inline-grid", placeItems: "center", border: `1px solid ${accent ? "var(--accent)" : "var(--line)"}`, borderRadius: 7, background: accent ? "var(--accent-weak-2)" : "#fff", color: accent ? "var(--accent)" : "var(--ink-4)", cursor: "pointer" }}>{icon}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {all.length > 0 && <>
          <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 500 }}>Lọc:</span>
          <div style={{ display: "inline-flex", background: "#f1f2f4", borderRadius: 9, padding: 3, gap: 1 }}>
            {FILTERS.map(([k, t, n]) => {
              const on = filter === k;
              return (
                <button key={k} type="button" onClick={() => setFilter(k)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 11px", borderRadius: 7,
                    background: on ? "#fff" : "transparent", color: on ? (k === "due" ? "var(--warn)" : "var(--accent)") : "var(--ink-3)", boxShadow: on ? "0 1px 2px rgba(16,19,23,.12)" : "none" }}>
                  {t}<span className="tnum" style={{ fontSize: 11, fontWeight: 700, color: on ? "var(--ink-3)" : "var(--ink-4)", background: "var(--line-2)", padding: "0 6px", borderRadius: 999, minWidth: 16, textAlign: "center" }}>{n}</span>
                </button>
              );
            })}
          </div>
        </>}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={openAdd}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 15px", fontSize: 13.5, fontWeight: 600, border: "none", borderRadius: 9, background: "var(--accent)", color: "#fff", cursor: "pointer", boxShadow: "0 1px 2px rgba(42,111,219,.4)" }}>
          <I.plus /> Thêm phiếu chi
        </button>
      </div>

      {all.length === 0 && <div style={{ padding: "30px 4px", textAlign: "center", fontSize: 13, color: "var(--ink-4)", background: "#fff", border: "1px solid var(--line)", borderRadius: 12 }}>Chưa có phiếu chi nào. Bấm <b>Thêm phiếu chi</b>.</div>}
      {all.length > 0 && shown === 0 && <div style={{ padding: "20px 4px", textAlign: "center", fontSize: 13, color: "var(--ink-4)" }}>Không có phiếu chi khớp bộ lọc.</div>}

      {all.length > 0 && shown > 0 && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? 720 : undefined }}>
            <thead><tr style={{ background: "#fafbfc" }}>
              {th("# Hóa đơn", 104)}{th("Khoản chi · KM")}{th("Ngày chi", 104)}{th("Số tiền", 124, "right")}{th("Hạn & trạng thái", 200)}{th("Duyệt · TT", 132, "center")}{th("", 74, "center")}
            </tr></thead>
            <tbody>
              {order.map((i) => {
                const r = all[i];
                const rec = isRec(r); const sl = supLatest(r); const sup = !!sl; const ds = rec && r.dueDate && !sup ? dueStatus(r.dueDate) : null;
                const isHl = highlightId != null && String(r.id) === String(highlightId);
                return (
                  <tr key={r.id || i} id={"trk-cost-" + (r.id || i)} className={isHl ? "trk-row-hl" : undefined} onClick={() => openEdit(i)} style={{ borderBottom: "1px solid var(--line-2)", cursor: "pointer", background: r.cancelled ? "#f7f8fa" : (sup ? "#fafbfc" : "transparent"), opacity: r.cancelled ? 0.6 : (sup ? 0.66 : 1) }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-weak-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = r.cancelled ? "#f7f8fa" : (sup ? "#fafbfc" : "transparent"))}>
                    <td style={{ ...cell }} className="tnum"><span style={{ fontWeight: 600, color: r.invoiceNo ? "var(--accent)" : "var(--ink-4)" }}>{r.invoiceNo || "(mới)"}</span></td>
                    <td style={cell}>
                      <div style={{ fontWeight: 600, textDecoration: r.cancelled ? "line-through" : "none" }}>{r.name || <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>(chưa đặt tên)</span>}</div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: rec ? "var(--accent)" : "var(--ink-3)", background: rec ? "var(--accent-weak)" : "var(--line-2)", padding: "1px 8px", borderRadius: 999 }}>{rec ? "Định kỳ" : "Cố định"}</span>
                      {r.material && <span title="Chi phí vật tư" style={{ fontSize: 10.5, fontWeight: 700, color: "#7c5b16", background: "#fbf0d3", padding: "1px 8px", borderRadius: 999, marginLeft: 6 }}><i className="bi bi-box-seam" /> Vật tư</span>}
                      {r.alloc && <span title={`Chi phí phân bổ ${num(r.allocMonths) || "?"} tháng`} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", background: "var(--accent-weak)", padding: "1px 8px", borderRadius: 999, marginLeft: 6 }}><i className="bi bi-pie-chart" /> Phân bổ{num(r.allocMonths) > 0 ? ` ${num(r.allocMonths)}th` : ""}</span>}
                      {r.requester && <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 8 }} title="Người yêu cầu tạo phiếu"><i className="bi bi-person" /> {r.requester}</span>}
                      {r.supplier && <span style={{ fontSize: 11.5, color: "var(--ink-4)", marginLeft: 8 }}>{r.supplier}</span>}
                      {Array.isArray(r.photos) && r.photos.length > 0 && <span title={`${r.photos.length} ảnh thực tế`} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--good)", background: "var(--good-weak)", padding: "1px 7px", borderRadius: 999, marginLeft: 8 }}><i className="bi bi-camera-fill" /> {r.photos.length}</span>}
                      {toNum(r.currentKm) > 0 && <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 3 }} className="tnum"><i className="bi bi-speedometer2" /> {fmtNum(toNum(r.currentKm))} km{kmDelta[i] ? <b style={{ color: "var(--good)", marginLeft: 6 }}>▲ +{fmtNum(kmDelta[i])} km</b> : ""}</div>}
                    </td>
                    <td style={cell} className="tnum">{fmtDate(r.spendDate) || "—"}</td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 600 }} className="tnum">
                      {fmtVND(toNum(r.amount))}
                      {r.alloc && num(r.allocMonths) > 0 && (
                        <div title={`Chi phí phân bổ ${num(r.allocMonths)} tháng`} style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginTop: 2 }}>
                          {fmtVND(Math.round(toNum(r.amount) / num(r.allocMonths)))}/tháng
                          <span style={{ fontWeight: 400, color: "var(--ink-4)" }}> · {num(r.allocMonths)} th</span>
                        </div>
                      )}
                    </td>
                    <td style={cell}>
                      {!rec ? <span style={{ color: "var(--ink-4)" }}>—</span>
                        : <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span className="tnum" style={{ color: "var(--ink-3)" }}>{fmtDate(r.dueDate) || "chưa có"}</span>
                            {sup ? <span style={{ fontSize: 11, fontWeight: 700, color: "var(--good)", background: "var(--good-weak)", padding: "2px 9px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 4 }}><i className="bi bi-check-circle-fill" /> Đã gia hạn{sl.invoice ? ` ở HĐ #${sl.invoice}` : ""}</span>
                              : !r.dueDate ? <span style={{ fontSize: 11, fontWeight: 600, color: "var(--warn)" }}>chưa đặt hạn</span>
                              : <span style={{ fontSize: 11, fontWeight: 700, color: ds.color, background: ds.bg, padding: "2px 9px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 4 }}>{ds.key === "expired" ? <><i className="bi bi-exclamation-triangle-fill" /> Hết hạn</> : ds.key === "soon" ? <><i className="bi bi-clock-fill" /> Còn {ds.days}n</> : "Còn hạn"}</span>}
                          </div>}
                    </td>
                    <td style={{ ...cell, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      {r.cancelled ? <span style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", background: "#eef1f6", padding: "3px 10px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 4 }}><i className="bi bi-x-circle-fill" /> Đã hủy</span> : (() => {
                        const chip = (t, title) => <span title={title} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--good)", background: "var(--good-weak)", padding: "3px 9px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "center" }}><i className="bi bi-check-circle-fill" /> {t}</span>;
                        const apBtn = (label, onClick) => <button type="button" onClick={onClick} style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", border: "1px solid var(--line)", borderRadius: 999, background: "#fff", color: "var(--ink-2)", cursor: "pointer" }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--good)"; e.currentTarget.style.color = "var(--good)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.color = "var(--ink-2)"; }}>{label}</button>;
                        const payTitle = r.paid ? [r.paidDate && fmtDate(r.paidDate), r.paidMethod, r.paidRef && ("#" + r.paidRef), r.paidNote].filter(Boolean).join(" · ") : "";
                        return (
                          <div style={{ display: "inline-flex", flexDirection: "column", gap: 5 }}>
                            {r.approved ? chip("Đã duyệt") : apBtn("Duyệt", () => approve(i))}
                            {r.paid ? chip("Đã TT", payTitle)
                              : r.approved ? apBtn("Duyệt TT", () => setPayIdx(i))
                              : <span title="Phải duyệt phiếu trước khi thanh toán" style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-4)", display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "center" }}><i className="bi bi-lock-fill" /> Chờ duyệt</span>}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ ...cell, textAlign: "center", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                      {rec && !r.cancelled && iconBtn(() => openDup(i), <i className="bi bi-arrow-repeat" />, "Tạo phiếu mới (gia hạn)", true)}
                      {onCancel && r.canCancel && r.id && <>{iconBtn(() => onCancel(r.hashid || r.id), <i className="bi bi-x-circle" />, "Hủy phiếu")}<span style={{ display: "inline-block", width: 4 }} /></>}
                      {iconBtn(() => del(i), <I.trash />, "Xóa phiếu")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}><i className="bi bi-check2-circle" style={{ color: "var(--good)" }} /> Mọi thao tác ở mục Chi phí (thêm/sửa/duyệt/thanh toán/xóa) được <b>lưu ngay</b> — không cần bấm Lưu. Khoản <b>định kỳ</b> (bảo hiểm, đăng kiểm…): đến hạn bấm <i className="bi bi-arrow-repeat" /> để <b>tạo phiếu mới</b> → điền tiền + ngày hết hạn mới; phiếu cũ tự chuyển <b>“đã gia hạn ở HĐ #…”</b>. <b># hóa đơn tự sinh</b>.</span>

      {edit && <CostModal data={edit.d} isNew={edit.i < 0} costTypes={costTypes} payMethods={payMethods} payers={payers} onUploadPhotos={onUploadPhotos} onChange={(d) => setEdit((e) => ({ ...e, d }))} onSave={saveModal} onClose={() => setEdit(null)} />}
      {payIdx != null && all[payIdx] && <PayModal row={all[payIdx]} payMethods={payMethods} onConfirm={confirmPay} onClose={() => setPayIdx(null)} />}
    </div>
  );
}

/* ---- Khối tài liệu xe (ảnh/PDF/Word/Excel) — upload nhiều file ---- */
const VEH_DOC_TYPES = ["Đăng ký xe", "Đăng kiểm", "Bảo hiểm", "Hợp đồng mua", "Phù hiệu", "Khác"];

function DocsBlock({ docs, busy, docType, setDocType, onPick, onDelete, canEdit, docTypes, hint }) {
  const fileRef = useRef(null);
  const types = docTypes || VEH_DOC_TYPES;
  return (
    <div>
      {lbl(hint || "Tài liệu (đăng ký, đăng kiểm, bảo hiểm, hợp đồng… — ảnh / PDF / Word / Excel)")}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ padding: "7px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" onChange={onPick} style={{ display: "none" }} />
          <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 13, fontWeight: 600, border: "1px dashed var(--accent)", borderRadius: 9, background: "var(--accent-weak-2)", color: "var(--accent)", cursor: busy ? "default" : "pointer" }}>
            <I.plus /> {busy ? "Đang tải…" : "Chọn nhiều file/ảnh"}
          </button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
        {(docs || []).map((doc, di) => (
          <div key={di} style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "#fff", position: "relative" }}>
            <a href={doc.url} target="_blank" rel="noreferrer" style={{ display: "grid", placeItems: "center", height: 96, overflow: "hidden", background: "#fff" }}>
              {doc.isImage
                ? <img src={doc.url} alt={doc.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ fontSize: 30, color: "var(--ink-4)" }}><i className="bi bi-file-earmark-text" /></span>}
            </a>
            <div style={{ padding: "6px 8px", borderTop: "1px solid var(--line-2)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.type}</div>
              <div style={{ fontSize: 10.5, color: "var(--ink-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={doc.name}>{doc.name}</div>
            </div>
            {canEdit && <button type="button" onClick={() => onDelete(doc.id)} title="Xóa tài liệu"
              style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, display: "grid", placeItems: "center", border: "none", borderRadius: 6, background: "rgba(255,255,255,.92)", color: "var(--danger)", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,.15)" }}><I.trash /></button>}
          </div>
        ))}
        {!(docs || []).length && <div style={{ gridColumn: "1 / -1", padding: "14px 4px", fontSize: 12.5, color: "var(--ink-4)" }}>Chưa có tài liệu nào.</div>}
      </div>
    </div>
  );
}

/* ---- Tab: Thông tin xe (mã khung, nơi mua… + tài liệu) ---- */
function InfoTab({ info, onChange, canEdit, docsProps }) {
  const i = info || {};
  const set = (k, v) => onChange({ ...i, [k]: v });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>Thông tin xe</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <div>{lbl("Mã khung xe (số khung / VIN)")}<Txt value={i.chassisNo} onChange={(x) => set("chassisNo", x)} placeholder="VD: RLHE…123456" /></div>
          <div>{lbl("Số máy")}<Txt value={i.engineNo} onChange={(x) => set("engineNo", x)} placeholder="VD: D4DB…" /></div>
          <div>{lbl("Hãng / Đời xe")}<Txt value={i.brand} onChange={(x) => set("brand", x)} placeholder="VD: Howo, Hyundai…" /></div>
          <div>{lbl("Năm sản xuất")}<Txt value={i.year} onChange={(x) => set("year", x)} placeholder="VD: 2020" /></div>
          <div>{lbl("Nơi mua / Nhà cung cấp")}<Txt value={i.purchasePlace} onChange={(x) => set("purchasePlace", x)} placeholder="VD: Đại lý ABC" /></div>
          <div>{lbl("Ngày mua")}<DateField value={i.purchaseDate} onChange={(x) => set("purchaseDate", x)} /></div>
          <div>{lbl("Giá mua")}<Money value={i.purchasePrice} onChange={(x) => set("purchasePrice", x)} dim /></div>
          <div>{lbl("Hạn đăng kiểm")}<DateField value={i.registrationDue} onChange={(x) => set("registrationDue", x)} /></div>
          <div>{lbl("Hạn bảo hiểm")}<DateField value={i.insuranceDue} onChange={(x) => set("insuranceDue", x)} /></div>
        </div>
        <div style={{ marginTop: 12 }}>{lbl("Ghi chú")}<Txt value={i.note} onChange={(x) => set("note", x)} placeholder="Ghi chú thêm về xe…" /></div>
      </div>
      <div style={card}>
        <DocsBlock {...docsProps} canEdit={canEdit} />
      </div>
    </div>
  );
}

/* ---- Tab: Định mức km theo loại chi phí (chặn tạo yêu cầu chi quá sớm) ---- */
function AllowanceTab({ rows, onChange, costTypes }) {
  const isMobile = useIsMobile();
  const set = (i, np) => onChange(rows.map((r, j) => (j === i ? { ...r, ...np } : r)));
  const add = () => onChange([...(rows || []), { costItem: "", km: "" }]);
  const del = (i) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, background: "#eef4ff", border: "1px solid #d6e3fb", borderRadius: 10, padding: "10px 13px" }}>
        <i className="bi bi-info-circle-fill" style={{ color: "var(--accent)" }} /> Định mức <b>KM tối thiểu</b> giữa 2 lần cùng loại chi phí. Khi tài xế gửi <b>yêu cầu chi</b> qua link công khai, hệ thống <b>chặn</b> nếu KM chưa tăng đủ định mức so với phiếu <b>đã duyệt</b> gần nhất cùng loại. (Để trống / 0 = không giới hạn.) Loại chi phí lấy từ danh mục <b>Loại chi phí xe</b> (Cài đặt).
      </div>
      {(rows || []).length === 0 &&<div style={{ padding: "10px 2px", fontSize: 12.5, color: "var(--ink-4)" }}>Chưa có định mức — bấm <b>+ Thêm định mức</b>.</div>}
      {(rows || []).map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 170px 40px", gap: 10, alignItems: "end", ...card }}>
          <div>{lbl("Loại chi phí")}<Combo value={r.costItem} onChange={(x) => set(i, { costItem: x })} options={costTypes || []} placeholder="Chọn loại chi phí xe…" strict /></div>
          <div>{lbl("Định mức (km)")}<Num value={r.km} onChange={(x) => set(i, { km: x })} suffix="km" /></div>
          {delBtn(() => del(i))}
        </div>
      ))}
      {addBtn(add, "Thêm định mức")}
    </div>
  );
}

/* Modal "Phiếu chi cần xử lý" — có tìm kiếm + phân trang khi danh sách dài */
function PendingCostsModal({ items, onClose, onOpen }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const PAGE = 8;
  const ql = q.trim().toLowerCase();
  const filtered = ql ? (items || []).filter((c) => `${c.name || ""} ${c.plate || ""} ${c.invoiceNo || ""}`.toLowerCase().includes(ql)) : (items || []);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = filtered.slice((pageSafe - 1) * PAGE, pageSafe * PAGE);
  const needApprove = (items || []).filter((c) => !c.approved).length;
  const needPay = (items || []).filter((c) => c.approved && !c.paid).length;
  const pgBtn = (label, to, disabled) => (
    <button type="button" onClick={() => !disabled && setPage(to)} disabled={disabled}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, border: "1px solid var(--line)", borderRadius: 8, background: "#fff", color: disabled ? "var(--ink-4)" : "var(--ink-2)", cursor: disabled ? "default" : "pointer" }}>{label}</button>
  );
  return (
    <Modal title="Phiếu chi cần xử lý" subtitle={`${needApprove} chưa duyệt · ${needPay} chờ thanh toán — bấm 1 dòng để mở xe`} width={700} icon={<I.fx />} onClose={onClose}
      footer={<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 10 }}>
        <span style={{ fontSize: 12.5, color: "var(--ink-4)" }}>{filtered.length} phiếu{ql ? " khớp" : ""}</span>
        <Btn onClick={onClose}>Đóng</Btn>
      </div>}>
      <div style={{ padding: "4px 0" }}>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)" }}><I.search /></span>
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Tìm khoản chi / biển số / # hóa đơn…"
            style={{ width: "100%", padding: "9px 12px 9px 36px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none", background: "#fff" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pageItems.map((c, i) => {
            const st = !c.approved ? { t: "Chưa duyệt", col: "var(--warn)", bg: "#fcf3e2" } : { t: "Chờ thanh toán", col: "var(--accent)", bg: "#eef4ff" };
            return (
              <div key={(pageSafe - 1) * PAGE + i} onClick={() => onOpen(c.vehicleId)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10, cursor: "pointer", borderLeft: `3px solid ${st.col}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-weak-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name} <span className="tnum" style={{ color: "var(--ink-3)", fontWeight: 500 }}>· {c.plate}</span></div>
                  <div className="tnum" style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>{c.invoiceNo ? "# " + c.invoiceNo + " · " : ""}{fmtDate(c.spendDate) || "chưa có ngày"}</div>
                </div>
                <span className="tnum" style={{ fontWeight: 700, fontSize: 13.5 }}>{fmtVND(c.amount)}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: st.col, background: st.bg, padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>{st.t}</span>
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ padding: "26px 4px", textAlign: "center", fontSize: 13, color: "var(--ink-4)" }}>Không tìm thấy phiếu phù hợp.</div>}
        </div>
        {filtered.length > PAGE && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 }}>
            {pgBtn(<><i className="bi bi-chevron-left" /> Trước</>, pageSafe - 1, pageSafe <= 1)}
            <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-3)", padding: "0 6px" }}>{pageSafe}/{totalPages}</span>
            {pgBtn(<>Sau <i className="bi bi-chevron-right" /></>, pageSafe + 1, pageSafe >= totalPages)}
          </div>
        )}
      </div>
    </Modal>
  );
}


export { num, daysUsed, COST_KINDS, normKind, TAB_KEYS, SECTION_OF, WARN_DAYS, DUE_NONE, dueStatus, vehRank, DueCell, StatChip, lbl, delBtn, addBtn, card, Pager, DeprecTab, DeprecMonthlyTab, UsageTab, today10, esc, blankCost, PAY_METHODS, PayModal, CostModal, CostTab, VEH_DOC_TYPES, DocsBlock, InfoTab, AllowanceTab, PendingCostsModal };
