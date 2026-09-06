import React from "react";
import { fmtVND, fmtNum, fmtShort } from "@trk/lib.jsx";
import { card, CardTitle, KPI, Empty } from "@trk/components/report-ui.jsx";

/* TAB XU HƯỚNG 12 THÁNG — cột Doanh thu vs Chi phí mỗi tháng + lợi nhuận/biên, bảng số bên dưới.
   Tải khi mở tab (nặng: cộng route-pay theo ngày). */

function TrendChart({ rows }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.cost)));
  const H = 150, LBL = 16;
  const last = rows[rows.length - 1];
  return (
    <div>
      <div style={{ display: "flex", gap: 16, fontSize: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--accent)", borderRadius: 2, marginRight: 5 }} />Doanh thu</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#dc2626", borderRadius: 2, marginRight: 5 }} />Chi phí</span>
        <span style={{ color: "var(--ink-4)" }}>Lợi nhuận (xanh = lãi, đỏ = lỗ) ghi dưới mỗi cột · tháng đang xem in đậm</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {rows.map((r) => {
          const cur = last && r.ym === last.ym;
          const tip = `${r.label}\nDoanh thu: ${fmtVND(r.revenue)}\nChi phí: ${fmtVND(r.cost)}\nLợi nhuận: ${fmtVND(r.profit)}${r.margin != null ? ` (biên ${r.margin}%)` : ""}\n${r.conts} cont`;
          return (
            <div key={r.ym} title={tip} style={{ flex: 1, minWidth: 52, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div className="tnum" style={{ fontSize: 10.5, height: LBL, color: "var(--ink-4)" }}>{r.conts ? `${r.conts} cont` : ""}</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: H, width: "100%", justifyContent: "center" }}>
                <div style={{ width: 14, height: Math.max(r.revenue ? 2 : 0, r.revenue / max * H), background: "var(--accent)", borderRadius: "3px 3px 0 0" }} />
                <div style={{ width: 14, height: Math.max(r.cost ? 2 : 0, r.cost / max * H), background: "#dc2626", borderRadius: "3px 3px 0 0" }} />
              </div>
              <div className="tnum" style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4, color: r.profit >= 0 ? "var(--good)" : "#dc2626" }}>{r.profit >= 0 ? "+" : "−"}{fmtShort(Math.abs(r.profit))}</div>
              <div className="tnum" style={{ fontSize: 10.5, color: cur ? "var(--ink)" : "var(--ink-4)", fontWeight: cur ? 700 : 500 }}>{r.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TrendTab({ rows, loading, monthLabel, isMobile }) {
  if (loading || rows === null) {
    return <div style={card}><CardTitle icon="bi-graph-up">Xu hướng 12 tháng</CardTitle><Empty><i className="bi bi-arrow-repeat" style={{ animation: "trk-spin .9s linear infinite" }} /> Đang tính 12 tháng (cộng lương & vận hành theo từng ngày)…</Empty></div>;
  }
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const tRev = sum("revenue"), tCost = sum("cost"), tProfit = tRev - tCost, tConts = sum("conts");
  const withData = rows.filter((r) => r.revenue || r.cost);
  const best = withData.reduce((m, r) => (m == null || r.profit > m.profit ? r : m), null);
  const worst = withData.reduce((m, r) => (m == null || r.profit < m.profit ? r : m), null);
  const cellR = { padding: "8px 12px", textAlign: "right", borderBottom: "1px solid var(--line-2)", whiteSpace: "nowrap" };
  const th = (label, al) => <th key={label} style={{ textAlign: al || "left", padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", background: "#fafbfc" }}>{label}</th>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KPI label="Doanh thu 12 tháng" value={fmtVND(tRev)} color="var(--accent)" sub={`${fmtNum(tConts)} cont · TB ${fmtShort(Math.round(tRev / 12))}/tháng`} />
        <KPI label="Chi phí 12 tháng" value={fmtVND(tCost)} color="#dc2626" sub={`TB ${fmtShort(Math.round(tCost / 12))}/tháng`} />
        <KPI label="Lợi nhuận 12 tháng" value={fmtVND(tProfit)} color={tProfit >= 0 ? "var(--good)" : "var(--danger)"} sub={tRev ? `Biên ${Math.round(tProfit * 1000 / tRev) / 10}%` : "Chưa có doanh thu"} />
        <KPI label="Tháng tốt nhất / kém nhất" value={best ? best.label : "—"} color="var(--good)" sub={best ? `lãi ${fmtShort(best.profit)}${worst && worst.ym !== best.ym ? ` · kém nhất ${worst.label}: ${worst.profit >= 0 ? "+" : "−"}${fmtShort(Math.abs(worst.profit))}` : ""}` : ""} />
      </div>

      <div style={card}>
        <CardTitle icon="bi-graph-up" sub={`kết tại tháng ${monthLabel}`}>Doanh thu – chi phí – lợi nhuận theo tháng</CardTitle>
        {!rows.length ? <Empty>Không có dữ liệu.</Empty> : <TrendChart rows={rows} />}
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
            <thead><tr>{th("Tháng")}{th("Doanh thu", "right")}{th("Chi phí", "right")}{th("Lợi nhuận", "right")}{th("Biên", "right")}{th("Cont", "right")}{th("DT / cont", "right")}{th("CP / cont", "right")}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ym}>
                  <td className="tnum" style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-2)", fontWeight: 700 }}>{r.label}</td>
                  <td className="tnum" style={{ ...cellR, color: "var(--accent)" }}>{r.revenue ? fmtNum(r.revenue) : "—"}</td>
                  <td className="tnum" style={{ ...cellR }}>{r.cost ? fmtNum(r.cost) : "—"}</td>
                  <td className="tnum" style={{ ...cellR, fontWeight: 700, color: r.profit >= 0 ? "var(--good)" : "var(--danger)" }}>{r.revenue || r.cost ? fmtNum(r.profit) : "—"}</td>
                  <td className="tnum" style={{ ...cellR, color: r.margin == null ? "var(--ink-4)" : r.margin >= 0 ? "var(--good)" : "var(--danger)" }}>{r.margin == null ? "—" : r.margin + "%"}</td>
                  <td className="tnum" style={{ ...cellR }}>{r.conts || "—"}</td>
                  <td className="tnum" style={{ ...cellR, color: "var(--ink-3)" }}>{r.conts && r.revenue ? fmtNum(Math.round(r.revenue / r.conts)) : "—"}</td>
                  <td className="tnum" style={{ ...cellR, color: "var(--ink-3)" }}>{r.conts && r.cost ? fmtNum(Math.round(r.cost / r.conts)) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: "#fafbfc" }}>
              <td style={{ padding: "10px 12px", fontWeight: 800, borderTop: "2px solid var(--line)" }}>12 THÁNG</td>
              <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: "var(--accent)" }}>{fmtNum(tRev)}</td>
              <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800 }}>{fmtNum(tCost)}</td>
              <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: tProfit >= 0 ? "var(--good)" : "var(--danger)" }}>{fmtNum(tProfit)}</td>
              <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}>{tRev ? Math.round(tProfit * 1000 / tRev) / 10 + "%" : "—"}</td>
              <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 700 }}>{fmtNum(tConts)}</td>
              <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}>{tConts ? fmtNum(Math.round(tRev / tConts)) : "—"}</td>
              <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}>{tConts ? fmtNum(Math.round(tCost / tConts)) : "—"}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.6 }}>
        <i className="bi bi-info-circle" /> Doanh thu theo tháng Giờ xe ra (giá bảng giá, fallback nhập tay); chi phí = lương & vận hành lái xe + phiếu chi xe/tài sản (theo ngày chi, bỏ phiếu hủy) + chi phí lô (net). Cùng công thức với tab Tổng quan.
      </div>
    </div>
  );
}
