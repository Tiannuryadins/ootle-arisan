// Arisan — rotating savings circles (ROSCA) on Tari Ootle.
//
// Walletless demo engine: a plain-JavaScript mirror of the Rust template in
// ../src/lib.rs (tari_template_lib 0.40). It implements the exact same
// state machine, the same method names (camelCase in JS, snake_case in Rust)
// and the same error strings, so the demo page behaves exactly like the
// on-chain template — without a wallet, a node, or any network access.
//
// Amounts are integer micro-Tari (1 TARI = 1,000,000 micro-Tari), mirroring
// the template's `Amount` type. All arithmetic is integer arithmetic; the
// only division is the floor division in `claimLeftover`.
//
// Differences from the on-chain template (all deliberate, all documented):
//  - Members are address strings ("comp_...") instead of ComponentAddress.
//  - `currentEpoch` is a field the demo advances by hand (`setEpoch` /
//    `advanceEpochs`); on-chain it comes from `Consensus::current_epoch()`.
//  - `cancel(hasBadge)` takes a boolean instead of an NFT bucket: `true`
//    means the caller presented the genuine organizer badge.
//  - The engine also keeps simulated per-member balances (every demo account
//    starts with 1,000 TARI) plus `received` / `contributed` totals, so the
//    UI can show net positions. On-chain these live in account components,
//    not in the template. Balance bookkeeping never changes the rules:
//    no engine method rejects a call for insufficient balance.
//  - The template's account checks ("Not an account component",
//    "Only TARI is accepted") have no meaning in a walletless simulation
//    and are not mirrored.
//
// Original work written for the Tari November Build Contest (MVP theme).
// MIT License.
(function (global, factory) {
  const api = factory();
  // Node / CommonJS (used by arisan.test.mjs).
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  // Browser classic script: window.Arisan.
  global.Arisan = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /// Micro-Tari in one TARI.
  const MICRO_TARI_PER_TARI = 1_000_000;

  /// Every simulated demo account starts with 1,000 TARI.
  const STARTING_BALANCE = 1000 * MICRO_TARI_PER_TARI;

  /// Maximum members in one circle (matches MAX_MEMBERS in lib.rs).
  const MAX_MEMBERS = 16;

  /// Lifecycle codes, matching `CircleStatus::code()` in lib.rs.
  const STATUS = Object.freeze({
    FORMING: 0,
    ACTIVE: 1,
    COMPLETED: 2,
    CANCELLED: 3,
  });

  const STATUS_NAMES = Object.freeze([
    "Forming",
    "Active",
    "Completed",
    "Cancelled",
  ]);

  function fail(message) {
    throw new Error(message);
  }

  function assertInteger(value, message) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      fail(message);
    }
  }

  /// Convert a TARI amount (may be fractional, e.g. 0.5) to integer micro-Tari.
  function toMicroTari(tari) {
    return Math.round(tari * MICRO_TARI_PER_TARI);
  }

  /// Format an integer micro-Tari amount as TARI, trimming trailing zeros
  /// ("10", "0.5", "33.333333").
  function formatTari(microTari) {
    const sign = microTari < 0 ? "-" : "";
    const abs = Math.abs(microTari);
    const whole = Math.floor(abs / MICRO_TARI_PER_TARI);
    const frac = abs % MICRO_TARI_PER_TARI;
    if (frac === 0) {
      return sign + String(whole);
    }
    return sign + whole + "." + String(frac).padStart(6, "0").replace(/0+$/, "");
  }

  class ArisanCircle {
    /// Create a new circle. Returns the circle; the organizer badge is
    /// conceptually minted to the organizer (the demo tracks it as a
    /// boolean passed to `cancel`).
    static create(organizer, contribution, maxMembers, roundLengthEpochs) {
      return new ArisanCircle(organizer, contribution, maxMembers, roundLengthEpochs);
    }

    constructor(organizer, contribution, maxMembers, roundLengthEpochs) {
      // Validation order matches `create` in lib.rs.
      assertInteger(contribution, "Contribution must be greater than zero");
      if (contribution <= 0) fail("Contribution must be greater than zero");
      assertInteger(maxMembers, "A circle needs at least 2 members");
      if (maxMembers < 2) fail("A circle needs at least 2 members");
      if (maxMembers > MAX_MEMBERS) fail("A circle can have at most 16 members");
      assertInteger(roundLengthEpochs, "Round length must be at least 1 epoch");
      if (roundLengthEpochs < 1) fail("Round length must be at least 1 epoch");

      this.organizer = organizer;
      this.contribution = contribution;
      this.maxMembers = maxMembers;
      this.roundLengthEpochs = roundLengthEpochs;
      /// Members in join order. The payout rotation follows this order:
      /// round `r` pays `members[r]`.
      this.members = [];
      /// `paid[round]` is a bitmask of the member indices who paid that round.
      this.paid = new Array(maxMembers).fill(0);
      /// Bitmask of members who missed a round deadline.
      this.defaulted = 0;
      /// Bitmask of members whose payout turn has passed (paid out or forfeited).
      this.paidOut = 0;
      /// Bitmask of members who claimed their leftover share.
      this.leftoverClaimed = 0;
      /// Bitmask of members refunded after a cancel.
      this.refunded = 0;
      /// Current round index (0-based). There is one round per member.
      this.round = 0;
      // Named with a leading underscore because JS (unlike Rust) cannot
      // have a field and a method with the same name; the view is
      // `roundDeadlineEpoch()`, and `snapshot()` exposes it under its
      // plain name.
      this._roundDeadlineEpoch = 0;
      this.status = STATUS.FORMING;
      /// The pot, in micro-Tari (a Vault on-chain).
      this.pot = 0;
      /// Simulated consensus epoch. On-chain this is read from consensus;
      /// the demo advances it with `setEpoch` / `advanceEpochs`.
      this.currentEpoch = 0;
      /// Whether the organizer badge has been burned by `cancel`.
      this.badgeBurned = false;

      // --- Simulation-only bookkeeping (not part of the template) --------
      /// address -> current simulated balance (micro-Tari).
      this.balances = new Map();
      /// address -> total received from the circle (payouts + leftover + refunds).
      this.received = new Map();
      /// address -> total paid into the circle (joins + contributions).
      this.contributed = new Map();
    }

    // ------------------------------------------------------------------
    // Methods (mirror the template methods one-for-one)
    // ------------------------------------------------------------------

    /// Join a forming circle. The payment is exactly one contribution and
    /// counts as this member's round-0 contribution. Members join in payout
    /// order: the first to join is paid out in round 0. The circle starts
    /// automatically when the last seat is taken.
    join(member, amount) {
      if (this.status !== STATUS.FORMING) fail("Circle is not forming");
      if (this.members.length >= this.maxMembers) fail("Circle is already full");
      if (this.members.includes(member)) fail("Already a member of this circle");
      if (amount !== this.contribution) {
        fail("Payment must be exactly the contribution amount");
      }

      const index = this.members.length;
      this.members.push(member);
      this._debit(member, amount);
      this.pot += amount;
      // Joining pays the round-0 contribution up front.
      this.paid[0] |= 1 << index;

      let started = false;
      if (this.members.length === this.maxMembers) {
        this.status = STATUS.ACTIVE;
        this.round = 0;
        this._roundDeadlineEpoch = this.currentEpoch + this.roundLengthEpochs;
        started = true;
      }
      return { index, started };
    }

    /// Contribute the fixed amount for the current round. Anyone may pay on
    /// a member's behalf; the template only checks the amount and the
    /// member slot.
    contribute(member, amount) {
      if (this.status !== STATUS.ACTIVE) fail("Circle is not active");
      const index = this.memberIndex(member);
      if (index === null) fail("Not a member of this circle");
      if (this.isDefaulted(index)) {
        fail("Member has defaulted and can no longer contribute");
      }
      if (this.hasPaid(this.round, index)) {
        fail("Member has already paid this round");
      }
      if (amount !== this.contribution) {
        fail("Payment must be exactly the contribution amount");
      }

      this._debit(member, amount);
      this.pot += amount;
      this.paid[this.round] |= 1 << index;
      return { index };
    }

    /// Settle the current round. Anyone may call this.
    ///
    /// The round settles once every member in good standing has paid, or
    /// once the round deadline has passed. Members who have not paid by the
    /// deadline are marked as defaulted: they lose their payout turn and
    /// their past contributions stay in the pot.
    ///
    /// The whole pot goes to this round's recipient (unless they defaulted,
    /// in which case the pot rolls over to the next round). After the last
    /// round the circle completes.
    payout() {
      if (this.status !== STATUS.ACTIVE) fail("Circle is not active");
      const allPaid = this._allActiveMembersPaid();
      if (!allPaid && this.currentEpoch < this._roundDeadlineEpoch) {
        fail("Round is not ready: waiting for contributions or the round deadline");
      }

      // The deadline passed with missing payments: mark the stragglers.
      const defaultedIndices = [];
      if (!allPaid) {
        const roundPaid = this.paid[this.round];
        for (let index = 0; index < this.members.length; index += 1) {
          if (!this.isDefaulted(index) && ((roundPaid >> index) & 1) === 0) {
            this.defaulted |= 1 << index;
            defaultedIndices.push(index);
          }
        }
      }

      const recipientIndex = this.round;
      const recipient = this.members[recipientIndex];
      let amount = 0;
      let rolledOver = false;
      if (!this.isDefaulted(recipientIndex)) {
        amount = this.pot;
        this.pot = 0;
        this._credit(recipient, amount);
      } else {
        // The recipient defaulted: the pot stays and rolls over.
        rolledOver = true;
      }
      this.paidOut |= 1 << recipientIndex;

      this.round += 1;
      if (this.round >= this.maxMembers) {
        this.status = STATUS.COMPLETED;
      } else {
        this._roundDeadlineEpoch = this.currentEpoch + this.roundLengthEpochs;
      }
      return {
        recipient,
        recipientIndex,
        amount,
        rolledOver,
        defaultedIndices,
        completed: this.status === STATUS.COMPLETED,
      };
    }

    /// Claim an equal share of the leftover pot after the circle has
    /// completed. Only members in good standing may claim; if every member
    /// defaulted, any member may claim, so funds are never stuck. The last
    /// claimer takes any dust.
    claimLeftover(member) {
      if (this.status !== STATUS.COMPLETED) fail("Circle has not completed");
      const index = this.memberIndex(member);
      if (index === null) fail("Not a member of this circle");
      if (this.hasClaimedLeftover(index)) fail("Leftover share already claimed");

      const goodRemaining = this._unclaimedGoodStandingCount();
      if (goodRemaining > 0) {
        if (this.isDefaulted(index)) {
          fail("Defaulted members cannot claim while members in good standing remain");
        }
      }
      const claimants =
        goodRemaining > 0 ? goodRemaining : this._unclaimedMemberCount();

      if (this.pot === 0) fail("No leftover to claim");
      // The last claimer takes the whole remainder (including dust).
      let amount;
      if (claimants === 1) {
        amount = this.pot;
      } else {
        amount = Math.floor(this.pot / claimants);
        if (amount === 0) fail("Leftover share is zero");
      }

      this.leftoverClaimed |= 1 << index;
      this.pot -= amount;
      this._credit(member, amount);
      return { member, index, amount, claimants };
    }

    /// Cancel a circle that is still forming. Requires the organizer badge,
    /// which is burned. Joined members can then `refund`.
    /// `hasBadge` is `true` when the caller presents the genuine organizer
    /// badge (on-chain: a bucket holding the badge NFT).
    cancel(hasBadge) {
      if (this.status !== STATUS.FORMING) {
        fail("Only a forming circle can be cancelled");
      }
      if (hasBadge !== true) fail("Invalid organizer badge");
      this.badgeBurned = true;
      this.status = STATUS.CANCELLED;
      return { burned: true };
    }

    /// Refund one contribution after the circle was cancelled.
    refund(member) {
      if (this.status !== STATUS.CANCELLED) fail("Circle was not cancelled");
      const index = this.memberIndex(member);
      if (index === null) fail("Not a member of this circle");
      if (this.hasRefunded(index)) fail("Already refunded");
      this.refunded |= 1 << index;
      this.pot -= this.contribution;
      this._credit(member, this.contribution);
      return { member, index, amount: this.contribution };
    }

    // ------------------------------------------------------------------
    // Views (mirror the template views one-for-one)
    // ------------------------------------------------------------------

    /// Status code: 0 = Forming, 1 = Active, 2 = Completed, 3 = Cancelled.
    statusCode() {
      return this.status;
    }

    statusName() {
      return STATUS_NAMES[this.status];
    }

    potBalance() {
      return this.pot;
    }

    currentRound() {
      return this.round;
    }

    roundDeadlineEpoch() {
      return this._roundDeadlineEpoch;
    }

    /// This round's recipient, if the circle is active, else null.
    roundRecipient() {
      if (this.status === STATUS.ACTIVE) {
        return this.members[this.round];
      }
      return null;
    }

    hasPaid(round, memberIndex) {
      if (round >= this.maxMembers || memberIndex >= MAX_MEMBERS) return false;
      return ((this.paid[round] >> memberIndex) & 1) === 1;
    }

    isDefaulted(memberIndex) {
      if (memberIndex >= MAX_MEMBERS) return false;
      return ((this.defaulted >> memberIndex) & 1) === 1;
    }

    hasReceivedPayout(memberIndex) {
      if (memberIndex >= MAX_MEMBERS) return false;
      return ((this.paidOut >> memberIndex) & 1) === 1;
    }

    hasClaimedLeftover(memberIndex) {
      if (memberIndex >= MAX_MEMBERS) return false;
      return ((this.leftoverClaimed >> memberIndex) & 1) === 1;
    }

    hasRefunded(memberIndex) {
      if (memberIndex >= MAX_MEMBERS) return false;
      return ((this.refunded >> memberIndex) & 1) === 1;
    }

    /// Index of a member in join order, or null if not a member.
    memberIndex(member) {
      const index = this.members.indexOf(member);
      return index === -1 ? null : index;
    }

    memberCount() {
      return this.members.length;
    }

    /// Members in join order (= payout rotation order). Returns a copy.
    membersList() {
      return this.members.slice();
    }

    /// The share a single claimer would receive right now (0 unless the
    /// circle completed with a leftover pot).
    leftoverShare() {
      if (this.status !== STATUS.COMPLETED) return 0;
      const goodRemaining = this._unclaimedGoodStandingCount();
      const claimants =
        goodRemaining > 0 ? goodRemaining : this._unclaimedMemberCount();
      if (claimants === 0) return 0;
      if (claimants === 1) return this.pot;
      return Math.floor(this.pot / claimants);
    }

    // ------------------------------------------------------------------
    // Simulation helpers (not part of the template)
    // ------------------------------------------------------------------

    /// Set the simulated consensus epoch (demo stand-in for
    /// `Consensus::current_epoch()`). Epochs only move forward on-chain,
    /// so going backwards is rejected.
    setEpoch(epoch) {
      assertInteger(epoch, "Epoch must be a non-negative integer");
      if (epoch < 0) fail("Epoch must be a non-negative integer");
      if (epoch < this.currentEpoch) fail("Epoch cannot move backwards");
      this.currentEpoch = epoch;
      return this.currentEpoch;
    }

    /// Advance the simulated epoch by `n` (default 1).
    advanceEpochs(n = 1) {
      assertInteger(n, "Epoch step must be a non-negative integer");
      if (n < 0) fail("Epoch step must be a non-negative integer");
      this.currentEpoch += n;
      return this.currentEpoch;
    }

    /// Simulated balance of an account (micro-Tari). Unknown accounts start
    /// at 1,000 TARI on first sight.
    balanceOf(member) {
      this._ensureAccount(member);
      return this.balances.get(member);
    }

    /// Total received from the circle (payouts + leftover + refunds).
    receivedOf(member) {
      this._ensureAccount(member);
      return this.received.get(member);
    }

    /// Total paid into the circle (joins + contributions).
    contributedOf(member) {
      this._ensureAccount(member);
      return this.contributed.get(member);
    }

    /// Net position: received minus contributed (micro-Tari).
    netOf(member) {
      return this.receivedOf(member) - this.contributedOf(member);
    }

    /// Plain-object snapshot of the full state, for the UI.
    snapshot() {
      return {
        organizer: this.organizer,
        contribution: this.contribution,
        maxMembers: this.maxMembers,
        roundLengthEpochs: this.roundLengthEpochs,
        members: this.members.slice(),
        paid: this.paid.slice(),
        defaulted: this.defaulted,
        paidOut: this.paidOut,
        leftoverClaimed: this.leftoverClaimed,
        refunded: this.refunded,
        round: this.round,
        roundDeadlineEpoch: this._roundDeadlineEpoch,
        status: this.status,
        statusName: this.statusName(),
        pot: this.pot,
        currentEpoch: this.currentEpoch,
        badgeBurned: this.badgeBurned,
      };
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    _allActiveMembersPaid() {
      const roundPaid = this.paid[this.round];
      for (let index = 0; index < this.members.length; index += 1) {
        if (!this.isDefaulted(index) && ((roundPaid >> index) & 1) === 0) {
          return false;
        }
      }
      return true;
    }

    _unclaimedGoodStandingCount() {
      let count = 0;
      for (let index = 0; index < this.members.length; index += 1) {
        if (!this.isDefaulted(index) && !this.hasClaimedLeftover(index)) {
          count += 1;
        }
      }
      return count;
    }

    _unclaimedMemberCount() {
      let count = 0;
      for (let index = 0; index < this.members.length; index += 1) {
        if (!this.hasClaimedLeftover(index)) {
          count += 1;
        }
      }
      return count;
    }

    _ensureAccount(member) {
      if (!this.balances.has(member)) {
        this.balances.set(member, STARTING_BALANCE);
        this.received.set(member, 0);
        this.contributed.set(member, 0);
      }
    }

    _debit(member, amount) {
      this._ensureAccount(member);
      this.balances.set(member, this.balances.get(member) - amount);
      this.contributed.set(member, this.contributed.get(member) + amount);
    }

    _credit(member, amount) {
      this._ensureAccount(member);
      this.balances.set(member, this.balances.get(member) + amount);
      this.received.set(member, this.received.get(member) + amount);
    }
  }

  return {
    ArisanCircle,
    STATUS,
    STATUS_NAMES,
    MAX_MEMBERS,
    MICRO_TARI_PER_TARI,
    STARTING_BALANCE,
    formatTari,
    toMicroTari,
  };
});
