/**
 * Layer: Common (middleware).
 * Assigns a unique request/connection id (generate or honor an inbound header) and attaches it
 * to the request and the logger context, so every log line is correlatable end-to-end.
 */
