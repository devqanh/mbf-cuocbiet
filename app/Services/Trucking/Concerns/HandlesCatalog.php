<?php

namespace App\Services\Trucking\Concerns;

use App\Models\TruckingContType;
use App\Models\TruckingCostItem;
use App\Models\TruckingCostLine;
use App\Models\TruckingChohoItem;
use App\Models\TruckingCustomer;
use App\Models\TruckingDriver;
use App\Models\TruckingLocation;
use App\Models\TruckingPayer;
use App\Models\TruckingPriceRow;
use App\Models\TruckingFuelPrice;
use App\Models\TruckingRevenueItem;
use App\Models\TruckingRouteFee;
use App\Models\TruckingSalaryItem;
use App\Models\TruckingTripCostBatch;
use App\Models\TruckingTripCostLine;
use App\Models\TruckingVehicleCost;
use App\Models\TruckingVehicleDepreciation;
use App\Models\TruckingVehicleUsage;
use App\Models\TruckingSetting;
use App\Models\TruckingAttachment;
use App\Models\TruckingPlanLink;
use App\Models\TruckingShipment;
use App\Models\TruckingShipmentWarehouse;
use App\Models\TruckingVehicleCostType;
use App\Models\TruckingAssetCategory;
use App\Support\Hashid;
use App\Models\TruckingStatement;
use App\Models\TruckingVehicle;
use App\Models\TruckingWarehouse;
use App\Models\User;
use App\Notifications\SpendRequestCreatedNotification;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;

/** Tách từ TruckingV2Service — nhóm HandlesCatalog. */
trait HandlesCatalog
{
    // ===================================================================
    // CONFIG (master data) — serialize & persist
    // ===================================================================
    public function config(bool $withPrices = true, bool $priceCounts = false): array
    {
        $cfg = ['locationCode' => [], 'warehouseCode' => [], 'prices' => [], 'costColors' => []];

        // Mỗi danh mục một bảng riêng
        foreach ($this->lookups() as $key => [$cls, $priced, $coded, $colored]) {
            $rows = $cls::orderBy('sort')->orderBy('name')->get();
            $cfg[$key] = $rows->pluck('name')->all();
            if ($coded) {
                // Map tên→mã (cho định giá; tên trùng thì lấy mã cuối — chấp nhận được)
                $cfg[$coded] = $rows->filter(fn ($r) => $r->code)
                    ->mapWithKeys(fn ($r) => [$r->name => $r->code])->all();
                // Mảng mã theo CHỈ SỐ dòng (định danh thực = mã; tên được phép trùng)
                $cfg[$coded . 'Arr'] = $rows->map(fn ($r) => $r->code ?? '')->all();
                // Mảng ID theo CHỈ SỐ dòng → reconcile khớp theo id, cho SỬA mã mà giữ nguyên id (không đứt link)
                $cfg[$key . 'IdArr'] = $rows->map(fn ($r) => $r->id)->all();
            }
            if ($key === 'warehouses') {   // Kho có thêm Địa chỉ + Ghi chú + Tọa độ (mảng theo chỉ số dòng)
                $cfg['warehouseAddr']    = $rows->filter(fn ($r) => $r->address)->mapWithKeys(fn ($r) => [$r->name => $r->address])->all();
                $cfg['warehouseAddrArr'] = $rows->map(fn ($r) => $r->address ?? '')->all();
                $cfg['warehouseGeoArr']  = $rows->map(fn ($r) => ($r->lat !== null && $r->lng !== null) ? ($r->lat . ',' . $r->lng) : '')->all();
                // Ghi chú kho = "địa chỉ đóng hàng" khi xuất Excel lô hàng. Map theo TÊN và theo KÝ HIỆU
                // (lô lưu kho bằng ký hiệu; 1 ký hiệu nhiều tên → lấy ghi chú của dòng ĐẦU có ghi chú).
                $cfg['warehouseNote']    = $rows->filter(fn ($r) => $r->note)->mapWithKeys(fn ($r) => [$r->name => $r->note])->all();
                $cfg['warehouseNoteArr'] = $rows->map(fn ($r) => $r->note ?? '')->all();
                $cfg['warehouseNoteCode'] = $rows->filter(fn ($r) => $r->note && $r->code)
                    ->reduce(function ($acc, $r) { $acc[$r->code] ??= $r->note; return $acc; }, []);
            }
            if ($priced) {
                foreach ($rows as $r) {
                    if ($r->default_price !== null) $cfg['prices'][$r->name] = $this->outMoney($r->default_price);
                }
            }
            if ($colored) {
                $cfg['costAuto'] ??= [];
                $cfg['costVat'] ??= [];
                foreach ($rows as $r) {
                    if (!empty($r->color)) $cfg['costColors'][$r->name] = $r->color;
                    if (!empty($r->auto))  $cfg['costAuto'][$r->name] = true;   // tự hiện ở popup + nhắc "chưa điền"
                    if ($r->vat !== null)  $cfg['costVat'][$r->name] = $this->outNum($r->vat);   // VAT% mặc định
                }
            }
        }

        // Địa điểm đang được LINK (price_rows tham chiếu) → khóa, không cho sửa/xóa
        $lockedIds = TruckingPriceRow::query()->whereNotNull('location_id')->distinct()->pluck('location_id');
        $cfg['locationLocked'] = TruckingLocation::whereIn('id', $lockedIds)->pluck('name')->all();

        // Khách hàng + thông tin + bảng giá.
        //  - $withPrices=true  : kèm full priceList (trang dùng priceFor: Bảng kê / Tạo bảng kê).
        //  - $priceCounts=true : chỉ kèm priceCount cho badge (trang Bảng giá lazy-load từng khách).
        //  - cả hai false      : không bảng giá (trang Lô hàng / Cài đặt).
        // Lưu ý: KHÔNG set key 'priceList' ở chế độ count — để save (reconcileCustomers) không
        // tưởng nhầm "gửi danh sách rỗng" rồi xóa sạch bảng giá của khách chưa mở.
        $customers = TruckingCustomer::query()
            ->when($withPrices, fn ($q) => $q->with('priceRows'))
            ->when($priceCounts, fn ($q) => $q->withCount('priceRows'))
            ->orderBy('name')->get();
        $cfg['customers'] = $customers->pluck('name')->all();
        $cfg['customerInfo'] = $customers->mapWithKeys(function ($c) use ($withPrices, $priceCounts) {
            $entry = [
                'shortName' => $c->short_name ?? '',
                'taxCode'   => $c->tax_code ?? '',
                'phone'     => $c->phone ?? '',
                'contact'   => $c->contact ?? '',
                'email'     => $c->email ?? '',
                'termDays'  => $c->term_days !== null ? (string) $c->term_days : '',
                'address'   => $c->address ?? '',
                'note'      => $c->note ?? '',
            ];
            if ($withPrices)  $entry['priceList']  = $c->priceRows->map(fn ($p) => $this->priceRowToArray($p))->all();
            if ($priceCounts) $entry['priceCount'] = (int) ($c->price_rows_count ?? 0);
            return [$c->name => $entry];
        })->all();

        // Đội xe + loại
        $vehicles = TruckingVehicle::orderBy('plate')->get();
        $cfg['vehicles'] = $vehicles->pluck('plate')->all();
        $cfg['vehicleType'] = $vehicles->mapWithKeys(fn ($v) => [$v->plate => $v->type])->all();
        $cfg['vehicleAxle'] = $vehicles->filter(fn ($v) => $v->axle)->mapWithKeys(fn ($v) => [$v->plate => $v->axle])->all();
        $cfg['vehicleGps']  = $vehicles->filter(fn ($v) => $v->gps_ref)->mapWithKeys(fn ($v) => [$v->plate => $v->gps_ref])->all();

        // Settings
        $cfg['vatDefault'] = [
            'hph' => TruckingSetting::get('vat_default_hph', '8'),
            'icd' => TruckingSetting::get('vat_default_icd', '0'),
        ];
        $cfg['freeTimeHours'] = TruckingSetting::get('free_time_hours', '4');
        $cfg['freeTimeRules'] = $this->freeTimeRulesArray();
        $cfg['dueWarnDays']   = TruckingSetting::get('due_warn_days', '30');

        return $cfg;
    }

    /** Quy tắc ngưỡng free time theo KHOẢNG NGÀY (lưu JSON ở setting free_time_rules). */
    public function freeTimeRulesArray(): array
    {
        $raw = TruckingSetting::get('free_time_rules', '');
        $arr = is_array($raw) ? $raw : (json_decode((string) $raw, true) ?: []);
        $out = [];
        foreach ((is_array($arr) ? $arr : []) as $r) {
            $from = trim((string) ($r['from'] ?? ''));
            if ($from === '') continue;
            $out[] = [
                'from'  => $from,
                'to'    => trim((string) ($r['to'] ?? '')) ?: null,
                'hours' => (isset($r['hours']) && $r['hours'] !== '' && $r['hours'] !== null) ? (float) $r['hours'] : null,
                'note'  => trim((string) ($r['note'] ?? '')),
            ];
        }
        return $out;
    }

    /** Đếm số mục mỗi danh mục — cho badge sidebar Cài đặt (không hydrate, rất nhẹ). */
    /** Danh sách code (ký hiệu) đang được Phí tuyến dùng → code => số tuyến. */
    public function routeFeeUsedCodes(): array
    {
        $norm = fn ($v) => mb_strtoupper(preg_replace('/\s+/u', '', trim(\Illuminate\Support\Str::ascii((string) $v))) ?? '');
        $codeMap = $this->normalizedCodeMap();
        $used = [];
        foreach (TruckingRouteFee::pluck('route') as $route) {
            $parts = preg_split('/\s*(?:,|→|->|–|—|\s-\s)\s*/u', trim((string) $route)) ?: [];
            foreach ($parts as $p) {
                $p = trim($p); if ($p === '') continue;
                $code = $codeMap[$norm($p)] ?? $norm($p);
                $used[$code] = ($used[$code] ?? 0) + 1;
            }
        }
        return $used;
    }

    public function catalogCounts(): array
    {
        $c = [];
        foreach ($this->lookups() as $key => [$cls]) $c[$key] = $cls::count();
        $c['customers'] = TruckingCustomer::count();
        $c['vehicles']  = TruckingVehicle::count();
        $c['routeFees'] = TruckingRouteFee::count();
        $c['fuelPrices'] = TruckingFuelPrice::count();
        return $c;
    }

    /**
     * Dữ liệu của ĐÚNG 1 tab Cài đặt (lazy-load khi click tab) — tránh nạp toàn bộ danh mục
     * cùng lúc (nguy hiểm khi 2 người cùng cấu hình + nặng). Mỗi lần mở tab lấy dữ liệu TƯƠI.
     */
    public function catalogData(string $key): array
    {
        $lk = $this->lookups();
        if ($key === 'drivers') {            // hồ sơ lái xe đầy đủ (không chỉ tên)
            return ['drivers' => $this->driversManaged()];
        }
        if (isset($lk[$key])) {
            [$cls, $priced, $coded, $colored] = $lk[$key];
            $rows = $cls::orderBy('sort')->orderBy('name')->get();
            $out = [$key => $rows->pluck('name')->all()];
            if ($coded) {
                $out[$coded] = $rows->filter(fn ($r) => $r->code)->mapWithKeys(fn ($r) => [$r->name => $r->code])->all();
                $out[$coded . 'Arr'] = $rows->map(fn ($r) => $r->code ?? '')->all();   // mã theo chỉ số dòng
                // Mảng ID theo chỉ số dòng — BẮT BUỘC để reconcileLookup khớp theo id (giữ id, không
                // xóa+tạo lại khi lưu). Phải ĐỒNG BỘ với config() full; thiếu là save sẽ churn id/đứt link.
                $out[$key . 'IdArr'] = $rows->map(fn ($r) => $r->id)->all();
                if ($key === 'warehouses') {
                    $out['warehouseAddr']    = $rows->filter(fn ($r) => $r->address)->mapWithKeys(fn ($r) => [$r->name => $r->address])->all();
                    $out['warehouseAddrArr'] = $rows->map(fn ($r) => $r->address ?? '')->all();
                    $out['warehouseGeoArr']  = $rows->map(fn ($r) => ($r->lat !== null && $r->lng !== null) ? ($r->lat . ',' . $r->lng) : '')->all();
                    $out['warehouseNote']    = $rows->filter(fn ($r) => $r->note)->mapWithKeys(fn ($r) => [$r->name => $r->note])->all();
                    $out['warehouseNoteArr'] = $rows->map(fn ($r) => $r->note ?? '')->all();
                    $out['warehouseNoteCode'] = $rows->filter(fn ($r) => $r->note && $r->code)
                        ->reduce(function ($acc, $r) { $acc[$r->code] ??= $r->note; return $acc; }, []);
                }
                if ($key === 'locations') {
                    $lockedIds = TruckingPriceRow::query()->whereNotNull('location_id')->distinct()->pluck('location_id');
                    $out['locationLocked'] = TruckingLocation::whereIn('id', $lockedIds)->pluck('name')->all();
                }
                // Codes đang được Phí tuyến tham chiếu — cảnh báo nếu đổi code sẽ làm lệch tuyến.
                if ($key === 'locations' || $key === 'warehouses') {
                    $out['routeFeeUsedCodes'] = $this->routeFeeUsedCodes();
                }
            }
            if ($priced) {
                $out['prices'] = [];
                foreach ($rows as $r) if ($r->default_price !== null) $out['prices'][$r->name] = $this->outMoney($r->default_price);
            }
            if ($colored) {
                $out['costColors'] = [];
                $out['costAuto'] = [];
                $out['costVat'] = [];
                foreach ($rows as $r) {
                    if (! empty($r->color)) $out['costColors'][$r->name] = $r->color;
                    if (! empty($r->auto))  $out['costAuto'][$r->name] = true;
                    if ($r->vat !== null)   $out['costVat'][$r->name] = $this->outNum($r->vat);
                }
            }
            return $out;
        }
        if ($key === 'customers') {
            $customers = TruckingCustomer::orderBy('name')->get();
            return [
                'customers'    => $customers->pluck('name')->all(),
                'customerInfo' => $customers->mapWithKeys(fn ($c) => [$c->name => [
                    'shortName' => $c->short_name ?? '', 'taxCode' => $c->tax_code ?? '', 'phone' => $c->phone ?? '',
                    'contact' => $c->contact ?? '', 'email' => $c->email ?? '',
                    'termDays' => $c->term_days !== null ? (string) $c->term_days : '', 'address' => $c->address ?? '', 'note' => $c->note ?? '',
                ]])->all(),
            ];
        }
        if ($key === 'vehicles') {
            $v = TruckingVehicle::orderBy('plate')->get();
            $gpsVehicles = [];
            try { $gpsVehicles = app(\App\Services\Gps\GpsTrackingService::class)->vehicleOptions(); } catch (\Throwable) {}
            return [
                'vehicles'    => $v->pluck('plate')->all(),
                'vehicleType' => $v->mapWithKeys(fn ($x) => [$x->plate => $x->type])->all(),
                'vehicleAxle' => $v->filter(fn ($x) => $x->axle)->mapWithKeys(fn ($x) => [$x->plate => $x->axle])->all(),
                'vehicleGps'  => $v->filter(fn ($x) => $x->gps_ref)->mapWithKeys(fn ($x) => [$x->plate => $x->gps_ref])->all(),
                'gpsVehicles' => $gpsVehicles,   // danh sách xe GPS cho dropdown (gộp mọi nguồn)
            ];
        }
        if ($key === '__general') {   // cấu hình chung: VAT mặc định + Free time + cảnh báo hạn (+ mở rộng sau)
            return [
                'vatDefault'    => ['hph' => TruckingSetting::get('vat_default_hph', '8'), 'icd' => TruckingSetting::get('vat_default_icd', '0')],
                'freeTimeHours' => TruckingSetting::get('free_time_hours', '4'),
                'freeTimeRules' => $this->freeTimeRulesArray(),
                'dueWarnDays'   => TruckingSetting::get('due_warn_days', '30'),
            ];
        }
        if ($key === 'routeFees') {
            // kèm danh sách KHO + ĐỊA ĐIỂM (cảng) để chọn cả chuỗi tuyến Cảng→Kho→Kho→Cảng (MultiCombo groups)
            return [
                'routeFees'  => $this->routeFees(),
                'warehouses' => TruckingWarehouse::orderBy('sort')->orderBy('name')->pluck('name')->all(),
                'locations'  => TruckingLocation::orderBy('sort')->orderBy('name')->pluck('name')->all(),
            ];
        }
        if ($key === 'fuelPrices') {
            return ['fuelPrices' => $this->fuelPrices()];
        }
        return [];
    }

}
