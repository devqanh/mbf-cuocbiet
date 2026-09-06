@extends('layouts.app')
@section('title', 'Báo cáo tài sản — Trucking')

@push('styles')
@include('trucking2.partials._styles')
@endpush

@section('content')
<div id="trk-root"></div>
<script>
window.__TRK = {
  csrf: '{{ csrf_token() }}',
  canEdit: {{ $canEdit ? 'true' : 'false' }},
  routes: {
    data:  '{{ route("trucking2.assetReport.data") }}',
    fleet: '{{ url("trucking-v2/quan-ly-xe") }}',   // deep-link xe: #<hashid>/cost
    costManagement: '{{ route("trucking2.costManagement") }}',   // phiếu chi chờ duyệt/thanh toán
  },
  boot: @json($boot),
};
</script>
@endsection

@push('scripts')
@vite('resources/js/trucking2/pages/bao-cao-tai-san.jsx')
@endpush
