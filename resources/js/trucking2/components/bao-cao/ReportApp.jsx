import React from "react";
import { useIsMobile } from "@trk/lib.jsx";
import { OverviewTab } from "./OverviewTab.jsx";
import { FleetTab } from "./FleetTab.jsx";
import { CustomersTab } from "./CustomersTab.jsx";
import { TrendTab } from "./TrendTab.jsx";

const { useState, useEffect, useRef } = React;

/* BÁO CÁO CHI PHÍ CÔNG TY — theo THÁNG, 4 tab: Tổng quan (P&L cho sếp) · Đội xe · Khách & sản lượng · Xu hướng 12 tháng.
   Tháng trước được tải NGẦM (cache theo tháng) để hiện ▲▼ so tháng trước mà không làm chậm lần tải đầu. */

const T = window.__TRK || {};
const ROUTES = T.routes || {};
const B = T.boot || {};
const TAB_KEY = "trk:baocao:tab";
export const TABS = [["overview", "Tổng quan", "bi-speedometer2"], ["fleet", "Đội xe", "bi-truck"], ["customers", "Khách & sản lượng", "bi-people"], ["trend", "Xu hướng 12 tháng", "bi-graph-up"]];
const ymKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const prevOf = (y, m) => (m === 1 ? [y - 1, 12] : [y, m - 1]);
const btnIcon = { width: 32, height: 32, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 9, background: "#fff", color: "var(--ink-2)", cursor: "pointer", fontSize: 16 };

export function ReportApp() {
  const isMobile = useIsMobile();
  const init = B.report || {};
  const [year, setYear] = useState(init.year || new Date().getFullYear());
  const [month, setMonth] = useState(init.month || (new Date().getMonth() + 1));
  const [rep, setRep] = useState(init);
  const [prev, setPrev] = useState(null);         // báo cáo THÁNG TRƯỚC (so sánh) — tải ngầm
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem(TAB_KEY); return TABS.some(([k]) => k === t) ? t : "overview"; } catch (e) { return "overview"; } });
  const [trend, setTrend] = useState(null);       // 12 tháng — lazy khi mở tab (nặng: cộng route-pay theo ngày)
  const [trendLoading, setTrendLoading] = useState(false);
  const cache = useRef(new Map(init.year ? [[ymKey(init.year, init.month), init]] : []));   // ym → report
  const trendCache = useRef(new Map());           // ym kết → rows
  const reqId = useRef(0);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch (e) {} }, [tab]);

  const fetchMonth = (y, m) => {
    const k = ymKey(y, m);
    if (cache.current.has(k)) return Promise.resolve(cache.current.get(k));
    return window.trkApi("GET", ROUTES.data + `?year=${y}&month=${m}`).then((r) => {
      if (!(r && r.ok)) throw new Error("bad");
      cache.current.set(k, r.report); return r.report;
    });
  };
  const loadMonth = (y, m) => {
    const my = ++reqId.current;
    setYear(y); setMonth(m); setPrev(null);
    setLoading(true);
    fetchMonth(y, m)
      .then((r) => { if (my !== reqId.current) return; setRep(r); setLoading(false); })
      .catch(() => { if (my !== reqId.current) return; setLoading(false); window.trkToast && window.trkToast("Lỗi tải báo cáo", "error"); });
  };
  // Tháng trước: tải ngầm sau khi có tháng hiện tại (không chặn UI; lỗi thì bỏ qua — chỉ mất phần ▲▼).
  useEffect(() => {
    const [py, pm] = prevOf(year, month);
    let alive = true;
    fetchMonth(py, pm).then((r) => { if (alive) setPrev(r); }).catch(() => {});
    return () => { alive = false; };
  }, [year, month]);
  // Xu hướng: tải khi mở tab (cache theo tháng kết).
  useEffect(() => {
    if (tab !== "trend") return;
    const k = ymKey(year, month);
    if (trendCache.current.has(k)) { setTrend(trendCache.current.get(k)); return; }
    setTrend(null); setTrendLoading(true);
    window.trkApi("GET", ROUTES.trend + `?year=${year}&month=${month}`)
      .then((r) => { if (r && r.ok) { trendCache.current.set(k, r.rows || []); setTrend(r.rows || []); } setTrendLoading(false); })
      .catch(() => { setTrendLoading(false); window.trkToast && window.trkToast("Lỗi tải xu hướng", "error"); });
  }, [tab, year, month]);

  const shift = (n) => { let m = month + n, y = year; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } loadMonth(y, m); };
  const monthLabel = `${String(month).padStart(2, "0")}/${year}`;
  const [py, pm] = prevOf(year, month);
  const prevLabel = `${String(pm).padStart(2, "0")}/${py}`;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <style>{`@media print { .trk-report-scroll { overflow: visible !important; height: auto !important; } }`}</style>
      <header className="ke-noprint" style={{ background: "#fff", borderBottom: "1px solid var(--line)", padding: isMobile ? "10px 14px" : "0 22px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, height: isMobile ? "auto" : 58, flexWrap: "wrap", padding: isMobile ? "4px 0" : 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}><i className="bi bi-bar-chart-line-fill" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.1 }}>Báo cáo chi phí công ty</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Doanh thu · chi phí · lợi nhuận theo tháng</div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={() => shift(-1)} style={btnIcon} title="Tháng trước">‹</button>
            <span className="tnum" style={{ fontSize: 14, fontWeight: 700, minWidth: 90, textAlign: "center" }}>Tháng {monthLabel}</span>
            <button type="button" onClick={() => shift(1)} style={btnIcon} title="Tháng sau">›</button>
            <button type="button" onClick={() => { const d = new Date(); loadMonth(d.getFullYear(), d.getMonth() + 1); }} style={{ ...btnIcon, width: "auto", padding: "0 12px", fontSize: 13, fontWeight: 600 }}>Tháng này</button>
          </div>
          {loading && <span style={{ fontSize: 12, color: "var(--ink-4)" }}><i className="bi bi-arrow-repeat" style={{ animation: "trk-spin .7s linear infinite" }} /> Đang tính…</span>}
          <button type="button" onClick={() => window.print()} title="In / xuất PDF tab đang xem"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, border: "1px solid var(--line)", borderRadius: 9, background: "#fff", color: "var(--ink-2)", cursor: "pointer" }}>
            <i className="bi bi-printer" /> In
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "0 0 10px" }}>
          <div style={{ display: "inline-flex", background: "#f1f2f4", borderRadius: 9, padding: 3, flexWrap: "wrap" }}>
            {TABS.map(([k, l, ic]) => {
              const on = tab === k;
              return (
                <button key={k} type="button" onClick={() => setTab(k)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 13px", borderRadius: 7,
                    background: on ? "#fff" : "transparent", color: on ? "var(--ink)" : "var(--ink-3)", boxShadow: on ? "0 1px 2px rgba(16,19,23,.12)" : "none", transition: "all .12s" }}>
                  <i className={"bi " + ic} style={{ color: on ? "var(--accent)" : "var(--ink-4)", fontSize: 12 }} />{l}
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
            {prev ? <>So với tháng <b style={{ color: "var(--ink-3)" }}>{prevLabel}</b></> : <><i className="bi bi-arrow-repeat" style={{ animation: "trk-spin .9s linear infinite" }} /> đang tải tháng {prevLabel} để so sánh…</>}
          </span>
        </div>
      </header>

      <div className="ke-print trk-report-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "16px 22px 40px", opacity: loading ? 0.55 : 1 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div className="ke-printonly" style={{ display: "none", marginBottom: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Báo cáo chi phí công ty — {TABS.find(([k]) => k === tab)[1]}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Tháng {monthLabel} · in ngày {new Date().toLocaleDateString("vi-VN")}</div>
          </div>
          {tab === "overview" && <OverviewTab rep={rep} prev={prev} prevLabel={prevLabel} isMobile={isMobile} routes={ROUTES} onGoTab={setTab} />}
          {tab === "fleet" && <FleetTab rep={rep} prev={prev} isMobile={isMobile} routes={ROUTES} />}
          {tab === "customers" && <CustomersTab rep={rep} prev={prev} isMobile={isMobile} />}
          {tab === "trend" && <TrendTab rows={trend} loading={trendLoading} monthLabel={monthLabel} isMobile={isMobile} />}
        </div>
      </div>
    </div>
  );
}
