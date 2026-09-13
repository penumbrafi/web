export { GET } from '@/shared/api/server/pindexer-stream/index.ts';

// Node runtime + force-dynamic: this route holds a long-lived
// EventSource connection and shares a pg LISTEN across requests. Edge
// runtime can't do a raw pg socket and can't stay open indefinitely.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
