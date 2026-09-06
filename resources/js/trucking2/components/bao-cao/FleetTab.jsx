import React from "react";
import { fmtVND, fmtNum, fmtShort } from "@trk/lib.jsx";
import { card, CardTitle, Delta, KPI, Empty } from "@trk/components/report-ui.jsx";

const { useState } = React;

/* TAB ĐỘI XE — bảng đầy đủ mỗi xe: doanh thu · chi phí · lợi nhuận · biên · chuyến/cont · đơn giá;
   lọc nhanh (có DT / lỗ / chỉ chi phí), sắp xếp cột, so lợi nhuận với tháng trước. */

const SORT_DEF = { bks: 1, revenue: -1, cost: -1, profit: -1, margin: -1, trips: -1, conts: -1, perTrip: -1, perCont: -1 };

export function FleetTab({ rep, prev, isMobile, routes }) {
  const [filter, setFilter] = useState("all");   // all | rev | loss | costOnly
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "profit", dir: -1 });
  const all = (rep.fleet || []).map((v) => ({ ...v, perCont: v.conts ? Math.round(v.cost / v.conts) : 0 }));
  const prevBy = {};
  (prev && prev.fleet ? prev.fleet : []).forEach((v) => { prevBy[v.bks] = v; });

  const withRev = all.filter((v) => v.revenue > 0);
  const loss = withRev.filter((v) => v.profit < 0);
  const costOnly = all.filter((v) => !v.revenue);
  const ql = q.trim().toLowerCase();
  const rows = all
    .filter((v) => (filter === "all" || (filter === "rev" && v.revenue > 0) || (filter === "loss" && v.revenue > 0 && v.profit < 0) || (filter === "costOnly" && !v.revenue))
      && (!ql || (v.bks || "").toLowerCase().includes(ql)))
    .sort((a, b) => {
      const k = sort.key;
      if (k === "bks") return sort.dir * String(a.bks).localeCompare(String(b.bks), "vi");
      const va = a[k] == null ? -Infinity : a[k], vb = b[k] == null ? -Infinity : b[k];
      return sort.dir * (va - vb) || b.cost - a.cost;
    });
  const sum = (k) => rows.reduce((s, v) => s + (v[k] || 0), 0);
  const tot = { revenue: sum("revenue"), cost: sum("cost"), profit: sum("profit"), trips: sum("trips"), conts: sum("conts") };
  const avgMargin = withRev.length ? Math.round(withRev.reduce((s, v) => s + (v.margin || 0), 0) / withRev.length * 10) / 10 : null;

  const setSortKey = (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: SORT_DEF[k] || -1 }));
  const cellR = { padding: "9px 10px", textAlign: "right", borderBottom: "1px solid var(--line-2)", whiteSpace: "nowrap" };
  const th = (label, key, al, title) => {
    const on = key && sort.key === key;
    return (
      <th key={label} onClick={key ? () => setSortKey(key) : undefined} title={title || (key ? "Bấm để sắp xếp" : "")}
        style={{ textAlign: al || "left", padding: "9px 10px", fontSize: 10.5, fontWeight: 700, color: on ? "var(--accent)" : "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", background: "#fafbfc", position: "sticky", top: 0, zIndex: 1, cursor: key ? "pointer" : "default", userSelect: "none" }}>
        {label}{on && <i className={"bi " + (sort.dir < 0 ? "bi-caret-down-fill" : "bi-caret-up-fill")} style={{ fontSize: 9, marginLeft: 4 }} />}
      </th>
    );
  };
  const pill = (k, l, n) => (
    <button key={k} type="button" onClick={() => setFilter(k)}
      style={{ padding: "6px 11px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center",
        border: "1px solid " + (filter === k ? "var(--accent)" : "var(--line)"), background: filter === k ? "var(--accent-weak-2)" : "#fff", color: filter === k ? "var(--accent)" : "var(--ink-3)" }}>
      {l}<span className="tnum" style={{ fontSize: 11, color: "var(--ink-4)" }}>{n}</span>
    </button>
  );
  const maxCost = Math.max(1, ...all.map((v) => v.cost));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KPI label="Xe hoạt động" value={`${all.length} xe`} sub={`${withRev.length} xe có doanh thu · ${costOnly.length} xe chỉ có chi phí`} />
        <KPI label="Xe lỗ" value={`${loss.length} xe`} color={loss.length ? "var(--danger)" : "var(--good)"} sub="có doanh thu nhưng chi phí cao hơn" />
        <KPI label="Biên lợi nhuận TB / xe" value={avgMargin == null ? "—" : `${avgMargin}%`} color={avgMargin == null ? "var(--ink-4)" : avgMargin >= 0 ? "var(--good)" : "var(--danger)"} sub="trung bình các xe có doanh thu" />
        <KPI label="Chi phí TB / chuyến" value={tot.trips ? fmtVND(Math.round(tot.cost / tot.trips)) : "—"} sub={`${fmtNum(tot.trips)} chuyến · ${fmtNum(tot.conts)} cont`} />
      </div>

      <div className="ke-noprint" style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        {pill("all", "Tất cả", all.length)}{pill("rev", "Có doanh thu", withRev.length)}{pill("loss", "Lỗ", loss.length)}{pill("costOnly", "Chỉ chi phí", costOnly.length)}
        <div style={{ position: "relative", width: isMobile ? "100%" : 200 }}>
          <i className="bi bi-search" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: 12 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm biển số…"
            style={{ width: "100%", padding: "7px 12px 7px 30px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none" }} />
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{rows.length} xe · bấm tiêu đề cột để sắp xếp</span>
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1060 }}>
            <thead><tr>
              {th("Biển số", "bks")}{th("Chi phí (tỉ lệ)", null)}
              {th("Doanh thu", "revenue", "right")}{th("Chi phí", "cost", "right")}{th("Lợi nhuận", "profit", "right")}
              {th("So tháng trước", null, "right", "Lợi nhuận tháng trước và % thay đổi")}
              {th("Biên", "margin", "right", "Lợi nhuận ÷ doanh thu")}{th("Chuyến", "trips", "right")}{th("Cont", "conts", "right")}
              {th("CP/chuyến", "perTrip", "right")}{th("CP/cont", "perCont", "right")}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11} style={{ padding: 34, textAlign: "center", color: "var(--ink-4)" }}>Không có xe nào khớp.</td></tr>}
              {rows.map((v) => {
                const pv = prevBy[v.bks];
                const isLoss = v.revenue > 0 && v.profit < 0;
                return (
                  <tr key={v.bks} style={{ background: isLoss ? "#fff7f7" : "transparent" }}>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--line-2)", whiteSpace: "nowrap" }}>
                      <b className="tnum">{v.bks}</b>
                      {v.hashid && routes.fleet && <a href={routes.fleet + "#" + v.hashid + "/cost"} title="Mở hồ sơ xe" className="ke-noprint" style={{ color: "var(--accent)", fontSize: 11, marginLeft: 6 }}><i className="bi bi-box-arrow-up-right" /></a>}
                      {!v.revenue && <span title="Không kéo lô có doanh thu trong tháng" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--ink-4)", background: "var(--line-2)", padding: "0 6px", borderRadius: 999 }}>chỉ CP</span>}
                    </td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--line-2)", width: 120 }}>
                      <div style={{ height: 8, background: "var(--line-2)", borderRadius: 999, overflow: "hidden" }}><div style={{ width: (v.cost / maxCost * 100) + "%", height: "100%", background: "#dc2626", minWidth: v.cost ? 2 : 0 }} /></div>
                    </td>
                    <td className="tnum" style={{ ...cellR, color: "var(--accent)", fontWeight: 600 }}>{v.revenue ? fmtNum(v.revenue) : "—"}</td>
                    <td className="tnum" style={{ ...cellR }}>{fmtNum(v.cost)}</td>
                    <td className="tnum" style={{ ...cellR, fontWeight: 800, color: v.profit >= 0 ? "var(--good)" : "var(--danger)" }}>{fmtNum(v.profit)}</td>
                    <td className="tnum" style={{ ...cellR }}>
                      {pv ? <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><Delta cur={v.profit} prev={pv.profit} goodWhen="up" /><span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{fmtShort(pv.profit)}</span></div> : <span style={{ color: "var(--ink-4)" }}>{prev ? "mới" : "…"}</span>}
                    </td>
                    <td className="tnum" style={{ ...cellR, color: v.margin == null ? "var(--ink-4)" : v.margin >= 0 ? "var(--good)" : "var(--danger)" }}>{v.margin == null ? "—" : v.margin + "%"}</td>
                    <td className="tnum" style={{ ...cellR }}>{v.trips || "—"}</td>
                    <td className="tnum" style={{ ...cellR }}>{v.conts || "—"}</td>
                    <td className="tnum" style={{ ...cellR, color: "var(--ink-3)" }}>{v.perTrip ? fmtNum(v.perTrip) : "—"}</td>
                    <td className="tnum" style={{ ...cellR, color: "var(--ink-3)" }}>{v.perCont ? fmtNum(v.perCont) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr style={{ background: "#fafbfc" }}>
                <td colSpan={2} style={{ padding: "11px 10px", fontWeight: 800, borderTop: "2px solid var(--line)" }}>TỔNG · {rows.length} xe</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: "var(--accent)" }}>{fmtNum(tot.revenue)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800 }}>{fmtNum(tot.cost)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: tot.profit >= 0 ? "var(--good)" : "var(--danger)" }}>{fmtNum(tot.profit)}</td>
                <td style={{ borderTop: "2px solid var(--line)" }} />
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}>{tot.revenue ? Math.round(tot.profit * 1000 / tot.revenue) / 10 + "%" : "—"}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 700 }}>{fmtNum(tot.trips)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 700 }}>{fmtNum(tot.conts)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}>{tot.trips ? fmtNum(Math.round(tot.cost / tot.trips)) : "—"}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}>{tot.conts ? fmtNum(Math.round(tot.cost / tot.conts)) : "—"}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.6 }}>
        <i className="bi bi-info-circle" /> Doanh thu gán cho xe theo <b>BKS vào</b> của lô. Chi phí xe = lương & vận hành lái xe (theo Lộ trình) + phiếu chi của xe theo ngày chi.
        Xe "chỉ CP" là xe có phiếu chi/lộ trình nhưng không kéo lô có doanh thu trong tháng (hoặc lô chưa khớp bảng giá) — không hẳn là lỗ.
      </div>
    </div>
  );
}
