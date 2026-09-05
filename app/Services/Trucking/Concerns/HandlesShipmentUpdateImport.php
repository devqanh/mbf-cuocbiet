<?php

namespace App\Services\Trucking\Concerns;

use App\Models\TruckingContType;
use App\Models\TruckingExtVendor;
use App\Models\TruckingShipment;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * IMPORT CẬP NHẬT LÔ HÀNG — sửa hàng loạt lô ĐÃ CÓ bằng file Excel (không tạo, không xóa lô).
 * Khác "Import lô" (tạo mới từ bảng kế hoạch) và "Import CSHT" (ghi chi phí theo cont).
 *
 * Nguyên tắc an toàn (user chốt 2026-07-25):
 *  - Khóa khớp: ID lô ưu tiên; thiếu ID mới khớp Số cont và cont phải DUY NHẤT (dữ liệu thật
 *    có cont quay vòng dùng lại) — nhập nhằng là lỗi, chặn cả file.
 *  - Ô TRỐNG = giữ nguyên giá trị cũ. Muốn xóa phải gõ '--' (chống dán thiếu cột làm mất data).
 *  - ALL-OR-NOTHING: 1 dòng lỗi là không ghi gì.
 *  - Ghi qua saveShipment(..., $only) nên chỉ đụng ĐÚNG ô đã đổi và hưởng nguyên chuẩn hóa,
 *    suy is_barge/barge_cont, recompute derived như popup sửa lô.
 */
trait HandlesShipmentUpdateImport
{
    /** Ký hiệu XÓA giá trị (ô trống chỉ có nghĩa "giữ nguyên"). */
    private const CLEAR_TOKEN = '--';

    /**
     * Field được phép cập nhật => [nhãn hiển thị, kiểu kiểm tra].
     * Cố ý KHÔNG có: khách hàng / số lượng / chi phí / doanh thu (đổi là lệch bảng kê đã chốt,
     * và chi phí đã có luồng riêng).
     */
    private function updatableShipmentFields(): array
    {
        return [
            'gioXeDen'     => ['Giờ xe đến', 'datetime'],
            // Giờ xe (đầu kéo) ra — CHỈ có hiệu lực cho Free time khi lô ở kiểu "không kéo cont ra".
            'gioXeRaXe'    => ['Giờ xe ra (xe)', 'datetime'],
            'gioDenDuKien' => ['Giờ đến dự kiến', 'datetime'],
            'io'           => ['Nhập/Xuất', 'io'],
            // Biển số phải khớp danh mục Xe: recompute map vehicle_id bằng so khớp CHUỖI CHÍNH XÁC
            // (TruckingVehicle::where('plate', …)) — gõ sai là lô mất liên kết xe, báo cáo hụt.
            'bksVao'       => ['Biển số vào', 'plate'],
            'bksRa'        => ['Biển số ra', 'plate'],
            'contNo'       => ['Số cont', 'text'],
            'contType'     => ['Loại cont', 'contType'],
            'inv'          => ['Invoice', 'text'],
            'from'         => ['Nơi lấy', 'location'],
            'to'           => ['Nơi hạ', 'location'],
            'kho'          => ['Kho', 'kho'],
            'bargeDrop'    => ['Nơi hạ sà lan', 'bargeDrop'],
            'extVendor'    => ['Nhà xe ngoài', 'extVendor'],
            'infoNote'         => ['Ghi chú', 'text'],
            // raOtherContNo xử lý riêng qua collectRaOtherChange (không map 1-1 với cột DB).
        ];
        // Ngoài danh sách trên còn 2 nhóm xử lý RIÊNG (không map 1-1 với 1 cột DB):
        //  - Tờ khai: 2 cột song song SỐ TỜ KHAI / PHÍ TỜ KHAI → cột JSON declarations.
        //  - Cước xe ngoài: ghi vào DÒNG CHI PHÍ src=extTruck, ext_fee tự chốt lại.
    }

    /** Cột DB tương ứng để đọc giá trị CŨ (dựng diff). */
    private function updatableFieldColumns(): array
    {
        return [
            'gioXeDen' => 'gio_xe_den', 'gioXeRaXe' => 'gio_xe_ra_xe',
            'gioDenDuKien' => 'gio_den_du_kien', 'io' => 'io',
            'bksVao' => 'bks_vao', 'bksRa' => 'bks_ra', 'contNo' => 'cont_no', 'contType' => 'cont_type',
            'inv' => 'inv', 'from' => 'from_loc', 'to' => 'to_loc',
            'kho' => 'kho', 'bargeDrop' => 'barge_drop',
            'extVendor' => 'ext_vendor', 'infoNote' => 'info_note',
            // raOtherContNo không map 1-1 với cột DB — xử lý riêng trong applyUpdate
        ];
    }

    /** Field ảnh hưởng SỐ TIỀN của bảng kê (đổi khi lô đã lên bảng kê → cảnh báo mạnh). */
    private const MONEY_FIELDS = ['gioXeRa', 'from', 'to', 'kho', 'contType', 'bargeDrop', 'declarations'];

    /** Dry-run: kiểm tra + dựng diff, KHÔNG ghi DB. */
    public function validateShipmentUpdate(string $sheet, array $rows): array
    {
        return $this->analyzeShipmentUpdate($sheet, $rows);
    }

    /** Import cập nhật — ALL-OR-NOTHING; chỉ ghi những ô thực sự đổi. */
    public function importShipmentUpdate(string $sheet, array $rows): array
    {
        $res = $this->analyzeShipmentUpdate($sheet, $rows);
        if (! $res['valid']) return $res + ['updated' => 0, 'cells' => 0];

        $plans = $res['_plans'];
        unset($res['_plans']);
        if (! $plans) return $res + ['updated' => 0, 'cells' => 0];

        // Nhật ký giá trị CŨ trước khi ghi đè — dự án chưa có bảng audit, đây là đường truy lại duy nhất.
        $this->logShipmentUpdateSnapshot($sheet, $plans);

        $updated = 0; $cells = 0;
        DB::transaction(function () use ($plans, $sheet, &$updated, &$cells) {
            foreach ($plans as $p) {
                /** @var TruckingShipment $s */
                $s = $p['ship'];
                // Các field xử lý RIÊNG (không đi qua saveShipment):
                $extFee   = $p['patch']['extFee'] ?? null;
                $raContNo = $p['patch']['raOtherContNo'] ?? null;
                $raMode   = $p['patch']['raMode'] ?? null;
                $only = array_values(array_diff(array_keys($p['patch']), ['extFee', 'raOtherContNo', 'raMode']));
                $this->saveShipment($p['patch'], $sheet, $s, $only);
                if ($extFee !== null) $this->applyExtTruckFee($s, (int) $extFee);
                // Kiểu ra + cont ra: gán ra_mode trước, applyRaOtherContNo gán cont sau.
                if ($raMode !== null) { $s->ra_mode = $raMode; if ($raMode !== 'other') $s->ra_other_id = null; $s->save(); }
                if ($raContNo !== null) $this->applyRaOtherContNo($s, $raContNo);
                $updated++;
                $cells += count($p['cells']);
            }
        });

        return $res + ['updated' => $updated, 'cells' => $cells];
    }

    /**
     * Gán liên kết "cont khác ra" theo số cont: tìm lô cùng booking có cont_no khớp.
     * $contNo = null → xóa liên kết (về ra_mode=self). Chuỗi → tìm sibling.
     */
    private function applyRaOtherContNo(TruckingShipment $s, ?string $contNo): void
    {
        if ($contNo === null || trim($contNo) === '') {
            // Xóa liên kết (user gõ --)
            $s->ra_mode = 'self';
            $s->ra_other_id = null;
            $s->save();
            return;
        }
        $contNo = trim($contNo);
        $sibling = TruckingShipment::where('sheet', $s->sheet)
            ->where('booking', $s->booking)
            ->where('id', '!=', $s->id)
            ->whereRaw('LOWER(cont_no) = ?', [mb_strtolower($contNo)])
            ->first();
        if ($sibling) {
            $s->ra_mode = 'other';
            $s->ra_other_id = $sibling->id;
            $s->save();
        }
    }

    /**
     * Lõi dùng chung cho dry-run và import: khớp lô → dựng patch → so sánh → lỗi/cảnh báo.
     * '_plans' (chỉ dùng nội bộ) = [['ship'=>lô, 'patch'=>[field=>giá trị], 'cells'=>[diff]]].
     */
    private function analyzeShipmentUpdate(string $sheet, array $rows): array
    {
        $fields  = $this->updatableShipmentFields();
        $columns = $this->updatableFieldColumns();
        $targets = $this->resolveUpdateTargets($sheet, $rows);   // line => lô | null
        $inStatement = $this->shipmentsInStatements(collect($targets)->filter()->pluck('id')->all());

        $errors = []; $changes = []; $warnings = []; $plans = []; $noChange = 0;
        $seen = [];   // shipment_id => line (chặn 2 dòng cùng sửa 1 lô)

        foreach ($rows as $i => $row) {
            // Dòng báo lỗi = dòng THẬT trong file Excel (client gửi kèm). Đếm theo thứ tự phần tử
            // sẽ lệch vì payload đã bỏ dòng trắng — và luồng tờ khai còn gộp nhiều dòng theo lô.
            $line = (int) ($row['line'] ?? 0) ?: $i + 1;
            $reasons = [];
            $s = $targets[$i] ?? null;
            if (! $s) {
                $errors[] = $this->updateError($line, $row, [$this->targetReason($sheet, $rows, $i)]);
                continue;
            }
            if (isset($seen[$s->id])) {
                $errors[] = $this->updateError($line, $row, ["Lô #{$s->id} đã được sửa ở dòng {$seen[$s->id]} — 2 dòng cùng sửa 1 lô"]);
                continue;
            }
            $seen[$s->id] = $line;

            // ----- dựng patch từ các ô CÓ nội dung -----
            $patch = []; $cells = [];
            foreach (($row['values'] ?? []) as $f => $raw) {
                if (! isset($fields[$f])) continue;                       // cột lạ → bỏ qua
                if ($f === 'contNo' && trim((string) ($row['id'] ?? '')) === '') continue;   // cont là KHÓA khi không có ID
                [$label, $type] = $fields[$f];
                $raw = is_string($raw) ? trim($raw) : $raw;
                if ($raw === '' || $raw === null) continue;               // ô trống = giữ nguyên

                // Ô GIỮ NGUYÊN giá trị đang lưu (xuất → nhập lại) thì bỏ qua LUÔN, không kiểm tra:
                // dữ liệu cũ có thể không còn hợp lệ theo danh mục hiện tại (vd loại cont 20DC/40RHC
                // đang dùng nhưng danh mục thiếu) — chặn ở đây là chặn nhầm việc người dùng không sửa.
                $old = $this->updateOldValue($s, $columns[$f]);
                if ((string) $raw === $old) continue;

                $rawShow = trim((string) (($row['raws'][$f] ?? '') ?: $raw));
                $val = $this->normalizeUpdateValue($f, $type, $raw, $rawShow, $reasons, $label);
                if ($val === false) continue;                              // đã ghi lỗi

                $new = (string) ($val ?? '');
                if ($old === $new) continue;                               // chuẩn hóa xong vẫn y cũ → không ghi
                $patch[$f] = $val;
                $cells[] = ['field' => $f, 'label' => $label, 'old' => $old, 'new' => $new];
            }

            // Nhóm không map 1-1 với cột DB, xử lý sau vòng lặp trên.
            $this->collectDeclarationChange($s, $row, $patch, $cells, $reasons);
            $this->collectExtFeeChange($s, $row, $patch, $cells, $reasons);
            $this->collectRaOtherChange($s, $row, $patch, $cells, $reasons);

            if ($reasons) { $errors[] = $this->updateError($line, $row, $reasons, $s); continue; }
            if (! $cells) { $noChange++; continue; }

            $changes[] = ['line' => $line, 'id' => $s->id, 'contNo' => $s->cont_no ?? '', 'booking' => $s->booking ?? '', 'cells' => $cells];
            $plans[] = ['ship' => $s, 'patch' => $patch, 'cells' => $cells];

            // ----- cảnh báo (không chặn) -----
            if (isset($inStatement[$s->id])) {
                $money = array_intersect(array_column($cells, 'field'), self::MONEY_FIELDS);
                $warnings[] = ['line' => $line, 'id' => $s->id, 'text' => 'Lô đã nằm trong bảng kê ' . $inStatement[$s->id]
                    . ($money ? ' — sửa ' . implode(', ', array_map(fn ($f) => $fields[$f][0] ?? 'Tờ khai', $money)) . ' làm lệch số đã chốt, vào Bảng kê bấm Tính lại' : '')];
            }
            if (isset($patch['contNo']) && $this->contNoTakenBy($sheet, $patch['contNo'], $s->id)) {
                $warnings[] = ['line' => $line, 'id' => $s->id, 'text' => "Số cont “{$patch['contNo']}” đang trùng với lô khác"];
            }
            // Giờ ra điền vào ô KHÔNG có hiệu lực cho Free time (do kiểu giờ ra của lô) → phải nói rõ,
            // nếu không người dùng tưởng đã cập nhật xong mà Free time không hề đổi.
            $raMode = $s->ra_mode ?? 'self';
            if (isset($patch['gioXeRa']) && $raMode !== 'self') {
                if ($raMode === 'other') {
                    // Chỉ ĐÍCH DANH lô phải sửa: free time của lô này follow giờ ra của cont kia,
                    // mà cont kia cũng là 1 lô có ID → sửa ngay ở dòng của nó trong file này.
                    $o = $s->raOther;
                    $who = $o ? ('lô #' . $o->id . ($o->cont_no ? ' (cont ' . $o->cont_no . ')' : '')) : 'cont khác (chưa chọn cont nào)';
                    $warnings[] = ['line' => $line, 'id' => $s->id, 'text' => 'Lô ở kiểu “Cắt móc — cont khác ra”: Free time follow ' . $who
                        . ' — Giờ xe ra vừa nhập chỉ là giờ ra riêng của cont này, KHÔNG đổi Free time. Muốn đổi Free time thì sửa GIỜ XE RA ở dòng của ' . $who];
                } else {
                    $warnings[] = ['line' => $line, 'id' => $s->id,
                        'text' => 'Lô ở kiểu “Cắt móc — không kéo ra” — Free time lấy cột GIỜ XE RA (XE), không lấy ô này'];
                }
            }
            if (isset($patch['gioXeRaXe']) && $raMode !== 'none') {
                $warnings[] = ['line' => $line, 'id' => $s->id,
                    'text' => 'Giờ xe ra (xe) chỉ có tác dụng khi lô ở kiểu “Cắt móc — không kéo ra” — lô này đang ở kiểu khác nên Free time không đổi'];
            }
            // Giờ ra sớm hơn giờ đến: CẢNH BÁO, không chặn — 4% lô thật đang vậy, chủ yếu do
            // ra_mode='other' (giờ ra hiệu lực nằm ở cont khác). Chỉ nhắc khi người dùng động vào 2 ô này.
            if (isset($patch['gioXeDen']) || isset($patch['gioXeRa'])) {
                $den = $patch['gioXeDen'] ?? $this->outDateTime($s->gio_xe_den);
                $ra  = $patch['gioXeRa']  ?? $this->outDateTime($s->gio_xe_ra);
                if ($den && $ra && $ra < $den) {
                    $warnings[] = ['line' => $line, 'id' => $s->id, 'text' => 'Giờ xe ra (' . $this->dtVn($ra) . ') sớm hơn Giờ xe đến (' . $this->dtVn($den) . ')'
                        . (($s->ra_mode ?? 'self') !== 'self' ? ' — lô này lấy giờ ra từ cont khác nên có thể bình thường' : ' — kiểm tra lại nếu nhập nhầm')];
                }
            }
        }

        return [
            'valid'    => empty($errors),
            'total'    => count($rows),
            'errors'   => $errors,
            'changes'  => $changes,
            'warnings' => $warnings,
            'noChange' => $noChange,
            '_plans'   => $plans,
        ];
    }

    /**
     * Ghi cước thuê xe ngoài = 1 dòng chi phí src=extTruck (tạo / sửa / xóa), KHÔNG đụng khoản khác.
     * ext_fee tự chốt lại qua recompute nên Bảng kê xe ngoài query được ngay.
     */
    private function applyExtTruckFee(TruckingShipment $s, int $fee): void
    {
        $line = $s->costLines()->where('src', 'extTruck')->orderBy('sort')->first();
        if ($fee <= 0) {
            if ($line) $line->delete();
        } elseif ($line) {
            $line->fill(['amount' => $fee])->save();
        } else {
            $item = \App\Models\TruckingCostItem::where('name', 'Cước xe ngoài')->first();
            $s->costLines()->create([
                'item'         => 'Cước xe ngoài',
                'amount'       => $fee,
                'src'          => 'extTruck',
                'payer'        => 'Xe ngoài',
                'vat'          => $item?->vat ?? 0,
                'color'        => $item?->color,
                'cost_item_id' => $item?->id,
                'billable'     => false,
                'sort'         => (int) $s->costLines()->max('sort') + 1,
            ]);
        }
        $s->unsetRelation('costLines');
        $this->recomputeShipmentDerived($s, ['cost']);
    }

    /**
     * TỜ KHAI — luồng RIÊNG ("Cập nhật tờ khai"): mỗi tờ khai 1 dòng Excel, frontend gom theo lô
     * thành values.declPairs = [{no, fee}] → cột JSON declarations. Mảng rỗng = xóa hết tờ khai.
     * File "Cập nhật lô" KHÔNG có cột tờ khai nên không bao giờ đụng vào đây.
     */
    private function collectDeclarationChange(TruckingShipment $s, array $row, array &$patch, array &$cells, array &$reasons): void
    {
        $vals = $row['values'] ?? [];
        $old  = $this->declListLabel((array) ($s->declarations ?? []));

        if (! array_key_exists('declPairs', $vals) || ! is_array($vals['declPairs'])) return;   // file lô hàng không đụng tờ khai

        $list = []; $seen = [];
        foreach ($vals['declPairs'] as $p) {
            $no = trim((string) ($p['no'] ?? ''));
            if ($no === '') continue;
            if (isset($seen[mb_strtolower($no)])) { $reasons[] = "Số tờ khai “{$no}” bị lặp ở 2 dòng của cùng lô"; return; }
            $seen[mb_strtolower($no)] = true;
            $list[] = ['no' => $no, 'fee' => (int) preg_replace('/[^\d]/', '', (string) ($p['fee'] ?? ''))];
        }

        $new = $this->declListLabel($list);
        if ($new === $old) return;

        $patch['declarations'] = $list;   // mảng rỗng = xóa hết tờ khai của lô
        $cells[] = ['field' => 'declarations', 'label' => 'Tờ khai', 'old' => $old ?: '(chưa có)', 'new' => $new];
    }

    /** "103456789012 (250.000đ), 103456789013" — chuỗi so sánh + hiển thị diff cho tờ khai. */
    private function declListLabel(array $list): string
    {
        return implode(', ', array_map(function ($d) {
            $fee = (int) round((float) ($d['fee'] ?? 0));
            return trim((string) ($d['no'] ?? '')) . ($fee > 0 ? ' (' . number_format($fee, 0, ',', '.') . 'đ)' : '');
        }, $list));
    }

    /**
     * CƯỚC XE NGOÀI — không phải cột: ext_fee được chốt từ DÒNG CHI PHÍ src=extTruck.
     * Nên cột này ghi vào đúng dòng đó (các khoản chi phí khác của lô không bị đụng).
     * Bắt buộc có Nhà xe ngoài (giống quy tắc lưu ở popup). '--' hoặc 0 = xóa dòng cước.
     */
    private function collectExtFeeChange(TruckingShipment $s, array $row, array &$patch, array &$cells, array &$reasons): void
    {
        $raw = $row['values']['extFee'] ?? null;
        if ($raw === null || trim((string) $raw) === '') return;

        $clear = trim((string) $raw) === self::CLEAR_TOKEN;
        $new   = $clear ? 0 : (int) preg_replace('/[^\d]/', '', (string) $raw);
        $old   = (int) round((float) $s->ext_fee);
        if ($new === $old) return;

        // Nhà xe ngoài: lấy giá trị SAU khi áp patch (file có thể vừa điền ở cột NHÀ XE NGOÀI).
        $vendor = trim((string) ($patch['extVendor'] ?? $s->ext_vendor ?? ''));
        if ($new > 0 && $vendor === '') {
            $reasons[] = 'Có Cước xe ngoài nhưng lô chưa có Nhà xe ngoài — điền cột NHÀ XE NGOÀI';
            return;
        }

        $patch['extFee'] = $new;
        $cells[] = ['field' => 'extFee', 'label' => 'Cước xe ngoài',
            'old' => $old > 0 ? number_format($old, 0, ',', '.') : '',
            'new' => $new > 0 ? number_format($new, 0, ',', '.') : ''];
    }

    /** Nhãn hiển thị cho ra_mode. */
    private const RA_MODE_LABELS = [
        'self'  => 'Không cắt móc',
        'none'  => 'Không kéo ra',
        'other' => 'Cont khác ra',
    ];

    /** Xử lý 2 cột KIỂU RA + SỐ CONT RA (CẮT MÓC). */
    private function collectRaOtherChange(TruckingShipment $s, array $row, array &$patch, array &$cells, array &$reasons): void
    {
        $oldMode = $s->ra_mode ?? 'self';
        $oldLabel = self::RA_MODE_LABELS[$oldMode] ?? $oldMode;

        // ---- Cột KIỂU RA ----
        $modeRaw = trim((string) ($row['values']['raMode'] ?? ''));
        $newMode = null;
        if ($modeRaw !== '') {
            $ml = mb_strtolower($modeRaw);
            if (str_contains($ml, 'khác') || str_contains($ml, 'other'))       $newMode = 'other';
            elseif (str_contains($ml, 'không kéo') || str_contains($ml, 'none') || str_contains($ml, 'tay không')) $newMode = 'none';
            elseif (str_contains($ml, 'không cắt') || str_contains($ml, 'self') || str_contains($ml, 'kéo ra'))   $newMode = 'self';
            else {
                $reasons[] = 'Kiểu ra "' . $modeRaw . '" không hợp lệ (nhận: Không cắt móc / Không kéo ra / Cont khác ra)';
                return;
            }
            if ($newMode !== $oldMode) {
                $patch['raMode'] = $newMode;
                $cells[] = ['field' => 'raMode', 'label' => 'Kiểu ra', 'old' => $oldLabel, 'new' => self::RA_MODE_LABELS[$newMode]];
            }
        }

        $effectiveMode = $newMode ?? $oldMode;

        // ---- Cột SỐ CONT RA ----
        $contRaw = trim((string) ($row['values']['raOtherContNo'] ?? ''));
        if ($contRaw === '' && $effectiveMode !== 'other') return;

        $oldContNo = ($oldMode === 'other' && $s->ra_other_id)
            ? (TruckingShipment::where('id', $s->ra_other_id)->value('cont_no') ?: '')
            : '';

        // Chuyển sang self/none → xóa liên kết nếu có
        if ($effectiveMode !== 'other') {
            if ($oldContNo !== '') {
                $patch['raOtherContNo'] = null;
                $cells[] = ['field' => 'raOtherContNo', 'label' => 'Cont ra (cắt móc)', 'old' => $oldContNo, 'new' => ''];
            }
            return;
        }

        // other: cần SỐ CONT RA
        if ($contRaw === '') return;   // giữ nguyên

        if ($contRaw === self::CLEAR_TOKEN) {
            if ($oldContNo === '') return;
            $patch['raOtherContNo'] = null;
            $cells[] = ['field' => 'raOtherContNo', 'label' => 'Cont ra (cắt móc)', 'old' => $oldContNo, 'new' => ''];
            return;
        }

        if (mb_strtolower($contRaw) === mb_strtolower($oldContNo)) return;

        // Cắt móc = xe kéo cont của lô KHÁC cùng booking ra. Điền chính cont của lô này là nhầm cột.
        if (mb_strtolower($contRaw) === mb_strtolower((string) $s->cont_no)) {
            $reasons[] = 'Số cont ra "' . $contRaw . '" là cont của CHÍNH lô này — cột này cần cont của lô KHÁC cùng booking. '
                . 'Xe kéo lại chính cont này thì để Kiểu ra = "Không cắt móc" và bỏ trống ô Số cont ra.';
            return;
        }

        $sibling = TruckingShipment::where('sheet', $s->sheet)
            ->where('booking', $s->booking)
            ->where('id', '!=', $s->id)
            ->whereRaw('LOWER(cont_no) = ?', [mb_strtolower($contRaw)])
            ->first();
        if (! $sibling) {
            $reasons[] = 'Số cont ra "' . $contRaw . '" không khớp lô nào cùng booking "' . $s->booking . '"';
            return;
        }

        $patch['raOtherContNo'] = $contRaw;
        $cells[] = ['field' => 'raOtherContNo', 'label' => 'Cont ra (cắt móc)', 'old' => $oldContNo, 'new' => $sibling->cont_no];
    }

    /** Chuẩn hóa + kiểm tra 1 ô. Trả giá trị đã chuẩn hóa (null = xóa), hoặc false nếu lỗi. */
    private function normalizeUpdateValue(string $field, string $type, $raw, string $rawShow, array &$reasons, string $label)
    {
        if (trim((string) $raw) === self::CLEAR_TOKEN) return null;   // '--' = xóa

        $v = trim((string) $raw);
        switch ($type) {
            case 'datetime':
                // Frontend gửi ISO 'Y-m-dTH:i'; rỗng mà ô có chữ = sai định dạng.
                if (! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $v)) {
                    $reasons[] = "{$label} “{$rawShow}” sai định dạng (cần dd/mm/yyyy HH:MM)";
                    return false;
                }
                return $v;

            case 'date':
                if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
                    $reasons[] = "{$label} “{$rawShow}” sai định dạng (cần dd/mm/yyyy)";
                    return false;
                }
                return $v;

            case 'io':
                $hit = $this->canonIo($v);
                if (! in_array($hit, ['Nhập', 'Xuất', 'Khác'], true)) {
                    $reasons[] = "{$label} “{$v}” không hợp lệ (chỉ nhận Nhập / Xuất / Khác)";
                    return false;
                }
                return $hit;

            case 'location':
                return $this->resolveLocationName($v, $reasons, $label);

            case 'kho':
                $wh = $this->warehouseCodeMap();
                $whName = $this->warehouseNameMap();
                $segs = $this->khoSegments($v);
                if (! $segs) { $reasons[] = "{$label} “{$v}” không đọc được"; return false; }
                $out = [];
                foreach ($segs as $seg) {
                    if (! isset($wh[mb_strtolower($seg)])) { $reasons[] = "Kho “{$seg}” chưa có trong danh mục Kho"; return false; }
                    $out[] = $whName[mb_strtolower($seg)] ?? $wh[mb_strtolower($seg)];
                }
                return implode(', ', $out);

            case 'bargeDrop':
                $name = $this->resolveBargeDropValue($v);
                if (! $name) { $reasons[] = $label . ' “' . $v . '” không khớp địa điểm nào có ký hiệu HPP hoặc LHP trong danh mục'; return false; }
                return $name;

            case 'contType':
                $hit = TruckingContType::whereRaw('LOWER(name) = ?', [mb_strtolower($v)])->value('name');
                if (! $hit) { $reasons[] = "{$label} “{$v}” chưa có trong danh mục — thêm ở Cài đặt → Loại cont rồi làm lại"; return false; }
                return $hit;

            case 'extVendor':
                $hit = TruckingExtVendor::whereRaw('LOWER(name) = ?', [mb_strtolower($v)])->value('name');
                if (! $hit) { $reasons[] = "{$label} “{$v}” chưa có trong danh mục — thêm ở Cài đặt → Đơn vị xe ngoài rồi làm lại"; return false; }
                return $hit;

            case 'plate':
                // Trả về ĐÚNG chuỗi biển số trong danh mục để vehicle_id luôn map được.
                $hit = $this->plateIndex()[mb_strtolower($v)] ?? null;
                if (! $hit) { $reasons[] = "{$label} “{$v}” chưa có trong danh mục Xe — thêm ở Quản lý xe rồi làm lại"; return false; }
                return $hit;

            default:
                return $v;
        }
    }

    /** ISO 'Y-m-dTH:i' / 'Y-m-d' → dd/mm/yyyy [HH:MM] cho thông báo người dùng đọc. */
    private function dtVn(string $iso): string
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/', $iso, $m)) return "{$m[3]}/{$m[2]}/{$m[1]} {$m[4]}";
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $iso, $m)) return "{$m[3]}/{$m[2]}/{$m[1]}";
        return $iso;
    }

    /** @var array<string,string>|null lower(biển số) => biển số chuẩn trong danh mục Xe. */
    private ?array $plateIndexCache = null;

    private function plateIndex(): array
    {
        return $this->plateIndexCache ??= \App\Models\TruckingVehicle::whereNotNull('plate')->where('plate', '!=', '')
            ->pluck('plate')->mapWithKeys(fn ($p) => [mb_strtolower(trim($p)) => trim($p)])->all();
    }

    /** Giá trị CŨ dạng chuỗi để so sánh/hiển thị diff (datetime về 'Y-m-dTH:i' như frontend gửi). */
    private function updateOldValue(TruckingShipment $s, string $col): string
    {
        $v = $s->{$col};
        if ($v === null) return '';
        if (in_array($col, ['gio_xe_den', 'gio_xe_ra', 'gio_xe_ra_xe', 'gio_den_du_kien'], true)) return (string) $this->outDateTime($v);
        if (in_array($col, ['cont_den', 'sail_date'], true)) return (string) $this->outDate($v);
        return trim((string) $v);
    }

    /**
     * Khớp từng dòng file với 1 lô: ID trước, không có ID mới dùng Số cont (phải duy nhất).
     * @return array<int,TruckingShipment|null> theo CHỈ SỐ dòng
     */
    private function resolveUpdateTargets(string $sheet, array $rows): array
    {
        $ids   = collect($rows)->map(fn ($r) => (int) trim((string) ($r['id'] ?? '')))->filter()->unique()->values();
        $conts = collect($rows)
            ->filter(fn ($r) => trim((string) ($r['id'] ?? '')) === '')
            ->map(fn ($r) => mb_strtoupper(trim((string) ($r['contNo'] ?? ''))))
            ->filter()->unique()->values();

        // raOther: lô "cont khác ra" trỏ tới — cần để chỉ đúng lô phải sửa giờ ra (xem cảnh báo bên dưới).
        $with = ['raOther:id,cont_no,booking'];
        $byId = $ids->isEmpty() ? collect() : TruckingShipment::ofSheet($sheet)->with($with)->whereIn('id', $ids->all())->get()->keyBy('id');
        $byCont = $conts->isEmpty() ? collect() : TruckingShipment::ofSheet($sheet)->with($with)
            ->whereIn(DB::raw('UPPER(cont_no)'), $conts->all())->get()
            ->groupBy(fn ($s) => mb_strtoupper(trim((string) $s->cont_no)));

        $out = [];
        foreach ($rows as $i => $r) {
            $id = (int) trim((string) ($r['id'] ?? ''));
            if ($id > 0) { $out[$i] = $byId->get($id); continue; }
            $cont = mb_strtoupper(trim((string) ($r['contNo'] ?? '')));
            $g = $cont === '' ? collect() : ($byCont[$cont] ?? collect());
            $out[$i] = $g->count() === 1 ? $g->first() : null;
        }
        return $out;
    }

    /** Lý do không khớp được lô (chỉ gọi khi target null) — nói rõ để người dùng sửa file. */
    private function targetReason(string $sheet, array $rows, int $i): string
    {
        $row = $rows[$i];
        $id = trim((string) ($row['id'] ?? ''));
        if ($id !== '') return "Không có lô ID {$id} trong danh sách " . mb_strtoupper($sheet);
        $cont = trim((string) ($row['contNo'] ?? ''));
        if ($cont === '') return 'Thiếu cả ID lô lẫn Số cont — không xác định được lô nào';
        $n = TruckingShipment::ofSheet($sheet)->whereRaw('UPPER(cont_no) = ?', [mb_strtoupper($cont)])->count();
        if ($n === 0) return "Số cont “{$cont}” không có trong danh sách lô";
        return "Số cont “{$cont}” trùng ở {$n} lô — thêm cột ID để chỉ đúng lô";
    }

    /** [shipment_id => "#12 (Khách · kỳ)"] cho các lô đã nằm trong bảng kê khách. */
    private function shipmentsInStatements(array $ids): array
    {
        if (! $ids) return [];
        $rows = DB::table('trucking_statement_lines as l')
            ->join('trucking_statements as st', 'st.id', '=', 'l.statement_id')
            ->whereIn('l.shipment_id', $ids)
            ->get(['l.shipment_id', 'st.id', 'st.no', 'st.customer_name', 'st.period_from', 'st.period_to']);

        $out = [];
        foreach ($rows as $r) {
            $label = '#' . ($r->no ?: $r->id) . ($r->customer_name ? ' · ' . $r->customer_name : '')
                   . ($r->period_from ? ' · ' . substr((string) $r->period_from, 0, 10) . '→' . substr((string) $r->period_to, 0, 10) : '');
            $out[$r->shipment_id] = $label;
        }
        return $out;
    }

    /** Số cont mới có đang thuộc lô khác không (cảnh báo, không chặn — dữ liệu thật có cont dùng lại). */
    private function contNoTakenBy(string $sheet, ?string $contNo, int $selfId): bool
    {
        $c = trim((string) $contNo);
        if ($c === '') return false;
        return TruckingShipment::ofSheet($sheet)->whereRaw('UPPER(cont_no) = ?', [mb_strtoupper($c)])
            ->where('id', '!=', $selfId)->exists();
    }

    /** 1 dòng lỗi (shape giống các import khác để frontend dùng chung cách hiển thị). */
    private function updateError(int $line, array $row, array $reasons, ?TruckingShipment $s = null): array
    {
        return [
            'line'    => $line,
            'id'      => (string) ($row['id'] ?? ''),
            'cont'    => (string) ($row['contNo'] ?? ($s->cont_no ?? '')),
            'reasons' => array_values(array_filter($reasons)),
        ];
    }

    /** Ghi giá trị CŨ ra file JSON để truy lại/khôi phục thủ công khi import nhầm. */
    private function logShipmentUpdateSnapshot(string $sheet, array $plans): void
    {
        $payload = [
            'at'      => now()->toDateTimeString(),
            'user'    => auth()->user()?->name ?? auth()->id(),
            'sheet'   => $sheet,
            'changes' => array_map(fn ($p) => [
                'id'    => $p['ship']->id,
                'cont'  => $p['ship']->cont_no,
                'cells' => $p['cells'],
            ], $plans),
        ];
        try {
            Storage::disk('local')->put('imports/shipment-update-' . now()->format('Ymd-His') . '.json',
                json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        } catch (\Throwable $e) {
            // Không chặn import vì lỗi ghi log — nhưng phải để lại dấu vết.
            Log::warning('Không ghi được nhật ký import cập nhật lô: ' . $e->getMessage());
        }
    }
}
