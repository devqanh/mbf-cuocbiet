<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Danh mục kho (sheet ICD). */
class TruckingWarehouse extends Model
{
    protected $fillable = ['name', 'code', 'address', 'note', 'lat', 'lng', 'sort'];
    protected $casts = ['sort' => 'integer', 'lat' => 'float', 'lng' => 'float'];
}
