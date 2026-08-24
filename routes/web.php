<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\TwoFactorChallengeController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\SystemSettingController;
use App\Http\Controllers\ShipmentController;
use App\Http\Controllers\TaskCommentController;
use App\Http\Controllers\TaskController;
use App\Http\Controllers\TruckingController;
use App\Http\Controllers\Trucking\AttachmentController;
use App\Http\Controllers\Trucking\CatalogController;
use App\Http\Controllers\Trucking\DriverController;
use App\Http\Controllers\Trucking\FleetController;
use App\Http\Controllers\Trucking\LoTrinhController;
use App\Http\Controllers\Trucking\PlanLinkController;
use App\Http\Controllers\Trucking\PriceController;
use App\Http\Controllers\Trucking\ShipmentController as TruckingShipmentController;
use App\Http\Controllers\Trucking\SpendRequestController;
use App\Http\Controllers\Trucking\StatementController;
use App\Http\Controllers\Trucking\ExtStatementController;
use App\Http\Controllers\Trucking\TrackingController;
use App\Http\Controllers\Trucking\TripCostController;
use App\Http\Controllers\Trucking\ReportController;
use App\Http\Controllers\UserController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return redirect()->route(auth()->check() ? 'trucking2.shipments' : 'login');
});

// ===== Yêu cầu chi (mobile SPA, có đăng nhập) — tài xế gửi đề nghị chi, kế toán duyệt sau =====
Route::get ('/yeu-cau-chi', [SpendRequestController::class, 'page'])->name('trucking2.spendRequest');
Route::post('/yeu-cau-chi/login',  [SpendRequestController::class, 'login'])->name('trucking2.spendRequest.login');
Route::post('/yeu-cau-chi/logout', [SpendRequestController::class, 'logout'])->name('trucking2.spendRequest.logout');
Route::get ('/yeu-cau-chi/history', [SpendRequestController::class, 'history'])->name('trucking2.spendRequest.history');
Route::post('/yeu-cau-chi/{cost}/cancel', [SpendRequestController::class, 'cancel'])->name('trucking2.spendRequest.cancel');
Route::post('/yeu-cau-chi/{cost}/update', [SpendRequestController::class, 'update'])->name('trucking2.spendRequest.update');
Route::post('/yeu-cau-chi', [SpendRequestController::class, 'submit'])->name('trucking2.spendRequest.submit');

// ===== Link kế hoạch CÔNG KHAI (lái xe, không đăng nhập) — token bí mật trong URL =====
Route::get ('/ke-hoach/{token}',                 [PlanLinkController::class, 'publicPage'])->name('trucking2.plan.public');
Route::get ('/ke-hoach/{token}/data',            [PlanLinkController::class, 'publicData'])->name('trucking2.plan.public.data');
Route::post('/ke-hoach/{token}/{ship}/update',   [PlanLinkController::class, 'publicUpdate'])->name('trucking2.plan.public.update');
Route::delete('/ke-hoach/{token}/{ship}/photo/{att}', [PlanLinkController::class, 'publicDeletePhoto'])->name('trucking2.plan.public.photo.delete')->whereNumber('att');

// ===== Tài liệu Trucking — CÔNG KHAI (không cần đăng nhập) để gửi kế toán =====
Route::get('/tailieu',          [TruckingController::class, 'docs'])->name('trucking.docs');
Route::get('/tailieu/download', [TruckingController::class, 'docsDownload'])->name('trucking.docsDownload');
Route::post('/tailieu/notes',   [TruckingController::class, 'saveNotes'])->name('trucking.saveNotes');

// Auth
Route::middleware('guest')->group(function () {
    Route::get('/login',  [LoginController::class, 'showLogin'])->name('login');
    Route::post('/login', [LoginController::class, 'login'])->name('login.attempt');

    // Bước 2 khi user bật 2FA (chưa đăng nhập — thông tin tạm giữ trong session)
    Route::get ('/login/2fa', [TwoFactorChallengeController::class, 'show'])->name('login.2fa');
    Route::post('/login/2fa', [TwoFactorChallengeController::class, 'store'])->name('login.2fa.attempt');
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [LoginController::class, 'logout'])->name('logout');

    // ===== Profile (mọi user đã login) =====
    Route::get('/profile',           [ProfileController::class, 'show'])->name('profile.show');
    Route::put('/profile/info',      [ProfileController::class, 'updateInfo'])->name('profile.info');
    Route::put('/profile/password',  [ProfileController::class, 'updatePassword'])->name('profile.password');
    // Quản lý thiết bị / phiên đăng nhập
    Route::post  ('/profile/sessions/logout-others', [ProfileController::class, 'revokeOtherSessions'])->name('profile.sessions.logoutOthers');
    Route::delete('/profile/sessions/{sessionId}',   [ProfileController::class, 'revokeSession'])->name('profile.sessions.revoke');

    // Xác thực 2 lớp (2FA)
    Route::post  ('/profile/2fa/start',           [ProfileController::class, 'startTwoFactor'])->name('profile.2fa.start');
    Route::post  ('/profile/2fa/confirm',         [ProfileController::class, 'confirmTwoFactor'])->name('profile.2fa.confirm');
    Route::post  ('/profile/2fa/recovery-codes',  [ProfileController::class, 'regenerateRecoveryCodes'])->name('profile.2fa.recovery');
    Route::delete('/profile/2fa',                 [ProfileController::class, 'disableTwoFactor'])->name('profile.2fa.disable');

    // ===== Follow Up Shipment ===== (TẠM TẮT qua config features.shipments)
    if (config('features.shipments')) {
    Route::middleware('permission:shipments.view')->group(function () {
        Route::get('/shipments',             [ShipmentController::class, 'redirectToCurrent'])->name('shipments.index');
        Route::get('/shipments/{period}',    [ShipmentController::class, 'show'])->name('shipments.show')->where('period', '\d{4}-\d{2}');
        Route::get('/shipments/{period}/data', [ShipmentController::class, 'data'])->name('shipments.data')->where('period', '\d{4}-\d{2}');
        Route::get('/shipments/{period}/export', [ShipmentController::class, 'export'])->name('shipments.export')->where('period', '\d{4}-\d{2}');
        Route::put('/me/shipment-column-prefs', [ShipmentController::class, 'updateColumnPrefs'])->name('shipments.columnPrefs');

        // Debug endpoint — dump current snapshot for inspection
        Route::get('/shipments/{period}/debug-snapshot', function (string $period) {
            $svc = app(\App\Services\SheetSnapshotService::class);
            $snap = $svc->get('shipments_grid_' . $period);
            return response()->json([
                'exists'   => $snap !== null,
                'version'  => $snap?->version,
                'updated_at' => $snap?->updated_at,
                'payload_type' => $snap ? gettype($snap->payload) : null,
                'payload_keys' => $snap && is_array($snap->payload) ? array_keys($snap->payload) : null,
                'has_formatting' => $snap && is_array($snap->payload) && isset($snap->payload['formatting']),
                'formatting_import_count' => $snap && is_array($snap->payload)
                    && isset($snap->payload['formatting']['import'])
                    ? count($snap->payload['formatting']['import']) : null,
                'formatting_export_count' => $snap && is_array($snap->payload)
                    && isset($snap->payload['formatting']['export'])
                    ? count($snap->payload['formatting']['export']) : null,
                'first_import_entry' => $snap && is_array($snap->payload)
                    && ! empty($snap->payload['formatting']['import'])
                    ? $snap->payload['formatting']['import'][0] : null,
            ]);
        })->where('period', '\d{4}-\d{2}');
    });
    Route::middleware('permission:shipments.create')->group(function () {
        Route::post('/shipments/months',                [ShipmentController::class, 'createPeriod'])->name('shipments.createPeriod');
        Route::post('/shipments/{period}/{direction}',  [ShipmentController::class, 'store'])->name('shipments.store')->where(['period' => '\d{4}-\d{2}', 'direction' => 'import|export']);
    });
    Route::middleware('permission:shipments.update')->group(function () {
        Route::post('/shipments/{period}/bulk',           [ShipmentController::class, 'bulk'])->name('shipments.bulk')->where('period', '\d{4}-\d{2}');
        Route::post('/shipments/{period}/reset-snapshot', [ShipmentController::class, 'resetSnapshot'])->name('shipments.resetSnapshot')->where('period', '\d{4}-\d{2}');
        Route::put ('/shipments/row/{shipment}',          [ShipmentController::class, 'update'])->name('shipments.update');
    });
    Route::middleware('permission:shipments.delete')->group(function () {
        Route::delete('/shipments/row/{shipment}', [ShipmentController::class, 'destroy'])->name('shipments.destroy');
    });
    } // end if features.shipments

    // ===== Trucking cũ (Luckysheet) ĐÃ GỠ — giữ tên 'trucking.index' làm alias chuyển sang v2
    //        (nhiều nơi vẫn link 'Trang chủ' tới route này) =====
    Route::get('/trucking', fn () => redirect()->route('trucking2.shipments'))->name('trucking.index');

    // ===== Trucking v2 (record + popup) — phân quyền TÁCH theo 4 tính năng =====
    Route::prefix('trucking-v2')->name('trucking2.')->group(function () {
        // --- Lô hàng ---
        Route::middleware('permission:shipments.view')->group(function () {
            Route::get('/', fn () => redirect()->route('trucking2.shipments'));
            Route::get('/lo-hang',        [TruckingShipmentController::class, 'index'])->name('shipments');
            Route::get('/shipments-page', [TruckingShipmentController::class, 'page'])->name('shipmentsPage');
            Route::get('/config',         [TruckingShipmentController::class, 'configData'])->name('configData');
            Route::get('/bootstrap',      [TruckingShipmentController::class, 'bootstrap'])->name('bootstrap');
            Route::get('/ke-hoach',                [PlanLinkController::class, 'index'])->name('plan');   // quản lý link kế hoạch
            Route::get('/lo-trinh',                [LoTrinhController::class, 'index'])->name('loTrinh');      // lộ trình lái xe theo chuyến
            Route::get('/lo-trinh/data',           [LoTrinhController::class, 'data'])->name('loTrinh.data');
            Route::post('/lo-trinh/pay',           [LoTrinhController::class, 'savePay'])->name('loTrinh.savePay')->middleware('permission:shipments.update');
            Route::post('/lo-trinh/freeze',        [LoTrinhController::class, 'freeze'])->name('loTrinh.freeze')->middleware('permission:shipments.update');
        });
        // --- Phí xe & lương lái xe (quyền riêng tripCost.*) ---
        Route::middleware('permission:tripCost.view')->group(function () {
            Route::get('/phi-xe',                    [TripCostController::class, 'index'])->name('tripCost');
            Route::get('/phi-xe/tao',                [TripCostController::class, 'create'])->name('tripCost.create');
            Route::get('/phi-xe/compute',            [TripCostController::class, 'compute'])->name('tripCost.compute');
            Route::get('/phi-xe/{tripCost}/recompute', [TripCostController::class, 'recompute'])->name('tripCost.recompute');
            Route::get('/phi-xe/{tripCost}',         [TripCostController::class, 'view'])->name('tripCost.view');
            Route::get('/bao-cao',                   [ReportController::class, 'index'])->name('report');
            Route::get('/bao-cao-tai-san',           [ReportController::class, 'assetIndex'])->name('assetReport');
            Route::get('/bao-cao-tai-san/data',      [ReportController::class, 'assetData'])->name('assetReport.data');
            Route::get('/bao-cao/data',              [ReportController::class, 'data'])->name('report.data');
            Route::get('/bao-cao/trend',             [ReportController::class, 'trend'])->name('report.trend');
        });
        Route::middleware('permission:tripCost.create')->group(function () {
            Route::post('/trip-costs', [TripCostController::class, 'store'])->name('tripCost.store');
        });
        Route::middleware('permission:tripCost.update')->group(function () {
            Route::put('/trip-costs/{tripCost}', [TripCostController::class, 'update'])->name('tripCost.update');
        });
        Route::middleware('permission:tripCost.delete')->group(function () {
            Route::delete('/trip-costs/{tripCost}', [TripCostController::class, 'destroy'])->name('tripCost.destroy');
        });
        // Link kế hoạch (admin) — vẫn dùng quyền lô hàng
        Route::middleware('permission:shipments.update')->group(function () {
            Route::post('/plan-links',                       [PlanLinkController::class, 'create'])->name('plan.create');
            Route::put('/plan-links/{planLink}',             [PlanLinkController::class, 'update'])->name('plan.update')->whereNumber('planLink');
            Route::put('/plan-links/{planLink}/toggle',      [PlanLinkController::class, 'toggle'])->name('plan.toggle')->whereNumber('planLink');
            Route::delete('/plan-links/{planLink}',          [PlanLinkController::class, 'destroy'])->name('plan.destroy')->whereNumber('planLink');
        });
        Route::middleware('permission:shipments.create')->group(function () {
            Route::post('/shipments',             [TruckingShipmentController::class, 'store'])->name('shipments.store');
            Route::post('/shipment-import/check', [TruckingShipmentController::class, 'check'])->name('shipmentCheck');
            Route::post('/shipment-import',       [TruckingShipmentController::class, 'import'])->name('shipmentImport');
        });
        Route::middleware('permission:shipments.update')->group(function () {
            Route::post('/shipments/bulk',      [TruckingShipmentController::class, 'bulkUpdate'])->name('shipments.bulkUpdate');
            // Điền số cont cho cả nhóm booking (import "số lượng cont = N" đẻ ra N lô trống cont)
            Route::get('/shipment-conts',       [TruckingShipmentController::class, 'contsOfBooking'])->name('shipmentContsOfBooking');
            Route::post('/shipment-conts',      [TruckingShipmentController::class, 'fillConts'])->name('shipmentContsFill');
            Route::post('/csht-import/check',   [TruckingShipmentController::class, 'cshtCheck'])->name('cshtCheck');
            Route::post('/csht-import',         [TruckingShipmentController::class, 'cshtImport'])->name('cshtImport');
            Route::post('/shipment-update/check', [TruckingShipmentController::class, 'updateCheck'])->name('shipmentUpdateCheck');
            Route::post('/shipment-update',       [TruckingShipmentController::class, 'updateImport'])->name('shipmentUpdateImport');
            Route::put('/shipments/{shipment}', [TruckingShipmentController::class, 'update'])->name('shipments.update');
        });
        Route::middleware('permission:shipments.delete')->group(function () {
            Route::delete('/shipments/{shipment}', [TruckingShipmentController::class, 'destroy'])->name('shipments.destroy');
        });

        // --- Theo dõi xe realtime (GPS) ---
        Route::middleware('permission:tracking.view')->group(function () {
            Route::get('/theo-doi-xe',          [TrackingController::class, 'index'])->name('tracking');
            Route::get('/tracking/positions',   [TrackingController::class, 'positions'])->name('tracking.positions');   // poll ~15s
            Route::get('/tracking/warehouses',  [TrackingController::class, 'warehouses'])->name('tracking.warehouses'); // marker kho
            Route::get('/lich-su-kho',          [TrackingController::class, 'visitsPage'])->name('tracking.visitsPage');  // trang lịch sử đến/rời kho
            Route::get('/tracking/visits',      [TrackingController::class, 'visits'])->name('tracking.visits');         // JSON phân trang
            Route::get('/tracking/visit-stats', [TrackingController::class, 'visitStats'])->name('tracking.visitStats'); // thống kê chuyến/xe
        });
        Route::middleware('permission:tracking.manage')->group(function () {
            Route::get('/tracking/config',  [TrackingController::class, 'config'])->name('tracking.config');
            Route::post('/tracking/config', [TrackingController::class, 'saveConfig'])->name('tracking.saveConfig');
            Route::post('/tracking/test',   [TrackingController::class, 'test'])->name('tracking.test');
            Route::post('/tracking/warehouse-geo', [TrackingController::class, 'saveWarehouseGeo'])->name('tracking.warehouseGeo');   // ghim kho từ bản đồ
        });

        // --- Bảng giá ---
        Route::middleware('permission:prices.view')->group(function () {
            Route::get('/bang-gia',        [PriceController::class, 'index'])->name('prices');
            Route::get('/customer-prices', [PriceController::class, 'customerPrices'])->name('customerPrices');
            Route::get('/price-books',     [PriceController::class, 'books'])->name('priceBooks');
        });
        Route::middleware('permission:prices.update')->group(function () {
            Route::post('/price-import',          [PriceController::class, 'import'])->name('priceImport');
            Route::post('/price-quote-validate',  [PriceController::class, 'quoteValidate'])->name('priceQuoteValidate');
            Route::post('/price-quote-import',    [PriceController::class, 'quoteImport'])->name('priceQuoteImport');
            Route::post('/price-copy',            [PriceController::class, 'copy'])->name('priceCopy');
            Route::post('/price-books',           [PriceController::class, 'createBook'])->name('priceBookCreate');
            Route::put('/price-books/{book}',     [PriceController::class, 'updateBook'])->name('priceBookUpdate')->whereNumber('book');
            Route::delete('/price-books/{book}',  [PriceController::class, 'deleteBook'])->name('priceBookDelete')->whereNumber('book');
            Route::put('/price-books/{book}/rows', [PriceController::class, 'saveBookRows'])->name('priceBookRows')->whereNumber('book');
        });

        // --- Bảng kê ---
        Route::middleware('permission:statements.view')->group(function () {
            Route::get('/bang-ke',                     [StatementController::class, 'index'])->name('statements');
            Route::get('/bang-ke/tao',                 [StatementController::class, 'create'])->name('statements.create');
            Route::get('/statement-candidates',        [StatementController::class, 'candidates'])->name('statements.candidates');   // lô đã định giá ở backend cho bảng kê mới
            Route::get('/statement-drift',             [StatementController::class, 'drift'])->name('statements.drift');   // đối soát cả danh sách → cảnh báo cần tính lại
            Route::get('/statement-list',              [StatementController::class, 'list'])->name('statements.list');   // paginate + filter (load-more cho data lớn)
            Route::get('/bang-ke/{statement}',         [StatementController::class, 'view'])->name('statements.view');
            Route::get('/bang-ke/{statement}/context', [StatementController::class, 'context'])->name('statements.context');
            Route::get('/bang-ke/{statement}/reprice', [StatementController::class, 'reprice'])->name('statements.reprice');   // tính lại ở backend
            Route::get('/bang-ke/{statement}/export-excel', [StatementController::class, 'export'])->name('statements.excel');
        });
        Route::middleware('permission:statements.create')->group(function () {
            Route::post('/statements', [StatementController::class, 'store'])->name('statements.store');
        });
        Route::middleware('permission:statements.update')->group(function () {
            Route::put('/statements/{statement}', [StatementController::class, 'update'])->name('statements.update');
        });
        Route::middleware('permission:statements.delete')->group(function () {
            Route::delete('/statements/{statement}', [StatementController::class, 'destroy'])->name('statements.destroy');
        });

        // --- Bảng kê xe ngoài (phải trả nhà xe thuê) ---
        Route::middleware('permission:extStatements.view')->group(function () {
            Route::get('/bang-ke-xe-ngoai',                 [ExtStatementController::class, 'index'])->name('extStatements');
            Route::get('/bang-ke-xe-ngoai/tao',             [ExtStatementController::class, 'create'])->name('extStatements.create');
            Route::get('/ext-statement-candidates',         [ExtStatementController::class, 'candidates'])->name('extStatements.candidates');
            Route::get('/ext-statement-list',               [ExtStatementController::class, 'list'])->name('extStatements.list');
            Route::get('/bang-ke-xe-ngoai/{extStatement}',  [ExtStatementController::class, 'view'])->name('extStatements.view');
        });
        Route::middleware('permission:extStatements.create')->group(function () {
            Route::post('/ext-statements', [ExtStatementController::class, 'store'])->name('extStatements.store');
        });
        Route::middleware('permission:extStatements.update')->group(function () {
            Route::put('/ext-statements/{extStatement}', [ExtStatementController::class, 'update'])->name('extStatements.update');
        });
        Route::middleware('permission:extStatements.delete')->group(function () {
            Route::delete('/ext-statements/{extStatement}', [ExtStatementController::class, 'destroy'])->name('extStatements.destroy');
        });

        // --- Cài đặt Trucking (danh mục, khách hàng, cấu hình) ---
        Route::middleware('permission:settings.view')->group(function () {
            Route::get('/cai-dat',        [CatalogController::class, 'index'])->name('settings');
            Route::get('/catalog/{type}', [CatalogController::class, 'data'])->name('catalogData');   // lazy-load 1 tab
        });
        // Stream file tập trung (disk-agnostic local/S3) — chỉ cần đăng nhập, phân quyền theo owner trong controller
        Route::get('/attachment/{attachment}', [AttachmentController::class, 'show'])->name('attachment');
        Route::middleware('permission:settings.update')->group(function () {
            Route::put('/catalog/{type}',    [CatalogController::class, 'save'])->name('catalog.save');
            Route::put('/customers',         [CatalogController::class, 'saveCustomers'])->name('customers.save');
            Route::put('/customer-rename',   [CatalogController::class, 'renameCustomer'])->name('customerRename');
            Route::put('/vehicles',          [CatalogController::class, 'saveVehicles'])->name('vehicles.save');
            Route::put('/settings',          [CatalogController::class, 'saveSettings'])->name('settings.save');
            Route::put('/route-fees',        [CatalogController::class, 'saveRouteFees'])->name('routeFees.save');
            Route::get('/route-fees/export', [CatalogController::class, 'exportRouteFees'])->name('routeFees.export');
            Route::post('/route-fees/import-check', [CatalogController::class, 'importRouteFeesCheck'])->name('routeFees.importCheck');
            Route::post('/route-fees/import',[CatalogController::class, 'importRouteFees'])->name('routeFees.import');
            Route::put('/fuel-prices',       [CatalogController::class, 'saveFuelPrices'])->name('fuelPrices.save');
            Route::put('/drivers',           [DriverController::class, 'save'])->name('drivers.save');
            Route::post('/drivers/{driver}/docs', [DriverController::class, 'uploadDocs'])->name('drivers.docs.upload');
            Route::delete('/drivers/{driver}/docs/{idx}', [DriverController::class, 'deleteDoc'])->name('drivers.docs.delete')->whereNumber('idx');
        });

        // --- Quản lý tài sản & đội xe (quyền riêng fleet.*) ---
        Route::middleware('permission:fleet.view')->group(function () {
            Route::get('/quan-ly-xe',                 [FleetController::class, 'index'])->name('fleet');
            Route::get('/quan-ly-tai-san-list',       [FleetController::class, 'assetList'])->name('asset.list');   // lazy-load tab Tài sản
            Route::get('/quan-ly-xe/{vehicle}/data',  [FleetController::class, 'vehicleData'])->name('fleet.data');
            Route::get('/quan-ly-xe/{vehicle}/section/{section}', [FleetController::class, 'vehicleSection'])->name('fleet.section');
            Route::get('/quan-ly-xe/{vehicle}/fuel', [FleetController::class, 'fuelData'])->name('fleet.fuel');
            // Quản lý chi phí — tổng hợp mọi phiếu chi (xe + tài sản)
            Route::get('/quan-ly-chi-phi',      [FleetController::class, 'costManagement'])->name('costManagement');
            Route::get('/quan-ly-chi-phi/list', [FleetController::class, 'costList'])->name('costManagement.list');
        });
        Route::middleware('permission:fleet.manage')->group(function () {
            Route::put('/quan-ly-xe/{vehicle}', [FleetController::class, 'saveVehicle'])->name('fleet.save');
            Route::put('/quan-ly-xe/cost/{cost}', [FleetController::class, 'updateCost'])->name('fleet.updateCost');
            Route::put('/quan-ly-xe/cost/{cost}/cancel', [FleetController::class, 'adminCancelCost'])->name('fleet.cancelCost');
            Route::post('/quan-ly-xe/cost-bulk', [FleetController::class, 'costBulk'])->name('fleet.costBulk');
            Route::post('/quan-ly-xe-cost-item', [FleetController::class, 'addCostItem'])->name('fleet.costItem');
            Route::post('/quan-ly-xe/{vehicle}/cost-photo', [FleetController::class, 'uploadCostPhotos'])->name('fleet.costPhoto.upload');
            Route::post('/quan-ly-xe/{vehicle}/docs', [FleetController::class, 'uploadDocs'])->name('fleet.docs.upload');
            Route::delete('/quan-ly-xe/{vehicle}/docs/{idx}', [FleetController::class, 'deleteDoc'])->name('fleet.docs.delete')->whereNumber('idx');
            Route::post('/quan-ly-xe/{vehicle}/fuel',   [FleetController::class, 'saveFuelRefill'])->name('fleet.fuel.save');
            Route::delete('/quan-ly-xe/{vehicle}/fuel/{refill}', [FleetController::class, 'deleteFuelRefill'])->name('fleet.fuel.delete');
            // Tài sản (kind='asset')
            Route::post('/quan-ly-tai-san',          [FleetController::class, 'createAsset'])->name('asset.create');
            Route::post('/quan-ly-tai-san-category', [FleetController::class, 'addAssetCategory'])->name('asset.category');
            Route::delete('/quan-ly-tai-san/{vehicle}', [FleetController::class, 'destroyAsset'])->name('asset.destroy');
        });
    });

    // ===== Users =====
    Route::middleware('permission:users.view')->group(function () {
        Route::get('/users', [UserController::class, 'index'])->name('users.index');
        // Debug: test Reverb broadcast tới mọi user
        Route::post('/users/broadcast-test', [UserController::class, 'broadcastTest'])->name('users.broadcastTest');
    });
    Route::middleware('permission:users.create')->group(function () {
        Route::post('/users', [UserController::class, 'store'])->name('users.store');
    });
    Route::middleware('permission:users.update')->group(function () {
        Route::put ('/users/{user}',          [UserController::class, 'update'])->name('users.update');
        Route::post('/users/{user}/2fa/reset', [UserController::class, 'resetTwoFactor'])->name('users.2fa.reset');
    });
    Route::middleware('permission:users.delete')->group(function () {
        Route::delete('/users/{user}', [UserController::class, 'destroy'])->name('users.destroy');
    });

    // ===== Tasks (Ghi chú & công việc) =====
    Route::middleware('permission:tasks.view')->group(function () {
        Route::get('/tasks',           [TaskController::class, 'index'])->name('tasks.index');
        Route::get('/tasks/{task}',    [TaskController::class, 'show'])->name('tasks.show');
    });
    Route::middleware('permission:tasks.create')->group(function () {
        Route::post('/tasks', [TaskController::class, 'store'])->name('tasks.store');
    });
    Route::middleware('permission:tasks.update')->group(function () {
        Route::put ('/tasks/{task}',        [TaskController::class, 'update'])->name('tasks.update');
        Route::put ('/tasks/{task}/status', [TaskController::class, 'toggleStatus'])->name('tasks.toggleStatus');
        // Comments (ghi) — coi là cập nhật task
        Route::post  ('/tasks/{task}/comments',           [TaskCommentController::class, 'store'])->name('tasks.comments.store');
        Route::delete('/tasks/{task}/comments/{comment}', [TaskCommentController::class, 'destroy'])->name('tasks.comments.destroy');
    });
    Route::middleware('permission:tasks.delete')->group(function () {
        Route::delete('/tasks/{task}', [TaskController::class, 'destroy'])->name('tasks.destroy');
    });

    // Endpoint cho mention picker (search users) — chỉ cần đã login
    Route::get('/api/users/search', function (Request $request) {
        $q = trim((string) $request->get('q', ''));
        return \App\Models\User::query()
            ->when($q, fn ($qb) => $qb->where('name', 'like', "%$q%"))
            ->orderBy('name')
            ->limit(8)
            ->get(['id', 'name']);
    })->name('users.search');

    // ===== Notifications =====
    Route::get   ('/notifications',                   [NotificationController::class, 'index'])->name('notifications.index');
    Route::get   ('/notifications/feed',              [NotificationController::class, 'feed'])->name('notifications.feed');
    Route::post  ('/notifications/{id}/read',         [NotificationController::class, 'markRead'])->name('notifications.read');
    Route::post  ('/notifications/read-all',          [NotificationController::class, 'markAllRead'])->name('notifications.readAll');
    Route::delete('/notifications/{id}',              [NotificationController::class, 'destroy'])->name('notifications.destroy');

    // ===== Roles =====
    Route::middleware('permission:roles.view')->group(function () {
        Route::get('/roles', [RoleController::class, 'index'])->name('roles.index');
    });
    Route::middleware('permission:roles.create')->group(function () {
        Route::post('/roles', [RoleController::class, 'store'])->name('roles.store');
    });
    Route::middleware('permission:roles.update')->group(function () {
        Route::put('/roles/{role}', [RoleController::class, 'update'])->name('roles.update');
    });
    Route::middleware('permission:roles.delete')->group(function () {
        Route::delete('/roles/{role}', [RoleController::class, 'destroy'])->name('roles.destroy');
    });

    // ===== Cài đặt hệ thống (chung) =====
    Route::middleware('permission:system.settings')->group(function () {
        Route::get ('/system-settings',      [SystemSettingController::class, 'index'])->name('system.settings');
        Route::put ('/system-settings',      [SystemSettingController::class, 'update'])->name('system.settings.update');
        Route::put ('/system-settings/gps',  [SystemSettingController::class, 'updateGps'])->name('system.settings.gps');
        Route::post('/system-settings/test', [SystemSettingController::class, 'test'])->name('system.settings.test');
        Route::post('/system-settings/backup', [SystemSettingController::class, 'backupNow'])->name('system.settings.backupNow');
        Route::get ('/system-settings/backup/{file}/download', [SystemSettingController::class, 'downloadBackup'])->name('system.settings.backupDownload');
    });
});
