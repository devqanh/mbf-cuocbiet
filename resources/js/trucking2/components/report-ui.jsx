import React from "react";
import { fmtVND, fmtShort } from "@trk/lib.jsx";

/* Mảnh UI dùng chung cho các trang BÁO CÁO (/bao-cao, /bao-cao-tai-san): thẻ, KPI, chênh lệch kỳ trước,
   thanh cơ cấu, danh sách top. Biểu đồ SVG ở charts.jsx. */

export const card = { background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: 16 };
export const pctOf = (a, b) => (b ? Math.round((a || 0) * 100 / b) : 0);

export function CardTitle({ icon, children, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, flex: 1, minWidth: 0 }}>
        {icon && <i className={"bi " + icon} style={{ color: "var(--accent)", marginRight: 6 }} />}{children}
        {sub && <span style={{ fontWeight: 400, fontSize: 12, color: "var(--ink-4)", marginLeft: 6 }}>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

/* Chênh lệch so kỳ trước. goodWhen="down" (mặc định, cho CHI PHÍ): tăng = đỏ, giảm = xanh.
   goodWhen="up" (doanh thu / lợi nhuận / sản lượng): tăng = xanh, giảm = đỏ. */
export function Delta({ cur, prev, size = 11.5, goodWhen = "down", label }) {
  if (prev == null) return null;
  const c = cur || 0, p = prev || 0;
  const wrap = (txt, color, title) => <span className="tnum" title={title} style={{ fontSize: size, fontWeight: 700, color, whiteSpace: "nowrap" }}>{txt}{label ? <span style={{ fontWeight: 500, color: "var(--ink-4)" }}> {label}</span> : null}</span>;
  if (!p && !c) return wrap("—", "var(--ink-4)", "");
  if (!p) return wrap("mới", "var(--ink-4)", "Kỳ trước không phát sinh");
  const pct = Math.round((c - p) * 100 / Math.abs(p));
  const up = pct > 0, flat = pct === 0;
  const good = flat ? null : (goodWhen === "up" ? up : !up);
  const color = flat ? "var(--ink-4)" : good ? "var(--good)" : "var(--danger)";
  return wrap((flat ? "= " : up ? "▲ +" : "▼ −") + Math.abs(pct) + "%", color, `Kỳ trước: ${fmtVND(p)}`);
}

export function KPI({ label, value, sub, color, cur, prev, hint, goodWhen, deltaLabel }) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 15px" }} title={hint || ""}>
      <div style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
        <div className="tnum" style={{ fontSize: 20, fontWeight: 800, color: color || "var(--ink)" }}>{value}</div>
        {prev != null && <Delta cur={cur} prev={prev} size={12} goodWhen={goodWhen} label={deltaLabel} />}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 3, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

export const Empty = ({ children }) => <div style={{ fontSize: 12.5, color: "var(--ink-4)", padding: "8px 0" }}>{children}</div>;

/* Thanh chia 2 phần (vd Vật tư | Dịch vụ) */
export function SplitBar({ title, a, b, note }) {
  const t = (a.value || 0) + (b.value || 0);
  const pa = pctOf(a.value, t), pb = t ? 100 - pa : 0;
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)", marginBottom: 6 }}>{title}{note && <span style={{ fontWeight: 400, color: "var(--ink-4)", marginLeft: 6, fontSize: 11 }}>{note}</span>}</div>
      <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "var(--line-2)" }}>
        {t > 0 && <div style={{ width: pa + "%", background: a.color }} />}
        {t > 0 && <div style={{ width: pb + "%", background: b.color }} />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6, fontSize: 12 }}>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: a.color, borderRadius: 2, marginRight: 5 }} />{a.label} <b className="tnum">{fmtShort(a.value)}</b> <span className="tnum" style={{ color: "var(--ink-4)" }}>({pa}%)</span></span>
        <span style={{ textAlign: "right" }}><span style={{ display: "inline-block", width: 9, height: 9, background: b.color, borderRadius: 2, marginRight: 5 }} />{b.label} <b className="tnum">{fmtShort(b.value)}</b> <span className="tnum" style={{ color: "var(--ink-4)" }}>({pb}%)</span></span>
      </div>
    </div>
  );
}

/* Thanh cơ cấu N phần + chú giải: segments [{label, value, color}] */
export function Stacked({ segments, height = 16 }) {
  const t = segments.reduce((s, x) => s + (x.value || 0), 0);
  return (
    <div>
      <div style={{ display: "flex", height, borderRadius: 999, overflow: "hidden", background: "var(--line-2)" }}>
        {t > 0 && segments.map((x, i) => (x.value > 0 ? <div key={i} title={`${x.label}: ${fmtVND(x.value)}`} style={{ width: (x.value * 100 / t) + "%", background: x.color }} /> : null))}
      </div>
      <div style={{ display: "flex", gap: "6px 16px", flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
        {segments.map((x, i) => (
          <span key={i}><span style={{ display: "inline-block", width: 9, height: 9, background: x.color, borderRadius: 2, marginRight: 5 }} />{x.label} <b className="tnum">{fmtShort(x.value)}</b> <span className="tnum" style={{ color: "var(--ink-4)" }}>({pctOf(x.value, t)}%)</span></span>
        ))}
      </div>
    </div>
  );
}

/* Danh sách top — bar CSS ngang. data: [{label, count}] ; fmt = cách hiện số (mặc định số + unit) */
export function TopList({ title, icon, data, unit, fmt, max: maxN = 8, sub }) {
  const top = (data || []).slice(0, maxN);
  const max = Math.max(1, ...top.map((d) => d.count));
  return (
    <div style={{ ...card, flex: 1, minWidth: 300 }}>
      {title && <CardTitle icon={icon} sub={sub}>{title}</CardTitle>}
      {top.length === 0 ? <Empty>Không có dữ liệu.</Empty> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {top.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="tnum" style={{ flex: 1, fontSize: 12.5, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={d.label}>{d.label}</span>
              <div style={{ width: 120, background: "var(--line-2)", borderRadius: 5, height: 16, overflow: "hidden" }}>
                <div style={{ width: (d.count / max * 100) + "%", height: "100%", background: "var(--accent)", borderRadius: 5, minWidth: 2 }} />
              </div>
              <span className="tnum" style={{ width: fmt ? 96 : 64, textAlign: "right", fontSize: 12.5, fontWeight: 700 }}>{fmt ? fmt(d.count) : `${d.count} ${unit || ""}`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
