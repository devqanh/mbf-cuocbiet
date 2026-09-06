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
use App\Models\TruckingRevenueLine;
use App\Models\TruckingRouteFee;
use App\Models\TruckingSalaryItem;
use App\Models\TruckingTripCostBatch;
use App\Models\TruckingTripCostLine;
use App\Models\TruckingPayrollPeriod;
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

/** Tach tu TruckingV2Service - nhom HandlesTripAndDrivers. */
trait HandlesTripAndDrivers
{
    // ===================================================================
    // PHÍ XE NỘI BỘ (trip cost) — gom phí tuyến + dầu + phí khác theo từng lô
    // ===================================================================

    /**
     * Chuẩn hóa 1 tuyến/danh sách kho thành KHÓA tuyến (UPPER, đúng thứ tự, nối "|").
     * Khoan dung dấu nối: dấu phẩy, " - " (gạch có khoảng trắng), mũi tên → cùng 1 khóa.
     * Nhờ vậy kho lô "TL, TS, QV" và phí tuyến "TL - TS - QV" khớp nhau dù khác dấu/khoảng trắng/hoa-thường.
     * Vẫn GIỮ thứ tự (TL→TS→QV ≠ TL→QV→TS) vì chiều tuyến có ý nghĩa.
     */
    /**
     * Hiển thị TUYẾN KHO: mỗi điểm "tên hiển thị (ký hiệu)" (nếu tên ≠ ký hiệu), nối bằng " → ".
     * Phí xe khớp theo TUYẾN KHO (cột `kho`) — KHÔNG quan tâm nơi lấy/nơi hạ.
     */
    private function khoRouteDisplay(?string $kho): string
    {
        $kho = trim((string) $kho);
        if ($kho === '') return '';
        static $map = null;
        if ($map === null) {
            $map = [];
            foreach (TruckingWarehouse::get(['name', 'code']) as $w) {
                if ($w->code) $map[mb_strtoupper(trim((string) $w->code))] = ['name' => $w->name, 'code' => $w->code];
                if ($w->name) $map[mb_strtoupper(trim((string) $w->name))] = ['name' => $w->name, 'code' => $w->code];
            }
        }
        $segs = preg_split('/\s*(?:,|→|->|–|—|\s-\s)\s*/u', $kho) ?: [];
        $out = [];
        foreach ($segs as $seg) {
            $seg = trim($seg);
            if ($seg === '') continue;
            $w = $map[mb_strtoupper($seg)] ?? null;
            if ($w && $w['name'] && $w['code'] && trim((string) $w['name']) !== trim((string) $w['code'])) {
                $out[] = $w['name'] . ' (' . $w['code'] . ')';
            } else {
                $out[] = $w['name'] ?? $seg;
            }
        }
        return implode(' → ', $out);
    }

    /** Tách tuyến kho thành MẢNG nhãn điểm — hiển thị TÊN kho (cho hành trình lái xe / lô hàng). */
    public function khoPoints(?string $kho): array
    {
        return $this->khoResolve($kho, false);
    }

    /** Tách tuyến kho thành MẢNG KÝ HIỆU kho (cho Lộ trình — kế toán theo dõi, ký hiệu gọn dễ hiểu). */
    public function khoCodePoints(?string $kho): array
    {
        return $this->khoResolve($kho, true);
    }

    /** Đổi 1 ĐỊA ĐIỂM (Nơi lấy/Nơi hạ — tên hoặc ký hiệu) → KÝ HIỆU (cho Lộ trình). Fallback giữ nguyên nếu không khớp. */
    public function locCode(?string $loc): string
    {
        $loc = trim((string) $loc);
        if ($loc === '') return '';
        static $map = null;
        if ($map === null) {
            $map = [];
            foreach (TruckingLocation::get(['name', 'code']) as $l) {
                $code = $l->code ?: $l->name;   // thiếu ký hiệu → fallback tên
                if ($l->code) $map[mb_strtoupper(trim((string) $l->code))] = $code;
                if ($l->name) $map[mb_strtoupper(trim((string) $l->name))] = $code;
            }
        }
        return $map[mb_strtoupper($loc)] ?? $loc;
    }

    /** Tách "tuyến kho" (chuỗi nhiều kho) → mảng nhãn; $toCode=true → KÝ HIỆU, false → TÊN. */
    private function khoResolve(?string $kho, bool $toCode): array
    {
        $kho = trim((string) $kho);
        if ($kho === '') return [];
        static $maps = [];
        $k = $toCode ? 'code' : 'name';
        if (! isset($maps[$k])) {
            $m = [];
            foreach (TruckingWarehouse::get(['name', 'code']) as $w) {
                $val = $toCode ? ($w->code ?: $w->name) : ($w->name ?: $w->code);   // ký hiệu / tên (fallback chéo nếu thiếu)
                if ($w->code) $m[mb_strtoupper(trim((string) $w->code))] = $val;
                if ($w->name) $m[mb_strtoupper(trim((string) $w->name))] = $val;
            }
            $maps[$k] = $m;
        }
        $segs = preg_split('/\s*(?:,|→|->|–|—|\s-\s)\s*/u', $kho) ?: [];
        $out = [];
        foreach ($segs as $seg) {
            $seg = trim($seg);
            if ($seg === '') continue;
            $out[] = $maps[$k][mb_strtoupper($seg)] ?? $seg;
        }
        return $out;
    }

    private function routeKey(string $s): string
    {
        $parts = preg_split('/\s*(?:,|→|->|–|—|\s-\s)\s*/u', trim($s)) ?: [];
        $parts = array_values(array_filter(array_map(function ($x) {
            return mb_strtoupper(preg_replace('/\s+/u', ' ', trim($x)));
        }, $parts), fn ($x) => $x !== ''));
        return implode('|', $parts);
    }

    /** Giá dầu (đồng/lít) áp dụng cho 1 ngày Y-m-d (dò bảng giá dầu trong RAM). */
    private function fuelPriceForDate($fuels, ?string $d): float
    {
        if (! $d) return 0;
        foreach ($fuels as $f) {
            $fd = $f->from_date?->format('Y-m-d');
            $td = $f->to_date?->format('Y-m-d');
            if ($fd && $fd <= $d && (! $td || $td >= $d)) return (float) $f->price;
        }
        return 0;
    }

    /** Nạp config nhỏ 1 lần vào RAM (route_fees/xe/giá dầu/lịch dùng xe) → tính từng lô 0 query. */
    private function tripConfigBundle(): array
    {
        // Khóa tuyến TÍNH LẠI từ text (không tin route_key đã lưu — có thể cũ/rỗng nếu chưa lưu lại).
        $routeByKey = [];
        foreach (TruckingRouteFee::all() as $rf) { $k = $this->routeKey((string) $rf->route); if ($k !== '') $routeByKey[$k] = $rf; }
        return [
            'routeByKey'  => $routeByKey,
            'vehByPlate'  => TruckingVehicle::get()->keyBy('plate'),
            'fuels'       => TruckingFuelPrice::orderByDesc('from_date')->orderByDesc('id')->get(),
            'usagesByVeh' => TruckingVehicleUsage::get()->groupBy('vehicle_id'),
        ];
    }

    /** Gợi ý phí cho 1 lô: dò route_fee theo kho, dầu theo cầu xe, giá dầu theo ngày, lái xe theo lịch dùng xe. */
    private function tripSuggest($s, array $bundle): array
    {
        $date = $s->gio_xe_ra?->format('Y-m-d');
        $rf   = $bundle['routeByKey'][$this->routeKey((string) $s->kho)] ?? null;
        $veh  = $bundle['vehByPlate'][$s->bks_vao] ?? null;
        $axle = $veh?->axle;
        $liters = $rf ? (float) ($axle === '2' ? $rf->dau_2cau : $rf->dau_1cau) : 0;
        $price  = $this->fuelPriceForDate($bundle['fuels'], $date);

        $driver = '';
        $hasUsage = isset($bundle['usagesByVeh'][$veh?->id]);
        foreach (($bundle['usagesByVeh'][$veh?->id] ?? []) as $u) {
            $uf = $u->from_date?->format('Y-m-d');
            $ut = $u->to_date?->format('Y-m-d');
            if ($date && $uf && $uf <= $date && (! $ut || $ut >= $date)) { $driver = $u->driver ?? ''; break; }
        }

        // Chẩn đoán từng mắt xích để cảnh báo đúng nguyên nhân (kế toán rà soát).
        $diag = [
            'hasBks'      => trim((string) $s->bks_vao) !== '',
            'vehFound'    => (bool) $veh,            // BKS có thuộc xe MBF nội bộ?
            'hasAxle'     => $veh && $axle !== null && $axle !== '',
            'routeFound'  => (bool) $rf,
            'driverFound' => $driver !== '',         // có lịch dùng xe phủ ngày?
            'hasUsage'    => $hasUsage,              // xe có lịch dùng xe nào chưa?
            'fuelFound'   => $price > 0,            // có bảng giá dầu phủ ngày?
        ];

        return [
            'axle'        => $axle ?? '',
            'matched'     => (bool) $rf,
            'diag'        => $diag,
            'salaryParts' => $rf ? $this->cleanSalaryParts($rf->salary_parts) : ['troCap', 'luong'],
            'sug'         => [
                'driver'     => $driver,
                'veTram'     => $rf ? $this->outMoney($rf->ve_tram) : '0',
                'tienDuong'  => $rf ? $this->outMoney($rf->tien_duong) : '0',
                'troCap'     => $rf ? $this->outMoney($rf->tro_cap) : '0',
                'phiKhac'    => '0',   // Phí khác (tuyến) đã bỏ — không gợi ý cho dòng mới (data cũ vẫn giữ để hiện đúng)
                'cru'        => (bool) $s->cru,
                // Lương theo CRU: tích CRU → `luong`; KHÔNG tích → `luong_no_cru`
                'luong'      => $rf ? ($s->cru ? $this->outMoney($rf->luong) : $this->outMoney($rf->luong_no_cru)) : '0',
                'fuelLiters' => $this->outNum($liters),
                'fuelPrice'  => $this->outMoney($price),
                'extras'     => [],
                'salaryExtras' => [],
            ],
        ];
    }

    /** Bảng giá tuyến (để chọn/áp tay khi không khớp tự động). */
    private function routeFeesOut(): array
    {
        return TruckingRouteFee::orderBy('sort')->get()->map(fn ($r) => [
            'route' => $r->route, 'routeKey' => $r->route_key,
            'veTram' => $this->outMoney($r->ve_tram), 'tienDuong' => $this->outMoney($r->tien_duong),
            'troCap' => $this->outMoney($r->tro_cap), 'phiKhac' => $this->outMoney($r->phi_khac),
            'luong' => $this->outMoney($r->luong), 'luongNoCru' => $this->outMoney($r->luong_no_cru),
            'dau1' => $this->outNum($r->dau_1cau), 'dau2' => $this->outNum($r->dau_2cau),
            'salaryParts' => $this->cleanSalaryParts($r->salary_parts),
        ])->all();
    }

    /** Tùy chọn lái xe cho dropdown: value=tên (giữ tương thích), label="Tên · SĐT" để phân biệt trùng tên. */
    private function driverOptions(): array
    {
        return TruckingDriver::orderBy('sort')->orderBy('name')->get()->map(function ($d) {
            $phone = (is_array($d->phones) && count($d->phones)) ? $d->phones[0] : null;
            return ['value' => $d->name, 'label' => $phone ? ($d->name . ' · ' . $phone) : $d->name];
        })->all();
    }

    private function driversOut(): array
    {
        return $this->driverOptions();
    }

    /** Danh mục khoản cho Phí xe: chi phí khác (costItems) + khoản lương thêm (salaryItems). */
    private function tripItemOptions(): array
    {
        return [
            'costItems'   => TruckingCostItem::orderBy('sort')->orderBy('name')->pluck('name')->all(),
            'salaryItems' => TruckingSalaryItem::orderBy('sort')->orderBy('name')->pluck('name')->all(),
        ];
    }

    // ===================================================================
    // HỒ SƠ LÁI XE (rich: SĐT/ngày/tài khoản/tài liệu)
    // ===================================================================

    /** Tài liệu của 1 lái xe (từ bảng attachments tập trung). */
    private function driverDocsOut(TruckingDriver $d): array
    {
        return $this->listAttachments(TruckingDriver::class, $d->id, 'doc');
    }

    /** Danh sách lái xe đầy đủ hồ sơ (cho tab Cài đặt). */
    private function driversManaged(): array
    {
        return TruckingDriver::orderBy('sort')->orderBy('name')->get()->map(fn ($d) => [
            'id'         => $d->id,
            'hashid'     => Hashid::encode($d->id),
            'name'       => $d->name,
            'phones'     => is_array($d->phones) ? array_values($d->phones) : [],
            'birthday'   => $this->outDate($d->birthday),
            'joinedDate' => $this->outDate($d->joined_date),
            'banks'      => is_array($d->bank_accounts) ? array_values($d->bank_accounts) : [],
            'docs'       => $this->driverDocsOut($d),
        ])->all();
    }

    private function cleanList($arr): array
    {
        if (! is_array($arr)) return [];
        return array_values(array_filter(array_map(fn ($x) => trim((string) $x), $arr), fn ($x) => $x !== ''));
    }

    private function cleanBanks($arr): array
    {
        if (! is_array($arr)) return [];
        $out = [];
        foreach ($arr as $b) {
            if (! is_array($b)) continue;
            $bank = $this->str($b['bank'] ?? null); $num = $this->str($b['number'] ?? null); $holder = $this->str($b['holder'] ?? null);
            $bin = $this->str($b['bin'] ?? null); $code = $this->str($b['code'] ?? null);
            if ($bank === null && $num === null && $holder === null) continue;
            $out[] = ['bank' => $bank ?? '', 'number' => $num ?? '', 'holder' => $holder ?? '', 'bin' => $bin ?? '', 'code' => $code ?? ''];
        }
        return $out;
    }

    /** Lưu hồ sơ lái xe (reconcile theo id; KHÔNG đụng tài liệu — quản lý qua upload riêng). */
    public function saveDrivers(array $rows): void
    {
        DB::transaction(function () use ($rows) {
            $keepIds = [];
            foreach (array_values($rows) as $i => $r) {
                $id = $r['id'] ?? null;
                $data = [
                    'name'          => $this->str($r['name'] ?? null) ?: 'Lái xe',
                    'sort'          => $i,
                    'phones'        => $this->cleanList($r['phones'] ?? []),
                    'birthday'      => $this->inDate($r['birthday'] ?? null),
                    'joined_date'   => $this->inDate($r['joinedDate'] ?? null),
                    'bank_accounts' => $this->cleanBanks($r['banks'] ?? []),
                ];
                if (is_numeric($id) && ($d = TruckingDriver::find($id))) {
                    $d->fill($data)->save();
                } else {
                    $d = TruckingDriver::create($data + ['documents' => []]);
                }
                $keepIds[] = $d->id;
            }
            foreach (TruckingDriver::whereNotIn('id', $keepIds ?: [0])->get() as $gone) {
                $this->deleteDriverFiles($gone);
                $gone->delete();
            }
        });
    }

    /** Tải tài liệu (nhiều file) cho 1 lái xe → trả danh sách tài liệu mới. */
    public function uploadDriverDocs(TruckingDriver $d, array $files, string $type): array
    {
        $this->storeAttachments(TruckingDriver::class, $d->id, 'doc', $files, $type ?: 'Khác', "trucking/drivers/{$d->id}");
        return $this->driverDocsOut($d);
    }

    /** Xóa tài liệu lái xe theo ID attachment. */
    public function deleteDriverDoc(TruckingDriver $d, int $attachmentId): array
    {
        $this->deleteAttachment($attachmentId, TruckingDriver::class, $d->id);
        return $this->driverDocsOut($d);
    }

    private function deleteDriverFiles(TruckingDriver $d): void
    {
        foreach (TruckingAttachment::where(['owner_type' => TruckingDriver::class, 'owner_id' => $d->id])->get() as $a) {
            try { $this->disk($a->disk)->delete($a->path); } catch (\Throwable $e) {}
            $a->delete();
        }
    }

    /**
     * Trang TẠO kỳ: gom lô có "giờ xe ra" trong [from,to] + gợi ý phí.
     * Kèm "usedIn" (các kỳ đã chứa lô) để cảnh báo cộng trùng lương/dầu.
     */
    public function computeTripCosts(?string $from, ?string $to): array
    {
        $q = TruckingShipment::query()->whereNotNull('gio_xe_ra');
        if ($from) $q->whereDate('gio_xe_ra', '>=', $from);
        if ($to)   $q->whereDate('gio_xe_ra', '<=', $to);
        $ships = $q->orderBy('gio_xe_ra')->get();

        $bundle = $this->tripConfigBundle();
        $inBatch = [];
        foreach (TruckingTripCostLine::with('batch')->whereIn('shipment_id', $ships->pluck('id'))->get() as $l) {
            if ($l->shipment_id) $inBatch[$l->shipment_id][] = $l->batch?->no ?? ('#' . $l->batch_id);
        }

        $spent = $this->spendsByShipment($ships->pluck('id')->all());
        $rows = [];
        foreach ($ships as $s) {
            $sg = $this->tripSuggest($s, $bundle);
            $rows[] = [
                'shipmentId' => $s->id,
                'booking'    => $s->booking ?? '',
                'route'      => trim(($s->from_loc ?? '') . ' → ' . ($s->to_loc ?? ''), ' →'),
                'kho'        => $s->kho ?? '',
                'khoRoute'   => $this->khoRouteDisplay($s->kho),   // tuyến KHO (tên + ký hiệu) — phí xe khớp theo cái này

                'bks'        => $s->bks_vao ?? '',
                'axle'       => $sg['axle'],
                'date'       => $this->outDate($s->gio_xe_ra),
                'matched'     => $sg['matched'],
                'diag'        => $sg['diag'],
                'salaryParts' => $sg['salaryParts'],
                'usedIn'      => $inBatch[$s->id] ?? [],
                'spent'       => $spent[$s->id] ?? self::EMPTY_SPENT,   // đã chi + chưa chi (duyệt chi theo lô)
                'cur'        => $sg['sug'],
                'sug'        => $sg['sug'],
            ];
        }

        return ['rows' => $rows, 'routeFees' => $this->routeFeesOut(), 'drivers' => $this->driversOut()] + $this->tripItemOptions();
    }

    /**
     * (Đã bỏ "duyệt chi theo lô" — chi cho lái xe nay quản lý ở Lộ trình qua
     * trucking_route_pays.) Giữ hàm trả rỗng để các nơi cũ vẫn chạy, cột "Đã chi"
     * ở Phí xe hiển thị 0; phần tính lương lái xe sẽ làm lại sau.
     */
    private function spendsByShipment(array $shipmentIds): array
    {
        return [];
    }

    /** Khung "spent" rỗng (đã chi + chưa chi) — dùng làm mặc định khi lô chưa có duyệt chi. */
    private const EMPTY_SPENT = ['salary' => 0, 'company' => 0, 'total' => 0, 'unpaidSalary' => 0, 'unpaidCompany' => 0, 'unpaidTotal' => 0];

    /** Số kỳ kế tiếp (PX-0001…) nếu người dùng không nhập. */
    private function nextTripNo(): string
    {
        return 'PX-' . str_pad((string) (TruckingTripCostBatch::max('id') + 1), 4, '0', STR_PAD_LEFT);
    }

    /** Danh sách kỳ phí xe (tóm tắt) cho trang chủ. */
    public function tripBatchesForList(): array
    {
        return TruckingTripCostBatch::withCount('lines')->orderByDesc('id')->get()->map(fn ($b) => [
            'id'    => $b->id,
            'hashid' => Hashid::encode($b->id),
            'no'    => $b->no,
            'name'  => $b->name ?? '',
            'date'  => $this->outDate($b->date),
            'from'  => $this->outDate($b->period_from),
            'to'    => $this->outDate($b->period_to),
            'count' => $b->lines_count,
            'total' => (int) round((float) $b->total),
        ])->all();
    }

    /** Snapshot 1 kỳ (cho trang Xem/Sửa). */
    public function tripBatchToArray(TruckingTripCostBatch $b): array
    {
        $spent = $this->spendsByShipment($b->lines->pluck('shipment_id')->all());
        return [
            'id'    => $b->id,
            'hashid' => Hashid::encode($b->id),
            'no'    => $b->no,
            'name'  => $b->name ?? '',
            'date'  => $this->outDate($b->date),
            'from'  => $this->outDate($b->period_from),
            'to'    => $this->outDate($b->period_to),
            'note'  => $b->note ?? '',
            'total' => (int) round((float) $b->total),
            'rows'  => $b->lines->map(fn ($l) => [
                'lineId'     => $l->id,
                'shipmentId' => $l->shipment_id,
                'booking'    => $l->booking ?? '',
                'route'      => $l->route ?? '',
                'kho'        => $l->kho ?? '',
                'khoRoute'   => $this->khoRouteDisplay($l->kho),   // tuyến KHO (tên + ký hiệu)

                'bks'        => $l->bks ?? '',
                'axle'        => $l->axle ?? '',
                'date'        => $this->outDate($l->date),
                'matched'     => true,
                'salaryParts' => $this->cleanSalaryParts($l->salary_parts),
                'usedIn'      => [],
                'spent'       => $spent[$l->shipment_id] ?? self::EMPTY_SPENT,   // đã chi + chưa chi theo lô
                'cur'        => [
                    'driver'     => $l->driver ?? '',
                    'veTram'     => $this->outMoney($l->ve_tram),
                    'tienDuong'  => $this->outMoney($l->tien_duong),
                    'troCap'     => $this->outMoney($l->tro_cap),
                    'phiKhac'    => $this->outMoney($l->phi_khac),
                    'cru'        => (bool) $l->cru,
                    'luong'      => $this->outMoney($l->luong),
                    'fuelLiters' => $this->outNum($l->fuel_liters),
                    'fuelPrice'  => $this->outMoney($l->fuel_price),
                    'extras'     => is_array($l->extras) ? $l->extras : [],
                    'salaryExtras' => is_array($l->salary_extras) ? $l->salary_extras : [],
                ],
            ])->all(),
        ];
    }

    /**
     * Ngữ cảnh "Tính lại" cho kỳ đã lưu (tải lazy): gợi ý mới theo cấu hình hiện tại,
     * keyed theo shipment_id; báo "missing" những lô đã bị xóa khỏi hệ thống.
     */
    public function tripBatchContext(TruckingTripCostBatch $b): array
    {
        $ids   = $b->lines->pluck('shipment_id')->filter()->values()->all();
        $ships = TruckingShipment::whereIn('id', $ids)->get()->keyBy('id');
        $bundle = $this->tripConfigBundle();
        $sug = [];
        foreach ($ships as $s) {
            $sg = $this->tripSuggest($s, $bundle);
            $sug[$s->id] = $sg['sug'] + ['axle' => $sg['axle'], 'matched' => $sg['matched'], 'diag' => $sg['diag'], 'salaryParts' => $sg['salaryParts']];
        }
        return [
            'sug'       => $sug,
            'missing'   => array_values(array_diff($ids, $ships->keys()->all())),
            'routeFees' => $this->routeFeesOut(),
            'drivers'   => $this->driversOut(),
        ] + $this->tripItemOptions();
    }

    /** Lưu kỳ phí xe (snapshot): xóa & tạo lại dòng, tính lại tổng từng dòng + tổng kỳ. */
    public function saveTripBatch(array $data, ?TruckingTripCostBatch $b = null): TruckingTripCostBatch
    {
        return DB::transaction(function () use ($data, $b) {
            $b ??= new TruckingTripCostBatch();
            $b->fill([
                'no'          => $this->str($data['no'] ?? null) ?: ($b->no ?? $this->nextTripNo()),
                'name'        => $this->str($data['name'] ?? null),
                'date'        => $this->inDate($data['date'] ?? null),
                'period_from' => $this->inDate($data['from'] ?? null),
                'period_to'   => $this->inDate($data['to'] ?? null),
                'note'        => $this->str($data['note'] ?? null),
            ]);
            $b->save();

            $b->lines()->delete();
            // map tên lái xe → id qua cache request-scoped (cùng rule lowercase+trim với
            // shipment.driver_id / spend.driver_id → 4 cột driver_id nhất quán cho báo cáo lương).
            $driverIds = $this->driverIdMap();
            $vehIds    = $this->vehicleIdMap();   // plate lowercase+trim+collapse (same rule với shipment.vehicle_id)
            $total = 0;
            foreach (($data['rows'] ?? []) as $i => $r) {
                $c = $r['cur'] ?? $r;
                $cleanExtra = fn ($arr) => is_array($arr) ? array_values(array_map(fn ($e) => [
                    'name'   => $this->str($e['name'] ?? null),
                    'amount' => $this->inMoney($e['amount'] ?? null) ?? 0,
                    'note'   => $this->str($e['note'] ?? null),
                ], $arr)) : [];
                $extras       = $cleanExtra($c['extras'] ?? null);
                $salaryExtras = $cleanExtra($c['salaryExtras'] ?? null);

                $veTram    = $this->inMoney($c['veTram'] ?? null) ?? 0;
                $tienDuong = $this->inMoney($c['tienDuong'] ?? null) ?? 0;
                $troCap    = $this->inMoney($c['troCap'] ?? null) ?? 0;
                $phiKhac   = $this->inMoney($c['phiKhac'] ?? null) ?? 0;
                $cru       = ! empty($c['cru']);
                $luong     = $this->inMoney($c['luong'] ?? null) ?? 0;
                $liters    = $this->inNum($c['fuelLiters'] ?? null) ?? 0;
                $price     = $this->inMoney($c['fuelPrice'] ?? null) ?? 0;
                $fuelAmount = (int) round($liters * $price);
                $extrasSum  = array_sum(array_map(fn ($e) => $e['amount'], $extras));
                $salExSum   = array_sum(array_map(fn ($e) => $e['amount'], $salaryExtras));

                // Lương nhân sự dòng = các khoản đánh dấu + khoản lương khác.
                // `luong` = lương ĐÃ ÁP (CRU→luong, không CRU→luong_no_cru, do gợi ý chọn sẵn) → luôn cộng.
                // `phiKhac` GIỮ trong công thức để các kỳ CŨ không bị sai tổng (dòng mới phiKhac=0).
                $parts   = $this->cleanSalaryParts($r['salaryParts'] ?? null);
                $compVal = ['veTram' => $veTram, 'tienDuong' => $tienDuong, 'troCap' => $troCap, 'phiKhac' => $phiKhac, 'luong' => $luong];
                $salaryTotal = $salExSum;
                foreach ($parts as $k) $salaryTotal += $compVal[$k] ?? 0;

                $lineTotal = $veTram + $tienDuong + $troCap + $phiKhac + $luong + $fuelAmount + $extrasSum + $salExSum;
                $costTotal = $lineTotal - $salaryTotal;     // chi phí vận hành dòng
                $total += $lineTotal;

                $dname = $this->str($c['driver'] ?? null);
                $dkey  = $dname ? mb_strtolower(preg_replace('/\s+/u', ' ', trim((string) $dname)) ?? '') : '';
                $bks   = $this->str($r['bks'] ?? null);
                $bksKey = $bks ? mb_strtolower(preg_replace('/\s+/u', ' ', trim((string) $bks)) ?? '') : '';
                $b->lines()->create([
                    'shipment_id' => is_numeric($r['shipmentId'] ?? null) ? $r['shipmentId'] : null,
                    'booking'     => $this->str($r['booking'] ?? null),
                    'route'       => $this->str($r['route'] ?? null),
                    'kho'         => $this->str($r['kho'] ?? null),
                    'bks'         => $bks,
                    'vehicle_id'  => $bksKey !== '' ? ($vehIds[$bksKey] ?? null) : null,
                    'axle'        => $this->str($r['axle'] ?? null),
                    'date'        => $this->inDate($r['date'] ?? null),
                    'driver'      => $dname,
                    'driver_id'   => $dkey !== '' ? ($driverIds[$dkey] ?? null) : null,
                    've_tram'     => $veTram,
                    'tien_duong'  => $tienDuong,
                    'tro_cap'     => $troCap,
                    'phi_khac'    => $phiKhac,
                    'cru'         => $cru,
                    'luong'       => $luong,
                    'salary_parts' => $parts,
                    'fuel_liters' => $liters,
                    'fuel_price'  => $price,
                    'fuel_amount' => $fuelAmount,
                    'extras'      => $extras,
                    'salary_extras' => $salaryExtras,
                    'line_total'  => $lineTotal,
                    'salary_total' => $salaryTotal,
                    'cost_total'  => $costTotal,
                    'note'        => $this->str($c['note'] ?? null),
                    'sort'        => $i,
                ]);
            }
            $b->total = $total;
            $b->save();
            return $b;
        });
    }

    /** Bảng giá dầu — danh sách (mới nhất trước). */
    public function fuelPrices(): array
    {
        return TruckingFuelPrice::orderByDesc('from_date')->orderByDesc('id')->get()->map(fn ($r) => [
            'id'    => $r->id,
            'from'  => $this->outDate($r->from_date),
            'to'    => $this->outDate($r->to_date),
            'price' => $this->outMoney($r->price),
            'note'  => $r->note ?? '',
        ])->all();
    }

    /** Lưu bảng giá dầu — xóa sạch & tạo lại (bảng nhỏ, không FK). */
    public function saveFuelPrices(array $rows): void
    {
        DB::transaction(function () use ($rows) {
            TruckingFuelPrice::query()->delete();
            foreach (array_values($rows) as $i => $r) {
                $from = $this->inDate($r['from'] ?? null);
                if (! $from) continue;   // bắt buộc có "từ ngày"
                TruckingFuelPrice::create([
                    'from_date' => $from,
                    'to_date'   => $this->inDate($r['to'] ?? null),
                    'price'     => $this->inMoney($r['price'] ?? null) ?? 0,
                    'note'      => $this->str($r['note'] ?? null),
                    'sort'      => $i,
                ]);
            }
        });
    }

    /** Phí tuyến đường — danh sách đã serialize. */
    public function routeFees(): array
    {
        return TruckingRouteFee::orderBy('sort')->orderBy('id')->get()->map(fn ($r) => [
            'id'        => $r->id,
            'route'     => $r->route ?? '',
            'veTram'    => $this->outMoney($r->ve_tram),
            'tienDuong' => $this->outMoney($r->tien_duong),
            'troCap'    => $this->outMoney($r->tro_cap),
            'phiKhac'   => $this->outMoney($r->phi_khac),
            'cru'         => (bool) $r->cru,
            // Lương theo 2 chiều: (có/không kéo cont ra) × (CRU/không CRU)
            'luong'            => $this->outMoney($r->luong),               // có kéo + CRU
            'luongNoCru'       => $this->outMoney($r->luong_no_cru),        // có kéo + không CRU
            'luongNokeo'       => $this->outMoney($r->luong_nokeo),         // không kéo + CRU
            'luongNokeoNoCru'  => $this->outMoney($r->luong_nokeo_no_cru),  // không kéo + không CRU
            'salaryParts' => $this->cleanSalaryParts($r->salary_parts),
            'km'        => $this->outNum($r->km),
            'dau2'      => $this->outNum($r->dau_2cau),
            'dau1'      => $this->outNum($r->dau_1cau),
            'extraFees' => $this->cleanExtraFees($r->extra_fees),
        ])->all();
    }

    /** Các key khoản phí hợp lệ có thể tính vào lương nhân sự. */
    private const SALARY_KEYS = ['veTram', 'tienDuong', 'troCap', 'phiKhac', 'luong', 'dau1', 'dau2'];   // 'chi theo ngày' — kèm dầu 1/2 cầu

    /** Lọc danh sách khoản lương nhân sự về các key hợp lệ; null → mặc định Trợ cấp + Lương. */
    private function cleanSalaryParts($parts): array
    {
        if ($parts === null) return ['troCap', 'luong'];
        if (! is_array($parts)) return [];
        return array_values(array_intersect(self::SALARY_KEYS, array_map('strval', $parts)));
    }

    /** Chuẩn hóa danh sách "Chi khác" (repeater) cho OUTPUT: {name, amount (tiền), perDay}. */
    private function cleanExtraFees($fees): array
    {
        if (! is_array($fees)) return [];
        $out = [];
        foreach ($fees as $f) {
            if (! is_array($f)) continue;
            $name = trim((string) ($f['name'] ?? ''));
            $amount = (float) ($f['amount'] ?? 0);
            if ($name === '' && $amount <= 0) continue;
            $out[] = ['name' => $name, 'amount' => $this->outMoney($amount), 'perDay' => ! empty($f['perDay'])];
        }
        return $out;
    }

    /** Chuẩn hóa "Chi khác" cho LƯU: {name, amount (int), perDay}; bỏ dòng rỗng. */
    private function extraFeesIn($fees): array
    {
        if (! is_array($fees)) return [];
        $out = [];
        foreach ($fees as $f) {
            if (! is_array($f)) continue;
            $name = $this->str($f['name'] ?? null) ?? '';
            $amount = $this->inMoney($f['amount'] ?? null) ?? 0;
            if ($name === '' && $amount <= 0) continue;
            $out[] = ['name' => $name, 'amount' => $amount, 'perDay' => ! empty($f['perDay'])];
        }
        return $out;
    }

    /** Nhãn ↔ key cho cột "Chi theo ngày" khi xuất/nhập Excel. */
    private const SALARY_LABELS = ['veTram' => 'Vé trạm', 'tienDuong' => 'Tiền đường', 'troCap' => 'Trợ cấp', 'phiKhac' => 'Phí khác', 'luong' => 'Lương', 'dau1' => 'Dầu 1 cầu', 'dau2' => 'Dầu 2 cầu'];

    /** Header + dữ liệu phí tuyến để XUẤT Excel (điền nhanh rồi nhập lại). */
    public function routeFeeExportRows(): array
    {
        $header = ['Tuyến', 'Vé trạm', 'Tiền đường', 'Trợ cấp', 'Phí khác',
            'Lương kéo CRU', 'Lương kéo không CRU', 'Lương không kéo CRU', 'Lương không kéo không CRU',
            'Km', 'Dầu 2 cầu (lít)', 'Dầu 1 cầu (lít)', 'Chi theo ngày (cách nhau dấu phẩy)'];
        $rows = [];
        foreach (TruckingRouteFee::orderBy('sort')->orderBy('id')->get() as $r) {
            $parts = $this->cleanSalaryParts($r->salary_parts);
            $ctn = implode(', ', array_map(fn ($k) => self::SALARY_LABELS[$k] ?? $k, $parts));
            $rows[] = [
                (string) $r->route, (float) $r->ve_tram, (float) $r->tien_duong, (float) $r->tro_cap, (float) $r->phi_khac,
                (float) $r->luong, (float) $r->luong_no_cru, (float) $r->luong_nokeo, (float) $r->luong_nokeo_no_cru,
                (float) $r->km, (float) $r->dau_2cau, (float) $r->dau_1cau, $ctn,
            ];
        }
        return ['header' => $header, 'rows' => $rows];
    }

    /**
     * KIỂM TRA (dry-run) file nhập phí tuyến: phân loại từng dòng create/update/error + cảnh báo,
     * KHÔNG ghi gì. canImport=true khi 0 lỗi. Dùng chung cho popup check + import (chặn nếu có lỗi).
     */
    public function analyzeRouteFeeImport(array $rows): array
    {
        $existing = [];
        foreach (TruckingRouteFee::all() as $rf) { $k = $this->routeNodeKey($this->routeStringNodes((string) $rf->route)); if ($k !== '') $existing[$k] = true; }
        $codeMap = $this->normalizedCodeMap();
        $norm = fn ($v) => mb_strtoupper(preg_replace('/\s+/u', '', trim(\Illuminate\Support\Str::ascii((string) $v))) ?? '');
        $numCells = ['veTram', 'tienDuong', 'troCap', 'phiKhac', 'luongKeoCru', 'luongKeoKhongCru', 'luongKhongKeoCru', 'luongKhongKeoKhongCru', 'km', 'dau2', 'dau1'];

        $seen = []; $out = []; $willCreate = 0; $willUpdate = 0; $errors = 0; $warnings = 0;
        foreach ($rows as $idx => $r) {
            $line = (int) ($r['_line'] ?? ($idx + 2));
            $route = trim((string) ($r['route'] ?? ''));
            $issues = []; $action = 'error';
            if ($route === '') {
                $issues[] = ['level' => 'error', 'msg' => 'Thiếu tên tuyến'];
            } else {
                $key = $this->routeNodeKey($this->routeStringNodes($route));
                if ($key === '') {
                    $issues[] = ['level' => 'error', 'msg' => 'Tuyến không hợp lệ'];
                } elseif (isset($seen[$key])) {
                    $issues[] = ['level' => 'error', 'msg' => 'Trùng tuyến với dòng ' . $seen[$key] . ' trong file'];
                } else {
                    $seen[$key] = $line;
                    // Mỗi điểm PHẢI tồn tại trong danh mục Cảng/Kho (khớp theo ký hiệu hoặc tên) — sai = LỖI, chặn nhập.
                    $badNode = false;
                    foreach ($this->routeStringNodes($route) as $node) {
                        if (! isset($codeMap[$norm($node)])) { $issues[] = ['level' => 'error', 'msg' => "Không tồn tại địa điểm/kho \"$node\" (kiểm tra ký hiệu ở Cài đặt → Địa điểm/Kho)"]; $badNode = true; }
                    }
                    $action = $badNode ? 'error' : (isset($existing[$key]) ? 'update' : 'create');
                }
            }
            foreach ($numCells as $c) {
                $v = trim((string) ($r[$c] ?? ''));
                if ($v !== '' && preg_match('/[^\d.,\s-]/u', $v)) { $issues[] = ['level' => 'error', 'msg' => "Giá trị \"$v\" không phải số"]; $action = 'error'; }
            }
            foreach ($issues as $is) { $is['level'] === 'error' ? $errors++ : $warnings++; }
            if ($action === 'update') $willUpdate++; elseif ($action === 'create') $willCreate++;
            $out[] = ['line' => $line, 'route' => $route, 'action' => $action, 'issues' => $issues];
        }
        return [
            'rows' => $out,
            'summary' => ['total' => count($out), 'willCreate' => $willCreate, 'willUpdate' => $willUpdate, 'errors' => $errors, 'warnings' => $warnings],
            'canImport' => $errors === 0 && count($out) > 0,
        ];
    }

    /**
     * NHẬP phí tuyến từ Excel — UPSERT theo TUYẾN (tập node Cảng+Kho): trùng tuyến → cập nhật,
     * chưa có → tạo mới. KHÔNG xóa tuyến vắng mặt (an toàn, nhập từng phần được). Giữ "Chi khác".
     * $rows: mảng assoc theo cột {route, veTram, tienDuong, troCap, phiKhac, luongKeoCru,
     * luongKeoKhongCru, luongKhongKeoCru, luongKhongKeoKhongCru, km, dau2, dau1, chiTheoNgay}.
     */
    public function importRouteFees(array $rows): array
    {
        // CHẶN nếu file còn lỗi — không ghi gì cả (validate lại ở server cho chắc).
        $analysis = $this->analyzeRouteFeeImport($rows);
        if (! $analysis['canImport']) {
            return ['ok' => false, 'message' => 'File còn lỗi — chưa nhập gì. Sửa rồi tải lại.'] + $analysis;
        }
        // map nhãn/key "chi theo ngày" → key chuẩn
        $labelToKey = [];
        foreach (self::SALARY_LABELS as $k => $label) { $labelToKey[$this->normKey($label)] = $k; $labelToKey[$this->normKey($k)] = $k; }
        $parseParts = function ($cell) use ($labelToKey) {
            $out = [];
            foreach (preg_split('/\s*[,;]\s*/u', trim((string) $cell)) ?: [] as $tok) {
                if ($tok === '') continue;
                $k = $labelToKey[$this->normKey($tok)] ?? null;
                if ($k && ! in_array($k, $out, true)) $out[] = $k;
            }
            return $out;
        };

        // index tuyến hiện có theo TẬP node
        $byKey = [];
        foreach (TruckingRouteFee::all() as $rf) { $k = $this->routeNodeKey($this->routeStringNodes((string) $rf->route)); if ($k !== '') $byKey[$k] = $rf; }
        $maxSort = (int) (TruckingRouteFee::max('sort') ?? -1);

        $created = 0; $updated = 0; $skipped = 0;
        DB::transaction(function () use ($rows, $parseParts, &$byKey, &$maxSort, &$created, &$updated, &$skipped) {
            foreach ($rows as $r) {
                $route = trim((string) ($r['route'] ?? ''));
                $key = $route === '' ? '' : $this->routeNodeKey($this->routeStringNodes($route));
                if ($key === '') { $skipped++; continue; }
                $attrs = [
                    'route'        => $route,
                    'route_key'    => $this->routeKey($route),
                    've_tram'      => $this->inMoney($r['veTram'] ?? null) ?? 0,
                    'tien_duong'   => $this->inMoney($r['tienDuong'] ?? null) ?? 0,
                    'tro_cap'      => $this->inMoney($r['troCap'] ?? null) ?? 0,
                    'phi_khac'     => $this->inMoney($r['phiKhac'] ?? null) ?? 0,
                    'luong'        => $this->inMoney($r['luongKeoCru'] ?? null) ?? 0,
                    'luong_no_cru' => $this->inMoney($r['luongKeoKhongCru'] ?? null) ?? 0,
                    'luong_nokeo'  => $this->inMoney($r['luongKhongKeoCru'] ?? null) ?? 0,
                    'luong_nokeo_no_cru' => $this->inMoney($r['luongKhongKeoKhongCru'] ?? null) ?? 0,
                    'km'           => $this->inNum($r['km'] ?? null) ?? 0,
                    'dau_2cau'     => $this->inNum($r['dau2'] ?? null) ?? 0,
                    'dau_1cau'     => $this->inNum($r['dau1'] ?? null) ?? 0,
                    'salary_parts' => $parseParts($r['chiTheoNgay'] ?? ''),
                ];
                if (isset($byKey[$key])) {                       // trùng tuyến → cập nhật (giữ extra_fees)
                    $byKey[$key]->update($attrs);
                    $updated++;
                } else {                                          // tuyến mới
                    $attrs['extra_fees'] = [];
                    $attrs['sort'] = ++$maxSort;
                    $byKey[$key] = TruckingRouteFee::create($attrs);
                    $created++;
                }
            }
        });
        return ['ok' => true, 'created' => $created, 'updated' => $updated, 'skipped' => $skipped] + $analysis;
    }

    /** Resolve tên lái xe → driver_id (dùng driverIdMap đã memoize). */
    private function resolveDriverId($name): ?int
    {
        $name = $this->str($name ?? null);
        if (! $name) return null;
        $key = mb_strtolower(preg_replace('/\s+/u', ' ', trim($name)) ?? '');
        return $key !== '' ? ($this->driverIdMap()[$key] ?? null) : null;
    }

    /** Chuẩn hóa khóa so khớp nhãn (bỏ dấu cách + viết thường). */
    private function normKey(string $v): string
    {
        return mb_strtolower(preg_replace('/\s+/u', '', trim($v)) ?? '');
    }

    /** Lưu phí tuyến đường — xóa sạch & tạo lại (không có FK liên kết). */
    public function saveRouteFees(array $rows): void
    {
        DB::transaction(function () use ($rows) {
            TruckingRouteFee::query()->delete();
            foreach (array_values($rows) as $i => $r) {
                TruckingRouteFee::create([
                    'route'      => $this->str($r['route'] ?? null),
                    'route_key'  => $this->routeKey((string) ($r['route'] ?? '')),
                    've_tram'    => $this->inMoney($r['veTram'] ?? null) ?? 0,
                    'tien_duong' => $this->inMoney($r['tienDuong'] ?? null) ?? 0,
                    'tro_cap'    => $this->inMoney($r['troCap'] ?? null) ?? 0,
                    'phi_khac'   => $this->inMoney($r['phiKhac'] ?? null) ?? 0,
                    'cru'        => ! empty($r['cru']),
                    'luong'      => $this->inMoney($r['luong'] ?? null) ?? 0,
                    'luong_no_cru' => $this->inMoney($r['luongNoCru'] ?? null) ?? 0,
                    'luong_nokeo'  => $this->inMoney($r['luongNokeo'] ?? null) ?? 0,
                    'luong_nokeo_no_cru' => $this->inMoney($r['luongNokeoNoCru'] ?? null) ?? 0,
                    'salary_parts' => $this->cleanSalaryParts($r['salaryParts'] ?? null),
                    'km'         => $this->inNum($r['km'] ?? null) ?? 0,
                    'dau_2cau'   => $this->inNum($r['dau2'] ?? null) ?? 0,
                    'dau_1cau'   => $this->inNum($r['dau1'] ?? null) ?? 0,
                    'extra_fees' => $this->extraFeesIn($r['extraFees'] ?? null),
                    'sort'       => $i,
                ]);
            }
        });
    }

    // ===================================================================
    // KỲ LƯƠNG LÁI XE (snapshot theo biển số xe)
    // ===================================================================

    /** Danh sách kỳ lương đã lưu (tóm tắt). */
    public function payrollList(): array
    {
        return TruckingPayrollPeriod::orderByDesc('id')->get()->map(fn ($p) => [
            'id'    => $p->id,
            'hashid' => $p->hashid(),
            'no'    => $p->no,
            'name'  => $p->name ?? '',
            'from'  => $this->outDate($p->period_from),
            'to'    => $this->outDate($p->period_to),
            'total'     => (int) round((float) $p->total),
            'paidDaily' => (int) round((float) $p->paid_daily),
            'count' => is_array($p->lines) ? count($p->lines) : 0,
        ])->all();
    }

    /** Snapshot 1 kỳ lương (cho trang Xem). */
    public function payrollToArray(TruckingPayrollPeriod $p): array
    {
        return [
            'id'    => $p->id,
            'hashid' => $p->hashid(),
            'no'    => $p->no,
            'name'  => $p->name ?? '',
            'from'  => $this->outDate($p->period_from),
            'to'    => $this->outDate($p->period_to),
            'total'     => (int) round((float) $p->total),
            'paidDaily' => (int) round((float) $p->paid_daily),
            'locked'    => (bool) $p->locked,
            'lockedAt'  => $p->locked_at ? $p->locked_at->format('d/m/Y H:i') : '',
            'note'  => $p->note ?? '',
            'rows'  => is_array($p->lines) ? $p->lines : [],
        ];
    }

    /** Tính lại kỳ lương từ cấu hình hiện tại (theo khoảng ngày của kỳ) — trả rows mới để FE gộp. */
    public function recomputePayroll(TruckingPayrollPeriod $p): array
    {
        $from = $p->period_from ? $p->period_from->format('Y-m-d') : null;
        $to   = $p->period_to ? $p->period_to->format('Y-m-d') : null;
        return $this->computePayroll($from, $to);
    }

    private function nextPayrollNo(): string
    {
        return 'LG-' . str_pad((string) (TruckingPayrollPeriod::max('id') + 1), 4, '0', STR_PAD_LEFT);
    }

    /** Chuẩn hóa các đợt thanh toán lương: {date, amount, note}; bỏ dòng rỗng. */
    private function paymentsIn($payments): array
    {
        if (! is_array($payments)) return [];
        $out = [];
        foreach ($payments as $p) {
            if (! is_array($p)) continue;
            $amount = $this->inMoney($p['amount'] ?? null) ?? 0;
            $date   = $this->inDate($p['date'] ?? null);
            if ($amount <= 0 && ! $date) continue;
            $out[] = ['date' => $date, 'amount' => $amount, 'note' => $this->str($p['note'] ?? null) ?? ''];
        }
        return $out;
    }

    /** Lưu/cập nhật 1 kỳ lương — chốt snapshot theo bks (tiền tính lúc tạo). */
    public function savePayroll(array $data, ?TruckingPayrollPeriod $p = null): TruckingPayrollPeriod
    {
        $lines = []; $total = 0; $paidDaily = 0;
        foreach (array_values($data['rows'] ?? []) as $r) {
            $bks = $this->str($r['bks'] ?? null) ?? '';
            if ($bks === '') continue;
            $base     = (int) round((float) ($r['payroll'] ?? $r['total'] ?? 0));   // lương gốc (từ phí tuyến)
            $extraPay = $this->extraPayIn($r['extraPay'] ?? null);                  // lương phát sinh thêm tay
            $eff      = $base + array_sum(array_column($extraPay, 'amount'));        // lương phải trả = gốc + phát sinh
            $pd       = (int) round((float) ($r['paidDaily'] ?? 0));
            $lines[] = [
                'bks'       => $bks,
                'vehicleId' => is_numeric($r['vehicleId'] ?? null) ? (int) $r['vehicleId'] : null,
                'driver'    => $this->str($r['driver'] ?? null) ?? '',
                'driverId'  => is_numeric($r['driverId'] ?? null) ? (int) $r['driverId'] : $this->resolveDriverId($r['driver'] ?? null),
                'days'      => (int) ($r['days'] ?? 0),
                'trips'     => (int) ($r['trips'] ?? 0),
                'paidDaily' => $pd,
                'payroll'   => $base,
                'extraPay'  => $extraPay,
                'total'     => $eff,
                'note'      => $this->str($r['note'] ?? null) ?? '',
                'detail'    => is_array($r['detail'] ?? null) ? $r['detail'] : (is_array($r['lines'] ?? null) ? $r['lines'] : []),
                'payments'  => $this->paymentsIn($r['payments'] ?? null),   // các đợt thanh toán (trả chậm/chia đợt)
            ];
            $total += $eff; $paidDaily += $pd;
        }
        $locked = ! empty($data['locked']);
        $attrs = [
            'no'          => $this->str($data['no'] ?? null) ?: $this->nextPayrollNo(),
            'name'        => $this->str($data['name'] ?? null),
            'period_from' => $this->inDate($data['from'] ?? null),
            'period_to'   => $this->inDate($data['to'] ?? null),
            'total'       => $total,
            'paid_daily'  => $paidDaily,
            'locked'      => $locked,
            'locked_at'   => $locked ? ($p && $p->locked_at ? $p->locked_at : now()) : null,
            'lines'       => $lines,
            'note'        => $this->str($data['note'] ?? null),
        ];
        if ($p) { $p->update($attrs); return $p->fresh(); }
        $attrs['created_by'] = auth()->id();
        return TruckingPayrollPeriod::create($attrs);
    }

    // ===================================================================
    // BÁO CÁO CHI PHÍ THÁNG (P&L + cơ cấu chi phí + theo xe) — chỉ ĐỌC
    // ===================================================================

    /**
     * DOANH THU của 1 lô cho báo cáo = giá theo BẢNG GIÁ (cước + dầu + sà lan) — CÙNG công thức với cột
     * "Thu phí" ở Lô hàng và bảng kê (1 nguồn công thức). Lô KHÔNG khớp bảng giá → dùng doanh thu NHẬP TAY
     * (revenue_lines kind=doanhThu) nếu có; không có nữa → 0 và tính là "chưa khớp". KHÔNG cộng cả 2 để tránh trùng.
     * (Bảng revenue_lines thực tế gần như không ai nhập → trước đây P&L luôn báo doanh thu 0.)
     * $s cần eager-load costLines + revenueLines + customer. $date = ngày cont ra (Y-m-d).
     *
     * @return array{amount:int, source:string} source = price | manual | none
     */
    private function reportShipmentRevenue(TruckingShipment $s, string $date): array
    {
        $pr = $this->priceShipment($s, $this->pricingContextForDate($s->customer_id ? (int) $s->customer_id : null, $s->customer?->name, $date));
        if ($pr['matched']) {
            $amt = (int) $pr['cuoc'] + (int) $pr['dau'] + (int) ($pr['bargeCuoc'] ?? 0) + (int) ($pr['bargeDau'] ?? 0);
            return ['amount' => $amt, 'source' => 'price'];
        }
        $manual = (int) round((float) $s->revenueLines->where('kind', 'doanhThu')->sum('amount'));
        return ['amount' => $manual, 'source' => $manual ? 'manual' : 'none'];
    }

    /** Nhãn 4 NHÓM chi phí lớn của báo cáo (sếp nhìn nhóm trước, khoản chi tiết sau). */
    private const COST_GROUPS = ['driver' => 'Lương & vận hành lái xe', 'vehicle' => 'Chi phí xe', 'asset' => 'Chi phí tài sản', 'shipment' => 'Chi phí lô hàng'];

    /**
     * Báo cáo chi phí công ty theo THÁNG: Doanh thu − Chi phí = Lợi nhuận, cơ cấu chi phí theo
     * loại (gom 4 nhóm lớn → khoản), chi phí theo xe (+ chi phí/chuyến), doanh thu theo khách.
     * Gộp 4 nguồn (không trùng nhau theo thiết kế):
     *  1) Doanh thu = lô có Giờ xe ra trong tháng, định giá theo bảng giá (xem reportShipmentRevenue).
     *  2) Lương & vận hành lái xe = route-pay (dầu/lương/cầu đường/trợ cấp/phát sinh) — loop ngày.
     *  3) Chi phí xe / tài sản = vehicle_costs theo spend_date (bỏ phiếu đã hủy).
     *  4) Chi phí lô hàng = cost_lines KHÔNG phải chi hộ (billable=false), số NET.
     */
    public function monthlyCostReport(int $year, int $month): array
    {
        $start = Carbon::create($year, $month, 1)->startOfDay();
        $end   = $start->copy()->endOfMonth();
        $s = $start->format('Y-m-d'); $e = $end->format('Y-m-d');

        // 1) Lô có Giờ xe ra trong tháng → doanh thu (bảng giá) + sản lượng + khách hàng
        $ships = TruckingShipment::whereNotNull('gio_xe_ra')
            ->whereDate('gio_xe_ra', '>=', $s)->whereDate('gio_xe_ra', '<=', $e)
            ->with(['costLines', 'revenueLines', 'customer:id,name', 'raOther:id,gio_xe_ra'])
            ->get();
        $shipIds = $ships->pluck('id');
        $revenue = 0; $revManual = 0; $unmatched = 0;
        $revByShip = []; $srcByShip = [];
        foreach ($ships as $sh) {
            $r = $this->reportShipmentRevenue($sh, substr($this->outDate($sh->gio_xe_ra), 0, 10));
            $revByShip[$sh->id] = $r['amount']; $srcByShip[$sh->id] = $r['source'];
            $revenue += $r['amount'];
            if ($r['source'] === 'manual') $revManual += $r['amount'];
            if ($r['source'] === 'none') $unmatched++;
        }

        $cat = []; $catGroup = [];   // label => amount (cơ cấu chi phí) ; label => nhóm lớn
        $byPlate = [];               // bks => ['cost'=>, 'trips'=>]
        $addCat = function ($label, $amt, string $group) use (&$cat, &$catGroup) { $amt = (int) round((float) $amt); if ($amt) { $cat[$label] = ($cat[$label] ?? 0) + $amt; $catGroup[$label] = $group; } };
        $addPlate = function ($bks, $amt) use (&$byPlate) { $bks = $bks ?: '—'; $byPlate[$bks] ??= ['cost' => 0, 'trips' => 0]; $byPlate[$bks]['cost'] += (int) round((float) $amt); };

        // 2) Lương & vận hành lái xe (route-pay) — loop từng ngày trong tháng
        $catMap = ['veTram' => 'Cầu đường, vé trạm', 'tienDuong' => 'Cầu đường, vé trạm', 'troCap' => 'Trợ cấp',
                   'luong' => 'Lương lái xe', 'dau1' => 'Dầu', 'dau2' => 'Dầu', 'extra' => 'Phụ phí tuyến'];
        $totalTrips = 0;
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            $day = $this->routeTripByDate($d->format('Y-m-d'));
            foreach ($day['trucks'] as $t) {
                $bks = $t['bks'];
                foreach ($t['payGroups'] as $g) {
                    $totalTrips++; $byPlate[$bks] ??= ['cost' => 0, 'trips' => 0]; $byPlate[$bks]['trips']++;
                    foreach (array_merge($g['items'] ?? [], $g['payrollItems'] ?? []) as $it) {
                        $label = $catMap[$it['key'] ?? ''] ?? 'Phát sinh chuyến';
                        $addCat($label, $it['amount'] ?? 0, 'driver'); $addPlate($bks, $it['amount'] ?? 0);
                    }
                    foreach ($g['manual'] ?? [] as $m) { $addCat('Phát sinh chuyến', $m['amount'] ?? 0, 'driver'); $addPlate($bks, $m['amount'] ?? 0); }
                    // Dầu = chi phí CÔNG TY (tách khỏi tiền lái nhưng VẪN là chi phí của xe).
                    if (! empty($g['fuel'])) { $addCat('Dầu', $g['fuel']['amount'] ?? 0, 'driver'); $addPlate($bks, $g['fuel']['amount'] ?? 0); }
                }
            }
        }

        // 3) Chi phí xe / tài sản (vehicle_costs) theo spend_date, BỎ phiếu đã hủy — NHÓM THEO THAM CHIẾU
        //    loại chi phí (cost_type_id) phân giải theo ĐÚNG NGUỒN (xe → "Loại chi phí xe";
        //    tài sản → "Loại chi phí tài sản"); fallback tên chuỗi khi chưa gắn danh mục.
        $vehTypeName   = \App\Models\TruckingVehicleCostType::pluck('name', 'id');
        $assetTypeName = \App\Models\TruckingAssetCostType::pluck('name', 'id');
        foreach (TruckingVehicleCost::with('vehicle:id,plate,kind')->whereNull('cancelled_at')->whereNotNull('spend_date')
            ->whereDate('spend_date', '>=', $s)->whereDate('spend_date', '<=', $e)->get() as $vc) {
            $isAsset = (($vc->vehicle?->kind) ?? 'vehicle') === 'asset';
            $type = $vc->cost_type_id
                ? ($isAsset ? ($assetTypeName[$vc->cost_type_id] ?? null) : ($vehTypeName[$vc->cost_type_id] ?? null))
                : null;
            $type  = $type ?: (trim((string) $vc->name) ?: null);
            $label = ($isAsset ? 'Chi phí tài sản' : 'Chi phí xe') . ($type !== null ? ' · ' . $type : '');
            $addCat($label, $vc->amount, $isAsset ? 'asset' : 'vehicle'); $addPlate($vc->vehicle?->plate ?? '—', $vc->amount);
        }

        // 4) Chi phí lô hàng (cost_lines, KHÔNG tính chi hộ khách) — dùng số NET (đã trừ VAT).
        foreach (TruckingCostLine::whereIn('shipment_id', $shipIds)
            ->where(fn ($q) => $q->where('billable', false)->orWhereNull('billable'))->get(['item', 'amount', 'vat']) as $cl) {
            $addCat('Chi phí lô · ' . (trim((string) $cl->item) ?: 'khác'), $cl->netAmount(), 'shipment');
        }

        // Doanh thu theo XE + KHÁCH + sản lượng theo TUYẾN/KHO (từ lô trong tháng)
        $vehPlate = TruckingVehicle::whereIn('id', $ships->pluck('vehicle_id')->filter()->unique())->pluck('plate', 'id');
        $byRoute = []; $byKho = []; $byCust = [];
        foreach ($ships as $sh) {
            $plate = trim((string) ($sh->vehicle_id ? ($vehPlate[$sh->vehicle_id] ?? $sh->bks_vao) : $sh->bks_vao)) ?: '—';
            $byPlate[$plate] ??= ['cost' => 0, 'trips' => 0];
            if ($sh->vehicle_id && ! isset($byPlate[$plate]['vehicleId'])) $byPlate[$plate]['vehicleId'] = (int) $sh->vehicle_id;
            $byPlate[$plate]['revenue'] = ($byPlate[$plate]['revenue'] ?? 0) + (int) ($revByShip[$sh->id] ?? 0);
            $byPlate[$plate]['conts'] = ($byPlate[$plate]['conts'] ?? 0) + 1;
            $rk = trim(($sh->from_loc ?? '') . ' → ' . ($sh->to_loc ?? ''), ' →') ?: '(chưa rõ)';
            $byRoute[$rk] = ($byRoute[$rk] ?? 0) + 1;
            foreach ($this->khoPoints($sh->kho) ?: ['(không kho)'] as $kp) { $byKho[$kp] = ($byKho[$kp] ?? 0) + 1; }
            $cn = trim((string) ($sh->customer?->name ?? '')) ?: '(chưa có khách)';
            $byCust[$cn] ??= ['label' => $cn, 'customerId' => $sh->customer_id ? (int) $sh->customer_id : null, 'revenue' => 0, 'conts' => 0, 'unmatched' => 0];
            $byCust[$cn]['revenue'] += (int) ($revByShip[$sh->id] ?? 0);
            $byCust[$cn]['conts']++;
            if (($srcByShip[$sh->id] ?? 'none') === 'none') $byCust[$cn]['unmatched']++;
        }

        $totalCost = array_sum($cat);
        arsort($cat);
        $costByCategory = [];
        foreach ($cat as $label => $amt) {
            $costByCategory[] = ['label' => $label, 'amount' => $amt, 'pct' => $totalCost ? round($amt * 100 / $totalCost, 1) : 0, 'group' => $catGroup[$label] ?? 'driver'];
        }
        // 4 nhóm lớn → khoản (bỏ tiền tố "Chi phí xe · " cho gọn vì đã ở trong nhóm)
        $grouped = [];
        foreach ($cat as $label => $amt) {
            $g = $catGroup[$label] ?? 'driver';
            $grouped[$g] ??= ['key' => $g, 'label' => self::COST_GROUPS[$g], 'amount' => 0, 'items' => []];
            $grouped[$g]['amount'] += $amt;
            $grouped[$g]['items'][] = ['label' => preg_replace('/^Chi phí (xe|tài sản|lô) · /u', '', $label), 'amount' => $amt];
        }
        $costGroups = array_map(function ($g) use ($totalCost) {
            usort($g['items'], fn ($a, $b) => $b['amount'] <=> $a['amount']);
            $g['items'] = array_map(fn ($it) => $it + ['pct' => $g['amount'] ? round($it['amount'] * 100 / $g['amount'], 1) : 0], $g['items']);
            $g['pct'] = $totalCost ? round($g['amount'] * 100 / $totalCost, 1) : 0;
            return $g;
        }, array_values($grouped));
        usort($costGroups, fn ($a, $b) => $b['amount'] <=> $a['amount']);

        // Đội xe: doanh thu − chi phí = lợi nhuận mỗi xe + tỷ lệ chi phí/doanh thu. hashid để deep-link hồ sơ
        // (BKS từ route-pay không có vehicle_id → tra theo biển số như shipment.vehicle_id).
        $vehIds = $this->vehicleIdMap();
        $fleet = [];
        foreach ($byPlate as $bks => $v) {
            $rev = (int) ($v['revenue'] ?? 0); $cost = (int) $v['cost'];
            $vid = $v['vehicleId'] ?? ($vehIds[mb_strtolower(preg_replace('/\s+/u', ' ', trim((string) $bks)) ?? '')] ?? null);
            $fleet[] = ['bks' => $bks, 'vehicleId' => $vid, 'hashid' => $vid ? \App\Support\Hashid::encode((int) $vid) : null,
                'revenue' => $rev, 'cost' => $cost, 'profit' => $rev - $cost,
                'trips' => $v['trips'], 'conts' => (int) ($v['conts'] ?? 0),
                'perTrip' => $v['trips'] ? (int) round($cost / $v['trips']) : 0,
                'costRatio' => $rev ? round($cost * 100 / $rev, 1) : 0,
                'margin' => $rev ? round(($rev - $cost) * 100 / $rev, 1) : null];
        }
        usort($fleet, fn ($a, $b) => $b['cost'] <=> $a['cost']);
        $mkTop = function ($arr) { arsort($arr); $o = []; foreach ($arr as $k => $c) $o[] = ['label' => $k, 'count' => $c]; return $o; };
        $byCustomer = array_values($byCust);
        usort($byCustomer, fn ($a, $b) => $b['revenue'] <=> $a['revenue'] ?: $b['conts'] <=> $a['conts']);
        $byCustomer = array_map(fn ($c) => $c + ['perCont' => $c['conts'] ? (int) round($c['revenue'] / $c['conts']) : 0], $byCustomer);

        $profit = $revenue - $totalCost;
        return [
            'year' => $year, 'month' => $month, 'monthLabel' => sprintf('%02d/%d', $month, $year),
            'revenue' => $revenue, 'totalCost' => $totalCost, 'profit' => $profit,
            'margin' => $revenue ? round($profit * 100 / $revenue, 1) : 0,
            'revenueManual' => $revManual,      // phần doanh thu lấy từ nhập tay (lô không khớp bảng giá)
            'unmatched' => $unmatched,          // lô đã ra nhưng KHÔNG có doanh thu (chưa khớp bảng giá, chưa nhập tay)
            'trips' => $totalTrips, 'conts' => $shipIds->count(), 'vehicles' => count($byPlate),
            'costByCategory' => $costByCategory,
            'costGroups' => $costGroups,
            'costByVehicle' => $fleet,            // (giữ tên cũ cho biểu đồ bar) — nay kèm doanh thu/lợi nhuận
            'fleet' => $fleet,
            'byCustomer' => $byCustomer,
            'byRoute' => $mkTop($byRoute),
            'byKho'   => $mkTop($byKho),
        ];
    }

    /**
     * Xu hướng 12 THÁNG (kết tại year/month): Doanh thu / Chi phí / Lợi nhuận / số cont mỗi tháng.
     * Doanh thu định giá theo bảng giá từng lô (như báo cáo tháng); chi phí lô (NET) / xe gom bằng SQL;
     * chi phí lái xe (route-pay) cộng theo ngày.
     */
    public function costTrend(int $year, int $month): array
    {
        $endM = Carbon::create($year, $month, 1)->startOfMonth();
        $startM = $endM->copy()->subMonths(11);
        $rangeStart = $startM->copy()->startOfMonth(); $rangeEnd = $endM->copy()->endOfMonth();
        $sd = $rangeStart->format('Y-m-d'); $ed = $rangeEnd->format('Y-m-d');

        $keys = []; $rev = []; $cost = []; $conts = [];
        for ($d = $startM->copy(); $d->lte($endM); $d->addMonth()) { $k = $d->format('Y-m'); $keys[] = $k; $rev[$k] = 0; $cost[$k] = 0; $conts[$k] = 0; }

        // Doanh thu theo tháng Giờ xe ra — định giá theo BẢNG GIÁ từng lô (fallback nhập tay), như báo cáo tháng
        foreach (TruckingShipment::whereNotNull('gio_xe_ra')->whereDate('gio_xe_ra', '>=', $sd)->whereDate('gio_xe_ra', '<=', $ed)
            ->with(['costLines', 'revenueLines', 'customer:id,name', 'raOther:id,gio_xe_ra'])->get() as $sh) {
            $date = substr($this->outDate($sh->gio_xe_ra), 0, 10);
            $ym = substr($date, 0, 7);
            if (! isset($rev[$ym])) continue;
            $rev[$ym] += $this->reportShipmentRevenue($sh, $date)['amount'];
            $conts[$ym]++;
        }

        // Chi phí lô (cost_lines non-billable, số NET đã trừ VAT) theo tháng Giờ xe ra
        foreach (TruckingCostLine::join('trucking_shipments', 'trucking_shipments.id', '=', 'trucking_cost_lines.shipment_id')
            ->where(fn ($q) => $q->where('trucking_cost_lines.billable', false)->orWhereNull('trucking_cost_lines.billable'))
            ->whereNotNull('gio_xe_ra')->whereDate('gio_xe_ra', '>=', $sd)->whereDate('gio_xe_ra', '<=', $ed)
            ->selectRaw("DATE_FORMAT(gio_xe_ra,'%Y-%m') ym, SUM(ROUND(trucking_cost_lines.amount / (1 + COALESCE(trucking_cost_lines.vat,0)/100))) amt")
            ->groupBy('ym')->get() as $r) { if (isset($cost[$r->ym])) $cost[$r->ym] += (float) $r->amt; }

        // Chi phí xe theo spend_date (bỏ phiếu đã hủy)
        foreach (TruckingVehicleCost::whereNull('cancelled_at')->whereNotNull('spend_date')->whereDate('spend_date', '>=', $sd)->whereDate('spend_date', '<=', $ed)
            ->selectRaw("DATE_FORMAT(spend_date,'%Y-%m') ym, SUM(amount) amt")->groupBy('ym')->get() as $r) {
            if (isset($cost[$r->ym])) $cost[$r->ym] += (float) $r->amt;
        }

        // Chi phí lái xe (route-pay) — cộng theo ngày trong khoảng
        for ($d = $rangeStart->copy(); $d->lte($rangeEnd); $d->addDay()) {
            $ym = $d->format('Y-m'); if (! isset($cost[$ym])) continue;
            $day = $this->routeTripByDate($d->format('Y-m-d'));
            foreach ($day['trucks'] as $t) $cost[$ym] += (int) $t['payTotal'] + (int) $t['payrollTotal'] + (int) ($t['fuelTotal'] ?? 0);
        }

        $rows = [];
        foreach ($keys as $k) {
            [$y, $m] = explode('-', $k);
            $r = (int) round($rev[$k]); $c = (int) round($cost[$k]);
            $rows[] = ['ym' => $k, 'label' => $m . '/' . substr($y, 2),
                'revenue' => $r, 'cost' => $c, 'profit' => $r - $c, 'conts' => $conts[$k],
                'margin' => $r ? round(($r - $c) * 100 / $r, 1) : null];
        }
        return ['rows' => $rows];
    }

    /** Chuẩn hóa "lương phát sinh" thêm tay: {name, amount}; bỏ dòng rỗng. */
    private function extraPayIn($items): array
    {
        if (! is_array($items)) return [];
        $out = [];
        foreach ($items as $it) {
            if (! is_array($it)) continue;
            $name = $this->str($it['name'] ?? null) ?? '';
            $amount = $this->inMoney($it['amount'] ?? null) ?? 0;
            if ($name === '' && $amount <= 0) continue;
            $out[] = ['name' => $name, 'amount' => $amount];
        }
        return $out;
    }

}
