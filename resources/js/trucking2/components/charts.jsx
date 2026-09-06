import React from "react";

/* Biểu đồ dùng chung cho các trang báo cáo — SVG/CSS thuần, KHÔNG thư viện. */

export const PALETTE = ["#2a6fdb", "#1f8a5b", "#e08600", "#9333ea", "#dc2626", "#0891b2", "#65a30d", "#db2777", "#64748b"];

/* Donut SVG — data: [{label,value,color}] */
export function Donut({ data, size = 190, thick = 28 }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thick) / 2; const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <g transform={`translate(${size / 2},${size / 2}) rotate(-90)`}>
        <circle r={r} fill="none" stroke="var(--line-2)" strokeWidth={thick} />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const el = <circle key={i} r={r} fill="none" stroke={d.color} strokeWidth={thick} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} strokeLinecap="butt" />;
          acc += len; return el;
        })}
      </g>
    </svg>
  );
}
