@extends('layouts.app')
@section('title', 'Báo cáo chi phí — Trucking')

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
    data: '{{ route("trucking2.report.data") }}',
    trend: '{{ route("trucking2.report.trend") }}',
    fleet: '{{ url("trucking-v2/quan-ly-xe") }}',   // deep-link hồ sơ xe: #<hashid>/cost
  },
  boot: @json($boot),
};
</script>
@endsection

@push('scripts')
@vite('resources/js/trucking2/pages/bao-cao.jsx')
@endpush
