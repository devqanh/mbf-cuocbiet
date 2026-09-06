import React from "react";
import { useIsMobile } from "@trk/lib.jsx";
import { ymNow, ymLabel, MonthYear } from "./parts.jsx";
import { OverviewTab } from "./OverviewTab.jsx";
import { DetailTab } from "./DetailTab.jsx";
import { RegisterTab } from "./RegisterTab.jsx";

const { useState, useEffect, useRef } = React;

/* BÁO CÁO TÀI SẢN — 3 tab: Tổng quan (sếp xem) · Chi tiết theo xe · Sổ tài sản (khấu hao đến hôm nay).
   Kỳ chọn theo THÁNG (từ → đến) áp cho 2 tab đầu; tab Sổ tài sản độc lập kỳ. */

const T = window.__TRK || {};
const ROUTES = T.routes || {};
const B = T.boot || {};
const TAB_KEY = "trk:bctaisan:tab";
const TABS = [["overview", "Tổng quan", "bi-speedometer2"], ["detail", "Chi tiết theo xe", "bi-table"], ["register", "Sổ tài sản", "bi-journal-bookmark"]];

export function AssetReportApp() {
  const isMobile = useIsMobile();
  const [from, setFrom] = useState((B.report && B.report.from) || ymNow());
  const [to, setTo] = useState((B.report && B.report.to) || ymNow());
  const [rep, setRep] = useState(B.report || { rows: [], totals: {}, months: 1 });
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem(TAB_KEY); return TABS.some(([k]) => k === t) ? t : "overview"; } catch (e) { return "overview"; } });
  const [focusId, setFocusId] = useState(null);   // xe cần mở ở tab Chi tiết (bấm từ Tổng quan)
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch (e) {} }, [tab]);

  const load = (f, t) => {
    setLoading(true);
    window.trkApi("GET", ROUTES.data + "?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t))
      .then((r) => { if (r && r.ok) setRep(r.report); setLoading(false); })
      .catch(() => { setLoading(false); window.trkToast && window.trkToast("Lỗi tải báo cáo", "error"); });
  };
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } load(from, to); }, [from, to]);

  const openVehicle = (id) => { setFocusId(id); setTab("detail"); };
  const periodLabel = rep.from === rep.to ? `Tháng ${ymLabel(rep.from)}` : `${ymLabel(rep.from)} → ${ymLabel(rep.to)} (${rep.months} tháng)`;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <style>{`@media print { .trk-report-scroll { overflow: visible !important; height: auto !important; } }`}</style>
      <header className="ke-noprint" style={{ background: "#fff", borderBottom: "1px solid var(--line)", padding: isMobile ? "10px 14px" : "0 22px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, height: isMobile ? "auto" : 58, flexWrap: "wrap", padding: isMobile ? "4px 0" : 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}><i className="bi bi-truck-front-fill" /></div>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 700 }}>Báo cáo tài sản</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Chi phí · phân bổ · khấu hao · giá trị còn lại của xe & tài sản</div>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600 }}>Từ tháng</span>
          <MonthYear value={from} onChange={setFrom} />
          <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600 }}>đến</span>
          <MonthYear value={to} onChange={setTo} />
          {loading && <span style={{ fontSize: 12, color: "var(--ink-4)" }}><i className="bi bi-arrow-repeat" style={{ animation: "trk-spin .7s linear infinite" }} /> Đang tính…</span>}
          <button type="button" onClick={() => window.print()} title="In / xuất PDF tab đang xem"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, border: "1px solid var(--line)", borderRadius: 9, background: "#fff", color: "var(--ink-2)", cursor: "pointer" }}>
            <i className="bi bi-printer" /> In
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "0 0 10px" }}>
          <div style={{ display: "inline-flex", background: "#f1f2f4", borderRadius: 9, padding: 3 }}>
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
            {tab === "register" ? <>Sổ tài sản tính đến <b style={{ color: "var(--ink-3)" }}>hôm nay</b> — không phụ thuộc kỳ chọn</> : <>Kỳ <b style={{ color: "var(--ink-3)" }}>{periodLabel}</b> · {(rep.totals || {}).vehicles || 0} xe/tài sản phát sinh</>}
          </span>
        </div>
      </header>

      <div className="ke-print trk-report-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "16px 22px 28px", opacity: loading ? 0.55 : 1 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          {/* Tiêu đề chỉ hiện khi in (header bị ẩn) */}
          <div className="ke-printonly" style={{ display: "none", marginBottom: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Báo cáo tài sản — {TABS.find(([k]) => k === tab)[1]}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{tab === "register" ? "Tính đến " + new Date().toLocaleDateString("vi-VN") : "Kỳ " + periodLabel} · in ngày {new Date().toLocaleDateString("vi-VN")}</div>
          </div>
          {tab === "overview" && <OverviewTab rep={rep} isMobile={isMobile} routes={ROUTES} onOpenVehicle={openVehicle} onGoRegister={() => setTab("register")} />}
          {tab === "detail" && <DetailTab rep={rep} isMobile={isMobile} routes={ROUTES} focusId={focusId} onFocused={() => setFocusId(null)} />}
          {tab === "register" && <RegisterTab rep={rep} isMobile={isMobile} routes={ROUTES} />}
        </div>
      </div>
    </div>
  );
}
