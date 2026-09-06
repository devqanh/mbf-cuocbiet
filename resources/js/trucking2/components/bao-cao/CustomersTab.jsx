import React from "react";
import { fmtVND, fmtNum, fmtShort } from "@trk/lib.jsx";
import { card, pctOf, CardTitle, Delta, KPI, Empty, TopList } from "@trk/components/report-ui.jsx";

/* TAB KHÁCH & SẢN LƯỢNG — doanh thu theo khách (so tháng trước), sản lượng theo tuyến / kho. */

export function CustomersTab({ rep, prev, isMobile }) {
  const rows = rep.byCustomer || [];
  const rev = rep.revenue || 0;
  const prevBy = {};
  (prev && prev.byCustomer ? prev.byCustomer : []).forEach((c) => { prevBy[c.label] = c; });
  const top = rows[0];
  const unmatched = rows.reduce((s, c) => s + (c.unmatched || 0), 0);
  const cellR = { padding: "9px 12px", textAlign: "right", borderBottom: "1px solid var(--line-2)", whiteSpace: "nowrap" };
  const th = (label, al) => <th key={label} style={{ textAlign: al || "left", padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", background: "#fafbfc" }}>{label}</th>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KPI label="Khách có lô ra" value={`${rows.length} khách`} sub={`${fmtNum(rep.conts || 0)} cont trong tháng`} />
        <KPI label="Khách lớn nhất" value={top ? top.label : "—"} sub={top ? `${fmtVND(top.revenue)} · ${pctOf(top.revenue, rev)}% doanh thu · ${top.conts} cont` : ""} />
        <KPI label="Doanh thu TB / cont" value={rep.conts ? fmtVND(Math.round(rev / rep.conts)) : "—"} sub="trên toàn bộ cont ra trong tháng" />
        <KPI label="Lô chưa khớp bảng giá" value={`${unmatched} lô`} color={unmatched ? "var(--warn)" : "var(--good)"} sub={unmatched ? "chưa có doanh thu — cần thêm bảng giá" : "mọi lô đã có giá"} />
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
            <thead><tr>{th("Khách hàng")}{th("Tỉ trọng")}{th("Doanh thu", "right")}{th("So tháng trước", "right")}{th("Cont", "right")}{th("DT / cont", "right")}{th("Chưa giá", "right")}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} style={{ padding: 34, textAlign: "center", color: "var(--ink-4)" }}>Không có lô nào ra trong tháng.</td></tr>}
              {rows.map((c, i) => {
                const pv = prevBy[c.label];
                return (
                  <tr key={i}>
                    <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", fontWeight: 600 }}>{c.label}</td>
                    <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", width: 160 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 10, background: "var(--line-2)", borderRadius: 999, overflow: "hidden" }}><div style={{ width: (rev ? c.revenue / rev * 100 : 0) + "%", height: "100%", background: "var(--accent)", minWidth: c.revenue ? 2 : 0 }} /></div>
                        <span className="tnum" style={{ fontSize: 11, color: "var(--ink-4)", width: 34, textAlign: "right" }}>{pctOf(c.revenue, rev)}%</span>
                      </div>
                    </td>
                    <td className="tnum" style={{ ...cellR, fontWeight: 700, color: c.revenue ? "var(--accent)" : "var(--ink-4)" }}>{c.revenue ? fmtNum(c.revenue) : "—"}</td>
                    <td className="tnum" style={{ ...cellR }}>{pv ? <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><Delta cur={c.revenue} prev={pv.revenue} goodWhen="up" /><span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{fmtShort(pv.revenue)} · {pv.conts} cont</span></div> : <span style={{ color: "var(--ink-4)" }}>{prev ? "mới" : "…"}</span>}</td>
                    <td className="tnum" style={{ ...cellR }}>{c.conts}</td>
                    <td className="tnum" style={{ ...cellR, color: "var(--ink-3)" }}>{c.perCont ? fmtNum(c.perCont) : "—"}</td>
                    <td className="tnum" style={{ ...cellR, color: c.unmatched ? "var(--warn)" : "var(--ink-4)", fontWeight: c.unmatched ? 700 : 400 }}>{c.unmatched || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr style={{ background: "#fafbfc" }}>
                <td colSpan={2} style={{ padding: "11px 12px", fontWeight: 800, borderTop: "2px solid var(--line)" }}>TỔNG · {rows.length} khách</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: "var(--accent)" }}>{fmtNum(rev)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}>{prev ? <Delta cur={rev} prev={prev.revenue} goodWhen="up" /> : null}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 700 }}>{fmtNum(rep.conts || 0)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}>{rep.conts ? fmtNum(Math.round(rev / rep.conts)) : "—"}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", color: unmatched ? "var(--warn)" : "var(--ink-4)", fontWeight: 700 }}>{unmatched || "—"}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <TopList title="Sản lượng theo tuyến" icon="bi-signpost-2" data={rep.byRoute || []} unit="chuyến" sub="đếm lô ra trong tháng" />
        <TopList title="Sản lượng theo kho" icon="bi-buildings" data={rep.byKho || []} unit="lượt" sub="1 lô qua nhiều kho = nhiều lượt" />
      </div>
    </div>
  );
}
