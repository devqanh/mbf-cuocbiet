import React from "react";
import { useIsMobile, I, Btn, Modal, DateField } from "@trk/lib.jsx";
import { PriceList } from "@trk/pop.jsx";
import { buildPriceBookWb } from "../components/price-excel.js";

// "Canon Thăng Long" → "canon-thang-long" (tên file không dấu, không khoảng trắng)
const slug = (s) => String(s || "")
  .normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "bang-gia";

const fmtBD = (s) => { if (!s) return ""; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };
const bookRange = (b) => (b && (b.from || b.to)) ? `${b.from ? fmtBD(b.from) : "…"} – ${b.to ? fmtBD(b.to) : "…"}` : "Mọi ngày";
// 2 khoảng [a.from,a.to] và [b.from,b.to] chồng nhau? (null = vô cực)
const overlap = (a, b) => (a.from === null || b.to === null || a.from <= b.to) && (b.from === null || a.to === null || b.from <= a.to);

// Khách + bảng giá đang xem lưu trong URL hash (#kh=<tên khách>&bg=<id book>) → reload / chia sẻ link vẫn đúng chỗ.
const readHash = () => {
  const p = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const bg = p.get("bg");
  return { kh: p.get("kh") || null, bg: bg != null && bg !== "" ? +bg : null };
};
const writeHash = (kh, bg) => {
  const p = new URLSearchParams();
  if (kh) p.set("kh", kh);
  if (bg != null) p.set("bg", String(bg));
  const s = p.toString();
  const url = s ? "#" + s : window.location.pathname + window.location.search;
  try { window.history.replaceState(null, "", url); } catch (e) { window.location.hash = s; }   // replaceState → không spam history
};

function BangGiaPage({ cfg, setBooks, api, routes }) {
  const { useState, useEffect, useRef } = React;
  const isMobile = useIsMobile();
  const customers = cfg.customers || [];
  const info = cfg.customerInfo || {};
  const hash0 = useRef(readHash()).current;   // hash lúc mở trang
  const [sel, setSel] = useState(() => (hash0.kh && customers.includes(hash0.kh) ? hash0.kh : (customers[0] || null)));
  const cur = sel != null && customers.includes(sel) ? sel : (customers[0] || null);
  const data = (cur && info[cur]) || {};
  const books = data.priceBooks || [];

  const [selBookId, setSelBookId] = useState(() => (books.some((b) => b.id === hash0.bg) ? hash0.bg : (books[0]?.id ?? null)));
  // Đổi khách → về bảng giá đầu tiên; riêng khi hash chỉ định book (mở link / back-forward) thì giữ đúng book đó.
  const wantBook = useRef(hash0.bg);
  useEffect(() => {
    const want = wantBook.current; wantBook.current = null;
    setSelBookId(books.some((b) => b.id === want) ? want : (books[0]?.id ?? null));
  }, [cur]);
  useEffect(() => { if ((selBookId == null || !books.some((b) => b.id === selBookId)) && books.length) setSelBookId(books[0].id); }, [books.length]);
  // Ghi lại hash mỗi khi đổi khách / đổi bảng giá (kể cả sau khi tạo, xóa book).
  useEffect(() => { writeHash(cur, selBookId); }, [cur, selBookId]);
  // Người dùng sửa URL / bấm back-forward → nhảy về đúng khách + bảng giá trong hash.
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (h.kh && customers.includes(h.kh) && h.kh !== cur) { wantBook.current = h.bg; setSel(h.kh); }
      else if (h.bg != null && h.bg !== selBookId) setSelBookId(h.bg);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [cur, selBookId, customers.length]);
  const curBook = books.find((b) => b.id === selBookId) || null;

  const [rowsByBook, setRowsByBook] = useState({});   // {bookId: rows[]}
  const [loadingRows, setLoadingRows] = useState(false);
  const [dirtyBook, setDirtyBook] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Lazy-load dòng giá của book đang chọn
  useEffect(() => {
    const id = curBook?.id;
    if (!id || rowsByBook[id] !== undefined) return;
    setLoadingRows(true);
    api("GET", routes.customerPrices + "?book=" + id)
      .then((r) => { if (r && r.ok) setRowsByBook((s) => ({ ...s, [id]: r.priceList || [] })); })
      .finally(() => setLoadingRows(false));
  }, [curBook && curBook.id]);

  const rows = curBook ? (rowsByBook[curBook.id] || []) : [];
  const loaded = curBook ? rowsByBook[curBook.id] !== undefined : false;
  const bumpCount = (id, n) => setBooks(cur, books.map((b) => (b.id === id ? { ...b, count: n } : b)));
  const setRows = (arr) => { if (!curBook) return; setRowsByBook((s) => ({ ...s, [curBook.id]: arr })); setDirtyBook(curBook.id); setMsg(""); };
  const onImported = (arr) => { if (!curBook) return; setRowsByBook((s) => ({ ...s, [curBook.id]: arr })); setDirtyBook(null); bumpCount(curBook.id, arr.length); };

  const saveBook = () => {
    if (!curBook || saving) return;
    setSaving(true); setMsg("");
    api("PUT", routes.priceBookCreate + "/" + curBook.id + "/rows", { rows })
      .then((r) => { setSaving(false);
        if (r && r.ok) { setDirtyBook(null); const pl = r.priceList || rows; setRowsByBook((s) => ({ ...s, [curBook.id]: pl })); bumpCount(curBook.id, pl.length); setMsg("Đã lưu"); }
        else setMsg((r && r.msg) || "Lưu lỗi"); })   // msg: nêu rõ ký hiệu nào chưa khai ánh xạ
      .catch(() => { setSaving(false); setMsg("Lưu lỗi kết nối"); });
  };

  // ----- Nhập báo giá gốc (.xlsx): popup chọn file → chọn sheet → KIỂM TRA (báo cáo) → Import -----
  const quoteRef = React.useRef(null);
  const [qm, setQm] = useState(null);   // {fileName, file, sheets[], sheet, report, checking, importing, err}
  const csrf = (window.__TRK || {}).csrf;
  const onQuoteFile = (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f || !curBook) return;
    // Đọc tên sheet phía client (XLSX có sẵn trên trang) để chọn trước khi gửi.
    let sheets = [];
    try {
      const rd = new FileReader();
      rd.onload = () => {
        try { const wb = window.XLSX.read(rd.result, { type: "array", bookSheets: true }); sheets = wb.SheetNames || []; } catch (er) { sheets = []; }
        const def = sheets.find((s) => s.toLowerCase().trim() === "import") || sheets[0] || "";
        setQm({ fileName: f.name, file: f, sheets, sheet: def, report: null, checking: false, importing: false, err: "" });
      };
      rd.readAsArrayBuffer(f);
    } catch (er) { setQm({ fileName: f.name, file: f, sheets: [], sheet: "", report: null, checking: false, importing: false, err: "" }); }
  };
  const quoteValidate = async () => {
    if (!qm || qm.checking) return;
    setQm((q) => ({ ...q, checking: true, report: null, err: "" }));
    try {
      const fd = new FormData(); fd.append("file", qm.file); if (qm.sheet) fd.append("sheet", qm.sheet);
      const r = await fetch(routes.priceQuoteValidate, { method: "POST", headers: { Accept: "application/json", "X-CSRF-TOKEN": csrf }, body: fd }).then((x) => x.json());
      setQm((q) => ({ ...q, checking: false, report: r, sheet: r.sheet || q.sheet, sheets: (r.sheets && r.sheets.length) ? r.sheets : q.sheets, err: r && r.ok ? "" : (r.msg || "Sheet không có dòng giá hợp lệ") }));
    } catch (er) { setQm((q) => ({ ...q, checking: false, err: "Lỗi kết nối khi kiểm tra" })); }
  };
  const quoteImport = async () => {
    if (!qm || !qm.report || !qm.report.ok || qm.importing || !curBook) return;
    if (rows.length > 0) {
      const ok = await window.confirmAction({ title: "Ghi đè bảng giá?", text: `Bảng giá đang chọn có <b>${rows.length}</b> dòng — nhập sẽ <b>GHI ĐÈ</b> toàn bộ bằng ${qm.report.total} dòng từ file. Tiếp tục?`, confirmText: "Ghi đè bằng file", danger: true });
      if (!ok) return;
    }
    setQm((q) => ({ ...q, importing: true }));
    try {
      const fd = new FormData(); fd.append("file", qm.file); fd.append("book", curBook.id); fd.append("sheet", qm.sheet || ""); fd.append("replace", "1");
      const res = await fetch(routes.priceQuoteImport, { method: "POST", headers: { Accept: "application/json", "X-CSRF-TOKEN": csrf }, body: fd }).then((x) => x.json());
      if (res && res.ok) { const pl = res.priceList || []; setRowsByBook((s) => ({ ...s, [curBook.id]: pl })); setDirtyBook(null); bumpCount(curBook.id, pl.length); const by = res.by || {}; setMsg(`Đã nhập ${res.imported} dòng (${Object.entries(by).map(([k, v]) => k + " " + v).join(", ")})`); setQm(null); }
      else setQm((q) => ({ ...q, importing: false, err: res && res.msg ? res.msg : "Nhập lỗi" }));
    } catch (er) { setQm((q) => ({ ...q, importing: false, err: "Lỗi kết nối khi nhập" })); }
  };

  // ----- Xuất Excel bảng giá đang xem (dùng chính dòng đang hiển thị, kể cả sửa chưa lưu) -----
  const exportBook = () => {
    if (!curBook || !loaded) return;
    const range = bookRange(curBook);
    const wb = buildPriceBookWb(rows, {
      customer: cur,
      label: curBook.label || "",
      range,
      sheetName: curBook.label || "Bảng giá",
      exportedAt: new Date().toLocaleString("vi-VN"),
    });
    const tag = curBook.label ? slug(curBook.label) : (curBook.from || curBook.to ? slug(range) : "moi-ngay");
    window.XLSX.writeFile(wb, `bang-gia-${slug(cur)}-${tag}.xlsx`);
  };

  // ----- CRUD book -----
  const [bm, setBm] = useState(null);   // {mode:'create'|'edit', id?, label, from, to}
  const submitBook = () => {
    if (!bm) return;
    const body = { label: bm.label || null, from: bm.from || null, to: bm.to || null };
    if (bm.mode === "create") {
      api("POST", routes.priceBookCreate, { customer: cur, ...body }).then((r) => {
        if (r && r.ok) { const bs = r.books || []; setBooks(cur, bs); const last = bs[bs.length - 1]; if (last) setSelBookId(last.id); setBm(null); }
      });
    } else {
      api("PUT", routes.priceBookCreate + "/" + bm.id, body).then((r) => {
        if (r && r.ok) { setBooks(cur, r.books || []); setBm(null); }
      });
    }
  };
  const delBook = async () => {
    if (!curBook) return;
    const ok = await window.confirmAction({ title: "Xóa bảng giá?", text: `Xóa bảng giá <b>${bookRange(curBook)}</b> cùng <b>${curBook.count || 0}</b> dòng giá. Không hoàn tác.`, confirmText: "Xóa bảng giá", danger: true });
    if (!ok) return;
    api("DELETE", routes.priceBookCreate + "/" + curBook.id).then((r) => { if (r && r.ok) { setBooks(cur, r.books || []); setSelBookId((r.books || [])[0]?.id ?? null); } });
  };

  // Cảnh báo các bảng giá chồng khoảng ngày (lô trong vùng chồng theo ưu tiên book cụ thể hơn)
  const overlapWarn = (() => {
    for (let i = 0; i < books.length; i++) for (let j = i + 1; j < books.length; j++) {
      const a = { from: books[i].from || null, to: books[i].to || null };
      const b = { from: books[j].from || null, to: books[j].to || null };
      if (overlap(a, b)) return true;
    }
    return false;
  })();

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
      {/* customer list */}
      <div style={{ width: isMobile ? "100%" : 240, flexShrink: 0, borderRight: isMobile ? "none" : "1px solid var(--line)", borderBottom: isMobile ? "1px solid var(--line)" : "none", background: "#fff", overflowY: isMobile ? "visible" : "auto", overflowX: isMobile ? "auto" : "visible", padding: isMobile ? "10px 12px" : "14px 12px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "2px 8px 8px" }}>Khách hàng</div>
        <div style={{ display: "flex", flexDirection: isMobile ? "row" : "column", gap: isMobile ? 7 : 1, flexWrap: isMobile ? "nowrap" : "wrap" }}>
          {customers.map((name) => {
            const active = cur === name;
            const ci = info[name] || {};
            const n = ci.priceCount || (ci.priceBooks || []).reduce((a, b) => a + (b.count || 0), 0);
            const nb = (ci.priceBooks || []).length;
            return (
              <button key={name} type="button" onClick={() => setSel(name)}
                style={{ textAlign: "left", border: isMobile ? "1px solid var(--line)" : "none", cursor: "pointer", borderRadius: isMobile ? 999 : 8, padding: "9px 11px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0, whiteSpace: "nowrap",
                  background: active ? "var(--accent-weak)" : (isMobile ? "#fff" : "transparent"), color: active ? "var(--accent)" : "var(--ink)", fontWeight: active ? 600 : 400, fontSize: 13.5 }}
                onMouseEnter={(e) => { if (!active && !isMobile) e.currentTarget.style.background = "var(--line-2)"; }}
                onMouseLeave={(e) => { if (!active && !isMobile) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                {nb > 0 && <span className="tnum" style={{ fontSize: 11, fontWeight: 600, color: active ? "var(--accent)" : "var(--ink-4)", background: active ? "#fff" : "var(--line-2)", padding: "1px 7px", borderRadius: 999 }} title={`${nb} bảng giá · ${n} dòng`}>{nb}</span>}
              </button>
            );
          })}
          {!customers.length && <div style={{ padding: "16px 8px", fontSize: 12.5, color: "var(--ink-4)" }}>Chưa có khách hàng. Thêm trong Cấu hình → Khách hàng.</div>}
        </div>
      </div>

      {/* price book + price list */}
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: isMobile ? "16px 14px 40px" : "24px 28px 40px" }}>
        {cur ? (
          <div style={{ maxWidth: 880, margin: "0 auto" }}>
            <div style={{ marginBottom: 14 }}>
              <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>Bảng giá</h1>
              <div style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 3 }}>{cur}{data.taxCode ? ` · MST ${data.taxCode}` : ""}</div>
            </div>

            {/* Thanh chọn BẢNG GIÁ (price book theo khoảng ngày) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {books.map((b) => {
                const on = b.id === selBookId;
                return (
                  <button key={b.id} type="button" onClick={() => setSelBookId(b.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                      border: "1px solid " + (on ? "var(--accent)" : "var(--line)"), background: on ? "var(--accent-weak-2)" : "#fff", color: on ? "var(--accent)" : "var(--ink-2)" }}>
                    <i className="bi bi-calendar3" style={{ opacity: .7 }} />
                    {b.label ? <b>{b.label}</b> : null} {bookRange(b)}
                    <span className="tnum" style={{ fontSize: 11, fontWeight: 700, background: on ? "var(--accent)" : "var(--line-2)", color: on ? "#fff" : "var(--ink-4)", padding: "0 6px", borderRadius: 999 }}>{b.count || 0}</span>
                  </button>
                );
              })}
              <button type="button" onClick={() => setBm({ mode: "create", label: "", from: "", to: "" })}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 600, border: "1px dashed var(--accent)", background: "var(--accent-weak-2)", color: "var(--accent)" }}>
                <I.plus /> Tạo bảng giá
              </button>
              {curBook && (
                <>
                  <button type="button" onClick={() => setBm({ mode: "edit", id: curBook.id, label: curBook.label || "", from: curBook.from || "", to: curBook.to || "" })}
                    title="Sửa khoảng ngày / nhãn" style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8, cursor: "pointer", border: "1px solid var(--line)", background: "#fff", color: "var(--ink-3)" }}><i className="bi bi-pencil" /></button>
                  <button type="button" onClick={delBook}
                    title="Xóa bảng giá" style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8, cursor: "pointer", border: "1px solid var(--line)", background: "#fff", color: "var(--ink-3)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#fce8e8"; e.currentTarget.style.color = "var(--danger)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "var(--ink-3)"; }}><I.trash /></button>
                </>
              )}
            </div>

            {overlapWarn && <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#9a6700", background: "#fff7e6", border: "1px solid #ffe1a8", borderRadius: 9, padding: "8px 12px", marginBottom: 12 }}><i className="bi bi-exclamation-triangle-fill" /> Có bảng giá <b>chồng khoảng ngày</b> — lô trong vùng chồng sẽ lấy bảng giá <b>cụ thể hơn</b> (có ngày, mới nhất).</div>}

            {curBook ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Đang sửa: <b style={{ color: "var(--ink)" }}>{bookRange(curBook)}</b></div>
                  <div style={{ flex: 1 }} />
                  {msg && <span style={{ fontSize: 12, fontWeight: 600, color: /lỗi|không/i.test(msg) ? "var(--danger)" : "var(--good)" }}>{msg}</span>}
                  {dirtyBook === curBook.id && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--warn)" }}><span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--warn)" }} /> Chưa lưu</span>}
                  <button type="button" onClick={exportBook} disabled={!loaded || !rows.length}
                    title="Tải bảng giá đang xem về file .xlsx để xem/đối chiếu (gồm cả sửa chưa lưu)"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, borderRadius: 9,
                      cursor: loaded && rows.length ? "pointer" : "default", opacity: loaded && rows.length ? 1 : 0.55,
                      border: "1px solid var(--line)", background: "#fff", color: "var(--ink-2)" }}>
                    <i className="bi bi-download" /> Xuất Excel
                  </button>
                  <input ref={quoteRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={onQuoteFile} />
                  <button type="button" onClick={() => quoteRef.current && quoteRef.current.click()}
                    title="Nhập từ file báo giá gốc (.xlsx) — chọn sheet, kiểm tra rồi mới import vào bảng giá này"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, cursor: "pointer", border: "1px solid var(--accent-weak)", background: "var(--accent-weak-2)", color: "var(--accent)" }}>
                    <i className="bi bi-filetype-xlsx" /> Nhập báo giá gốc
                  </button>
                  <button type="button" onClick={saveBook} disabled={saving || dirtyBook !== curBook.id}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 15px", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none",
                      cursor: dirtyBook === curBook.id && !saving ? "pointer" : "default", color: dirtyBook === curBook.id && !saving ? "#fff" : "var(--ink-4)", background: dirtyBook === curBook.id && !saving ? "var(--accent)" : "var(--line-2)" }}>
                    <I.check /> {saving ? "Đang lưu…" : "Lưu bảng giá"}
                  </button>
                </div>
                <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px" }}>
                  {loaded
                    ? <PriceList rows={rows} onChange={setRows} onImported={onImported} cfg={cfg} customer={cur} bookId={curBook.id} />
                    : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "40px", color: "var(--ink-4)", fontSize: 13.5 }}><i className="bi bi-arrow-repeat" style={{ animation: "trk-spin 0.7s linear infinite" }} /> Đang tải bảng giá…</div>}
                </div>
              </>
            ) : (
              <div style={{ display: "grid", placeItems: "center", padding: "50px", color: "var(--ink-4)", fontSize: 13.5, background: "#fff", border: "1px dashed var(--line)", borderRadius: 12 }}>
                Khách này chưa có bảng giá. Bấm <b style={{ margin: "0 4px" }}>Tạo bảng giá</b> để thêm (chọn khoảng ngày áp dụng).
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--ink-4)", fontSize: 13.5 }}>Chọn một khách hàng để xem bảng giá.</div>
        )}
      </div>

      {/* Modal tạo/sửa bảng giá */}
      {bm && (
        <Modal title={bm.mode === "create" ? "Tạo bảng giá" : "Sửa bảng giá"} subtitle="Để trống ngày = áp dụng mọi ngày (book mặc định)." width={440} icon={<I.truck />}
          onClose={() => setBm(null)}
          footer={<div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><Btn onClick={() => setBm(null)}>Hủy</Btn><Btn variant="primary" onClick={submitBook}>{bm.mode === "create" ? "Tạo" : "Lưu"}</Btn></div>}>
          <div style={{ padding: "14px 0 6px", display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "block" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 5 }}>Nhãn (tùy chọn)</div>
              <input value={bm.label} onChange={(e) => setBm({ ...bm, label: e.target.value })} placeholder="VD: Giá Q3/2026"
                style={{ width: "100%", fontSize: 14, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 9, outline: "none" }} />
            </label>
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 5 }}>Từ ngày</div>
                <DateField value={bm.from} onChange={(v) => setBm({ ...bm, from: v })} placeholder="Mọi ngày" />
              </label>
              <label style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 5 }}>Đến ngày</div>
                <DateField value={bm.to} onChange={(v) => setBm({ ...bm, to: v })} placeholder="Mọi ngày" />
              </label>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5 }}>Bảng kê sẽ lấy bảng giá phủ <b>ngày cont ra</b> của từng lô. Lô có ngày ngoài mọi bảng giá → "chưa khớp bảng giá".</div>
          </div>
        </Modal>
      )}

      {/* Popup Nhập báo giá gốc: chọn sheet → KIỂM TRA (báo cáo) → Import */}
      {qm && (
        <Modal title="Nhập báo giá gốc" subtitle={qm.fileName ? ("File: " + qm.fileName) : "Chọn sheet, kiểm tra rồi mới import"} width={560} icon={<I.truck />}
          onClose={() => setQm(null)}
          footer={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 12, color: qm.err ? "var(--danger)" : "var(--ink-4)" }}>{qm.err || (qm.report && qm.report.ok ? "Đã kiểm tra — sẵn sàng import" : "Bấm Kiểm tra trước khi import")}</span>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn onClick={() => setQm(null)}>Hủy</Btn>
                <Btn onClick={quoteValidate} disabled={qm.checking}>{qm.checking ? "Đang kiểm tra…" : "Kiểm tra"}</Btn>
                <Btn variant="primary" onClick={quoteImport} disabled={!(qm.report && qm.report.ok) || qm.importing}>{qm.importing ? "Đang nhập…" : "Import báo giá"}</Btn>
              </div>
            </div>
          }>
          <div style={{ padding: "14px 0 6px", display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "block" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 5 }}>Sheet dữ liệu</div>
              <select value={qm.sheet} onChange={(e) => setQm((q) => ({ ...q, sheet: e.target.value, report: null, err: "" }))}
                style={{ width: "100%", fontSize: 14, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 9, background: "#fff", cursor: "pointer", outline: "none" }}>
                {(qm.sheets || []).map((s) => <option key={s} value={s}>{s}</option>)}
                {!(qm.sheets || []).length && <option value="">(không đọc được sheet — vẫn bấm Kiểm tra)</option>}
              </select>
              <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 5 }}>Báo giá gốc thường ở sheet <b>import</b>. Bấm <b>Kiểm tra</b> để xem trước số dòng theo loại trước khi import.</div>
            </label>

            {qm.report && (
              <div style={{ border: "1px solid " + (qm.report.ok ? "var(--accent-weak)" : "#f3c9c9"), background: qm.report.ok ? "var(--accent-weak-2)" : "#fce8e8", borderRadius: 10, padding: "12px 14px" }}>
                {qm.report.ok ? (
                  <>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}><i className="bi bi-clipboard-check" /> Đọc được {qm.report.total} dòng giá từ sheet "{qm.report.sheet}"</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      {Object.entries(qm.report.by || {}).filter(([, v]) => v > 0).map(([k, v]) => (
                        <span key={k} className="tnum" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", background: "#fff", border: "1px solid var(--line)", padding: "3px 9px", borderRadius: 999 }}>{k === "Non" ? "Sà lan (Non)" : k}: {v}</span>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>Điểm hạ: {(qm.report.locs || []).join(", ") || "—"}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {(qm.report.kinds || []).map((k) => (
                        <div key={k.kind} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-2)" }}><span>{k.kind}</span><b className="tnum">{k.count}</b></div>
                      ))}
                    </div>
                    {(qm.report.warnings || []).length > 0 && <div style={{ marginTop: 8, fontSize: 11.5, color: "#9a6700" }}>{qm.report.warnings.map((w, i) => <div key={i}><i className="bi bi-exclamation-triangle-fill" /> {w}</div>)}</div>}
                  </>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)" }}><i className="bi bi-x-octagon-fill" /> {qm.report.msg || (qm.report.warnings || [])[0] || "Sheet không có dòng giá hợp lệ — chọn sheet khác."}</div>
                )}
                {/* Tên chưa có ký hiệu trong danh mục → không import được, phải khai ánh xạ trước. */}
                {(qm.report.unmapped || []).length > 0 && (
                  <div style={{ marginTop: 10, borderTop: "1px solid #f3c9c9", paddingTop: 9 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", marginBottom: 6 }}>Chưa khai ánh xạ ({qm.report.unmapped.length} giá trị):</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 150, overflowY: "auto" }}>
                      {qm.report.unmapped.map((u) => (
                        <div key={u.col + "|" + u.value} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--ink-2)" }}>
                          <span><b>{u.value}</b> <span style={{ color: "var(--ink-4)" }}>· {u.col}</span></span>
                          <span className="tnum" style={{ color: "var(--ink-4)" }}>{u.count} dòng</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 7 }}>
                      Mở <a href="/trucking-v2/cai-dat#locations" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 600 }}>Cài đặt → Địa điểm</a> thêm dòng <b>Tên = giá trị trên</b>, <b>Ký hiệu = mã đang dùng</b> (vd “HAI PHONG” → <b>HPP</b>), rồi bấm Kiểm tra lại. Nhà máy (cột TO) khai ở <b>Kho</b>.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

export { BangGiaPage };
