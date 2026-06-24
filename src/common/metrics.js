/**
 * Layer: Common.
 * Prometheus metrics via prom-client (doc §9) — the earliest saturation signals: concurrent
 * connections, event-loop lag, RSS memory, messages/sec, and ack latency p95/p99. Exposes a
 * registry + a /metrics handler. These tell you WHEN you've outgrown one process before users feel it.
 */
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry }); // includes event-loop lag + RSS memory

export const socketConnections = new client.Gauge({
  name: 'chat_socket_connections',
  help: 'Current number of connected Socket.io clients',
  registers: [registry],
});

export const messagesSent = new client.Counter({
  name: 'chat_messages_sent_total',
  help: 'Total messages accepted by the server',
  registers: [registry],
});

export const ackLatency = new client.Histogram({
  name: 'chat_message_ack_seconds',
  help: 'Latency from message:send receipt to ack',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

/** Express handler for GET /metrics. */
export async function metricsHandler(_req, res) {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}

export default registry;
