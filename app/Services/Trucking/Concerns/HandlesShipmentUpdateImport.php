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
            'gioDenDuKien' => ['Giờ đến dự kiến', 'datetime'],
            'io'           => ['Nhập/Xuất', 'io'],
            // Biển số phải khớp danh mục Xe: recompute map vehicle_id bằng so khớp CHUỖI CHÍNH XÁC
            // (TruckingVehicle::where('plate', …)) — gõ sai là lô mất liên kết xe, báo cáo hụt.
            'bksVao'       => ['Biển số vào', 'plate'],
            'contNo'       => ['Số cont', 'text'],
            'contType'     => ['Loại cont', 'contType'],
            'inv'          => ['Invoice', 'text'],
            'from'         => ['Nơi lấy', 'location'],
            'to'           => ['Nơi hạ', 'location'],
            'kho'          => ['Kho', 'kho'],
            'bargeDrop'    => ['Nơi hạ sà lan', 'bargeDrop'],
            'extVendor'    => ['Nhà xe ngoài', 'extVendor'],
            'infoNote'         => ['Ghi chú', 'text'],
        ];
        // Ngoài danh sách trên còn 3 nhóm xử lý RIÊNG (không map 1-1 với 1 cột DB):
        //  - Tờ khai: 2 cột song song SỐ TỜ KHAI / PHÍ TỜ KHAI → cột JSON declarations.
        //  - Cước xe ngoài: ghi vào DÒNG CHI PHÍ src=extTruck, ext_fee tự chốt lại.
        //  - Khối XE RA (collectRaChange): KIỂU RA · SỐ CONT RA (CẮT MÓC) · GIỜ XE RA · BKS RA — giờ/BKS
        //    ghi vào cột nào (của cont này, của cont ra hộ, hay của xe) tùy KIỂU RA, đúng như popup.
    }

    /** Cột DB tương ứng để đọc giá trị CŨ (dựng diff). */
    private function updatableFieldColumns(): array
    {
        return [
            'gioXeDen' => 'gio_xe_den',
            'gioDenDuKien' => 'gio_den_du_kien', 'io' => 'io',
            'bksVao' => 'bks_vao', 'contNo' => 'cont_no', 'contType' => 'cont_type',
            'inv' => 'inv', 'from' => 'from_loc', 'to' => 'to_loc',
            'kho' => 'kho', 'bargeDrop' => 'barge_drop',
            'extVendor' => 'ext_vendor', 'infoNote' => 'info_note',
            // Khối XE RA (gioXeRa / bksRa / raOtherContNo) không map cố định — collectRaChange tự chọn cột theo KIỂU RA.
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
                // Cước xe ngoài là dòng chi phí riêng. Mọi field còn lại — kể cả raMode / raOtherId (đã chốt THEO ID
                // lúc kiểm tra) / raOtherGioXeRa / raOtherBksRa — đi qua saveShipment như popup: nó tự đẩy giờ+BKS
                // sang cont ra hộ theo ra_other_id và recompute cả 2 lô.
                $extFee = $p['patch']['extFee'] ?? null;
                $only = array_values(array_diff(array_keys($p['patch']), ['extFee']));
                $this->saveShipment($p['patch'], $sheet, $s, $only);
                if ($extFee !== null) $this->applyExtTruckFee($s, (int) $extFee);
                $updated++;
                $cells += count($p['cells']);
            }
        });

        return $res + ['updated' => $updated, 'cells' => $cells];
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
            $notes = [];   // cảnh báo (không chặn) từ khối XE RA — gắn dòng/lô ở dưới
            $this->collectRaChange($s, $row, $patch, $cells, $reasons, $notes);

            if ($reasons) { $errors[] = $this->updateError($line, $row, $reasons, $s); continue; }
            if (! $cells) { $noChange++; continue; }

            $changes[] = ['line' => $line, 'id' => $s->id, 'contNo' => $s->cont_no ?? '', 'booking' => $s->booking ?? '', 'cells' => $cells];
            $plans[] = ['ship' => $s, 'patch' => $patch, 'cells' => $cells, 'line' => $line];

            // ----- cảnh báo (không chặn) -----
            foreach ($notes as $t) $warnings[] = ['line' => $line, 'id' => $s->id, 'text' => $t];
            if (isset($inStatement[$s->id])) {
                $money = array_intersect(array_column($cells, 'field'), self::MONEY_FIELDS);
                $warnings[] = ['line' => $line, 'id' => $s->id, 'text' => 'Lô đã nằm trong bảng kê ' . $inStatement[$s->id]
                    . ($money ? ' — sửa ' . implode(', ', array_map(fn ($f) => $fields[$f][0] ?? 'Tờ khai', $money)) . ' làm lệch số đã chốt, vào Bảng kê bấm Tính lại' : '')];
            }
            if (isset($patch['contNo']) && $this->contNoTakenBy($sheet, $patch['contNo'], $s->id)) {
                $warnings[] = ['line' => $line, 'id' => $s->id, 'text' => "Số cont “{$patch['contNo']}” đang trùng với lô khác"];
            }
        }

        // Cùng 1 giờ ra bị ghi từ 2 dòng: dòng lô B (cắt móc) ghi giờ cho cont A, dòng của chính A cũng ghi
        // → dòng sau ghi đè dòng trước; phải nói rõ thay vì để người dùng đoán giờ nào được giữ.
        $writers = [];   // shipment_id nhận giờ ra => [dòng]
        foreach ($plans as $p) {
            if (array_key_exists('gioXeRa', $p['patch'])) $writers[$p['ship']->id][] = $p['line'];
            if (array_key_exists('raOtherGioXeRa', $p['patch'])) {
                $oid = $p['patch']['raOtherId'] ?? $p['ship']->ra_other_id;
                if ($oid) $writers[$oid][] = $p['line'];
            }
        }
        foreach ($writers as $sid => $lines) {
            if (count($lines) > 1) {
                $warnings[] = ['line' => end($lines), 'id' => $sid,
                    'text' => 'Giờ ra của lô #' . $sid . ' được ghi ở ' . count($lines) . ' dòng (' . implode(', ', $lines) . ') — dòng sau ghi đè dòng trước'];
            }
        }
        // 1 cont chỉ ra 1 lần: 2 dòng trong cùng file chọn cùng 1 cont ra hộ → cả 2 sẽ được lưu, nhưng chỉ 1 dòng đúng.
        $picked = [];   // id cont ra hộ => [dòng]
        foreach ($plans as $p) if (! empty($p['patch']['raOtherId'])) $picked[$p['patch']['raOtherId']][] = $p['line'];
        foreach ($picked as $oid => $lines) {
            if (count($lines) > 1) {
                $warnings[] = ['line' => end($lines), 'id' => $oid,
                    'text' => 'Cont ra hộ (lô #' . $oid . ') được ' . count($lines) . ' dòng (' . implode(', ', $lines) . ') cùng chọn — 1 cont chỉ ra 1 lần, chỉ 1 dòng đúng'];
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

    /**
     * Khối XE RA — 4 cột đọc CÙNG NHAU: KIỂU RA · SỐ CONT RA (CẮT MÓC) · GIỜ XE RA · BKS RA.
     * GIỜ XE RA / BKS RA ghi vào đâu tùy KIỂU RA, đúng như ô nhập của popup:
     *  - Không cắt móc → giờ ra + BKS ra của CHÍNH cont này (gio_xe_ra / bks_ra).
     *  - Cont khác ra  → giờ ra + BKS ra của CONT RA HỘ (saveShipment đẩy sang lô ra_other_id qua raOtherGioXeRa/raOtherBksRa).
     *  - Không kéo ra  → giờ XE (đầu kéo) rời đi (gio_xe_ra_xe) + BKS xe đó (bks_ra); cont vẫn "chưa ra".
     * BKS RA trống mà vừa điền giờ ra → tự lấy BKS VÀO (xe vào chính là xe ra), cùng quy tắc với popup.
     * $notes: cảnh báo không chặn — caller gắn dòng/lô.
     */
    private function collectRaChange(TruckingShipment $s, array $row, array &$patch, array &$cells, array &$reasons, array &$notes): void
    {
        $oldMode = $s->ra_mode ?: 'self';
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
                // Rời kiểu "Không kéo ra" → giờ XE ra không còn nghĩa, dọn như popup (onPick self/other xóa gioXeRaXe).
                if ($oldMode === 'none' && $s->gio_xe_ra_xe) {
                    $patch['gioXeRaXe'] = null;
                    $cells[] = ['field' => 'gioXeRaXe', 'label' => 'Giờ xe ra (xe)', 'old' => $this->updateOldValue($s, 'gio_xe_ra_xe'), 'new' => ''];
                }
            }
        }
        $mode = $newMode ?? $oldMode;

        // ---- Cột SỐ CONT RA (CẮT MÓC) → lô ra hộ hiệu lực sau dòng này ----
        $n = count($reasons);
        $other = $this->collectRaOtherCont($s, $row, $mode, $oldMode, $patch, $cells, $reasons, $notes);
        if (count($reasons) > $n) return;

        // ---- Cột GIỜ XE RA + BKS RA: chọn đích theo KIỂU RA ----
        $gioRaw = trim((string) ($row['values']['gioXeRa'] ?? ''));
        $bksRaw = trim((string) ($row['values']['bksRa'] ?? ''));
        if ($gioRaw === '' && $bksRaw === '') return;

        [$t, $gioKey, $gioCol, $bksKey, $gioLabel, $bksLabel] = match ($mode) {
            'other' => [$other, 'raOtherGioXeRa', 'gio_xe_ra',    'raOtherBksRa', 'Giờ ra (cont ra hộ)', 'BKS ra (cont ra hộ)'],
            'none'  => [$s,     'gioXeRaXe',      'gio_xe_ra_xe', 'bksRa',        'Giờ xe ra (xe)',      'BKS ra (xe)'],
            default => [$s,     'gioXeRa',        'gio_xe_ra',    'bksRa',        'Giờ xe ra (cont này)', 'BKS ra'],
        };
        if (! $t) {
            $reasons[] = 'Kiểu ra "Cont khác ra" nhưng chưa có cont ra hộ — điền SỐ CONT RA (CẮT MÓC) rồi mới điền Giờ xe ra / BKS ra';
            return;
        }
        if ($t->id !== $s->id) { $gioLabel .= ' ' . $t->cont_no; $bksLabel .= ' ' . $t->cont_no; }   // nói rõ đang ghi cho cont nào

        $gioNew = null;   // giờ ra vừa ĐẶT (khác cũ, không phải xóa) — điều kiện để tự điền BKS
        if ($gioRaw !== '') {
            $show = trim((string) (($row['raws']['gioXeRa'] ?? '') ?: $gioRaw));
            $v = $this->normalizeUpdateValue('gioXeRa', 'datetime', $gioRaw, $show, $reasons, $gioLabel);
            if ($v === false) return;
            $old = $this->updateOldValue($t, $gioCol);
            $new = (string) ($v ?? '');
            if ($new !== $old) {
                $patch[$gioKey] = $v;
                $cells[] = ['field' => $gioKey, 'label' => $gioLabel, 'old' => $old, 'new' => $new];
                $gioNew = $new !== '' ? $new : null;
            }
        }

        $oldBks = trim((string) $t->bks_ra);
        if ($bksRaw !== '') {
            $v = $this->normalizeUpdateValue('bksRa', 'plate', $bksRaw, $bksRaw, $reasons, $bksLabel);
            if ($v === false) return;
            $new = (string) ($v ?? '');
            if ($new !== $oldBks) {
                $patch[$bksKey] = $v;
                $cells[] = ['field' => $bksKey, 'label' => $bksLabel, 'old' => $oldBks, 'new' => $new];
            }
        } elseif ($gioNew !== null) {
            // Xe vào chính là xe ra → BKS ra = BKS VÀO của lô này (BKS vào MỚI nếu vừa sửa ở cùng dòng). Tự điền khi:
            //  - BKS ra đang trống; hoặc
            //  - cont ra hộ CHƯA RA: bks_ra cũ của nó chỉ là xe vào tự điền / xe ra tay không, CHƯA phải xe kéo nó ra
            //    (giữ nguyên là lộ trình gắn nhầm xe kéo); hoặc
            //  - lô này vừa đổi BKS vào mà BKS ra cũ chính là BKS vào cũ (giá trị tự điền) → đi theo BKS vào mới.
            // Còn lại giữ nguyên — BKS ra khác BKS vào là người dùng chủ ý ghi xe khác.
            $bksVao = trim((string) ($patch['bksVao'] ?? $s->bks_vao ?? ''));
            $oldVao = trim((string) $s->bks_vao);
            $why = $oldBks === '' ? 'tự lấy BKS vào'
                : (($t->id !== $s->id && trim((string) $t->getRawOriginal('gio_xe_ra')) === '') ? 'xe kéo cont này ra = BKS vào'
                : ((array_key_exists('bksVao', $patch) && $oldVao !== '' && strcasecmp($oldBks, $oldVao) === 0) ? 'theo BKS vào mới' : null));
            if ($why !== null && $bksVao !== '' && strcasecmp($bksVao, $oldBks) !== 0) {
                $patch[$bksKey] = $bksVao;
                $cells[] = ['field' => $bksKey, 'label' => $bksLabel . ' (' . $why . ')', 'old' => $oldBks, 'new' => $bksVao];
            }
        }

        // ---- Cảnh báo (không chặn) ----
        if ($gioNew !== null) {
            $den = $t->id === $s->id ? ($patch['gioXeDen'] ?? $this->outDateTime($t->gio_xe_den)) : $this->outDateTime($t->gio_xe_den);
            if ($den && $gioNew < $den) {
                $notes[] = $gioLabel . ' (' . $this->dtVn($gioNew) . ') sớm hơn Giờ xe đến (' . $this->dtVn($den) . ') — kiểm tra lại nếu nhập nhầm';
            }
            if ($t->id !== $s->id) {
                // Giờ ra của cont ra hộ là NGÀY KỲ bảng kê của lô đó — lô đó có thể đã lên bảng kê dù lô này chưa.
                $st = $this->shipmentsInStatements([$t->id]);
                if (isset($st[$t->id])) {
                    $notes[] = 'Cont ra hộ ' . $t->cont_no . ' (lô #' . $t->id . ') đã nằm trong bảng kê ' . $st[$t->id]
                        . ' — đổi giờ ra làm lệch số đã chốt, vào Bảng kê bấm Tính lại';
                }
            }
        }
    }

    /**
     * Cột SỐ CONT RA (CẮT MÓC) → patch['raOtherId'] (null = bỏ liên kết, int = lô ra hộ).
     * Trả lô ra hộ HIỆU LỰC sau dòng này (vừa chọn hoặc đang liên kết) để giờ/BKS ghi đúng cont; null khi không có.
     */
    private function collectRaOtherCont(TruckingShipment $s, array $row, string $mode, string $oldMode, array &$patch, array &$cells, array &$reasons, array &$notes): ?TruckingShipment
    {
        $cur = ($oldMode === 'other' && $s->ra_other_id) ? $s->raOther : null;   // eager-load ở resolveUpdateTargets
        $oldContNo = $cur?->cont_no ?? '';
        $contRaw = trim((string) ($row['values']['raOtherContNo'] ?? ''));

        // self/none → bỏ liên kết như popup. Có gõ số cont ở kiểu này là nhầm: chặn thay vì lặng lẽ bỏ qua.
        if ($mode !== 'other') {
            if ($contRaw !== '' && $contRaw !== self::CLEAR_TOKEN) {
                $reasons[] = 'Có SỐ CONT RA (CẮT MÓC) "' . $contRaw . '" nhưng Kiểu ra là "' . self::RA_MODE_LABELS[$mode]
                    . '" — muốn cắt móc kéo cont đó ra thì đặt Kiểu ra = "Cont khác ra", không thì bỏ trống ô này';
                return null;
            }
            if ($s->ra_other_id) {
                $patch['raOtherId'] = null;
                if ($oldContNo !== '') $cells[] = ['field' => 'raOtherContNo', 'label' => 'Cont ra (cắt móc)', 'old' => $oldContNo, 'new' => ''];
            }
            return null;
        }

        if ($contRaw === '') return $cur;   // giữ nguyên

        if ($contRaw === self::CLEAR_TOKEN) {
            if ($cur) {
                $patch['raOtherId'] = null;
                $cells[] = ['field' => 'raOtherContNo', 'label' => 'Cont ra (cắt móc)', 'old' => $oldContNo, 'new' => ''];
            }
            return null;
        }

        if (mb_strtolower($contRaw) === mb_strtolower($oldContNo)) return $cur;

        // Cắt móc = xe kéo cont của lô KHÁC ra. Điền chính cont của lô này là nhầm cột.
        if (mb_strtolower($contRaw) === mb_strtolower((string) $s->cont_no)) {
            $reasons[] = 'Số cont ra "' . $contRaw . '" là cont của CHÍNH lô này — cột này cần cont của lô KHÁC. '
                . 'Xe kéo lại chính cont này thì để Kiểu ra = "Không cắt móc" và bỏ trống ô Số cont ra.';
            return null;
        }

        $sibling = $this->resolveRaOtherSibling($s, $contRaw, $reasons, $notes);
        if (! $sibling) return null;

        $patch['raOtherId'] = $sibling->id;
        $cells[] = ['field' => 'raOtherContNo', 'label' => 'Cont ra (cắt móc)', 'old' => $oldContNo, 'new' => $sibling->cont_no];
        return $sibling;
    }

    /**
     * Tìm lô "ra hộ" theo SỐ CONT — đúng 2 điều kiện: cont khớp VÀ lô đó CHƯA RA (chưa có Giờ xe ra).
     * KHÔNG ràng buộc cùng booking: xe cắt móc kéo cont của booking khác ra là chuyện bình thường, và ô
     * chọn ở popup Lô hàng cũng liệt kê mọi cont chưa ra của sheet (siblingsList) chứ không lọc theo booking.
     * Trả null kèm lý do khi cont không có, cont đã ra, hoặc trùng ở nhiều lô chưa ra.
     * Cont đã là "cont ra hộ" của lô khác → vẫn nhận nhưng CẢNH BÁO qua $notes (1 cont chỉ ra 1 lần).
     */
    private function resolveRaOtherSibling(TruckingShipment $s, string $contNo, array &$reasons, array &$notes): ?TruckingShipment
    {
        $cands = TruckingShipment::where('sheet', $s->sheet)
            ->where('id', '!=', $s->id)
            ->whereRaw('LOWER(cont_no) = ?', [mb_strtolower($contNo)])
            ->get(['id', 'booking', 'cont_no', 'bks_ra', 'gio_xe_ra', 'gio_xe_den']);   // bks_ra/gio_xe_den: dựng diff + cảnh báo giờ ra

        if ($cands->isEmpty()) {
            $reasons[] = 'Số cont ra "' . $contNo . '" không khớp lô nào trong danh sách';
            return null;
        }

        // "Đã ra" = cont đó có Giờ xe ra của chính nó. Đọc giá trị THÔ để chuỗi rỗng không bị cast datetime nuốt.
        $free = $cands->filter(fn ($c) => trim((string) $c->getRawOriginal('gio_xe_ra')) === '')->values();
        $bk = fn ($c) => $c->booking !== null && $c->booking !== '' ? $c->booking : '(trống)';

        if ($free->isEmpty()) {
            $reasons[] = 'Số cont ra "' . $contNo . '" là lô ĐÃ RA (booking "' . $bk($cands->first())
                . '") — cont đã có Giờ xe ra thì không ra hộ lô khác được nữa';
            return null;
        }
        if ($free->count() > 1) {
            $reasons[] = 'Số cont ra "' . $contNo . '" đang trùng ở ' . $free->count() . ' lô chưa ra (booking: '
                . implode(', ', $free->map($bk)->all()) . ') — sửa cho hết trùng rồi import lại';
            return null;
        }
        $hit = $free->first();

        // 1 cont chỉ ra 1 lần: đã là cont ra hộ của lô khác thì CẢNH BÁO, không chặn — có thể lô kia mới là lô chọn nhầm.
        $taken = TruckingShipment::where('ra_mode', 'other')->where('ra_other_id', $hit->id)
            ->where('id', '!=', $s->id)->first(['id', 'cont_no']);
        if ($taken) {
            $notes[] = 'Cont ' . $hit->cont_no . ' đã được lô #' . $taken->id . ($taken->cont_no ? ' (cont ' . $taken->cont_no . ')' : '')
                . ' chọn làm cont ra hộ — 1 cont chỉ ra 1 lần, kiểm tra lại lô nào đúng';
        }
        return $hit;
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
        $with = ['raOther:id,cont_no,booking,bks_ra,gio_xe_ra,gio_xe_den'];   // cont ra hộ đang liên kết: đích của GIỜ XE RA / BKS RA khi Cont khác ra
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
