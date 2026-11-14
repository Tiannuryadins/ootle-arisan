// Tests for the Arisan walletless demo engine (arisan.js).
//
// These mirror the Rust template tests in ../tests/test.rs, including the
// exact scenarios and amounts: a 3-member circle with a 100-unit
// contribution, the 100/100 leftover split, and the 100 -> 33/33/34
// all-default dust split. The engine is unit-agnostic (integer amounts),
// so the leftover tests use a 100 micro-Tari contribution to match the
// Rust harness values exactly; the full-circle test uses a realistic
// 10 TARI contribution, and one extra test checks the dust split at
// 100 TARI scale.
//
// Run: node --test docs/arisan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ArisanCircle,
  STATUS,
  MICRO_TARI_PER_TARI,
  STARTING_BALANCE,
  formatTari,
  toMicroTari,
} = require("./arisan.js");

// Demo addresses (fake component addresses, as the UI generates them).
const ORGANIZER = "comp_organizer000000000000000000000000000001";
const A = "comp_a1b2c3d4e5f6000000000000000000000000000001";
const B = "comp_a1b2c3d4e5f6000000000000000000000000000002";
const C = "comp_a1b2c3d4e5f6000000000000000000000000000003";

const ROUND_LENGTH = 10;
const CONTRIBUTION = 100; // micro-Tari, mirroring the Rust harness
const TEN_TARI = 10 * MICRO_TARI_PER_TARI;

/** A filled 3-member circle (contribution 100), already Active. */
function filledCircle(contribution = CONTRIBUTION) {
  const circle = ArisanCircle.create(ORGANIZER, contribution, 3, ROUND_LENGTH);
  circle.join(A, contribution);
  circle.join(B, contribution);
  circle.join(C, contribution);
  assert.equal(circle.statusCode(), STATUS.ACTIVE);
  return circle;
}

test("create validates its parameters with the template error strings", () => {
  assert.throws(
    () => ArisanCircle.create(ORGANIZER, 0, 3, ROUND_LENGTH),
    { message: "Contribution must be greater than zero" },
  );
  assert.throws(
    () => ArisanCircle.create(ORGANIZER, CONTRIBUTION, 1, ROUND_LENGTH),
    { message: "A circle needs at least 2 members" },
  );
  assert.throws(
    () => ArisanCircle.create(ORGANIZER, CONTRIBUTION, 17, ROUND_LENGTH),
    { message: "A circle can have at most 16 members" },
  );
  assert.throws(
    () => ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, 0),
    { message: "Round length must be at least 1 epoch" },
  );

  // A valid create starts Forming with an empty pot and no deadline.
  const circle = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, ROUND_LENGTH);
  assert.equal(circle.statusCode(), STATUS.FORMING);
  assert.equal(circle.potBalance(), 0);
  assert.equal(circle.roundDeadlineEpoch(), 0);
  assert.equal(circle.roundRecipient(), null);
});

test("join pays round 0 up front and auto-starts the circle when full", () => {
  const circle = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, ROUND_LENGTH);
  circle.setEpoch(5);
  circle.join(A, CONTRIBUTION);
  assert.equal(circle.hasPaid(0, 0), true);
  assert.equal(circle.hasPaid(0, 1), false);
  assert.equal(circle.statusCode(), STATUS.FORMING);
  assert.equal(circle.potBalance(), CONTRIBUTION);

  circle.join(B, CONTRIBUTION);
  circle.join(C, CONTRIBUTION);
  assert.equal(circle.statusCode(), STATUS.ACTIVE);
  assert.equal(circle.currentRound(), 0);
  assert.equal(circle.roundDeadlineEpoch(), 5 + ROUND_LENGTH);
  assert.equal(circle.roundRecipient(), A);
  assert.equal(circle.potBalance(), 3 * CONTRIBUTION);
  assert.equal(circle.memberIndex(B), 1);
  assert.equal(circle.memberIndex("comp_nobody"), null);
});

test("full 3-member circle: everyone pays 30 TARI and receives 30 TARI (zero-sum)", () => {
  const circle = filledCircle(TEN_TARI);

  // Round 0 is already paid by joining; the pot holds 3 contributions.
  assert.equal(circle.potBalance(), 3 * TEN_TARI);
  assert.equal(circle.hasPaid(0, 0), true);
  assert.equal(circle.hasPaid(0, 1), true);
  assert.equal(circle.hasPaid(0, 2), true);

  // Round 0: A (first joiner) takes the pot.
  const out0 = circle.payout();
  assert.equal(out0.recipient, A);
  assert.equal(out0.amount, 3 * TEN_TARI);
  assert.equal(out0.rolledOver, false);
  assert.equal(circle.potBalance(), 0);
  assert.equal(circle.currentRound(), 1);
  assert.equal(circle.hasReceivedPayout(0), true);

  // Round 1: everyone contributes, B takes the pot.
  circle.contribute(A, TEN_TARI);
  circle.contribute(B, TEN_TARI);
  circle.contribute(C, TEN_TARI);
  const out1 = circle.payout();
  assert.equal(out1.recipient, B);
  assert.equal(out1.amount, 3 * TEN_TARI);

  // Round 2: everyone contributes, C takes the pot and the circle completes.
  circle.contribute(A, TEN_TARI);
  circle.contribute(B, TEN_TARI);
  circle.contribute(C, TEN_TARI);
  const out2 = circle.payout();
  assert.equal(out2.recipient, C);
  assert.equal(out2.amount, 3 * TEN_TARI);
  assert.equal(out2.completed, true);
  assert.equal(circle.statusCode(), STATUS.COMPLETED);
  assert.equal(circle.potBalance(), 0);
  assert.equal(circle.roundRecipient(), null);

  // Net result: everyone paid 30 TARI and received 30 TARI — zero-sum.
  for (const member of [A, B, C]) {
    assert.equal(circle.contributedOf(member), 3 * TEN_TARI);
    assert.equal(circle.receivedOf(member), 3 * TEN_TARI);
    assert.equal(circle.netOf(member), 0);
    assert.equal(circle.balanceOf(member), STARTING_BALANCE);
  }
  // Conservation: members' balances + pot == starting balances.
  const total =
    circle.balanceOf(A) + circle.balanceOf(B) + circle.balanceOf(C) +
    circle.potBalance();
  assert.equal(total, 3 * STARTING_BALANCE);
});

test("join rejects a wrong amount", () => {
  const circle = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, ROUND_LENGTH);
  assert.throws(() => circle.join(A, CONTRIBUTION - 1), {
    message: "Payment must be exactly the contribution amount",
  });
  assert.throws(() => circle.join(A, CONTRIBUTION + 1), {
    message: "Payment must be exactly the contribution amount",
  });
  assert.equal(circle.memberCount(), 0);
});

test("duplicate join is rejected", () => {
  const circle = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, ROUND_LENGTH);
  circle.join(A, CONTRIBUTION);
  assert.throws(() => circle.join(A, CONTRIBUTION), {
    message: "Already a member of this circle",
  });
  assert.equal(circle.memberCount(), 1);
});

test("join rejects a full circle and a non-forming circle", () => {
  const circle = filledCircle();
  assert.throws(() => circle.join("comp_late000000000000000000000000000004", CONTRIBUTION), {
    message: "Circle is not forming",
  });

  const cancelled = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 2, ROUND_LENGTH);
  cancelled.cancel(true);
  assert.throws(() => cancelled.join(A, CONTRIBUTION), {
    message: "Circle is not forming",
  });
});

test("double contribute is rejected", () => {
  const circle = filledCircle();
  circle.payout(); // Round 0 -> A.
  circle.contribute(A, CONTRIBUTION);
  assert.throws(() => circle.contribute(A, CONTRIBUTION), {
    message: "Member has already paid this round",
  });
});

test("contribute rejects non-members and wrong amounts", () => {
  const circle = filledCircle();
  circle.payout(); // Round 0 -> A.
  assert.throws(() => circle.contribute("comp_outsider00000000000000000000001", CONTRIBUTION), {
    message: "Not a member of this circle",
  });
  assert.throws(() => circle.contribute(A, CONTRIBUTION - 1), {
    message: "Payment must be exactly the contribution amount",
  });
  assert.throws(() => circle.contribute(A, CONTRIBUTION + 1), {
    message: "Payment must be exactly the contribution amount",
  });
});

test("contribute rejects a call while the circle is still forming", () => {
  const circle = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, ROUND_LENGTH);
  circle.join(A, CONTRIBUTION);
  assert.throws(() => circle.contribute(A, CONTRIBUTION), {
    message: "Circle is not active",
  });
});

test("early payout is rejected", () => {
  const circle = filledCircle();
  circle.payout(); // Round 0 -> A.

  // Round 1: only A paid, deadline not reached.
  circle.contribute(A, CONTRIBUTION);
  assert.throws(() => circle.payout(), {
    message: "Round is not ready: waiting for contributions or the round deadline",
  });
  // Still rejected one epoch before the deadline...
  circle.setEpoch(circle.roundDeadlineEpoch() - 1);
  assert.throws(() => circle.payout(), {
    message: "Round is not ready: waiting for contributions or the round deadline",
  });
  // ...and allowed exactly at the deadline (B and C default).
  circle.setEpoch(circle.roundDeadlineEpoch());
  const out = circle.payout();
  assert.deepEqual(out.defaultedIndices, [1, 2]);
  assert.equal(out.rolledOver, true); // B was the recipient and defaulted.
});

test("defaulter loses their payout turn and the pot rolls over", () => {
  const circle = filledCircle();

  // Round 0: A takes the pot (300).
  circle.payout();
  assert.equal(circle.receivedOf(A), 3 * CONTRIBUTION);

  // Round 1: A and C pay, B does not. Past the deadline, settle.
  circle.contribute(A, CONTRIBUTION);
  circle.contribute(C, CONTRIBUTION);
  circle.setEpoch(circle.roundDeadlineEpoch());
  const bBefore = circle.balanceOf(B);
  const out = circle.payout();

  // B defaulted and was the round-1 recipient, so the pot (200) rolled over.
  assert.equal(circle.isDefaulted(1), true);
  assert.equal(out.rolledOver, true);
  assert.equal(out.amount, 0);
  assert.equal(circle.potBalance(), 2 * CONTRIBUTION);
  assert.equal(circle.balanceOf(B), bBefore);
  assert.equal(circle.currentRound(), 2);
  assert.equal(circle.hasReceivedPayout(1), true); // turn passed (forfeited)

  // A defaulted member cannot contribute again.
  assert.throws(() => circle.contribute(B, CONTRIBUTION), {
    message: "Member has defaulted and can no longer contribute",
  });

  // Round 2: A and C pay; C takes the rolled-over pot (200 + 200 = 400).
  circle.contribute(A, CONTRIBUTION);
  circle.contribute(C, CONTRIBUTION);
  const cBefore = circle.balanceOf(C);
  const out2 = circle.payout();
  assert.equal(out2.recipient, C);
  assert.equal(out2.amount, 4 * CONTRIBUTION);
  assert.equal(circle.balanceOf(C), cBefore + 4 * CONTRIBUTION);
  assert.equal(circle.statusCode(), STATUS.COMPLETED);
  assert.equal(circle.potBalance(), 0);

  // B paid 100 in round 0 and 100 in round 1... no: B paid only round 0
  // (join) and never again. B is down 100; A and C are up 100 net each
  // in expectation terms — the pot B left behind went to C.
  assert.equal(circle.contributedOf(B), CONTRIBUTION);
  assert.equal(circle.receivedOf(B), 0);
  assert.equal(circle.netOf(B), -CONTRIBUTION);
});

test("leftover claims after a final rollover split 100/100", () => {
  const circle = filledCircle();

  // Round 0 -> A, round 1 -> B (all pay).
  circle.payout();
  circle.contribute(A, CONTRIBUTION);
  circle.contribute(B, CONTRIBUTION);
  circle.contribute(C, CONTRIBUTION);
  circle.payout();

  // Round 2: A and B pay, C (the recipient) does not. Past the deadline,
  // C defaults, the pot (200) rolls over, and the circle completes.
  circle.contribute(A, CONTRIBUTION);
  circle.contribute(B, CONTRIBUTION);
  circle.setEpoch(circle.roundDeadlineEpoch());
  circle.payout();
  assert.equal(circle.statusCode(), STATUS.COMPLETED);
  assert.equal(circle.potBalance(), 2 * CONTRIBUTION);
  assert.equal(circle.isDefaulted(2), true);
  assert.equal(circle.leftoverShare(), CONTRIBUTION);

  // The defaulted member cannot claim while good-standing members remain.
  assert.throws(() => circle.claimLeftover(C), {
    message: "Defaulted members cannot claim while members in good standing remain",
  });

  // A and B split the leftover 100/100.
  const aBefore = circle.balanceOf(A);
  const claimA = circle.claimLeftover(A);
  assert.equal(claimA.amount, CONTRIBUTION);
  assert.equal(circle.balanceOf(A), aBefore + CONTRIBUTION);
  assert.equal(circle.leftoverShare(), CONTRIBUTION); // last claimer takes the rest
  const bBefore = circle.balanceOf(B);
  const claimB = circle.claimLeftover(B);
  assert.equal(claimB.amount, CONTRIBUTION);
  assert.equal(circle.balanceOf(B), bBefore + CONTRIBUTION);
  assert.equal(circle.potBalance(), 0);
  assert.equal(circle.leftoverShare(), 0);

  // No double claims.
  assert.throws(() => circle.claimLeftover(A), {
    message: "Leftover share already claimed",
  });

  // With the pot empty, a claim from the defaulted member now fails on the
  // empty pot (good-standing members have all claimed, so C is eligible
  // but there is nothing left).
  assert.throws(() => circle.claimLeftover(C), {
    message: "No leftover to claim",
  });
});

test("all-default fallback: a 100 leftover splits 33/33/34", () => {
  const circle = filledCircle();

  // Round 0 -> A.
  circle.payout();

  // Round 1: only A pays; B and C default at the deadline. B was the
  // recipient, so A's 100 rolls over.
  circle.contribute(A, CONTRIBUTION);
  circle.setEpoch(circle.roundDeadlineEpoch());
  circle.payout();
  assert.equal(circle.isDefaulted(1), true);
  assert.equal(circle.isDefaulted(2), true);

  // Round 2: A does not pay either and defaults at the deadline.
  // C was the recipient, so the pot (100) stays and the circle completes
  // with no members in good standing.
  circle.setEpoch(circle.roundDeadlineEpoch());
  circle.payout();
  assert.equal(circle.statusCode(), STATUS.COMPLETED);
  assert.equal(circle.isDefaulted(0), true);
  assert.equal(circle.potBalance(), CONTRIBUTION);

  // With nobody in good standing, any member may claim an equal share.
  // 100 / 3 = 33 each; the last claimer takes the dust (34).
  assert.equal(circle.leftoverShare(), 33);
  const aBefore = circle.balanceOf(A);
  assert.equal(circle.claimLeftover(A).amount, 33);
  assert.equal(circle.balanceOf(A), aBefore + 33);
  assert.equal(circle.leftoverShare(), 33);
  const bBefore = circle.balanceOf(B);
  assert.equal(circle.claimLeftover(B).amount, 33);
  assert.equal(circle.balanceOf(B), bBefore + 33);
  assert.equal(circle.leftoverShare(), 34); // last claimer takes the dust
  const cBefore = circle.balanceOf(C);
  assert.equal(circle.claimLeftover(C).amount, 34);
  assert.equal(circle.balanceOf(C), cBefore + 34);
  assert.equal(circle.potBalance(), 0);
});

test("all-default dust split also works at a realistic 100 TARI scale", () => {
  const hundredTari = 100 * MICRO_TARI_PER_TARI;
  const circle = filledCircle(hundredTari);
  circle.payout();
  circle.contribute(A, hundredTari);
  circle.setEpoch(circle.roundDeadlineEpoch());
  circle.payout();
  circle.setEpoch(circle.roundDeadlineEpoch());
  circle.payout();
  assert.equal(circle.statusCode(), STATUS.COMPLETED);
  assert.equal(circle.potBalance(), hundredTari);

  // 100,000,000 / 3 = 33,333,333 each; last claimer takes 33,333,334.
  assert.equal(circle.claimLeftover(A).amount, 33_333_333);
  assert.equal(circle.claimLeftover(B).amount, 33_333_333);
  assert.equal(circle.claimLeftover(C).amount, 33_333_334);
  assert.equal(circle.potBalance(), 0);
});

test("leftover claim rejects a zero share", () => {
  // A 3-member circle with a 1 micro-Tari contribution, all defaulting:
  // the final pot is 1 micro-Tari split between 3 claimants, so the floor
  // share is 0 and every claim is rejected. (With members in good
  // standing the share can never be zero: the final pot always holds one
  // contribution per surviving member. Only the all-default fallback,
  // where the pot is a rolled-over remainder, can produce a zero share.)
  const circle = ArisanCircle.create(ORGANIZER, 1, 3, ROUND_LENGTH);
  circle.join(A, 1);
  circle.join(B, 1);
  circle.join(C, 1);
  circle.payout(); // Round 0 -> A (pot 3).
  // Round 1: only A pays; B and C default at the deadline. B was the
  // recipient, so A's 1 rolls over.
  circle.contribute(A, 1);
  circle.setEpoch(circle.roundDeadlineEpoch());
  circle.payout();
  // Round 2: A does not pay either and defaults at the deadline.
  circle.setEpoch(circle.roundDeadlineEpoch());
  circle.payout();
  assert.equal(circle.statusCode(), STATUS.COMPLETED);
  assert.equal(circle.potBalance(), 1);
  assert.equal(circle.leftoverShare(), 0);
  for (const member of [A, B, C]) {
    assert.throws(() => circle.claimLeftover(member), {
      message: "Leftover share is zero",
    });
  }
  assert.equal(circle.potBalance(), 1); // the 1 micro-Tari dust stays put
});

test("claiming leftover before completion is rejected", () => {
  const circle = filledCircle();
  assert.throws(() => circle.claimLeftover(A), {
    message: "Circle has not completed",
  });
});

test("cancel and refund", () => {
  const circle = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, ROUND_LENGTH);
  circle.join(A, CONTRIBUTION);
  circle.join(B, CONTRIBUTION);
  assert.equal(circle.potBalance(), 2 * CONTRIBUTION);

  const out = circle.cancel(true);
  assert.equal(out.burned, true);
  assert.equal(circle.badgeBurned, true);
  assert.equal(circle.statusCode(), STATUS.CANCELLED);

  const aBefore = circle.balanceOf(A);
  const refundA = circle.refund(A);
  assert.equal(refundA.amount, CONTRIBUTION);
  assert.equal(circle.balanceOf(A), aBefore + CONTRIBUTION);
  const bBefore = circle.balanceOf(B);
  assert.equal(circle.refund(B).amount, CONTRIBUTION);
  assert.equal(circle.balanceOf(B), bBefore + CONTRIBUTION);
  assert.equal(circle.potBalance(), 0);

  // No double refunds.
  assert.throws(() => circle.refund(A), { message: "Already refunded" });
  // Non-members cannot refund.
  assert.throws(() => circle.refund(C), {
    message: "Not a member of this circle",
  });
});

test("cancel without a valid badge is rejected", () => {
  const circle = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, ROUND_LENGTH);
  assert.throws(() => circle.cancel(false), {
    message: "Invalid organizer badge",
  });
  assert.throws(() => circle.cancel(undefined), {
    message: "Invalid organizer badge",
  });
  // The circle is still forming and the badge was not burned.
  assert.equal(circle.statusCode(), STATUS.FORMING);
  assert.equal(circle.badgeBurned, false);
  // A valid badge still works afterwards.
  circle.cancel(true);
  assert.equal(circle.statusCode(), STATUS.CANCELLED);
});

test("cancel is only possible while forming", () => {
  const circle = filledCircle();
  assert.throws(() => circle.cancel(true), {
    message: "Only a forming circle can be cancelled",
  });
});

test("refund is only possible after a cancel", () => {
  const circle = ArisanCircle.create(ORGANIZER, CONTRIBUTION, 3, ROUND_LENGTH);
  circle.join(A, CONTRIBUTION);
  assert.throws(() => circle.refund(A), {
    message: "Circle was not cancelled",
  });
});

test("epoch simulation only moves forward", () => {
  const circle = filledCircle();
  circle.setEpoch(10);
  assert.equal(circle.currentEpoch, 10);
  circle.advanceEpochs(3);
  assert.equal(circle.currentEpoch, 13);
  assert.throws(() => circle.setEpoch(12), {
    message: "Epoch cannot move backwards",
  });
  assert.throws(() => circle.setEpoch(-1), {
    message: "Epoch must be a non-negative integer",
  });
});

test("TARI formatting helpers", () => {
  assert.equal(toMicroTari(10), 10_000_000);
  assert.equal(toMicroTari(0.5), 500_000);
  assert.equal(formatTari(10_000_000), "10");
  assert.equal(formatTari(500_000), "0.5");
  assert.equal(formatTari(33_333_333), "33.333333");
  assert.equal(formatTari(0), "0");
  assert.equal(formatTari(-100), "-0.0001");
});
