@extends('layouts.app')
@section('title', 'Lô hàng — Trucking')

@push('styles')
@include('trucking2.partials._styles')
@endpush

@section('content')
<div id="trk-root"></div>
<script>
window.__TRK = {
  csrf: '{{ csrf_token() }}',
  canEdit: {{ $canEdit ? 'true' : 'false' }},
  canDelete: {{ $canDelete ? 'true' : 'false' }},
  routes: {
    shipmentStore: '{{ route("trucking2.shipments.store") }}',
    shipmentCheck: '{{ route("trucking2.shipmentCheck") }}',
    shipmentImport: '{{ route("trucking2.shipmentImport") }}',
    cshtCheck: '{{ route("trucking2.cshtCheck") }}',
    cshtImport: '{{ route("trucking2.cshtImport") }}',
    shipUpdateCheck: '{{ route("trucking2.shipmentUpdateCheck") }}',
    shipUpdateImport: '{{ route("trucking2.shipmentUpdateImport") }}',
    shipmentsPage: '{{ route("trucking2.shipmentsPage") }}',
    shipmentBulk: '{{ route("trucking2.shipments.bulkUpdate") }}',
    shipmentConts: '{{ route("trucking2.shipmentContsFill") }}',
    config: '{{ route("trucking2.configData") }}',
    shipment: '{{ url("trucking-v2/shipments") }}/',
    catalog: '{{ url("trucking-v2/catalog") }}/',
    customers: '{{ route("trucking2.customers.save") }}',
    vehicles: '{{ route("trucking2.vehicles.save") }}',
    @if(\App\Models\TruckingSetting::bool('sys.feature_plan_link', true))
    plan: '{{ route("trucking2.plan") }}',
    @endif
  },
  boot: @json($boot),
};
</script>
@endsection

@push('scripts')
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
@vite('resources/js/trucking2/pages/lo-hang.jsx')
@endpush
