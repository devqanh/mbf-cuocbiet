<?php

namespace App\Http\Controllers\Trucking;

use App\Models\TruckingShipment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Lô hàng — danh sách (phân trang server-side), CRUD, kiểm tra & import Excel. */
class ShipmentController extends BaseTruckingController
{
    /** Trang Lô hàng — 2 sheet HPH/ICD + popup chi phí/doanh thu/thông tin. */
    public function index()
    {
        return view('trucking2.lo-hang', $this->pageData([
            'page' => $this->svc->pagedShipments('icd', []),  // trang 1 (server-side paginate)
            'cfg'  => $this->svc->shipmentBoardConfig(),       // tối thiểu; danh mục dropdown lazy-load khi mở popup
            'sibs' => $this->svc->siblingsList('icd'),        // picker "ra hộ" (rút gọn)
        ]));
    }

    /** Toàn bộ dữ liệu cho 1 lần khởi tạo app. */
    public function bootstrap(): JsonResponse
    {
        return response()->json($this->svc->bootstrap());
    }

    /** Master data đầy đủ cho dropdown trong popup (lazy-load lần đầu mở popup). */
    public function configData(): JsonResponse
    {
        return response()->json(['ok' => true, 'cfg' => $this->svc->config(withPrices: false)]);
    }

    /** Trang Lô hàng — 1 trang (20 lô) + aggregate toàn cục. JSON cho client fetch. */
    public function page(Request $request): JsonResponse
    {
        $params = $request->only(['page', 'perPage', 'q', 'filter', 'follow', 'sort', 'dir', 'all', 'toLoc', 'toMode', 'fromLoc', 'fromMode', 'denDate', 'tags']);
        return response()->json(['ok' => true] + $this->svc->pagedShipments('icd', $params));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateShipment($request);
        $ship = $this->svc->saveShipment($data, $data['sheet']);

        return response()->json(['ok' => true, 'ship' => $this->svc->shipmentToArray($ship)]);
    }

    public function update(Request $request, TruckingShipment $shipment): JsonResponse
    {
        $data = $this->validateShipment($request);
        // Lưu TỪNG PHẦN: chỉ field client gửi trong "fields" mới ghi đè (tránh đè thay đổi người khác).
        $only = $request->input('fields');
        $only = is_array($only) && $only ? array_values(array_filter(array_map('strval', $only))) : null;
        $ship = $this->svc->saveShipment($data, $data['sheet'], $shipment, $only);

        return response()->json(['ok' => true, 'ship' => $this->svc->shipmentToArray($ship)]);
    }

    public function destroy(TruckingShipment $shipment): JsonResponse
    {
        $shipment->delete();
        return response()->json(['ok' => true]);
    }

    /** Cập nhật hàng loạt các lô đã chọn (hiện: Nơi hạ + Nơi hạ sà lan). */
    public function bulkUpdate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids'             => ['required', 'array', 'min:1'],
            'ids.*'           => ['integer'],
            'ship'            => ['required', 'array'],
            'ship.to'         => ['nullable', 'string'],
            'ship.bargeDrop'  => ['nullable', 'string'],
        ]);
        $n = $this->svc->bulkUpdateShipments($data['ids'], $data['ship']);
        return response()->json(['ok' => true, 'updated' => $n]);
    }

    /** Mọi lô cùng booking (cùng khách) — để điền số cont cho cả nhóm trong 1 popup. */
    public function contsOfBooking(Request $request): JsonResponse
    {
        $d = $request->validate([
            'booking'  => ['required', 'string'],
            'customer' => ['nullable', 'string'],
            'sheet'    => ['nullable', 'string'],
        ]);
        $list = $this->svc->shipmentsOfBooking($d['sheet'] ?? 'icd', $d['booking'], $d['customer'] ?? null);

        return response()->json(['ok' => true, 'list' => $list]);
    }

    /** Gán số cont cho từng lô trong nhóm booking (mỗi lô một số). */
    public function fillConts(Request $request): JsonResponse
    {
        $d = $request->validate([
            'sheet'        => ['nullable', 'string'],
            'rows'         => ['required', 'array', 'min:1'],
            'rows.*.id'    => ['required', 'integer'],
            'rows.*.contNo' => ['present', 'nullable', 'string'],
        ]);
        $n = $this->svc->assignContNos($d['sheet'] ?? 'icd', $d['rows']);

        return response()->json(['ok' => true, 'updated' => $n]);
    }

    /** Kiểm tra trước (dry-run) — không ghi DB, trả danh sách lỗi từng dòng. */
    public function check(Request $request): JsonResponse
    {
        $data = $request->validate(['rows' => ['present', 'array']]);
        return response()->json(['ok' => true] + $this->svc->validateShipments($data['rows']));
    }

    /** Import lô hàng từ Excel — ALL-OR-NOTHING (1 lỗi là không import gì). */
    public function import(Request $request): JsonResponse
    {
        $data = $request->validate([
            'sheet' => ['required', 'in:hph,icd'],
            'rows'  => ['present', 'array'],
        ]);
        $res = $this->svc->importShipments($data['sheet'], $data['rows']);

        return response()->json(['ok' => true] + $res);
    }

    /** Import CSHT — kiểm tra trước (dry-run): không ghi DB, trả lỗi từng dòng. */
    public function cshtCheck(Request $request): JsonResponse
    {
        $data = $request->validate([
            'sheet' => ['required', 'in:hph,icd'],
            'rows'  => ['present', 'array'],
        ]);
        return response()->json(['ok' => true] + $this->svc->validateCshtImport($data['sheet'], $data['rows']));
    }

    /** Import CSHT vào chi phí lô hàng theo số cont — ALL-OR-NOTHING, ghi đè dòng CSHT/Thanh lí sẵn có. */
    public function cshtImport(Request $request): JsonResponse
    {
        $data = $request->validate([
            'sheet' => ['required', 'in:hph,icd'],
            'rows'  => ['present', 'array'],
        ]);
        return response()->json(['ok' => true] + $this->svc->importCshtImport($data['sheet'], $data['rows']));
    }

    /** Import CẬP NHẬT lô — kiểm tra trước (dry-run): trả lỗi + diff từng ô, không ghi DB. */
    public function updateCheck(Request $request): JsonResponse
    {
        $data = $this->validateUpdateImport($request);
        return response()->json(['ok' => true] + $this->svc->validateShipmentUpdate($data['sheet'], $data['rows']));
    }

    /** Import CẬP NHẬT lô đã có từ Excel — ALL-OR-NOTHING, chỉ ghi ô thực sự đổi. */
    public function updateImport(Request $request): JsonResponse
    {
        $data = $this->validateUpdateImport($request);
        return response()->json(['ok' => true] + $this->svc->importShipmentUpdate($data['sheet'], $data['rows']));
    }

    /** Payload chung của 2 action import cập nhật. */
    private function validateUpdateImport(Request $request): array
    {
        return $request->validate([
            'sheet'          => ['required', 'in:hph,icd'],
            'rows'           => ['present', 'array'],
            'rows.*.id'      => ['nullable'],
            'rows.*.contNo'  => ['nullable', 'string'],
            'rows.*.values'  => ['nullable', 'array'],
            'rows.*.raws'    => ['nullable', 'array'],
        ]);
    }

    private function validateShipment(Request $request): array
    {
        $data = $request->validate([
            'sheet' => ['required', 'in:hph,icd'],
            'ship'  => ['required', 'array'],
        ]);

        return $data['ship'] + ['sheet' => $data['sheet']];
    }
}
