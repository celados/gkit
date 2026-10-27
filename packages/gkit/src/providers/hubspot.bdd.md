# HubSpot read provider — BDD spec

> Context: Add HubSpot behind gkit's existing profile-bound Growth Capability Runtime.
> Status: **Implemented and verified for the V1 read-only slice**

---

## Scope boundaries

**Included:**

- One profile-bound HubSpot private-app access token.
- Offline capability discovery and describe.
- Safe account-connectivity doctor.
- Reviewed reads for CRM property metadata, object listing and search, record associations, event occurrences, pipelines, and owners.
- Bounded pagination, artifact-only provider payloads, request IDs, cancellation, timeout, and redacted errors.

**Not included:**

- OAuth, multiple HubSpot accounts in one invocation, arbitrary URL passthrough, sensitive-property opt-in, mutations, imports, or provider workflow orchestration.
- Claims or conclusions derived from provider facts.

---

## Public seams

The executable behavior is tested through these existing public seams:

1. Profile loading and `env:` secret resolution.
2. Offline manifest discovery and capability describe.
3. `gkit --profile <app> hubspot doctor`.
4. `gkit --profile <app> hubspot api call --capability-id <id> --input <json> --out <path>`.
5. The common response envelope and artifact receipt.

---

## Feature 1: Profile and doctor

### Scenario 1.1: Parse one HubSpot binding

```gherkin
Given a profile binds provider hubspot with no config and accessToken as an env reference
When gkit loads the profile
Then the non-secret provider configuration is accepted
  And the access token is resolved only for doctor or live execution
```

### Scenario 1.2: Reject credentials outside the secret map

```gherkin
Given a HubSpot profile places a token or transport override in config
When gkit loads the profile
Then profile validation fails before provider dispatch
```

### Scenario 1.3: Verify safe account connectivity

```gherkin
Given one valid profile-bound private-app token
When the Agent runs hubspot doctor
Then gkit calls only the fixed account details endpoint
  And reports the connected portal identifier without returning the token
```

### Scenario 1.4: Report doctor authentication and transport failures

```gherkin
Given HubSpot rejects or cannot complete the account details request
When the Agent runs hubspot doctor
Then gkit returns the common non-zero failure envelope
  And maps authentication, permission, rate-limit, timeout, network, and provider failures without projecting provider messages or PII
```

---

## Feature 2: Discovery and read-only dispatch

### Scenario 2.1: Discover the reviewed surface offline

```gherkin
Given the committed HubSpot manifest
When an Agent requests schema or describes a HubSpot capability
Then gkit exposes only reviewed read capabilities
  And discovery does not load a profile or resolve a secret
```

### Scenario 2.2: Reject unreviewed and mutating operations

```gherkin
Given an operation ID is absent from the HubSpot manifest or its adapter key is not reviewed
When an Agent requests execution
Then gkit rejects the request before secret resolution and provider dispatch
```

### Scenario 2.3: Dry-run through the common call shape

```gherkin
Given a valid HubSpot read input and profile configuration
When the Agent adds --dry-run
Then gkit returns the fixed method and endpoint plan plus an input digest and artifact path
  And does not resolve the token, reserve an artifact, or send a network request
```

---

## Feature 3: Bounded CRM data access

### Scenario 3.1: Enforce the object allowlist

```gherkin
Given a request names a CRM object outside contacts, companies, deals, or tickets
When gkit validates or prepares the request
Then the request fails before provider dispatch
```

### Scenario 3.2: Enforce object-specific property allowlists

```gherkin
Given a list or search request omits properties or includes a property outside the reviewed allowlist for its object type
When gkit prepares the request
Then the request fails before provider dispatch
```

### Scenario 3.3: Bound listing pagination

```gherkin
Given a valid CRM object listing request
When HubSpot returns paging cursors
Then gkit follows cursors only until the requested total limit
  And each page is at most 100 records
  And the artifact contains the bounded combined result
```

### Scenario 3.4: Bound CRM Search POST

```gherkin
Given a valid CRM search request
When gkit dispatches the request
Then it uses POST only to the fixed search endpoint
  And each page is at most 200 records
  And the query body is at most 3000 encoded characters
  And no request may page beyond HubSpot's 10000-result query limit
```

### Scenario 3.5: Bound associations and event occurrences

```gherkin
Given a valid association or event-occurrence request with reviewed event properties
When HubSpot returns paging cursors
Then gkit follows only provider-returned cursors until the operation limit
  And it never follows provider-returned links or accepts arbitrary event property query keys
```

---

## Feature 4: Outcomes, artifacts, and secrecy

### Scenario 4.1: Publish raw provider facts only as an artifact

```gherkin
Given a successful HubSpot response
When live execution completes
Then stdout contains only the common compact envelope and artifact receipt
  And the complete bounded provider data is written to the requested no-replace artifact
```

### Scenario 4.2: Preserve response evidence for confirmed provider failures

```gherkin
Given HubSpot returns a 4xx, 429, or 5xx response body
When gkit maps the failure
Then the response body may be published to the requested artifact after secret scanning
  And the envelope contains only allowlisted HTTP status, category, request ID, and retry metadata
```

### Scenario 4.3: Classify interrupted outcomes

```gherkin
Given cancellation or timeout occurs before dispatch
When gkit handles the invocation
Then it reports not_dispatched

Given cancellation, timeout, or network loss occurs after dispatch begins
When no provider response is available
Then it reports an unknown provider outcome
```

### Scenario 4.4: Redact the access token everywhere

```gherkin
Given a provider response, exception, request ID, or artifact contains the access token or an encoded form
When gkit serializes the envelope or publishes the artifact
Then the token is absent from stdout and artifact metadata
  And unsafe artifact publication fails closed
```

---

## Acceptance checklist

- [x] Profile parsing and secret resolution are strict and profile-bound.
- [x] Doctor performs only a fixed safe account-details GET.
- [x] Manifest discovery and describe remain offline.
- [x] All executable capabilities have exactly one `read` effect and no cost.
- [x] Object, property, method, endpoint, pagination, and total-result bounds are enforced.
- [x] Search uses bounded POST and enforces 200/page, 3,000 characters, and 10,000/query.
- [x] HTTP/auth/rate-limit/timeout/network/cancellation outcomes use the common envelope.
- [x] Provider payloads require `--out` and preserve no-replace behavior.
- [x] Access tokens never enter source, snapshots, envelopes, provider request IDs, or artifact metadata.
- [x] Provider inventory, capability docs, and README state PII boundaries.
