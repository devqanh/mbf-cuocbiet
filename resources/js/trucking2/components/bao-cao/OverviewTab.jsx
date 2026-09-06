import React from "react";
import { fmtVND, fmtNum, fmtShort } from "@trk/lib.jsx";
import { card, pctOf, CardTitle, Delta, KPI, Empty, Stacked } from "@trk/components/report-ui.jsx";

const { useState } = React;

/* TAB TỔNG QUAN — P&L tháng cho sếp: lãi/lỗ bao nhiêu & so tháng trước · tiền đi vào 4 nhóm nào ·
   xe nào lãi/lỗ · khách nào mang doanh thu · dữ liệu có thiếu gì (lô chưa khớp bảng giá). */

export const GROUP_COLORS = { driver: "#2a6fdb", vehicle: "#e08600", asset: "#c9a227", shipment: "#9333ea" };
const money = (n) => fmtVND(n || 0);
const per = (a, n) => (n ? fmtShort(Math.round((a || 0) / n)) : "—");

/* Doanh thu − Chi phí = Lợi nhuận: 2 thanh cùng thang đo, nhìn là thấy ai lớn hơn. */
function PnlBars({ revenue, cost, profit }) {
  const max = Math.max(1, revenue, cost);
  const row = (label, v, color, extra) => (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 130px", gap: 10, alignItems: "center", fontSize: 12.5 }}>
      <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>{label}</span>
      <div style={{ height: 18, background: "var(--line-2)", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: Math.max(v ? 1 : 0, v / max * 100) + "%", height: "100%", background: color, borderRadius: 5 }} />
      </div>
      <span className="tnum" style={{ textAlign: "right", fontWeight: 700 }}>{money(v)}{extra}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {row("Doanh thu", revenue, "var(--accent)")}
      {row("Chi phí", cost, "#dc2626")}
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 130px", gap: 10, alignItems: "center", fontSize: 12.5, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
        <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>= Lợi nhuận</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{revenue ? `Cứ 100đ doanh thu, chi hết ${pctOf(cost, revenue)}đ, còn lại ${100 - pctOf(cost, revenue)}đ` : "Chưa có doanh thu trong tháng"}</span>
        <span className="tnum" style={{ textAlign: "right", fontWeight: 800, fontSize: 14, color: profit >= 0 ? "var(--good)" : "var(--danger)" }}>{money(profit)}</span>
      </div>
    </div>
  );
}

/* 1 nhóm chi phí: tổng + các khoản (gọn 5 dòng, bấm xem hết) */
function GroupCard({ g, total, isMobile }) {
  const [all, setAll] = useState(false);
  const items = all ? g.items : g.items.slice(0, 5);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", borderTop: `3px solid ${GROUP_COLORS[g.key] || "var(--ink-4)"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 12.5 }}>{g.label}</b>
        <span className="tnum" style={{ fontSize: 12.5, fontWeight: 800 }}>{money(g.amount)} <span style={{ color: "var(--ink-4)", fontWeight: 600, fontSize: 11 }}>{pctOf(g.amount, total)}%</span></span>
      </div>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <span style={{ color: "var(--ink-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
            <span className="tnum" style={{ whiteSpace: "nowrap" }}>{fmtNum(it.amount)} <span style={{ color: "var(--ink-4)", fontSize: 10.5 }}>{it.pct}%</span></span>
          </div>
        ))}
        {g.items.length > 5 && <button type="button" onClick={() => setAll((v) => !v)} className="ke-noprint" style={{ alignSelf: "flex-start", fontSize: 11.5, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>{all ? "Thu gọn" : `+ ${g.items.length - 5} khoản nữa`}</button>}
      </div>
    </div>
  );
}

function MiniFleet({ title, icon, rows, tone, onMore, emptyText }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 260 }}>
      <CardTitle icon={icon} right={onMore && <button type="button" onClick={onMore} className="ke-noprint" style={{ fontSize: 12, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", fontWeight: 600 }}>Đội xe →</button>}>{title}</CardTitle>
      {!rows.length ? <Empty>{emptyText}</Empty> : rows.map((v) => (
        <div key={v.bks} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line-2)", fontSize: 12.5 }}>
          <div style={{ minWidth: 0 }}>
            <b className="tnum">{v.bks}</b>
            <div className="tnum" style={{ fontSize: 11, color: "var(--ink-4)" }}>DT {fmtShort(v.revenue)} · CP {fmtShort(v.cost)}{v.conts ? ` · ${v.conts} cont` : ""}</div>
          </div>
          <span className="tnum" style={{ fontWeight: 800, color: tone, whiteSpace: "nowrap" }}>{v.profit >= 0 ? "+" : "−"}{fmtShort(Math.abs(v.profit))}</span>
        </div>
      ))}
    </div>
  );
}

export function OverviewTab({ rep, prev, prevLabel, isMobile, routes, onGoTab }) {
  const rev = rep.revenue || 0, cost = rep.totalCost || 0, profit = rep.profit || 0;
  const conts = rep.conts || 0, trips = rep.trips || 0;
  const groups = rep.costGroups || [];
  const fleet = rep.fleet || [];
  const withRev = fleet.filter((v) => v.revenue > 0);
  const loss = fleet.filter((v) => v.revenue > 0 && v.profit < 0);
  const costOnly = fleet.filter((v) => !v.revenue);
  const topProfit = [...withRev].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const topLoss = [...loss].sort((a, b) => a.profit - b.profit).slice(0, 5);
  const customers = (rep.byCustomer || []).slice(0, 5);
  const unmatched = rep.unmatched || 0;
  const pv = prev || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Cảnh báo dữ liệu thiếu — sếp cần biết số doanh thu đang THIẾU chứ không phải công ty lỗ */}
      {unmatched > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "var(--warn-weak)", border: "1px solid #f3d9a4", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#7c5b16" }}>
          <i className="bi bi-exclamation-triangle-fill" style={{ marginTop: 2, color: "var(--warn)" }} />
          <div><b>{unmatched}/{conts} lô đã ra trong tháng chưa có doanh thu</b> — khách chưa có bảng giá phủ ngày cont ra (hoặc lô chưa đủ Nơi lấy / Nơi hạ / Kho để khớp). Doanh thu và lợi nhuận bên dưới đang <b>thấp hơn thực tế</b>. Thêm bảng giá ở tab <b>Bảng giá</b> rồi mở lại báo cáo, số sẽ tự cập nhật.</div>
        </div>
      )}

      {/* 1. KPI P&L + so tháng trước */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KPI label="Doanh thu" value={money(rev)} color="var(--accent)" cur={rev} prev={prev ? pv.revenue : null} goodWhen="up"
          sub={`${per(rev, conts)}/cont${rep.revenueManual ? ` · nhập tay ${fmtShort(rep.revenueManual)}` : ""}${prev ? ` · tháng ${prevLabel}: ${fmtShort(pv.revenue)}` : ""}`} hint="Giá theo bảng giá của lô có Giờ xe ra trong tháng (cước + dầu + sà lan)" />
        <KPI label="Tổng chi phí" value={money(cost)} color="#dc2626" cur={cost} prev={prev ? pv.totalCost : null}
          sub={`${per(cost, conts)}/cont · ${per(cost, trips)}/chuyến${prev ? ` · tháng ${prevLabel}: ${fmtShort(pv.totalCost)}` : ""}`} hint="Lương & vận hành lái xe + chi phí xe/tài sản + chi phí lô" />
        <KPI label="Lợi nhuận gộp" value={money(profit)} color={profit >= 0 ? "var(--good)" : "var(--danger)"} cur={profit} prev={prev ? pv.profit : null} goodWhen="up"
          sub={`Biên ${rep.margin || 0}%${prev && pv.revenue ? ` · tháng ${prevLabel}: ${pv.margin}%` : ""} · ${per(profit, conts)}/cont`} />
        <KPI label="Sản lượng" value={`${fmtNum(conts)} cont`} cur={conts} prev={prev ? pv.conts : null} goodWhen="up"
          sub={`${fmtNum(trips)} chuyến · ${fleet.length} xe hoạt động${prev ? ` · tháng ${prevLabel}: ${pv.conts} cont` : ""}`} />
      </div>

      {/* 2. Doanh thu − chi phí = lợi nhuận + cơ cấu 4 nhóm */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
        <div style={card}>
          <CardTitle icon="bi-calculator">Doanh thu − Chi phí = Lợi nhuận</CardTitle>
          <PnlBars revenue={rev} cost={cost} profit={profit} />
        </div>
        <div style={card}>
          <CardTitle icon="bi-pie-chart-fill" sub="4 nhóm lớn">Tiền chi vào đâu</CardTitle>
          {!groups.length ? <Empty>Không có chi phí trong tháng.</Empty> : (
            <Stacked segments={groups.map((g) => ({ label: g.label, value: g.amount, color: GROUP_COLORS[g.key] || "var(--ink-4)" }))} />
          )}
        </div>
      </div>

      {groups.length > 0 && (
        <div style={card}>
          <CardTitle icon="bi-list-ul" sub="khoản lớn nhất trong từng nhóm">Chi tiết theo nhóm</CardTitle>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${Math.min(4, groups.length)}, 1fr)`, gap: 12 }}>
            {groups.map((g) => <GroupCard key={g.key} g={g} total={cost} isMobile={isMobile} />)}
          </div>
        </div>
      )}

      {/* 3. Đội xe nổi bật */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <MiniFleet title="Xe lãi nhất" icon="bi-trophy" rows={topProfit} tone="var(--good)" onMore={() => onGoTab("fleet")} emptyText="Chưa có xe nào có doanh thu trong tháng." />
        <MiniFleet title="Xe lỗ (có doanh thu nhưng chi phí cao hơn)" icon="bi-exclamation-octagon" rows={topLoss} tone="var(--danger)" onMore={() => onGoTab("fleet")} emptyText="Không có xe nào lỗ trong số xe có doanh thu." />
        <div style={{ ...card, flex: 1, minWidth: 220 }}>
          <CardTitle icon="bi-truck">Đội xe tháng này</CardTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-3)" }}>Xe có doanh thu</span><b className="tnum">{withRev.length}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-3)" }}>… trong đó lỗ</span><b className="tnum" style={{ color: loss.length ? "var(--danger)" : "var(--ink)" }}>{loss.length}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }} title="Xe chỉ phát sinh chi phí (không kéo lô có doanh thu trong tháng, hoặc lô chưa khớp bảng giá)"><span style={{ color: "var(--ink-3)" }}>Xe chỉ có chi phí</span><b className="tnum">{costOnly.length}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-3)" }}>Chi phí TB / xe</span><b className="tnum">{fleet.length ? fmtShort(Math.round(cost / fleet.length)) : "—"}</b></div>
          </div>
        </div>
      </div>

      {/* 4. Khách hàng */}
      <div style={card}>
        <CardTitle icon="bi-people" sub="theo doanh thu tháng" right={<button type="button" onClick={() => onGoTab("customers")} className="ke-noprint" style={{ fontSize: 12, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", fontWeight: 600 }}>Tất cả khách →</button>}>Khách hàng mang doanh thu</CardTitle>
        {!customers.length ? <Empty>Không có lô nào ra trong tháng.</Empty> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {customers.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "220px 1fr 130px 120px", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}{c.unmatched > 0 && <span title={`${c.unmatched} lô chưa khớp bảng giá`} style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#7c5b16", background: "#fbf0d3", padding: "0 6px", borderRadius: 999 }}>{c.unmatched} chưa giá</span>}</span>
                {!isMobile && <div style={{ height: 14, background: "var(--line-2)", borderRadius: 5, overflow: "hidden" }}><div style={{ width: (rev ? c.revenue / rev * 100 : 0) + "%", height: "100%", background: "var(--accent)", minWidth: c.revenue ? 2 : 0 }} /></div>}
                <span className="tnum" style={{ textAlign: "right", fontWeight: 700 }}>{money(c.revenue)}</span>
                {!isMobile && <span className="tnum" style={{ textAlign: "right", color: "var(--ink-4)" }}>{c.conts} cont · {c.perCont ? fmtShort(c.perCont) : "—"}/cont</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.6 }}>
        <i className="bi bi-info-circle" /> <b style={{ color: "var(--ink-3)" }}>Doanh thu</b> = giá theo <b>bảng giá</b> (cước + dầu + sà lan) của lô có Giờ xe ra trong tháng — cùng công thức cột "Thu phí" ở Lô hàng và bảng kê; lô không khớp bảng giá thì lấy doanh thu nhập tay (nếu có). Chi hộ khách không tính.
        <b style={{ color: "var(--ink-3)" }}> Chi phí</b> gồm 4 nhóm: lương & vận hành lái xe (dầu/cầu đường/trợ cấp/lương theo Lộ trình), chi phí xe và tài sản (phiếu chi theo ngày chi, bỏ phiếu hủy), chi phí lô hàng (số net).
        Lợi nhuận là <b>lợi nhuận gộp vận hành</b>, chưa trừ khấu hao & chi phí văn phòng — xem khấu hao ở Báo cáo tài sản.
      </div>
    </div>
  );
}
