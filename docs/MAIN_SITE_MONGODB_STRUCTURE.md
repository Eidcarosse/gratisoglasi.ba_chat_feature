# MongoDB Database Structure — Gratis Backend

This document is a complete, self-contained reference for the MongoDB database used by the
**Gratis Backend** (a Node.js/Express marketplace API for buying, selling, and requesting
classified ads). Read this and you should understand every collection, its fields, how
collections relate, and the conventions used — without opening any source file.

---

## 1. Overview

|                      |                                                   |
| -------------------- | ------------------------------------------------- |
| **Database engine**  | MongoDB (hosted on MongoDB Atlas)                 |
| **Database name**    | `Gratis`                                          |
| **ODM**              | Mongoose `8.5.1`                                  |
| **Web framework**    | Express `4.18.2`                                  |
| **Models location**  | `models/` (one file per collection)               |
| **Connection setup** | `index.js`, lines 33–50 (`mongoose.connect(...)`) |

The connection string is **hardcoded** in `index.js`:

```js
mongoose.connect(
  "mongodb+srv://GratisBosnia:<password>@gratisbosnialive.bpyn0wd.mongodb.net/Gratis"
);
```

> ⚠️ **Config note:** the URI (including credentials) is hardcoded in source rather than read
> from an environment variable. `dotenv` is loaded but not used for the DB connection. This
> should be moved to a `.env` value (`process.env.MONGO_URI`) before any further deployment.

Indexes for the `Item` model are only auto-built when `process.env.NODE_ENV === "development"`
(via `itemModel.createIndexes()` in `index.js`). In other environments, indexes rely on
Mongoose's automatic index creation.

### A note on naming

MongoDB collection names are the **lowercased, pluralized** form of the Mongoose model name.
So model `User` → collection `users`, model `EmailVarify` → collection `emailvarifyes`, etc.
The model name is what you use in code; the collection name is what you see in the database.

---

## 2. Collections at a Glance

| Collection        | Model name       | File                          | Purpose                                 | Timestamps |
| ----------------- | ---------------- | ----------------------------- | --------------------------------------- | ---------- |
| `users`           | `User`           | `models/user.js`              | Registered accounts (sellers & buyers)  | ✅         |
| `items`           | `Item`           | `models/item.js`              | Classified ads / listings for sale      | ✅         |
| `bids`            | `Bid`            | `models/bids.js`              | Standalone bid records on items         | ❌         |
| `buyerrequests`   | `BuyerRequest`   | `models/buyerRequest.js`      | "Wanted" requests posted by buyers      | ✅         |
| `stories`         | `Story`          | `models/story.js`             | 24-hour ephemeral stories (auto-expire) | ✅         |
| `categories`      | `Category`       | `models/categories.js`        | Lookup: fixed category → subcategories  | ❌         |
| `locations`       | `Location`       | `models/location.js`          | Lookup: entity → cantons → cities       | ❌         |
| `cars`            | `Cars`           | `models/cars.js`              | Lookup: car make → models               | ❌         |
| `motorcycles`     | `Motorcycle`     | `models/motercycles.js`       | Lookup: motorcycle make → models        | ❌         |
| `emailvarifyes`   | `EmailVarify`    | `models/emailVarification.js` | Email-verification tokens               | ✅         |
| `forgotpasswords` | `ForgotPassword` | `models/forgotPassword.js`    | Password-reset tokens                   | ✅         |
| `favorites`       | `favorites`      | `models/favorites.js`         | Legacy/redundant favorites store        | ✅         |

**Groupings:**

- **Core entities:** `users`, `items`, `bids`, `buyerrequests`, `stories`
- **Lookup / reference data:** `categories`, `locations`, `cars`, `motorcycles`
- **Auth helpers:** `emailvarifyes`, `forgotpasswords`
- **Redundant:** `favorites` (duplicates `users.favorites` — see [Known Quirks](#7-known-quirks--gotchas))

---

## 3. Collection Details

> **Legend** — In the constraint columns: `req` = required, `def` = default value,
> `unique` = unique index, `enum` = restricted to listed values. All ObjectId fields with a
> `ref` are foreign-key-style references resolved via Mongoose `.populate()`.

### 3.1 `users` — `User`

The central entity. Almost every other collection references a user.

| Field                     | Type                 | Constraints                        | Description                                                        |
| ------------------------- | -------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `firstname`               | String               | min 3, max 20                      | First name. _(declared with `require` typo — see quirks)_          |
| `lastname`                | String               | min 3, max 20                      | Last name. _(declared with `require` typo)_                        |
| `email`                   | String               | **req**, max 50, **unique**        | Login email; unique across all users.                              |
| `emailVerified`           | Boolean              | def `false`                        | Whether the email has been verified.                               |
| `password`                | String               | min 6                              | Hashed password (optional — supports social/OAuth-style accounts). |
| `location`                | String               | **req**, def `"No Location Added"` | Free-text location.                                                |
| `profilePicture`          | String               | **req**, def (Cloudflare URL)      | Avatar URL; defaults to a placeholder image.                       |
| `stories`                 | [ObjectId] → `Story` | —                                  | Stories created by this user.                                      |
| `phoneNo`                 | String               | def `""`                           | Phone number.                                                      |
| `waNo`                    | String               | def `""`                           | WhatsApp number.                                                   |
| `viberNo`                 | String               | def `""`                           | Viber number.                                                      |
| `facebook`                | String               | def `""`                           | Facebook handle/URL.                                               |
| `instagram`               | String               | def `""`                           | Instagram handle/URL.                                              |
| `tiktok`                  | String               | def `""`                           | TikTok handle/URL.                                                 |
| `twitter`                 | String               | def `""`                           | Twitter/X handle/URL.                                              |
| `showAllAds`              | Boolean              | def `true`                         | Privacy: show all of this user's ads publicly.                     |
| `showEmail`               | Boolean              | def `true`                         | Privacy: display email on listings.                                |
| `favorites`               | [ObjectId] → `Item`  | —                                  | Items this user has favorited.                                     |
| `logged_in`               | Boolean              | **req**, def `false`               | Current logged-in state flag.                                      |
| `createdAt` / `updatedAt` | Date                 | auto                               | Managed by `{ timestamps: true }`.                                 |

**Relationships:** has many `Item` (via `Item.addedBy`), `Bid`, `BuyerRequest`, `Story`,
`EmailVarify`, `ForgotPassword`. Embeds arrays of references to `Story` (`stories`) and
`Item` (`favorites`).

---

### 3.2 `items` — `Item`

A listing for sale. Supports both a fixed "buy-now" `price` and auction-style embedded `bids`.

| Field                     | Type              | Constraints                                           | Description                                        |
| ------------------------- | ----------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `addedBy`                 | ObjectId → `User` | **req**                                               | The seller who posted the item.                    |
| `title`                   | String            | **req**                                               | Listing title.                                     |
| `price`                   | Number            | def `null`                                            | Buy-now price (`null` = no fixed price).           |
| `address`                 | String            | —                                                     | Free-text address.                                 |
| `location`                | String            | —                                                     | Free-text location.                                |
| `newlocation`             | Object            | —                                                     | Structured geo-location (see below).               |
| `category`                | String            | **req**                                               | Top-level category.                                |
| `sub_category`            | String            | **req**                                               | Subcategory.                                       |
| `sub_category_type`       | String            | —                                                     | Optional 3rd-level classification.                 |
| `sub_category_sub_type`   | String            | —                                                     | Optional 4th-level classification.                 |
| `description`             | String            | —                                                     | Listing body text.                                 |
| `images`                  | [String]          | —                                                     | Array of image URLs.                               |
| `featured`                | Boolean           | def `false`                                           | Promoted/featured listing.                         |
| `phoneNo`                 | String            | def `""`                                              | Contact phone.                                     |
| `waNo`                    | String            | def `""`                                              | Contact WhatsApp.                                  |
| `viberNo`                 | String            | def `""`                                              | Contact Viber.                                     |
| `hidden`                  | Boolean           | def `false`                                           | Soft-delete / hide flag.                           |
| `status`                  | String            | enum `['Pending','Review','Approved']`, def `Pending` | Moderation state.                                  |
| `viewCount`               | Number            | def `0`                                               | Number of views.                                   |
| `favoriteCount`           | Number            | def `0`                                               | Number of times favorited.                         |
| `details`                 | Mixed             | —                                                     | Free-form object for category-specific attributes. |
| `firstPublished`          | Date              | def `Date.now`                                        | First publish timestamp.                           |
| `bids`                    | [BidSubSchema]    | def `[]`                                              | Embedded bid history (see below).                  |
| `createdAt` / `updatedAt` | Date              | auto                                                  | `{ timestamps: true }`.                            |

**`newlocation` sub-object:**

```js
newlocation: {
  address: String,
  coordinates: { lat: Number, lng: Number }
}
```

**Embedded `BidSubSchema`** (no own `_id`):

| Field      | Type              | Constraints    | Description              |
| ---------- | ----------------- | -------------- | ------------------------ |
| `bidder`   | ObjectId → `User` | **req**        | User who placed the bid. |
| `amount`   | Number            | **req**, min 0 | Bid amount.              |
| `placedAt` | Date              | def `Date.now` | When the bid was placed. |

**Indexes:** `{ "bids.amount": -1 }` — keeps the highest embedded bids first.

**Relationships:** belongs to `User` (`addedBy`); each embedded bid references a `User`;
also referenced by the standalone `Bid` collection and by `User.favorites`.

---

### 3.3 `bids` — `Bid`

A standalone, normalized record of a bid on an item. This duplicates the data in
`Item.bids` (see [Known Quirks](#7-known-quirks--gotchas)).

| Field      | Type              | Constraints    | Description              |
| ---------- | ----------------- | -------------- | ------------------------ |
| `item`     | ObjectId → `Item` | **req**        | The item being bid on.   |
| `bidder`   | ObjectId → `User` | **req**        | User placing the bid.    |
| `amount`   | Number            | **req**, min 0 | Bid amount.              |
| `placedAt` | Date              | def `Date.now` | When the bid was placed. |

**Indexes:** `{ item: 1, amount: -1 }` — fetch the highest bids for an item quickly.
**Schema options:** none (no timestamps).

---

### 3.4 `buyerrequests` — `BuyerRequest`

A "wanted" post: a buyer describing something they want to buy. Mirrors `Item` but from the
buyer's side (`maxbudget` instead of `price`).

| Field                     | Type              | Constraints          | Description                                        |
| ------------------------- | ----------------- | -------------------- | -------------------------------------------------- |
| `requestedBy`             | ObjectId → `User` | **req**              | The buyer who posted the request.                  |
| `title`                   | String            | **req**              | Request title.                                     |
| `maxbudget`               | Number            | def `null`           | Maximum budget (optional).                         |
| `location`                | String            | —                    | Free-text location.                                |
| `category`                | String            | **req**              | Top-level category.                                |
| `sub_category`            | String            | **req**              | Subcategory.                                       |
| `sub_category_type`       | String            | —                    | Optional 3rd-level classification.                 |
| `sub_category_sub_type`   | String            | —                    | Optional 4th-level classification.                 |
| `description`             | String            | —                    | Request body text.                                 |
| `urgent`                  | Boolean           | **req**, def `false` | Marks the request as urgent.                       |
| `contactPhone`            | String            | def `""`             | Contact phone.                                     |
| `contactWhatsApp`         | String            | def `""`             | Contact WhatsApp.                                  |
| `contactViber`            | String            | def `""`             | Contact Viber.                                     |
| `hidden`                  | Boolean           | def `false`          | Soft-delete / hide flag.                           |
| `details`                 | Mixed             | —                    | Free-form object for category-specific attributes. |
| `firstPublished`          | Date              | def `Date.now`       | First publish timestamp.                           |
| `createdAt` / `updatedAt` | Date              | auto                 | `{ timestamps: true }`.                            |

**Relationships:** belongs to `User` (`requestedBy`).

---

### 3.5 `stories` — `Story`

Ephemeral, Instagram-style stories that **auto-delete after 24 hours** via a MongoDB TTL index.

| Field                     | Type                | Constraints                       | Description                                        |
| ------------------------- | ------------------- | --------------------------------- | -------------------------------------------------- |
| `userId`                  | ObjectId → `User`   | **req**, indexed                  | Story author.                                      |
| `imageUrl`                | String              | **req**                           | Story image URL.                                   |
| `adId`                    | String              | **req**                           | ID of the associated ad/item (stored as a string). |
| `caption`                 | String              | max length 200, def `""`          | Optional caption.                                  |
| `expiresAt`               | Date                | **req**, def `now + 24h`, indexed | Expiry timestamp.                                  |
| `viewedBy`                | [ObjectId] → `User` | —                                 | Users who have viewed this story.                  |
| `isDefaultImage`          | Boolean             | def `false`                       | Whether the image is a default/placeholder.        |
| `createdAt` / `updatedAt` | Date                | auto                              | `{ timestamps: true }`.                            |

**Indexes:**

- `{ userId: 1 }`
- `{ expiresAt: 1 }` with `expireAfterSeconds: 0` — **TTL index**: MongoDB automatically
  deletes a story once `expiresAt` passes.

**Relationships:** belongs to `User` (`userId`); `viewedBy` references many `User`s;
also referenced by `User.stories`.

---

### 3.6 `categories` — `Category`

Lookup table mapping a fixed top-level category to its subcategories.

| Field           | Type     | Constraints               | Description                            |
| --------------- | -------- | ------------------------- | -------------------------------------- |
| `name`          | String   | **req**, enum (14 values) | Top-level category name.               |
| `subcategories` | [String] | —                         | Subcategory names under this category. |

**Allowed `name` values:** `Mobiles`, `Vehicles`, `Property for Sale`, `Property for Rent`,
`Electronics & Home Appliances`, `Bikes`, `Business, Industrial & Agriculture`, `Services`,
`Jobs`, `Animals`, `Furniture & Home Decor`, `Fashion & Beauty`, `Books, Sports & Hobbies`,
`Kids`.

---

### 3.7 `locations` — `Location`

Hierarchical Bosnian geographic lookup data: entity → canton → cities.

| Field    | Type                  | Constraints | Description                               |
| -------- | --------------------- | ----------- | ----------------------------------------- |
| `entity` | String                | —           | Entity name (e.g. `"Federacija BiH"`).    |
| `data`   | Map<String, [String]> | —           | Map of canton name → array of city names. |

---

### 3.8 `cars` — `Cars`

Lookup of car makes and their models (used to populate vehicle listing dropdowns).

| Field   | Type     | Constraints | Description                     |
| ------- | -------- | ----------- | ------------------------------- |
| `make`  | String   | **req**     | Car manufacturer.               |
| `model` | [String] | —           | Models available for this make. |

---

### 3.9 `motorcycles` — `Motorcycle`

Lookup of motorcycle makes and their models.

| Field   | Type     | Constraints         | Description                       |
| ------- | -------- | ------------------- | --------------------------------- |
| `make`  | String   | **req**, **unique** | Motorcycle manufacturer (unique). |
| `model` | [String] | —                   | Models available for this make.   |

---

### 3.10 `emailvarifyes` — `EmailVarify`

Stores email-verification tokens issued during signup.

| Field                     | Type              | Constraints | Description                                            |
| ------------------------- | ----------------- | ----------- | ------------------------------------------------------ |
| `userId`                  | ObjectId → `user` | **req**     | User being verified. _(ref is lowercase — see quirks)_ |
| `EmailVerificationToken`  | String            | **req**     | The verification token.                                |
| `createdAt` / `updatedAt` | Date              | auto        | `{ timestamps: true }`.                                |

---

### 3.11 `forgotpasswords` — `ForgotPassword`

Stores password-reset tokens.

| Field                     | Type              | Constraints | Description                                              |
| ------------------------- | ----------------- | ----------- | -------------------------------------------------------- |
| `userId`                  | ObjectId → `user` | **req**     | User requesting reset. _(ref is lowercase — see quirks)_ |
| `ForgotPasswordToken`     | String            | **req**     | The reset token.                                         |
| `createdAt` / `updatedAt` | Date              | auto        | `{ timestamps: true }`.                                  |

---

### 3.12 `favorites` — `favorites`

A legacy/standalone favorites store. **Redundant** with `User.favorites`.

| Field                     | Type     | Constraints         | Description                                     |
| ------------------------- | -------- | ------------------- | ----------------------------------------------- |
| `userId`                  | String   | **req**, **unique** | User ID, stored as a **string** (not ObjectId). |
| `favorites`               | [String] | **req**             | Item IDs, stored as **strings**.                |
| `createdAt` / `updatedAt` | Date     | auto                | `{ timestamps: true }`.                         |

---

## 4. Relationship Map

```
                              ┌──────────────────────────┐
                              │           User            │
                              │  (users) — central hub     │
                              └────────────┬──────────────┘
            ┌───────────────┬──────────────┼──────────────┬───────────────┐
            │               │              │              │               │
   addedBy  │       requestedBy │     userId │      userId │        userId │
            ▼               ▼              ▼              ▼               ▼
      ┌──────────┐  ┌───────────────┐ ┌─────────┐ ┌──────────────┐ ┌───────────────┐
      │   Item   │  │ BuyerRequest  │ │  Story  │ │  EmailVarify  │ │ ForgotPassword│
      │ (items)  │  │(buyerrequests)│ │(stories)│ │(emailvarifyes)│ │(forgotpasswords)│
      └────┬─────┘  └───────────────┘ └────┬────┘ └──────────────┘ └───────────────┘
           │                               │
           │ item                          │ viewedBy[] ───► User (many viewers)
           ▼                               │
      ┌──────────┐                         └─ User.stories[]  ◄── back-reference
      │   Bid    │
      │  (bids)  │── bidder ──► User
      └──────────┘

   Item also: bids[] (embedded BidSubSchema → bidder ──► User)
   User.favorites[] ──► Item
   favorites (legacy) ── userId/favorites stored as plain strings (no enforced refs)

   Standalone lookup collections (no relationships):
      Category · Location · Cars · Motorcycle
```

**Summary of references**

| From             | Field           | To      | Cardinality        |
| ---------------- | --------------- | ------- | ------------------ |
| `Item`           | `addedBy`       | `User`  | many → 1           |
| `Item`           | `bids[].bidder` | `User`  | embedded, many → 1 |
| `Bid`            | `item`          | `Item`  | many → 1           |
| `Bid`            | `bidder`        | `User`  | many → 1           |
| `BuyerRequest`   | `requestedBy`   | `User`  | many → 1           |
| `Story`          | `userId`        | `User`  | many → 1           |
| `Story`          | `viewedBy[]`    | `User`  | many → many        |
| `EmailVarify`    | `userId`        | `User`  | many → 1           |
| `ForgotPassword` | `userId`        | `User`  | many → 1           |
| `User`           | `stories[]`     | `Story` | 1 → many           |
| `User`           | `favorites[]`   | `Item`  | many → many        |

---

## 5. Conventions & Patterns

- **Timestamps** — Core entities and auth helpers use `{ timestamps: true }`, giving
  automatic `createdAt` / `updatedAt`. Lookup collections (`Category`, `Location`, `Cars`,
  `Motorcycle`) and `Bid` do not.
- **Soft delete** — `Item` and `BuyerRequest` use a `hidden` boolean rather than hard
  deletion, so records can be hidden from listings without losing data.
- **Moderation workflow** — `Item.status` follows `Pending → Review → Approved`.
- **Flexible attributes** — `Item.details` and `BuyerRequest.details` are `Mixed` type,
  holding arbitrary category-specific fields (e.g. car mileage, property size) without a
  fixed schema.
- **References & populate** — Cross-collection links use `ObjectId` with a `ref`, resolved
  via Mongoose `.populate()`. The exception is the legacy `favorites` collection, which
  stores plain strings.
- **Embedded vs. referenced bids** — Bids exist both embedded in `Item.bids` (fast reads of
  an item's bid history) and as standalone `Bid` documents (queryable across items). Keep
  both in sync when writing bid logic.
- **TTL auto-expiry** — `Story` uses a TTL index on `expiresAt` so MongoDB removes expired
  stories automatically (~24h lifetime).
- **Multi-level categorization** — Listings classify through up to four levels:
  `category → sub_category → sub_category_type → sub_category_sub_type`.

---

## 6. Multi-Level Category Hierarchy

Listings (`Item`) and requests (`BuyerRequest`) reference categories by **string value**,
validated against the `categories` lookup collection rather than by ObjectId reference:

```
category               (e.g. "Vehicles")        ← must match Category.name enum
  └─ sub_category       (e.g. "Cars")            ← from Category.subcategories
       └─ sub_category_type      (e.g. "Toyota") ← e.g. from Cars.make
            └─ sub_category_sub_type (e.g. "Corolla") ← e.g. from Cars.model[]
```

The `cars` and `motorcycles` collections supply make/model dropdown data for the vehicle
categories.

---

## 7. Known Quirks & Gotchas

These are accurate reflections of the current schema. They are documented so future
maintainers are not surprised — not necessarily endorsed.

1. **`require` typo on `User`** — `firstname` and `lastname` use `require: true` instead of
   `required: true`. `require` is **not** a Mongoose validator, so these fields are **not
   actually required**.
2. **Lowercase refs** — `EmailVarify.userId` and `ForgotPassword.userId` reference `"user"`
   (lowercase), while the model is registered as `"User"`. `.populate()` on these may fail
   unless a matching model is registered.
3. **Redundant `favorites` collection** — `User.favorites` (array of `ObjectId`s) already
   stores favorites. The separate `favorites` collection duplicates this using **string**
   IDs, risking data divergence.
4. **Duplicated bid storage** — Bids live both embedded in `Item.bids` and in the standalone
   `Bid` collection. Writes must update both to stay consistent.
5. **Mixed ID types** — Most collections use `ObjectId`; the legacy `favorites` collection
   and `Story.adId` store IDs as **strings**.
6. **Hardcoded connection string** — The MongoDB URI and credentials are committed in
   `index.js` rather than loaded from environment variables.
7. **No schema hooks/validators** — No models define pre/post middleware or custom
   validators beyond basic type/min/max/enum constraints.
8. **Conditional index creation** — `Item` indexes are explicitly built only when
   `NODE_ENV === "development"`.

---

_Generated from the Mongoose models in `models/` and the connection setup in `index.js`.
If a model changes, update the corresponding section here._
