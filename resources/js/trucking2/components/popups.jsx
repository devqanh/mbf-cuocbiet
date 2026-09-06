import React from "react";
const { useState, useRef, useMemo, useEffect } = React;
import { I, Money, Payer, Txt, Combo, MultiCombo, DateField, Num, Line, Section, Modal, Btn, fmtVND, fmtNum, fmtShort, calcCost, calcVeh, calcRev, calcVehICD, calcRevICD, calcFreeTime, fmtHours, toNum, useIsMobile } from "@trk/lib.jsx";
import { DTField, Field, DriverSpendRows, VatLine, ItemRows, ChiHoRows, DoanhThuRows, ChkBox, TRACK_COLORS, SWATCHES, colorHex, FlagPicker, CostLineRows, PaymentRows, Seg } from "./shared.jsx";

// Giờ hiện tại dạng DTField ("YYYY-MM-DDTHH:MM", giờ địa phương) cho nút "Bây giờ".
const nowLocalDT = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// Địa điểm dạng select2: giá trị = tên (giữ nguyên dữ liệu), nhãn = "Tên - Ký hiệu" để dễ nhận diện + tìm theo ký hiệu.
// LƯU theo KÝ HIỆU (value=mã) để link/tham chiếu bền; HIỆN "Tên — Mã" cho dễ đọc.
// Địa điểm chưa có mã → tạm dùng tên làm value.
// value = TÊN địa điểm (DUY NHẤT) chứ KHÔNG phải ký hiệu — vì nhiều địa điểm chung 1 ký hiệu (vd HÀ HƯNG
// HẢI, TÂN VŨ, GIC… đều = HPP). Lưu ký hiệu sẽ mất tên cụ thể + chọn xong nhảy về tên đầu tiên trùng mã.
// Lưu tên: round-trip đúng tên đã chọn; định giá vẫn khớp vì backend tự quy tên→ký hiệu (codeMap/$rc).
const locOptions = (cfg) => (cfg.locations || []).map((n) => {
  const c = (cfg.locationCode || {})[n];
  return { value: n, label: c ? `${n} — ${c}` : n };
});
// Loại cont sà lan SUY TỪ Loại cont: reefer (RF/RHC) → NOR, còn lại → DRY (vd 40HC→DRY, 40RF/40RHC→NOR).
const bargeKindOf = (ct) => /R(F|HC|EEF)/i.test(String(ct || "")) ? "NOR" : "DRY";
// Nơi hạ sà lan: địa điểm có ký hiệu HPP hoặc LHP. Lưu TÊN (giống Nơi lấy/hạ), backend tự quy về code.
const BARGE_CODES = ["HPP", "LHP"];
const bargeDropOptions = (cfg, cur) => {
  const code = cfg.locationCode || {};
  const opts = (cfg.locations || []).filter((n) => BARGE_CODES.includes(code[n])).map((n) => ({ value: n, label: code[n] ? `${n} \u2014 ${code[n]}` : n }));
  // Giữ giá trị đang lưu (lô cũ có thể lưu HPP/LHP trực tiếp hoặc tên khác)
  if (cur && !opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur });
  return opts;
};
// Kho (nhà máy): danh sách MÃ kho DEDUPE (1 ký hiệu có thể nhiều tên → chỉ hiện 1 mã); MultiCombo lưu chuỗi = mã.
const whCodes = (cfg) => [...new Set((cfg.warehouses || []).map((n) => (cfg.warehouseCode || {})[n] || n).filter(Boolean))];

function CostPopup({ ship, patch, onSave, isDirty, onClose, cfg = {}, addCfg, tagOptions = [] }) {
  const payerOpts = cfg.payers || [];
  const costOpts = cfg.costItems || [];
  const prices = cfg.prices || {};
  const addPayer = (v) => addCfg && addCfg("payers", v);
  const addCostItem = (v) => addCfg && addCfg("costItems", v);
  const [showFx, setShowFx] = useState(false);
  const c = ship.cost || {};
  const setC = (np) => patch({ cost: { ...c, ...np } });
  const cc = calcCost(c);
  const items = c.items || [];
  const setItems = (arr) => setC({ items: arr });
  // Khoản "tự hiện" (auto) chưa có dòng → thêm dòng RỖNG để hiện sẵn cho dễ điền (bỏ trống không lưu — backend bỏ qua).
  const costAuto = cfg.costAuto || {};
  const costColors = cfg.costColors || {};
  const present = new Set(items.map((it) => it.item).filter(Boolean));
  const autoRows = Object.keys(costAuto)
    .filter((n) => costAuto[n] && !present.has(n))
    .map((n, i) => ({ id: "auto-" + i, item: n, amount: 0, billable: false, color: costColors[n] || "", _auto: true }));
  const displayItems = autoRows.length ? [...items, ...autoRows] : items;
  const dirty = !!(isDirty && isDirty(ship.id));
  const [saving, setSaving] = useState(false);
  const handleSave = () => { if (saving) return; setSaving(true); Promise.resolve(onSave && onSave()).then(() => onClose()).catch(() => setSaving(false)); };

  const footer = (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
      <div style={{ display: "flex", gap: 24 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2 }}>Chi phí công ty</div>
          <div className="tnum" style={{ fontSize: 16, fontWeight: 700, color: "var(--ink-2)" }}>{fmtVND(cc.congTy)}</div>
        </div>
        <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 24 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2 }}>Chi hộ (thu lại khách)</div>
          <div className="tnum" style={{ fontSize: 16, fontWeight: 700, color: "var(--good)" }}>{fmtVND(cc.thuChiHo)}</div>
        </div>
        <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 24 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
            Tổng chi phí
            <button type="button" onClick={() => setShowFx((s) => !s)} title="Xem công thức"
              style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, border: "none", borderRadius: 5, background: showFx ? "var(--accent-weak)" : "transparent", color: showFx ? "var(--accent)" : "var(--ink-4)", cursor: "pointer" }}><I.fx /></button>
          </div>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{fmtVND(cc.tongChiPhi)}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {dirty && <span style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--warn)" }} />Có thay đổi chưa lưu</span>}
        <Btn onClick={onClose}>Đóng</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={!dirty || saving}>{saving ? "Đang lưu…" : "Lưu chi phí"}</Btn>
      </div>
    </div>
  );

  return (
    <Modal title="Chi phí lô hàng" subtitle={<>Lô <b style={{ color: "var(--ink-2)" }}>{ship.booking}</b> · {ship.customer} · gom mọi khoản chi phí phân bổ vào một nơi</>}
      onClose={onClose} footer={footer} width={1060}>

      {showFx && (
        <div style={{ margin: "12px 0 2px", padding: "10px 13px", background: "var(--accent-weak-2)", border: "1px solid var(--accent-weak)", borderRadius: 10, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
          <b style={{ color: "var(--accent)" }}>Tổng chi phí</b> = cộng tất cả các khoản. Khoản tích <b style={{ color: "var(--good)" }}>“Chi hộ khách”</b> là phần sẽ thu lại của khách (chi hộ); khoản không tích là <b>chi phí công ty</b> tự chịu.
          <br /><span style={{ color: "var(--ink-3)" }}>Cột “Người chi” chỉ ghi ai ứng/chi khoản đó, không cộng vào tổng.</span>
        </div>
      )}

      <div style={{ margin: "14px 0 4px" }}>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 4, fontWeight: 500 }}>Nhãn <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>(chọn hoặc gõ tạo mới, chọn nhiều)</span></div>
        <MultiCombo values={ship.tags || []} onChange={(arr) => patch({ tags: arr })} options={tagOptions} placeholder="Thêm nhãn…" max={20} />
      </div>

      <CostLineRows rows={displayItems} onChange={setItems} options={costOpts} onCreate={addCostItem}
        payers={payerOpts} onCreatePayer={addPayer} prices={prices} costColors={cfg.costColors || {}} costVat={cfg.costVat || {}} />
    </Modal>
  );
}


function RevenuePopup({ ship, patch, onSave, isDirty, onClose, cfg = {}, addCfg }) {
  const r = ship.rev || {};
  const setR = (np) => patch({ rev: { ...r, ...np } });
  const rc = calcRev(r);
  const paid = rc.conNo <= 0 && rc.phaiThu > 0;
  const choHo = r.choHo || [];
  const choHoOpts = cfg.choHoItems || [];
  const setChoHo = (arr) => setR({ choHo: arr });
  const dirty = !!(isDirty && isDirty(ship.id));
  const [saving, setSaving] = useState(false);
  const handleSave = () => { if (saving) return; setSaving(true); Promise.resolve(onSave && onSave()).then(() => onClose()).catch(() => setSaving(false)); };

  const footer = (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
      <div style={{ display: "flex", gap: 26 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2 }}>Tổng phải thu</div>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{fmtVND(rc.phaiThu)}</div>
        </div>
        <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 26 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2 }}>Còn nợ</div>
          <div className="tnum" style={{ fontSize: 16, fontWeight: 700, color: rc.conNo > 0 ? "var(--warn)" : "var(--good)" }}>{fmtVND(Math.max(0, rc.conNo))}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {dirty && <span style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--warn)" }} />Có thay đổi chưa lưu</span>}
        <Btn onClick={onClose}>Đóng</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={!dirty || saving}>{saving ? "Đang lưu…" : "Lưu doanh thu"}</Btn>
      </div>
    </div>
  );

  return (
    <Modal title="Doanh thu & công nợ" subtitle={<>Lô <b style={{ color: "var(--ink-2)" }}>{ship.booking}</b> · {ship.customer}</>} onClose={onClose} footer={footer} width={820}>
      <Section title="Doanh thu" total={rc.tongDT} totalLabel="Tổng doanh thu">
        <DoanhThuRows rows={r.doanhThu || []} onChange={(arr) => setR({ doanhThu: arr })} options={cfg.revItems || []} onCreate={(v) => addCfg && addCfg("revItems", v)} prices={cfg.prices || {}} />
        <VatLine rate={r.vatRate == null ? "8" : r.vatRate} vat={rc.vat} onRate={(x) => setR({ vatRate: x })} />
      </Section>

      <Section title="Thu chi hộ (thu lại của khách)" total={(choHo).reduce((s,e)=>s+toNum(e.amount),0)} totalLabel="Tổng chi hộ">
        {(ship.cost?.items || []).filter((e) => e.billable).length > 0 && (
          <button type="button" onClick={() => setChoHo((ship.cost.items || []).filter((e) => e.billable).map((e) => ({ id: Date.now() + Math.random(), item: e.item, amount: e.amount })))}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "6px 0 0", padding: "5px 10px", background: "var(--accent-weak)", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 12.5, fontWeight: 600, borderRadius: 8 }}
            title="Lấy các khoản đã tích 'chi hộ khách' ở popup Chi phí">
            <I.fx /> Lấy từ chi phí ({(ship.cost.items || []).filter((e) => e.billable).length} khoản)
          </button>
        )}
        <ChiHoRows rows={choHo} onChange={setChoHo} options={choHoOpts} onCreate={(v) => addCfg && addCfg("choHoItems", v)} prices={cfg.prices || {}} />
      </Section>

      <Section title="Thanh toán" total={rc.daTT} totalLabel="Đã thu">
        <div style={{ padding: "10px 0 4px", maxWidth: 320 }}>
          <Field label="Hạn thanh toán"><DateField value={r.hanTT} onChange={(x) => setR({ hanTT: x })} /></Field>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-4)", padding: "2px 0 0" }}>Khách trả nhiều đợt — thêm từng lần với số tiền và ngày.</div>
        <PaymentRows payments={r.payments || []} onChange={(arr) => setR({ payments: arr })} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 8px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: paid ? "var(--good)" : "var(--warn)", background: paid ? "var(--good-weak)" : "var(--warn-weak)", padding: "4px 11px", borderRadius: 999 }}>
            {rc.phaiThu === 0 ? "Chưa có doanh thu" : paid ? "Đã thu đủ" : `Còn nợ ${fmtVND(rc.conNo)}`}
          </span>
          {(r.payments || []).length > 0 && <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Đã thu {(r.payments || []).length} đợt: <b className="tnum" style={{ color: "var(--good)" }}>{fmtVND(rc.daTT)}</b></span>}
        </div>
        <Field label="Ghi chú kế toán"><Txt value={r.ghiChu} onChange={(x) => setR({ ghiChu: x })} placeholder="Ghi chú…" /></Field>
      </Section>
    </Modal>
  );
}

/* ===================== ICD — CHI PHÍ CHUYẾN XE ===================== */

function CostPopupICD({ ship, patch, onSave, isDirty, onClose, cfg = {}, addCfg }) {
  const isMobile = useIsMobile();
  const v = ship.veh || {};
  const setV = (np) => patch({ veh: { ...v, ...np } });
  const tong = calcVehICD(v);
  const dirty = !!(isDirty && isDirty(ship.id));
  const [saving, setSaving] = useState(false);
  const handleSave = () => { if (saving) return; setSaving(true); Promise.resolve(onSave && onSave()).then(() => onClose()).catch(() => setSaving(false)); };
  const footer = (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
      <div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2 }}>Tổng chi phí chuyến xe</div>
        <div className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{fmtVND(tong)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {dirty && <span style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--warn)" }} />Có thay đổi chưa lưu</span>}
        <Btn onClick={onClose}>Đóng</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={!dirty || saving}>{saving ? "Đang lưu…" : "Lưu chi phí"}</Btn>
      </div>
    </div>
  );
  return (
    <Modal title="Chi phí chuyến xe" subtitle={<>Lô <b style={{ color: "var(--ink-2)" }}>{ship.booking}</b> · {ship.customer}</>} onClose={onClose} footer={footer} width={760}>
      <Section title="Xe chạy">
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, padding: "8px 0" }}>
          <Field label="Biển số xe" hint="danh mục"><Combo value={v.bienSo} onChange={(x) => setV({ bienSo: x })} options={cfg.vehicles || []} onCreate={(x) => addCfg && addCfg("vehicles", x)} placeholder="15C-123.45…" /></Field>
          <Field label="Lái xe" hint="danh mục"><Combo value={v.laiXe} onChange={(x) => setV({ laiXe: x })} options={cfg.drivers || []} onCreate={(x) => addCfg && addCfg("drivers", x)} placeholder="Chọn lái xe…" /></Field>
        </div>
      </Section>
      <Section title="Chi phí chuyến xe" total={tong} totalLabel="Tổng chi phí">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "10px 0" }}>
          <Field label="Phụ cấp tiền đường"><Money value={v.phuCapTienDuong} onChange={(x) => setV({ phuCapTienDuong: x })} dim /></Field>
          <Field label="Trợ cấp"><Money value={v.troCap} onChange={(x) => setV({ troCap: x })} dim /></Field>
          <Field label="Lương"><Money value={v.luong} onChange={(x) => setV({ luong: x })} dim /></Field>
          <Field label="Chi phí khác"><Money value={v.chiPhiKhac} onChange={(x) => setV({ chiPhiKhac: x })} dim /></Field>
        </div>
      </Section>
      <Section title="Nhiên liệu & quãng đường">
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: 12, padding: "10px 0" }}>
          <Field label="Quãng đường"><Num value={v.km} onChange={(x) => setV({ km: x })} suffix="km" /></Field>
          <Field label="Số lít"><Num value={v.lit} onChange={(x) => setV({ lit: x })} suffix="L" /></Field>
          <Field label="Đơn giá dầu"><Money value={v.donGia} onChange={(x) => setV({ donGia: x })} dim /></Field>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "2px 0 8px" }}>Tiền dầu = Lít × Đơn giá = <b className="tnum" style={{ color: "var(--ink-2)" }}>{fmtVND(toNum(v.lit) * toNum(v.donGia))}</b></div>
      </Section>
    </Modal>
  );
}

/* ===================== ICD — DOANH THU ===================== */

function RevenuePopupICD({ ship, patch, onSave, isDirty, onClose, cfg = {}, addCfg }) {
  const r = ship.rev || {};
  const setR = (np) => patch({ rev: { ...r, ...np } });
  const rc = calcRevICD(r);
  const paid = rc.conNo <= 0 && rc.phaiThu > 0;
  const choHo = r.choHo || [];
  const choHoOpts = cfg.choHoItems || [];
  const setChoHo = (arr) => setR({ choHo: arr });
  const dirty = !!(isDirty && isDirty(ship.id));
  const [saving, setSaving] = useState(false);
  const handleSave = () => { if (saving) return; setSaving(true); Promise.resolve(onSave && onSave()).then(() => onClose()).catch(() => setSaving(false)); };
  const footer = (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
      <div style={{ display: "flex", gap: 26 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2 }}>Tổng phải thu</div>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{fmtVND(rc.phaiThu)}</div>
        </div>
        <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 26 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2 }}>Còn nợ</div>
          <div className="tnum" style={{ fontSize: 16, fontWeight: 700, color: rc.conNo > 0 ? "var(--warn)" : "var(--good)" }}>{fmtVND(Math.max(0, rc.conNo))}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {dirty && <span style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--warn)" }} />Có thay đổi chưa lưu</span>}
        <Btn onClick={onClose}>Đóng</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={!dirty || saving}>{saving ? "Đang lưu…" : "Lưu doanh thu"}</Btn>
      </div>
    </div>
  );
  return (
    <Modal title="Doanh thu & công nợ" subtitle={<>Lô <b style={{ color: "var(--ink-2)" }}>{ship.booking}</b> · {ship.customer}</>} onClose={onClose} footer={footer} width={780}>
      <Section title="Doanh thu" total={rc.tongDT} totalLabel="Tổng doanh thu">
        <DoanhThuRows rows={r.doanhThu || []} onChange={(arr) => setR({ doanhThu: arr })} options={cfg.revItems || []} onCreate={(v) => addCfg && addCfg("revItems", v)} prices={cfg.prices || {}} />
        <VatLine rate={r.vatRate == null ? "0" : r.vatRate} vat={rc.vat} onRate={(x) => setR({ vatRate: x })} />
      </Section>
      <Section title="Chi hộ" total={(choHo).reduce((s,e)=>s+toNum(e.amount),0)} totalLabel="Tổng chi hộ">
        <ChiHoRows rows={choHo} onChange={setChoHo} options={choHoOpts} onCreate={(v) => addCfg && addCfg("choHoItems", v)} prices={cfg.prices || {}} />
      </Section>
      <Section title="Thanh toán" total={rc.daTT} totalLabel="Đã thu">
        <div style={{ padding: "10px 0 4px", maxWidth: 320 }}>
          <Field label="Hạn thanh toán"><DateField value={r.hanTT} onChange={(x) => setR({ hanTT: x })} /></Field>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-4)", padding: "2px 0 0" }}>Khách trả nhiều đợt — thêm từng lần với số tiền và ngày.</div>
        <PaymentRows payments={r.payments || []} onChange={(arr) => setR({ payments: arr })} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 8px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: paid ? "var(--good)" : "var(--warn)", background: paid ? "var(--good-weak)" : "var(--warn-weak)", padding: "4px 11px", borderRadius: 999 }}>
            {rc.phaiThu === 0 ? "Chưa có doanh thu" : paid ? "Đã thu đủ" : `Còn nợ ${fmtVND(rc.conNo)}`}
          </span>
          {(r.payments || []).length > 0 && <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Đã thu {(r.payments || []).length} đợt: <b className="tnum" style={{ color: "var(--good)" }}>{fmtVND(rc.daTT)}</b></span>}
        </div>
        <Field label="Ghi chú kế toán"><Txt value={r.ghiChu} onChange={(x) => setR({ ghiChu: x })} placeholder="Ghi chú…" /></Field>
      </Section>
    </Modal>
  );
}

/* ===================== INFO EDIT POPUP (khách / cont / tuyến / lịch) ===================== */

function InfoPopup({ ship, patch, patchOther, onSave, isDirty, siblings = [], onClose, onDelete, canDelete, isHph, cfg = {}, addCfg, tagOptions = [] }) {
  const isMobile = useIsMobile();
  const set = (np) => patch(np);
  const add = (k, v) => addCfg && addCfg(k, v);
  // Biển số gõ tạo mới ở các ô BKS lô hàng → mặc định "Xe ngoài" (xe thuê ngoài, không lọt đội xe MBF)
  const addVehExt = (v) => addCfg && addCfg("vehicles", v, { external: true });
  // Tờ khai: 1 lô nhiều tờ khai, mỗi tờ khai 1 phí — [{no, fee}]. Tổng phí tự sang dòng chi phí ở backend.
  const decls = Array.isArray(ship.declarations) ? ship.declarations : [];
  const setDecls = (arr) => patch({ declarations: arr });
  const declTotal = decls.reduce((a, d) => a + toNum(d.fee), 0);
  const hqFilled = decls.length + [ship.declNote, ship.thanhLy, ship.cshtNote].filter((v) => (v || "").toString().trim()).length;
  const [hqOpen, setHqOpen] = useState(false);
  // Thuê xe ngoài → 1 dòng chi phí "Cước xe ngoài" (src=extTruck) link sang Chi phí lô hàng
  const cost = ship.cost || {};
  const costItems = cost.items || [];
  const extLine = costItems.find((it) => it.src === "extTruck");
  const extHired = !!extLine;
  const setCostItems = (arr) => patch({ cost: { ...cost, items: arr } });
  const toggleExt = (on) => {
    if (on && !extLine) {
      setCostItems([...costItems, { id: Date.now() + Math.random(), src: "extTruck", item: "Cước xe ngoài", amount: "", payer: "Xe ngoài", date: "", billable: false, color: "", note: "" }]);
      // Tự chọn nhà xe ĐẦU TIÊN trong danh mục (nếu chưa chọn) → đỡ thao tác; user vẫn đổi được.
      if (!String(ship.extVendor || "").trim() && (cfg.extVendors || []).length) patch({ extVendor: cfg.extVendors[0] });
    } else if (!on && extLine) { setCostItems(costItems.filter((it) => it.src !== "extTruck")); patch({ extVendor: "" }); }   // bỏ tích → xóa nhà xe
  };
  const setExt = (np) => setCostItems(costItems.map((it) => (it.src === "extTruck" ? { ...it, ...np } : it)));
  // Chỉ liệt kê cont CHƯA RA = chưa có Giờ xe ra (của cont) — khớp quy tắc "đã ra = có gio_xe_ra".
  // Giữ cont đang chọn để không mất hiển thị lựa chọn.
  // 1 cont chỉ ra 1 lần: cont đã là "cont ra hộ" của lô khác vẫn liệt kê nhưng đánh dấu + cảnh báo khi chọn
  // (không chặn — có thể lô kia mới là lô chọn nhầm).
  const takenBy = {};   // id cont ra hộ => lô đã chọn nó
  siblings.forEach((x) => { if (x.raOtherId != null) takenBy[x.raOtherId] = x; });
  const sibOpts = siblings
    .filter((s) => !(s.gioXeRa || "").trim() || s.id === ship.raOtherId)
    .map((s) => ({ value: s.id, label: (s.contNo || "(chưa có cont)") + " — " + (s.booking || "(chưa có booking)")
      + (takenBy[s.id] ? " · đã là cont ra hộ của " + (takenBy[s.id].contNo || ("lô #" + takenBy[s.id].id)) : "") }));
  const raMode = ship.raMode || "self";
  const other = (raMode === "other" && ship.raOtherId != null) ? siblings.find((s) => s.id === ship.raOtherId) : null;
  // Khi "cont khác ra": input giờ ra/BKS ra chỉ ghi vào cont kia (qua patchOther), KHÔNG động vào cont hiện tại.
  // Giữ state cục bộ để field PHẢN ÁNH NGAY khi sửa — vì patchOther cập nhật danh sách lô (data),
  // còn giá trị hiển thị lấy từ siblings không tự cập nhật → nếu đọc thẳng siblings sẽ "không nhận".
  const [raEdit, setRaEdit] = useState({ id: null, gioXeRa: "", bksRa: "" });
  useEffect(() => {
    if (other) setRaEdit({ id: other.id, gioXeRa: other.gioXeRa || "", bksRa: other.bksRa || "" });
  }, [ship.raOtherId, raMode]);
  // "Cont khác ra": giờ ra/BKS nhập ở đây ghi vào field TRANSIENT của LÔ HIỆN TẠI (raOtherGioXeRa/raOtherBksRa)
  // → backend tự đẩy sang cont ra_other_id THEO ID (cập nhật được cả khi cont kia ở trang khác). Cont hiện tại
  // không động vào cột giờ ra. raEdit chỉ để hiển thị tức thời.
  // Điền giờ ra cho cont đó mà "BKS ra (cont đó)" còn trống → tự lấy BKS vào của lô này (xe vào chính là xe kéo cont kia ra),
  // cùng quy tắc với "Không cắt móc" (setGioXeRa). Trước chỉ hiện placeholder, không lưu → 9/12 cont ra hộ thật thiếu BKS ra.
  const setRa = (val) => {
    if (!other) { set({ gioXeRa: val }); return; }
    const curBks = String((raEdit.id === other.id ? raEdit.bksRa : other.bksRa) || "").trim();
    // BKS người dùng vừa gõ ở phiên này thì tôn trọng. Còn giá trị có sẵn của cont CHƯA RA chỉ là xe vào tự điền /
    // xe ra tay không — chưa phải xe kéo nó ra → thay bằng BKS vào của lô này (lộ trình mới gắn đúng xe kéo).
    const typed = raEdit.id === other.id && String(raEdit.bksRa || "").trim() !== String(other.bksRa || "").trim();
    const canFill = !typed && (!curBks || !String(other.gioXeRa || "").trim());
    const fillBks = (canFill && String(ship.bksVao || "").trim() && String(val || "").trim() && ship.bksVao !== curBks) ? ship.bksVao : null;
    setRaEdit((e) => ({ ...e, gioXeRa: val, ...(fillBks ? { bksRa: fillBks } : {}) }));
    set(fillBks ? { raOtherGioXeRa: val, raOtherBksRa: fillBks } : { raOtherGioXeRa: val });
  };
  const setRaBks = (val) => { if (other) { setRaEdit((e) => ({ ...e, bksRa: val })); set({ raOtherBksRa: val }); } else set({ bksRa: val }); };
  const otherGioXeRa = (other && raEdit.id === other.id) ? raEdit.gioXeRa : (other ? other.gioXeRa || "" : "");
  const otherBksRa = (other && raEdit.id === other.id) ? raEdit.bksRa : (other ? other.bksRa || "" : "");
  const otherLabel = (sibOpts.find((o) => o.value === ship.raOtherId) || {}).label || "";
  const fmtDateTime = (s) => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

  const dirty = !!(isDirty && isDirty(ship.id));   // giờ ra cont khác cũng ghi vào lô hiện tại (raOther*) → chỉ cần xét ship.id
  const missingReq = !((ship.customer || "").toString().trim()) || !((ship.booking || "").toString().trim());
  const [saving, setSaving] = useState(false);
  const handleSave = () => { if (missingReq || saving) return; setSaving(true); Promise.resolve(onSave && onSave()).then(() => onClose()).catch(() => setSaving(false)); };

  const footer = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div>
        {canDelete && onDelete && (
          <button type="button" onClick={onDelete}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", fontSize: 13.5, fontWeight: 500, border: "1px solid var(--line)", borderRadius: 10, background: "#fff", color: "var(--ink-3)", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#fce8e8"; e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.borderColor = "#f3c9c9"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "var(--ink-3)"; e.currentTarget.style.borderColor = "var(--line)"; }}>
            <I.trash /> Xóa lô hàng
          </button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {missingReq
          ? <span style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>Cần nhập Khách hàng <b>*</b> và Số booking <b>*</b></span>
          : (dirty && <span style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--warn)" }} />Có thay đổi chưa lưu</span>)}
        <Btn onClick={onClose}>Đóng</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={!dirty || missingReq || saving}>{saving ? "Đang lưu…" : "Lưu thông tin"}</Btn>
      </div>
    </div>
  );
  return (
    <Modal title="Thông tin lô hàng" subtitle="Sửa khách hàng, container, tuyến và lịch trình" onClose={onClose} footer={footer} width={720}>
      <Section title="Thông tin chung">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "10px 0" }}>
          <Field label="Khách hàng" hint="danh mục" req><Combo value={ship.customer} onChange={(x) => set({ customer: x })} options={cfg.customers || []} onCreate={(v) => add("customers", v)} placeholder="Chọn khách hàng…" /></Field>
          <Field label={isHph ? "Số booking" : "Số booking / bill"} req><Txt value={ship.booking} onChange={(x) => set({ booking: x })} placeholder="Mã booking" /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 0 4px" }}>
          <Field label="Số INV" hint="hóa đơn"><Txt value={ship.inv} onChange={(x) => set({ inv: x })} placeholder="VD: INV-2026-0142" /></Field>
          <Field label="Nhập / Xuất"><div style={{ marginTop: 2 }}><Seg value={ship.io} onChange={(x) => set({ io: x })} options={["Nhập", "Xuất", "Khác"]} /></div></Field>
        </div>
      </Section>

      <Section title="Container">
        {isHph ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "120px 1fr 1.4fr", gap: 12, padding: "10px 0" }}>
            <Field label="Số lượng"><Num value={ship.qty} onChange={(x) => set({ qty: x })} /></Field>
            <Field label="Loại cont" hint="danh mục"><Combo value={ship.contType} onChange={(x) => set({ contType: x })} options={cfg.contTypes || []} onCreate={(v) => add("contTypes", v)} placeholder="40HC…" /></Field>
            <Field label="Số container"><Txt value={ship.contNo} onChange={(x) => set({ contNo: x })} placeholder="TGHU…" /></Field>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.2fr 1fr 1fr", gap: 12, padding: "10px 0 0" }}>
              <Field label="Số container"><Txt value={ship.contNo} onChange={(x) => set({ contNo: x })} placeholder="TGHU 123 4567" /></Field>
              <Field label="Loại cont" hint="danh mục"><Combo value={ship.contType} onChange={(x) => set({ contType: x })} options={cfg.contTypes || []} onCreate={(v) => add("contTypes", v)} placeholder="40HC…" /></Field>
              <Field label="Kho (nhà máy)" hint="chọn trong Cài đặt"><MultiCombo values={(ship.kho || "").split(/\s*,\s*/).filter(Boolean)} onChange={(arr) => set({ kho: arr.join(", ") })} options={whCodes(cfg)} max={Infinity} strict placeholder="Chọn kho (nhà máy) theo thứ tự đi qua…" /></Field>
            </div>
            {/* BKS vào / BKS ra nằm ở khối "Xe vào – xe ra" bên dưới, đứng cạnh đúng mốc giờ của nó. */}
          </>
        )}
      </Section>

      <div style={{ borderTop: "1px solid var(--line)" }}>
        <button type="button" onClick={() => setHqOpen((o) => !o)}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "13px 0", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
          <span style={{ color: "var(--ink-4)", display: "inline-flex", transform: hqOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .15s" }}><I.chev /></span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)", letterSpacing: ".01em" }}>Hải Quan</span>
          {hqFilled > 0 && <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", background: "var(--accent-weak)", padding: "3px 9px", borderRadius: 999 }}>{hqFilled} mục</span>}
          {!hqOpen && <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>Số tờ khai, ngày thanh lý, cơ sở hạ tầng…</span>}
        </button>
        {hqOpen && (
          <div style={{ padding: "0 0 14px" }}>
            {/* Tờ khai: mỗi dòng = 1 số tờ khai + 1 phí mở. Tổng phí tự thành dòng chi phí "Phí mở tờ khai". */}
            <Field label="Tờ khai" hint="mỗi tờ khai một phí mở · tổng link sang Chi phí">
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {decls.map((d, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <Txt value={d.no || ""} onChange={(x) => setDecls(decls.map((r, j) => (j === i ? { ...r, no: x } : r)))} placeholder="Số tờ khai, VD 103456789012" />
                    </div>
                    <div style={{ width: 150 }}>
                      <Money value={d.fee || ""} onChange={(x) => setDecls(decls.map((r, j) => (j === i ? { ...r, fee: x } : r)))} dim />
                    </div>
                    <button type="button" title="Xóa tờ khai" onClick={() => setDecls(decls.filter((_, j) => j !== i))}
                      style={{ width: 30, height: 30, flexShrink: 0, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 8, background: "#fff", color: "var(--ink-4)", cursor: "pointer" }}>
                      <I.trash />
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button type="button" onClick={() => setDecls([...decls, { no: "", fee: "" }])}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, border: "1px dashed var(--line)", borderRadius: 8, background: "#fff", color: "var(--accent)", cursor: "pointer" }}>
                    <I.plus /> Thêm tờ khai
                  </button>
                  {declTotal > 0 && <span className="tnum" style={{ fontSize: 12, color: "var(--ink-3)" }}>Tổng phí: <b>{fmtVND(declTotal)}</b></span>}
                </div>
              </div>
            </Field>
            <div style={{ marginTop: 12, maxWidth: 240 }}>
              <Field label="Ngày thanh lý"><DateField value={ship.thanhLy} onChange={(x) => set({ thanhLy: x })} /></Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="Ghi chú tờ khai">
                <textarea value={ship.declNote || ""} onChange={(e) => set({ declNote: e.target.value })} placeholder="Ghi chú liên quan tờ khai hải quan…" rows={2}
                  style={{ width: "100%", padding: "8px 11px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none", resize: "vertical", fontFamily: "inherit" }}
                  onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="Cơ sở hạ tầng (ghi chú)">
                <textarea value={ship.cshtNote || ""} onChange={(e) => set({ cshtNote: e.target.value })} placeholder="Ghi chú phí/biên lai cơ sở hạ tầng cảng…" rows={2}
                  style={{ width: "100%", padding: "8px 11px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none", resize: "vertical", fontFamily: "inherit" }}
                  onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line)")} />
              </Field>
            </div>
          </div>
        )}
      </div>

      <Section title="Phân loại & tùy chọn">
        {/* Tùy chọn ảnh hưởng định giá */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "10px 0 6px" }}>
          {[
            { on: !!ship.cru, set: (v) => set({ cru: v }), icon: "bi-recycle", label: "Hàng CRU" },
            { on: extHired, set: toggleExt, icon: "bi-truck", label: "Thuê xe ngoài" },
          ].map((o, i) => (
            <button key={i} type="button" onClick={() => o.set(!o.on)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                border: "1px solid " + (o.on ? "var(--accent)" : "var(--line)"), background: o.on ? "var(--accent-weak-2)" : "#fff", color: o.on ? "var(--accent)" : "var(--ink-2)" }}>
              <span style={{ width: 18, height: 18, borderRadius: 5, display: "grid", placeItems: "center", border: "1.5px solid " + (o.on ? "var(--accent)" : "var(--line-2)"), background: o.on ? "var(--accent)" : "#fff", color: "#fff", fontSize: 11 }}>{o.on ? <i className="bi bi-check-lg" /> : null}</span>
              <i className={"bi " + o.icon} style={{ opacity: .7 }} /> {o.label}
            </button>
          ))}
        </div>
        {/* THUÊ XE NGOÀI: hiện NGAY dưới nút — Nhà xe (bắt buộc) + cước + ghi chú. */}
        {extHired && (
          <div style={{ padding: "10px 12px", marginTop: 8, background: "var(--accent-weak-2)", border: "1px solid var(--accent-weak)", borderRadius: 9 }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 200px", gap: 12, alignItems: "end" }}>
              <Field label="Nhà xe ngoài" hint="bắt buộc" req>
                <Combo value={ship.extVendor} onChange={(x) => set({ extVendor: x })} options={cfg.extVendors || []} onCreate={(v) => add("extVendors", v)} placeholder="Chọn nhà xe (Cài đặt → Đơn vị xe ngoài)…" strict clearable />
              </Field>
              <Field label="Cước xe ngoài"><Money value={extLine.amount} onChange={(x) => setExt({ amount: x })} dim /></Field>
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label="Ghi chú nhà xe"><Txt value={extLine.note} onChange={(x) => setExt({ note: x })} placeholder="SĐT, biển số, ghi chú thêm…" /></Field>
            </div>
            {!String(ship.extVendor || "").trim()
              ? <div style={{ fontSize: 11.5, color: "var(--danger)", fontWeight: 600, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}><i className="bi bi-exclamation-triangle-fill" /> Chọn <b>Nhà xe ngoài</b> — bắt buộc để vào Bảng kê xe ngoài (công nợ).</div>
              : <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}><I.link /> Khoản <b style={{ color: "var(--ink-3)" }}>“Cước xe ngoài”</b> vào Chi phí lô hàng; gom vào <b>Bảng kê xe ngoài</b> theo nhà xe.</div>}
          </div>
        )}
        {/* SÀ LAN: chỉ cần chọn Nơi hạ sà lan → cont tự đi sà lan; loại DRY/NOR suy từ Loại cont. */}
        <div style={{ padding: "10px 12px", marginTop: 8, borderRadius: 9, background: ship.bargeDrop ? "var(--accent-weak-2)" : "#fafbfc", border: "1px solid " + (ship.bargeDrop ? "var(--accent-weak)" : "var(--line-2)") }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, alignItems: "end" }}>
            <Field label="Nơi hạ sà lan (điểm đến)">
              <Combo value={ship.bargeDrop} onChange={(x) => set({ bargeDrop: x })} options={bargeDropOptions(cfg, ship.bargeDrop)} placeholder="Chọn cảng hạ sà lan…" clearable />
            </Field>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5, paddingBottom: 4 }}>
              {ship.bargeDrop ? (
                <><i className="bi bi-water" style={{ color: "var(--accent)" }} /> <b style={{ color: "var(--accent)" }}>Đi sà lan</b> · loại <b>{bargeKindOf(ship.contType)} CONTAINER</b> (theo <a href="/trucking-v2/cai-dat#contTypes" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>Loại cont</a> {ship.contType || "—"}). Phí sà lan = <b>khoản riêng</b>, tra nhóm Non theo tuyến <b>Nơi hạ (cảng) → Nơi hạ sà lan</b>.</>
              ) : (
                <>Chọn <b>Nơi hạ sà lan</b> để cont đi sà lan — tự tính <b>phí sà lan riêng</b> (loại DRY/NOR suy từ Loại cont, không cần chọn thêm).</>
              )}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 8, lineHeight: 1.5 }}>
          <b style={{ color: "var(--ink-3)" }}>CRU</b> quyết KIND lấy giá (CRU+Xuất→External · CRU+Nhập→Internal · không CRU→Transport 1 way). <b style={{ color: "var(--ink-3)" }}>Sà lan</b>: có Nơi hạ sà lan = đi sà lan; giữ nguyên giá cont + thêm <b>phí sà lan riêng</b> (nhóm Non DRY/NOR, loại suy từ Loại cont).
        </div>
      </Section>

      <Section title="Tuyến" >
        <div style={{ fontSize: 11.5, color: "var(--ink-4)", padding: "6px 0 0" }}>Hiển thị <b style={{ color: "var(--ink-3)" }}>Tên - Ký hiệu</b> — gõ tên hoặc ký hiệu để tìm, chưa có thì gõ để thêm mới.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 36px 1fr", gap: 10, alignItems: "end", padding: "8px 0 10px" }}>
          <Field label="Nơi lấy (cảng)"><Combo value={ship.from} onChange={(x) => set({ from: x })} options={locOptions(cfg)} placeholder="Chọn cảng/điểm lấy (trong Cài đặt)…" clearable strict /></Field>
          <div style={{ display: "grid", placeItems: "center", color: "var(--accent)", paddingBottom: 9 }}><I.arrow /></div>
          <Field label="Nơi hạ (cảng)"><Combo value={ship.to} onChange={(x) => set({ to: x })} options={locOptions(cfg)} placeholder="Chọn điểm hạ/cảng (trong Cài đặt)…" clearable strict /></Field>
        </div>
      </Section>

      <Section title="Lịch trình">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "10px 0" }}>
          {isHph ? (
            <>
              <Field label="Ngày tàu chạy"><DateField value={ship.sailDate} onChange={(x) => set({ sailDate: x })} /></Field>
              <Field label="Cắt máng"><Txt value={ship.cutOff} onChange={(x) => set({ cutOff: x })} placeholder="18/06 14:00" /></Field>
            </>
          ) : (
            <>
              <Field label="Cắt máng" hint="ngày giờ"><DTField value={ship.cutOff} onChange={(x) => set({ cutOff: x })} /></Field>
              <Field label="Ngày cont đến"><DateField value={ship.contDen} onChange={(x) => set({ contDen: x })} /></Field>
              {/* Bỏ "Ngày cont ra" — dùng "Giờ xe ra" (gioXeRa) ở mục Free time làm mốc cont rời đi. */}
            </>
          )}
        </div>
      </Section>

      {!isHph && (() => {
        // Một khối duy nhất cho cả chuyến: XE VÀO (giờ + BKS vào) → XE RA (cắt móc hay không + giờ + BKS ra).
        // Nghiệp vụ gọi theo MÓC: không cắt móc = xe vào kéo luôn chính cont này ra; cắt móc = để cont lại,
        // xe ra kéo cont khác hoặc ra tay không. Free time tính theo giờ ra ứng với lựa chọn đó.
        const ft = calcFreeTime(ship, (cfg.freeTimeHours == null ? "4" : cfg.freeTimeHours), cfg.freeTimeRules);
        const gutter = { fontSize: 10, fontWeight: 700, color: "var(--ink-4)", letterSpacing: ".06em", paddingTop: 11 };
        // Không cắt móc = xe vào cũng là xe ra → điền sẵn BKS ra khi ô đang trống (gõ tay rồi thì không đè).
        const setBksVao = (x) => set(raMode === "self" && !String(ship.bksRa || "").trim() ? { bksVao: x, bksRa: x } : { bksVao: x });
        // Điền giờ ra khi BKS vào đã có sẵn từ trước → cũng lấy luôn BKS đó làm BKS ra (nếu đang trống).
        const setGioXeRa = (x) => set(!String(ship.bksRa || "").trim() && String(ship.bksVao || "").trim() && String(x || "").trim()
          ? { gioXeRa: x, bksRa: ship.bksVao } : { gioXeRa: x });
        // "Không kéo ra": xe rời đi tay không — xe ra vẫn là xe vào nên BKS ra cũng lấy BKS vào (nếu đang trống).
        const setGioXeRaXe = (x) => set(!String(ship.bksRa || "").trim() && String(ship.bksVao || "").trim() && String(x || "").trim()
          ? { gioXeRaXe: x, bksRa: ship.bksVao } : { gioXeRaXe: x });
        const nowBtn = (onClick) => (
          <button type="button" onClick={onClick} title="Điền giờ hiện tại"
            style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "var(--accent-weak-2)", border: "1px solid var(--accent-weak)", borderRadius: 8, padding: "8px 11px", cursor: "pointer", whiteSpace: "nowrap" }}>Bây giờ</button>
        );
        return (
          <Section title="Xe vào – xe ra">
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", padding: "2px 0 8px", lineHeight: 1.5 }}>
              Free time = <b style={{ color: "var(--ink-3)" }}>Giờ xe ra − Giờ xe đến</b>, ngưỡng <b style={{ color: "var(--ink-3)" }}>{ft ? ft.threshold : (cfg.freeTimeHours || 4)}h</b> (đổi trong Cấu hình). Giờ đến kế hoạch chỉ để theo dõi, <b style={{ color: "var(--ink-3)" }}>không</b> tính free time.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "44px 1fr", gap: 10, alignItems: "start" }}>
              <div style={gutter}>VÀO</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: 10 }}>
                <Field label="Giờ xe đến"><DTField value={ship.gioXeDen} onChange={(x) => set({ gioXeDen: x })} /></Field>
                <Field label="BKS vào"><Combo value={ship.bksVao} onChange={setBksVao} options={cfg.vehicles || []} onCreate={addVehExt} placeholder="15C-123.45…" /></Field>
                <Field label="Giờ đến kế hoạch" hint="chỉ theo dõi"><DTField value={ship.gioDenDuKien} onChange={(x) => set({ gioDenDuKien: x })} /></Field>
              </div>
            </div>
            {/* RA: chọn theo MÓC trước, rồi chỉ hiện đúng ô cần điền của kiểu đó */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "44px 1fr", gap: 10, alignItems: "start", padding: "12px 0 2px" }}>
              <div style={gutter}>RA</div>
              <div>
                <div style={{ display: "inline-flex", background: "#f1f2f4", borderRadius: 8, padding: 2, flexWrap: "wrap", marginBottom: 9 }}>
                  {[["self", "Không cắt móc", "Xe vào kéo luôn chính cont này ra"],
                    ["other", "Cắt móc — cont khác ra", "Để cont này lại, xe kéo cont khác ra"],
                    ["none", "Cắt móc — không kéo ra", "Để cont này lại, xe ra tay không (không kéo cont nào)"]].map(([k, lbl, tip]) => {
                    const on = raMode === k;
                    // self/other → xóa gioXeRaXe (chỉ dùng cho 'none'); self/none → bỏ liên kết cont khác.
                    // KHÔNG xóa gioXeRa/bksRa của cont hiện tại.
                    const onPick = k === "none" ? { raMode: "none", raOtherId: null }
                      : k === "self" ? { raMode: "self", raOtherId: null, gioXeRaXe: "" }
                      : { raMode: "other", gioXeRaXe: "" };
                    return (
                      <button key={k} type="button" title={tip} onClick={() => set(onPick)}
                        style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 13px", borderRadius: 6, whiteSpace: "nowrap",
                          background: on ? "#fff" : "transparent", color: on ? "var(--accent)" : "var(--ink-3)", boxShadow: on ? "0 1px 2px rgba(16,19,23,.12)" : "none", transition: "all .12s" }}>
                        {lbl}
                      </button>
                    );
                  })}
                </div>

                {/* Không cắt móc: chính cont này ra — xe ra cũng là xe vào nên BKS ra tự điền theo BKS vào */}
                {raMode === "self" && (
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                    <Field label="Giờ xe ra (cont này)">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}><DTField value={ship.gioXeRa} onChange={setGioXeRa} /></div>
                        {nowBtn(() => setGioXeRa(nowLocalDT()))}
                      </div>
                    </Field>
                    <Field label="BKS ra" hint="mặc định = BKS vào">
                      <Combo value={ship.bksRa} onChange={(x) => set({ bksRa: x })} options={cfg.vehicles || []} onCreate={addVehExt} placeholder={ship.bksVao ? `${ship.bksVao} (như BKS vào)` : "15C-678.90…"} />
                    </Field>
                  </div>
                )}

                {/* Cắt móc — cont khác ra: giờ & BKS nhập ở đây ghi cho CONT ĐÃ CHỌN (backend đẩy theo id) */}
                {raMode === "other" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : (ship.raOtherId != null ? "1.2fr 1fr 1fr" : "1fr"), gap: 10 }}>
                      <Field label="Cont ra thay" hint="cùng chuyến">
                        <Combo value={ship.raOtherId != null ? (sibOpts.find((o) => o.value === ship.raOtherId) || {}).label : ""}
                          options={sibOpts.map((o) => o.label)}
                          onChange={(label) => { const opt = sibOpts.find((o) => o.label === label); set({ raOtherId: opt ? opt.value : null }); }}
                          placeholder="Chọn cont ra cùng chuyến…" />
                      </Field>
                      {ship.raOtherId != null && (
                        <>
                          <Field label="Giờ ra (cont đó)">
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}><DTField value={otherGioXeRa} onChange={(x) => setRa(x)} /></div>
                              {nowBtn(() => setRa(nowLocalDT()))}
                            </div>
                          </Field>
                          <Field label="BKS ra (cont đó)">
                            <Combo value={otherBksRa} onChange={(x) => setRaBks(x)} options={cfg.vehicles || []} onCreate={addVehExt} placeholder={ship.bksVao || "BKS ra…"} />
                          </Field>
                        </>
                      )}
                    </div>
                    {ship.raOtherId != null && takenBy[ship.raOtherId] && (
                      <div style={{ fontSize: 11.5, color: "var(--warn)", marginTop: 7, fontWeight: 600, display: "flex", alignItems: "flex-start", gap: 6, lineHeight: 1.5 }}>
                        <i className="bi bi-exclamation-triangle-fill" style={{ marginTop: 1 }} />
                        <span>Cont <b>{(other && other.contNo) || ""}</b> đã được lô <b>{takenBy[ship.raOtherId].contNo || ("#" + takenBy[ship.raOtherId].id)}</b> chọn làm cont ra hộ — 1 cont chỉ ra 1 lần, kiểm tra lại lô nào đúng.</span>
                      </div>
                    )}
                    {ship.raOtherId == null
                      ? <div style={{ fontSize: 11.5, color: "var(--warn)", marginTop: 7, fontWeight: 500 }}>Chọn cont ra cùng chuyến để nhập giờ ra cho cont đó.</div>
                      : (otherGioXeRa || otherBksRa) && (
                        <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 7, fontWeight: 600, display: "flex", alignItems: "flex-start", gap: 6, lineHeight: 1.5 }}>
                          <i className="bi bi-check-circle-fill" style={{ marginTop: 1 }} />
                          <span>{otherBksRa ? <>BKS <b>{otherBksRa}</b> kéo cont <b>{otherLabel}</b> ra</> : <>Cont <b>{otherLabel}</b> ra</>}{otherGioXeRa ? <> lúc <b>{fmtDateTime(otherGioXeRa)}</b></> : ""} — lưu khi bấm <b>Lưu thông tin</b>.</span>
                        </div>
                      )}
                  </>
                )}

                {/* Cắt móc — không kéo ra: mốc là giờ XE rời đi, cont vẫn "chưa ra" */}
                {raMode === "none" && (
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                    <Field label="Giờ xe ra (của XE)" hint="cont vẫn tính chưa ra">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}><DTField value={ship.gioXeRaXe} onChange={setGioXeRaXe} /></div>
                        {nowBtn(() => setGioXeRaXe(nowLocalDT()))}
                      </div>
                    </Field>
                  </div>
                )}

                {/* Cắt móc: cont này thường chưa rời đi — giờ ra riêng của nó gấp lại, mở khi cần */}
                {raMode !== "self" && (
                  <details open={!!String(ship.gioXeRa || "").trim()} style={{ marginTop: 9 }}>
                    <summary style={{ fontSize: 11.5, color: "var(--ink-4)", cursor: "pointer" }}>Giờ ra riêng của chính cont này (nếu sau đó cont này cũng rời đi)</summary>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginTop: 7 }}>
                      <Field label="Giờ xe ra (cont này)"><DTField value={ship.gioXeRa} onChange={(x) => set({ gioXeRa: x })} /></Field>
                      <Field label="BKS ra (cont này)"><Combo value={ship.bksRa} onChange={(x) => set({ bksRa: x })} options={cfg.vehicles || []} onCreate={addVehExt} placeholder="15C-678.90…" /></Field>
                    </div>
                  </details>
                )}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0 4px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Free time</span>
                <span className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>{ft ? fmtHours(ft.hours) : "—"}</span>
                {ft && <span style={{ fontSize: 12, color: "var(--ink-4)" }}>(tính từ {ft.basis})</span>}
              </div>
              <div style={{ flex: 1 }} />
              {ft && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, padding: "6px 14px", borderRadius: 999,
                  color: ft.connect ? "var(--good)" : "var(--danger)", background: ft.connect ? "var(--good-weak)" : "#fce8e8" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: "currentColor" }} />
                  {ft.connect ? "CONNECT" : "DISCONNECT"}
                </span>
              )}
            </div>
          </Section>
        );
      })()}

      <Section title="Ghi chú">
        <textarea value={ship.infoNote || ""} onChange={(e) => set({ infoNote: e.target.value })} rows={3} placeholder="Ghi chú tự do cho lô hàng…"
          style={{ width: "100%", padding: "9px 11px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, marginTop: 4 }}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; e.target.style.boxShadow = "0 0 0 3px var(--accent-weak)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--line)"; e.target.style.boxShadow = "none"; }} />
      </Section>
    </Modal>
  );
}

/* ===================== CONFIG (master data) POPUP ===================== */


export { CostPopup, RevenuePopup, CostPopupICD, RevenuePopupICD, InfoPopup };
