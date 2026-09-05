<?php

namespace App\Services\Trucking\Concerns;

use App\Models\TruckingContType;
use App\Models\TruckingCostItem;
use App\Models\TruckingCostLine;
use App\Models\TruckingChohoItem;
use App\Models\TruckingCustomer;
use App\Models\TruckingDriver;
use App\Models\TruckingExtVendor;
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

/** Tách từ TruckingV2Service — nhóm HandlesShipments. */
trait HandlesShipments
{
    /** @var array<string,int>|null  lowercase(code|name) => warehouse_id — memoize / request. */
    private ?array $whIdMapCache = null;

    /** @var array<string,int>|null  lowercase(name) => driver_id — memoize / request. */
    private ?array $driverIdMapCache = null;

    /** @var array<string,int>|null  lowercase(plate) => vehicle_id — memoize / request. */
    private ?array $vehicleIdMapCache = null;

    /** @var array<string,int>|null  lowercase(name) => customer_id — memoize / request. */
    private ?array $customerIdMapCache = null;

    /**
     * Mỗi danh mục = 1 bảng riêng. Map: cfgKey => [modelClass, priced?, coded?, colored?].
     * priced  = có đơn giá mặc định;
     * coded   = false HOẶC tên khóa map ký hiệu trong cfg (vd 'locationCode', 'warehouseCode');
     * colored = có màu "theo dõi" cấp danh mục (dùng cho filter lọc khoản chưa điền tiền).
     */
    private function lookups(): array
    {
        return [
            'locations'  => [TruckingLocation::class,    false, 'locationCode',  false],
            'payers'     => [TruckingPayer::class,       false, false,           false],
            'contTypes'  => [TruckingContType::class,    false, false,           false],
            'warehouses' => [TruckingWarehouse::class,   false, 'warehouseCode', false],
            'drivers'    => [TruckingDriver::class,      false, false,           false],
            'costItems'  => [TruckingCostItem::class,    true,  false,           true],
            'choHoItems' => [TruckingChohoItem::class,   true,  false,           false],
            'revItems'   => [TruckingRevenueItem::class, true,  false,           false],
            'salaryItems' => [TruckingSalaryItem::class, false, false,           false],
            'vehicleCostTypes' => [TruckingVehicleCostType::class, false, false,  false],
            'assetCategories'  => [TruckingAssetCategory::class,   false, false,  false],
            'assetCostTypes'   => [\App\Models\TruckingAssetCostType::class, false, false, false],
            'payMethods'       => [\App\Models\TruckingPayMethod::class, false, false, false],
            'extVendors'  => [TruckingExtVendor::class,  false, false,           false],
        ];
    }

    // ===================================================================
    // BOOTSTRAP — tải toàn bộ dữ liệu cho 1 lần khởi tạo app
    // ===================================================================
    public function bootstrap(): array
    {
        return [
            'hph' => $this->shipments(TruckingShipment::SHEET_HPH),
            'icd' => $this->shipments(TruckingShipment::SHEET_ICD),
            'cfg' => $this->config(),
            'ke'  => $this->statements(),
        ];
    }

    /** @return array<int,array> Danh sách lô của 1 sheet, đã serialize. */
    public function shipments(string $sheet): array
    {
        return TruckingShipment::ofSheet($sheet)
            ->with(['customer', 'costLines', 'revenueLines', 'payments', 'raOther:id,gio_xe_ra'])
            ->orderBy('id')
            ->get()
            ->map(fn ($s) => $this->shipmentToArray($s))
            ->all();
    }

    /**
     * Trang Lô hàng — phân trang SERVER-SIDE (20 lô/trang) + tìm kiếm + lọc + sắp xếp.
     * Aggregate (tổng chi phí, đếm bộ lọc, follow theo màu) tính TOÀN CỤC trên tập đã
     * tìm (q), độc lập với lựa chọn lọc/follow đang chọn — để con số luôn đúng dù chỉ
     * hiển thị 1 trang. $p: page,q,filter(all|out|notout),follow(all|any|missing|#hex),
     * sort(default|customer|cost),dir(1|-1),all(xuất Excel = bỏ phân trang).
     *
     * @return array{data:array,page:int,perPage:int,total:int,lastPage:int,totalCost:int,filterCounts:array,followStats:array}
     */
    public function pagedShipments(string $sheet, array $p): array
    {
        // Số lô / trang: cho người dùng chọn (whitelist chống lạm dụng), mặc định 20.
        $pp = (int) ($p['perPage'] ?? 20);
        $perPage = in_array($pp, [20, 50, 100, 200], true) ? $pp : 20;
        $page    = max(1, (int) ($p['page'] ?? 1));
        $q       = trim((string) ($p['q'] ?? ''));
        $filter  = (string) ($p['filter'] ?? 'all');
        $filter  = in_array($filter, ['all', 'out', 'notout'], true) ? $filter : 'all';
        $follow  = (string) ($p['follow'] ?? 'all');
        $sortKey = (string) ($p['sort'] ?? 'default');
        $sortKey = in_array($sortKey, ['default', 'customer', 'cost'], true) ? $sortKey : 'default';
        $dir     = ((int) ($p['dir'] ?? 1)) < 0 ? 'desc' : 'asc';
        $all     = ! empty($p['all']);
        // Lọc theo NƠI HẠ theo KÝ HIỆU (vd HPP) — CHỌN NHIỀU = OR. Map to_loc → ký hiệu để gom option + lọc.
        $toLocSel = array_values(array_filter(array_map(fn ($x) => trim((string) $x), (array) ($p['toLoc'] ?? [])), fn ($x) => $x !== ''));
        $codeMap = $this->normalizedCodeMap();
        $normLoc = fn ($v) => mb_strtoupper(preg_replace('/\s+/u', '', trim(\Illuminate\Support\Str::ascii((string) $v))) ?? '');
        $rawByCode = [];   // KÝ HIỆU => [các giá trị to_loc thực có]
        foreach (TruckingShipment::ofSheet($sheet)->whereNotNull('to_loc')->where('to_loc', '!=', '')->distinct()->pluck('to_loc') as $raw) {
            $code = $codeMap[$normLoc($raw)] ?? $normLoc($raw);
            $rawByCode[$code][] = $raw;
        }
        $toMode = (($p['toMode'] ?? 'include') === 'exclude') ? 'exclude' : 'include';   // Nơi hạ: GỒM/LOẠI TRỪ
        $toLocCodes = array_keys($rawByCode); sort($toLocCodes);
        $toLocRaw = [];   // ký hiệu đã chọn → các giá trị to_loc thực để whereIn
        foreach ($toLocSel as $code) foreach ($rawByCode[$code] ?? [$code] as $raw) $toLocRaw[] = $raw;

        // Lọc theo NƠI LẤY theo KÝ HIỆU — có chế độ GỒM / LOẠI TRỪ (kế toán: lọc nơi hạ + trừ nơi lấy).
        $fromSel  = array_values(array_filter(array_map(fn ($x) => trim((string) $x), (array) ($p['fromLoc'] ?? [])), fn ($x) => $x !== ''));
        $fromMode = (($p['fromMode'] ?? 'exclude') === 'include') ? 'include' : 'exclude';
        $fromByCode = [];
        foreach (TruckingShipment::ofSheet($sheet)->whereNotNull('from_loc')->where('from_loc', '!=', '')->distinct()->pluck('from_loc') as $raw) {
            $code = $codeMap[$normLoc($raw)] ?? $normLoc($raw);
            $fromByCode[$code][] = $raw;
        }
        $fromCodes = array_keys($fromByCode); sort($fromCodes);
        $fromRaw = [];
        foreach ($fromSel as $code) foreach ($fromByCode[$code] ?? [$code] as $raw) $fromRaw[] = $raw;

        // Lọc theo KHÁCH HÀNG — chọn nhiều = OR. Option = TÊN khách thực có trong lô của sheet;
        // lọc quy về customer_id (nhiều khách có thể trùng tên → gom mọi id cùng tên).
        $custSel = array_values(array_filter(array_map(fn ($x) => trim((string) $x), (array) ($p['cust'] ?? [])), fn ($x) => $x !== ''));
        $custOptions = [];
        $custIdsByName = [];
        $custRows = TruckingCustomer::whereIn('id', TruckingShipment::ofSheet($sheet)->whereNotNull('customer_id')->distinct()->select('customer_id'))
            ->orderBy('name')->get(['id', 'name']);
        foreach ($custRows as $c) {
            $n = trim((string) $c->name);
            if ($n === '') continue;
            if (! in_array($n, $custOptions, true)) $custOptions[] = $n;
            $custIdsByName[$n][] = (int) $c->id;
        }
        $custIds = [];
        foreach ($custSel as $n) foreach ($custIdsByName[$n] ?? [] as $id) $custIds[] = $id;

        // Lọc theo GIỜ ĐẾN KẾ HOẠCH (gio_den_du_kien) — chọn 1 NGÀY.
        $denDate = trim((string) ($p['denDate'] ?? ''));

        // Lọc theo NHÃN (tags) — chọn nhiều = OR. Danh sách nhãn thực có để đổ vào bộ lọc.
        $tagSel = array_values(array_filter(array_map(fn ($x) => trim((string) $x), (array) ($p['tags'] ?? [])), fn ($x) => $x !== ''));
        $tagOptions = [];
        foreach (TruckingShipment::ofSheet($sheet)->whereNotNull('tags')->pluck('tags') as $arr) {
            foreach ((array) $arr as $t) { $t = trim((string) $t); if ($t !== '' && ! in_array($t, $tagOptions, true)) $tagOptions[] = $t; }
        }
        sort($tagOptions);

        // Khoản chi phí "theo dõi" (có màu trong danh mục) → id + tên + hex.
        // Lọc theo cost_item_id (FK ổn định) thay vì item text (đổi tên sẽ sót dòng cũ).
        $followItems = TruckingCostItem::whereNotNull('color')->where('color', '!=', '')->get(['id', 'name', 'color', 'auto']);
        $followIds   = $followItems->pluck('id')->all();
        $followNames = $followItems->pluck('name')->all();        // giữ tên cho followStats display
        $nameHex     = $followItems->mapWithKeys(fn ($i) => [$i->name => $this->colorHex($i->color)])->all();
        $idHex       = $followItems->mapWithKeys(fn ($i) => [$i->id => $this->colorHex($i->color)])->all();
        // Khoản "auto" (tự hiện) + có màu → expected cho MỌI lô (nhắc "chưa điền" kể cả lô chưa thêm dòng).
        $autoHexes   = $followItems->filter(fn ($i) => $i->auto)->map(fn ($i) => $this->colorHex($i->color))->filter()->unique()->values()->all();
        $autoSet     = array_flip($autoHexes);
        $hasAutoFollow = ! empty($autoHexes);
        $nonAutoColoredIds = $followItems->filter(fn ($i) => ! $i->auto)->pluck('id')->all();
        $autoHexItems = [];   // hex => [item ids auto của màu đó]
        foreach ($followItems->filter(fn ($i) => $i->auto) as $i) { $autoHexItems[$this->colorHex($i->color)][] = $i->id; }
        $hexItems = [];       // hex => [tất cả item ids của màu đó]
        foreach ($followItems as $i) { $hexItems[$this->colorHex($i->color)][] = $i->id; }

        // Áp tìm kiếm (khách / container / booking / invoice / tờ khai) lên 1 builder lô.
        $applySearch = function ($b) use ($q) {
            if ($q === '') return;
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
            $b->where(function ($w) use ($like) {
                $w->where('cont_no', 'like', $like)
                  ->orWhere('booking', 'like', $like)
                  ->orWhere('inv', 'like', $like)
                  ->orWhere('declaration_no', 'like', $like)
                  ->orWhereHas('customer', fn ($c) => $c->where('name', 'like', $like));
            });
        };
        // Builder lô của tập "đã tìm" (chỉ áp q) — dùng cho aggregate.
        // Lọc địa điểm theo ký hiệu, có chế độ GỒM/LOẠI TRỪ. exclude giữ lô KHÔNG có địa điểm (orWhereNull).
        $applyLoc = function ($b, $col, $sel, $raw, $mode) {
            if (! $sel) return;
            if ($mode === 'exclude') {
                if ($raw) $b->where(fn ($w) => $w->whereNotIn($col, $raw)->orWhereNull($col));
            } else {
                $b->whereIn($col, $raw ?: ['\\0__none__']);
            }
        };
        $searched = function () use ($sheet, $applySearch, $applyLoc, $toLocSel, $toLocRaw, $toMode, $fromSel, $fromRaw, $fromMode, $custSel, $custIds, $denDate, $tagSel) {
            $b = TruckingShipment::ofSheet($sheet);
            $applySearch($b);
            $applyLoc($b, 'to_loc', $toLocSel, $toLocRaw, $toMode);
            $applyLoc($b, 'from_loc', $fromSel, $fromRaw, $fromMode);
            // Khách hàng = OR trên customer_id; tên chọn không còn khách nào → không lô nào khớp.
            if ($custSel) $b->whereIn('customer_id', $custIds ?: [0]);
            if ($denDate !== '') $b->whereDate('gio_den_du_kien', $denDate);       // lô có Giờ đến KH = ngày chọn
            // Lọc nhãn = OR. Dùng JSON_SEARCH (khớp được trên MariaDB + JSON lưu unicode escaped, whereJsonContains fail).
            if ($tagSel) $b->where(function ($w) use ($tagSel) { foreach ($tagSel as $t) $w->orWhereRaw('JSON_SEARCH(tags, \'one\', ?) IS NOT NULL', [$t]); });
            return $b;
        };

        // --- Aggregate toàn cục trên tập đã tìm ---
        // Tổng chi phí (header) = số NET: SUM(ROUND(amount / (1 + vat/100))).
        $totalCost = (int) round((float) TruckingCostLine::whereIn('shipment_id', $searched()->select('id'))
            ->sum(DB::raw('ROUND(amount / (1 + COALESCE(vat,0)/100))')));

        // "Đã ra" = CONT này có GIỜ XE RA (gio_xe_ra) của chính nó. CHỈ xét gio_xe_ra — không xét bks_ra
        // (BKS có thể chỉ là xe kéo, chưa chắc cont đã ra) cũng không xét việc xe kéo cont KHÁC ra.
        $applyOut = function ($q) {
            return $q->whereNotNull('gio_xe_ra')->where('gio_xe_ra', '!=', '');
        };
        $applyNotOut = function ($q) {
            return $q->where(fn ($a) => $a->whereNull('gio_xe_ra')->orWhere('gio_xe_ra', ''));
        };

        $allCount = $searched()->count();
        $outCount = $applyOut($searched())->count();
        $filterCounts = ['all' => $allCount, 'out' => $outCount, 'notout' => $allCount - $outCount];

        $followStats = $this->followStats($searched(), $autoHexes);

        // --- Danh sách hiển thị: q + lọc + follow + sort + phân trang ---
        $list = $searched();
        if ($filter === 'out') {
            $applyOut($list);
        } elseif ($filter === 'notout') {
            $applyNotOut($list);
        }
        if ($followIds) {
            // "đã điền" = có dòng khoản đó CÓ số hóa đơn. Khoản AUTO expected cho mọi lô (thiếu dòng = chưa điền).
            $filledOf = fn ($ids) => fn ($c) => $c->whereIn('cost_item_id', $ids ?: [0])->whereNotNull('invoice_no')->where('invoice_no', '!=', '');
            $emptyInv = fn ($ids) => fn ($c) => $c->whereIn('cost_item_id', $ids ?: [0])->where(fn ($x) => $x->whereNull('invoice_no')->orWhere('invoice_no', ''));
            if ($follow === 'any') {
                // Có theo dõi: nếu có khoản auto → mọi lô đều expected (không lọc); nếu không, lọc lô có dòng theo dõi.
                if (! $hasAutoFollow) $list->whereHas('costLines', fn ($c) => $c->whereIn('cost_item_id', $followIds));
            } elseif ($follow === 'missing') {
                // Chưa điền: (lô có dòng khoản KHÔNG-auto trống số HĐ) HOẶC (thiếu dòng-đã-điền cho 1 màu auto bất kỳ).
                $list->where(function ($w) use ($nonAutoColoredIds, $autoHexItems, $emptyInv, $filledOf) {
                    if ($nonAutoColoredIds) $w->whereHas('costLines', $emptyInv($nonAutoColoredIds));
                    foreach ($autoHexItems as $ids) $w->orWhereDoesntHave('costLines', $filledOf($ids));
                });
            } elseif (str_starts_with($follow, '#')) {
                $ids = $hexItems[$follow] ?? [0];
                if (isset($autoSet[$follow])) {
                    // Màu auto: lô CHƯA điền màu này (chưa có dòng điền số HĐ) — kể cả lô chưa thêm dòng.
                    $list->whereDoesntHave('costLines', $filledOf($ids));
                } else {
                    // Màu thường: lô có dòng màu này (như cũ).
                    $list->whereHas('costLines', fn ($c) => $c->whereIn('cost_item_id', $ids));
                }
            }
        }

        $total    = $all ? $allCount : $list->count();
        $lastPage = max(1, (int) ceil(($total ?: 1) / $perPage));
        $page     = min($page, $lastPage);

        if ($sortKey === 'customer') {
            $list->leftJoin('trucking_customers', 'trucking_customers.id', '=', 'trucking_shipments.customer_id')
                 ->orderBy('trucking_customers.name', $dir)
                 ->select('trucking_shipments.*');
        } elseif ($sortKey === 'cost') {
            $list->withSum('costLines as cost_total', 'amount')->orderBy('cost_total', $dir);
        } else {
            $list->orderBy('id', 'desc');   // mặc định: lô MỚI NHẬP lên đầu (id giảm dần)
        }

        $list->with(['customer', 'costLines', 'revenueLines', 'payments', 'raOther:id,gio_xe_ra']);
        if (! $all) $list->forPage($page, $perPage);
        // "Thu phí (cước+dầu)" CHO LÔ ĐÃ RA — DÙNG CHUNG priceShipment với bảng kê (1 nguồn công thức,
        // sửa 1 chỗ áp cả 2). Chỉ tính cho trang đang xem (không tính khi $all=export) để nhẹ query.
        $data = $list->get()->map(function ($s) use ($all) {
            $arr = $this->shipmentToArray($s);
            $out = ! empty($s->gio_xe_ra);   // "đã ra" = có Giờ xe ra
            if (! $all && $out) {
                $sheet = strtoupper((string) $s->sheet);
                $date  = $this->outDate($s->gio_xe_ra) ?: ($sheet === 'HPH' ? $this->outDate($s->sail_date) : '');
                $pr = $this->priceShipment($s, $this->pricingContextForDate($s->customer_id ? (int) $s->customer_id : null, $s->customer?->name, $date));
                // Nền cước+dầu (+ sà lan) — KHỚP cột "Phải thu (cước+dầu)" của bảng kê.
                $arr['cuocDau']      = (int) $pr['cuoc'] + (int) $pr['dau'] + (int) ($pr['bargeCuoc'] ?? 0) + (int) ($pr['bargeDau'] ?? 0);
                $arr['priceMatched'] = (bool) $pr['matched'];
            } else {
                $arr['cuocDau'] = null;   // chưa ra → chưa tính thu phí
            }
            return $arr;
        })->all();

        return [
            'data'         => $data,
            'page'         => $page,
            'perPage'      => $perPage,
            'total'        => $total,
            'lastPage'     => $lastPage,
            'totalCost'    => $totalCost,
            'filterCounts' => $filterCounts,
            'followStats'  => $followStats,
            'sibs'         => $this->siblingsList($sheet),
            // Danh sách KÝ HIỆU nơi hạ / nơi lấy thực có để đổ vào bộ lọc — gom theo ký hiệu, ổn định.
            'toLocs'       => $toLocCodes,
            'fromLocs'     => $fromCodes,
            'custOptions'  => $custOptions,
            'tagOptions'   => $tagOptions,
        ];
    }

    /**
     * Danh sách rút gọn mọi lô (id + cont + booking) cho picker "ra hộ" — KHÔNG kèm
     * dòng con nên rất nhẹ; đủ để chọn lô khác cầm container ra dù lô đó ở trang khác.
     *
     * @return array<int,array{id:int,contNo:string,booking:string}>
     */
    public function siblingsList(string $sheet): array
    {
        return TruckingShipment::ofSheet($sheet)->orderBy('id')
            ->toBase()->get(['id', 'cont_no', 'booking', 'gio_xe_ra', 'bks_ra'])   // không hydrate model — chỉ cột cần
            ->map(fn ($s) => [
                'id' => $s->id, 'contNo' => $s->cont_no ?? '', 'booking' => $s->booking ?? '',
                // datetime thô "Y-m-d H:i:s" → "Y-m-dTH:i" cho DTField; bksRa giữ chuỗi
                'gioXeRa' => $s->gio_xe_ra ? str_replace(' ', 'T', substr((string) $s->gio_xe_ra, 0, 16)) : '',
                'bksRa'   => $s->bks_ra ?? '',
            ])
            ->all();
    }

    /**
     * LỘ TRÌNH 1 NGÀY VẬN HÀNH (08:00 ngày $date → 08:00 hôm sau, tức 07:59 hôm sau là hết),
     * gom theo biển số XE VÀO (bks_vao) — mỗi xe 1 lộ trình liền mạch trong ngày.
     * Mỗi lô = 1 hoạt động dưới bks_vao, xếp theo GIỜ XE RA:
     *  - self  : "Lấy cont [X] ra" tại gio_xe_ra.
     *  - none  : "Ra xe (không kéo cont)" tại gio_xe_ra_xe.
     *  - other : "Kéo cont khác ([Y]) ra" tại gio_xe_ra của lô ra_other_id (cont X chờ).
     * Chỉ tính hoạt động có giờ ra TRONG khung [08:00, 08:00 hôm sau).
     */
    public function routeTripByDate(string $date): array
    {
        try { $start = Carbon::parse($date . ' 08:00:00'); }
        catch (\Throwable) { $start = Carbon::today()->setTime(8, 0); }
        $end = (clone $start)->addDay();   // 08:00 sáng hôm sau (07:59 là hết khung)
        $inWin = fn ($dt) => $dt && $dt->gte($start) && $dt->lt($end);

        // Lô có giờ ra cont HOẶC giờ ra xe trong khung (self + none) — nới biên 1 ngày 2 đầu cho chắc.
        $cand = TruckingShipment::with('customer')
            ->where(function ($q) use ($start, $end) {
                $q->whereBetween('gio_xe_ra', [$start, $end])
                  ->orWhereBetween('gio_xe_ra_xe', [$start, $end]);
            })->get();

        // Lô "kéo cont khác ra" (other) — CHỈ load lô có target nằm TRONG cand (giờ ra trong khung).
        // Tránh load toàn bảng ra_mode='other' khi data lớn (10k–50k lô).
        $candIds = $cand->pluck('id')->all();
        $others  = $candIds
            ? TruckingShipment::with('customer')->where('ra_mode', 'other')->whereIn('ra_other_id', $candIds)->get()
            : collect();
        $targets = $cand->keyBy('id');   // target chắc chắn nằm trong cand (gio_xe_ra ∈ window)
        $targetIds = $others->pluck('ra_other_id')->filter()->unique()->values()->all();

        $legs = [];
        // $rs = lô có TUYẾN mà xe THỰC SỰ chạy (self/none = chính nó; other = lô bị kéo ra hộ).
        $mk = function (TruckingShipment $s, Carbon $t, string $mode, ?TruckingShipment $rs = null, array $extra = []) {
            $rs = $rs ?: $s;
            // Chuỗi điểm hành trình: Nơi lấy → các Kho → Nơi hạ (bỏ điểm trùng liền kề).
            $pts = [];
            $add = function ($label, $kind) use (&$pts) {
                $label = trim((string) $label);
                if ($label === '' || ($pts && end($pts)['label'] === $label)) return;
                $pts[] = ['label' => $label, 'kind' => $kind];
            };
            // Lộ trình = kế toán theo dõi → Nơi lấy / Kho / Nơi hạ đều hiện KÝ HIỆU (gọn, dễ hiểu) thay vì tên hiển thị.
            $add($this->locCode($rs->from_loc), 'pickup');
            foreach ($this->khoCodePoints($rs->kho) as $kp) $add($kp, 'kho');
            $add($this->locCode($rs->to_loc), 'drop');

            return array_merge([
                'bks'        => trim((string) $s->bks_vao),
                'vehicleId'  => $s->vehicle_id ?: null,            // ưu tiên id để map xe (bền hơn match plate string)
                'sortTs'     => $t->getTimestamp(),
                'time'       => (int) ($t->getTimestamp() * 1000),
                'timeLabel'  => $t->format('H:i'),                  // giờ ra (format sẵn — tránh lệch tz trình duyệt)
                'gioDen'     => $s->gio_xe_den ? (int) ($s->gio_xe_den->getTimestamp() * 1000) : null,   // giờ xe đến (vào kho lấy/giao)
                'gioDenLabel'=> $s->gio_xe_den ? $s->gio_xe_den->format('H:i') : null,
                'mode'     => $mode,                              // self | none | other
                'cont'     => $s->cont_no ?? '',
                'bksRa'    => $s->bks_ra ?? '',
                'points'   => $pts,                               // hành trình điểm
                'route'    => $this->khoRouteDisplay($rs->kho) ?: ($rs->kho ?? ''),
                'kho'      => $rs->kho ?? '', 'cru' => (bool) $rs->cru,   // cho tính "chi theo ngày" (khớp phí tuyến + lương CRU)
                'from'     => $rs->from_loc ?? '', 'to' => $rs->to_loc ?? '',
                'customer' => $s->customer?->name ?? '',
                'booking'  => $s->booking ?? '',
                'hashid'   => \App\Support\Hashid::encode($s->id),
            ], $extra);
        };

        // Cont bị "kéo khác ra" (là target của 1 lô other): EXIT của nó thuộc XE KÉO (qua leg other),
        // KHÔNG phải xe vào nó → BỎ self-leg để khỏi gắn nhầm xe / đếm 2 lần.
        $targetSet = array_flip(array_map('intval', $targetIds));
        foreach ($cand as $s) {
            if (trim((string) $s->bks_vao) === '') continue;
            $mode = $s->ra_mode ?? 'self';
            $isSelf = ! in_array($mode, ['none', 'other'], true);   // self + null/'' (legacy)
            if ($isSelf && ! isset($targetSet[(int) $s->id]) && $inWin($s->gio_xe_ra)) {
                $legs[] = $mk($s, $s->gio_xe_ra, 'self');
            }
            if ($mode === 'none' && $inWin($s->gio_xe_ra_xe)) $legs[] = $mk($s, $s->gio_xe_ra_xe, 'none');
        }
        foreach ($others as $s) {
            if (trim((string) $s->bks_vao) === '') continue;
            $t = $targets->get($s->ra_other_id);
            if ($t && $inWin($t->gio_xe_ra)) {
                // refCont = cont KHÁC bị kéo ra; refBksVao = xe đã đưa cont đó VÀO trước đó; refBksRa = xe kéo cont đó ra (= xe hiện tại).
                $legs[] = $mk($s, $t->gio_xe_ra, 'other', $t, [
                    'refCont'    => $t->cont_no ?? '',
                    'refBksVao'  => trim((string) $t->bks_vao),
                    'refBksRa'   => trim((string) ($t->bks_ra ?: $s->bks_vao)),
                ]);
            }
        }

        // Gom theo bks_vao + map xe hệ thống QUA vehicle_id (Tier-2 ref đã chốt khi lưu) —
        // bền hơn so với match plate string (khử rủi ro typo/whitespace). Fallback theo plate
        // cho lô legacy chưa có vehicle_id.
        $vehIds = array_values(array_unique(array_filter(array_map(fn ($l) => $l['vehicleId'] ?? null, $legs))));
        $vehById = $vehIds ? TruckingVehicle::whereIn('id', $vehIds)->get(['id', 'plate', 'type', 'axle'])->keyBy('id') : collect();
        $legacyPlates = array_values(array_unique(array_map(fn ($l) => $l['bks'], array_filter($legs, fn ($l) => empty($l['vehicleId'])))));
        $vehByPlate = $legacyPlates ? TruckingVehicle::whereIn('plate', $legacyPlates)->get(['plate', 'type', 'axle'])->keyBy('plate') : collect();
        // Phí tuyến (khớp theo TẬP node Cảng+Kho — không thứ tự) + giá dầu + chi đã lưu cho ngày này.
        $dateStr = $start->format('Y-m-d');
        $rfBySet = [];
        foreach (\App\Models\TruckingRouteFee::all() as $rf) { $k = $this->routeNodeKey($this->routeStringNodes((string) $rf->route)); if ($k !== '') $rfBySet[$k] = $rf; }
        $fuels = TruckingFuelPrice::orderByDesc('from_date')->orderByDesc('id')->get();
        $paysByBks = \App\Models\TruckingRoutePay::whereDate('work_date', $dateStr)->get()->keyBy('bks');

        $byBks = [];
        foreach ($legs as $l) { $byBks[$l['bks']][] = $l; }
        $trucks = [];
        foreach ($byBks as $bks => $ls) {
            usort($ls, fn ($a, $b) => $a['sortTs'] <=> $b['sortTs']);
            $vid = $ls[0]['vehicleId'] ?? null;
            if ($vid && $vehById->has($vid)) {
                $type = $vehById[$vid]->type ?? null;
                $axle = $vehById[$vid]->axle ?? null;
                $matched = true;
            } else {
                $type = $vehByPlate[$bks]->type ?? null;
                $axle = $vehByPlate[$bks]->axle ?? null;
                $matched = $vehByPlate->has($bks);
            }
            $pay = $paysByBks->get($bks);
            // Chi khác phát sinh THỦ CÔNG (đã lưu) — gom theo cont để gắn vào đúng chuyến.
            $manualByCont = [];
            foreach ((array) ($pay?->extra_items ?? []) as $m) {
                if (! is_array($m)) continue;
                $manualByCont[(string) ($m['cont'] ?? '')][] = $m;
            }
            // MỖI chuyến (leg) = 1 nhóm (kể cả không khớp phí tuyến → cảnh báo cho kế toán).
            // payTotal = chi theo ngày; payrollTotal = khoản gom trả 1 đợt (lương) cho kỳ lương.
            $payGroups = []; $payTotal = 0; $payrollTotal = 0; $payWarn = 0;
            foreach ($ls as $l) {
                $g = $this->legPayGroup($l, $axle, $rfBySet, $fuels, $dateStr);
                // Gắn chi khác phát sinh của chuyến (theo cont) — perDay→chi theo ngày, không→gom lương.
                $manual = [];
                foreach ($manualByCont[(string) $g['cont']] ?? [] as $m) {
                    $amt = (int) round((float) ($m['amount'] ?? 0));
                    $perDay = ! isset($m['perDay']) || ! empty($m['perDay']);
                    $manual[] = ['name' => (string) ($m['name'] ?? ''), 'amount' => $amt, 'perDay' => $perDay];
                    if ($amt <= 0) continue;
                    if ($perDay) $g['sub'] += $amt; else $g['payrollSub'] += $amt;
                }
                $g['manual'] = $manual;
                if ($g['sub'] > 0 && $g['note'] !== '') $g['note'] = '';   // có tiền (kể cả thủ công) → hết cảnh báo
                $payGroups[] = $g;
                $payTotal += $g['sub'];
                $payrollTotal += $g['payrollSub'];
                if ($g['note'] !== '') $payWarn++;   // chuyến chưa ra tiền (không khớp / chưa tick / =0)
            }
            // ĐÓNG BĂNG (chốt): nếu xe/ngày đã chốt → dùng số ĐÃ CHỐT (không đổi dù sửa phí tuyến).
            $frozen = (bool) ($pay?->frozen);
            if ($frozen && is_array($pay->frozen_data)) {
                $fd = $pay->frozen_data;
                $payGroups    = $fd['payGroups'] ?? $payGroups;
                $payTotal     = $fd['payTotal'] ?? $payTotal;
                $payrollTotal = $fd['payrollTotal'] ?? $payrollTotal;
                $payWarn      = $fd['payWarn'] ?? $payWarn;
            }
            // Dầu = chi phí CÔNG TY (tách khỏi tiền lái) — tổng lít + tiền theo các chuyến trong ngày.
            $fuelTotal = 0; $fuelLiters = 0.0;
            foreach ($payGroups as $g) { if (! empty($g['fuel'])) { $fuelTotal += (int) ($g['fuel']['amount'] ?? 0); $fuelLiters += (float) ($g['fuel']['liters'] ?? 0); } }
            $trucks[] = ['bks' => $bks, 'vehicleId' => $vid, 'matched' => $matched, 'type' => $type, 'axle' => $axle, 'legs' => $ls,
                'payGroups' => $payGroups, 'payTotal' => $payTotal, 'payrollTotal' => $payrollTotal, 'payWarn' => $payWarn,
                'fuelTotal' => $fuelTotal, 'fuelLiters' => round($fuelLiters, 1),
                'frozen' => $frozen,
                'payDriver' => $pay?->driver ?? '', 'paid' => (bool) ($pay?->paid ?? false), 'paidDate' => $pay ? $this->outDate($pay->paid_date) : ''];
        }
        usort($trucks, fn ($a, $b) => count($b['legs']) <=> count($a['legs']) ?: strcmp($a['bks'], $b['bks']));
        $frozenCount = count(array_filter($trucks, fn ($t) => $t['frozen']));

        return [
            'date'  => $start->format('Y-m-d'),
            'start' => (int) ($start->getTimestamp() * 1000),
            'end'   => (int) ($end->getTimestamp() * 1000),
            'startLabel' => $start->format('d/m'),   // format sẵn theo tz ứng dụng (tránh lệch ngày trên trình duyệt)
            'endLabel'   => $end->format('d/m'),
            'trucks' => $trucks,
            'totalLegs' => count($legs),
        ];
    }

    /** Tách 1 chuỗi tuyến (Cảng/Kho) thành các node (cùng dấu phân tách với route fee). */
    private function routeStringNodes(string $s): array
    {
        $parts = preg_split('/\s*(?:,|→|->|–|—|\s-\s)\s*/u', trim($s)) ?: [];
        return array_values(array_filter(array_map('trim', $parts), fn ($x) => $x !== ''));
    }

    /**
     * Khóa tuyến theo TẬP node (Cảng + Kho) — KHÔNG quan tâm thứ tự, chuẩn hóa mỗi node
     * về KÝ HIỆU qua normalizedCodeMap (khớp cả tên lẫn mã, bỏ dấu/dấu cách):
     * "ICD Quế Võ"="ICDQV"; A→B→C ≡ A→C→B.
     */
    private function routeNodeKey(array $labels): string
    {
        $codeMap = $this->normalizedCodeMap();
        $norm = fn ($v) => mb_strtoupper(preg_replace('/\s+/u', '', trim(\Illuminate\Support\Str::ascii((string) $v))) ?? '');
        $set = [];
        foreach ($labels as $l) { $c = $codeMap[$norm($l)] ?? $norm($l); if ($c !== '') $set[$c] = true; }
        $set = array_keys($set);
        sort($set);
        return implode('|', $set);
    }

    /**
     * 1 CHUYẾN (leg) → nhóm chi cho lái: luôn trả nhóm (kể cả KHÔNG khớp phí tuyến) để
     * Lộ trình hiện ĐỦ mọi chuyến + cảnh báo cho kế toán. matched/note cho biết lý do = 0.
     */
    private function legPayGroup(array $leg, ?string $axle, array $rfBySet, $fuels, string $date): array
    {
        // Chuỗi node thực tế của chuyến — đúng như Lộ trình hiển thị:
        //  - KHÔNG kéo cont ra (mode none): xe chỉ tới NƠI LẤY rồi ra → chỉ tính điểm pickup.
        //  - Có kéo cont ra (self/other): đủ Nơi lấy (cảng) → các Kho → Nơi hạ (cảng).
        $noPull = ($leg['mode'] ?? '') === 'none';
        if ($noPull) {
            $pts = array_values(array_filter($leg['points'] ?? [], fn ($p) => ($p['kind'] ?? '') === 'pickup'));
            $nodes = $pts ? array_map(fn ($p) => $p['label'] ?? '', $pts) : [$leg['from'] ?? ''];
        } else {
            $nodes = array_merge([$leg['from'] ?? ''], $this->khoPoints($leg['kho'] ?? ''), [$leg['to'] ?? '']);
        }
        // Hiển thị lộ trình thực tế (bỏ điểm rỗng + trùng liền kề).
        $disp = [];
        foreach ($nodes as $n) { $n = trim((string) $n); if ($n === '' || (count($disp) && end($disp) === $n)) continue; $disp[] = $n; }
        $routeDisp = implode(' → ', $disp) ?: ($this->khoRouteDisplay($leg['kho'] ?? '') ?: '—');
        $g = ['route' => $routeDisp, 'cont' => $leg['cont'] ?? '', 'mode' => $leg['mode'] ?? '',
              'items' => [], 'sub' => 0, 'payrollItems' => [], 'payrollSub' => 0, 'fuel' => null, 'matched' => false, 'note' => ''];

        $rf = $rfBySet[$this->routeNodeKey($nodes)] ?? null;
        if (! $rf) { $g['note'] = 'Chưa có Phí tuyến khớp lộ trình này'; return $g; }
        $g['matched'] = true;
        $parts = $this->cleanSalaryParts($rf->salary_parts);   // khoản TÍCH "chi theo ngày"

        // Tính TẤT CẢ khoản, gắn cờ perDay: tích chi theo ngày = đã chi trong ngày;
        // KHÔNG tích = gom trả 1 đợt (lương) → tách ra payrollItems cho kỳ lương.
        $all = [];
        $daily = fn ($k) => in_array($k, $parts, true);
        $add = function ($key, $label, $amount, bool $perDay, array $extra = []) use (&$all) {
            $amount = (int) round((float) $amount);
            if ($amount <= 0) return;
            $all[] = ['key' => $key, 'label' => $label, 'amount' => $amount, 'perDay' => $perDay] + $extra;
        };
        $add('veTram', 'Vé trạm', $rf->ve_tram, $daily('veTram'));
        $add('tienDuong', 'Tiền đường', $rf->tien_duong, $daily('tienDuong'));
        $add('troCap', 'Trợ cấp', $rf->tro_cap, $daily('troCap'));
        // Lương theo 2 chiều: (CÓ/KHÔNG kéo cont ra) × (CRU/không CRU). $noPull tính ở trên.
        $cru    = ! empty($leg['cru']);
        $wage   = $noPull ? ($cru ? $rf->luong_nokeo : $rf->luong_nokeo_no_cru)
                          : ($cru ? $rf->luong       : $rf->luong_no_cru);
        $label  = 'Lương' . ($noPull ? ' · không kéo cont' : '') . ($cru ? ' · CRU' : ' · không CRU');
        $add('luong', $label, $wage, $daily('luong'));
        // DẦU = CHI PHÍ CÔNG TY (KHÔNG chi theo ngày cho lái) → tách riêng $g['fuel'], hiển thị lít + tiền công ty trả ở Lộ trình.
        $is2 = ($axle === '2');                                  // chọn lít dầu theo SỐ CẦU xe
        $liters = (float) ($is2 ? $rf->dau_2cau : $rf->dau_1cau);
        if ($liters > 0) {
            $unit = (float) $this->fuelPriceForDate($fuels, $date);   // đơn giá dầu theo NGÀY của chuyến
            $g['fuel'] = ['axle' => $is2 ? 2 : 1, 'liters' => $liters, 'unitPrice' => (int) round($unit), 'amount' => (int) round($liters * $unit)];
        }
        // Chi khác (repeater phí tuyến) — mỗi dòng TỰ quyết "chi theo ngày".
        foreach ((array) ($rf->extra_fees ?? []) as $ex) {
            if (! is_array($ex)) continue;
            $add('extra', trim((string) ($ex['name'] ?? '')) ?: 'Chi khác', $ex['amount'] ?? 0, ! empty($ex['perDay']));
        }
        // Tách 2 rổ: items = chi theo ngày (hiện ở Lộ trình); payrollItems = gom trả 1 đợt (kỳ lương).
        $items = array_values(array_filter($all, fn ($x) => $x['perDay']));
        $payroll = array_values(array_filter($all, fn ($x) => ! $x['perDay']));
        $g['items'] = $items;
        $g['sub']   = array_sum(array_column($items, 'amount'));
        $g['payrollItems'] = $payroll;
        $g['payrollSub']   = array_sum(array_column($payroll, 'amount'));
        if (! $items) $g['note'] = $parts ? 'Các khoản "chi theo ngày" của tuyến đều = 0' : 'Phí tuyến chưa tích "chi theo ngày" khoản nào';
        return $g;
    }

    /** Lưu chi cho lái xe theo ngày + xe (chỉ lưu lái nhận + đã chi; tiền tự tính từ phí tuyến). */
    public function saveRoutePay(string $date, string $bks, array $data): array
    {
        $bks = trim($bks);
        if ($bks === '' || trim($date) === '') return ['ok' => false, 'message' => 'Thiếu ngày/biển số'];
        $driver = $this->str($data['driver'] ?? null);
        $dkey = $driver ? mb_strtolower(preg_replace('/\s+/u', ' ', trim($driver)) ?? '') : '';
        $paid = ! empty($data['paid']);
        $veh = TruckingVehicle::where('plate', $bks)->first();
        // Chi khác phát sinh THỦ CÔNG theo từng chuyến (cont) — {cont, name, amount, perDay}.
        $extraItems = [];
        foreach ((array) ($data['extraItems'] ?? []) as $m) {
            if (! is_array($m)) continue;
            $name = $this->str($m['name'] ?? null) ?? '';
            $amount = $this->inMoney($m['amount'] ?? null) ?? 0;
            if ($name === '' && $amount <= 0) continue;
            $extraItems[] = [
                'cont'   => $this->str($m['cont'] ?? null) ?? '',
                'name'   => $name,
                'amount' => $amount,
                'perDay' => ! isset($m['perDay']) || ! empty($m['perDay']),   // mặc định chi theo ngày
            ];
        }
        \App\Models\TruckingRoutePay::updateOrCreate(
            ['work_date' => $date, 'bks' => $bks],
            [
                'vehicle_id' => $veh?->id,
                'driver'     => $driver ?: null,
                'driver_id'  => $dkey !== '' ? ($this->driverIdMap()[$dkey] ?? null) : null,
                'paid'       => $paid,
                'paid_date'  => $paid ? ($this->inDate($data['paidDate'] ?? null) ?: $date) : null,
                'note'       => $this->str($data['note'] ?? null),
                'extra_items' => $extraItems,
                'updated_by' => auth()->id(),
            ]
        );
        return ['ok' => true];
    }

    /**
     * ĐÓNG BĂNG (chốt) cả ngày: snapshot số tiền đã tính cho MỌI xe ngày đó vào route_pays
     * (frozen_data) để KHÔNG đổi khi sau này sửa Phí tuyến. $frozen=false → bỏ chốt.
     */
    public function freezeDay(string $date, bool $frozen): array
    {
        $date = trim($date);
        if ($date === '') return ['ok' => false, 'message' => 'Thiếu ngày'];
        if (! $frozen) {
            \App\Models\TruckingRoutePay::whereDate('work_date', $date)
                ->update(['frozen' => false, 'frozen_at' => null, 'frozen_data' => null]);
            return ['ok' => true, 'frozen' => false];
        }
        $day = $this->routeTripByDate($date);
        $n = 0;
        foreach ($day['trucks'] as $t) {
            $bks = $t['bks'];
            if ($bks === '') continue;
            $veh = TruckingVehicle::where('plate', $bks)->first();
            $row = \App\Models\TruckingRoutePay::firstOrNew(['work_date' => $date, 'bks' => $bks]);
            if (! $row->vehicle_id) $row->vehicle_id = $veh?->id;
            $row->frozen = true;
            $row->frozen_at = now();
            $row->frozen_data = [
                'payGroups'    => $t['payGroups'],
                'payTotal'     => $t['payTotal'],
                'payrollTotal' => $t['payrollTotal'],
                'payWarn'      => $t['payWarn'],
            ];
            $row->updated_by = auth()->id();
            $row->save();
            $n++;
        }
        return ['ok' => true, 'frozen' => true, 'count' => $n];
    }

    /**
     * Kỳ LƯƠNG lái xe — gom theo BIỂN SỐ XE qua khoảng ngày [from..to]:
     *  - payroll  = Σ khoản CHƯA "chi theo ngày" (lương gom trả 1 đợt) = TIỀN PHẢI TRẢ.
     *  - paidDaily = Σ khoản "chi theo ngày" (đã thanh toán theo ngày) — tham khảo.
     * Lái xe TỰ GÁN theo thời điểm (lấy từ route_pays.driver các ngày trong kỳ).
     */
    public function computePayroll(?string $from, ?string $to): array
    {
        $start = Carbon::parse($from ?: now()->format('Y-m-d'))->startOfDay();
        $end   = Carbon::parse($to ?: ($from ?: now()->format('Y-m-d')))->startOfDay();
        if ($end->lt($start)) { $tmp = $start; $start = $end; $end = $tmp; }

        $byBks = [];
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            $ds  = $d->format('Y-m-d');
            $day = $this->routeTripByDate($ds);
            foreach ($day['trucks'] as $t) {
                $bks = $t['bks'];
                if (! isset($byBks[$bks])) {
                    $byBks[$bks] = ['bks' => $bks, 'vehicleId' => $t['vehicleId'] ?? null, 'type' => $t['type'], 'axle' => $t['axle'],
                        'drivers' => [], 'days' => 0, 'trips' => 0, 'paidDaily' => 0, 'payroll' => 0, 'lines' => []];
                }
                $byBks[$bks]['days']++;
                $byBks[$bks]['trips']     += count($t['payGroups']);
                $byBks[$bks]['paidDaily'] += $t['payTotal'];
                $byBks[$bks]['payroll']   += $t['payrollTotal'];
                if (! empty($t['payDriver'])) $byBks[$bks]['drivers'][$t['payDriver']] = true;
                $byBks[$bks]['lines'][] = ['date' => $ds, 'driver' => $t['payDriver'] ?? '',
                    'paidDaily' => $t['payTotal'], 'payroll' => $t['payrollTotal'], 'groups' => $t['payGroups']];
            }
        }

        $rows = [];
        foreach ($byBks as $r) {
            $driverNames = array_keys($r['drivers']);
            $r['driver'] = implode(', ', $driverNames);   // lái auto theo thời điểm
            $r['driverId'] = count($driverNames) === 1 ? $this->resolveDriverId($driverNames[0]) : null;
            unset($r['drivers']);
            $r['total'] = $r['payroll'];                               // lương phải trả đợt
            $rows[] = $r;
        }
        usort($rows, fn ($a, $b) => strcmp($a['bks'], $b['bks']));

        return [
            'from' => $start->format('Y-m-d'), 'to' => $end->format('Y-m-d'),
            'rows' => $rows,
            'grandPayroll'   => array_sum(array_column($rows, 'payroll')),
            'grandPaidDaily' => array_sum(array_column($rows, 'paidDaily')),
            'drivers' => $this->driversOut(),
        ];
    }

    /**
     * Thống kê cờ theo dõi trên tập lô (builder) — gom theo màu, đếm lô có cờ &
     * lô có cờ nhưng CHƯA điền tiền. Chỉ nạp đúng các dòng chi phí thuộc khoản
     * "theo dõi" (không nạp toàn bộ dòng con) → nhẹ.
     */
    private function followStats($shipQuery, array $autoHexes = []): array
    {
        // Dùng cost_item_id (FK) để thống kê, không phụ thuộc item text (đổi tên vẫn đúng).
        $items = TruckingCostItem::whereNotNull('color')->where('color', '!=', '')->get(['id', 'color']);
        if ($items->isEmpty()) return ['anyShips' => 0, 'missShips' => 0, 'byColor' => []];
        $idToHex   = $items->mapWithKeys(fn ($i) => [$i->id => $this->colorHex($i->color)])->all();
        $followIds = $items->pluck('id')->all();
        $autoSet   = array_flip($autoHexes);

        // ids lô trong phạm vi — cần cho khoản AUTO (mọi lô đều "expected", kể cả lô chưa có dòng).
        $shipIds = $shipQuery->pluck('id')->all();
        if (empty($shipIds)) return ['anyShips' => 0, 'missShips' => 0, 'byColor' => []];

        // per-ship: hex => ['present'=>có dòng, 'filled'=>có dòng ĐÃ điền số HĐ]
        $lines = TruckingCostLine::whereIn('shipment_id', $shipIds)
            ->whereIn('cost_item_id', $followIds)
            ->get(['shipment_id', 'cost_item_id', 'invoice_no'])
            ->groupBy('shipment_id');
        $perShip = [];
        foreach ($lines as $sid => $shipLines) {
            $m = [];
            foreach ($shipLines as $l) {
                $hex = $idToHex[$l->cost_item_id] ?? '';
                if ($hex === '') continue;
                $m[$hex] ??= ['present' => false, 'filled' => false];
                $m[$hex]['present'] = true;
                if (trim((string) $l->invoice_no) !== '') $m[$hex]['filled'] = true;
            }
            $perShip[$sid] = $m;
        }

        $allHexes = array_values(array_unique(array_values($idToHex)));
        $buckets = [];
        foreach ($allHexes as $hex) $buckets[$hex] = ['hex' => $hex, 'total' => 0, 'miss' => 0];
        $anyShips = 0; $missShips = 0;

        foreach ($shipIds as $sid) {
            $m = $perShip[$sid] ?? [];
            $shipExpected = false; $shipMiss = false;
            foreach ($allHexes as $hex) {
                $isAuto  = isset($autoSet[$hex]);
                $present = ! empty($m[$hex]['present']);
                $filled  = ! empty($m[$hex]['filled']);
                $expected = $isAuto ? true : $present;   // auto: mọi lô; thường: chỉ lô có dòng màu đó
                if (! $expected) continue;
                $buckets[$hex]['total']++;
                $shipExpected = true;
                if (! $filled) { $buckets[$hex]['miss']++; $shipMiss = true; }   // chưa điền số HĐ (hoặc chưa có dòng)
            }
            if ($shipExpected) $anyShips++;
            if ($shipMiss) $missShips++;
        }

        $byColor = array_values(array_filter($buckets, fn ($b) => $b['total'] > 0));
        usort($byColor, fn ($a, $b) => ($b['miss'] - $a['miss']) ?: ($b['total'] - $a['total']));

        return ['anyShips' => $anyShips, 'missShips' => $missShips, 'byColor' => $byColor];
    }

    /** Chuẩn hóa id màu cũ (amber/blue/...) → hex; đã là hex thì giữ. Khớp colorHex() phía client. */
    private function colorHex(?string $c): string
    {
        if (! $c) return '';
        return ['amber' => '#e0a92e', 'blue' => '#2a6fdb', 'green' => '#1f8a5b', 'red' => '#d64545'][$c] ?? $c;
    }

    /** Chỉ các lô theo id (cho trang Xem bảng kê — tránh nạp toàn bộ lô). */
    public function shipmentsByIds(array $ids): array
    {
        $ids = array_values(array_filter($ids, 'is_numeric'));
        if (! $ids) return [];

        return TruckingShipment::whereIn('id', $ids)
            ->with(['customer', 'costLines', 'revenueLines', 'payments', 'raOther:id,gio_xe_ra'])
            ->get()
            ->map(fn ($s) => $this->shipmentToArray($s))
            ->all();
    }

    /**
     * Cấu hình TỐI THIỂU để định giá (priceFor) phía client — chỉ ký hiệu địa điểm,
     * ngưỡng free time và bảng giá của ĐÚNG 1 khách. Tránh nạp full config()
     * (mọi khách + mọi danh mục) cho trang Xem bảng kê.
     */
    public function pricingCfg(?string $customer): array
    {
        $cfg = [
            'locationCode'  => TruckingLocation::whereNotNull('code')->pluck('code', 'name')->all(),
            'freeTimeHours' => TruckingSetting::get('free_time_hours', '4'),
            'customerInfo'  => [],
        ];
        if ($customer && ($cust = TruckingCustomer::with('priceRows')->where('name', trim($customer))->first())) {
            $cfg['customerInfo'][$cust->name] = [
                'priceList' => $cust->priceRows->map(fn ($p) => $this->priceRowToArray($p))->all(),
            ];
        }
        return $cfg;
    }

    // ===================================================================
    // SHIPMENT — serialize & persist
    // ===================================================================
    public function shipmentToArray(TruckingShipment $s): array
    {
        return [
            'id'           => $s->id,
            'hashid'       => Hashid::encode($s->id),
            'customer'     => $s->customer?->name ?? '',
            'booking'      => $s->booking ?? '',
            'inv'          => $s->inv ?? '',
            'io'           => $s->io ?? '',
            'cru'          => (bool) $s->cru,
            'isBarge'      => (bool) $s->is_barge,
            'bargeCont'    => $s->barge_cont ?? '',
            'bargeDrop'    => $s->barge_drop ?? '',
            'qty'          => $s->qty,
            'contType'     => $s->cont_type ?? '',
            'contNo'       => $s->cont_no ?? '',
            'declNo'       => $s->declaration_no ?? '',   // chuỗi gộp — giữ cho bảng kê / tìm kiếm
            // Nguồn chân lý của tờ khai: mỗi tờ khai 1 số + 1 phí.
            'declarations' => array_map(fn ($d) => [
                'no'  => (string) ($d['no'] ?? ''),
                'fee' => $this->outMoney($d['fee'] ?? 0),
            ], (array) ($s->declarations ?? [])),
            'declNote'     => $s->declaration_note ?? '',
            'thanhLy'      => $this->outDate($s->thanh_ly_date),
            'cshtNote'     => $s->csht_note ?? '',
            'kho'          => $s->kho ?? '',
            'from'         => $s->from_loc ?? '',
            'to'           => $s->to_loc ?? '',
            // Chuỗi KÝ HIỆU tuyến: Nơi lấy → các Kho → Nơi hạ (vd HPP → QV → HPP) cho kế toán rà soát nhanh
            // từng lô. Rỗng (ẩn dòng) nếu y hệt chuỗi tên hiển thị (không có kho, ký hiệu = tên).
            'routeCodes'   => (function () use ($s) {
                $codes = array_values(array_filter(array_merge(
                    [$this->locCode($s->from_loc)],
                    $this->khoCodePoints($s->kho),
                    [$this->locCode($s->to_loc)],
                ), fn ($x) => trim((string) $x) !== ''));
                $names = array_values(array_filter([
                    trim((string) ($s->from_loc ?? '')),
                    trim((string) ($s->to_loc ?? '')),
                ], fn ($x) => $x !== ''));
                return $codes === $names ? [] : $codes;
            })(),
            'bksVao'       => $s->bks_vao ?? '',
            'bksRa'        => $s->bks_ra ?? '',
            'raMode'       => $s->ra_mode ?? 'self',
            'raOtherId'    => $s->ra_other_id,
            'extVendor'    => $s->ext_vendor ?? '',
            'extFee'       => $this->outMoney($s->ext_fee),
            'sailDate'     => $this->outDate($s->sail_date),
            'cutOff'       => $s->cut_off ?? '',
            'infoNote'     => $s->info_note ?? '',
            'tags'         => is_array($s->tags) ? array_values($s->tags) : [],
            'contDen'      => $this->outDate($s->cont_den),
            'contRa'       => $this->outDate($s->cont_ra),
            'gioDenDuKien' => $this->outDateTime($s->gio_den_du_kien),
            'gioXeDen'     => $this->outDateTime($s->gio_xe_den),
            'gioXeRa'      => $this->outDateTime($s->gio_xe_ra),
            'gioXeRaXe'    => $this->outDateTime($s->gio_xe_ra_xe),   // giờ XE ra (khi không kéo cont) — cột riêng
            // Giờ xe ra HIỆU LỰC cho Free time theo ra_mode: self→cont này ra; none→xe (đầu kéo) ra; other→cont KHÁC thực sự ra.
            'gioXeRaEff'   => $this->outDateTime(match ($s->ra_mode ?? 'self') {
                'none'  => $s->gio_xe_ra_xe,
                'other' => $s->raOther?->gio_xe_ra,
                default => $s->gio_xe_ra,
            }),
            'cost'         => [
                'items' => $s->costLines->map(fn ($c) => [
                    'id'       => $c->id,
                    'item'     => $c->item ?? '',
                    'amount'   => $this->outMoney($c->amount),
                    'vat'      => $this->outNum($c->vat),
                    'invoiceNo' => $c->invoice_no ?? '',
                    'payer'    => $c->payer ?? '',
                    'date'     => $this->outDate($c->date),
                    'billable' => (bool) $c->billable,
                    'color'    => $c->color ?? '',
                    'src'      => $c->src ?? '',
                    'note'     => $c->note ?? '',
                ])->all(),
            ],
            'rev' => [
                'vatRate'  => $this->outNum($s->vat_rate),
                'doanhThu' => $this->revLines($s, 'doanhThu'),
                'choHo'    => $this->revLines($s, 'choHo'),
                'hanTT'    => $this->outDate($s->han_tt),
                'payments' => $s->payments->map(fn ($p) => [
                    'id'     => $p->id,
                    'amount' => $this->outMoney($p->amount),
                    'date'   => $this->outDate($p->date),
                    'note'   => $p->note ?? '',
                ])->all(),
                'ghiChu'   => $s->ghi_chu ?? '',
            ],
        ];
    }

    private function revLines(TruckingShipment $s, string $kind): array
    {
        return $s->revenueLines->where('kind', $kind)->values()->map(fn ($r) => [
            'id'     => $r->id,
            'item'   => $r->item ?? '',
            'amount' => $this->outMoney($r->amount),
        ])->all();
    }

    /**
     * Upsert 1 lô + đồng bộ dòng con. $data theo shape frontend.
     *
     * $only = danh sách FIELD (key client) được phép ghi — dùng cho LƯU TỪNG PHẦN:
     * chỉ field người dùng vừa sửa mới ghi đè, field khác giữ nguyên giá trị trong DB
     * → tránh ghi đè thay đổi của người khác (lost update) khi 2 người sửa 2 field khác nhau.
     * $only = null → ghi toàn bộ (lô mới / import).
     */
    public function saveShipment(array $data, string $sheet, ?TruckingShipment $s = null, ?array $only = null): TruckingShipment
    {
        return DB::transaction(function () use ($data, $sheet, $s, $only) {
            $apply = fn (string $k) => $only === null || in_array($k, $only, true);

            $s ??= new TruckingShipment(['sheet' => $sheet]);
            $s->sheet = $sheet;

            if ($apply('customer')) {
                $customerId = null;
                if (! empty($data['customer'])) {
                    // Chuẩn hóa: trim + collapse khoảng trắng (kể cả Unicode) — tránh "Cty  ABC"
                    // và "Cty ABC" tạo 2 customer khác nhau → bảng kê khớp customer_id sai khách.
                    $cname = preg_replace('/\s+/u', ' ', trim((string) $data['customer'])) ?? '';
                    if ($cname !== '') {
                        $customerId = TruckingCustomer::firstOrCreate(['name' => $cname])->id;
                    }
                }
                $s->customer_id = $customerId;
            }

            // Map field client → [cột, giá trị]. Chỉ ghi cột khi field đó được phép (đã sửa).
            // GIỮ NGUYÊN tên địa điểm cụ thể (vd "SITC ĐÌNH VŨ") — KHÔNG gộp về ký hiệu khi lưu;
            // ký hiệu (HPP) chỉ dùng để khớp giá/gộp báo cáo (qua codeMap), tên cụ thể vẫn hiển thị ở lô.
            $cols = [
                'booking'      => ['booking', $this->str($data['booking'] ?? null)],
                'inv'          => ['inv', $this->str($data['inv'] ?? null)],
                'io'           => ['io', $this->canonIo($data['io'] ?? null)],
                'cru'          => ['cru', ! empty($data['cru'])],
                'isBarge'      => ['is_barge', ! empty($data['isBarge'])],
                'bargeCont'    => ['barge_cont', $this->str($data['bargeCont'] ?? null)],
                'bargeDrop'    => ['barge_drop', $this->str($data['bargeDrop'] ?? null)],
                'qty'          => ['qty', isset($data['qty']) && $data['qty'] !== '' ? (int) $data['qty'] : null],
                'contType'     => ['cont_type', $this->str($data['contType'] ?? null)],
                'contNo'       => ['cont_no', $this->str($data['contNo'] ?? null)],
                'declNo'       => ['declaration_no', $this->str($data['declNo'] ?? null)],
                'declNote'     => ['declaration_note', $this->str($data['declNote'] ?? null)],
                'thanhLy'      => ['thanh_ly_date', $this->inDate($data['thanhLy'] ?? null)],
                'cshtNote'     => ['csht_note', $this->str($data['cshtNote'] ?? null)],
                'kho'          => ['kho', $this->str($data['kho'] ?? null)],
                'from'         => ['from_loc', $this->str($data['from'] ?? null)],
                'to'           => ['to_loc', $this->str($data['to'] ?? null)],
                'bksVao'       => ['bks_vao', $this->str($data['bksVao'] ?? null)],
                'bksRa'        => ['bks_ra', $this->str($data['bksRa'] ?? null)],
                'driver'       => ['driver', $this->str($data['driver'] ?? null)],
                'raMode'       => ['ra_mode', $data['raMode'] ?? 'self'],
                'raOtherId'    => ['ra_other_id', $data['raOtherId'] ?? null],
                'extVendor'    => ['ext_vendor', $this->str($data['extVendor'] ?? null)],
                'sailDate'     => ['sail_date', $this->inDate($data['sailDate'] ?? null)],
                'cutOff'       => ['cut_off', $this->str($data['cutOff'] ?? null)],
                'infoNote'     => ['info_note', $this->str($data['infoNote'] ?? null)],
                'contDen'      => ['cont_den', $this->inDate($data['contDen'] ?? null)],
                'contRa'       => ['cont_ra', $this->inDate($data['contRa'] ?? null)],
                'gioDenDuKien' => ['gio_den_du_kien', $this->inDateTime($data['gioDenDuKien'] ?? null)],
                'gioXeDen'     => ['gio_xe_den', $this->inDateTime($data['gioXeDen'] ?? null)],
                'gioXeRa'      => ['gio_xe_ra', $this->inDateTime($data['gioXeRa'] ?? null)],
                'gioXeRaXe'    => ['gio_xe_ra_xe', $this->inDateTime($data['gioXeRaXe'] ?? null)],
            ];
            foreach ($cols as $key => [$col, $val]) {
                if ($apply($key)) $s->{$col} = $val;
            }
            // SÀ LAN: CÓ Nơi hạ sà lan = đi sà lan; loại DRY/NOR SUY TỪ Loại cont (reefer RF/RHC→NOR, còn lại→DRY).
            // Không còn cờ "Đi sà lan" / chọn DRur/NOR thủ công — derive khi sửa bargeDrop hoặc contType.
            if ($apply('bargeDrop') || $apply('contType')) {
                $hasBarge = trim((string) $s->barge_drop) !== '';
                $s->is_barge   = $hasBarge;
                $s->barge_cont = $hasBarge ? (preg_match('/R(F|HC|EEF)/i', (string) $s->cont_type) ? 'NOR' : 'DRY') : null;
            }
            // THUÊ XE NGOÀI bắt buộc chọn nhà xe: nếu lưu cost có dòng src=extTruck mà chưa có Nhà xe ngoài → chặn.
            if ($apply('cost')) {
                $hasExt = false;
                foreach (($data['cost']['items'] ?? []) as $c) if (($c['src'] ?? '') === 'extTruck') { $hasExt = true; break; }
                if ($hasExt && trim((string) $s->ext_vendor) === '') {
                    throw new \RuntimeException('Lô "Thuê xe ngoài" cần chọn Nhà xe ngoài.');
                }
            }
            // TỜ KHAI — 1 lô nhiều tờ khai, mỗi tờ khai 1 phí: [{no, fee}].
            // `declaration_no` vẫn được sinh ra (danh sách số cách nhau ", ") để tìm kiếm / bảng kê /
            // xuất Excel dùng như trước. Phí tổng đồng bộ sang dòng chi phí src=thanhLyFee bên dưới.
            if ($apply('declarations')) {
                $s->declarations = $this->normDeclarations($data['declarations'] ?? []);
                $s->declaration_no = implode(', ', array_column($s->declarations, 'no')) ?: null;
            }
            // Nhãn (tags) — mảng chuỗi, chuẩn hóa: trim + bỏ rỗng + bỏ trùng (giữ thứ tự).
            if ($apply('tags')) {
                $tags = [];
                foreach ((array) ($data['tags'] ?? []) as $t) { $t = trim((string) $t); if ($t !== '' && ! in_array($t, $tags, true)) $tags[] = $t; }
                $s->tags = $tags;
            }
            // Đăng ký KÝ HIỆU địa điểm mới gõ tay vào danh mục — bảng kê khớp giá qua codeMap
            // (port từ registerLocationCode dùng cho import bảng giá). Idempotent: đã có → no-op.
            if ($apply('from')) $this->registerLocationCode($data['from'] ?? null);
            if ($apply('to'))   $this->registerLocationCode($data['to'] ?? null);
            if ($apply('bargeDrop')) $this->registerLocationCode($data['bargeDrop'] ?? null);
            // rev scalars (VAT / hạn TT / ghi chú) đi cùng nhóm 'rev'
            if ($apply('rev')) {
                $s->vat_rate = $this->inNum($data['rev']['vatRate'] ?? null);
                $s->han_tt   = $this->inDate($data['rev']['hanTT'] ?? null);
                $s->ghi_chu  = $this->str($data['rev']['ghiChu'] ?? null);
            }
            $s->save();

            // "Cont khác ra": đẩy GIỜ RA + BKS đã nhập ở popup sang đúng cont ĐƯỢC CHỌN (ra_other_id) — theo id,
            // nên cập nhật được CẢ KHI cont đó không nằm trong trang đang xem (sửa bug giờ ra không xuống cont kia).
            if ($s->ra_mode === 'other' && $s->ra_other_id) {
                $hasGio = $apply('raOtherGioXeRa') && array_key_exists('raOtherGioXeRa', $data);
                $hasBks = $apply('raOtherBksRa') && array_key_exists('raOtherBksRa', $data);
                if ($hasGio || $hasBks) {
                    $o = TruckingShipment::find($s->ra_other_id);
                    if ($o) {
                        if ($hasGio) $o->gio_xe_ra = $this->inDateTime($data['raOtherGioXeRa']);
                        if ($hasBks) $o->bks_ra   = $this->str($data['raOtherBksRa']);
                        $o->save();
                        $this->recomputeShipmentDerived($o, null);
                    }
                }
            }

            // Dòng con chỉ đồng bộ khi nhóm tương ứng được sửa (cost / rev)
            if ($apply('cost')) {
            $s->costLines()->delete();
            foreach (($data['cost']['items'] ?? []) as $i => $c) {
                // "Bỏ trống không lưu": khoản auto/khoản trống (không tiền + không số HĐ + không người chi/ghi chú/nguồn)
                // thì KHÔNG tạo dòng → tránh rác 0đ khi auto-hiện sẵn ở popup.
                $amt = (int) round((float) $this->inMoney($c['amount'] ?? null));
                $hasContent = $amt !== 0
                    || trim((string) ($c['invoiceNo'] ?? '')) !== ''
                    || trim((string) ($c['note'] ?? '')) !== ''
                    || trim((string) ($c['payer'] ?? '')) !== ''
                    || trim((string) ($c['src'] ?? '')) !== '';
                if (! $hasContent) continue;
                $s->costLines()->create([
                    'item'     => $this->str($c['item'] ?? null),
                    'amount'   => $this->inMoney($c['amount'] ?? null),
                    'vat'      => $this->inNum($c['vat'] ?? null) ?? 0,
                    'invoice_no' => $this->str($c['invoiceNo'] ?? null),
                    'payer'    => $this->str($c['payer'] ?? null),
                    'date'     => $this->inDate($c['date'] ?? null),
                    'billable' => ! empty($c['billable']),
                    'color'    => $this->str($c['color'] ?? null),
                    'src'      => $this->str($c['src'] ?? null),
                    'note'     => $this->str($c['note'] ?? null),
                    'sort'     => $i,
                ]);
            }
            }   // end if apply('cost')

            if ($apply('rev')) {
            $s->revenueLines()->delete();
            foreach (['doanhThu', 'choHo'] as $kind) {
                foreach (($data['rev'][$kind] ?? []) as $i => $r) {
                    $s->revenueLines()->create([
                        'kind'   => $kind,
                        'item'   => $this->str($r['item'] ?? null),
                        'amount' => $this->inMoney($r['amount'] ?? null),
                        'sort'   => $i,
                    ]);
                }
            }

            $s->payments()->delete();
            foreach (($data['rev']['payments'] ?? []) as $i => $p) {
                $s->payments()->create([
                    'amount' => $this->inMoney($p['amount'] ?? null),
                    'date'   => $this->inDate($p['date'] ?? null),
                    'note'   => $this->str($p['note'] ?? null),
                    'sort'   => $i,
                ]);
            }
            }   // end if apply('rev')

            // Phí tờ khai → 1 dòng chi phí src=thanhLyFee = TỔNG phí các tờ khai (giữ nguyên cơ chế
            // cột "Thanh lí" của bảng kê vẫn cộng theo src này). Chạy SAU khi dòng chi phí đã lưu.
            if ($apply('declarations')) $this->syncDeclarationFee($s);

            $this->recomputeShipmentDerived($s, $only);
            return $s->fresh(['customer', 'costLines', 'revenueLines', 'payments']);
        });
    }

    /** Khoản chi phí cho phí mở tờ khai (đã khai sẵn trong danh mục — xem migration seed). */
    private const DECL_FEE_ITEM = 'Phí mở tờ khai';

    /**
     * Chuẩn hóa danh sách tờ khai → [{no, fee}]: bỏ dòng không có số, gộp khoảng trắng,
     * phí là số nguyên ≥ 0, bỏ số trùng (giữ dòng đầu). Nhận cả mảng chuỗi (chỉ số tờ khai).
     */
    private function normDeclarations($raw): array
    {
        $out = []; $seen = [];
        foreach ((array) $raw as $d) {
            if (! is_array($d)) $d = ['no' => $d, 'fee' => 0];
            $no = preg_replace('/\s+/u', ' ', trim((string) ($d['no'] ?? ''))) ?? '';
            if ($no === '') continue;
            $k = mb_strtolower($no);
            if (isset($seen[$k])) continue;
            $seen[$k] = true;
            $out[] = ['no' => $no, 'fee' => max(0, (int) round((float) $this->inMoney($d['fee'] ?? null)))];
        }
        return $out;
    }

    /**
     * Đồng bộ TỔNG phí tờ khai sang 1 dòng chi phí src=thanhLyFee (tạo / cập nhật / xóa).
     * Nguồn chân lý là cột `declarations`; dòng chi phí chỉ là bản chiếu để chi phí, báo cáo
     * và cột "Thanh lí" của bảng kê hoạt động y như trước (chúng cộng theo src).
     */
    private function syncDeclarationFee(TruckingShipment $s): void
    {
        $total = 0;
        foreach ((array) $s->declarations as $d) $total += (int) round((float) ($d['fee'] ?? 0));

        $line = $s->costLines()->where('src', 'thanhLyFee')->orderBy('sort')->first();
        if ($total <= 0) {
            if ($line) $line->delete();
        } elseif ($line) {
            $line->fill(['amount' => $total])->save();
        } else {
            $item = TruckingCostItem::where('name', self::DECL_FEE_ITEM)->first();
            $s->costLines()->create([
                'item'         => self::DECL_FEE_ITEM,
                'amount'       => $total,
                'src'          => 'thanhLyFee',
                'vat'          => $item?->vat ?? 0,
                'color'        => $item?->color,
                'cost_item_id' => $item?->id,
                'billable'     => false,
                'sort'         => (int) $s->costLines()->max('sort') + 1,
            ]);
        }
        $s->unsetRelation('costLines');   // quan hệ đã cũ → để recompute đọc lại số mới
    }

    /**
     * Mọi lô CÙNG BOOKING (cùng khách) — import "số lượng cont = N" đẻ ra N lô trống cont,
     * danh sách này để điền số cont cho cả nhóm trong 1 lần, không phải tìm từng lô.
     *
     * @return array<int,array<string,mixed>>
     */
    public function shipmentsOfBooking(string $sheet, string $booking, ?string $customer = null): array
    {
        $booking = trim($booking);
        if ($booking === '') return [];

        $q = TruckingShipment::ofSheet($sheet)->with('customer')->where('booking', $booking);
        // Booking có thể trùng giữa 2 khách → lọc thêm theo khách khi biết.
        if ($customer !== null && trim($customer) !== '') {
            $cname = preg_replace('/\s+/u', ' ', trim($customer)) ?? '';
            $q->whereHas('customer', fn ($c) => $c->where('name', $cname));
        }

        return $q->orderBy('id')->get()->map(fn ($s) => [
            'id'       => $s->id,
            'contNo'   => $s->cont_no ?? '',
            'contType' => $s->cont_type ?? '',
            'io'       => $s->io ?? '',
            'kho'      => $s->kho ?? '',
            'customer' => $s->customer->name ?? '',
            'booking'  => $s->booking ?? '',
        ])->all();
    }

    /**
     * Gán SỐ CONT cho từng lô theo cặp [id => số cont] (điền cont cho cả booking một lần).
     * Đi qua saveShipment với $only=['contNo'] → giữ nguyên mọi field khác và vẫn recompute
     * các cột dẫn xuất như khi sửa trong popup.
     *
     * @param  array<int,array{id:int|string,contNo:string}>  $pairs
     * @return int số lô đã ghi
     */
    public function assignContNos(string $sheet, array $pairs): int
    {
        $want = [];
        foreach ($pairs as $p) {
            $id = (int) ($p['id'] ?? 0);
            if ($id > 0) $want[$id] = $this->str($p['contNo'] ?? '');
        }
        if (empty($want)) return 0;

        $n = 0;
        foreach (TruckingShipment::ofSheet($sheet)->whereIn('id', array_keys($want))->get() as $s) {
            $new = $want[$s->id];
            if ((string) ($s->cont_no ?? '') === (string) ($new ?? '')) continue;   // không đổi → khỏi ghi
            $this->saveShipment(['contNo' => $new], $s->sheet ?: $sheet, $s, ['contNo']);
            $n++;
        }
        return $n;
    }

    /**
     * Cập nhật HÀNG LOẠT các lô đã chọn — hiện chỉ Nơi hạ (to) + Nơi hạ sà lan (bargeDrop).
     * Tái dùng saveShipment với $only = các field CÓ giá trị (bỏ trống = KHÔNG đụng field đó),
     * nhờ vậy hưởng cùng logic: đăng ký ký hiệu địa điểm, suy is_barge/barge_cont, recompute.
     * @return int số lô đã cập nhật
     */
    public function bulkUpdateShipments(array $ids, array $data): int
    {
        $ids = array_values(array_filter(array_map('intval', $ids)));
        if (empty($ids)) return 0;

        // Chỉ áp field NGƯỜI DÙNG nhập (khác rỗng) → tránh xóa nhầm dữ liệu lô đang chọn.
        $only = [];
        if (isset($data['to']) && trim((string) $data['to']) !== '')               $only[] = 'to';
        if (isset($data['bargeDrop']) && trim((string) $data['bargeDrop']) !== '')  $only[] = 'bargeDrop';
        if (empty($only)) return 0;

        $n = 0;
        foreach (TruckingShipment::whereIn('id', $ids)->get() as $s) {
            $this->saveShipment($data, $s->sheet ?: 'icd', $s, $only);
            $n++;
        }
        return $n;
    }

    /** Bản đồ tên/ký hiệu kho → id (cho tách kho theo lô). Memoize / request. */
    private function warehouseIdMap(): array
    {
        if ($this->whIdMapCache !== null) return $this->whIdMapCache;
        $map = [];
        foreach (TruckingWarehouse::toBase()->get(['id', 'name', 'code']) as $w) {
            if ($w->name) $map[mb_strtolower(trim($w->name))] = (int) $w->id;
            if ($w->code) $map[mb_strtolower(trim($w->code))] = (int) $w->id;
        }
        return $this->whIdMapCache = $map;
    }

    /** Bản đồ tên lái xe → id (lowercase). Memoize / request. */
    private function driverIdMap(): array
    {
        if ($this->driverIdMapCache !== null) return $this->driverIdMapCache;
        $map = [];
        foreach (TruckingDriver::toBase()->get(['id', 'name']) as $d) {
            $k = mb_strtolower(trim((string) $d->name));
            if ($k !== '') $map[$k] = (int) $d->id;
        }
        return $this->driverIdMapCache = $map;
    }

    /** Bản đồ plate → vehicle_id (lowercase+trim+collapse). Memoize / request. */
    private function vehicleIdMap(): array
    {
        if ($this->vehicleIdMapCache !== null) return $this->vehicleIdMapCache;
        $map = [];
        foreach (TruckingVehicle::toBase()->get(['id', 'plate']) as $v) {
            $k = mb_strtolower(preg_replace('/\s+/u', ' ', trim((string) $v->plate)) ?? '');
            if ($k !== '') $map[$k] = (int) $v->id;
        }
        return $this->vehicleIdMapCache = $map;
    }

    /** Bản đồ tên khách → id (lowercase+trim+collapse). Memoize / request. */
    private function customerIdMap(): array
    {
        if ($this->customerIdMapCache !== null) return $this->customerIdMapCache;
        $map = [];
        foreach (TruckingCustomer::toBase()->get(['id', 'name']) as $c) {
            $k = mb_strtolower(preg_replace('/\s+/u', ' ', trim((string) $c->name)) ?? '');
            if ($k !== '') $map[$k] = (int) $c->id;
        }
        return $this->customerIdMapCache = $map;
    }

    /** Lookup customer_id theo tên — qua cache memoized (same rule với observer). */
    private function customerIdByName(?string $name): ?int
    {
        $n = trim((string) $name);
        if ($n === '') return null;
        $k = mb_strtolower(preg_replace('/\s+/u', ' ', $n) ?? '');
        return $this->customerIdMap()[$k] ?? null;
    }

    /**
     * Chốt số liệu + tham chiếu BÁO CÁO cho 1 lô (gọi sau khi lưu / để backfill):
     * - Tier 2: gán cost_item_id/payer_id (cost), item_id (revenue) theo tên hiện tại.
     * - Tier 1: tổng doanh thu/VAT/chi hộ/phải thu/đã thu/còn nợ/chi phí/lợi nhuận.
     * - Tier 3: vehicle_id, from/to_location_id + bảng kho theo lô.
     * Giữ nguyên cột chuỗi (lịch sử); id chỉ là khóa join.
     *
     * $only = field client vừa sửa (xem saveShipment). null → backfill toàn phần (CLI / import).
     * Có $only → CHỈ chạy phần liên quan: tránh đụng DB khi user sửa 1 field trung tính
     * (note / driver / bks*) trong popup.
     */
    public function recomputeShipmentDerived(TruckingShipment $s, ?array $only = null): void
    {
        // Field nào kéo theo phần recompute nào (giữ đồng bộ với map $cols ở saveShipment).
        $touches = fn (array $keys) => $only === null || array_intersect($keys, $only) !== [];
        // 'declarations' cũng đụng chi phí: phí tờ khai đồng bộ sang dòng src=thanhLyFee (xem syncDeclarationFee).
        $needTier2   = $touches(['cost', 'rev', 'declarations']);
        $needTotals  = $touches(['cost', 'rev', 'declarations']);
        $needVehicle = $touches(['bksVao']);
        $needDriver  = $touches(['driver']);
        $needLoc     = $touches(['from', 'to']);
        $needWh      = $touches(['kho']);

        if (! $needTier2 && ! $needTotals && ! $needVehicle && ! $needDriver && ! $needLoc && ! $needWh) return;

        if ($needTier2 || $needTotals) {
            $s->load(['costLines', 'revenueLines', 'payments']);   // nạp TƯƠI khi cần totals/tier2
        }

        if ($needTier2) {
            $costItemId = TruckingCostItem::pluck('id', 'name');
            $payerId    = TruckingPayer::pluck('id', 'name');
            $revItemId  = TruckingRevenueItem::pluck('id', 'name');
            $chohoId    = TruckingChohoItem::pluck('id', 'name');
            foreach ($s->costLines as $c) {
                $ci = $c->item !== null ? ($costItemId[$c->item] ?? null) : null;
                $pi = $c->payer !== null ? ($payerId[$c->payer] ?? null) : null;
                if ((int) $c->cost_item_id !== (int) $ci || (int) $c->payer_id !== (int) $pi) {
                    $c->cost_item_id = $ci; $c->payer_id = $pi; $c->save();
                }
            }
            foreach ($s->revenueLines as $r) {
                $map = $r->kind === 'choHo' ? $chohoId : $revItemId;
                $ii = $r->item !== null ? ($map[$r->item] ?? null) : null;
                if ((int) $r->item_id !== (int) $ii) { $r->item_id = $ii; $r->save(); }
            }
        }

        $updates = [];
        if ($needTotals) {
            // Tier 1 — tổng tiền (khớp calcRev/calcCost ở frontend)
            $revBase  = (float) $s->revenueLines->where('kind', 'doanhThu')->sum('amount');
            $chohoRev = (float) $s->revenueLines->where('kind', 'choHo')->sum('amount');
            $rate     = (float) ($s->vat_rate ?? 0);
            $vat      = round($revBase * $rate / 100);
            $phaiThu  = $revBase + $vat + $chohoRev;
            $daThu    = (float) $s->payments->sum('amount');
            // Chi phí dùng số NET (đã trừ VAT): net = số tiền (gồm VAT) ÷ (1 + vat/100).
            $netOf        = fn ($c) => $c->netAmount();
            $costTotal    = (float) $s->costLines->sum($netOf);
            $costBillable = (float) $s->costLines->where('billable', true)->sum($netOf);
            $costCompany  = $costTotal - $costBillable;
            // Cước thuê xe ngoài (chốt) = tổng dòng chi phí src=extTruck — để Bảng kê xe ngoài query nhanh.
            $extFee       = (float) $s->costLines->where('src', 'extTruck')->sum('amount');
            $updates += [
                'rev_base' => $revBase, 'vat_amount' => $vat, 'choho_revenue' => $chohoRev,
                'phai_thu' => $phaiThu, 'da_thu' => $daThu, 'con_no' => $phaiThu - $daThu,
                'cost_total' => $costTotal, 'cost_billable' => $costBillable, 'cost_company' => $costCompany,
                'profit' => $revBase - $costCompany, 'ext_fee' => $extFee,
            ];
        }
        if ($needVehicle) {
            $updates['vehicle_id'] = $s->bks_vao ? TruckingVehicle::where('plate', $s->bks_vao)->value('id') : null;
        }
        if ($needDriver) {
            $dname = preg_replace('/\s+/u', ' ', trim((string) ($s->driver ?? ''))) ?? '';
            $updates['driver_id'] = $dname !== '' ? ($this->driverIdMap()[mb_strtolower($dname)] ?? null) : null;
        }
        if ($needLoc) {
            $updates['from_location_id'] = $this->resolveLocationId($s->from_loc);
            $updates['to_location_id']   = $this->resolveLocationId($s->to_loc);
        }
        if ($updates) {
            $s->forceFill($updates)->save();
        }

        if ($needWh) {
            // Tier 3 — kho theo lô (mỗi kho 1 dòng). Tách theo cùng bộ ngăn cách với
            // khoPoints/khoRouteDisplay ( , → -> – — " - " ) để khớp warehouse_id dù tuyến dùng mũi tên.
            $whMap = $this->warehouseIdMap();
            $s->warehouses()->delete();
            $parts = array_values(array_filter(array_map('trim', preg_split('/\s*(?:,|→|->|–|—|\s-\s)\s*/u', (string) $s->kho) ?: []), fn ($x) => $x !== ''));
            foreach ($parts as $i => $name) {
                $s->warehouses()->create(['warehouse_id' => $whMap[mb_strtolower($name)] ?? null, 'name' => $name, 'sort' => $i]);
            }
        }
    }

}
