//! Arisan — rotating savings circles (ROSCA) on Tari Ootle.
//!
//! An arisan is one of the world's oldest savings institutions: a group of
//! people each contribute a fixed amount every round, and each round one
//! member — in rotation — takes the whole pot. It is called *arisan* in
//! Indonesia, *tanda* in Latin America, *susu* in West Africa and the
//! Caribbean, *hui* in China, and *stokvel* in South Africa. Hundreds of
//! millions of people save this way, and the scheme has one classic failure:
//! a member who takes the pot early and then stops contributing.
//!
//! This template removes that failure mode. Contributions are held by the
//! circle component, the rotation order is fixed at join time, and the rules
//! are enforced by the template:
//!
//! * Joining a circle costs exactly one contribution, paid up front (that is
//!   the round-0 contribution). The circle starts automatically once full.
//! * Every round, every member in good standing contributes the fixed amount.
//!   Anyone may pay on a member's behalf (a gift contribution).
//! * `payout` is permissionless: once every member in good standing has paid
//!   for the round, or the round deadline has passed, anyone can settle the
//!   round. The whole pot goes to that round's recipient.
//! * A member who misses a round deadline is marked as defaulted: they lose
//!   their payout turn (the pot rolls over to the next round) and their past
//!   contributions stay in the pot. They cannot contribute again.
//! * When the circle completes, any leftover pot (from rolled-over rounds) is
//!   claimable in equal shares by the members in good standing. If every
//!   member defaulted, any member may claim an equal share, so funds are
//!   never stuck.
//! * While a circle is still forming, the organizer can cancel it with their
//!   organizer badge, and every joined member can refund their contribution.
//!
//! Honest limits (see README for the full list):
//! * Contribution amounts, payouts and membership are public: deposits into a
//!   component vault go through revealed outputs. Member identities are only
//!   account addresses — there are no names and no KYC.
//! * A member's identity on a call is the account address passed to the
//!   method; the template checks the payment, not the signer. Paying for
//!   another member is therefore possible by design (gifts).
//! * This template is unaudited. Keep contributions small.

use tari_template_lib::prelude::*;

/// Template address of the built-in account component.
pub const ACCOUNT_TEMPLATE_ADDRESS: TemplateAddress = TemplateAddress::from_array([0u8; 32]);

/// Maximum members in one circle. Per-round payment state is a bitmask in a
/// single `u64`, so 16 is a comfortable cap.
pub const MAX_MEMBERS: u32 = 16;

#[template]
pub mod arisan {
    use super::*;

    // NOTE: ArisanCircle must be the FIRST struct/enum in this module: the
    // #[template] macro uses the first struct/enum name as the template name,
    // and only impl blocks for that type become template functions.
    pub struct ArisanCircle {
        organizer: ComponentAddress,
        organizer_badge_resource: ResourceAddress,
        contribution: Amount,
        max_members: u32,
        round_length_epochs: u64,
        /// Members in join order. The payout rotation follows this order:
        /// round `r` pays `members[r]`.
        members: Vec<ComponentAddress>,
        /// `paid[round]` is a bitmask of the member indices who paid that round.
        paid: Vec<u64>,
        /// Bitmask of members who missed a round deadline.
        defaulted: u64,
        /// Bitmask of members whose payout turn has passed (paid out or forfeited).
        paid_out: u64,
        /// Bitmask of members who claimed their leftover share.
        leftover_claimed: u64,
        /// Bitmask of members refunded after a cancel.
        refunded: u64,
        /// Current round index (0-based). There is one round per member.
        round: u32,
        round_deadline_epoch: u64,
        status: CircleStatus,
        pot: Vault,
    }

    impl ArisanCircle {
        /// Create a new circle. Returns the circle component and a
        /// single-use organizer badge (an NFT) that authorizes `cancel`.
        /// The circle starts forming; it becomes active once the last seat
        /// is taken.
        pub fn create(
            organizer: ComponentAddress,
            contribution: Amount,
            max_members: u32,
            round_length_epochs: u64,
        ) -> (Component<Self>, Bucket) {
            Self::assert_component_is_account(organizer);
            assert!(!contribution.is_zero(), "Contribution must be greater than zero");
            assert!(max_members >= 2, "A circle needs at least 2 members");
            assert!(max_members <= MAX_MEMBERS, "A circle can have at most 16 members");
            assert!(round_length_epochs > 0, "Round length must be at least 1 epoch");

            // The organizer badge can never be minted again and can be burned,
            // so holding it proves the holder is the organizer.
            let organizer_badge = ResourceBuilder::non_fungible()
                .mintable(AccessRule::DenyAll, LOCKED)
                .burnable(AccessRule::AllowAll, LOCKED)
                .initial_supply_with_data(Some((NonFungibleId::random(), (&(), &()))));
            let organizer_badge_resource = organizer_badge.resource_address();

            let component = Component::new(Self {
                organizer,
                organizer_badge_resource,
                contribution,
                max_members,
                round_length_epochs,
                members: Vec::new(),
                paid: vec![0u64; max_members as usize],
                defaulted: 0,
                paid_out: 0,
                leftover_claimed: 0,
                refunded: 0,
                round: 0,
                round_deadline_epoch: 0,
                status: CircleStatus::Forming,
                pot: Vault::new_empty(TARI_TOKEN),
            })
            .with_access_rules(AccessRules::allow_all())
            .create();

            (component, organizer_badge)
        }

        /// Join a forming circle. The payment is exactly one contribution and
        /// counts as this member's round-0 contribution. Members join in
        /// payout order: the first to join is paid out in round 0.
        /// The circle starts automatically when the last seat is taken.
        pub fn join(&mut self, member: ComponentAddress, payment: Bucket) {
            assert!(self.status == CircleStatus::Forming, "Circle is not forming");
            assert!(
                (self.members.len() as u32) < self.max_members,
                "Circle is already full"
            );
            assert!(!self.members.contains(&member), "Already a member of this circle");
            Self::assert_component_is_account(member);
            Self::assert_exact_contribution(&payment, self.contribution);

            let index = self.members.len() as u32;
            self.members.push(member);
            self.pot.deposit(payment);
            // Joining pays the round-0 contribution up front.
            self.paid[0] |= 1u64 << index;

            if self.members.len() as u32 == self.max_members {
                self.status = CircleStatus::Active;
                self.round = 0;
                self.round_deadline_epoch =
                    Consensus::current_epoch() + self.round_length_epochs;
            }
        }

        /// Contribute the fixed amount for the current round. Anyone may pay
        /// on a member's behalf; the template only checks the amount and the
        /// member slot.
        pub fn contribute(&mut self, member: ComponentAddress, payment: Bucket) {
            assert!(self.status == CircleStatus::Active, "Circle is not active");
            let index = self
                .member_index(member)
                .expect("Not a member of this circle");
            assert!(
                !self.is_defaulted(index),
                "Member has defaulted and can no longer contribute"
            );
            assert!(
                !self.has_paid(self.round, index),
                "Member has already paid this round"
            );
            Self::assert_exact_contribution(&payment, self.contribution);

            self.pot.deposit(payment);
            self.paid[self.round as usize] |= 1u64 << index;
        }

        /// Settle the current round. Anyone may call this.
        ///
        /// The round settles once every member in good standing has paid, or
        /// once the round deadline has passed. Members who have not paid by
        /// the deadline are marked as defaulted: they lose their payout turn
        /// and their past contributions stay in the pot.
        ///
        /// The whole pot goes to this round's recipient (unless they
        /// defaulted, in which case the pot rolls over to the next round).
        /// After the last round the circle completes.
        pub fn payout(&mut self) {
            assert!(self.status == CircleStatus::Active, "Circle is not active");
            let now = Consensus::current_epoch();
            let all_paid = self.all_active_members_paid();
            assert!(
                all_paid || now >= self.round_deadline_epoch,
                "Round is not ready: waiting for contributions or the round deadline"
            );

            // The deadline passed with missing payments: mark the stragglers.
            if !all_paid {
                let round_paid = self.paid[self.round as usize];
                for index in 0..self.members.len() as u32 {
                    if !self.is_defaulted(index) && (round_paid >> index) & 1 == 0 {
                        self.defaulted |= 1u64 << index;
                    }
                }
            }

            let recipient_index = self.round;
            let recipient = self.members[recipient_index as usize];
            if !self.is_defaulted(recipient_index) {
                let pot = self.pot.withdraw_all();
                let recipient_account = ComponentManager::get(recipient);
                recipient_account.invoke("deposit", args![pot]);
            }
            // If the recipient defaulted, the pot stays and rolls over.
            self.paid_out |= 1u64 << recipient_index;

            self.round += 1;
            if self.round >= self.max_members {
                self.status = CircleStatus::Completed;
            } else {
                self.round_deadline_epoch = now + self.round_length_epochs;
            }
        }

        /// Claim an equal share of the leftover pot after the circle has
        /// completed. Only members in good standing may claim; if every
        /// member defaulted, any member may claim, so funds are never stuck.
        /// The last claimer takes any dust.
        pub fn claim_leftover(&mut self, member: ComponentAddress) {
            assert!(self.status == CircleStatus::Completed, "Circle has not completed");
            let index = self
                .member_index(member)
                .expect("Not a member of this circle");
            assert!(
                !self.has_claimed_leftover(index),
                "Leftover share already claimed"
            );

            let good_remaining = self.unclaimed_good_standing_count();
            if good_remaining > 0 {
                assert!(
                    !self.is_defaulted(index),
                    "Defaulted members cannot claim while members in good standing remain"
                );
            }
            let claimants = if good_remaining > 0 {
                good_remaining
            } else {
                self.unclaimed_member_count()
            };

            let pot_balance = self.pot.balance();
            assert!(!pot_balance.is_zero(), "No leftover to claim");
            // The last claimer takes the whole remainder (including dust).
            let amount = if claimants == 1 {
                pot_balance
            } else {
                let total = pot_balance
                    .to_u64_checked()
                    .expect("Pot balance is too large");
                let share = total / claimants as u64;
                assert!(share > 0, "Leftover share is zero");
                Amount::new(share as u128)
            };

            self.leftover_claimed |= 1u64 << index;
            let bucket = self.pot.withdraw(amount);
            let account = ComponentManager::get(member);
            account.invoke("deposit", args![bucket]);
        }

        /// Cancel a circle that is still forming. Requires the organizer
        /// badge, which is burned. Joined members can then `refund`.
        pub fn cancel(&mut self, organizer_badge: Bucket) {
            assert!(
                self.status == CircleStatus::Forming,
                "Only a forming circle can be cancelled"
            );
            assert_eq!(
                organizer_badge.resource_address(),
                self.organizer_badge_resource,
                "Invalid organizer badge"
            );
            assert_eq!(
                organizer_badge.amount(),
                Amount::new(1),
                "Invalid organizer badge"
            );
            organizer_badge.burn();
            self.status = CircleStatus::Cancelled;
        }

        /// Refund one contribution after the circle was cancelled.
        pub fn refund(&mut self, member: ComponentAddress) {
            assert!(self.status == CircleStatus::Cancelled, "Circle was not cancelled");
            let index = self
                .member_index(member)
                .expect("Not a member of this circle");
            assert!((self.refunded >> index) & 1 == 0, "Already refunded");
            self.refunded |= 1u64 << index;
            let bucket = self.pot.withdraw(self.contribution);
            let account = ComponentManager::get(member);
            account.invoke("deposit", args![bucket]);
        }

        // ------------------------------------------------------------------
        // Views
        // ------------------------------------------------------------------

        /// Status code: 0 = Forming, 1 = Active, 2 = Completed, 3 = Cancelled.
        pub fn status_code(&self) -> u8 {
            self.status.code()
        }

        pub fn organizer(&self) -> ComponentAddress {
            self.organizer
        }

        pub fn organizer_badge_resource(&self) -> ResourceAddress {
            self.organizer_badge_resource
        }

        pub fn contribution(&self) -> Amount {
            self.contribution
        }

        pub fn max_members(&self) -> u32 {
            self.max_members
        }

        pub fn round_length_epochs(&self) -> u64 {
            self.round_length_epochs
        }

        /// Members in join order (= payout rotation order).
        pub fn members(&self) -> Vec<ComponentAddress> {
            self.members.clone()
        }

        pub fn member_count(&self) -> u32 {
            self.members.len() as u32
        }

        pub fn current_round(&self) -> u32 {
            self.round
        }

        pub fn round_deadline_epoch(&self) -> u64 {
            self.round_deadline_epoch
        }

        pub fn pot_balance(&self) -> Amount {
            self.pot.balance()
        }

        /// This round's recipient, if the circle is active.
        pub fn round_recipient(&self) -> Option<ComponentAddress> {
            if self.status == CircleStatus::Active {
                Some(self.members[self.round as usize])
            } else {
                None
            }
        }

        pub fn has_paid(&self, round: u32, member_index: u32) -> bool {
            if round >= self.max_members || member_index >= MAX_MEMBERS {
                return false;
            }
            (self.paid[round as usize] >> member_index) & 1 == 1
        }

        pub fn is_defaulted(&self, member_index: u32) -> bool {
            if member_index >= MAX_MEMBERS {
                return false;
            }
            (self.defaulted >> member_index) & 1 == 1
        }

        pub fn has_received_payout(&self, member_index: u32) -> bool {
            if member_index >= MAX_MEMBERS {
                return false;
            }
            (self.paid_out >> member_index) & 1 == 1
        }

        pub fn has_claimed_leftover(&self, member_index: u32) -> bool {
            if member_index >= MAX_MEMBERS {
                return false;
            }
            (self.leftover_claimed >> member_index) & 1 == 1
        }

        pub fn member_index(&self, member: ComponentAddress) -> Option<u32> {
            self.members
                .iter()
                .position(|m| *m == member)
                .map(|i| i as u32)
        }

        /// The share a single claimer would receive right now (0 unless the
        /// circle completed with a leftover pot).
        pub fn leftover_share(&self) -> Amount {
            if self.status != CircleStatus::Completed {
                return Amount::new(0);
            }
            let good_remaining = self.unclaimed_good_standing_count();
            let claimants = if good_remaining > 0 {
                good_remaining
            } else {
                self.unclaimed_member_count()
            };
            if claimants == 0 {
                return Amount::new(0);
            }
            let total = match self.pot.balance().to_u64_checked() {
                Some(v) => v,
                None => return Amount::new(0),
            };
            if claimants == 1 {
                Amount::new(total as u128)
            } else {
                Amount::new((total / claimants as u64) as u128)
            }
        }

        // ------------------------------------------------------------------
        // Private helpers
        // ------------------------------------------------------------------

        fn all_active_members_paid(&self) -> bool {
            let round_paid = self.paid[self.round as usize];
            for index in 0..self.members.len() as u32 {
                if !self.is_defaulted(index) && (round_paid >> index) & 1 == 0 {
                    return false;
                }
            }
            true
        }

        fn unclaimed_good_standing_count(&self) -> u32 {
            let mut count = 0u32;
            for index in 0..self.members.len() as u32 {
                if !self.is_defaulted(index) && !self.has_claimed_leftover(index) {
                    count += 1;
                }
            }
            count
        }

        fn unclaimed_member_count(&self) -> u32 {
            let mut count = 0u32;
            for index in 0..self.members.len() as u32 {
                if !self.has_claimed_leftover(index) {
                    count += 1;
                }
            }
            count
        }

        fn assert_component_is_account(component_address: ComponentAddress) {
            let component = ComponentManager::get(component_address);
            assert!(
                component.get_template_address() == ACCOUNT_TEMPLATE_ADDRESS,
                "Not an account component"
            );
        }

        fn assert_exact_contribution(payment: &Bucket, expected: Amount) {
            assert_eq!(
                payment.resource_address(),
                TARI_TOKEN,
                "Only TARI is accepted"
            );
            assert_eq!(
                payment.amount(),
                expected,
                "Payment must be exactly the contribution amount"
            );
        }
    }

    /// Lifecycle of a circle.
    ///
    /// Declared after `ArisanCircle` on purpose: the `#[template]` macro uses
    /// the first struct/enum in the module as the template name.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum CircleStatus {
        /// Accepting members; not started yet.
        Forming,
        /// Full and running rounds.
        Active,
        /// All rounds settled.
        Completed,
        /// Cancelled by the organizer while forming.
        Cancelled,
    }

    impl CircleStatus {
        /// Stable numeric code for the status (for views and tests).
        pub fn code(&self) -> u8 {
            match self {
                CircleStatus::Forming => 0,
                CircleStatus::Active => 1,
                CircleStatus::Completed => 2,
                CircleStatus::Cancelled => 3,
            }
        }
    }
}
