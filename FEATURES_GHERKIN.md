# language: en
# Acceptance specification; no Cucumber step definitions are installed.
# Examples are isolated fixtures, not credentials or identifiers from the live database.
# Ask Loop scenarios use deterministic model fixtures; real-model evaluation is recorded separately.
@loop
Feature: Household waste pickup discovery, reservations and verified sandbox payments

  Background:
    Given every scenario starts with isolated fixtures and a controllable gateway
    And the clock is fixed at "2030-04-15T03:00:00Z"
    And the default hold duration is 10 minutes and the display timezone is "Asia/Kolkata"
    And "(empty)" means an empty string and "(missing)" means an omitted field
    And fixture aliases resolve to these identifiers:
      | alias           | UUID                                 |
      | Alice           | 10000000-0000-4000-8000-000000000001 |
      | Bob             | 10000000-0000-4000-8000-000000000002 |
      | Alice Home      | 20000000-0000-4000-8000-000000000001 |
      | Bob Home        | 20000000-0000-4000-8000-000000000002 |
      | GreenCycle      | 30000000-0000-4000-8000-000000000001 |
      | Paper Trail     | 30000000-0000-4000-8000-000000000002 |
      | Morning Slot    | 40000000-0000-4000-8000-000000000001 |
      | Afternoon Slot  | 40000000-0000-4000-8000-000000000002 |
      | Alice Booking   | 50000000-0000-4000-8000-000000000001 |
      | Alice Payment   | 60000000-0000-4000-8000-000000000001 |
      | Alice Challenge | 70000000-0000-4000-8000-000000000001 |

  @hosted @authentication
  Rule: Hosted demo entry creates isolated guest sessions without claiming phone verification

    Background:
      Given the hosted profile uses Postgres, HTTPS and mock payments
      And the demo-entry rate limit has not been reached

    Scenario Outline: Create a guest only when the public demo profile is enabled
      Given PUBLIC_DEMO_MODE is "<enabled>"
      And this route test runs with NODE_ENV "test"
      When an anonymous visitor sends POST "/api/auth/demo" with body "<body>"
      Then the response status is <status>
      And the response outcome is "<outcome>"

      Examples:
        | enabled | body                                         | status | outcome          |
        | true    | {}                                           | 200    | guest session    |
        | true    | {"userId":"10000000-0000-4000-8000-000000000001"} | 400 | VALIDATION_ERROR |
        | false   | {}                                           | 404    | NOT_FOUND        |

    Scenario Outline: Guest entry returns a signed private identity and secure refresh cookie
      Given PUBLIC_DEMO_MODE is "true"
      And NODE_ENV is "production"
      When visitor "<visitor>" opens a new demo session
      Then the server assigns a new UUID and a synthetic "demo:" identifier
      And the JWT subject equals that assigned UUID
      And the visitor receives the fictional contact "<contact>" in "<city>" with postal code "<postal>"
      And the refresh cookie is HttpOnly, Secure, SameSite Strict and scoped to "/api/auth"
      And only the refresh-token hash is stored in the database
      And access tokens are kept in browser memory rather than localStorage
      And no other visitor's private resources are returned

      Examples:
        | visitor | contact       | city      | postal |
        | Maya    | Ananya Sharma | Bengaluru | 560038 |
        | Daniel  | Ananya Sharma | Bengaluru | 560038 |

    Scenario Outline: Disable real-phone OTP routes in the hosted guest profile
      Given PUBLIC_DEMO_MODE is "true"
      When the visitor sends POST "<path>" with the route's otherwise valid fixture payload
      Then the response status is 403
      And the error code is "DEMO_ONLY"
      And no real OTP is delivered

      Examples:
        | path                 |
        | /api/auth/request-otp |
        | /api/auth/verify-otp  |

  @local @authentication
  Rule: Local OTP login validates phones and consumes expiring challenges once

    Background:
      Given PUBLIC_DEMO_MODE is "false"
      And the local console OTP provider is configured
      And no request or resend limit has been reached

    Scenario Outline: Normalize valid phones and reject malformed phone input
      When a visitor requests an OTP for "<input>"
      Then the response status is <status>
      And the outcome is "<outcome>"
      And the challenge phone is "<normalized>"

      Examples:
        | input           | status | outcome          | normalized    |
        | +91 98765 43210 | 200    | challenge issued | +919876543210 |
        | 9876543210      | 200    | challenge issued | +919876543210 |
        | 123             | 400    | VALIDATION_ERROR | none          |
        | (empty)         | 400    | VALIDATION_ERROR | none          |

    Scenario Outline: Persist hashed random OTPs with bounded lifetime and resend delay
      Given the controlled OTP generator produces fixture code "<code>"
      When a visitor requests an OTP for "<phone>"
      Then the response contains expiresIn 300 and resendAfter 60
      And the console adapter receives the generated code
      And the stored code hash does not equal "<code>"
      And the response does not expose the code

      Examples:
        | phone         | code   |
        | +919876543210 | 421673 |
        | +919876543211 | 862415 |

    Scenario Outline: Verify an OTP according to format, challenge state and expiry
      Given Alice Challenge belongs to "+919876543210" and has fixture code "421673"
      And the challenge state is "<state>" with <attempts> previous attempts
      And verification occurs <seconds> seconds after challenge creation
      When the visitor verifies Alice Challenge using code "<code>"
      Then the response status is <status>
      And the outcome is "<outcome>"

      Examples:
        | state    | attempts | seconds | code   | status | outcome          |
        | active   | 0        | 120     | 421673 | 200    | signed session   |
        | active   | 0        | 120     | 111111 | 401    | INVALID_OTP      |
        | consumed | 1        | 120     | 421673 | 401    | INVALID_OTP      |
        | active   | 0        | 301     | 421673 | 401    | INVALID_OTP      |
        | active   | 5        | 120     | 421673 | 401    | INVALID_OTP      |
        | active   | 0        | 120     | 12345  | 400    | VALIDATION_ERROR |

    Scenario Outline: Bound resends and per-phone challenge creation
      Given the previous challenge was created <seconds> seconds ago
      And <count> challenges already exist for "+919876543210" in the last hour
      When that phone requests another OTP
      Then the response status is <status>
      And the outcome is "<outcome>"

      Examples:
        | seconds | count | status | outcome          |
        | 30      | 1     | 429    | OTP_RESEND_LIMIT |
        | 61      | 1     | 200    | challenge issued |
        | 61      | 5     | 429    | OTP_RESEND_LIMIT |

  @sessions @security
  Rule: Refresh rotation, logout and ownership preserve verified identity

    Background:
      Given Alice and Bob have separate server-issued JWT sessions
      And Alice owns Alice Home, Alice Booking and Alice Payment
      And the access-token lifetime is 15 minutes

    Scenario Outline: Reject missing, malformed, expired or incorrectly signed access tokens
      When GET "/api/me" uses authorization "<authorization>"
      Then the response status is 401
      And the error code is "UNAUTHORIZED"

      Examples:
        | authorization                    |
        | (missing)                        |
        | Bearer not-a-jwt                 |
        | fixture JWT expired 1 second ago |
        | fixture JWT signed by Bob's unrelated signing key |

    Scenario Outline: Hide another user's resource behind a 404
      Given the requester is authenticated as Bob
      When the requester sends "<method>" to "<path>" with a valid payload when required
      Then the response status is 404
      And the error code is "NOT_FOUND"
      And Alice's resource remains unchanged

      Examples:
        | method | path                                                 |
        | GET    | /api/addresses/20000000-0000-4000-8000-000000000001 |
        | PATCH  | /api/addresses/20000000-0000-4000-8000-000000000001 |
        | DELETE | /api/addresses/20000000-0000-4000-8000-000000000001 |
        | GET    | /api/bookings/50000000-0000-4000-8000-000000000001  |
        | GET    | /api/orders/50000000-0000-4000-8000-000000000001    |
        | GET    | /api/payments/60000000-0000-4000-8000-000000000001  |

    Scenario Outline: Rotate refresh tokens and revoke a family after replay
      Given refresh token "refresh_fixture_A" is valid for Alice
      When Alice refreshes it and receives "refresh_fixture_B"
      And a client attempts to use "<token>"
      Then the response status is <status>
      And the result is "<result>"
      And raw refresh tokens are absent from database storage

      Examples:
        | token             | status | result                                |
        | refresh_fixture_B | 200    | another rotated session               |
        | refresh_fixture_A | 401    | INVALID_SESSION and family revocation |

    Scenario Outline: Reject refresh requests that do not satisfy session and origin checks
      Given the refresh cookie is "<cookie>"
      When POST "/api/auth/refresh" uses X-Requested-With "<header>" and Origin "<origin>"
      Then the response status is <status>
      And the error code is "<error>"

      Examples:
        | cookie  | header    | origin                             | status | error           |
        | valid   | Loop      | https://hks-fullstack.vercel.app    | 200    | none            |
        | missing | Loop      | https://hks-fullstack.vercel.app    | 401    | INVALID_SESSION |
        | valid   | (missing) | https://hks-fullstack.vercel.app    | 403    | CSRF_REJECTED   |
        | valid   | Loop      | https://untrusted.example          | 403    | ORIGIN_REJECTED |

    Scenario Outline: Logout clears refresh access while existing JWTs expire naturally
      Given Alice has a valid refresh family and a newly issued access JWT
      When Alice sends POST "/api/auth/logout" with JSON "{}" and X-Requested-With "Loop"
      Then the response status is 200
      And the refresh cookie is cleared and its family is revoked
      When the previously issued access JWT calls GET "/api/me" after <minutes> minutes
      Then the response status is <status>

      Examples:
        | minutes | status |
        | 1       | 200    |
        | 16      | 401    |

  @addresses @crud
  Rule: Customers manage only their saved addresses and historical snapshots stay immutable

    Background:
      Given Alice has authenticated with a valid JWT
      And the complete address fixture is:
        | field        | value                       |
        | label        | Home                        |
        | contactName  | Ananya Sharma               |
        | contactPhone | +919876543210               |
        | addressLine1 | 14, 3rd Cross, Indiranagar  |
        | addressLine2 | Near 100 Feet Road         |
        | city         | Bengaluru                   |
        | state        | Karnataka                   |
        | postalCode   | 560038                      |
      And latitude and longitude example values are JSON numbers

    Scenario Outline: Create an address and retrieve it through list and detail endpoints
      When Alice posts the complete fixture to "/api/addresses" with label "<label>" and contactName "<name>"
      Then the response status is 201
      And a UUID owned by Alice is assigned
      And GET "/api/addresses" includes the saved label "<label>"
      And GET "/api/addresses/:createdUuid" returns contactName "<name>"

      Examples:
        | label     | name           |
        | Home      | Ananya Sharma  |
        | Apartment | Priya Nair     |
        | Work      | Daniel Morgan  |

    Scenario Outline: Reject invalid or injected address fields
      When Alice posts the complete fixture with field "<field>" changed to "<value>"
      Then the response status is 400
      And the error code is "VALIDATION_ERROR"
      And no address is inserted

      Examples:
        | field        | value                                |
        | contactName  | (empty)                              |
        | addressLine1 | <script>alert(1)</script>            |
        | contactPhone | 123                                  |
        | postalCode   | 012345                               |
        | postalCode   | 56001                                |
        | latitude     | 91                                   |
        | longitude    | 181                                  |
        | userId       | 10000000-0000-4000-8000-000000000002 |

    Scenario Outline: Update the full address form without rewriting booking history
      Given Alice Home has already been captured in Alice Booking with street "14, 3rd Cross, Indiranagar"
      When Alice sends the complete address form to PATCH "/api/addresses/20000000-0000-4000-8000-000000000001" with street "<street>"
      Then the response status is 200
      And Alice Home now contains "<street>"
      And Alice Booking still contains street "14, 3rd Cross, Indiranagar"

      Examples:
        | street                         |
        | 42, 5th Main, Indiranagar      |
        | 28, MG Road                   |

    Scenario Outline: Delete only unused addresses
      Given Alice Home has <references> booking references
      When Alice sends DELETE "/api/addresses/20000000-0000-4000-8000-000000000001" with JSON "{}"
      Then the response status is <status>
      And the outcome is "<outcome>"

      Examples:
        | references | status | outcome                       |
        | 0          | 204    | empty body; address removed   |
        | 1          | 409    | ADDRESS_IN_USE; address kept  |

  @discovery
  Rule: Provider search respects supported materials, geography and Indian calendar time

    Background:
      Given Alice is authenticated
      And exactly these active provider fixtures exist:
        | alias       | name                | pricePaise | wasteTypes              | city      | postalCode |
        | GreenCycle  | GreenCycle Services | 14900      | PAPER,PLASTIC           | Bengaluru | 560038     |
        | Paper Trail | Paper Trail         | 7900       | PAPER                   | Bengaluru | 560038     |
        | EcoFood     | EcoFood Collect     | 9900       | FOOD,GREEN_WASTE        | Bengaluru | 560001     |
      And each provider has AVAILABLE slots on "2030-04-16" at "09:00" and "13:00" in Asia/Kolkata

    Scenario Outline: Filter collection partners with concrete search combinations
      When Alice sends GET "/api/providers<query>"
      Then the response status is 200
      And the returned provider names are "<providers>"

      Examples:
        | query                                                   | providers                                  |
        | ?wasteType=PAPER                                        | GreenCycle Services,Paper Trail            |
        | ?wasteType=FOOD&location=560001                          | EcoFood Collect                            |
        | ?wasteType=PAPER&location=Mysuru                         | none                                       |
        | ?date=2030-04-16&slot=morning&location=Bengaluru           | EcoFood Collect,GreenCycle Services,Paper Trail |
        | ?date=2030-04-17                                        | none                                       |

    Scenario Outline: Reject invalid filter values
      When Alice sends GET "/api/providers<query>"
      Then the response status is 400
      And the error code is "VALIDATION_ERROR"

      Examples:
        | query                    |
        | ?wasteType=RADIOACTIVE    |
        | ?date=2030-02-30         |
        | ?slot=midnight          |
        | ?radius=10             |

    Scenario Outline: Expose only future available slots and apply Indian time-of-day filters
      Given GreenCycle also has a HELD slot at "16:00" on "2030-04-16"
      When Alice requests GreenCycle availability with slot filter "<filter>"
      Then the response contains Indian start times "<times>"
      And no HELD, BOOKED or past slot is returned

      Examples:
        | filter    | times       |
        | morning   | 09:00       |
        | afternoon | 13:00       |
        | (missing) | 09:00,13:00 |

    Scenario Outline: Resolve provider detail requests without exposing an admin API
      Given provider "30000000-0000-4000-8000-000000000001" is "<state>"
      When Alice sends GET "<path>"
      Then the response status is <status>
      And the outcome is "<outcome>"

      Examples:
        | state    | path                                                | status | outcome          |
        | active   | /api/providers/30000000-0000-4000-8000-000000000001 | 200    | provider details |
        | inactive | /api/providers/30000000-0000-4000-8000-000000000001 | 404    | NOT_FOUND        |
        | active   | /api/providers/not-a-uuid                           | 400    | VALIDATION_ERROR |

  @reservations
  Rule: Reservations claim capacity atomically and use server-owned price and identity

    Background:
      Given Alice and Bob have authenticated with separate JWTs
      And GreenCycle serves Bengaluru postal codes "560038" and "560001" and collects "PAPER,PLASTIC"
      And GreenCycle's price is 14900 paise in "INR"
      And Alice Home and Bob Home are owned by their corresponding users in Bengaluru "560038"
      And Morning Slot belongs to GreenCycle from "2030-04-16T03:30:00Z" to "2030-04-16T04:30:00Z"
      And Morning Slot is AVAILABLE

    Scenario Outline: Hold a supported pickup using a valid request key
      When Alice sends POST "/api/bookings/hold" with Idempotency-Key "<key>" and:
        """
        {"providerId":"30000000-0000-4000-8000-000000000001","slotId":"40000000-0000-4000-8000-000000000001","addressId":"20000000-0000-4000-8000-000000000001","wasteTypes":["<waste>"]}
        """
      Then the response status is 201
      And the booking status is "PENDING_PAYMENT" with amount 14900 and currency "INR"
      And the hold expires at "2030-04-15T03:10:00Z"
      And Morning Slot is HELD by Alice and references the new booking
      And the booking preserves the current provider, address and schedule snapshots

      Examples:
        | key                       | waste   |
        | pickup-alice-20300415-001  | PAPER   |
        | pickup-alice-20300415-002  | PLASTIC |

    Scenario Outline: Reject booking validation, ownership and coverage failures
      Given the otherwise valid hold request has condition "<condition>"
      When Alice submits it with Idempotency-Key "pickup-alice-20300415-003"
      Then the response status is <status>
      And the error code is "<error>"
      And Morning Slot remains AVAILABLE

      Examples:
        | condition                                               | status | error                 |
        | wasteTypes is an empty array                             | 400    | VALIDATION_ERROR      |
        | wasteTypes contains PAPER twice                          | 400    | VALIDATION_ERROR      |
        | wasteTypes is FOOD                                       | 400    | UNSUPPORTED_WASTE     |
        | address is Alice's Pune 411001 address                    | 400    | UNSUPPORTED_LOCATION  |
        | addressId is Bob Home                                    | 404    | NOT_FOUND             |
        | provider is inactive                                     | 404    | NOT_FOUND             |
        | payload includes amount 1                                | 400    | VALIDATION_ERROR      |
        | payload includes userId 10000000-0000-4000-8000-000000000002 | 400  | VALIDATION_ERROR      |

    Scenario Outline: Reject invalid idempotency headers before reserving anything
      When Alice submits a valid hold with Idempotency-Key "<key>"
      Then the response status is 400
      And the error code is "INVALID_IDEMPOTENCY_KEY"
      And no booking is inserted

      Examples:
        | key       |
        | (missing) |
        | short     |
        | invalid key with spaces |

    Scenario Outline: Reuse matching requests and reject conflicting request-key reuse
      Given Alice already created a hold for "PAPER,PLASTIC" using key "pickup-alice-20300415-004"
      When Alice retries that key with "<change>"
      Then the response status is <status>
      And the outcome is "<outcome>"
      And exactly one booking exists for Alice and that key

      Examples:
        | change                            | status | outcome                  |
        | identical body                    | 201    | original booking UUID    |
        | same waste types in reversed order | 201   | original booking UUID    |
        | a different valid address         | 409    | IDEMPOTENCY_CONFLICT     |

    Scenario Outline: Defeat simultaneous double booking across users and service areas
      Given Bob Home has postal code "<bobPostal>"
      When Alice and Bob concurrently reserve Morning Slot with their own address UUIDs and distinct valid keys
      Then the response statuses are exactly "201,409"
      And the rejected request has error code "SLOT_NOT_AVAILABLE"
      And exactly one active booking owns Morning Slot

      Examples:
        | bobPostal |
        | 560038    |
        | 560001    |

    Scenario Outline: Reject slots outside the reservable window or provider capacity
      Given Morning Slot has condition "<condition>"
      When Alice sends an otherwise valid hold request
      Then the response status is 409
      And the error code is "SLOT_NOT_AVAILABLE"

      Examples:
        | condition                                              |
        | HELD by Bob                                            |
        | BOOKED by Bob                                          |
        | startAt is 2030-04-15T03:10:00Z at the hold boundary      |
        | belongs to Paper Trail rather than GreenCycle            |

    Scenario Outline: Reject overlapping intervals in either database profile
      Given the database profile is "<database>"
      When an internal maintenance insert adds a GreenCycle slot from "<start>" to "<end>"
      Then the database outcome is "<outcome>"

      Examples:
        | database | start                | end                  | outcome  |
        | SQLite   | 2030-04-16T03:45:00Z | 2030-04-16T04:45:00Z | rejected |
        | Postgres | 2030-04-16T03:45:00Z | 2030-04-16T04:45:00Z | rejected |
        | SQLite   | 2030-04-16T04:30:00Z | 2030-04-16T05:30:00Z | accepted |
        | Postgres | 2030-04-16T04:30:00Z | 2030-04-16T05:30:00Z | accepted |
        | Postgres | 2030-04-16T05:30:00Z | 2030-04-16T05:30:00Z | rejected |

    Scenario Outline: Treat stale browser availability as advisory
      Given the browser cached Morning Slot as AVAILABLE
      And the database now records Morning Slot as "<state>" for Bob
      When Alice submits a hold from the stale page
      Then the response status is 409 with code "SLOT_NOT_AVAILABLE"
      And the browser invalidates its availability queries
      And no second active booking is created

      Examples:
        | state  |
        | HELD   |
        | BOOKED |

    Scenario Outline: Enforce slot-state fields in the database
      Given the database profile is "<database>"
      When maintenance inserts a non-overlapping slot with status "<state>", holder "<holder>", expiry "<expiry>" and no active booking
      Then the database outcome is "<outcome>"

      Examples:
        | database | state     | holder | expiry               | outcome  |
        | SQLite   | AVAILABLE | null   | null                 | accepted |
        | Postgres | AVAILABLE | Alice  | null                 | rejected |
        | SQLite   | HELD      | null   | 2030-04-15T03:10:00Z | rejected |
        | Postgres | HELD      | Alice  | 2030-04-15T03:10:00Z | accepted |
        | SQLite   | BOOKED    | null   | null                 | rejected |
        | Postgres | BOOKED    | null   | null                 | rejected |

  @cancellation @expiry
  Rule: Unpaid reservations can be released without disturbing confirmed capacity

    Background:
      Given Alice owns Alice Booking and its linked slot
      And the booking hold expires at "2030-04-15T03:10:00Z"

    Scenario Outline: Cancel an unpaid hold and make repeated cancellation idempotent
      Given Alice Booking is "<before>"
      When Alice posts JSON "{}" to "/api/bookings/50000000-0000-4000-8000-000000000001/cancel"
      Then the response status is 200
      And Alice Booking is CANCELLED
      And the slot is AVAILABLE with no holder, expiry or active booking reference

      Examples:
        | before             |
        | PENDING_PAYMENT    |
        | PAYMENT_PROCESSING |
        | CANCELLED          |

    Scenario Outline: Refuse cancellation of a booking outside the unpaid states
      Given Alice Booking is "<before>"
      When Alice posts JSON "{}" to its cancellation endpoint
      Then the response status is 409
      And the error code is "INVALID_STATE"
      And the booking status remains "<before>"

      Examples:
        | before         |
        | PROCESSING     |
        | COMPLETED      |
        | EXPIRED        |
        | PAYMENT_FAILED |

    Scenario Outline: Expire pending holds at the boundary through cleanup
      Given Alice Booking is "<before>" and its slot is HELD
      When cleanup runs at "<now>"
      Then the booking is "<after>"
      And the slot is "<slot>"

      Examples:
        | before             | now                  | after              | slot      |
        | PENDING_PAYMENT    | 2030-04-15T03:09:59Z | PENDING_PAYMENT    | HELD      |
        | PENDING_PAYMENT    | 2030-04-15T03:10:00Z | EXPIRED            | AVAILABLE |
        | PAYMENT_PROCESSING | 2030-04-15T03:10:01Z | EXPIRED            | AVAILABLE |

    Scenario Outline: Keep paid capacity booked after an old hold deadline
      Given Alice Booking is "<state>" with a PAID payment and a BOOKED slot
      When cleanup runs at "2030-04-15T03:11:00Z"
      Then Alice Booking remains "<state>"
      And the slot remains BOOKED

      Examples:
        | state      |
        | PROCESSING |
        | COMPLETED  |

  @payments
  Rule: Only verified gateway outcomes confirm a pickup

    Background:
      Given Alice owns Alice Booking with a valid held slot
      And the stored booking amount is 14900 paise in "INR"
      And the gateway is a controlled mock or Razorpay test adapter
      And any matching signature in this rule is computed using the fixture gateway secret

    Scenario Outline: Create and reuse a server-priced payment order
      Given Alice Booking is "<state>"
      When Alice posts its UUID to "/api/payments/create" <requests> times
      Then each response status is 200
      And each response references the same payment and gateway order
      And the amount is 14900 and the currency is "INR"
      And only one durable payment exists for the booking

      Examples:
        | state              | requests |
        | PENDING_PAYMENT    | 1        |
        | PAYMENT_PROCESSING | 2        |

    Scenario Outline: Reject expired or uncertain payment-order creation
      Given payment creation has condition "<condition>"
      When Alice posts its booking UUID to "/api/payments/create"
      Then the response status is 409
      And the error code is "<error>"

      Examples:
        | condition                                            | error                    |
        | the booking hold has expired                          | HOLD_EXPIRED             |
        | creationStartedAt exists but no order ID was saved      | PAYMENT_CREATION_PENDING |

    Scenario Outline: Handle simulated payment outcomes through server-side settlement
      Given payment "order_fixture_001" has been created
      And the payment adapter is "mock"
      When Alice posts outcome "<outcome>" to "/api/payments/mock"
      Then the response status is 200
      And the booking status is "<booking>"
      And the payment status is "<payment>"
      And the slot status is "<slot>"

      Examples:
        | outcome | booking        | payment | slot      |
        | success | PROCESSING     | PAID    | BOOKED    |
        | failure | PAYMENT_FAILED | FAILED  | AVAILABLE |

    Scenario Outline: Reject mock payment operations in invalid contexts
      Given the payment adapter is "<adapter>" and the order state is "<order>"
      When Alice posts a successful mock payment for Alice Booking
      Then the response status is <status>
      And the error code is "<error>"

      Examples:
        | adapter  | order   | status | error               |
        | mock     | missing | 409    | PAYMENT_NOT_CREATED |
        | razorpay | created | 404    | NOT_FOUND           |

    Scenario Outline: Verify the stored order, HMAC and captured gateway details
      Given the stored gateway order is "order_fixture_001"
      And the gateway reports payment "pay_fixture_001" with captured flag "<captured>", amount <amount> and currency "<currency>"
      When Alice submits order "<order>" with signature kind "<signature>" to "/api/payments/verify"
      Then the response status is <status>
      And the outcome is "<outcome>"

      Examples:
        | order             | signature                | captured | amount | currency | status | outcome               |
        | order_fixture_001 | matching fixture HMAC    | true     | 14900  | INR      | 200    | PROCESSING and PAID    |
        | order_fixture_002 | matching submitted HMAC  | true     | 14900  | INR      | 400    | INVALID_PAYMENT       |
        | order_fixture_001 | 64 hexadecimal zeros     | true     | 14900  | INR      | 400    | INVALID_SIGNATURE     |
        | order_fixture_001 | matching fixture HMAC    | false    | 14900  | INR      | 409    | PAYMENT_NOT_CAPTURED  |
        | order_fixture_001 | matching fixture HMAC    | true     | 1      | INR      | 400    | INVALID_PAYMENT       |
        | order_fixture_001 | matching fixture HMAC    | true     | 14900  | USD      | 400    | INVALID_PAYMENT       |
        | order_fixture_001 | abc                      | true     | 14900  | INR      | 400    | VALIDATION_ERROR      |

    Scenario Outline: Preserve an already settled payment on retries
      Given "pay_fixture_001" has already settled Alice Booking as PROCESSING and PAID
      When the same valid proof is submitted <times> more times
      Then each response status is 200
      And there is one payment record and one BOOKED slot
      And the booking remains PROCESSING

      Examples:
        | times |
        | 1     |
        | 3     |

    Scenario Outline: Reject another payment ID for an already paid order
      Given "pay_fixture_001" has already settled Alice Booking as PROCESSING and PAID
      When Alice submits an otherwise valid signed proof for payment "<payment>" on the same order
      Then the response status is 409
      And the error code is "PAYMENT_CONFLICT"
      And the original paid payment ID is unchanged

      Examples:
        | payment         |
        | pay_fixture_002 |
        | pay_fixture_003 |

    Scenario Outline: Reject gateway order creation when the quoted totals differ
      Given the gateway returns a new order with amount <amount> and currency "<currency>"
      When Alice creates a payment for her 14900-paise INR booking
      Then the response status is 502
      And the error code is "GATEWAY_MISMATCH"
      And the booking is not confirmed

      Examples:
        | amount | currency |
        | 1      | INR      |
        | 14900  | USD      |

    Scenario Outline: Record late captured payments without reclaiming a released slot
      Given Alice Booking was "<released>" and its slot was released
      And a matching gateway payment is captured after the hold expires
      When the server settles that captured payment
      Then the payment status is "REFUND_REQUIRED"
      And Alice Booking remains "<released>"
      And no slot is reclaimed and no automatic refund is issued

      Examples:
        | released  |
        | EXPIRED   |
        | CANCELLED |

  @webhooks
  Rule: Webhooks require signatures and deduplicate settlement events

    Background:
      Given a pending payment order "order_fixture_001" belongs to Alice Booking
      And Alice Booking is PAYMENT_PROCESSING with an unexpired held slot
      And webhook signatures are computed over the exact raw JSON bytes using the fixture secret

    Scenario Outline: Handle signed gateway events according to their event type
      Given the fixture gateway confirms the capture when required
      When a correctly signed POST "/api/payments/webhook" carries event "<event>" with event ID "evt_fixture_001"
      Then the response status is 200 and data.received is true
      And the booking status is "<booking>"
      And the slot status is "<slot>"
      And <events> deduplication records exist for "evt_fixture_001"

      Examples:
        | event                | booking            | slot   | events |
        | payment.captured     | PROCESSING         | BOOKED | 1      |
        | payment.failed       | PAYMENT_PROCESSING | HELD   | 1      |
        | subscription.updated | PAYMENT_PROCESSING | HELD   | 0      |

    Scenario Outline: Apply repeated signed capture events only once
      Given event "evt_fixture_001" already settled "pay_fixture_001"
      When the same signed capture event is delivered <deliveries> additional times
      Then each response status is 200
      And one WebhookEvent exists for the gateway and event ID
      And one payment remains PAID with its original payment ID

      Examples:
        | deliveries |
        | 1          |
        | 4          |

    Scenario Outline: Reject webhook signatures and payload failures before settlement
      When POST "/api/payments/webhook" has condition "<condition>"
      Then the response status is 400
      And the error code is "<error>"
      And the pending booking is not confirmed

      Examples:
        | condition                                    | error             |
        | the raw JSON has an incorrect signature        | INVALID_SIGNATURE |
        | correctly signed body is malformed JSON        | INVALID_PAYLOAD   |
        | correctly signed JSON lacks a payment entity   | INVALID_PAYLOAD   |

  @history
  Rule: Pickup history is private and exposes state without inventing unsupported mutations

    Background:
      Given Alice has an authenticated session
      And Alice owns these booking fixtures:
        | booking | createdAt            | status     | amount | provider            |
        | newer   | 2030-04-15T02:00:00Z | PROCESSING | 14900  | GreenCycle Services |
        | older   | 2030-04-12T02:00:00Z | COMPLETED  | 7900   | Paper Trail         |
      And Bob has a separate booking fixture

    Scenario Outline: List only owned pickups with the newest first
      When Alice sends GET "<path>"
      Then the response status is 200
      And the returned order is "newer,older"
      And no Bob booking is present

      Examples:
        | path          |
        | /api/orders   |
        | /api/bookings |

    Scenario Outline: Render booking history details from stored snapshots
      Given Alice Booking has amount 14900 and starts at "2030-04-16T03:30:00Z"
      When Alice opens "<path>"
      Then the screen shows "GreenCycle Services" and INR amount "149"
      And the pickup time represents "09:00" in "Asia/Kolkata"
      And the address and waste details come from the booking snapshot

      Examples:
        | path                                                 |
        | /orders/50000000-0000-4000-8000-000000000001         |
        | /payment-result/50000000-0000-4000-8000-000000000001 |

  @navigation @browser
  Rule: Routes, history and asynchronous UI state remain consistent

    Background:
      Given the browser uses the API-backed frontend with BrowserRouter
      And provider and booking routes resolve the UUID aliases defined by the fixture

    Scenario Outline: Guard private routes and resume a safe intended destination
      Given the visitor has no valid session
      When the visitor opens "<target>" and then successfully signs in
      Then the visitor is returned to "<target>"

      Examples:
        | target                                                  |
        | /orders                                                 |
        | /addresses                                              |
        | /providers?wasteType=PAPER&location=Bengaluru             |
        | /checkout/50000000-0000-4000-8000-000000000001           |

    Scenario Outline: Fall back safely for invalid authentication return destinations
      Given the visitor enters login with return state "<destination>"
      When sign-in succeeds
      Then the browser stays within the application and navigates to "/providers"

      Examples:
        | destination                  |
        | https://untrusted.example    |
        | //untrusted.example          |
        | /login                       |
        | /providers\untrusted        |

    Scenario Outline: Recover from direct verification and unknown-route navigation
      Given the visitor has authentication state "<session>"
      When the visitor opens "<path>" without challenge navigation state
      Then the visible result is "<result>"

      Examples:
        | session      | path          | result                                  |
        | signed out   | /verify       | phone entry at /login                   |
        | signed in    | /             | collection page at /providers           |
        | signed in    | /unknown-path | friendly not-found screen and Back home |

    Scenario Outline: Browser Back restores filter state from the URL
      Given Alice browses "/providers" and applies "<first>" followed by "<second>"
      When Alice presses the browser Back button
      Then the collection filters match "<first>"
      And the provider query is refreshed for that filter state

      Examples:
        | first           | second                                    |
        | wasteType=PAPER | wasteType=PAPER&location=Bengaluru         |
        | location=Mysuru | location=Mysuru&slot=morning               |

    Scenario Outline: Restore booking drafts after managing an address
      Given Alice has selected Home, PAPER and Morning Slot on the GreenCycle booking page
      And those draft values are represented in the booking URL
      When Alice opens address management and returns using "<navigation>"
      Then the valid draft address, waste and slot selections are restored
      And a selected slot that became unavailable is cleared instead of reused

      Examples:
        | navigation             |
        | Back to your pickup    |
        | browser Back           |

    Scenario Outline: Route changes discard transient UI and prevent late redirects
      Given Alice has started "<operation>"
      When Alice navigates to "<destination>" before its asynchronous work finishes
      Then the operation does not redirect the departed page
      And no old modal, drawer or validation error is displayed on the destination
      And route-owned timers and event listeners are cleaned up

      Examples:
        | operation                         | destination |
        | opening a checkout payment        | /orders     |
        | editing an address form           | /providers  |
        | requesting a local OTP            | /unknown-path |

    Scenario Outline: Keep reservations independent of checkout navigation
      Given Alice Booking is "<state>"
      When Alice opens "/checkout/50000000-0000-4000-8000-000000000001"
      Then the resulting route is "<route>"
      And the booking status remains "<state>"

      Examples:
        | state              | route                                                    |
        | PENDING_PAYMENT    | /checkout/50000000-0000-4000-8000-000000000001           |
        | PROCESSING         | /payment-result/50000000-0000-4000-8000-000000000001     |
        | CANCELLED          | /payment-result/50000000-0000-4000-8000-000000000001     |

    Scenario Outline: Restore the hosted session after page reload
      Given a hosted guest has a valid refresh cookie and an owned pickup
      When the guest reloads "<route>"
      Then the refresh cookie rotates and the same guest identity is restored
      And the guest can read their persisted pickup

      Examples:
        | route                                              |
        | /orders                                            |
        | /orders/50000000-0000-4000-8000-000000000001        |

  @http @operations
  Rule: HTTP validation, operational checks and rate limits return predictable outcomes

    Background:
      Given request counters and the database state are isolated for the scenario

    Scenario Outline: Apply dedicated per-IP limits independently of the general API ceiling
      Given PUBLIC_DEMO_MODE and the route fixtures permit "<path>"
      And the general API counter is below 300 requests per minute
      And <previous> successful requests have occurred for this route within its configured window
      When another otherwise valid request reaches "<path>"
      Then the response status is 429
      And the error code is "RATE_LIMITED"
      And a Retry-After header is returned

      Examples:
        | path                 | previous |
        | /api/auth/demo       | 10       |
        | /api/payments/create | 20       |
        | /api/payments/verify | 30       |

    Scenario Outline: Reject invalid JSON mutations and unrecognized API routes
      Given Alice is authenticated and the configured origin is allowed
      When a request has condition "<condition>"
      Then the response status is <status>
      And the error code is "<error>"
      And the error envelope includes a requestId without a stack trace

      Examples:
        | condition                                                     | status | error                  |
        | POST /api/addresses uses text/plain                            | 415    | UNSUPPORTED_MEDIA_TYPE |
        | POST /api/addresses sends malformed application/json            | 400    | INVALID_JSON           |
        | GET /api/addresses/not-a-uuid                                   | 400    | VALIDATION_ERROR       |
        | GET /api/nonexistent                                           | 404    | NOT_FOUND              |

    Scenario Outline: Apply the general API ceiling before executing a route
      Given this IP has sent <previous> API requests within the current minute
      When the IP sends GET "/api/health"
      Then the response status is 429 with code "RATE_LIMITED"
      And a Retry-After header is returned

      Examples:
        | previous |
        | 300      |
        | 301      |

    Scenario Outline: Verify database connectivity through the public health endpoint
      Given the database is "<database>"
      When an anonymous client sends GET "/api/health"
      Then the response status is <status>
      And the response outcome is "<outcome>"

      Examples:
        | database    | status | outcome                         |
        | reachable   | 200    | data.status=ok                  |
        | unavailable | 500    | error.code=INTERNAL_ERROR       |

  @static_demo
  Rule: The optional Pages presentation is explicitly separate from the persisted hosted app

    Background:
      Given VITE_DEMO_MODE is "true" and the frontend uses HashRouter
      And browser-only fixtures are loaded into tab memory

    Scenario Outline: Explore the static demo without making backend requests
      When a recruiter opens "<route>"
      Then the screen shows "<screen>"
      And the demo banner explains that data resets on reload
      And no backend API request, real OTP or real payment is made

      Examples:
        | route         | screen             |
        | /#/providers  | collection partners |
        | /#/addresses  | fictional addresses |
        | /#/orders     | sample pickups      |

    Scenario Outline: Reset tab-local mutations without changing persisted cloud data
      Given the recruiter created an additional browser-only pickup
      When the recruiter performs "<reset>"
      Then the seeded sample records are restored
      And the additional browser-only pickup is absent
      And no hosted database record is changed

      Examples:
        | reset          |
        | page reload    |
        | Reset demo     |

  Rule: Ask Loop remains read-only and grounds results in the catalog

    Background:
      Given Ask Loop uses an injected deterministic model and real read-only MCP tools
      And Alice is signed in with a verified JWT

    Scenario Outline: Expose only configured assistant capabilities
      Given the backend assistant flag is "<flag>" and its chat credential is "<credential>"
      When Alice opens "/ask"
      Then assistant availability is "<availability>"
      And ordinary provider discovery and booking remain available

      Examples:
        | flag  | credential | availability |
        | false | missing    | disabled     |
        | true  | missing    | unconfigured |
        | true  | configured | enabled      |

    Scenario Outline: Require every material and live covered availability
      Given the mock intent identifies "<materials>" at "Alice Home" on "2030-04-16" after "16:00"
      And the catalog and live slots have state "<catalog>"
      When Alice asks "Find my pickup options, cheapest first"
      Then the assistant returns outcome "<outcome>"
      And no hold, booking, payment or address is created or changed

      Examples:
        | materials     | catalog                                       | outcome      |
        | PAPER,PLASTIC | provider covers Home and accepts both; 17:00 slot | results   |
        | PAPER,PLASTIC | provider accepts only PAPER                   | no_providers |
        | PAPER,PLASTIC | provider accepts both but covers another postcode | no_providers |
        | PAPER,PLASTIC | eligible provider has no live slot after 16:00 | no_slots   |

    Scenario Outline: Review image suggestions before provider search
      Given a normalized image suggests PAPER and an unresolved container
      And Alice edits the selected categories to "PAPER,PLASTIC"
      When Alice confirms materials "<confirmed>" and acknowledges unresolved items "<acknowledged>"
      Then photo-derived search is "<allowed>"

      Examples:
        | confirmed | acknowledged | allowed |
        | false     | false        | blocked |
        | true      | false        | blocked |
        | true      | true         | allowed |

    Scenario Outline: Reject private selections and unsupported actions
      Given the request contains "<input>"
      When Alice submits the assistant request
      Then the response is "<result>"
      And Bob's private resources and all application mutations remain inaccessible

      Examples:
        | input                                  | result                       |
        | Bob Home as selected address UUID      | 404 NOT_FOUND before AI call |
        | model category GOLD                    | 502 AI_INVALID_OUTPUT        |
        | medical unknown item mixed with paper  | unsupported clarification    |
        | write an unrelated poem                | fixed Loop scope reply       |
        | cancel my pickup                       | existing orders navigation   |
        | call delete_booking using MCP          | ASSISTANT_TOOL_REJECTED       |

    Scenario Outline: Preserve normal handoff and prevent stale assistant updates
      Given Alice has assistant results for a real provider and slot
      When "<event>" occurs
      Then the interface shows "<result>"
      And the assistant does not reserve or pay for a pickup

      Examples:
        | event                                       | result                                    |
        | Alice selects Review pickup                 | existing booking form with validated draft |
        | another user reserves before the form loads  | fresh availability without the stale slot |
        | Alice cancels and an old response arrives    | no stale result replaces the current page |
        | Alice navigates to manual search during AI   | manual page remains active                |
