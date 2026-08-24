import React from "react";
const { useState, useRef, useMemo, useEffect } = React;
import { I, Money, Payer, Txt, Combo, MultiCombo, DateField, Num, Line, Section, Modal, Btn, fmtVND, fmtNum, fmtShort, calcCost, calcVeh, calcRev, calcVehICD, calcRevICD, calcFreeTime, fmtHours, toNum, useIsMobile, AXLE_OPTS } from "@trk/lib.jsx";
import { DTField, Field, DriverSpendRows, VatLine, ItemRows, ChiHoRows, DoanhThuRows, ChkBox, TRACK_COLORS, SWATCHES, colorHex, FlagPicker, CostLineRows, PaymentRows, Seg } from "./shared.jsx";
// Cài đặt = khung ConfigBody/ConfigPopup; các tab nặng tách ra components/config/ cho dễ đọc/maintain.
import { AddrInput, MapPicker } from "./config/MapPicker.jsx";
import { RouteFees } from "./config/RouteFees.jsx";
import { FuelPrices } from "./config/FuelPrices.jsx";
import { CustomerManager } from "./config/CustomerManager.jsx";
import { DriversManager } from "./config/DriversManager.jsx";
import { CFG_GROUPS } from "./config/groups.js";

function ConfigBody({ cfg, setCfg, sel, setSel, dirty, saving, onSave, dirtyMap, counts = {}, loading = false }) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState("");
  const [codeDraft, setCodeDraft] = useState("");   // ô "ký hiệu" cho khu thêm dạng nhóm (Địa điểm)
  const list = cfg[sel] || [];
  const locked = new Set(cfg.locationLocked || []);
  const g = CFG_GROUPS.find((x) => x.key === sel);
  const noun = ((g && g.codeNameLabel) || "Tên mục").replace(/^Tên\s+/i, "");   // "kho" | "địa điểm" — cho nhãn UI gom nhóm
  const [vehFilter, setVehFilter] = useState("MBF");   // MBF | Ngoài | all — lọc đội xe
  const prices = cfg.prices || {};
  const setPrice = (name, val) => setCfg("prices", { ...prices, [name]: val });
  const vehType = cfg.vehicleType || {};
  const setVehType = (name, val) => setCfg("vehicleType", { ...vehType, [name]: val });
  const vehAxle = cfg.vehicleAxle || {};   // số cầu xe MBF: "1" | "2" (link Phí tuyến đường)
  const setVehAxle = (name, val) => setCfg("vehicleAxle", { ...vehAxle, [name]: val });
  const vehGps = cfg.vehicleGps || {};     // liên kết xe GPS: plate => "provider:deviceId"
  const setVehGps = (name, val) => { const m = { ...vehGps }; if (val) m[name] = val; else delete m[name]; setCfg("vehicleGps", m); };
  const gpsVehicles = cfg.gpsVehicles || [];   // danh sách xe GPS để chọn (từ catalogData)
  const codeKey = (g && g.codeKey) || "locationCode";
  // Mã (ký hiệu) lưu theo CHỈ SỐ dòng → tên được phép trùng, chỉ mã là định danh duy nhất.
  const codeArrKey = codeKey + "Arr";
  const codeArr = cfg[codeArrKey] || [];
  const setCode = (i, val) => { const a = [...codeArr]; while (a.length < list.length) a.push(""); a[i] = val; setCfg(codeArrKey, a); };
  // ID dòng theo CHỈ SỐ (để reconcile khớp theo id → SỬA mã giữ nguyên id, không đứt link). Mục tự thêm = null.
  const idArrKey = sel + "IdArr";
  const idArr = cfg[idArrKey] || [];
  // Địa chỉ kho (chỉ danh mục addressed = Kho) — cũng lưu theo CHỈ SỐ dòng như mã.
  const addrArrKey = "warehouseAddrArr";
  const addrArr = cfg[addrArrKey] || [];
  const setAddr = (i, val) => { const a = [...addrArr]; while (a.length < list.length) a.push(""); a[i] = val; setCfg(addrArrKey, a); };
  // Ghi chú kho (chỉ danh mục noted = Kho) — in ra cột "Địa chỉ đóng hàng" khi xuất Excel lô hàng.
  const noteArrKey = "warehouseNoteArr";
  const noteArr = cfg[noteArrKey] || [];
  const setNote = (i, val) => { const a = [...noteArr]; while (a.length < list.length) a.push(""); a[i] = val; setCfg(noteArrKey, a); };
  // Tọa độ kho "lat,lng" (chỉ danh mục geo = Kho) — lưu theo CHỈ SỐ dòng; ghim qua MapPicker.
  const geoArrKey = "warehouseGeoArr";
  const geoArr = cfg[geoArrKey] || [];
  const setGeo = (i, val) => { const a = [...geoArr]; while (a.length < list.length) a.push(""); a[i] = val; setCfg(geoArrKey, a); };
  const [pickIdx, setPickIdx] = useState(null);   // dòng đang mở MapPicker
  const [focusIdx, setFocusIdx] = useState(null); // dòng vừa thêm → tự focus ô tên
  const mapsKey = (window.__TRK && window.__TRK.boot && window.__TRK.boot.mapsKey) || "";
  const parseGeo = (s) => { const m = /(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/.exec(s || ""); return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null; };
  // Phát hiện trùng ký hiệu (chuẩn hóa hoa + bỏ khoảng trắng)
  const normCode = (c) => (c || "").toString().trim().toUpperCase();
  const codeCounts = {};
  const allowDup = !!(g && g.allowDupCode);   // Địa điểm: cho phép nhiều TÊN dùng chung 1 ký hiệu → không chặn trùng mã
  if (g && g.coded && !allowDup) list.forEach((_, i) => { const c = normCode(codeArr[i]); if (c) codeCounts[c] = (codeCounts[c] || 0) + 1; });
  const isDupCode = (i) => { if (allowDup) return false; const c = normCode(codeArr[i]); return !!c && codeCounts[c] > 1; };
  const hasDupCode = !!(g && g.coded) && !allowDup && Object.values(codeCounts).some((n) => n > 1);
  // Ký hiệu BẮT BUỘC: coded mà có dòng bỏ trống ký hiệu → chặn lưu (kể cả allowDupCode).
  const hasEmptyCode = !!(g && g.coded) && list.some((_, i) => !String(codeArr[i] || "").trim());
  // Phí tuyến đường: phát hiện trùng TUYẾN — THEO CHIỀU (Kho1→Kho2 ≠ Kho2→Kho1, giữ thứ tự kho)
  const routeKey = (s) => (s || "").split(/\s*-\s*/).map((x) => x.trim().toUpperCase()).filter(Boolean).join(" | ");
  const rfRows = cfg.routeFees || [];
  const rfCounts = {};
  if (g && g.routefees) rfRows.forEach((r) => { const k = routeKey(r.route); if (k) rfCounts[k] = (rfCounts[k] || 0) + 1; });
  const isDupRoute = (s) => { const k = routeKey(s); return !!k && rfCounts[k] > 1; };
  const hasDupRoute = !!(g && g.routefees) && Object.values(rfCounts).some((n) => n > 1);
  // Gán xe GPS: 1 xe GPS chỉ được gán cho 1 xe MBF — phát hiện trùng ref.
  const gpsUsedBy = {};   // ref => [plate...] (xe nào đang gán ref này)
  if (g && g.fleet) Object.keys(vehGps).forEach((plate) => { const r = vehGps[plate]; if (r && (vehType[plate] || "MBF") === "MBF") (gpsUsedBy[r] = gpsUsedBy[r] || []).push(plate); });
  const isDupGps = (plate) => { const r = vehGps[plate]; return !!r && (gpsUsedBy[r] || []).length > 1; };
  const hasDupGps = !!(g && g.fleet) && Object.values(gpsUsedBy).some((a) => a.length > 1);
  const blockSave = hasDupCode || hasEmptyCode || hasDupRoute || hasDupGps;   // chặn lưu khi còn trùng / thiếu ký hiệu
  const costColors = cfg.costColors || {};
  const setColor = (name, val) => { const nc = { ...costColors }; if (val) nc[name] = val; else delete nc[name]; setCfg("costColors", nc); };
  const costAuto = cfg.costAuto || {};
  const setAuto = (name, val) => { const na = { ...costAuto }; if (val) na[name] = true; else delete na[name]; setCfg("costAuto", na); };
  const costVat = cfg.costVat || {};
  const setVatItem = (name, val) => { const nv = { ...costVat }; const v = String(val).replace(/[^\d.]/g, ""); if (v !== "") nv[name] = v; else delete nv[name]; setCfg("costVat", nv); };
  const vatDefault = cfg.vatDefault || { hph: "8", icd: "0" };
  const setVat = (k, val) => setCfg("vatDefault", { ...vatDefault, [k]: val.replace(/[^\d.]/g, "") });
  const setVatAll = (val) => { const v = val.replace(/[^\d.]/g, ""); setCfg("vatDefault", { hph: v, icd: v }); };
  const addItem = () => {
    const v = draft.trim();
    if (!v) { setDraft(""); return; }
    // Danh mục CÓ MÃ (địa điểm/kho): cho phép trùng TÊN. Danh mục khác: vẫn chặn trùng tên.
    if (!(g && g.coded) && list.includes(v)) { setDraft(""); return; }
    setCfg(sel, [...list, v]);
    if (g && g.coded) {
      const a = [...codeArr]; while (a.length < list.length) a.push(""); a.push(""); setCfg(codeArrKey, a);
      const ia = [...idArr]; while (ia.length < list.length) ia.push(null); ia.push(null); setCfg(idArrKey, ia);   // mục mới: chưa có id
    }
    if (g && g.addressed) { const a = [...addrArr]; while (a.length < list.length) a.push(""); a.push(""); setCfg(addrArrKey, a); }
    if (g && g.noted) { const a = [...noteArr]; while (a.length < list.length) a.push(""); a.push(""); setCfg(noteArrKey, a); }
    if (g && g.geo) { const a = [...geoArr]; while (a.length < list.length) a.push(""); a.push(""); setCfg(geoArrKey, a); }
    setDraft("");
  };
  // Thêm 1 dòng đã biết KÝ HIỆU (dùng cho giao diện gom nhóm — Địa điểm): mỗi ký hiệu có thể nhiều tên.
  // `at` = chèn vào CHỈ SỐ này (dùng để đưa dòng mới lên đầu nhóm, khỏi phải cuộn xuống cuối); bỏ trống = thêm cuối.
  const addRow = (code, name, at = null) => {
    const pos = at == null ? list.length : Math.max(0, Math.min(at, list.length));
    // Mọi mảng phụ lưu theo CHỈ SỐ dòng → phải chèn cùng vị trí để thẳng hàng với list.
    const insert = (arr, val, pad) => { const a = [...arr]; while (a.length < list.length) a.push(pad); a.splice(pos, 0, val); return a; };
    setCfg(sel, insert(list, (name || "").trim(), ""));
    setCfg(codeArrKey, insert(codeArr, (code || "").trim(), ""));
    setCfg(idArrKey, insert(idArr, null, null));   // dòng mới: chưa có id
    // Kho (addressed/geo): chèn ô địa chỉ + tọa độ rỗng.
    if (g && g.addressed) setCfg(addrArrKey, insert(addrArr, "", ""));
    if (g && g.noted) setCfg(noteArrKey, insert(noteArr, "", ""));
    if (g && g.geo) setCfg(geoArrKey, insert(geoArr, "", ""));
    setFocusIdx(pos);
  };
  // Đổi ký hiệu cho TẤT CẢ dòng trong 1 nhóm (sửa ở header nhóm → áp cho mọi tên cùng nhóm).
  const setGroupCode = (indices, code) => {
    const a = [...codeArr]; while (a.length < list.length) a.push(""); indices.forEach((i) => { a[i] = code; }); setCfg(codeArrKey, a);
  };
  // Đổi tên: các map gắn THEO TÊN (đơn giá/màu/loại xe) phải chuyển sang tên mới, không mất.
  // Riêng MÃ (coded) lưu theo chỉ số → đổi tên không ảnh hưởng mã.
  const rekey = (mapKey, map, old, v) => { if (map[old] === undefined) return; const m = { ...map }; m[v] = m[old]; delete m[old]; setCfg(mapKey, m); };
  const rename = (i, v) => {
    const old = list[i]; const next = [...list]; next[i] = v; setCfg(sel, next);
    if (v === old) return;
    if (g && g.priced)  rekey("prices", prices, old, v);
    if (g && g.colored) { rekey("costColors", costColors, old, v); rekey("costAuto", costAuto, old, v); rekey("costVat", costVat, old, v); }
    if (g && g.fleet) { rekey("vehicleType", vehType, old, v); rekey("vehicleAxle", vehAxle, old, v); rekey("vehicleGps", vehGps, old, v); }
  };
  const remove = (i) => {
    const old = list[i]; setCfg(sel, list.filter((_, j) => j !== i));
    if (g && g.coded) { setCfg(codeArrKey, codeArr.filter((_, j) => j !== i)); setCfg(idArrKey, idArr.filter((_, j) => j !== i)); }
    if (g && g.addressed) setCfg(addrArrKey, addrArr.filter((_, j) => j !== i));
    if (g && g.noted) setCfg(noteArrKey, noteArr.filter((_, j) => j !== i));
    if (g && g.geo) setCfg(geoArrKey, geoArr.filter((_, j) => j !== i));
    const drop = (mapKey, map) => { if (map[old] === undefined) return; const m = { ...map }; delete m[old]; setCfg(mapKey, m); };
    if (g && g.priced)  drop("prices", prices);
    if (g && g.colored) { drop("costColors", costColors); drop("costAuto", costAuto); drop("costVat", costVat); }
    if (g && g.fleet) { drop("vehicleType", vehType); drop("vehicleAxle", vehAxle); drop("vehicleGps", vehGps); }
  };
  return (
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "210px 1fr", gap: isMobile ? 12 : 18, padding: "14px 0 4px", minHeight: isMobile ? 0 : 380 }}>
        {/* group list — dọc/sticky trên desktop; thanh pill cuộn ngang trên mobile */}
        <div style={{ display: "flex", flexDirection: isMobile ? "row" : "column", gap: isMobile ? 7 : 2,
          borderRight: isMobile ? "none" : "1px solid var(--line-2)", borderBottom: isMobile ? "1px solid var(--line-2)" : "none",
          paddingRight: isMobile ? 0 : 14, paddingBottom: isMobile ? 12 : 0,
          position: isMobile ? "static" : "sticky", top: 8, alignSelf: "start",
          maxHeight: isMobile ? "none" : "calc(100vh - 150px)", overflowY: isMobile ? "visible" : "auto", overflowX: isMobile ? "auto" : "visible", flexWrap: "nowrap" }}>
          {CFG_GROUPS.map((grp) => {
            const active = sel === grp.key;
            return (
              <button key={grp.key} type="button" onClick={() => { setSel(grp.key); setDraft(""); }}
                style={{ textAlign: "left", border: isMobile ? "1px solid var(--line)" : "none", cursor: "pointer", borderRadius: isMobile ? 999 : 9, padding: "9px 11px", flexShrink: isMobile ? 0 : undefined, whiteSpace: isMobile ? "nowrap" : undefined,
                  background: active ? "var(--accent-weak)" : (isMobile ? "#fff" : "transparent"), transition: "background .12s" }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--line-2)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: active ? "var(--accent)" : "var(--ink)" }}>
                    {grp.label}
                    {dirtyMap && dirtyMap[grp.key] && <span title="Chưa lưu" style={{ width: 7, height: 7, borderRadius: 999, background: "var(--warn)" }} />}
                  </span>
                  {!grp.general && <span className="tnum" style={{ fontSize: 11.5, fontWeight: 600, color: active ? "var(--accent)" : "var(--ink-4)", background: active ? "#fff" : "var(--line-2)", padding: "1px 7px", borderRadius: 999 }}>{counts[grp.key] != null ? counts[grp.key] : (cfg[grp.key] || []).length}</span>}
                </div>
              </button>
            );
          })}
        </div>
        {/* items editor */}
        <div>
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0 8px", marginBottom: 6, borderBottom: "1px solid var(--line-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>{g.label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {dirty
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--warn)" }}><span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--warn)" }} /> Chưa lưu</span>
                : <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--good)" }}><I.check /> Đã lưu</span>}
              <button type="button" onClick={onSave} disabled={!dirty || saving || blockSave}
                title={blockSave ? (hasEmptyCode ? "Có dòng chưa nhập ký hiệu — bắt buộc điền trước khi lưu" : hasDupCode ? "Có ký hiệu bị trùng — sửa trước khi lưu" : "Có tuyến bị trùng — sửa trước khi lưu") : ""}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none",
                  cursor: dirty && !saving && !blockSave ? "pointer" : "default", color: dirty && !saving && !blockSave ? "#fff" : "var(--ink-4)", background: dirty && !saving && !blockSave ? "var(--accent)" : "var(--line-2)",
                  boxShadow: dirty && !saving && !blockSave ? "0 1px 2px rgba(42,111,219,.4)" : "none" }}>
                <I.check /> {saving ? "Đang lưu…" : "Lưu mục này"}
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 10 }}>{g.hint}</div>
          {g.usedIn && <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--ink-2)", background: "#eef4ff", border: "1px solid #d6e3fb", borderRadius: 9, padding: "8px 12px", marginBottom: 10 }}>
            <i className="bi bi-geo-alt-fill" style={{ color: "var(--accent)", marginTop: 1 }} />
            <span><b>Dùng ở:</b> {g.usedIn}</span>
          </div>}
          {g.coded && <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--ink-2)", background: "#eef4ff", border: "1px solid #d6e3fb", borderRadius: 9, padding: "8px 12px", marginBottom: 10 }}>
            <i className="bi bi-info-circle-fill" style={{ color: "var(--accent)", marginTop: 1 }} />
            <span>Sửa được cả <b>tên</b> lẫn <b>ký hiệu</b>. Đổi ký hiệu vẫn giữ liên kết (bảng giá/lô) vì khớp theo dòng. {allowDup ? <>Cho phép <b>nhiều tên</b> dùng chung 1 <b>ký hiệu</b>.</> : <>Lưu ý: mỗi <b>ký hiệu</b> phải <b>duy nhất</b>.</>}</span>
          </div>}
          {hasEmptyCode && <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--danger)", background: "#fce8e8", border: "1px solid #f3c9c9", borderRadius: 9, padding: "8px 12px", marginBottom: 10 }}>⚠ Có dòng <b>chưa nhập ký hiệu</b> — ký hiệu là bắt buộc (dùng để tham chiếu). Điền các ô viền đỏ trước khi lưu.</div>}
          {hasDupCode && <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--danger)", background: "#fce8e8", border: "1px solid #f3c9c9", borderRadius: 9, padding: "8px 12px", marginBottom: 10 }}>⚠ Có ký hiệu bị trùng — mỗi ký hiệu phải là duy nhất. Sửa các ô viền đỏ trước khi lưu.</div>}
          {hasDupRoute && <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--danger)", background: "#fce8e8", border: "1px solid #f3c9c9", borderRadius: 9, padding: "8px 12px", marginBottom: 10 }}>⚠ Có tuyến bị trùng — mỗi tuyến (đúng thứ tự kho) phải là duy nhất. Sửa các tuyến viền đỏ trước khi lưu. (Kho1→Kho2 khác Kho2→Kho1.)</div>}
          {hasDupGps && <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--danger)", background: "#fce8e8", border: "1px solid #f3c9c9", borderRadius: 9, padding: "8px 12px", marginBottom: 10 }}>⚠ Có xe GPS bị gán cho nhiều xe — mỗi xe GPS chỉ gán cho 1 xe. Sửa các ô viền đỏ trước khi lưu.</div>}
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "30px 4px", color: "var(--ink-4)", fontSize: 13.5 }}>
              <span style={{ width: 15, height: 15, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", display: "inline-block", animation: "trk-spin .7s linear infinite" }} />
              Đang tải dữ liệu mục này…
            </div>
          ) : sel === "customers" ? (
            <CustomerManager cfg={cfg} setCfg={setCfg} />
          ) : sel === "drivers" ? (
            <DriversManager cfg={cfg} setCfg={setCfg} />
          ) : g.routefees ? (
            <RouteFees rows={cfg.routeFees || []} onChange={(rows) => setCfg("routeFees", rows)} warehouses={cfg.warehouses || []} locations={cfg.locations || []} isDup={isDupRoute} />
          ) : g.fuelprices ? (
            <FuelPrices rows={cfg.fuelPrices || []} onChange={(rows) => setCfg("fuelPrices", rows)} />
          ) : g.general ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 600 }}>
              {/* VAT mặc định */}
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>VAT mặc định</div>
                <Field label="VAT mặc định cho lô hàng mới (%)">
                  <div style={{ position: "relative", width: 120 }}>
                    <input inputMode="decimal" value={vatDefault.icd == null ? "" : vatDefault.icd} onChange={(e) => setVatAll(e.target.value)} className="tnum"
                      style={{ width: "100%", padding: "8px 24px 8px 11px", fontSize: 13.5, textAlign: "right", border: "1px solid var(--line)", borderRadius: 9, outline: "none" }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", pointerEvents: "none" }}>%</span>
                  </div>
                </Field>
                <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 6 }}>Áp dụng cho lô hàng <b>mới thêm</b>. Các lô hiện có giữ VAT đã nhập.</div>
              </div>
              {/* Free time / Kết nối */}
              <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 18 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Free time / Kết nối</div>
                <Field label="Ngưỡng Free time (giờ)">
                  <div style={{ position: "relative", width: 140 }}>
                    <input inputMode="decimal" value={cfg.freeTimeHours == null ? "4" : cfg.freeTimeHours} onChange={(e) => setCfg("freeTimeHours", e.target.value.replace(/[^\d.]/g, ""))} className="tnum"
                      style={{ width: "100%", padding: "8px 30px 8px 11px", fontSize: 13.5, textAlign: "right", border: "1px solid var(--line)", borderRadius: 9, outline: "none" }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: 12.5, pointerEvents: "none" }}>giờ</span>
                  </div>
                </Field>
                <div style={{ fontSize: 12, color: "var(--ink-4)", lineHeight: 1.6, marginTop: 6 }}>
                  Free time <b>&gt; ngưỡng</b> → <b style={{ color: "var(--good)" }}>CONNECT</b>; nhỏ hơn → <b style={{ color: "var(--danger)" }}>DISCONNECT</b>.
                  <br />Free time = Giờ xe ra − (Giờ đến kế hoạch hoặc Giờ xe đến, lấy giờ muộn hơn). Mặc định <b>{cfg.freeTimeHours || 4}h</b> dùng khi không khớp khoảng ngày nào.
                </div>
                {/* Ngưỡng theo KHOẢNG NGÀY (ưu tiên hơn mặc định) — chọn theo NGÀY cont ra */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Ngưỡng theo khoảng ngày <span style={{ fontWeight: 400, color: "var(--ink-4)" }}>(ưu tiên hơn mặc định)</span></div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5, marginBottom: 8 }}>
                    Ngưỡng áp theo <b>ngày cont ra</b> (Giờ xe ra). Cont ra rơi vào khoảng nào thì dùng ngưỡng của khoảng đó (vd 12/06–30/06 = 2h; 01/07–20/07 = 4h). <b>Đến ngày</b> để trống = từ ngày đó trở đi.
                  </div>
                  {(cfg.freeTimeRules || []).map((r, i) => {
                    const upd = (np) => setCfg("freeTimeRules", (cfg.freeTimeRules || []).map((x, j) => (j === i ? { ...x, ...np } : x)));
                    const lbl = (t) => <div style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 3, fontWeight: 500 }}>{t}</div>;
                    return (
                      <div key={r.id || i} style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", marginBottom: 8, background: "#fafbfc" }}>
                        <div>{lbl("Từ ngày")}<div style={{ width: 130 }}><DateField value={r.from} onChange={(x) => upd({ from: x })} /></div></div>
                        <div>{lbl("Đến ngày")}<div style={{ width: 130 }}><DateField value={r.to} onChange={(x) => upd({ to: x })} /></div></div>
                        <div>{lbl("Ngưỡng (giờ)")}
                          <div style={{ position: "relative", width: 90 }}>
                            <input inputMode="decimal" value={r.hours == null ? "" : r.hours} onChange={(e) => upd({ hours: e.target.value.replace(/[^\d.]/g, "") })} placeholder={String(cfg.freeTimeHours || 4)} className="tnum"
                              style={{ width: "100%", padding: "8px 26px 8px 10px", fontSize: 13.5, textAlign: "right", border: "1px solid var(--line)", borderRadius: 9, outline: "none" }}
                              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                            <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: 12, pointerEvents: "none" }}>h</span>
                          </div>
                        </div>
                        <button type="button" onClick={() => setCfg("freeTimeRules", (cfg.freeTimeRules || []).filter((_, j) => j !== i))} title="Xóa khoảng"
                          style={{ width: 34, height: 38, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 9, background: "#fff", color: "var(--ink-4)", cursor: "pointer" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#fce8e8"; e.currentTarget.style.color = "var(--danger)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "var(--ink-4)"; }}><I.trash /></button>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => setCfg("freeTimeRules", [...(cfg.freeTimeRules || []), { id: Date.now() + Math.random(), from: "", to: "", hours: "" }])}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", fontSize: 13, fontWeight: 600, border: "1px dashed var(--accent)", borderRadius: 10, background: "var(--accent-weak-2)", color: "var(--accent)", cursor: "pointer" }}>
                    <I.plus /> Thêm khoảng ngày
                  </button>
                </div>
              </div>

              {/* Cảnh báo hạn (xe & tài sản) */}
              <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 18 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Cảnh báo hạn (xe &amp; tài sản)</div>
                <Field label="Cảnh báo trước hạn (số ngày)">
                  <div style={{ position: "relative", width: 140 }}>
                    <input inputMode="numeric" value={cfg.dueWarnDays == null ? "30" : cfg.dueWarnDays} onChange={(e) => setCfg("dueWarnDays", e.target.value.replace(/[^\d]/g, ""))} className="tnum"
                      style={{ width: "100%", padding: "8px 36px 8px 11px", fontSize: 13.5, textAlign: "right", border: "1px solid var(--line)", borderRadius: 9, outline: "none" }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: 12.5, pointerEvents: "none" }}>ngày</span>
                  </div>
                </Field>
                <div style={{ fontSize: 12, color: "var(--ink-4)", lineHeight: 1.6, marginTop: 6 }}>
                  Còn ≤ <b>{cfg.dueWarnDays || 30} ngày</b> sẽ chuyển nhãn <b style={{ color: "var(--warn)" }}>“Sắp hết hạn”</b> để không bị miss. Áp dụng cho <b>đăng kiểm / bảo hiểm</b> (xe), <b>bảo hành / kiểm định</b> (tài sản) và <b>chi phí định kỳ</b> (bảo hiểm, đăng kiểm…).
                </div>
              </div>
            </div>
          ) : allowDup ? (
            <>
              {/* Khu thêm: KÝ HIỆU trước → TÊN địa điểm → Thêm (đặt TRÊN CÙNG) */}
              {(() => { const add = () => { if (draft.trim() || codeDraft.trim()) { addRow(codeDraft, draft); setCodeDraft(""); setDraft(""); } };
                const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
                return (
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  <input value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} onKeyDown={onKey} placeholder="Ký hiệu (VD: TV)"
                    style={{ width: 140, padding: "9px 12px", fontSize: 13.5, fontWeight: 600, textTransform: "uppercase", border: "1px solid var(--line)", borderRadius: 9, outline: "none" }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={g.ph || "Tên địa điểm"}
                    style={{ flex: 1, minWidth: 160, padding: "9px 12px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none" }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                  <Btn variant="primary" onClick={add}>Thêm</Btn>
                </div>
                ); })()}
              {(() => {
                // Gom theo KÝ HIỆU (chuẩn hóa); nhóm chưa có ký hiệu xuống cuối.
                const gm = new Map();
                list.forEach((nm, i) => { const raw = codeArr[i] || ""; const key = normCode(raw); if (!gm.has(key)) gm.set(key, { key, code: raw, idxs: [] }); gm.get(key).idxs.push(i); });
                let groups = [...gm.values()];
                groups = groups.filter((x) => x.key !== "").concat(groups.filter((x) => x.key === ""));
                if (!groups.length) return <div style={{ padding: "20px 4px", fontSize: 13, color: "var(--ink-4)" }}>Chưa có {noun} nào — thêm ở trên.</div>;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 430, overflowY: "auto", paddingRight: 2 }}>
                    {groups.map((grp) => {
                      const noCode = grp.key === "";
                      // Ký hiệu đã LƯU (nhóm có dòng mang id thật) → khóa, không cho sửa (giữ khớp import/bảng giá).
                      // Nhóm mới thêm (chưa có id) thì còn sửa được ký hiệu trước khi lưu.
                      const codeSaved = !noCode && grp.idxs.some((i) => { const id = idArr[i]; return id != null && id !== "" && !isNaN(+id); });
                      return (
                      <div key={grp.idxs[0]} style={{ flexShrink: 0, border: "1px solid var(--line)", borderRadius: 11, overflow: "hidden", background: "#fff" }}>
                        {/* Header nhóm: ký hiệu — sửa ở đây áp cho CẢ nhóm (đã lưu thì khóa) */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: noCode ? "var(--line-2)" : "var(--accent-weak)", borderBottom: "1px solid var(--line)" }}>
                          <i className={"bi " + (codeSaved ? "bi-lock-fill" : "bi-tag-fill")} style={{ color: noCode ? "var(--ink-4)" : "var(--accent)", fontSize: 13 }} title={codeSaved ? "Ký hiệu đã lưu — không sửa được" : ""} />
                          <input value={grp.code} readOnly={codeSaved} onChange={(e) => { if (!codeSaved) setGroupCode(grp.idxs, e.target.value); }} placeholder="Ký hiệu…"
                            title={codeSaved ? "Ký hiệu đã lưu — không sửa để giữ khớp import/bảng giá" : ""}
                            style={{ width: 130, padding: "5px 9px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", border: "1px solid var(--line)", borderRadius: 7, outline: "none", background: codeSaved ? "var(--line-2)" : "#fff", color: codeSaved ? "var(--ink-3)" : "var(--ink)", cursor: codeSaved ? "not-allowed" : "text" }}
                            onFocus={(e) => { if (!codeSaved) e.target.style.borderColor = "var(--accent)"; }} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-4)" }}>{grp.idxs.length} {noun}</span>
                          <button type="button" onClick={() => addRow(grp.code, "", grp.idxs[0])} title={"Thêm 1 " + noun + " vào nhóm này"}
                            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 7, border: "1px solid var(--accent)", background: "#fff", color: "var(--accent)" }}>
                            <I.plus /> Thêm tên
                          </button>
                        </div>
                        {/* Danh sách tên trong nhóm */}
                        <div style={{ display: "flex", flexDirection: "column", padding: "4px 8px 8px" }}>
                          {grp.idxs.map((i) => {
                            const linkedToPrice = locked.has(list[i]);
                            // Kho (addressed/geo): mỗi TÊN có địa chỉ + ghim GPS riêng → grid rộng hơn, mobile xuống dòng.
                            const wide = !!(g.addressed || g.geo || g.noted);
                            const grid = wide
                              ? (isMobile ? "22px 1fr 28px" : (g.noted ? "22px 0.9fr 1.25fr 1.25fr 116px 28px" : "22px 1fr 1.4fr 116px 28px"))
                              : "22px 1fr 28px";
                            const nameInput = (
                              <input value={list[i]} onChange={(e) => rename(i, e.target.value)} placeholder={(g && g.codeNameLabel) || "Tên địa điểm"}
                                ref={(el) => { if (el && focusIdx === i) { setFocusIdx(null); el.focus(); el.scrollIntoView({ block: "nearest" }); } }}
                                style={{ width: "100%", padding: "7px 10px", fontSize: 13.5, border: "1px solid transparent", borderRadius: 8, outline: "none", background: "transparent" }}
                                onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; e.target.style.background = "#fff"; }}
                                onBlur={(e) => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }} />
                            );
                            const addrCell = g.addressed && (
                              <AddrInput value={addrArr[i] || ""} onChange={(v) => setAddr(i, v)}
                                onPlace={g.geo ? (lat, lng) => setGeo(i, lat.toFixed(7) + "," + lng.toFixed(7)) : () => {}}
                                mapsKey={mapsKey} placeholder="Gõ địa chỉ — gợi ý Google Maps (tự lấy tọa độ)" />
                            );
                            // Ghi chú kho = địa chỉ đóng hàng — xuất thẳng ra file Excel lô hàng.
                            const noteCell = g.noted && (
                              <input value={noteArr[i] || ""} onChange={(e) => setNote(i, e.target.value)}
                                placeholder="Ghi chú — địa chỉ đóng hàng (xuất Excel)"
                                title="Ghi chú của kho này — in vào cột “Địa chỉ đóng hàng” khi xuất Excel lô hàng"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, outline: "none", background: "#fff" }}
                                onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                            );
                            const geoCell = g.geo && (() => { const pinned = !!parseGeo(geoArr[i]); return (
                              <button type="button" onClick={() => setPickIdx(i)} title={pinned ? `Đã ghim: ${geoArr[i]} — bấm để sửa` : "Ghim tọa độ kho trên bản đồ"}
                                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 8, whiteSpace: "nowrap",
                                  border: `1px solid ${pinned ? "var(--good)" : "var(--line)"}`, background: pinned ? "var(--good-weak)" : "#fff", color: pinned ? "var(--good)" : "var(--ink-2)" }}>
                                <i className={"bi " + (pinned ? "bi-geo-alt-fill" : "bi-geo-alt")} /> {pinned ? "Đã ghim" : "Ghim BĐ"}
                              </button>
                            ); })();
                            const delBtn = (
                              <button type="button" onClick={() => remove(i)} title="Xóa"
                                style={{ width: 28, height: 28, display: "grid", placeItems: "center", border: "none", borderRadius: 7, background: "transparent", color: "var(--ink-4)", cursor: "pointer" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "#fce8e8"; e.currentTarget.style.color = "var(--danger)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--ink-4)"; }}>
                                <I.trash />
                              </button>
                            );
                            const icon = <span style={{ color: linkedToPrice ? "var(--accent)" : "var(--ink-4)", display: "inline-flex" }} title={linkedToPrice ? noun + " — đang dùng trong bảng giá" : noun}><i className="bi bi-geo-alt-fill" style={{ fontSize: 14 }} /></span>;
                            // Mobile + có địa chỉ: dòng 1 = icon|tên|xóa; dòng 2 = địa chỉ + ghim (xuống dưới).
                            return (
                              <div key={i} style={{ padding: "2px 0" }}>
                                <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, alignItems: "center" }}>
                                  {icon}{nameInput}
                                  {wide && !isMobile ? <>{addrCell}{noteCell}{geoCell}</> : null}
                                  {delBtn}
                                </div>
                                {wide && isMobile && (
                                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0 6px 30px" }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>{addrCell}</div>{geoCell}
                                    {noteCell && <div style={{ flexBasis: "100%", minWidth: 0 }}>{noteCell}</div>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={g.ph}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
                  style={{ flex: 1, padding: "9px 12px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none" }}
                  onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                <Btn variant="primary" onClick={addItem}>Thêm</Btn>
              </div>
              {(() => {
                const codedGrid = g.geo ? "24px 0.8fr 130px 1.4fr 118px 28px" : g.addressed ? "24px 1.1fr 110px 1.5fr 28px" : "24px 1fr 130px 28px";
                const grid = g.priced && g.colored ? "24px 1fr 150px 72px 92px 56px 28px"
                  : g.priced ? "24px 1fr 150px 28px"
                  : g.colored ? "24px 1fr 72px 92px 56px 28px"
                  : g.coded ? codedGrid
                  : g.fleet ? "24px 1fr 360px 28px"
                  : "24px 1fr 28px";
                const head = g.priced && g.colored ? [<span key="i" />, <span key="n">Tên khoản</span>, <span key="p" style={{ textAlign: "right" }}>Đơn giá mặc định</span>, <span key="v" style={{ textAlign: "center" }}>VAT %</span>, <span key="a" style={{ textAlign: "center" }}>Tự hiện</span>, <span key="c" style={{ textAlign: "center" }}>Theo dõi</span>, <span key="x" />]
                  : g.priced ? [<span key="i" />, <span key="n">Tên khoản</span>, <span key="p" style={{ textAlign: "right" }}>Đơn giá mặc định</span>, <span key="x" />]
                  : g.colored ? [<span key="i" />, <span key="n">Tên khoản</span>, <span key="v" style={{ textAlign: "center" }}>VAT %</span>, <span key="a" style={{ textAlign: "center" }}>Tự hiện</span>, <span key="c" style={{ textAlign: "center" }}>Theo dõi</span>, <span key="x" />]
                  : g.coded ? [<span key="i" />, <span key="n">{g.codeNameLabel || "Tên"}</span>, <span key="p">Ký hiệu</span>, ...(g.addressed ? [<span key="a">Địa chỉ kho</span>] : []), ...(g.geo ? [<span key="g">Vị trí (GPS)</span>] : []), <span key="x" />]
                  : null;   // đội xe (fleet) render dạng THẺ, không dùng header lưới
                return head && <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, padding: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{head}</div>;
              })()}
              {/* Bộ lọc xe MBF / Ngoài — mặc định MBF, sắp xếp MBF trước */}
              {g.fleet && (() => {
                const mbfN = list.filter((p) => (vehType[p] || "MBF") === "MBF").length;
                const extN = list.length - mbfN;
                const fb = (val, lbl, n) => <button type="button" onClick={() => setVehFilter(val)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: "pointer", border: "1px solid " + (vehFilter === val ? "var(--accent)" : "var(--line)"), background: vehFilter === val ? "var(--accent-weak)" : "#fff", color: vehFilter === val ? "var(--accent)" : "var(--ink-3)" }}>{lbl} <span style={{ fontSize: 11, fontWeight: 400, opacity: .7 }}>({n})</span></button>;
                return <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>{fb("MBF", "Xe MBF", mbfN)}{fb("Ngoài", "Xe ngoài", extN)}{fb("all", "Tất cả", list.length)}</div>;
              })()}
              <div style={{ display: "flex", flexDirection: "column", gap: g.fleet ? 8 : 2, maxHeight: g.fleet ? 420 : 300, overflowY: "auto", paddingRight: g.fleet ? 2 : 0 }}>
                {(g.fleet ? list.map((it, i) => ({ it, i })).sort((a, b) => ((vehType[a.it] || "MBF") === "MBF" ? 0 : 1) - ((vehType[b.it] || "MBF") === "MBF" ? 0 : 1))
                    .filter((x) => vehFilter === "all" || (vehType[x.it] || "MBF") === vehFilter) : list.map((it, i) => ({ it, i }))).map(({ it, i }) => {
                  // Đội xe (fleet): render dạng THẺ gọn — biển số + loại xe + số cầu + GPS, không nhồi vào 1 dòng lưới.
                  if (g.fleet) {
                    const isMbf = (vehType[it] || "MBF") === "MBF";
                    const dupGps = isDupGps(it);
                    const seg = (opts, cur, onPick, getColor) => (
                      <div style={{ display: "inline-flex", background: "#f1f2f4", borderRadius: 8, padding: 2 }}>
                        {opts.map(([val, lbl]) => { const on = cur === val; return (
                          <button key={val} type="button" onClick={() => onPick(val)}
                            style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, whiteSpace: "nowrap",
                              background: on ? "#fff" : "transparent", color: on ? (getColor ? getColor(val) : "var(--accent)") : "var(--ink-4)", boxShadow: on ? "0 1px 2px rgba(16,19,23,.14)" : "none", transition: "all .12s" }}>{lbl}</button>
                        ); })}
                      </div>
                    );
                    return (
                      <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 11, padding: "10px 12px", background: "#fff", display: "flex", flexDirection: "column", gap: 9 }}>
                        {/* Hàng 1: biển số + xóa */}
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <i className="bi bi-truck" style={{ color: "var(--accent)", fontSize: 15, flexShrink: 0 }} />
                          <input value={it} onChange={(e) => rename(i, e.target.value)} placeholder="Biển số" className="tnum"
                            style={{ flex: 1, minWidth: 0, padding: "7px 11px", fontSize: 14.5, fontWeight: 700, letterSpacing: "0.02em", border: "1px solid var(--line)", borderRadius: 8, outline: "none" }}
                            onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                          <button type="button" onClick={() => remove(i)} title="Xóa xe"
                            style={{ width: 30, height: 30, flexShrink: 0, display: "grid", placeItems: "center", border: "none", borderRadius: 8, background: "transparent", color: "var(--ink-4)", cursor: "pointer" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#fce8e8"; e.currentTarget.style.color = "var(--danger)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--ink-4)"; }}><I.trash /></button>
                        </div>
                        {/* Hàng 2: loại xe + số cầu (MBF) */}
                        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                          {seg([["MBF", "Xe MBF"], ["Ngoài", "Xe ngoài"]], vehType[it] || "MBF", (v) => setVehType(it, v), (v) => v === "MBF" ? "var(--accent)" : "var(--ink-2)")}
                          {isMbf && (
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }} title="Số cầu — để tính dầu theo Phí tuyến đường">
                              <span style={{ fontSize: 11.5, color: "var(--ink-4)", fontWeight: 600 }}>Số cầu</span>
                              {seg(AXLE_OPTS, vehAxle[it] || "", (v) => setVehAxle(it, v))}
                            </div>
                          )}
                        </div>
                        {/* Hàng 3: gán xe GPS (MBF) */}
                        {isMbf && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <i className="bi bi-broadcast" style={{ color: vehGps[it] ? "var(--accent)" : "var(--ink-4)", fontSize: 14, flexShrink: 0 }} />
                            <select value={vehGps[it] || ""} onChange={(e) => setVehGps(it, e.target.value)} title={dupGps ? "Xe GPS này đã gán cho xe khác — mỗi xe GPS chỉ gán 1 xe" : "Gán xe trong hệ thống GPS để theo dõi vị trí lô hàng"}
                              style={{ flex: 1, minWidth: 0, fontSize: 12.5, padding: "7px 9px", border: `1px solid ${dupGps ? "var(--danger)" : (vehGps[it] ? "var(--accent)" : "var(--line)")}`, borderRadius: 8, background: dupGps ? "#fce8e8" : "#fff", color: dupGps ? "var(--danger)" : (vehGps[it] ? "var(--ink)" : "var(--ink-4)") }}>
                              <option value="">Gán xe GPS để theo dõi vị trí…</option>
                              {gpsVehicles.map((gv) => { const otherV = (gpsUsedBy[gv.ref] || []).filter((pl) => pl !== it); return <option key={gv.ref} value={gv.ref} disabled={otherV.length > 0}>{gv.plate} · {gv.providerLabel}{otherV.length ? ` (đã gán: ${otherV[0]})` : ""}</option>; })}
                              {vehGps[it] && !gpsVehicles.some((gv) => gv.ref === vehGps[it]) && <option value={vehGps[it]}>(đã gán — xe đang offline)</option>}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  }
                  // Ký hiệu ĐÃ LƯU (dòng có id thật) → khóa, không cho sửa (giữ khớp import/bảng giá);
                  // dòng mới thêm (chưa có id) thì còn sửa ký hiệu được trước khi lưu.
                  // Khóa ký hiệu đã lưu để giữ khớp — NHƯNG mã đang TRỐNG thì cho sửa để điền (bắt buộc có ký hiệu).
                  const codeLocked = (() => { const id = idArr[i]; const has = !!String(codeArr[i] || "").trim(); return has && id != null && id !== "" && !isNaN(+id); })();
                  const linkedToPrice = locked.has(it);    // đang được bảng giá tham chiếu (hiện icon liên kết)
                  const rfUsed = (cfg.routeFeeUsedCodes || {})[String(codeArr[i] || "").toUpperCase().replace(/\s+/g, "")] || 0;   // Phí tuyến đang dùng code này
                  const dupCode = isDupCode(i);
                  const emptyCode = !!(g && g.coded) && !String(codeArr[i] || "").trim();   // ký hiệu BỎ TRỐNG → không cho lưu
                  const badCode = dupCode || emptyCode;
                  const rowGrid = g.priced && g.colored ? "24px 1fr 150px 72px 92px 56px 28px"
                    : g.priced ? "24px 1fr 150px 28px"
                    : g.colored ? "24px 1fr 72px 92px 56px 28px"
                    : g.coded ? (g.geo ? "24px 0.8fr 130px 1.4fr 118px 28px" : g.addressed ? "24px 1.1fr 110px 1.5fr 28px" : "24px 1fr 130px 28px")
                    : g.fleet ? "24px 1fr 360px 28px"
                    : "24px 1fr 28px";
                  return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: rowGrid, gap: 8, alignItems: "center", padding: "3px 0" }}>
                    <span style={{ color: linkedToPrice ? "var(--accent)" : "var(--ink-4)" }} title={linkedToPrice ? "Đang dùng trong bảng giá" : ""}><I.link /></span>
                    <input value={it} onChange={(e) => rename(i, e.target.value)}
                      style={{ width: "100%", padding: "7px 10px", fontSize: 13.5, border: "1px solid transparent", borderRadius: 8, outline: "none", background: "transparent" }}
                      onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; e.target.style.background = "#fff"; }}
                      onBlur={(e) => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }} />
                    {g.priced && <Money value={prices[it]} onChange={(x) => setPrice(it, x)} dim />}
                    {g.colored && (
                      <div style={{ position: "relative" }}>
                        <input value={costVat[it] || ""} onChange={(e) => setVatItem(it, e.target.value)} placeholder="0" inputMode="decimal"
                          title="VAT% mặc định — tự điền vào dòng khi chọn khoản này ở popup Chi phí (vẫn sửa được)"
                          style={{ width: "100%", padding: "7px 20px 7px 9px", fontSize: 13, textAlign: "right", border: "1px solid var(--line)", borderRadius: 8, outline: "none" }}
                          onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
                        <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: 11, pointerEvents: "none" }}>%</span>
                      </div>
                    )}
                    {g.colored && (
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <input type="checkbox" checked={!!costAuto[it]} onChange={(e) => setAuto(it, e.target.checked)}
                          title="Tự hiện sẵn ở popup Chi phí lô hàng (và nếu có màu theo dõi: nhắc 'chưa điền' trên mọi lô)"
                          style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }} />
                      </div>
                    )}
                    {g.colored && (
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <FlagPicker value={costColors[it] || ""} onChange={(c) => setColor(it, c)} />
                      </div>
                    )}
                    {g.coded && <div style={{ position: "relative" }}><input value={codeArr[i] || ""} readOnly={codeLocked} onChange={(e) => { if (!codeLocked) setCode(i, e.target.value); }} placeholder="Bắt buộc · VD: TV"
                      title={codeLocked ? "Ký hiệu đã lưu — không sửa để giữ khớp import/bảng giá" + (rfUsed ? ` · đang dùng bởi ${rfUsed} phí tuyến` : "") : (emptyCode ? "Bắt buộc nhập ký hiệu" : (dupCode ? "Ký hiệu bị trùng với mục khác" : (rfUsed ? `Đang dùng bởi ${rfUsed} phí tuyến — đổi sẽ lệch tuyến!` : "")))}
                      style={{ width: "100%", padding: "7px 10px", paddingRight: rfUsed > 0 ? 26 : 10, fontSize: 13, fontWeight: 600, border: `1px solid ${badCode ? "var(--danger)" : "var(--line)"}`, borderRadius: 8, outline: "none", textTransform: "uppercase", background: codeLocked ? "var(--line-2)" : (badCode ? "#fce8e8" : "#fff"), color: codeLocked ? "var(--ink-3)" : (badCode ? "var(--danger)" : "var(--ink)"), cursor: codeLocked ? "not-allowed" : "text" }}
                      onFocus={(e) => { if (!codeLocked) e.target.style.borderColor = "var(--accent)"; }} onBlur={(e) => (e.target.style.borderColor = badCode ? "var(--danger)" : "var(--line)")} />
                    {rfUsed > 0 && <span title={`${rfUsed} phí tuyến đang dùng code này — đổi sẽ lệch tuyến!`} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#e08600", pointerEvents: "none" }}><i className="bi bi-exclamation-triangle-fill" /></span>}
                    </div>}
                    {g.addressed && <AddrInput value={addrArr[i] || ""} onChange={(v) => setAddr(i, v)}
                      onPlace={g.geo ? (lat, lng) => setGeo(i, lat.toFixed(7) + "," + lng.toFixed(7)) : () => {}}
                      mapsKey={mapsKey} placeholder="Gõ địa chỉ — gợi ý Google Maps (tự lấy tọa độ)" />}
                    {g.geo && (() => { const pinned = !!parseGeo(geoArr[i]); return (
                      <button type="button" onClick={() => setPickIdx(i)} title={pinned ? `Đã ghim: ${geoArr[i]} — bấm để sửa` : "Ghim tọa độ kho trên bản đồ"}
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 8, whiteSpace: "nowrap",
                          border: `1px solid ${pinned ? "var(--good)" : "var(--line)"}`, background: pinned ? "var(--good-weak)" : "#fff", color: pinned ? "var(--good)" : "var(--ink-2)" }}>
                        <i className={"bi " + (pinned ? "bi-geo-alt-fill" : "bi-geo-alt")} /> {pinned ? "Đã ghim" : "Ghim BĐ"}
                      </button>
                    ); })()}
                    <button type="button" onClick={() => remove(i)} title="Xóa"
                      style={{ width: 28, height: 28, display: "grid", placeItems: "center", border: "none", borderRadius: 7, background: "transparent", color: "var(--ink-4)", cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#fce8e8"; e.currentTarget.style.color = "var(--danger)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--ink-4)"; }}>
                      <I.trash />
                    </button>
                  </div>
                ); })}
                {!list.length && <div style={{ padding: "20px 4px", fontSize: 13, color: "var(--ink-4)" }}>Chưa có mục nào — thêm ở trên.</div>}
              </div>
            </>
          )}
          {/* MapPicker dùng chung cho cả 2 nhánh coded (đơn & gom nhóm theo ký hiệu) — Kho ghim tọa độ GPS */}
          {pickIdx != null && (
            <MapPicker initial={parseGeo(geoArr[pickIdx])} address={addrArr[pickIdx] || ""} mapsKey={mapsKey}
              onClose={() => setPickIdx(null)}
              onPick={({ lat, lng, address }) => {
                setGeo(pickIdx, lat.toFixed(7) + "," + lng.toFixed(7));
                if (address && !((addrArr[pickIdx] || "").trim())) setAddr(pickIdx, address);
                setPickIdx(null);
              }} />
          )}
        </div>
      </div>
  );
}


function ConfigPopup({ cfg, setCfg, onClose }) {
  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>Dữ liệu danh mục dùng chung cho cả hai sheet — chọn bằng Select2 trong các popup.</div>
      <Btn variant="primary" onClick={onClose}>Xong</Btn>
    </div>
  );
  return (
    <Modal title="Cấu hình dữ liệu" subtitle="Quản lý các danh mục link (master data) cho toàn hệ thống" onClose={onClose} footer={footer} width={760} icon={<I.cog />}>
      <ConfigBody cfg={cfg} setCfg={setCfg} />
    </Modal>
  );
}



export { CFG_GROUPS, RouteFees, FuelPrices, CustomerManager, DriversManager, ConfigBody, ConfigPopup };
