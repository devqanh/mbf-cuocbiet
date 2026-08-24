<?php

namespace App\Models;

use App\Concerns\HasHashid;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Một lô hàng trucking. Sheet ('hph' | 'icd') quyết định tập field hiển thị.
 * Chi phí / doanh thu / thanh toán nằm ở các bảng con.
 */
class TruckingShipment extends Model
{
    use HasHashid;
    public const SHEET_HPH = 'hph';
    public const SHEET_ICD = 'icd';

    protected $fillable = [
        'sheet', 'customer_id',
        'booking', 'inv', 'io', 'cru',
        'qty', 'cont_type', 'cont_no', 'declaration_no', 'declarations', 'declaration_note', 'thanh_ly_date', 'csht_note', 'kho',
        'from_loc', 'to_loc',
        'bks_vao', 'bks_ra', 'driver', 'ra_mode', 'ra_other_id',
        'sail_date', 'cut_off', 'cont_den', 'cont_ra',
        'gio_den_du_kien', 'gio_xe_den', 'gio_xe_ra', 'gio_xe_ra_xe',
        'vat_rate', 'han_tt', 'ghi_chu',
        // tham chiếu + số liệu báo cáo (chốt khi lưu)
        'vehicle_id', 'driver_id', 'from_location_id', 'to_location_id',
        'rev_base', 'vat_amount', 'choho_revenue', 'phai_thu', 'da_thu', 'con_no',
        'cost_total', 'cost_billable', 'cost_company', 'profit',
    ];

    protected $casts = [
        'cru'             => 'boolean',
        'is_barge'        => 'boolean',
        'qty'             => 'integer',
        'ra_other_id'     => 'integer',
        'sail_date'       => 'date',
        'thanh_ly_date'   => 'date',
        'cont_den'        => 'date',
        'cont_ra'         => 'date',
        'han_tt'          => 'date',
        'gio_den_du_kien' => 'datetime',
        'gio_xe_den'      => 'datetime',
        'gio_xe_ra'       => 'datetime',
        'gio_xe_ra_xe'    => 'datetime',
        'vat_rate'        => 'decimal:2',
        'tags'            => 'array',
        'declarations'    => 'array',   // [{no, fee}] — 1 lô nhiều tờ khai, mỗi tờ khai 1 phí
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(TruckingCustomer::class, 'customer_id');
    }

    /** Lô "cont khác ra" (ra_mode=other) trỏ tới: cont thực sự rời đi — dùng giờ xe ra của nó cho Free time. */
    public function raOther(): BelongsTo
    {
        return $this->belongsTo(self::class, 'ra_other_id');
    }

    public function costLines(): HasMany
    {
        return $this->hasMany(TruckingCostLine::class, 'shipment_id')->orderBy('sort');
    }

    public function revenueLines(): HasMany
    {
        return $this->hasMany(TruckingRevenueLine::class, 'shipment_id')->orderBy('sort');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(TruckingPayment::class, 'shipment_id')->orderBy('sort');
    }

    public function warehouses(): HasMany
    {
        return $this->hasMany(TruckingShipmentWarehouse::class, 'shipment_id')->orderBy('sort');
    }

    public function scopeOfSheet(Builder $q, string $sheet): Builder
    {
        return $q->where('sheet', $sheet);
    }
}
