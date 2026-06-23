/**
 * Layer: Transport (REST controller).
 * Upload HTTP endpoint (POST /uploads/presign): validate the requested mime/size, call
 * uploadService, return { url, key } to the client. Must NOT hold business logic or touch the DB.
 */
