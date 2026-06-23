/**
 * Layer: Transport (auth guards).
 * Two guards backed by authService:
 *   - requireAuth (REST): verifies the Bearer access token, attaches req.userId, else 401.
 *   - socketAuth (ws):    verifies the JWT during the Socket.io handshake, attaches
 *                         socket.userId, else rejects the connection.
 * SECURITY RULE: downstream code trusts req.userId / socket.userId ONLY — never a userId
 * taken from a request body or socket event payload.
 */
