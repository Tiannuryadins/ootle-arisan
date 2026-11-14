# Arisan — Rotating Savings Circles on Tari Ootle

**Tari November Build Contest (MVP theme) entry.**

An *arisan* is one of the world's oldest savings institutions: a group of
people each contribute a fixed amount every round, and each round one member
— in rotation — takes the whole pot. It is called *arisan* in Indonesia,
*tanda* in Latin America, *susu* in West Africa and the Caribbean, *hui* in
China, and *stokvel* in South Africa. Hundreds of millions of people save
this way — and the scheme has one classic failure: a member who takes the pot
early and then stops contributing.

**Arisan fixes that failure with a smart contract.** Contributions are held by
the circle component, the rotation order is fixed at join time, and the rules
are enforced by the template — no organizer can run off with the pot, and no
member can take the pot and vanish.

> **Live demo (walletless):** https://tiannuryadins.github.io/ootle-arisan/
>
> The demo simulates the template logic in your browser — no wallet, no
> sign-up, no money. Click **Load 3-member demo**, then **Auto-play full
> circle** to watch a complete circle, or **Simulate a default** to see what
> happens when a member stops paying.

## How it works

1. **Create a circle.** The organizer picks a contribution amount, a member
   count (2–16), and a round length in epochs. Creating a circle mints a
   single organizer badge (an NFT) that authorizes cancelling the circle.
2. **Join.** Joining costs exactly one contribution, paid up front — that is
   the round-0 contribution. Members join in payout order: the first to join
   is paid out in round 0. The circle starts automatically once the last seat
   is taken.
3. **Contribute each round.** Every round, every member in good standing
   contributes the fixed amount. Anyone may pay on a member's behalf (a gift
   contribution — the template checks the amount and the member slot, not the
   signer).
4. **Payout.** `payout` is permissionless: once every member in good standing
   has paid for the round, or the round deadline has passed, anyone can settle
   the round. The whole pot goes to that round's recipient.
5. **Defaults.** A member who misses a round deadline is marked as defaulted:
   they lose their payout turn (the pot rolls over to the next round) and
   their past contributions stay in the pot. They cannot contribute again.
6. **Leftover.** When the circle completes, any leftover pot (from rolled-over
   rounds) is claimable in equal shares by the members in good standing. If
   every member defaulted, any member may claim an equal share, so funds are
   never stuck. The last claimer takes any dust.
7. **Cancel.** While a circle is still forming, the organizer can cancel it
   with their organizer badge (burned on use). Joined members can then refund
   their contribution.

## Template API

`src/lib.rs` — `ArisanCircle` (`#[template]`, `tari_template_lib` 0.40).

| Method | Description |
|---|---|
| `create(organizer, contribution, max_members, round_length_epochs)` | New circle + organizer badge NFT |
| `join(member, payment)` | Join a forming circle (payment = 1 contribution) |
| `contribute(member, payment)` | Pay the current round's contribution |
| `payout()` | Settle the current round (permissionless) |
| `claim_leftover(member)` | Claim an equal share of the leftover pot |
| `cancel(organizer_badge)` | Cancel a forming circle (badge required) |
| `refund(member)` | Refund one contribution after a cancel |

Views: `status_code` (0 Forming, 1 Active, 2 Completed, 3 Cancelled),
`organizer`, `contribution`, `max_members`, `round_length_epochs`, `members`,
`member_count`, `current_round`, `round_deadline_epoch`, `pot_balance`,
`round_recipient`, `has_paid(round, index)`, `is_defaulted(index)`,
`has_received_payout(index)`, `has_claimed_leftover(index)`,
`member_index(member)`, `leftover_share`.

## Tests

Engine tests (Tari engine test harness, `tari_template_test_tooling` 0.53):

```
cargo test
```

12 tests, all passing:

- `full_circle_three_members` — happy path, 3 rounds, balances net to zero-sum
- `create_rejects_invalid_params` — zero contribution, 1 member, 17 members, zero round length
- `join_rejects_wrong_amount`, `join_rejects_duplicate_member`
- `contribute_rejects_double_payment`, `contribute_rejects_non_member`
- `payout_rejects_early`
- `defaulter_loses_payout_and_pot_rolls_over`
- `leftover_claims_after_final_rollover`
- `all_default_leftover_still_claimable` (100 split 33/33/34, last claimer takes dust)
- `cancel_and_refund`, `cancel_rejects_wrong_badge`

The walletless demo's JS mirror engine has its own test suite:

```
node --test docs/arisan.test.mjs
```

Build the template to Wasm:

```
cargo build --release --target wasm32-unknown-unknown
```

## Honest limits

- **Amounts are public.** Deposits into a component vault go through revealed
  outputs, so contribution amounts, payouts and membership are visible on
  chain. Member identities are only account addresses — no names, no KYC.
- **Payments are not signer-bound.** A member's identity on a call is the
  account address passed to the method; the template checks the payment, not
  the signer. Paying for another member is possible by design (gifts) — but
  it also means nobody can prove *who* paid for a slot.
- **No late-payment grace.** A member who misses a deadline by one epoch
  defaults permanently. A future version could add a grace window or a
  reinstatement path.
- **Unaudited.** This template has engine tests but no security audit. Keep
  contributions small.

## Project layout

```
ootle-arisan/
├── src/lib.rs            # ArisanCircle template
├── tests/test.rs         # Engine tests (12)
├── docs/                 # Walletless demo (GitHub Pages)
│   ├── index.html
│   ├── app.js
│   ├── arisan.js         # JS mirror of the template logic
│   ├── arisan.test.mjs   # Node tests for the mirror engine
│   └── style.css
├── Cargo.toml
├── LICENSE               # MIT
├── README.md
└── BUILD-TRANSCRIPT.md   # How this entry was built
```

## License

MIT. See [LICENSE](LICENSE).
