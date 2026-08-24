import React from "react";
const { useState, useEffect, useRef } = React;
import { I, Money, Num, Txt, Combo, DateField, Btn, Modal, fmtVND, fmtNum, fmtDate, toNum, useIsMobile, axleLabel } from "@trk/lib.jsx";
import { ChkBox } from "@trk/pop.jsx";
import { num, daysUsed, COST_KINDS, normKind, TAB_KEYS, SECTION_OF, WARN_DAYS, DUE_NONE, dueStatus, vehRank, DueCell, StatChip, lbl, delBtn, addBtn, Pager, DeprecTab, DeprecMonthlyTab, UsageTab, today10, esc, blankCost, PAY_METHODS, PayModal, CostModal, CostTab, VEH_DOC_TYPES, DocsBlock, InfoTab, AllowanceTab, PendingCostsModal } from "./parts.jsx";
import { FuelTab } from "./fuel-tab.jsx";

function FleetApp({ modeSwitch }) {
  const isMobile = useIsMobile();
  const T = window.__TRK || {}; const ROUTES = T.routes || {}; const B = T.boot || {};
  const api = (method, url, body) => window.trkApi(method, url, body);
  const canEdit = !!T.canEdit;
  const publicUrl = ROUTES.spendRequest || "/yeu-cau-chi";
  const copyPublic = () => { try { navigator.clipboard && navigator.clipboard.writeText(publicUrl); window.trkToast && window.trkToast("Đã sao chép link"); } catch (e) {} };

  const [vehicles] = useState(B.vehicles || []);
  const vehicleCostTypes = B.vehicleCostTypes || [];   // danh mục Loại chi phí xe (cai-dat#vehicleCostTypes) — cho Định mức + khớp yêu cầu chi
  const payMethods = B.payMethods || [];               // danh mục Hình thức thanh toán (cai-dat#payMethods)
  const [costItems, setCostItems] = useState(B.costItems || []);   // danh mục Khoản chi phí (Combo tên phiếu)
  const addCostItem = async (name) => {
    name = (name || "").trim(); if (!name) return;
    setCostItems((c) => (c.includes(name) ? c : [...c, name]));   // hiện ngay trong dropdown
    try { const r = await fetch(ROUTES.costItem, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-TOKEN": T.csrf }, body: JSON.stringify({ name }) }).then((x) => x.json()); if (r && r.ok) setCostItems(r.costItems); } catch (e) {}
  };
  const expiringCosts = B.expiringCosts || [];      // chi phí định kỳ hết hạn / sắp hết (toàn đội xe)
  const pendingCosts = B.pendingCosts || [];        // phiếu chi chưa duyệt / chờ thanh toán (toàn đội xe)
  const [showExp, setShowExp] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [vFilter, setVFilter] = useState("all");   // all | expired | soon | ok
  const [vQuery, setVQuery] = useState("");
  const [vPage, setVPage] = useState(1);           // phân trang client 30 dòng/trang
  const PER = 30;
  const [selId, setSelId] = useState(null);
  const selHash = useRef(null);   // hashid xe đang mở → dùng dựng URL (id số giữ cho so khớp/hash deep-link)
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState("info");
  const [docType, setDocType] = useState("Khác");   // loại tài liệu mặc định
  const [docBusy, setDocBusy] = useState(false);
  const [secLoading, setSecLoading] = useState(false);
  const loadedSecs = useRef(new Set());   // nhóm đã lazy-load (usages/costs/depreciations)
  const pendingCost = useRef(null);       // costId cần cuộn tới sau khi tab Chi phí load (deep-link từ thông báo)
  const [hlCost, setHlCost] = useState(null);   // id phiếu chi đang được highlight

  const setHash = (id, t) => { try { window.history.replaceState(null, "", "#" + id + "/" + t); } catch (e) {} };
  // Lazy-load nhóm con khi mở tab (truyền id để tránh stale selId lúc vừa mở xe)
  const ensureSection = (tabKey, hash) => {
    const sec = SECTION_OF[tabKey]; hash = hash || selHash.current;
    if (!sec || !hash || loadedSecs.current.has(sec)) return;
    loadedSecs.current.add(sec);
    setSecLoading(true);
    api("GET", ROUTES.fleet + hash + "/section/" + sec).then((r) => {
      // nhóm "costs" trả kèm costTypes (danh mục Loại chi phí xe cho Combo phiếu chi) — phải giữ lại
      if (r && r.ok) setDetail((d) => ({ ...d, [sec]: r[sec] || [], ...(r.costTypes ? { costTypes: r.costTypes } : {}) }));
      else loadedSecs.current.delete(sec);
      setSecLoading(false);
    }).catch(() => { loadedSecs.current.delete(sec); setSecLoading(false); });
  };
  const open = (v, tabKey) => {
    const t = TAB_KEYS.includes(tabKey) ? tabKey : "info";
    loadedSecs.current = new Set();
    selHash.current = v.hashid || v.id;
    setSelId(v.id); setDetail(null); setDirty(false); setTab(t); setLoading(true);
    setHash(v.hashid || v.id, t);
    api("GET", ROUTES.fleet + (v.hashid || v.id) + "/data").then((r) => {
      if (r && r.ok) setDetail(r.vehicle);
      setLoading(false);
      ensureSection(t, v.hashid || v.id);
    }).catch(() => setLoading(false));
  };
  const goTab = (k) => { setTab(k); if (selId) setHash(selHash.current, k); ensureSection(k); };   // đổi tab → ghi #hashid/tab + lazy-load nhóm
  const back = async () => {
    if (dirty && !(await window.confirmAction({ title: "Thoát khi chưa lưu?", text: "Bạn có thay đổi <b>chưa lưu</b> (tab Thông tin/Định mức/Khấu hao/Sử dụng). Thoát ra sẽ <b>mất</b> các thay đổi này.", confirmText: '<i class="bi bi-box-arrow-left me-1"></i> Thoát, không lưu', danger: true }))) return;
    setSelId(null); selHash.current = null; setDetail(null); setDirty(false); loadedSecs.current = new Set(); try { window.history.replaceState(null, "", "#"); } catch (e) {}
  };
  const upd = (np) => { setDetail((d) => ({ ...d, ...np })); setDirty(true); };
  // Admin HỦY phiếu chi (chưa thanh toán) — endpoint riêng, rồi nạp lại danh sách chi phí
  const cancelCost = async (id) => {
    const ok = await window.confirmAction({ title: "Hủy phiếu chi?", text: "Phiếu sẽ chuyển <b>Đã hủy</b> và bị loại khỏi tổng chi phí/báo cáo.", confirmText: '<i class="bi bi-x-circle me-1"></i> Hủy phiếu', danger: true });
    if (!ok) return;
    try {
      const r = await api("PUT", ROUTES.cancelCost + id + "/cancel");
      if (r && r.ok) {
        window.trkToast && window.trkToast("Đã hủy phiếu");
        const s = await api("GET", ROUTES.fleet + selHash.current + "/section/costs");
        if (s && s.ok) setDetail((d) => ({ ...d, costs: s.costs || [] }));
      } else window.trkToast && window.trkToast((r && r.message) || "Không hủy được", "error");
    } catch (e) {}
  };
  // Chi phí: LƯU NGAY mỗi thao tác (thêm/sửa/duyệt/thanh toán/xóa) — không gộp vào nút Lưu chung
  const [costSaving, setCostSaving] = useState(false);
  const saveCosts = (rows) => {
    setDetail((d) => ({ ...d, costs: rows }));   // hiển thị ngay (optimistic)
    if (!selId) return;
    setCostSaving(true);
    api("PUT", ROUTES.fleet + selHash.current, { data: { costs: rows } })
      .then((r) => {
        setCostSaving(false);
        if (r && r.ok) { setDetail((d) => ({ ...d, costs: (r.vehicle && r.vehicle.costs) || rows })); window.trkToast && window.trkToast("Đã lưu phiếu chi"); }
        else window.trkToast && window.trkToast("Lưu thất bại", "error");
      })
      .catch(() => { setCostSaving(false); window.trkToast && window.trkToast("Lỗi kết nối khi lưu", "error"); });
  };
  // Upload ảnh thực tế cho phiếu chi → trả metadata [{file,name,mime,size,url}] để đính vào phiếu
  const uploadCostPhotos = async (files) => {
    if (!selId || !files || !files.length) return [];
    const fd = new FormData(); Array.from(files).forEach((f) => fd.append("files[]", f));
    try {
      const res = await window.trkUpload("POST", ROUTES.fleet + selHash.current + "/cost-photo", fd);
      if (res && res.ok) return res.photos || [];
      window.trkToast && window.trkToast((res && res.message) || "Tải ảnh thất bại", "error");
    } catch (e) { window.trkToast && window.trkToast("Lỗi kết nối khi tải ảnh", "error"); }
    return [];
  };
  // Lưu CHỈ các nhóm đã tải (Array.isArray) + info → nhóm chưa mở không bị xóa; merge echo để lấy id mới
  const save = () => {
    if (!dirty || saving || !detail) return;
    setSaving(true);
    const data = { info: detail.info || {}, allowances: detail.allowances || [] };
    ["usages", "costs", "depreciations"].forEach((s) => { if (Array.isArray(detail[s])) data[s] = detail[s]; });
    api("PUT", ROUTES.fleet + selHash.current, { data })
      .then((r) => { setSaving(false); if (r && r.ok) { setDetail((d) => ({ ...d, ...r.vehicle })); setDirty(false); window.trkToast && window.trkToast("Đã lưu"); } else window.trkToast && window.trkToast("Lưu thất bại", "error"); })
      .catch(() => { setSaving(false); window.trkToast && window.trkToast("Lỗi kết nối khi lưu", "error"); });
  };
  // Tài liệu xe — upload/xóa lưu NGAY (không nằm trong nút Lưu thông tin)
  const uploadDocs = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length || !selId) return;
    const fd = new FormData(); files.forEach((f) => fd.append("files[]", f)); fd.append("type", docType);
    setDocBusy(true);
    try {
      const res = await window.trkUpload("POST", ROUTES.fleet + selHash.current + "/docs", fd);
      if (res && res.ok) { setDetail((d) => ({ ...d, docs: res.docs })); window.trkToast && window.trkToast(`Đã tải ${files.length} tài liệu`); }
      else window.trkToast && window.trkToast((res && res.message) || "Tải lên thất bại", "error");
    } catch (err) { window.trkToast && window.trkToast("Lỗi kết nối khi tải lên", "error"); }
    setDocBusy(false);
  };
  const deleteDoc = async (attId) => {
    if (!selId) return;
    const ok = await window.confirmAction({ title: "Xóa tài liệu?", text: "Tài liệu này sẽ bị xóa vĩnh viễn.", confirmText: '<i class="bi bi-trash me-1"></i> Xóa', danger: true });
    if (!ok) return;
    try { const res = await window.trkApi("DELETE", ROUTES.fleet + selHash.current + "/docs/" + attId); if (res && res.ok) setDetail((d) => ({ ...d, docs: res.docs })); } catch (e) {}
  };
  // Cảnh báo khi reload/đóng tab lúc còn thay đổi chưa lưu (chỉ áp dụng các tab gộp; Chi phí lưu ngay)
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  // mở theo hash: #<id> | #<id>/<tab> | #<id>/cost/<costId> (deep-link từ thông báo).
  // Chạy lúc mount VÀ khi hash đổi mà KHÔNG reload (bấm thông báo lúc đang ở sẵn trang
  // này → location.href chỉ đổi hash). Ghi hash nội bộ dùng replaceState nên không phát
  // hashchange → không lặp.
  useEffect(() => {
    const applyHash = () => {
      const h = (window.location.hash || "").replace(/^#/, "");
      const [idStr, tabStr, costStr] = h.split("/");   // idStr = hashid xe
      if (!idStr || idStr === "asset") return;
      const v = vehicles.find((x) => String(x.hashid) === idStr || String(x.id) === idStr);
      if (!v) return;
      if (costStr) pendingCost.current = costStr;   // hashid phiếu cần cuộn tới
      open(v, tabStr);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);
  // Khi tab Chi phí đã load xong → cuộn tới + highlight đúng phiếu chi (deep-link, theo hashid)
  useEffect(() => {
    const cidHash = pendingCost.current;
    if (!cidHash || tab !== "cost" || !detail || !Array.isArray(detail.costs)) return;
    const c = detail.costs.find((x) => String(x.hashid) === String(cidHash) || String(x.id) === String(cidHash));
    if (!c) return;   // phiếu không thuộc xe này
    pendingCost.current = null;
    const cid = c.id;
    setHlCost(String(cid));
    setTimeout(() => { const el = document.getElementById("trk-cost-" + cid); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 140);
    const t = setTimeout(() => setHlCost(null), 2800);
    return () => clearTimeout(t);
  }, [detail, tab]);
  useEffect(() => { setVPage(1); }, [vFilter, vQuery]);   // đổi lọc/tìm → về trang 1

  // ---------- DANH SÁCH XE ----------
  if (!selId) {
    const expiredCount = vehicles.filter((v) => vehRank(v) === 3).length;
    const soonCount    = vehicles.filter((v) => vehRank(v) === 2).length;
    const okCount      = vehicles.filter((v) => vehRank(v) === 1).length;
    const costExpired      = expiringCosts.filter((c) => c.status === "expired");
    const costSoon         = expiringCosts.filter((c) => c.status === "soon");
    const costExpiredTotal = costExpired.reduce((a, c) => a + (c.amount || 0), 0);
    const needApprove   = pendingCosts.filter((c) => !c.approved);                 // chưa duyệt
    const needPay       = pendingCosts.filter((c) => c.approved && !c.paid);       // đã duyệt, chờ thanh toán
    const needApproveAmt = needApprove.reduce((a, c) => a + (c.amount || 0), 0);
    const needPayAmt     = needPay.reduce((a, c) => a + (c.amount || 0), 0);
    const q = vQuery.trim().toLowerCase();
    // Ngày hết hạn GẦN NHẤT của xe (đăng kiểm/bảo hiểm) — xe không có hạn xếp cuối.
    const dueKey = (v) => { const ds = [v.registrationDue, v.insuranceDue].filter(Boolean).sort(); return ds[0] || "9999-12-31"; };
    const list = vehicles.filter((v) => {
      if (q && !(v.plate || "").toLowerCase().includes(q)) return false;
      if (vFilter === "expired") return vehRank(v) === 3;
      if (vFilter === "soon") return vehRank(v) === 2;
      if (vFilter === "ok") return vehRank(v) === 1;
      return true;
    }).sort((a, b) => vehRank(b) - vehRank(a) || dueKey(a).localeCompare(dueKey(b)));   // hết hạn → sắp hết → còn hạn; cùng mức: gần hết trước
    const lastPage = Math.max(1, Math.ceil(list.length / PER));
    const curPage = Math.min(vPage, lastPage);
    const pageList = list.slice((curPage - 1) * PER, curPage * PER);
    const FILTERS = [["all", "Tất cả", vehicles.length, "var(--ink-2)"], ["expired", "Hết hạn", expiredCount, "var(--danger)"], ["soon", "Sắp hết hạn", soonCount, "var(--warn)"], ["ok", "Còn hạn", okCount, "var(--good)"]];
    const th = (t, align) => <th style={{ textAlign: align || "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{t}</th>;

    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "auto" }}>
        <div style={{ maxWidth: 1120, width: "100%", margin: "0 auto", padding: isMobile ? "16px 14px" : "22px" }}>
          {modeSwitch}
          <div style={{ marginBottom: 14 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Quản lý xe</h1>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 3 }}>{vehicles.length} xe nội bộ (MBF). Bấm vào xe để xem thông tin, khấu hao, chi phí.</div>
          </div>

          {/* Link public — gửi yêu cầu chi cho tài xế */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 14, borderRadius: 10, background: "#eef4ff", border: "1px solid #d6e3fb", flexWrap: "wrap" }}>
            <i className="bi bi-link-45deg" style={{ fontSize: 22, color: "var(--accent)" }} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>Link gửi yêu cầu chi (cho tài xế)</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.5 }}>Gửi link này cho tài xế để đề nghị phiếu chi từ điện thoại — phiếu vào hàng chờ <b>duyệt</b>. Đặt <b>định mức km</b> ở từng xe (tab <b>Định mức</b>) để chặn yêu cầu khi chưa đi đủ số km.</div>
              <a href={publicUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", fontSize: 12, color: "var(--accent)", marginTop: 4, wordBreak: "break-all", fontWeight: 600, textDecoration: "none" }} className="tnum">{publicUrl}</a>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={copyPublic} style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", border: "1px solid var(--accent)", borderRadius: 8, background: "#fff", color: "var(--accent)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}><i className="bi bi-clipboard" /> Sao chép</button>
              <a href={publicUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}><i className="bi bi-box-arrow-up-right" /> Mở</a>
            </div>
          </div>

          {/* Cảnh báo hạn */}
          {(expiredCount > 0 || soonCount > 0) && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", marginBottom: 14, borderRadius: 10,
              background: expiredCount > 0 ? "#fce8e8" : "#fcf3e2", border: `1px solid ${expiredCount > 0 ? "#f3c9c9" : "#f0dcae"}` }}>
              <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: 18, color: expiredCount > 0 ? "var(--danger)" : "var(--warn)" }} />
              <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
                {expiredCount > 0 && <span><b style={{ color: "var(--danger)" }}>{expiredCount} xe hết hạn</b> đăng kiểm/bảo hiểm. </span>}
                {soonCount > 0 && <span><b style={{ color: "var(--warn)" }}>{soonCount} xe sắp hết hạn</b> (trong {WARN_DAYS} ngày). </span>}
                <span style={{ color: "var(--ink-3)" }}>Cần gia hạn để tránh phạt & gián đoạn vận hành.</span>
              </div>
            </div>
          )}

          {/* Cảnh báo chi phí định kỳ hết hạn → bấm xem popup */}
          {expiringCosts.length > 0 && (
            <button type="button" onClick={() => setShowExp(true)}
              style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", marginBottom: 14, borderRadius: 10, cursor: "pointer",
                background: costExpired.length ? "#fce8e8" : "#fcf3e2", border: `1px solid ${costExpired.length ? "#f3c9c9" : "#f0dcae"}` }}>
              <i className="bi bi-receipt-cutoff" style={{ fontSize: 18, color: costExpired.length ? "var(--danger)" : "var(--warn)" }} />
              <div style={{ flex: 1, fontSize: 13, color: "var(--ink-2)" }}>
                {costExpired.length > 0 && <span><b style={{ color: "var(--danger)" }}>{costExpired.length} chi phí định kỳ hết hạn</b> · tổng <b className="tnum">{fmtVND(costExpiredTotal)}</b>. </span>}
                {costSoon.length > 0 && <span><b style={{ color: "var(--warn)" }}>{costSoon.length} khoản sắp hết hạn</b>. </span>}
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>Xem chi tiết <I.open /></span>
            </button>
          )}

          {/* Cảnh báo phiếu chi chưa duyệt / chờ thanh toán → bấm xem popup */}
          {(needApprove.length > 0 || needPay.length > 0) && (
            <button type="button" onClick={() => setShowPending(true)}
              style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", marginBottom: 14, borderRadius: 10, cursor: "pointer",
                background: "#eef4ff", border: "1px solid #d6e3fb" }}>
              <i className="bi bi-clipboard-check" style={{ fontSize: 18, color: "var(--accent)" }} />
              <div style={{ flex: 1, fontSize: 13, color: "var(--ink-2)", display: "flex", gap: 16, flexWrap: "wrap" }}>
                {needApprove.length > 0 && <span><b style={{ color: "var(--warn)" }}>{needApprove.length} phiếu chưa duyệt</b> · <b className="tnum">{fmtVND(needApproveAmt)}</b></span>}
                {needPay.length > 0 && <span><b style={{ color: "var(--accent)" }}>{needPay.length} phiếu chờ thanh toán</b> · <b className="tnum">{fmtVND(needPayAmt)}</b></span>}
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>Xem chi tiết <I.open /></span>
            </button>
          )}

          {/* Bộ lọc + tìm */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", background: "#f1f2f4", borderRadius: 9, padding: 3, gap: 1 }}>
              {FILTERS.map(([k, label, n, col]) => {
                const on = vFilter === k;
                return (
                  <button key={k} type="button" onClick={() => setVFilter(k)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 7,
                      background: on ? "#fff" : "transparent", color: on ? col : "var(--ink-3)", boxShadow: on ? "0 1px 2px rgba(16,19,23,.12)" : "none" }}>
                    {label}
                    <span className="tnum" style={{ fontSize: 11, fontWeight: 700, color: on ? "#fff" : "var(--ink-4)", background: on ? col : "var(--line-2)", padding: "0 6px", borderRadius: 999, minWidth: 16, textAlign: "center" }}>{n}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1 }} />
            <input value={vQuery} onChange={(e) => setVQuery(e.target.value)} placeholder="Tìm biển số…"
              style={{ width: isMobile ? "100%" : 220, flex: isMobile ? "1 1 100%" : "0 0 auto", padding: "8px 12px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none", background: "#fff" }} />
          </div>

          {vehicles.length === 0
            ? <div style={{ padding: "44px", textAlign: "center", color: "var(--ink-4)", fontSize: 13.5, background: "#fff", border: "1px solid var(--line)", borderRadius: 12 }}>Chưa có xe MBF. Thêm xe & chọn loại <b>Xe MBF</b> ở Cài đặt → Biển số xe.</div>
            : (
              <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                    <thead><tr style={{ background: "#fafbfc" }}>
                      {th("Biển số")}{th("Hạn đăng kiểm")}{th("Hạn bảo hiểm")}{th("Hồ sơ", "center")}{th("Khấu hao/tháng", "right")}{th("Khấu hao · Chi phí · Lượt dùng", "center")}{th("", "right")}
                    </tr></thead>
                    <tbody>
                      {pageList.map((v) => {
                        const r = vehRank(v);
                        const stripe = r === 3 ? "var(--danger)" : r === 2 ? "var(--warn)" : "transparent";
                        return (
                          <tr key={v.id} onClick={() => open(v)} style={{ cursor: "pointer", borderBottom: "1px solid var(--line-2)", transition: "background .1s" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-weak-2)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                            <td style={{ padding: "11px 12px", borderLeft: `3px solid ${stripe}` }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 15, fontWeight: 700 }} className="tnum">{v.plate}</span>
                                {v.axle && <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--accent)", background: "var(--accent-weak)", padding: "1px 7px", borderRadius: 999 }}>{axleLabel(v.axle)}</span>}
                              </div>
                            </td>
                            <td style={{ padding: "9px 12px" }}><DueCell iso={v.registrationDue} /></td>
                            <td style={{ padding: "9px 12px" }}><DueCell iso={v.insuranceDue} /></td>
                            <td style={{ padding: "9px 12px", textAlign: "center" }} className="tnum">
                              {v.docCount > 0
                                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--ink-2)" }}><i className="bi bi-paperclip" />{v.docCount}</span>
                                : <span style={{ fontSize: 12, color: "var(--ink-4)" }}>—</span>}
                            </td>
                            <td style={{ padding: "9px 12px", textAlign: "right" }} className="tnum">
                              {(v.depMonthly > 0 || v.depOrig > 0)
                                ? <div><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-1)" }}>{fmtVND(v.depMonthly)}</div><div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>còn {fmtVND(v.depRemain)}</div></div>
                                : <span style={{ fontSize: 12, color: "var(--ink-4)" }}>—</span>}
                            </td>
                            <td style={{ padding: "9px 12px" }} className="tnum">
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
                                <StatChip icon="bi-cash-stack" n={v.depCount} title="Hạng mục khấu hao" />
                                <StatChip icon="bi-receipt" n={v.costCount} title="Phiếu chi" />
                                <StatChip icon="bi-arrow-repeat" n={v.usageCount} title="Lượt sử dụng (gán lái xe)" />
                              </div>
                            </td>
                            <td style={{ padding: "9px 14px", textAlign: "right", color: "var(--ink-4)" }}><I.open /></td>
                          </tr>
                        );
                      })}
                      {list.length === 0 && <tr><td colSpan={7} style={{ padding: "32px", textAlign: "center", color: "var(--ink-4)", fontSize: 13 }}>Không có xe nào khớp bộ lọc.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <Pager page={curPage} perPage={PER} total={list.length} onPage={setVPage} />
              </div>
            )}
        </div>

        {showExp && (
          <Modal title="Chi phí định kỳ cần gia hạn" subtitle={`${expiringCosts.length} khoản hết hạn / sắp hết hạn — bấm 1 dòng để mở xe`} width={680} icon={<I.fx />} onClose={() => setShowExp(false)}
            footer={<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <span style={{ fontSize: 13 }}>Tổng đã hết hạn: <b className="tnum" style={{ color: "var(--danger)" }}>{fmtVND(costExpiredTotal)}</b></span>
              <Btn onClick={() => setShowExp(false)}>Đóng</Btn>
            </div>}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
              {expiringCosts.map((c, i) => {
                const exp = c.status === "expired";
                return (
                  <div key={i} onClick={() => { const v = vehicles.find((x) => x.id === c.vehicleId); setShowExp(false); if (v) open(v); }}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10, cursor: "pointer", borderLeft: `3px solid ${exp ? "var(--danger)" : "var(--warn)"}` }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-weak-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name} <span className="tnum" style={{ color: "var(--ink-3)", fontWeight: 500 }}>· {c.plate}</span></div>
                      <div className="tnum" style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>Hạn: {fmtDate(c.dueDate)} · {exp ? `quá ${Math.abs(c.days)} ngày` : `còn ${c.days} ngày`}</div>
                    </div>
                    <span className="tnum" style={{ fontWeight: 700, fontSize: 13.5 }}>{fmtVND(c.amount)}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: exp ? "var(--danger)" : "var(--warn)", background: exp ? "#fce8e8" : "#fcf3e2", padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>{exp ? "Hết hạn" : "Sắp hết"}</span>
                  </div>
                );
              })}
            </div>
          </Modal>
        )}

        {showPending && (
          <PendingCostsModal items={pendingCosts} onClose={() => setShowPending(false)}
            onOpen={(vid) => { const v = vehicles.find((x) => x.id === vid); setShowPending(false); if (v) open(v, "cost"); }} />
        )}
      </div>
    );
  }

  // ---------- CHI TIẾT XE ----------
  const TABS = [["info", "Thông tin xe"], ["allowance", "Định mức"], ["deprec", "Khấu hao"], ["deprecMonthly", "Theo dõi KH"], ["usage", "Thời gian sử dụng"], ["cost", "Chi phí"], ["fuel", "Dầu"]];
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <div className="trk-head" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", background: "#fff", borderBottom: "1px solid var(--line)" }}>
        <div className="trk-head-lead" style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
          <button type="button" onClick={back} title="Về danh sách xe"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "7px 12px", fontSize: 13, fontWeight: 600, color: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 9, background: "#fff", cursor: "pointer" }}>
            <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><I.arrow /></span> Danh sách xe
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }} className="tnum">{detail ? detail.plate : "…"}{detail && detail.axle ? " · " + axleLabel(detail.axle) : ""}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Xe MBF nội bộ</div>
          </div>
        </div>
        {costSaving && <span style={{ fontSize: 12, color: "var(--ink-4)", display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 13, height: 13, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", display: "inline-block", animation: "trk-spin .7s linear infinite" }} />Đang lưu phiếu chi…</span>}
        {dirty && <span style={{ fontSize: 12, color: "var(--warn)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }} title="Thay đổi chưa được lưu — bấm Lưu trước khi rời trang">
          <i className="bi bi-exclamation-circle-fill" /> Chưa lưu — bấm Lưu</span>}
        {canEdit && dirty && <Btn variant="primary" onClick={save} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</Btn>}
      </div>
      <div style={{ display: "flex", gap: 4, padding: "10px 22px 0", background: "#fff", borderBottom: "1px solid var(--line)", overflowX: "auto", WebkitOverflowScrolling: "touch", whiteSpace: "nowrap" }}>
        {TABS.map(([k, t]) => {
          const on = tab === k;
          return <button key={k} type="button" onClick={() => goTab(k)}
            style={{ border: "none", flexShrink: 0, borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent", background: "transparent", padding: "8px 12px 11px", fontSize: 13.5, fontWeight: 600, color: on ? "var(--accent)" : "var(--ink-3)", cursor: "pointer" }}>{t}</button>;
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          {(loading || !detail || (SECTION_OF[tab] && detail[SECTION_OF[tab]] === undefined))
            ? <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "30px 4px", color: "var(--ink-4)", fontSize: 13.5 }}><span style={{ width: 15, height: 15, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", display: "inline-block", animation: "trk-spin .7s linear infinite" }} /> Đang tải dữ liệu…</div>
            : tab === "info" ? <InfoTab info={detail.info} onChange={(info) => upd({ info })} canEdit={canEdit}
                docsProps={{ docs: detail.docs || [], busy: docBusy, docType, setDocType, onPick: uploadDocs, onDelete: deleteDoc }} />
            : tab === "allowance" ? <AllowanceTab rows={detail.allowances || []} onChange={(rows) => upd({ allowances: rows })} costTypes={vehicleCostTypes} />
            : tab === "deprec" ? <DeprecTab rows={detail.depreciations || []} onChange={(rows) => upd({ depreciations: rows })} />
            : tab === "deprecMonthly" ? <DeprecMonthlyTab rows={detail.depreciations || []} />
            : tab === "usage" ? <UsageTab rows={detail.usages || []} onChange={(rows) => upd({ usages: rows })} drivers={detail.drivers || []} />
            : tab === "fuel" ? <FuelTab vehicleId={selId} hashid={selHash.current} routes={ROUTES} />
            : <CostTab rows={detail.costs || []} onChange={saveCosts} saving={costSaving} costTypes={detail.costTypes || []} payMethods={payMethods} payers={B.payers || []} onUploadPhotos={uploadCostPhotos} highlightId={hlCost} onCancel={cancelCost} />}
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   QUẢN LÝ TÀI SẢN (kind='asset') — tái dùng tab Chi phí / Khấu hao / Tài liệu
   ===================================================================== */

export { FleetApp };
