# SUBMISSION.md — Arisan (ootle-arisan)

Tari November Build Contest (MVP theme). Submission deadline: **1 December
2026, 00:00 UTC (07:00 WIB)**.

Submit as a reply to the council's thread:
https://community.tari.com/t/november-build-contest-thread-mvp/520

## Links

- **Code (public repo):** https://github.com/tiannuryadins/ootle-arisan
  (repo to be created by the submitter; code is ready in `~/workspace/tari-mvp/`)
- **Live demo (walletless):** https://tiannuryadins.github.io/ootle-arisan/
  (GitHub Pages, served from `docs/` — enable Pages on the repo after pushing:
  Settings → Pages → Source: Deploy from a branch → Branch: main, Folder: /docs)
- **Tari payment address:** _[USER: paste your Tari wallet address here]_
- **Social post:** _[USER: post one of the drafts below publicly, then paste the link here]_

## Forum reply (paste-ready)

> **Arisan — rotating savings circles (ROSCA) on Tari Ootle**
>
> An arisan is one of the world's oldest savings institutions: a group of
> people each contribute a fixed amount every round, and each round one member
> — in rotation — takes the whole pot. It is called *arisan* in Indonesia,
> *tanda* in Latin America, *susu* in West Africa and the Caribbean, *hui* in
> China, and *stokvel* in South Africa. Hundreds of millions of people save
> this way — and the scheme has one classic failure: a member who takes the
> pot early and then stops contributing.
>
> Arisan fixes that failure with a smart contract. The `ArisanCircle`
> template holds the pot, fixes the rotation order at join time, and enforces
> the rules: joining pays the first round's contribution up front; the circle
> auto-starts when full; payout is permissionless once everyone in good
> standing has paid or the round deadline passes; a member who misses a
> deadline defaults — they lose their payout turn, the pot rolls over, and
> their past contributions stay in the pot. When the circle completes, any
> leftover is claimable in equal shares by the members in good standing (and
> if everyone defaulted, anyone may claim, so funds are never stuck). The
> organizer can cancel a forming circle with a single-use organizer badge
> NFT, and joined members can then refund.
>
> - **Code:** https://github.com/tiannuryadins/ootle-arisan (MIT, `src/lib.rs`,
>   `tari_template_lib` 0.40)
> - **Live demo (walletless, no wallet needed):**
>   https://tiannuryadins.github.io/ootle-arisan/ — click *Load 3-member
>   demo*, then *Auto-play full circle*, or *Simulate a default* to see the
>   default/rollover/leftover mechanics.
> - **Tests:** 12 engine tests (`cargo test`, all passing) covering the full
>   circle, defaults + rollover, leftover claims (including the all-default
>   33/33/34 split), cancel + refunds, and all rejection paths; plus 22 Node
>   tests for the demo's mirror engine (`node --test docs/arisan.test.mjs`).
>
> Honest limits, documented in the README: contribution amounts, payouts and
> membership are public (deposits into a component vault go through revealed
> outputs); payments are not signer-bound (paying for another member is
> possible by design — gift contributions); there is no late-payment grace
> window yet; and the template is unaudited — keep contributions small.
>
> **Tari payment address:** _[address]_
>
> **Announcement post:** _[link]_

## Announcement drafts

The rules require a public social post this month (Bluesky, Reddit, Medium,
or YouTube — X is NOT accepted). Pick one, post it, and paste the link into
the forum reply above.

### Bluesky (under 300 characters)

> Arisan — rotating savings circles on Tari Ootle. A group saves together,
> each round one member takes the pot, and the smart contract makes sure
> nobody can take the pot and vanish. Try the walletless demo:
> https://tiannuryadins.github.io/ootle-arisan/ #Tari #Ootle

### Reddit (r/tari)

**Title:** Arisan — rotating savings circles (ROSCA) on Tari Ootle [November MVP entry]

**Body:**

> I built Arisan for the November Build Contest: a rotating savings circle
> on Ootle. Everyone contributes a fixed amount each round; each round one
> member takes the whole pot. The template holds the pot and enforces the
> rules, so the classic arisan failure — someone takes the pot early and
> stops paying — can't happen. Defaulters lose their turn, the pot rolls
> over, and leftover is shared at the end.
>
> - Walletless demo (no wallet needed):
>   https://tiannuryadins.github.io/ootle-arisan/
> - Code (MIT): https://github.com/tiannuryadins/ootle-arisan
> - 12 engine tests passing, plus 22 tests for the demo engine.
>
> Feedback welcome — especially on the default/leftover mechanics.

### Medium (short article outline — expand to ~400 words when posting)

**Title:** Arisan on Tari: the world's oldest savings circle, enforced by a smart contract

1. What an arisan is (Indonesia's rotating savings circle; tandas, susus,
   hui, stokvels — hundreds of millions of users).
2. The one failure mode: take the pot early, stop contributing.
3. What the template does: holds the pot, fixed rotation, permissionless
   payout, defaults + rollover, leftover sharing, organizer cancel + refunds.
4. Try it: walletless demo link + what to click (auto-play, simulate a
   default).
5. Honest limits: amounts public, no grace window, unaudited.
6. Links: repo + demo + contest thread.

### YouTube (if recording a walkthrough — description draft)

> Arisan — rotating savings circles on Tari Ootle (November Build Contest
> MVP entry). A group saves together, each round one member takes the pot,
> and the smart contract guarantees nobody can take the pot and vanish. This
> video walks through the walletless demo: a full 3-member circle, then a
> member defaulting — the pot rolls over and the leftover is shared at the
> end.
>
> Demo: https://tiannuryadins.github.io/ootle-arisan/
> Code (MIT): https://github.com/tiannuryadins/ootle-arisan

## Pre-submit checklist (for the submitter)

- [ ] Create public repo `ootle-arisan` on GitHub (user: tiannuryadins) and
      push the code in `~/workspace/tari-mvp/` (the tree is git-initialised
      and committed locally; `research/` and `target/` are git-ignored).
- [ ] Enable GitHub Pages: Settings → Pages → Deploy from a branch → main,
      /docs. Verify https://tiannuryadins.github.io/ootle-arisan/ loads.
- [ ] Create a Tari wallet (or reuse an existing one) and copy the payment
      address into the forum reply.
- [ ] Post one announcement (Bluesky / Reddit / Medium / YouTube) and copy
      its link into the forum reply.
- [ ] Post the reply to
      https://community.tari.com/t/november-build-contest-thread-mvp/520
      before 1 Dec 2026 00:00 UTC (07:00 WIB).
