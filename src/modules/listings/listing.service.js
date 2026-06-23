/**
 * Layer: Service.
 * Listing business logic: create/update listings, status transitions (active→sold/closed),
 * ownership checks. Consumed by conversationService (a conversation attaches to a listing) via
 * service→service calls. Must NOT touch Mongoose directly — go through listingRepository.
 */
