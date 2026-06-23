/**
 * Layer: Service.
 * User business logic: profile creation/lookup/update, avatar URL handling. Consumed by
 * authService (credential lookup) and other modules via service→service calls (never by
 * reaching into userRepository from another module).
 * Must NOT touch Mongoose directly — go through userRepository.
 */
