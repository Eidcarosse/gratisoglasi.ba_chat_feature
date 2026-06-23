/**
 * Layer: Repository (IUserRepository — Mongo impl).
 * Data access for users: create, findById, findByEmail, updateProfile. Translates domain ops
 * to Mongoose calls and returns lean plain objects. The ONLY place user documents are read/written.
 * Must NOT hold business logic.
 */
