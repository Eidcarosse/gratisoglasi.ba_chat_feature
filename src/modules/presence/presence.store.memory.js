/**
 * Layer: Store (IPresenceStore — in-process Map impl, TODAY).
 * Ref-counted online state in a Map<userId, Set<socketId>> plus lastSeenAt. Correct for a
 * single Node process at MVP. Lost on restart (fine — clients reconnect and re-announce).
 * Must NOT hold business logic.
 */
