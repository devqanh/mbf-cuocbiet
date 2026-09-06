import React from "react";
import { fmtVND, fmtNum, fmtShort, fmtDate } from "@trk/lib.jsx";
import { card, pctOf, KPI, AssetName, Empty } from "./parts.jsx";

const { useState } = React;

/* TAB SỔ TÀI SẢN — mỗi hạng mục khấu hao 1 dòng: nguyên giá, bắt đầu → hết, tiến độ, lũy kế, còn lại.
   Tính đến HÔM NAY, KHÔNG phụ thuộc kỳ chọn ở đầu trang. */

const STATUS = {
  active: { label: "Đang khấu hao", color: "var(--good)", bg: "var(--good-weak)" },
  soon:   { label: "Sắp hết", color: "var(--warn)", bg: "var(--warn-weak)" },
  done:   { label: "Đã hết khấu hao", color: "var(--ink-3)", bg: "var(--line-2)" },
  future: { label: "Chưa bắt đầu", color: "var(--accent)", bg: "var(--accent-weak-2)" },
};
const statusOf = (r) => (r.soon ? "soon" : r.status);

const SORT_DEF = { plate: 1, origPrice: -1, startDate: 1, endDate: 1, pct: -1, accrued: -1, remain: -1, monthly: -1 };

export function RegisterTab({ rep, isMobile, routes }) {
  const [kind, setKind] = useState("all");       // all | vehicle | asset
  const [status, setStatus] = useState("all");   // all | active | soon | done | future
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "plate", dir: 1 });
  const all = rep.register || [];
  const tot = rep.registerTotals || {};

  const ql = q.trim().toLowerCase();
  const rows = all
    .filter((r) => (kind === "all" || r.kind === kind) && (status === "all" || statusOf(r) === status)
      && (!ql || [r.plate, r.name, r.item, r.group].some((v) => (v || "").toLowerCase().includes(ql))))
    .sort((a, b) => {
      const k = sort.key;
      const va = a[k], vb = b[k];
      if (typeof va === "string" || typeof vb === "string") return sort.dir * String(va || "").localeCompare(String(vb || ""), "vi");
      return sort.dir * ((va || 0) - (vb || 0)) || String(a.plate).localeCompare(String(b.plate), "vi");
    });
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const shown = { orig: sum("origPrice"), accrued: sum("accrued"), remain: sum("remain"), monthly: rows.filter((r) => r.status === "active").reduce((s, r) => s + r.monthly, 0) };
  const counts = all.reduce((a, r) => { a[statusOf(r)] = (a[statusOf(r)] || 0) + 1; return a; }, {});

  const setSortKey = (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: SORT_DEF[k] || -1 }));
  const cellR = { padding: "9px 12px", textAlign: "right", borderBottom: "1px solid var(--line-2)", whiteSpace: "nowrap" };
  const cellL = { padding: "9px 12px", borderBottom: "1px solid var(--line-2)" };
  const th = (label, key, al, title) => {
    const on = key && sort.key === key;
    return (
      <th key={label} onClick={key ? () => setSortKey(key) : undefined} title={title || (key ? "Bấm để sắp xếp" : "")}
        style={{ textAlign: al || "left", padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: on ? "var(--accent)" : "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", background: "#fafbfc", position: "sticky", top: 0, zIndex: 1, cursor: key ? "pointer" : "default", userSelect: "none" }}>
        {label}{on && <i className={"bi " + (sort.dir < 0 ? "bi-caret-down-fill" : "bi-caret-up-fill")} style={{ fontSize: 9, marginLeft: 4 }} />}
      </th>
    );
  };
  const pill = (k, l, n) => (
    <button key={k} type="button" onClick={() => setStatus(k)}
      style={{ padding: "6px 11px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center",
        border: "1px solid " + (status === k ? "var(--accent)" : "var(--line)"), background: status === k ? "var(--accent-weak-2)" : "#fff", color: status === k ? "var(--accent)" : "var(--ink-3)" }}>
      {l}{n != null && <span className="tnum" style={{ fontSize: 11, color: "var(--ink-4)" }}>{n}</span>}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KPI label="Tổng nguyên giá" value={fmtVND(tot.orig)} sub={`${tot.count || 0} hạng mục khấu hao`} />
        <KPI label="Đã khấu hao (lũy kế)" value={fmtVND(tot.accrued)} color="#e08600" sub={`${pctOf(tot.accrued, tot.orig)}% nguyên giá · tính đến hôm nay`} />
        <KPI label="Giá trị còn lại" value={fmtVND(tot.remain)} color="var(--good)" sub={`${pctOf(tot.remain, tot.orig)}% nguyên giá`} />
        <KPI label="Khấu hao tháng này" value={fmtVND(tot.monthly)} sub={`${tot.active || 0} hạng mục đang khấu hao`} />
      </div>

      <div className="ke-noprint" style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        {[["all", "Tất cả"], ["vehicle", "Xe"], ["asset", "Tài sản"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            style={{ padding: "6px 11px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: "pointer",
              border: "1px solid " + (kind === k ? "var(--accent)" : "var(--line)"), background: kind === k ? "var(--accent-weak-2)" : "#fff", color: kind === k ? "var(--accent)" : "var(--ink-3)" }}>{l}</button>
        ))}
        <span style={{ width: 1, height: 22, background: "var(--line)", margin: "0 3px" }} />
        {pill("all", "Mọi trạng thái", all.length)}{pill("active", "Đang KH", counts.active || 0)}{pill("soon", "Sắp hết (≤ 3 th)", counts.soon || 0)}{pill("done", "Đã hết", counts.done || 0)}{counts.future ? pill("future", "Chưa bắt đầu", counts.future) : null}
        <div style={{ position: "relative", width: isMobile ? "100%" : 220 }}>
          <i className="bi bi-search" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: 12 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm biển số / tên / nhóm…"
            style={{ width: "100%", padding: "7px 12px 7px 30px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none" }} />
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1100 }}>
            <thead><tr>
              {th("Xe / Tài sản", "plate")}{th("Nhóm", "group")}
              {th("Nguyên giá", "origPrice", "right")}{th("Bắt đầu", "startDate", "right")}{th("Hết khấu hao", "endDate", "right")}
              {th("Tiến độ", "pct", "left", "Số tháng đã khấu hao / tổng số tháng")}
              {th("Lũy kế", "accrued", "right")}{th("Còn lại", "remain", "right")}{th("KH / tháng", "monthly", "right")}{th("Trạng thái", null, "left")}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={10} style={{ padding: 34, textAlign: "center", color: "var(--ink-4)" }}>Không có hạng mục khấu hao nào khớp.</td></tr>}
              {rows.map((r, i) => {
                const st = STATUS[statusOf(r)];
                const usedM = Math.min(r.months, Math.round(r.usedDays / 30));
                return (
                  <tr key={i}>
                    <td style={cellL}>
                      <AssetName row={r} fleetUrl={routes.fleet} section="deprec" />
                      {r.item && r.item !== r.name && r.item !== r.plate && <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 2 }}>{r.item}</div>}
                    </td>
                    <td style={{ ...cellL, fontSize: 12.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{r.group || "—"}</td>
                    <td className="tnum" style={{ ...cellR, fontWeight: 600 }}>{fmtNum(r.origPrice)}</td>
                    <td className="tnum" style={{ ...cellR, color: "var(--ink-3)" }}>{fmtDate(r.startDate)}</td>
                    <td className="tnum" style={{ ...cellR, color: r.soon ? "var(--warn)" : "var(--ink-3)", fontWeight: r.soon ? 700 : 400 }}>{fmtDate(r.endDate)}</td>
                    <td style={{ ...cellL, minWidth: 150 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--line-2)", overflow: "hidden" }}>
                          <div style={{ width: Math.min(100, r.pct) + "%", height: "100%", background: r.status === "done" ? "var(--ink-4)" : r.soon ? "var(--warn)" : "var(--accent)" }} />
                        </div>
                        <span className="tnum" style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap", minWidth: 78, textAlign: "right" }}>{usedM}/{r.months} th · {Math.round(r.pct)}%</span>
                      </div>
                    </td>
                    <td className="tnum" style={{ ...cellR, color: "#e08600" }}>{fmtNum(r.accrued)}</td>
                    <td className="tnum" style={{ ...cellR, fontWeight: 700, color: r.remain ? "var(--good)" : "var(--ink-4)" }}>{r.remain ? fmtNum(r.remain) : "0"}</td>
                    <td className="tnum" style={{ ...cellR, color: "var(--ink-3)" }}>{r.status === "active" ? fmtNum(r.monthly) : "—"}</td>
                    <td style={{ ...cellL, whiteSpace: "nowrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, padding: "2px 8px", borderRadius: 999 }}>{st.label}</span>
                      {r.status !== "done" && r.status !== "future" && <span className="tnum" style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 6 }}>còn {r.remainMonths} th</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr style={{ background: "#fafbfc" }}>
                <td colSpan={2} style={{ padding: "11px 12px", fontWeight: 800, borderTop: "2px solid var(--line)" }}>TỔNG · {rows.length} hạng mục</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800 }}>{fmtNum(shown.orig)}</td>
                <td colSpan={3} style={{ borderTop: "2px solid var(--line)" }} />
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: "#e08600" }}>{fmtNum(shown.accrued)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: "var(--good)" }}>{fmtNum(shown.remain)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 700 }}>{fmtNum(shown.monthly)}</td>
                <td style={{ borderTop: "2px solid var(--line)" }} />
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.6 }}>
        <i className="bi bi-info-circle" /> Khấu hao đường thẳng theo <b>ngày</b>: mỗi ngày = Nguyên giá ÷ (30 × số tháng); lũy kế = số ngày đã trôi qua kể từ ngày bắt đầu (không tính hôm nay).
        Giá trị còn lại = Nguyên giá − lũy kế. Sổ này tính đến <b>hôm nay</b>, không phụ thuộc kỳ chọn ở đầu trang. Sửa nguyên giá / số tháng tại hồ sơ xe (tab Khấu hao).
      </div>
    </div>
  );
}
