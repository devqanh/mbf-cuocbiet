<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Hai khoản chi phí do HỆ THỐNG tự sinh khi lưu lô — trước nay không có trong danh mục nên dòng
 * chi phí bị cost_item_id rỗng (mất màu theo dõi, VAT mặc định, và báo cáo theo khoản phải gom
 * theo chuỗi tên). Khai sẵn vào danh mục để mọi dòng đều link được:
 *   - "Cước xe ngoài"   (dòng src=extTruck, chốt ext_fee cho Bảng kê xe ngoài)
 *   - "Phí mở tờ khai"  (dòng src=thanhLyFee, tổng phí các tờ khai của lô)
 * Đồng thời đổi tên dòng cũ "Phí thanh lý tờ khai" → "Phí mở tờ khai" (đúng tên nghiệp vụ).
 */
return new class extends Migration
{
    private const OLD_DECL_FEE = 'Phí thanh lý tờ khai';
    private const NEW_DECL_FEE = 'Phí mở tờ khai';

    public function up(): void
    {
        $sort = (int) DB::table('trucking_cost_items')->max('sort');
        foreach ([self::NEW_DECL_FEE, 'Cước xe ngoài'] as $name) {
            if (! DB::table('trucking_cost_items')->where('name', $name)->exists()) {
                DB::table('trucking_cost_items')->insert([
                    'name' => $name, 'sort' => ++$sort, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        // Dòng chi phí đang mang tên cũ → đổi tên + gán cost_item_id cho khớp danh mục.
        $declId = DB::table('trucking_cost_items')->where('name', self::NEW_DECL_FEE)->value('id');
        DB::table('trucking_cost_lines')->where('src', 'thanhLyFee')
            ->update(['item' => self::NEW_DECL_FEE, 'cost_item_id' => $declId]);

        $extId = DB::table('trucking_cost_items')->where('name', 'Cước xe ngoài')->value('id');
        DB::table('trucking_cost_lines')->where('src', 'extTruck')
            ->update(['item' => 'Cước xe ngoài', 'cost_item_id' => $extId]);
    }

    public function down(): void
    {
        DB::table('trucking_cost_lines')->where('src', 'thanhLyFee')->update(['item' => self::OLD_DECL_FEE]);
        DB::table('trucking_cost_items')->whereIn('name', [self::NEW_DECL_FEE, 'Cước xe ngoài'])->delete();
    }
};
