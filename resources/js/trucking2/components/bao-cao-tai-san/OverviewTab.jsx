import React from "react";
import { fmtVND, fmtNum, fmtShort, fmtDate } from "@trk/lib.jsx";
import { Donut, PALETTE } from "@trk/components/charts.jsx";
import { COLS, ymLabel, card, pctOf, CardTitle, Delta, KPI, AssetName, Empty, fleetLink, SplitBar } from "./parts.jsx";

/* TAB TỔNG QUAN — trả lời 5 câu sếp hay hỏi: tốn bao nhiêu & so kỳ trước? · xu hướng? · tiền đi vào đâu? ·
   xe nào tốn nhất/bất thường? · có gì cần xử lý ngay (giấy tờ, phiếu chờ, sắp hết khấu hao)? */

/* Xu hướng theo tháng — cột chồng 3 nhóm; tháng ngoài kỳ chọn làm mờ; đường TB của kỳ. */
function TrendChart({ trend }) {
  const rows = trend || [];
  if (!rows.length) return <Empty>Chưa có dữ liệu.</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.total));
  const H = 150, LBL = 16;
  const inP = rows.filter((r) => r.inPeriod && !r.future);
  const avg = inP.length ? inP.reduce((s, r) => s + r.total, 0) / inP.length : 0;
  const peak = inP.reduce((m, r) => (r.total > (m ? m.total : 0) ? r : m), null);
  return (
    <div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {COLS.map((c) => <span key={c.k}><span style={{ display: "inline-block", width: 10, height: 10, background: c.color, borderRadius: 2, marginRight: 5 }} />{c.label}</span>)}
        <span style={{ color: "var(--ink-4)" }}>· Tháng ngoài kỳ chọn hiện mờ · đường đứt = trung bình tháng của kỳ</span>
      </div>
      <div style={{ position: "relative" }}>
        {avg > 0 && (
          <div style={{ position: "absolute", left: 0, right: 0, top: LBL + H - avg / max * H, borderTop: "1.5px dashed var(--ink-4)", zIndex: 1, pointerEvents: "none" }}>
            <span className="tnum" style={{ position: "absolute", right: 0, top: -17, fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", background: "#fff", padding: "0 5px" }}>TB {fmtShort(avg)}/tháng</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
          {rows.map((r) => {
            const h = r.total / max * H;
            const dim = !r.inPeriod;
            const tip = `${r.label}${r.future ? " (tương lai)" : ""}\nChi phí thường: ${fmtVND(r.costNormal)}\nChi phí phân bổ: ${fmtVND(r.costAlloc)}\nKhấu hao: ${fmtVND(r.deprec)}\nTổng: ${fmtVND(r.total)}`;
            return (
              <div key={r.ym} title={tip} style={{ flex: 1, minWidth: 46, display: "flex", flexDirection: "column", alignItems: "center", opacity: dim ? 0.4 : 1 }}>
                <div className="tnum" style={{ fontSize: 10.5, fontWeight: 700, height: LBL, color: peak && peak.ym === r.ym ? "var(--danger)" : "var(--ink-2)" }}>{r.total ? fmtShort(r.total) : ""}</div>
                <div style={{ height: H, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  <div style={{ width: 26, height: Math.max(r.total ? 2 : 0, h), display: "flex", flexDirection: "column-reverse", borderRadius: "4px 4px 0 0", overflow: "hidden" }}>
                    {COLS.map((c) => { const seg = (r[c.k] || 0) / max * H; return seg > 0 ? <div key={c.k} style={{ height: seg, background: c.color }} /> : null; })}
                  </div>
                </div>
                <div className="tnum" style={{ fontSize: 10.5, marginTop: 5, color: dim ? "var(--ink-4)" : "var(--ink-2)", fontWeight: r.inPeriod ? 700 : 500 }}>{r.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const dayLabel = (d) => (d < 0 ? `quá hạn ${-d} ngày` : d === 0 ? "hết hạn hôm nay" : `còn ${d} ngày`);
const dayColor = (d) => (d < 0 ? "var(--danger)" : d <= 7 ? "var(--danger)" : "var(--warn)");

export function OverviewTab({ rep, isMobile, routes, onOpenVehicle, onGoRegister }) {
  const totals = rep.totals || {};
  const prev = rep.prev || null;
  const rows = rep.rows || [];
  const reg = rep.registerTotals || {};
  const split = rep.split || {};
  const alerts = rep.alerts || {};
  const cash = (totals.costNormal || 0) + (totals.costAlloc || 0);   // tiền THỰC CHI (khấu hao không chi tiền)
  const conts = rep.conts || 0;

  // Cơ cấu theo khoản (gom theo tên phiếu chi; không gồm khấu hao)
  const items = rep.byItem || [];
  const itemBase = items.reduce((s, i) => s + i.amount, 0);
  const donut = items.slice(0, 7).map((it, i) => ({ label: it.label, value: it.amount, color: PALETTE[i % PALETTE.length], count: it.count, material: it.material }));
  if (items.length > 7) donut.push({ label: `Khác (${items.length - 7} khoản)`, value: items.slice(7).reduce((s, i) => s + i.amount, 0), color: "#cbd5e1" });

  // Top xe/tài sản tốn nhất + so với trung bình CÙNG LOẠI (xe so xe, tài sản so tài sản)
  const top = rows.slice(0, 10);
  const maxTop = top.length ? top[0].total || 1 : 1;
  const avgOf = (k) => { const g = rows.filter((r) => r.kind === k); return g.length ? g.reduce((s, r) => s + r.total, 0) / g.length : 0; };
  const avgKind = { vehicle: avgOf("vehicle"), asset: avgOf("asset") };

  const docs = alerts.docs || [];
  const recurring = alerts.recurring || [];
  const pending = alerts.pending || { count: 0, amount: 0 };
  const soonItems = (rep.register || []).filter((r) => r.soon);
  const suppliers = rep.bySupplier || [];
  const maxSup = Math.max(1, ...suppliers.map((s) => s.amount));
  const prevLabel = prev ? (prev.from === prev.to ? ymLabel(prev.from) : `${ymLabel(prev.from)}→${ymLabel(prev.to)}`) : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 1. KPI — tốn bao nhiêu, so kỳ trước, giá trị tài sản còn lại */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KPI label="Tổng chi phí kỳ" value={fmtVND(totals.total)} cur={totals.total} prev={prev ? prev.total : null}
          sub={prev ? `Kỳ trước (${prevLabel}): ${fmtShort(prev.total)}` : ""} hint="Chi phí thường + phân bổ + khấu hao" />
        {COLS.map((c) => <KPI key={c.k} label={c.label} value={fmtVND(totals[c.k])} color={c.color} cur={totals[c.k]} prev={prev ? prev[c.k] : null} sub={c.hint} />)}
        <KPI label="Giá trị tài sản còn lại" value={fmtVND(reg.remain)} color="var(--good)"
          sub={`Nguyên giá ${fmtShort(reg.orig)} · đã khấu hao ${pctOf(reg.accrued, reg.orig)}% · tính đến hôm nay`} />
        <KPI label="Cont kéo trong kỳ" value={`${fmtNum(conts)} cont`}
          sub={conts ? `Chi phí bình quân ${fmtVND(Math.round((totals.total || 0) / conts))}/cont` : "Lô hàng chưa gắn xe (BKS vào) trong kỳ"} />
      </div>

      {/* 2. Xu hướng theo tháng */}
      <div style={card}>
        <CardTitle icon="bi-graph-up" sub={`${(rep.trend || []).length} tháng gần nhất, kết tại ${ymLabel(rep.to)}`}>Xu hướng chi phí theo tháng</CardTitle>
        <TrendChart trend={rep.trend} />
      </div>

      {/* 3. Tiền đi vào đâu */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "3fr 2fr", gap: 14 }}>
        <div style={card}>
          <CardTitle icon="bi-pie-chart-fill" sub="theo tên khoản chi · không gồm khấu hao">Tiền đi vào đâu</CardTitle>
          {!donut.length ? <Empty>Không có phiếu chi trong kỳ.</Empty> : (
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ position: "relative" }}>
                <Donut data={donut} size={170} thick={26} />
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
                  <div><div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>Thực chi</div><div className="tnum" style={{ fontSize: 14, fontWeight: 800 }}>{fmtShort(itemBase)}</div></div>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                {donut.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", borderBottom: i < donut.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.label}{d.count > 1 ? <span style={{ color: "var(--ink-4)" }}> ×{d.count}</span> : ""}
                      {d.material && <span title="Vật tư" style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 700, color: "#7c5b16", background: "#fbf0d3", padding: "0 5px", borderRadius: 999 }}>VT</span>}
                    </span>
                    <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600 }}>{fmtVND(d.value)}</span>
                    <span className="tnum" style={{ fontSize: 11.5, color: "var(--ink-4)", width: 40, textAlign: "right" }}>{pctOf(d.value, itemBase)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
          <CardTitle icon="bi-distribute-vertical">Cơ cấu</CardTitle>
          <SplitBar title="Thực chi tiền vs Khấu hao" note="khấu hao không phải tiền chi ra"
            a={{ label: "Thực chi", value: cash, color: "#2a6fdb" }} b={{ label: "Khấu hao", value: totals.deprec || 0, color: "#e08600" }} />
          <SplitBar title="Vật tư vs Dịch vụ" note="theo cờ Vật tư của phiếu chi"
            a={{ label: "Vật tư", value: split.material || 0, color: "#7c5b16" }} b={{ label: "Dịch vụ / khác", value: split.service || 0, color: "#0891b2" }} />
          <SplitBar title="Xe vs Tài sản" note="gồm cả khấu hao"
            a={{ label: "Xe", value: split.vehicle || 0, color: "var(--accent)" }} b={{ label: "Tài sản", value: split.asset || 0, color: "#c9a227" }} />
        </div>
      </div>

      {/* 4. Xe / tài sản tốn nhất */}
      <div style={card}>
        <CardTitle icon="bi-bar-chart-steps" sub="bấm 1 dòng để xem chi tiết">Top {top.length} xe / tài sản tốn nhất kỳ</CardTitle>
        {!top.length ? <Empty>Không có xe/tài sản nào phát sinh trong kỳ.</Empty> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {top.map((r) => {
              const avg = avgKind[r.kind] || 0;
              const ratio = avg ? r.total / avg : 0;
              return (
                <div key={r.id} onClick={() => onOpenVehicle(r.id)} title="Xem chi tiết"
                  style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "230px 1fr 120px 130px", gap: 10, alignItems: "center", padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--line-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <AssetName row={r} />
                  {!isMobile && (
                    <div style={{ display: "flex", height: 16, borderRadius: 5, overflow: "hidden", background: "var(--line-2)" }}>
                      <div style={{ width: (r.total / maxTop * 100) + "%", display: "flex", minWidth: 2 }}>
                        {COLS.map((c) => { const w = (r[c.k] || 0) * 100 / (r.total || 1); return w > 0 ? <div key={c.k} title={`${c.label}: ${fmtVND(r[c.k])}`} style={{ width: w + "%", background: c.color }} /> : null; })}
                      </div>
                    </div>
                  )}
                  <div className="tnum" style={{ textAlign: "right", fontWeight: 700, fontSize: 13 }}>{fmtVND(r.total)}</div>
                  {!isMobile && (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, alignItems: "center" }}>
                      <Delta cur={r.total} prev={r.prevTotal} />
                      {ratio >= 1.5 && <span className="tnum" title={`Trung bình mỗi ${r.kind === "asset" ? "tài sản" : "xe"} trong kỳ: ${fmtVND(Math.round(avg))}`} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--danger)", background: "#fdecec", padding: "1px 7px", borderRadius: 999 }}>×{ratio.toFixed(1)} TB</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Cần xử lý */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 14 }}>
        <div style={card}>
          <CardTitle icon="bi-exclamation-triangle-fill" sub={`≤ ${rep.warnDays || 30} ngày`}>Giấy tờ & khoản định kỳ đến hạn</CardTitle>
          {!docs.length && !recurring.length ? <Empty><i className="bi bi-check-circle" style={{ color: "var(--good)" }} /> Không có gì sắp đến hạn.</Empty> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 260, overflowY: "auto" }}>
              {docs.map((d, i) => (
                <a key={"d" + i} href={fleetLink(routes.fleet, d, "info")} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, textDecoration: "none", color: "inherit" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: dayColor(d.days), flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>{d.type}</b> · <span className="tnum">{d.plate}</span>{d.name && d.name !== d.plate ? <span style={{ color: "var(--ink-4)" }}> {d.name}</span> : null}</span>
                  <span className="tnum" style={{ fontSize: 11.5, color: dayColor(d.days), fontWeight: 700, whiteSpace: "nowrap" }}>{fmtDate(d.dueDate)} · {dayLabel(d.days)}</span>
                </a>
              ))}
              {recurring.map((d, i) => (
                <a key={"r" + i} href={fleetLink(routes.fleet, { kind: "vehicle", hashid: d.hashid }, "cost")} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, textDecoration: "none", color: "inherit" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: dayColor(d.days), flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name} · <span className="tnum">{d.plate}</span> <span className="tnum" style={{ color: "var(--ink-4)" }}>{fmtShort(d.amount)}</span></span>
                  <span className="tnum" style={{ fontSize: 11.5, color: dayColor(d.days), fontWeight: 700, whiteSpace: "nowrap" }}>{fmtDate(d.dueDate)} · {dayLabel(d.days)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
        <div style={card}>
          <CardTitle icon="bi-hourglass-split">Phiếu chi chờ xử lý</CardTitle>
          {!pending.count ? <Empty><i className="bi bi-check-circle" style={{ color: "var(--good)" }} /> Mọi phiếu đã duyệt & thanh toán.</Empty> : (
            <div>
              <div className="tnum" style={{ fontSize: 24, fontWeight: 800, color: "var(--warn)" }}>{pending.count} phiếu</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>chưa duyệt hoặc chưa thanh toán · tổng <b className="tnum" style={{ color: "var(--ink)" }}>{fmtVND(pending.amount)}</b></div>
              {routes.costManagement && <a href={routes.costManagement} className="ke-noprint" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}><i className="bi bi-arrow-right-circle" /> Mở Quản lý chi phí để duyệt / chi</a>}
            </div>
          )}
        </div>
        <div style={card}>
          <CardTitle icon="bi-calendar-check" right={<button type="button" onClick={onGoRegister} className="ke-noprint" style={{ fontSize: 12, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", fontWeight: 600 }}>Sổ tài sản →</button>}>Khấu hao</CardTitle>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
            <div><div className="tnum" style={{ fontSize: 20, fontWeight: 800, color: "var(--good)" }}>{reg.active || 0}</div><div style={{ color: "var(--ink-4)" }}>đang khấu hao</div></div>
            <div><div className="tnum" style={{ fontSize: 20, fontWeight: 800, color: reg.soon ? "var(--warn)" : "var(--ink-3)" }}>{reg.soon || 0}</div><div style={{ color: "var(--ink-4)" }}>sắp hết (≤ 3 th)</div></div>
            <div><div className="tnum" style={{ fontSize: 20, fontWeight: 800, color: "var(--ink-3)" }}>{reg.done || 0}</div><div style={{ color: "var(--ink-4)" }}>đã hết khấu hao</div></div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 10 }}>Khấu hao tháng này: <b className="tnum" style={{ color: "var(--ink)" }}>{fmtVND(reg.monthly)}</b></div>
          {soonItems.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {soonItems.slice(0, 5).map((r, i) => (
                <div key={i} style={{ fontSize: 12, display: "flex", gap: 8, justifyContent: "space-between" }}>
                  <span><span className="tnum" style={{ fontWeight: 700 }}>{r.plate}</span>{r.name && r.name !== r.plate ? <span style={{ color: "var(--ink-4)" }}> {r.name}</span> : null}</span>
                  <span className="tnum" style={{ color: "var(--warn)", fontWeight: 700 }}>hết {fmtDate(r.endDate)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 6. Nhà cung cấp */}
      {suppliers.length > 0 && (
        <div style={card}>
          <CardTitle icon="bi-shop" sub="theo trường Nhà cung cấp của phiếu chi trong kỳ">Chi nhiều nhất cho nhà cung cấp nào</CardTitle>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "6px 26px" }}>
            {suppliers.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, fontSize: 12.5, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
                <div style={{ width: 110, background: "var(--line-2)", borderRadius: 5, height: 12, overflow: "hidden" }}>
                  <div style={{ width: (s.amount / maxSup * 100) + "%", height: "100%", background: "var(--accent)", minWidth: 2 }} />
                </div>
                <span className="tnum" style={{ width: 100, textAlign: "right", fontSize: 12.5, fontWeight: 700 }}>{fmtVND(s.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.6 }}>
        <i className="bi bi-info-circle" /> <b style={{ color: "var(--ink-3)" }}>Chi phí thường</b> = phiếu chi không phân bổ, theo <b>Ngày chi</b> trong kỳ (bỏ phiếu đã hủy).
        <b style={{ color: "var(--ink-3)" }}> Phân bổ</b> = (Số tiền ÷ số tháng) × số tháng rơi trong kỳ.
        <b style={{ color: "var(--ink-3)" }}> Khấu hao</b> = Nguyên giá ÷ (30 × số tháng) × số ngày trong kỳ — là chi phí sổ sách, <b>không phải tiền chi ra</b>.
        "So kỳ trước" = so với khoảng cùng số tháng ngay trước kỳ chọn. Chỉ tính phần <b>đã phát sinh đến hôm nay</b>.
      </div>
    </div>
  );
}
