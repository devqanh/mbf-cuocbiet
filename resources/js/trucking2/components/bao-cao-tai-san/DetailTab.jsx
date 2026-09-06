import React from "react";
import { fmtVND, fmtNum, fmtShort } from "@trk/lib.jsx";
import { COLS, Delta, AssetName, MiniBar } from "./parts.jsx";

const { useState, useEffect, useRef } = React;

/* TAB CHI TIẾT THEO XE — bảng từng xe/tài sản trong kỳ (giữ cách tính cũ) + so kỳ trước, cont/CP-cont,
   giá trị còn lại; sắp xếp theo cột; bấm dòng mở chi tiết 3 nhóm (thường / phân bổ / khấu hao). */

const SORT_KEYS = { plate: 1, costNormal: -1, costAlloc: -1, deprec: -1, total: -1, prevTotal: -1, conts: -1, perCont: -1, nbv: -1 };

export function DetailTab({ rep, isMobile, routes, focusId, onFocused }) {
  const [open, setOpen] = useState(() => new Set());   // xe đang mở chi tiết
  const [kind, setKind] = useState("all");             // all | vehicle | asset
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "total", dir: -1 });
  const focusRef = useRef(null);

  // Mở từ Tổng quan (bấm 1 xe ở Top): tự mở dòng + cuộn tới.
  useEffect(() => {
    if (focusId == null) return;
    setKind("all"); setQ("");
    setOpen((s) => new Set(s).add(focusId));
    setTimeout(() => { try { focusRef.current && focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} onFocused && onFocused(); }, 60);
  }, [focusId]);

  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ql = q.trim().toLowerCase();
  const rows = (rep.rows || [])
    .filter((r) => (kind === "all" || r.kind === kind) && (!ql || (r.plate || "").toLowerCase().includes(ql) || (r.name || "").toLowerCase().includes(ql)))
    .sort((a, b) => {
      const k = sort.key;
      if (k === "plate") return sort.dir * String(a.plate).localeCompare(String(b.plate), "vi");
      return sort.dir * ((a[k] || 0) - (b[k] || 0)) || b.total - a.total;
    });
  const shownTot = rows.reduce((a, r) => ({
    costNormal: a.costNormal + r.costNormal, costAlloc: a.costAlloc + r.costAlloc, deprec: a.deprec + r.deprec, total: a.total + r.total,
    prevTotal: a.prevTotal + (r.prevTotal || 0), conts: a.conts + (r.conts || 0), nbv: a.nbv + (r.nbv || 0),
  }), { costNormal: 0, costAlloc: 0, deprec: 0, total: 0, prevTotal: 0, conts: 0, nbv: 0 });

  const setSortKey = (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: SORT_KEYS[k] || -1 }));
  const cellR = { padding: "10px 12px", textAlign: "right", borderBottom: "1px solid var(--line-2)", whiteSpace: "nowrap" };
  const th = (label, key, al, title) => {
    const on = sort.key === key;
    return (
      <th key={key} onClick={() => setSortKey(key)} title={title || "Bấm để sắp xếp"}
        style={{ textAlign: al || "left", padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: on ? "var(--accent)" : "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", background: "#fafbfc", position: "sticky", top: 0, zIndex: 1, cursor: "pointer", userSelect: "none" }}>
        {label}{on && <i className={"bi " + (sort.dir < 0 ? "bi-caret-down-fill" : "bi-caret-up-fill")} style={{ fontSize: 9, marginLeft: 4 }} />}
      </th>
    );
  };
  const box = { background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" };
  const line = (i) => ({ fontSize: 12.5, padding: "4px 0", borderTop: i ? "1px solid var(--line-2)" : "none" });

  const detail = (row) => (
    <tr key={row.id + "-d"}>
      <td colSpan={9} style={{ padding: 0, background: "#fafbfc", borderBottom: "1px solid var(--line)" }}>
        <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
          <div style={box}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: COLS[0].color, marginBottom: 6 }}>CHI PHÍ THƯỜNG · {fmtVND(row.costNormal)}</div>
            {row.costItems.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Không phát sinh.</div>}
            {row.costItems.map((it, i) => (
              <div key={i} style={{ ...line(i), display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "var(--ink-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.name}{it.count > 1 ? <span style={{ color: "var(--ink-4)" }}> ×{it.count}</span> : ""}
                  {it.material && <span title="Vật tư" style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 700, color: "#7c5b16", background: "#fbf0d3", padding: "0 5px", borderRadius: 999 }}>VT</span>}
                </span>
                <b className="tnum" style={{ whiteSpace: "nowrap" }}>{fmtNum(it.amount)}</b>
              </div>
            ))}
          </div>
          <div style={box}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: COLS[1].color, marginBottom: 6 }}>CHI PHÍ PHÂN BỔ · {fmtVND(row.costAlloc)}</div>
            {row.allocItems.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Không phát sinh.</div>}
            {row.allocItems.map((it, i) => (
              <div key={i} style={line(i)}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--ink-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                  <b className="tnum" style={{ whiteSpace: "nowrap" }}>{fmtNum(it.inPeriod)}</b>
                </div>
                <div className="tnum" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{fmtNum(it.amount)} ÷ {it.months} th = {fmtNum(it.perMonth)}/th × {it.monthsInPeriod} th trong kỳ</div>
              </div>
            ))}
          </div>
          <div style={box}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: COLS[2].color, marginBottom: 6 }}>KHẤU HAO · {fmtVND(row.deprec)}</div>
            {row.deprecItems.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Không phát sinh.</div>}
            {row.deprecItems.map((it, i) => (
              <div key={i} style={line(i)}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--ink-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                  <b className="tnum" style={{ whiteSpace: "nowrap" }}>{fmtNum(it.inPeriod)}</b>
                </div>
                <div className="tnum" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>NG {fmtShort(it.origPrice)} ÷ (30×{it.months}) = {fmtNum(it.perDay)}/ngày × {it.daysInPeriod} ngày</div>
              </div>
            ))}
            {row.nbv > 0 && <div className="tnum" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--line)" }}>Giá trị còn lại đến hôm nay: <b style={{ color: "var(--good)" }}>{fmtVND(row.nbv)}</b> / NG {fmtShort(row.origPrice)}</div>}
          </div>
        </div>
      </td>
    </tr>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="ke-noprint" style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        {[["all", "Tất cả"], ["vehicle", "Xe"], ["asset", "Tài sản"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            style={{ padding: "6px 11px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: "pointer",
              border: "1px solid " + (kind === k ? "var(--accent)" : "var(--line)"), background: kind === k ? "var(--accent-weak-2)" : "#fff", color: kind === k ? "var(--accent)" : "var(--ink-3)" }}>{l}</button>
        ))}
        <div style={{ position: "relative", width: isMobile ? "100%" : 220 }}>
          <i className="bi bi-search" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: 12 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm biển số / tên tài sản…"
            style={{ width: "100%", padding: "7px 12px 7px 30px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none" }} />
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{rows.length} xe/tài sản · bấm tiêu đề cột để sắp xếp · bấm dòng để xem chi tiết</span>
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1080 }}>
            <thead><tr>
              {th("Xe / Tài sản", "plate")}
              <th style={{ padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "1px solid var(--line)", background: "#fafbfc", position: "sticky", top: 0, zIndex: 1, textAlign: "left" }}>Cơ cấu</th>
              {th("Chi phí thường", "costNormal", "right")}{th("Phân bổ", "costAlloc", "right")}{th("Khấu hao", "deprec", "right")}{th("Tổng", "total", "right")}
              {th("So kỳ trước", "prevTotal", "right", "Tổng kỳ trước (cùng số tháng) và % thay đổi")}
              {th("Cont · CP/cont", "conts", "right", "Số cont kéo trong kỳ (lô gắn BKS vào, có giờ xe ra) và chi phí bình quân mỗi cont")}
              {th("Còn lại", "nbv", "right", "Giá trị còn lại sau khấu hao, tính đến hôm nay")}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} style={{ padding: 34, textAlign: "center", color: "var(--ink-4)" }}>Không có xe/tài sản nào phát sinh trong kỳ.</td></tr>}
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr ref={r.id === focusId ? focusRef : null} onClick={() => toggle(r.id)} style={{ cursor: "pointer", background: open.has(r.id) ? "var(--accent-weak-2)" : "transparent" }}>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--line-2)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <i className={"bi " + (open.has(r.id) ? "bi-chevron-down" : "bi-chevron-right")} style={{ fontSize: 11, color: "var(--ink-4)" }} />
                        <AssetName row={r} fleetUrl={routes.fleet} />
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--line-2)", width: 120 }}><MiniBar row={r} /></td>
                    <td className="tnum" style={{ ...cellR, color: COLS[0].color, fontWeight: 600 }}>{r.costNormal ? fmtNum(r.costNormal) : "—"}</td>
                    <td className="tnum" style={{ ...cellR, color: COLS[1].color, fontWeight: 600 }}>{r.costAlloc ? fmtNum(r.costAlloc) : "—"}</td>
                    <td className="tnum" style={{ ...cellR, color: COLS[2].color, fontWeight: 600 }}>{r.deprec ? fmtNum(r.deprec) : "—"}</td>
                    <td className="tnum" style={{ ...cellR, fontWeight: 800 }}>{fmtNum(r.total)}</td>
                    <td className="tnum" style={{ ...cellR }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                        <Delta cur={r.total} prev={r.prevTotal} />
                        <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{r.prevTotal ? fmtShort(r.prevTotal) : ""}</span>
                      </div>
                    </td>
                    <td className="tnum" style={{ ...cellR }}>
                      {r.conts ? <><b>{r.conts}</b> <span style={{ color: "var(--ink-4)", fontSize: 11.5 }}>· {fmtShort(r.perCont)}/cont</span></> : <span style={{ color: "var(--ink-4)" }}>—</span>}
                    </td>
                    <td className="tnum" style={{ ...cellR, color: r.nbv ? "var(--good)" : "var(--ink-4)", fontWeight: 600 }}>{r.nbv ? fmtNum(r.nbv) : "—"}</td>
                  </tr>
                  {open.has(r.id) && detail(r)}
                </React.Fragment>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr style={{ background: "#fafbfc" }}>
                <td colSpan={2} style={{ padding: "11px 12px", fontWeight: 800, borderTop: "2px solid var(--line)" }}>TỔNG CỘNG · {rows.length} xe/tài sản</td>
                {COLS.map((c) => <td key={c.k} className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: c.color }}>{fmtNum(shownTot[c.k])}</td>)}
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, fontSize: 14 }}>{fmtNum(shownTot.total)}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)" }}><Delta cur={shownTot.total} prev={shownTot.prevTotal} /></td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 700 }}>{shownTot.conts || "—"}</td>
                <td className="tnum" style={{ ...cellR, borderTop: "2px solid var(--line)", fontWeight: 800, color: "var(--good)" }}>{shownTot.nbv ? fmtNum(shownTot.nbv) : "—"}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
