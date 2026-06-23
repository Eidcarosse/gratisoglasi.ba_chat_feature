/**
 * Layer: Common.
 * Prometheus metrics via prom-client (doc §9) — the earliest saturation signals: concurrent
 * connections, event-loop lag, RSS memory, messages/sec, and ack latency p95/p99. Exposes a
 * registry + a /metrics handler. These tell you WHEN you've outgrown one process before users feel it.
 */
