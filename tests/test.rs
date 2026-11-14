//! Engine tests for the Arisan rotating-savings-circle template.
//!
//! Run with: `cargo test` (needs TMPDIR=$HOME/workspace/tools/tmp on this VM).

use tari_template_lib::models::Bucket;
use tari_template_lib::types::constants::TARI_TOKEN;
use tari_template_lib::types::{
    Amount,
    ComponentAddress,
    Hash32,
    NonFungibleAddress,
    ResourceAddress,
};
use tari_template_test_tooling::crypto::RistrettoSecretKey;
use tari_template_test_tooling::engine_types::virtual_substate::{
    VirtualSubstate,
    VirtualSubstateId,
};
use tari_template_test_tooling::support::assert_error::assert_reject_reason;
use tari_template_test_tooling::transaction::args;
use tari_template_test_tooling::TemplateTest;

/// Contribution used by most tests (100 micro-Tari — small, exact numbers).
const CONTRIBUTION: u128 = 100;
/// Round length used by most tests.
const ROUND_LENGTH: u64 = 10;

const STATUS_FORMING: u8 = 0;
const STATUS_ACTIVE: u8 = 1;
const STATUS_COMPLETED: u8 = 2;
const STATUS_CANCELLED: u8 = 3;

#[derive(Clone, Debug)]
struct Account {
    component: ComponentAddress,
    owner_token: NonFungibleAddress,
    key: RistrettoSecretKey,
}

fn setup() -> (TemplateTest, Hash32) {
    let mut test = TemplateTest::my_crate();
    let arisan_template = test.get_template_address("ArisanCircle");
    (test, arisan_template)
}

fn create_account(test: &mut TemplateTest) -> Account {
    let (component, owner_token, key) = test.create_funded_account();
    Account {
        component,
        owner_token,
        key,
    }
}

fn get_account_balance(
    test: &mut TemplateTest,
    account: &Account,
    resource: &ResourceAddress,
) -> Amount {
    test.call_method(account.component, "balance", args![resource], vec![])
}

fn get_tari_balance(test: &mut TemplateTest, account: &Account) -> Amount {
    get_account_balance(test, account, &TARI_TOKEN)
}

/// Create a circle; the organizer badge is deposited into the organizer's
/// account. Returns the circle component and the badge resource address
/// (the badge itself is withdrawn from the organizer's account when needed).
fn create_circle(
    test: &mut TemplateTest,
    template: Hash32,
    organizer: &Account,
    contribution: Amount,
    max_members: u32,
    round_length: u64,
) -> (ComponentAddress, ResourceAddress) {
    let _result = test.execute_expect_success(
        test.transaction()
            .call_function(
                template,
                "create",
                args![
                    organizer.component,
                    contribution,
                    max_members,
                    round_length
                ],
            )
            .put_last_instruction_output_on_workspace("ret")
            .call_method(
                organizer.component,
                "deposit",
                args![Workspace("ret.1")],
            )
            .build_and_seal(&organizer.key),
        vec![organizer.owner_token.clone()],
    );

    let (circle, _) = test.expect_return::<(ComponentAddress, Bucket)>(0);
    let badge_resource: ResourceAddress =
        test.call_method(circle, "organizer_badge_resource", args![], vec![]);
    (circle, badge_resource)
}

fn join(test: &mut TemplateTest, circle: ComponentAddress, member: &Account, amount: Amount) {
    test.execute_expect_success(
        test.transaction()
            .call_method(
                member.component,
                "withdraw",
                args![TARI_TOKEN, amount],
            )
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "join", args![member.component, Workspace("payment")])
            .build_and_seal(&member.key),
        vec![member.owner_token.clone()],
    );
}

fn contribute(
    test: &mut TemplateTest,
    circle: ComponentAddress,
    member: &Account,
    amount: Amount,
) {
    test.execute_expect_success(
        test.transaction()
            .call_method(
                member.component,
                "withdraw",
                args![TARI_TOKEN, amount],
            )
            .put_last_instruction_output_on_workspace("payment")
            .call_method(
                circle,
                "contribute",
                args![member.component, Workspace("payment")],
            )
            .build_and_seal(&member.key),
        vec![member.owner_token.clone()],
    );
}

fn payout(test: &mut TemplateTest, circle: ComponentAddress, caller: &Account) {
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "payout", args![])
            .build_and_seal(&caller.key),
        vec![],
    );
}

fn claim_leftover(test: &mut TemplateTest, circle: ComponentAddress, member: &Account) {
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "claim_leftover", args![member.component])
            .build_and_seal(&member.key),
        vec![],
    );
}

fn refund(test: &mut TemplateTest, circle: ComponentAddress, member: &Account) {
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "refund", args![member.component])
            .build_and_seal(&member.key),
        vec![],
    );
}

fn cancel(
    test: &mut TemplateTest,
    circle: ComponentAddress,
    organizer: &Account,
    badge_resource: &ResourceAddress,
) {
    test.execute_expect_success(
        test.transaction()
            .call_method(
                organizer.component,
                "withdraw",
                args![badge_resource, Amount::new(1)],
            )
            .put_last_instruction_output_on_workspace("badge")
            .call_method(circle, "cancel", args![Workspace("badge")])
            .build_and_seal(&organizer.key),
        vec![organizer.owner_token.clone()],
    );
}

fn set_epoch(test: &mut TemplateTest, epoch: u64) {
    test.set_virtual_substate(
        VirtualSubstateId::CurrentEpoch,
        VirtualSubstate::CurrentEpoch(epoch),
    );
}

fn status_code(test: &mut TemplateTest, circle: ComponentAddress) -> u8 {
    test.call_method(circle, "status_code", args![], vec![])
}

fn pot_balance(test: &mut TemplateTest, circle: ComponentAddress) -> Amount {
    test.call_method(circle, "pot_balance", args![], vec![])
}

fn round_deadline(test: &mut TemplateTest, circle: ComponentAddress) -> u64 {
    test.call_method(circle, "round_deadline_epoch", args![], vec![])
}

fn is_defaulted(test: &mut TemplateTest, circle: ComponentAddress, index: u32) -> bool {
    test.call_method(circle, "is_defaulted", args![index], vec![])
}

fn has_paid(test: &mut TemplateTest, circle: ComponentAddress, round: u32, index: u32) -> bool {
    test.call_method(circle, "has_paid", args![round, index], vec![])
}

/// Fill a 3-member circle (A, B, C join in order) and return the accounts.
fn filled_circle(
    test: &mut TemplateTest,
    template: Hash32,
) -> (ComponentAddress, ResourceAddress, Account, Account, Account) {
    let organizer = create_account(test);
    let (circle, badge) = create_circle(
        test,
        template,
        &organizer,
        Amount::new(CONTRIBUTION),
        3,
        ROUND_LENGTH,
    );
    let a = create_account(test);
    let b = create_account(test);
    let c = create_account(test);
    join(test, circle, &a, Amount::new(CONTRIBUTION));
    join(test, circle, &b, Amount::new(CONTRIBUTION));
    join(test, circle, &c, Amount::new(CONTRIBUTION));
    assert_eq!(status_code(test, circle), STATUS_ACTIVE);
    (circle, badge, a, b, c)
}

#[test]
fn full_circle_three_members() {
    let (mut test, template) = setup();
    let (circle, _badge, a, b, c) = filled_circle(&mut test, template);

    // Round 0 is already paid by joining; the pot holds 3 contributions.
    assert_eq!(pot_balance(&mut test, circle), Amount::new(3 * CONTRIBUTION));
    assert_eq!(has_paid(&mut test, circle, 0, 0), true);
    assert_eq!(has_paid(&mut test, circle, 0, 1), true);
    assert_eq!(has_paid(&mut test, circle, 0, 2), true);

    // Round 0: A (first joiner) takes the pot.
    let a_before = get_tari_balance(&mut test, &a);
    payout(&mut test, circle, &a);
    assert_eq!(
        get_tari_balance(&mut test, &a),
        a_before + Amount::new(3 * CONTRIBUTION)
    );
    assert_eq!(pot_balance(&mut test, circle), Amount::new(0));
    assert_eq!(
        test.call_method::<u32>(circle, "current_round", args![], vec![]),
        1
    );

    // Round 1: everyone contributes, B takes the pot.
    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &b, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &c, Amount::new(CONTRIBUTION));
    let b_before = get_tari_balance(&mut test, &b);
    payout(&mut test, circle, &b);
    assert_eq!(
        get_tari_balance(&mut test, &b),
        b_before + Amount::new(3 * CONTRIBUTION)
    );

    // Round 2: everyone contributes, C takes the pot and the circle completes.
    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &b, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &c, Amount::new(CONTRIBUTION));
    let c_before = get_tari_balance(&mut test, &c);
    payout(&mut test, circle, &c);
    assert_eq!(
        get_tari_balance(&mut test, &c),
        c_before + Amount::new(3 * CONTRIBUTION)
    );
    assert_eq!(status_code(&mut test, circle), STATUS_COMPLETED);
    assert_eq!(pot_balance(&mut test, circle), Amount::new(0));

    // Net result: everyone paid 300 and received 300 (zero-sum, as expected).
    assert_eq!(get_tari_balance(&mut test, &a), a_before + Amount::new(3 * CONTRIBUTION) - Amount::new(2 * CONTRIBUTION));
}

#[test]
fn create_rejects_invalid_params() {
    let (mut test, template) = setup();
    let organizer = create_account(&mut test);

    // Zero contribution.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(
                template,
                "create",
                args![organizer.component, Amount::new(0), 3u32, ROUND_LENGTH],
            )
            .build_and_seal(&organizer.key),
        vec![organizer.owner_token.clone()],
    );
    assert_reject_reason(reason, "Contribution must be greater than zero");

    // One member is not a circle.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(
                template,
                "create",
                args![
                    organizer.component,
                    Amount::new(CONTRIBUTION),
                    1u32,
                    ROUND_LENGTH
                ],
            )
            .build_and_seal(&organizer.key),
        vec![organizer.owner_token.clone()],
    );
    assert_reject_reason(reason, "A circle needs at least 2 members");

    // Over the 16-member cap.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(
                template,
                "create",
                args![
                    organizer.component,
                    Amount::new(CONTRIBUTION),
                    17u32,
                    ROUND_LENGTH
                ],
            )
            .build_and_seal(&organizer.key),
        vec![organizer.owner_token.clone()],
    );
    assert_reject_reason(reason, "A circle can have at most 16 members");

    // Zero-length rounds.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(
                template,
                "create",
                args![organizer.component, Amount::new(CONTRIBUTION), 3u32, 0u64],
            )
            .build_and_seal(&organizer.key),
        vec![organizer.owner_token.clone()],
    );
    assert_reject_reason(reason, "Round length must be at least 1 epoch");
}

#[test]
fn join_rejects_wrong_amount() {
    let (mut test, template) = setup();
    let organizer = create_account(&mut test);
    let (circle, _badge) = create_circle(
        &mut test,
        template,
        &organizer,
        Amount::new(CONTRIBUTION),
        3,
        ROUND_LENGTH,
    );
    let member = create_account(&mut test);

    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(
                member.component,
                "withdraw",
                args![TARI_TOKEN, Amount::new(CONTRIBUTION - 1)],
            )
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "join", args![member.component, Workspace("payment")])
            .build_and_seal(&member.key),
        vec![member.owner_token.clone()],
    );
    assert_reject_reason(reason, "Payment must be exactly the contribution amount");
}

#[test]
fn join_rejects_duplicate_member() {
    let (mut test, template) = setup();
    let organizer = create_account(&mut test);
    let (circle, _badge) = create_circle(
        &mut test,
        template,
        &organizer,
        Amount::new(CONTRIBUTION),
        3,
        ROUND_LENGTH,
    );
    let member = create_account(&mut test);
    join(&mut test, circle, &member, Amount::new(CONTRIBUTION));

    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(
                member.component,
                "withdraw",
                args![TARI_TOKEN, Amount::new(CONTRIBUTION)],
            )
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "join", args![member.component, Workspace("payment")])
            .build_and_seal(&member.key),
        vec![member.owner_token.clone()],
    );
    assert_reject_reason(reason, "Already a member of this circle");
}

#[test]
fn contribute_rejects_double_payment() {
    let (mut test, template) = setup();
    let (circle, _badge, a, _b, _c) = filled_circle(&mut test, template);
    // Round 0 is settled by the join payments.
    payout(&mut test, circle, &a);

    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(
                a.component,
                "withdraw",
                args![TARI_TOKEN, Amount::new(CONTRIBUTION)],
            )
            .put_last_instruction_output_on_workspace("payment")
            .call_method(
                circle,
                "contribute",
                args![a.component, Workspace("payment")],
            )
            .build_and_seal(&a.key),
        vec![a.owner_token.clone()],
    );
    assert_reject_reason(reason, "Member has already paid this round");
}

#[test]
fn contribute_rejects_non_member() {
    let (mut test, template) = setup();
    let (circle, _badge, a, _b, _c) = filled_circle(&mut test, template);
    payout(&mut test, circle, &a);

    let outsider = create_account(&mut test);
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(
                outsider.component,
                "withdraw",
                args![TARI_TOKEN, Amount::new(CONTRIBUTION)],
            )
            .put_last_instruction_output_on_workspace("payment")
            .call_method(
                circle,
                "contribute",
                args![outsider.component, Workspace("payment")],
            )
            .build_and_seal(&outsider.key),
        vec![outsider.owner_token.clone()],
    );
    assert_reject_reason(reason, "Not a member of this circle");
}

#[test]
fn payout_rejects_early() {
    let (mut test, template) = setup();
    let (circle, _badge, a, b, _c) = filled_circle(&mut test, template);
    payout(&mut test, circle, &a);

    // Round 1: only A paid, deadline not reached.
    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "payout", args![])
            .build_and_seal(&b.key),
        vec![],
    );
    assert_reject_reason(reason, "Round is not ready");
}

#[test]
fn defaulter_loses_payout_and_pot_rolls_over() {
    let (mut test, template) = setup();
    let (circle, _badge, a, b, c) = filled_circle(&mut test, template);

    // Round 0: A takes the pot (300).
    payout(&mut test, circle, &a);

    // Round 1: A and C pay, B does not. Past the deadline, settle.
    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &c, Amount::new(CONTRIBUTION));
    let deadline = round_deadline(&mut test, circle);
    set_epoch(&mut test, deadline);
    let b_before = get_tari_balance(&mut test, &b);
    payout(&mut test, circle, &a);

    // B defaulted and was the round-1 recipient, so the pot (200) rolled over.
    assert_eq!(is_defaulted(&mut test, circle, 1), true);
    assert_eq!(pot_balance(&mut test, circle), Amount::new(2 * CONTRIBUTION));
    assert_eq!(get_tari_balance(&mut test, &b), b_before);
    assert_eq!(
        test.call_method::<u32>(circle, "current_round", args![], vec![]),
        2
    );

    // A defaulted member cannot contribute again.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(
                b.component,
                "withdraw",
                args![TARI_TOKEN, Amount::new(CONTRIBUTION)],
            )
            .put_last_instruction_output_on_workspace("payment")
            .call_method(
                circle,
                "contribute",
                args![b.component, Workspace("payment")],
            )
            .build_and_seal(&b.key),
        vec![b.owner_token.clone()],
    );
    assert_reject_reason(reason, "Member has defaulted");

    // Round 2: A and C pay; C takes the rolled-over pot (200 + 200 = 400).
    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &c, Amount::new(CONTRIBUTION));
    let c_before = get_tari_balance(&mut test, &c);
    payout(&mut test, circle, &c);
    assert_eq!(
        get_tari_balance(&mut test, &c),
        c_before + Amount::new(4 * CONTRIBUTION)
    );
    assert_eq!(status_code(&mut test, circle), STATUS_COMPLETED);
    assert_eq!(pot_balance(&mut test, circle), Amount::new(0));
}

#[test]
fn leftover_claims_after_final_rollover() {
    let (mut test, template) = setup();
    let (circle, _badge, a, b, c) = filled_circle(&mut test, template);

    // Round 0 -> A, round 1 -> B (all pay).
    payout(&mut test, circle, &a);
    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &b, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &c, Amount::new(CONTRIBUTION));
    payout(&mut test, circle, &b);

    // Round 2: A and B pay, C (the recipient) does not. Past the deadline,
    // C defaults, the pot (200) rolls over, and the circle completes.
    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    contribute(&mut test, circle, &b, Amount::new(CONTRIBUTION));
    let deadline = round_deadline(&mut test, circle);
    set_epoch(&mut test, deadline);
    payout(&mut test, circle, &a);
    assert_eq!(status_code(&mut test, circle), STATUS_COMPLETED);
    assert_eq!(pot_balance(&mut test, circle), Amount::new(2 * CONTRIBUTION));
    assert_eq!(is_defaulted(&mut test, circle, 2), true);

    // The defaulted member cannot claim while good-standing members remain.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "claim_leftover", args![c.component])
            .build_and_seal(&c.key),
        vec![],
    );
    assert_reject_reason(reason, "Defaulted members cannot claim");

    // A and B split the leftover 100/100.
    let a_before = get_tari_balance(&mut test, &a);
    claim_leftover(&mut test, circle, &a);
    assert_eq!(
        get_tari_balance(&mut test, &a),
        a_before + Amount::new(CONTRIBUTION)
    );
    let b_before = get_tari_balance(&mut test, &b);
    claim_leftover(&mut test, circle, &b);
    assert_eq!(
        get_tari_balance(&mut test, &b),
        b_before + Amount::new(CONTRIBUTION)
    );
    assert_eq!(pot_balance(&mut test, circle), Amount::new(0));

    // No double claims.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "claim_leftover", args![a.component])
            .build_and_seal(&a.key),
        vec![],
    );
    assert_reject_reason(reason, "Leftover share already claimed");
}

#[test]
fn all_default_leftover_still_claimable() {
    let (mut test, template) = setup();
    let (circle, _badge, a, b, c) = filled_circle(&mut test, template);

    // Round 0 -> A.
    payout(&mut test, circle, &a);

    // Round 1: only A pays; B and C default at the deadline. B was the
    // recipient, so A's 100 rolls over.
    contribute(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    let deadline = round_deadline(&mut test, circle);
    set_epoch(&mut test, deadline);
    payout(&mut test, circle, &a);
    assert_eq!(is_defaulted(&mut test, circle, 1), true);
    assert_eq!(is_defaulted(&mut test, circle, 2), true);

    // Round 2: A does not pay either and defaults at the deadline.
    // C was the recipient, so the pot (100) stays and the circle completes
    // with no members in good standing.
    let deadline = round_deadline(&mut test, circle);
    set_epoch(&mut test, deadline);
    payout(&mut test, circle, &a);
    assert_eq!(status_code(&mut test, circle), STATUS_COMPLETED);
    assert_eq!(is_defaulted(&mut test, circle, 0), true);
    assert_eq!(pot_balance(&mut test, circle), Amount::new(CONTRIBUTION));

    // With nobody in good standing, any member may claim an equal share.
    // 100 / 3 = 33 each; the last claimer takes the dust (34).
    let a_before = get_tari_balance(&mut test, &a);
    claim_leftover(&mut test, circle, &a);
    assert_eq!(
        get_tari_balance(&mut test, &a),
        a_before + Amount::new(33)
    );
    let b_before = get_tari_balance(&mut test, &b);
    claim_leftover(&mut test, circle, &b);
    assert_eq!(
        get_tari_balance(&mut test, &b),
        b_before + Amount::new(33)
    );
    let c_before = get_tari_balance(&mut test, &c);
    claim_leftover(&mut test, circle, &c);
    assert_eq!(
        get_tari_balance(&mut test, &c),
        c_before + Amount::new(34)
    );
    assert_eq!(pot_balance(&mut test, circle), Amount::new(0));
}

#[test]
fn cancel_and_refund() {
    let (mut test, template) = setup();
    let organizer = create_account(&mut test);
    let (circle, badge) = create_circle(
        &mut test,
        template,
        &organizer,
        Amount::new(CONTRIBUTION),
        3,
        ROUND_LENGTH,
    );
    let a = create_account(&mut test);
    let b = create_account(&mut test);
    join(&mut test, circle, &a, Amount::new(CONTRIBUTION));
    join(&mut test, circle, &b, Amount::new(CONTRIBUTION));
    assert_eq!(pot_balance(&mut test, circle), Amount::new(2 * CONTRIBUTION));

    cancel(&mut test, circle, &organizer, &badge);
    assert_eq!(status_code(&mut test, circle), STATUS_CANCELLED);

    let a_before = get_tari_balance(&mut test, &a);
    refund(&mut test, circle, &a);
    assert_eq!(
        get_tari_balance(&mut test, &a),
        a_before + Amount::new(CONTRIBUTION)
    );
    let b_before = get_tari_balance(&mut test, &b);
    refund(&mut test, circle, &b);
    assert_eq!(
        get_tari_balance(&mut test, &b),
        b_before + Amount::new(CONTRIBUTION)
    );
    assert_eq!(pot_balance(&mut test, circle), Amount::new(0));

    // No double refunds.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "refund", args![a.component])
            .build_and_seal(&a.key),
        vec![],
    );
    assert_reject_reason(reason, "Already refunded");
}

#[test]
fn cancel_rejects_wrong_badge() {
    let (mut test, template) = setup();
    let organizer = create_account(&mut test);
    let (circle, _badge) = create_circle(
        &mut test,
        template,
        &organizer,
        Amount::new(CONTRIBUTION),
        3,
        ROUND_LENGTH,
    );

    // Pass 1 TARI instead of the organizer badge.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(
                organizer.component,
                "withdraw",
                args![TARI_TOKEN, Amount::new(1)],
            )
            .put_last_instruction_output_on_workspace("fake_badge")
            .call_method(circle, "cancel", args![Workspace("fake_badge")])
            .build_and_seal(&organizer.key),
        vec![organizer.owner_token.clone()],
    );
    assert_reject_reason(reason, "Invalid organizer badge");
}
