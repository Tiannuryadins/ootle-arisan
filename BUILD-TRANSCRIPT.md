# BUILD-TRANSCRIPT — Arisan (ootle-arisan)

Tari November Build Contest (MVP theme). Built 14–15 November 2026 by an AI
agent (Muse) on behalf of the submitter. All code in this repository was
written fresh for this contest (after the 1 November 2026 theme announcement);
no code was borrowed from other submissions. Reference material used: the
official Tari docs (ootle.tari.com), the official `tari-project/wasm-template`
and `tari-project/wasm-examples` repositories, and the `tari_template_lib` /
`tari_template_test_tooling` crates on crates.io.

## Idea selection

The November MVP thread listed 13 existing entries at the time of writing:
QuietTicket (voting), Ootle Pass (memberships), Ootip (tip jars), Signal Desk
(sealed calls), Ootle Lockbox (time-locks), OotleInvoice (invoices), Allowance
(agent spending caps), Skydrop + ATProto (Bluesky tips), Specter (privacy
evidence), hidebox (encrypted file sales), Launch Commitments (token launches),
Stake (private commitments), Ghostline (pay-per-call channels).

**Chosen idea: Arisan — rotating savings circles (ROSCA).** No existing entry
does group/rotating savings. It is a real, large, proven use case (arisan in
Indonesia, tandas in Latin America, susus in West Africa/Caribbean, hui in
China, stokvels in South Africa — hundreds of millions of users), and its
core trust problem (a member vanishing after taking the pot early) is exactly
what a smart contract fixes: the template holds the pot, enforces the
rotation and the contributions, and nobody — not even the organizer — can run
off with the funds. It is also ideal for the walletless demo path: a judge
can click through a full 3-member, 3-round circle in about two minutes, and
the default/rollover/leftover mechanics are visible state transitions.

## What was built

1. **Template** (`src/lib.rs`, ~600 lines): `ArisanCircle` — `#[template]`,
   `tari_template_lib` 0.40.1. One component, one XTM vault, bitmask state
   (per-round payment bits, defaulted / paid-out / leftover-claimed /
   refunded bitmasks). Methods: `create` (mints a single-use organizer badge
   NFT), `join`, `contribute`, `payout` (permissionless), `claim_leftover`,
   `cancel`, `refund`, plus 17 views. Key design decisions:
   - Joining pays the round-0 contribution up front; the circle auto-starts
     when full (no separate "start" step to forget).
   - Payout is permissionless and settles on "all good-standing members paid
     OR deadline passed", so a circle can never stall on an absent member.
   - Defaulters lose their payout turn and their past contributions; the pot
     rolls over. At completion, leftover is claimable in equal shares by
     members in good standing; if everyone defaulted, anyone may claim, so
     funds are never stuck (last claimer takes dust).
   - The template checks the payment, not the signer — paying for another
     member is possible by design (gift contributions).
2. **Engine tests** (`tests/test.rs`, 12 tests, `tari_template_test_tooling`
   0.53.4): full 3-member circle (zero-sum), create validation (4 cases),
   wrong-amount/duplicate join, double contribute, non-member contribute,
   early payout, defaulter + rollover, leftover claims, all-default fallback
   (100 split 33/33/34), cancel + refunds, wrong-badge cancel.
3. **Walletless demo** (`docs/`): a JS mirror engine (`arisan.js`) with the
   exact template semantics and error strings, a single-page app
   (`index.html` + `app.js` + `style.css`, no dependencies, no external
   assets), and a Node test suite (`arisan.test.mjs`, 22 tests) mirroring the
   Rust scenarios. Verified in headless Chrome: full auto-play, default
   simulation, cancel/refund flows, zero JS exceptions, mobile layout checked.

## Toolchain

- Rust 1.100.0 (stable) via rustup + `wasm32-unknown-unknown` target,
  installed fresh on the build VM (no Rust was present).
- `cargo build --release --target wasm32-unknown-unknown` — clean.
- `cargo test` — 12/12 pass.
- `node --test docs/arisan.test.mjs` — 22/22 pass.
- `tari_template_lib = "0.40"` (0.40.1), `tari_template_test_tooling = "0.53"`
  (0.53.4) — latest on crates.io at build time.
- No money was spent. No testnet deployment was made (the walletless demo is
  the judging path; Esmeralda deployment is a possible follow-up).

## Verification notes

- The native-token constant was verified from the crate source:
  `TARI_TOKEN = STEALTH_TARI_RESOURCE_ADDRESS`
  (`tari_template_lib_types::constants`); the test harness faucet dispenses
  the same resource, so engine-test payments exercise the real check.
- `XTR` (used in the official wasm-template auction example) does not exist
  as a constant in `tari_template_lib` 0.40 / types 0.39 — the example is
  stale relative to the current crates. `TARI_TOKEN` is used throughout.
- The JS mirror engine was checked against `src/lib.rs` line by line for
  semantics and error strings; the one structural difference is that JS
  cannot have a field and a method with the same name, so the deadline is
  stored as `_roundDeadlineEpoch` internally while the view keeps the name
  `roundDeadlineEpoch()`.

## Submission package

See `SUBMISSION.md` for the project description, links, and announcement
drafts (Bluesky / Reddit / Medium / YouTube).
