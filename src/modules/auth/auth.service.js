/**
 * Layer: Service.
 * Auth business logic: hash/verify passwords (bcrypt), issue short-lived access + refresh
 * JWTs, rotate/verify refresh tokens, and verify tokens for both REST and the socket
 * handshake. Calls userService/userRepository for credential lookup.
 * Must NOT touch Mongoose directly — go through the repository.
 */
