<?php

namespace App\Services\Trucking\Concerns;

use App\Models\TruckingSetting;
use App\Models\TruckingShipment;
use App\Models\TruckingVehicle;
use App\Support\Hashid;
use Carbon\Carbon;

/**
 * BÁO CÁO TÀI SẢN — thống kê theo TỪNG XE / TÀI SẢN trong khoảng THÁNG [from, to]:
 *  - Chi phí thường : phiếu chi KHÔNG phân bổ, theo Ngày chi rơi trong kỳ.
 *  - Chi phí phân bổ: phiếu chi phân bổ — cộng (Số tiền ÷ số tháng) cho mỗi THÁNG phân bổ rơi trong kỳ.
 *  - Khấu hao       : theo NGÀY = Nguyên giá ÷ (30 × số tháng) × số NGÀY của kỳ nằm trong kỳ khấu hao.
 * Tất cả đều "ĐÃ PHÁT SINH" — KHÔNG tính phần thuộc tương lai (chặn ở tháng/ngày hiện tại).
 *
 * Ngoài bảng theo xe, cùng 1 lần duyệt còn tính cho phần TỔNG QUAN (sếp xem):
 *  - Kỳ trước cùng độ dài (so sánh ▲▼) + xu hướng theo THÁNG (≥ 12 tháng kết tại tháng cuối kỳ).
 *  - Cơ cấu theo KHOẢN (gom theo tên phiếu chi — cost_type_id thực tế không được điền), theo nhà cung cấp,
 *    Vật tư/Dịch vụ, Xe/Tài sản.
 *  - Sổ tài sản khấu hao (tính đến HÔM NAY, độc lập kỳ): nguyên giá, lũy kế, còn lại, tiến độ, hết khấu hao.
 *  - Cảnh báo: hạn giấy tờ (đăng kiểm/bảo hiểm/bảo hành/kiểm định trong info), khoản định kỳ sắp hết,
 *    phiếu chưa duyệt/chưa chi, tài sản sắp hết khấu hao.
 *  - Số cont kéo trong kỳ theo xe (lô có vehicle_id + Giờ xe ra trong kỳ) → CP/cont.
 */
trait HandlesAssetReport
{
    /** "YYYY-MM" → [năm, tháng]; sai định dạng → tháng hiện tại. */
    private function ymParts(?string $ym): array
    {
        if (preg_match('/^(\d{4})-(\d{1,2})$/', trim((string) $ym), $m)) {
            $mo = max(1, min(12, (int) $m[2]));
            return [(int) $m[1], $mo];
        }
        return [(int) now()->format('Y'), (int) now()->format('n')];
    }

    /** Chỉ số tháng tuyệt đối (năm×12 + tháng−1) — để cộng/trừ tháng không lo qua năm. */
    private function monthIdx(Carbon $d): int
    {
        return (int) $d->format('Y') * 12 + ((int) $d->format('n') - 1);
    }

    private function idxToYm(int $idx): string
    {
        return sprintf('%04d-%02d', intdiv($idx, 12), $idx % 12 + 1);
    }

    /**
     * Các NĂM có thể chọn ở báo cáo = từ năm có dữ liệu sớm nhất (phiếu chi / khấu hao) → năm hiện tại.
     * Lấy theo DỮ LIỆU THẬT nên danh sách luôn ngắn & không bao giờ thiếu năm cũ.
     */
    public function assetReportYears(): array
    {
        $nowY = (int) now()->format('Y');
        $minCost = \App\Models\TruckingVehicleCost::whereNull('cancelled_at')->min('spend_date');
        $minDep  = \App\Models\TruckingVehicleDepreciation::min('start_date');
        $years = [];
        foreach ([$minCost, $minDep] as $d) {
            if ($d) { try { $years[] = (int) Carbon::parse($d)->format('Y'); } catch (\Throwable) {} }
        }
        $min = $years ? min($years) : $nowY;
        $min = max(2000, min($min, $nowY));           // chặn năm rác
        return array_map('intval', range($nowY, $min));   // mới → cũ
    }

    public function assetReport(?string $fromYm, ?string $toYm): array
    {
        [$fy, $fm] = $this->ymParts($fromYm);
        [$ty, $tm] = $this->ymParts($toYm);
        $fromIdx = $fy * 12 + ($fm - 1);
        $toIdx   = $ty * 12 + ($tm - 1);
        if ($toIdx < $fromIdx) [$fromIdx, $toIdx] = [$toIdx, $fromIdx];
        $months = $toIdx - $fromIdx + 1;

        $mStart = fn (int $idx) => Carbon::create(intdiv($idx, 12), $idx % 12 + 1, 1)->startOfDay();
        $pStart = $mStart($fromIdx);
        $pEndEx = $mStart($toIdx)->addMonth();   // exclusive
        $today  = Carbon::today();
        $nowIdx = $this->monthIdx($today);
        $capIdx = min($toIdx, $nowIdx);                                   // tháng cuối được tính (không tính tương lai)
        // Ngày cuối được tính (exclusive) = hết kỳ HOẶC hôm nay — dùng $today (không +1) để SỐ NGÀY khớp
        // đúng daysUsed của tab Khấu hao (số ngày ĐÃ TRÔI QUA, không tính ngày hôm nay).
        $capEnd = $pEndEx->min($today);

        // Cửa sổ tính theo THÁNG cho phần tổng quan: phủ KỲ TRƯỚC (cùng độ dài) + đủ 12 tháng xu hướng
        // kết tại tháng cuối kỳ. Mỗi ô = [costNormal, costAlloc, deprec] của toàn đội trong tháng đó.
        $prevFromIdx = $fromIdx - $months;
        $trendFromIdx = min($fromIdx, $toIdx - 11);
        $bFrom = min($prevFromIdx, $trendFromIdx);
        $nB = $toIdx - $bFrom + 1;
        $buckets = array_fill(0, $nB, ['costNormal' => 0, 'costAlloc' => 0, 'deprec' => 0.0]);
        $inPrev = fn (int $idx) => $idx >= $prevFromIdx && $idx < $fromIdx;

        $warnDays = (int) TruckingSetting::get('due_warn_days', '30') ?: 30;

        // Số cont kéo trong kỳ theo xe: lô đã gắn vehicle_id (theo BKS vào) và có Giờ xe ra trong kỳ.
        $contByVeh = TruckingShipment::whereNotNull('vehicle_id')
            ->where('gio_xe_ra', '>=', $pStart)->where('gio_xe_ra', '<', $pEndEx)
            ->selectRaw('vehicle_id, COUNT(*) c')->groupBy('vehicle_id')->pluck('c', 'vehicle_id');

        $vehicles = TruckingVehicle::with([
            'vehicleCosts' => fn ($q) => $q->whereNull('cancelled_at'),
            'vehicleDepreciations',
        ])->orderBy('kind')->orderBy('plate')->get();

        $rows = [];
        $byItem = [];       // key tên thường → {label, amount, count, material}
        $bySupplier = [];   // nhà cung cấp → tiền
        $split = ['material' => 0, 'service' => 0, 'vehicle' => 0, 'asset' => 0];
        $register = [];     // sổ tài sản khấu hao (1 dòng / hạng mục khấu hao)
        $regTot = ['orig' => 0.0, 'accrued' => 0.0, 'remain' => 0.0, 'monthly' => 0.0, 'active' => 0, 'done' => 0, 'soon' => 0, 'future' => 0];
        $docAlerts = [];
        $pending = ['count' => 0, 'amount' => 0];
        $totalConts = (int) $contByVeh->sum();   // toàn đội (kể cả xe không có phiếu chi trong kỳ)

        foreach ($vehicles as $v) {
            $kind  = $v->kind === 'asset' ? 'asset' : 'vehicle';
            $info  = is_array($v->info) ? $v->info : [];
            // Tên phụ: tài sản = tên tài sản; xe = nhãn hiệu. Nhóm: loại tài sản / loại xe (MBF, Ngoài).
            $name  = $kind === 'asset' ? trim((string) ($info['name'] ?? '')) : trim((string) ($info['brand'] ?? ''));
            $group = $kind === 'asset' ? trim((string) ($info['category'] ?? '')) : trim((string) ($v->type ?? ''));
            $hashid = Hashid::encode($v->id);

            $costNormal = 0; $costAlloc = 0; $deprec = 0.0; $prevTotal = 0.0;
            $costItems = []; $allocItems = []; $deprecItems = [];
            $vOrig = 0.0; $vRemain = 0.0;

            // Rót 1 khoản vào ô tháng (ngoài cửa sổ → bỏ) + cộng dồn kỳ trước của xe.
            $bucket = function (int $idx, string $k, float|int $amt) use (&$buckets, &$prevTotal, $bFrom, $nB, $inPrev) {
                $b = $idx - $bFrom;
                if ($b < 0 || $b >= $nB) return;
                $buckets[$b][$k] += $amt;
                if ($inPrev($idx)) $prevTotal += $amt;
            };
            $addItem = function (string $rawName, int $amt, bool $material) use (&$byItem) {
                $label = trim($rawName) ?: '(chi phí)';
                $key = mb_strtolower($label);
                $byItem[$key] ??= ['label' => $label, 'amount' => 0, 'count' => 0, 'material' => false];
                $byItem[$key]['amount'] += $amt;
                $byItem[$key]['count']++;
                if ($material) $byItem[$key]['material'] = true;
            };
            $addSup = function (?string $sup, int $amt) use (&$bySupplier) {
                $s = trim((string) $sup);
                if ($s === '') return;
                $bySupplier[$s] = ($bySupplier[$s] ?? 0) + $amt;
            };

            foreach ($v->vehicleCosts as $c) {
                $amt = (int) round((float) $c->amount);
                // Phiếu chờ xử lý (chưa duyệt hoặc chưa chi) — đếm toàn bộ, không theo kỳ.
                if (! $c->approved || ! $c->paid) { $pending['count']++; $pending['amount'] += $amt; }

                if ($c->alloc && (int) $c->alloc_months > 0 && $c->spend_date) {
                    // PHÂN BỔ: rải đều theo THÁNG kể từ tháng Ngày chi
                    $m  = (int) $c->alloc_months;
                    $sd = Carbon::parse($c->spend_date);
                    $sIdx = $this->monthIdx($sd);
                    $per = (int) round($amt / $m);
                    for ($i = max($sIdx, $bFrom), $hiB = min($sIdx + $m - 1, $capIdx); $i <= $hiB; $i++) $bucket($i, 'costAlloc', $per);
                    $lo = max($sIdx, $fromIdx);
                    $hi = min($sIdx + $m - 1, $capIdx);
                    $inMonths = max(0, $hi - $lo + 1);
                    if ($inMonths <= 0) continue;
                    $sum = $per * $inMonths;
                    $costAlloc += $sum;
                    $allocItems[] = [
                        'name' => $c->name ?: '(chi phí)', 'invoiceNo' => $c->invoice_no ?? '',
                        'amount' => $amt, 'months' => $m, 'perMonth' => $per,
                        'monthsInPeriod' => $inMonths, 'inPeriod' => $sum,
                        'spendDate' => $this->outDate($c->spend_date),
                    ];
                    $addItem((string) $c->name, $sum, (bool) $c->material);
                    $addSup($c->supplier, $sum);
                    $split[$c->material ? 'material' : 'service'] += $sum;
                    continue;
                }
                // THƯỜNG: tính theo Ngày chi rơi trong kỳ
                if (! $c->spend_date) continue;
                $sd = Carbon::parse($c->spend_date)->startOfDay();
                $bucket($this->monthIdx($sd), 'costNormal', $amt);
                if ($sd->lt($pStart) || $sd->gte($pEndEx)) continue;
                $costNormal += $amt;
                $key = $c->name ?: '(chi phí)';
                if (! isset($costItems[$key])) $costItems[$key] = ['name' => $key, 'amount' => 0, 'count' => 0, 'material' => false];
                $costItems[$key]['amount'] += $amt;
                $costItems[$key]['count']++;
                if ($c->material) $costItems[$key]['material'] = true;
                $addItem((string) $c->name, $amt, (bool) $c->material);
                $addSup($c->supplier, $amt);
                $split[$c->material ? 'material' : 'service'] += $amt;
            }

            foreach ($v->vehicleDepreciations as $d) {
                $o = (float) $d->orig_price; $m = (int) $d->months;
                if ($o <= 0 || $m <= 0 || ! $d->start_date) continue;
                $ds = Carbon::parse($d->start_date)->startOfDay();
                $perDay  = $o / (30 * $m);
                $totalDays = 30 * $m;
                $dEndEx  = $ds->copy()->addDays($totalDays);               // hết kỳ khấu hao (exclusive)

                // Xu hướng theo tháng: giao [kỳ KH] ∩ [tháng] ∩ [đến hôm nay] — cộng theo NGÀY như công thức kỳ.
                $loI = max($bFrom, $this->monthIdx($ds));
                $hiI = min($toIdx, $nowIdx, $this->monthIdx($dEndEx->copy()->subDay()));
                for ($i = $loI; $i <= $hiI; $i++) {
                    $ms = $mStart($i); $me = $ms->copy()->addMonth()->min($today);
                    $a = $ds->gt($ms) ? $ds : $ms; $b = $dEndEx->lt($me) ? $dEndEx : $me;
                    if ($a->lt($b)) $bucket($i, 'deprec', $perDay * $a->diffInDays($b));
                }

                // Kỳ báo cáo: giao [kỳ khấu hao] ∩ [kỳ báo cáo] ∩ [đến hôm nay]
                $from = $ds->gt($pStart) ? $ds->copy() : $pStart->copy();
                $to   = $dEndEx->lt($capEnd) ? $dEndEx->copy() : $capEnd->copy();
                $days = $from->lt($to) ? $from->diffInDays($to) : 0;
                if ($days > 0) {
                    $amt = $perDay * $days;
                    $deprec += $amt;
                    $deprecItems[] = [
                        'name' => $d->name ?: '(khấu hao)', 'origPrice' => (int) round($o), 'months' => $m,
                        'perDay' => (int) round($perDay), 'daysInPeriod' => $days, 'inPeriod' => (int) round($amt),
                        'startDate' => $this->outDate($d->start_date),
                    ];
                }

                // SỔ TÀI SẢN — tính đến HÔM NAY (độc lập kỳ): đã dùng bao nhiêu ngày, lũy kế, còn lại, hết KH khi nào.
                $used = $ds->lte($today) ? min($totalDays, $ds->diffInDays($today)) : 0;
                $accrued = $perDay * $used;
                $remain = max(0.0, $o - $accrued);
                $status = $used >= $totalDays ? 'done' : ($used === 0 ? 'future' : 'active');
                $remainMonths = (int) ceil(($totalDays - $used) / 30);
                $soon = $status === 'active' && $remainMonths <= 3;   // sắp hết khấu hao (≤ 3 tháng)
                $register[] = [
                    'id' => $v->id, 'hashid' => $hashid, 'plate' => $v->plate, 'name' => $name, 'kind' => $kind, 'group' => $group,
                    'item' => $d->name ?: '', 'origPrice' => (int) round($o), 'months' => $m,
                    'startDate' => $ds->format('Y-m-d'), 'endDate' => $dEndEx->copy()->subDay()->format('Y-m-d'),
                    'usedDays' => $used, 'pct' => round($used * 100 / $totalDays, 1),
                    'accrued' => (int) round($accrued), 'remain' => (int) round($remain), 'monthly' => (int) round($o / $m),
                    'status' => $status, 'remainMonths' => max(0, $remainMonths), 'soon' => $soon,
                ];
                $regTot['orig'] += $o; $regTot['accrued'] += $accrued; $regTot['remain'] += $remain;
                if ($status === 'active') $regTot['monthly'] += $o / $m;
                $regTot[$status]++;
                if ($soon) $regTot['soon']++;
                $vOrig += $o; $vRemain += $remain;
            }

            // Hạn giấy tờ trong hồ sơ (info JSON) — sắp hết (≤ warnDays) hoặc đã quá hạn.
            $dues = $kind === 'asset'
                ? ['warrantyDue' => 'Bảo hành', 'inspectionDue' => 'Kiểm định']
                : ['registrationDue' => 'Đăng kiểm', 'insuranceDue' => 'Bảo hiểm'];
            foreach ($dues as $k => $label) {
                $dv = trim((string) ($info[$k] ?? ''));
                if ($dv === '') continue;
                try { $dd = Carbon::parse($dv)->startOfDay(); } catch (\Throwable) { continue; }
                $days = (int) round(($dd->getTimestamp() - $today->getTimestamp()) / 86400);
                if ($days > $warnDays) continue;
                $docAlerts[] = ['id' => $v->id, 'hashid' => $hashid, 'plate' => $v->plate, 'name' => $name, 'kind' => $kind,
                    'type' => $label, 'dueDate' => $dd->format('Y-m-d'), 'days' => $days, 'status' => $days < 0 ? 'expired' : 'soon'];
            }

            $deprecI = (int) round($deprec);
            $total = $costNormal + $costAlloc + $deprecI;
            if ($total === 0 && ! $costItems && ! $allocItems && ! $deprecItems) continue;   // xe không phát sinh → bỏ

            usort($allocItems, fn ($a, $b) => $b['inPeriod'] <=> $a['inPeriod']);
            usort($deprecItems, fn ($a, $b) => $b['inPeriod'] <=> $a['inPeriod']);
            $ci = array_values($costItems);
            usort($ci, fn ($a, $b) => $b['amount'] <=> $a['amount']);

            $conts = (int) ($contByVeh[$v->id] ?? 0);
            $split[$kind] += $total;
            $rows[] = [
                'id' => $v->id, 'hashid' => $hashid,
                'plate' => $v->plate, 'name' => $name, 'group' => $group, 'kind' => $kind,
                'costNormal' => $costNormal, 'costAlloc' => $costAlloc, 'deprec' => $deprecI, 'total' => $total,
                'prevTotal' => (int) round($prevTotal),
                'conts' => $conts, 'perCont' => $conts ? (int) round($total / $conts) : 0,
                'origPrice' => (int) round($vOrig), 'nbv' => (int) round($vRemain),
                'costItems' => $ci, 'allocItems' => $allocItems, 'deprecItems' => $deprecItems,
            ];
        }

        usort($rows, fn ($a, $b) => $b['total'] <=> $a['total']);
        $sum = fn (string $k) => array_sum(array_column($rows, $k));

        // Kỳ trước + xu hướng theo tháng (từ cùng 1 bộ ô tháng).
        $prev = ['costNormal' => 0, 'costAlloc' => 0, 'deprec' => 0.0];
        $trend = [];
        for ($i = $bFrom; $i <= $toIdx; $i++) {
            $b = $buckets[$i - $bFrom];
            if ($inPrev($i)) { $prev['costNormal'] += $b['costNormal']; $prev['costAlloc'] += $b['costAlloc']; $prev['deprec'] += $b['deprec']; }
            if ($i >= $trendFromIdx) {
                $dep = (int) round($b['deprec']);
                $trend[] = ['ym' => $this->idxToYm($i), 'label' => sprintf('%02d/%04d', $i % 12 + 1, intdiv($i, 12)),
                    'costNormal' => $b['costNormal'], 'costAlloc' => $b['costAlloc'], 'deprec' => $dep,
                    'total' => $b['costNormal'] + $b['costAlloc'] + $dep,
                    'inPeriod' => $i >= $fromIdx && $i <= $toIdx, 'future' => $i > $nowIdx];
            }
        }
        $prevDep = (int) round($prev['deprec']);

        $items = array_values($byItem);
        usort($items, fn ($a, $b) => $b['amount'] <=> $a['amount']);
        arsort($bySupplier);
        $suppliers = [];
        foreach ($bySupplier as $s => $amt) $suppliers[] = ['label' => $s, 'amount' => $amt];

        usort($register, fn ($a, $b) => strcmp($a['kind'], $b['kind']) ?: strcmp($a['plate'], $b['plate']));
        usort($docAlerts, fn ($a, $b) => $a['days'] <=> $b['days']);

        return [
            'from' => $this->idxToYm($fromIdx),
            'to'   => $this->idxToYm($toIdx),
            'months' => $months,
            'rows' => $rows,
            'totals' => [
                'costNormal' => $sum('costNormal'), 'costAlloc' => $sum('costAlloc'),
                'deprec' => $sum('deprec'), 'total' => $sum('total'), 'vehicles' => count($rows),
            ],
            'conts' => $totalConts,
            'prev' => [
                'from' => $this->idxToYm($prevFromIdx), 'to' => $this->idxToYm($fromIdx - 1),
                'costNormal' => $prev['costNormal'], 'costAlloc' => $prev['costAlloc'], 'deprec' => $prevDep,
                'total' => $prev['costNormal'] + $prev['costAlloc'] + $prevDep,
            ],
            'trend' => $trend,
            'byItem' => $items,
            'bySupplier' => array_slice($suppliers, 0, 10),
            'split' => $split,
            'register' => $register,
            'registerTotals' => [
                'orig' => (int) round($regTot['orig']), 'accrued' => (int) round($regTot['accrued']),
                'remain' => (int) round($regTot['remain']), 'monthly' => (int) round($regTot['monthly']),
                'active' => $regTot['active'], 'done' => $regTot['done'], 'soon' => $regTot['soon'], 'future' => $regTot['future'],
                'count' => count($register),
            ],
            'alerts' => [
                'docs' => $docAlerts,
                // kèm hashid để deep-link hồ sơ xe (#<hashid>/cost) như các mục khác
                'recurring' => array_map(fn ($r) => $r + ['hashid' => Hashid::encode((int) $r['vehicleId'])], $this->expiringVehicleCosts()),
                'pending' => $pending,
            ],
            'warnDays' => $warnDays,
        ];
    }
}
