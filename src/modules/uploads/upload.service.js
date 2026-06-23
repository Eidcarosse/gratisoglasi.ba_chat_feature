/**
 * Layer: Service.
 * Upload business logic (doc §7): generate a presigned PUT URL for DO Spaces/S3 plus the final
 * object key, validating mime/size AT PRESIGN TIME. Bytes are uploaded by the client DIRECTLY
 * to Spaces — the droplet never handles the file. (Thumbnail generation is a later async job.)
 * Wraps the S3 client/presigner; must NOT hold unrelated business logic.
 */
