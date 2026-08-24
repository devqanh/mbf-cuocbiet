<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 1 lô có NHIỀU tờ khai, mỗi tờ khai 1 phí → cột JSON `declarations` = [{no, fee}].
 * `declaration_no` GIỮ LẠI làm chuỗi tìm kiếm/hiển thị (danh sách số cách nhau ", ") nên
 * tìm kiếm, bảng kê và xuất Excel không phải đổi gì.
 * Backfill: số tờ khai đang có → 1 phần tử; phí lấy từ dòng chi phí src=thanhLyFee của lô.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trucking_shipments', function (Blueprint $table) {
            $table->json('declarations')->nullable()->after('declaration_no');
        });

        // Phí thanh lý đang nằm ở dòng chi phí src=thanhLyFee (1 dòng / lô).
        $fees = DB::table('trucking_cost_lines')->where('src', 'thanhLyFee')
            ->selectRaw('shipment_id, SUM(amount) fee')->groupBy('shipment_id')->pluck('fee', 'shipment_id');

        DB::table('trucking_shipments')->whereNotNull('declaration_no')->where('declaration_no', '!=', '')
            ->select('id', 'declaration_no')->orderBy('id')->chunk(500, function ($rows) use ($fees) {
                foreach ($rows as $r) {
                    DB::table('trucking_shipments')->where('id', $r->id)->update([
                        'declarations' => json_encode([[
                            'no'  => trim((string) $r->declaration_no),
                            'fee' => (int) round((float) ($fees[$r->id] ?? 0)),
                        ]], JSON_UNESCAPED_UNICODE),
                    ]);
                }
            });
    }

    public function down(): void
    {
        Schema::table('trucking_shipments', function (Blueprint $table) {
            $table->dropColumn('declarations');
        });
    }
};
