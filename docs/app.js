// Arisan demo app — drives the walletless simulation in the browser.
//
// Everything here runs locally: the ArisanCircle engine (arisan.js) holds
// all state, and this file only renders it and wires up buttons. No network
// calls, no wallet, no accounts.
(function () {
  "use strict";

  const { ArisanCircle, STATUS, formatTari, toMicroTari } = window.Arisan;

  // ------------------------------------------------------------------
  // Demo identities: deterministic fake component addresses.
  // ------------------------------------------------------------------

  const ROSTER_NAMES = [
    "Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi",
    "Ivan", "Judy", "Karl", "Lena", "Mike", "Nina", "Oscar", "Pam",
  ];

  // FNV-1a hash expanded into 40 hex chars — stable across page loads, so
  // Alice is always the same "address".
  function fakeAddress(name) {
    let a = 0x811c9dc5;
    let b = 0x01000193;
    const seed = "arisan-demo:" + name;
    for (let i = 0; i < seed.length; i += 1) {
      a = Math.imul(a ^ seed.charCodeAt(i), 0x01000193) >>> 0;
      b = Math.imul(b ^ seed.charCodeAt(i), 0x85ebca6b) >>> 0;
    }
    let hex = "";
    while (hex.length < 40) {
      a = Math.imul(a ^ (a >>> 13), 0x5bd1e995) >>> 0;
      b = Math.imul(b ^ (b >>> 15), 0x27d4eb2d) >>> 0;
      hex += a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
    }
    return "comp_" + hex.slice(0, 40);
  }

  function shortAddress(address) {
    return address.slice(0, 9) + "…" + address.slice(-4);
  }

  const ROSTER = ROSTER_NAMES.map((name) => ({ name, address: fakeAddress(name) }));
  const ORGANIZER = { name: "You (organizer)", address: fakeAddress("Organizer") };
  const NAMES = new Map(ROSTER.map((p) => [p.address, p.name]));
  NAMES.set(ORGANIZER.address, ORGANIZER.name);

  function nameOf(address) {
    return NAMES.get(address) || shortAddress(address);
  }

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  let circle = null; // ArisanCircle or null
  let hasBadge = true; // organizer badge checkbox (uncheck to demo a bad badge)
  let busy = false; // a scripted scenario (auto-play / simulate default) is running
  // index -> { type: "received", amount } | { type: "forfeited" }
  let payoutOutcomes = new Map();
  // index -> claimed amount (micro-Tari)
  let claimOutcomes = new Map();

  // ------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const contributionInput = $("contribution");
  const maxMembersInput = $("max-members");
  const roundLengthInput = $("round-length");
  const createBtn = $("create-btn");
  const resetBtn = $("reset-btn");
  const loadDemoBtn = $("load-demo-btn");
  const autoplayBtn = $("autoplay-btn");
  const simulateDefaultBtn = $("simulate-default-btn");
  const epochDisplay = $("epoch-display");
  const advance1Btn = $("advance-1-btn");
  const advanceDeadlineBtn = $("advance-deadline-btn");
  const noCircleNote = $("no-circle-note");
  const dashboard = $("dashboard");
  const dashStatus = $("dash-status");
  const dashPot = $("dash-pot");
  const dashRound = $("dash-round");
  const dashDeadline = $("dash-deadline");
  const dashRecipient = $("dash-recipient");
  const dashOrganizer = $("dash-organizer");
  const dashBadge = $("dash-badge");
  const dashLeftover = $("dash-leftover");
  const payoutBtn = $("payout-btn");
  const cancelBtn = $("cancel-btn");
  const badgeCheckbox = $("badge-checkbox");
  const narration = $("narration");
  const narrationList = $("narration-list");
  const joinPanel = $("join-panel");
  const seatsRemaining = $("seats-remaining");
  const joinList = $("join-list");
  const memberRows = $("member-rows");
  const eventLog = $("event-log");

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ------------------------------------------------------------------
  // Event log + narration
  // ------------------------------------------------------------------

  function log(message, kind = "info") {
    const li = document.createElement("li");
    li.className = "log-" + kind;
    const epoch = circle ? circle.currentEpoch : "–";
    li.textContent = "[epoch " + epoch + "] " + message;
    eventLog.prepend(li); // newest first
    while (eventLog.children.length > 200) {
      eventLog.removeChild(eventLog.lastChild);
    }
  }

  function narrate(text) {
    narration.hidden = false;
    const li = document.createElement("li");
    li.textContent = text;
    narrationList.appendChild(li);
  }

  function clearNarration() {
    narrationList.innerHTML = "";
    narration.hidden = true;
  }

  // ------------------------------------------------------------------
  // Actions — each one calls the engine, logs the outcome (including
  // rejections with the template's exact error message), and re-renders.
  // ------------------------------------------------------------------

  function createCircle(contributionTari, maxMembers, roundLength) {
    const contribution = toMicroTari(contributionTari);
    try {
      circle = ArisanCircle.create(ORGANIZER.address, contribution, maxMembers, roundLength);
      payoutOutcomes = new Map();
      claimOutcomes = new Map();
      log(
        "Circle created: " + formatTari(contribution) + " TARI per round, " +
          maxMembers + " members, " + roundLength + "-epoch rounds. " +
          "Organizer badge minted to you.",
        "ok",
      );
      render();
      return true;
    } catch (err) {
      log("Create rejected: " + err.message, "error");
      render();
      return false;
    }
  }

  function doJoin(member) {
    if (!circle) return null;
    try {
      const result = circle.join(member, circle.contribution);
      let message =
        nameOf(member) + " joined the circle (paid " +
        formatTari(circle.contribution) + " TARI up front).";
      if (result.started) {
        message +=
          " Circle is full — round 1 starts, deadline epoch " +
          circle.roundDeadlineEpoch() + ".";
      }
      log(message, "ok");
      render();
      return result;
    } catch (err) {
      log("Join rejected for " + nameOf(member) + ": " + err.message, "error");
      render();
      return null;
    }
  }

  function doContribute(member) {
    if (!circle) return null;
    try {
      circle.contribute(member, circle.contribution);
      log(
        nameOf(member) + " contributed " + formatTari(circle.contribution) +
          " TARI for round " + (circle.currentRound() + 1) + ".",
        "ok",
      );
      render();
      return true;
    } catch (err) {
      log("Contribute rejected for " + nameOf(member) + ": " + err.message, "error");
      render();
      return null;
    }
  }

  function doPayout() {
    if (!circle) return null;
    const round = circle.currentRound();
    const recipient = circle.roundRecipient();
    try {
      const out = circle.payout();
      if (out.defaultedIndices.length > 0) {
        const names = out.defaultedIndices
          .map((i) => nameOf(circle.membersList()[i]))
          .join(", ");
        log(names + " missed the deadline and defaulted.", "info");
      }
      if (out.rolledOver) {
        payoutOutcomes.set(out.recipientIndex, { type: "forfeited" });
        log(
          "Round " + (round + 1) + " settled: " + nameOf(recipient) +
            " defaulted, so the " + formatTari(circle.potBalance()) +
            " TARI pot rolls over to the next round.",
          "ok",
        );
      } else {
        payoutOutcomes.set(out.recipientIndex, { type: "received", amount: out.amount });
        log(
          "Round " + (round + 1) + " settled: " + nameOf(recipient) +
            " takes the pot of " + formatTari(out.amount) + " TARI.",
          "ok",
        );
      }
      if (out.completed) {
        log(
          circle.potBalance() > 0
            ? "Circle completed with a leftover pot of " +
                formatTari(circle.potBalance()) +
                " TARI — members in good standing can claim a share."
            : "Circle completed. The pot is empty.",
          "ok",
        );
      }
      render();
      return out;
    } catch (err) {
      log("Payout rejected: " + err.message, "error");
      render();
      return null;
    }
  }

  function doClaimLeftover(member) {
    if (!circle) return null;
    try {
      const out = circle.claimLeftover(member);
      claimOutcomes.set(out.index, out.amount);
      log(
        nameOf(member) + " claimed a leftover share of " +
          formatTari(out.amount) + " TARI (" + out.claimants +
          (out.claimants === 1 ? " claimant" : " claimants") + " at the time).",
        "ok",
      );
      render();
      return out;
    } catch (err) {
      log("Leftover claim rejected for " + nameOf(member) + ": " + err.message, "error");
      render();
      return null;
    }
  }

  function doRefund(member) {
    if (!circle) return null;
    try {
      const out = circle.refund(member);
      log(
        nameOf(member) + " refunded " + formatTari(out.amount) + " TARI.",
        "ok",
      );
      render();
      return out;
    } catch (err) {
      log("Refund rejected for " + nameOf(member) + ": " + err.message, "error");
      render();
      return null;
    }
  }

  function doCancel() {
    if (!circle) return null;
    try {
      circle.cancel(hasBadge);
      log(
        "Circle cancelled. The organizer badge was burned; members can now refund.",
        "ok",
      );
      render();
      return true;
    } catch (err) {
      log("Cancel rejected: " + err.message, "error");
      render();
      return null;
    }
  }

  function resetDemo(options = {}) {
    circle = null;
    payoutOutcomes = new Map();
    claimOutcomes = new Map();
    clearNarration();
    if (!options.quiet) log("Demo reset.", "info");
    render();
  }

  function loadDemo() {
    resetDemo({ quiet: true });
    clearNarration();
    createCircle(10, 3, 10);
    doJoin(ROSTER[0].address); // Alice
    doJoin(ROSTER[1].address); // Bob
    doJoin(ROSTER[2].address); // Carol
  }

  // ------------------------------------------------------------------
  // Scripted scenarios
  // ------------------------------------------------------------------

  async function autoPlay() {
    if (busy) return;
    busy = true;
    clearNarration();
    render();
    try {
      if (!circle || circle.statusCode() !== STATUS.ACTIVE) {
        narrate("No active circle — loading the 3-member demo first.");
        loadDemo();
        await sleep(700);
      }
      let guard = 0;
      while (circle && circle.statusCode() === STATUS.ACTIVE && guard < 40) {
        guard += 1;
        const round = circle.currentRound();
        const recipient = circle.roundRecipient();
        narrate(
          "Round " + (round + 1) + " of " + circle.maxMembers +
            ": " + nameOf(recipient) + " is the recipient.",
        );
        for (const member of circle.membersList()) {
          const index = circle.memberIndex(member);
          if (!circle.isDefaulted(index) && !circle.hasPaid(round, index)) {
            doContribute(member);
            await sleep(450);
          }
        }
        await sleep(300);
        doPayout();
        await sleep(650);
      }
      // Claim any leftover (a clean run leaves an empty pot, so usually nothing).
      if (circle && circle.statusCode() === STATUS.COMPLETED && circle.potBalance() > 0) {
        for (const member of circle.membersList()) {
          doClaimLeftover(member);
          await sleep(300);
        }
      }
      narrate(
        "Circle complete. In a clean run every member ends where they started — " +
          "check the Net column: each paid 30 TARI and received 30 TARI.",
      );
    } finally {
      busy = false;
      render();
    }
  }

  async function simulateDefault() {
    if (busy) return;
    busy = true;
    clearNarration();
    render();
    try {
      resetDemo({ quiet: true });
      narrate("Setting up a 3-member circle: Alice, Bob and Carol, 10 TARI per round.");
      createCircle(10, 3, 10);
      doJoin(ROSTER[0].address);
      doJoin(ROSTER[1].address);
      doJoin(ROSTER[2].address);
      await sleep(800);

      narrate(
        "Round 1: everyone already paid by joining. Alice — first to join — takes the 30 TARI pot.",
      );
      doPayout();
      await sleep(900);

      narrate("Round 2: Alice and Carol contribute their 10 TARI. Bob doesn't show up…");
      doContribute(ROSTER[0].address);
      await sleep(450);
      doContribute(ROSTER[2].address);
      await sleep(500);

      narrate(
        "The round can't settle yet — Bob hasn't paid and the deadline hasn't passed. " +
          "Watch what happens when someone tries to settle early:",
      );
      doPayout(); // rejected: round not ready
      await sleep(700);

      narrate("Time passes… advancing the epoch to the round deadline.");
      while (circle && circle.currentEpoch < circle.roundDeadlineEpoch()) {
        circle.advanceEpochs(1);
        render();
        await sleep(130);
      }
      log("Epoch reached the round deadline (" + circle.roundDeadlineEpoch() + ").", "info");
      await sleep(500);

      narrate(
        "Deadline reached. Anyone can now settle the round — and Bob is marked as defaulted.",
      );
      doPayout();
      await sleep(900);

      narrate(
        "Bob was round 2's recipient, so his payout is forfeited: the 20 TARI pot rolls over " +
          "to round 3. His earlier 10 TARI stays in the pot — defaults don't get refunds.",
      );
      await sleep(900);

      narrate("Bob tries to contribute again — the template refuses. Defaulted members can't come back.");
      doContribute(ROSTER[1].address); // rejected: defaulted
      await sleep(800);

      narrate(
        "Round 3: Alice and Carol contribute; Carol takes the rolled-over pot of 40 TARI " +
          "and the circle completes.",
      );
      doContribute(ROSTER[0].address);
      await sleep(450);
      doContribute(ROSTER[2].address);
      await sleep(450);
      doPayout();
      await sleep(700);

      narrate(
        "Final tally — Alice ±0 (paid 30, received 30), Bob −10 (paid 10, received nothing), " +
          "Carol +10 (paid 30, received 40). The pot Bob abandoned went to Carol: " +
          "the circle still settles and nobody's funds are stuck.",
      );
    } finally {
      busy = false;
      render();
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  function unclaimedGoodStandingCount() {
    let count = 0;
    for (let i = 0; i < circle.memberCount(); i += 1) {
      if (!circle.isDefaulted(i) && !circle.hasClaimedLeftover(i)) count += 1;
    }
    return count;
  }

  function roundReady() {
    if (!circle || circle.statusCode() !== STATUS.ACTIVE) return false;
    if (circle.currentEpoch >= circle.roundDeadlineEpoch()) return true;
    const round = circle.currentRound();
    for (let i = 0; i < circle.memberCount(); i += 1) {
      if (!circle.isDefaulted(i) && !circle.hasPaid(round, i)) return false;
    }
    return true;
  }

  // Per-button disabled state + tooltip explanation.
  function contributeState(index) {
    if (!circle) return { disabled: true, reason: "No circle yet" };
    if (busy) return { disabled: true, reason: "A scripted demo is running…" };
    if (circle.statusCode() !== STATUS.ACTIVE) {
      return { disabled: true, reason: "Circle is not active" };
    }
    if (circle.isDefaulted(index)) {
      return { disabled: true, reason: "Member has defaulted and can no longer contribute" };
    }
    if (circle.hasPaid(circle.currentRound(), index)) {
      return { disabled: true, reason: "Member has already paid this round" };
    }
    return {
      disabled: false,
      reason: "Contribute " + formatTari(circle.contribution) +
        " TARI for round " + (circle.currentRound() + 1),
    };
  }

  function claimState(index) {
    if (!circle) return { disabled: true, reason: "No circle yet" };
    if (busy) return { disabled: true, reason: "A scripted demo is running…" };
    if (circle.statusCode() !== STATUS.COMPLETED) {
      return { disabled: true, reason: "Circle has not completed" };
    }
    if (circle.hasClaimedLeftover(index)) {
      return { disabled: true, reason: "Leftover share already claimed" };
    }
    if (circle.potBalance() === 0) {
      return { disabled: true, reason: "No leftover to claim" };
    }
    if (circle.isDefaulted(index) && unclaimedGoodStandingCount() > 0) {
      return {
        disabled: true,
        reason: "Defaulted members cannot claim while members in good standing remain",
      };
    }
    return {
      disabled: false,
      reason: "Claim a leftover share of " + formatTari(circle.leftoverShare()) + " TARI",
    };
  }

  function refundState(index) {
    if (!circle) return { disabled: true, reason: "No circle yet" };
    if (busy) return { disabled: true, reason: "A scripted demo is running…" };
    if (circle.statusCode() !== STATUS.CANCELLED) {
      return { disabled: true, reason: "Circle was not cancelled" };
    }
    if (circle.hasRefunded(index)) {
      return { disabled: true, reason: "Already refunded" };
    }
    return {
      disabled: false,
      reason: "Refund " + formatTari(circle.contribution) + " TARI",
    };
  }

  function actionButton(label, state, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = label;
    btn.disabled = state.disabled;
    btn.title = state.reason;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function textCell(text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function render() {
    // Epoch display.
    epochDisplay.textContent = circle ? String(circle.currentEpoch) : "—";

    // Dashboard.
    noCircleNote.hidden = Boolean(circle);
    dashboard.hidden = !circle;
    if (circle) {
      const status = circle.statusCode();
      dashStatus.textContent = circle.statusName();
      dashStatus.className = "status-pill status-" + status;
      dashPot.textContent = formatTari(circle.potBalance()) + " TARI";
      if (status === STATUS.FORMING) {
        dashRound.textContent =
          "Forming — " + circle.memberCount() + "/" + circle.maxMembers + " members";
      } else if (status === STATUS.ACTIVE) {
        dashRound.textContent =
          "Round " + (circle.currentRound() + 1) + " of " + circle.maxMembers;
      } else if (status === STATUS.COMPLETED) {
        dashRound.textContent = "Completed — " + circle.maxMembers + " rounds settled";
      } else {
        dashRound.textContent = "Cancelled";
      }
      if (status === STATUS.ACTIVE) {
        const deadline = circle.roundDeadlineEpoch();
        const remaining = deadline - circle.currentEpoch;
        dashDeadline.textContent =
          "Epoch " + deadline + (remaining > 0 ? " (in " + remaining + ")" : " (reached)");
      } else {
        dashDeadline.textContent = "—";
      }
      dashRecipient.textContent =
        status === STATUS.ACTIVE ? nameOf(circle.roundRecipient()) : "—";
      dashOrganizer.textContent = "You — " + shortAddress(circle.organizer);
      dashOrganizer.title = circle.organizer;
      dashBadge.textContent = circle.badgeBurned ? "Burned" : "Held";
      if (status === STATUS.COMPLETED) {
        dashLeftover.textContent =
          circle.potBalance() > 0
            ? formatTari(circle.leftoverShare()) + " TARI each"
            : "None — pot is empty";
      } else {
        dashLeftover.textContent = "—";
      }
    }

    // Global buttons.
    const formDisabled = Boolean(circle) || busy;
    contributionInput.disabled = formDisabled;
    maxMembersInput.disabled = formDisabled;
    roundLengthInput.disabled = formDisabled;
    createBtn.disabled = formDisabled;
    createBtn.title = circle
      ? "Reset the demo first to create a new circle"
      : busy
        ? "A scripted demo is running…"
        : "Create a new circle";
    resetBtn.disabled = busy;
    loadDemoBtn.disabled = busy;
    autoplayBtn.disabled = busy;
    simulateDefaultBtn.disabled = busy;

    advance1Btn.disabled = !circle || busy;
    advance1Btn.title = circle ? "Move the simulated epoch forward by 1" : "No circle yet";
    const atDeadline =
      circle &&
      circle.statusCode() === STATUS.ACTIVE &&
      circle.currentEpoch >= circle.roundDeadlineEpoch();
    advanceDeadlineBtn.disabled =
      !circle || busy || circle.statusCode() !== STATUS.ACTIVE || atDeadline;
    advanceDeadlineBtn.title = !circle
      ? "No circle yet"
      : circle.statusCode() !== STATUS.ACTIVE
        ? "Circle is not active"
        : atDeadline
          ? "Already at (or past) the deadline"
          : "Jump to the round deadline (epoch " + circle.roundDeadlineEpoch() + ")";

    payoutBtn.disabled = !circle || busy || circle.statusCode() !== STATUS.ACTIVE;
    if (!circle) {
      payoutBtn.title = "No circle yet";
    } else if (circle.statusCode() !== STATUS.ACTIVE) {
      payoutBtn.title = "Circle is not active";
    } else if (roundReady()) {
      payoutBtn.title =
        "Settle round " + (circle.currentRound() + 1) + " — " +
        nameOf(circle.roundRecipient()) + " takes the pot";
    } else {
      payoutBtn.title =
        "Round " + (circle.currentRound() + 1) +
        " is not ready: waiting for contributions or the round deadline (epoch " +
        circle.roundDeadlineEpoch() + ")";
    }

    cancelBtn.disabled = !circle || busy || circle.statusCode() !== STATUS.FORMING;
    cancelBtn.title = !circle
      ? "No circle yet"
      : circle.statusCode() !== STATUS.FORMING
        ? "Only a forming circle can be cancelled"
        : hasBadge
          ? "Cancel the circle and burn the organizer badge"
          : "Cancel without a valid badge — this will be rejected";

    badgeCheckbox.disabled = Boolean(circle && circle.badgeBurned);

    // Join panel (forming only).
    const forming = circle && circle.statusCode() === STATUS.FORMING;
    joinPanel.hidden = !forming;
    if (forming) {
      const seats = circle.maxMembers - circle.memberCount();
      seatsRemaining.textContent = seats + (seats === 1 ? " seat" : " seats") + " remaining";
      joinList.innerHTML = "";
      let shown = 0;
      for (const person of ROSTER) {
        if (shown >= seats) break;
        if (circle.memberIndex(person.address) !== null) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.textContent = "Join as " + person.name;
        btn.disabled = busy;
        btn.title =
          "Join the circle as " + person.name + " (pays " +
          formatTari(circle.contribution) + " TARI up front)";
        btn.addEventListener("click", () => doJoin(person.address));
        joinList.appendChild(btn);
        shown += 1;
      }
    }

    // Member table.
    memberRows.innerHTML = "";
    if (!circle || circle.memberCount() === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 9;
      td.className = "empty-row";
      td.textContent = "No members yet.";
      tr.appendChild(td);
      memberRows.appendChild(tr);
      return;
    }

    circle.membersList().forEach((member, index) => {
      const tr = document.createElement("tr");

      tr.appendChild(textCell(String(index + 1)));

      // Member: display name + fake address.
      const memberCell = document.createElement("td");
      const nameEl = document.createElement("strong");
      nameEl.textContent = nameOf(member);
      const addrEl = document.createElement("span");
      addrEl.className = "addr";
      addrEl.textContent = shortAddress(member);
      addrEl.title = member;
      memberCell.appendChild(nameEl);
      memberCell.appendChild(addrEl);
      tr.appendChild(memberCell);

      // Paid this round.
      const status = circle.statusCode();
      if (status === STATUS.FORMING) {
        tr.appendChild(
          circle.hasPaid(0, index)
            ? textCell("✓", "cell-yes")
            : textCell("–", "cell-no"),
        );
      } else if (status === STATUS.ACTIVE) {
        tr.appendChild(
          circle.hasPaid(circle.currentRound(), index)
            ? textCell("✓", "cell-yes")
            : textCell("–", "cell-no"),
        );
      } else {
        tr.appendChild(textCell("—", "cell-no"));
      }

      // Defaulted?
      tr.appendChild(
        circle.isDefaulted(index)
          ? textCell("Yes", "cell-bad")
          : textCell("–", "cell-no"),
      );

      // Payout.
      const outcome = payoutOutcomes.get(index);
      if (status === STATUS.CANCELLED && circle.hasRefunded(index)) {
        tr.appendChild(textCell("Refunded ✓", "cell-good"));
      } else if (outcome && outcome.type === "received") {
        tr.appendChild(textCell("✓ " + formatTari(outcome.amount) + " TARI", "cell-good"));
      } else if (outcome && outcome.type === "forfeited") {
        tr.appendChild(textCell("Forfeited", "cell-bad"));
      } else {
        tr.appendChild(textCell("–", "cell-no"));
      }

      // Leftover.
      if (circle.hasClaimedLeftover(index)) {
        const amount = claimOutcomes.get(index) || 0;
        tr.appendChild(textCell("✓ " + formatTari(amount) + " TARI", "cell-good"));
      } else {
        tr.appendChild(textCell("–", "cell-no"));
      }

      // Balance and net position.
      tr.appendChild(textCell(formatTari(circle.balanceOf(member)) + " TARI"));
      const net = circle.netOf(member);
      const netText = net > 0
        ? "+" + formatTari(net)
        : net < 0
          ? "−" + formatTari(-net)
          : "0";
      tr.appendChild(
        textCell(netText + " TARI", net > 0 ? "net-pos" : net < 0 ? "net-neg" : "cell-no"),
      );

      // Per-member actions.
      const actionsCell = document.createElement("td");
      actionsCell.className = "actions";
      actionsCell.appendChild(
        actionButton("Contribute", contributeState(index), () => doContribute(member)),
      );
      actionsCell.appendChild(
        actionButton("Claim leftover", claimState(index), () => doClaimLeftover(member)),
      );
      actionsCell.appendChild(
        actionButton("Refund", refundState(index), () => doRefund(member)),
      );
      tr.appendChild(actionsCell);

      memberRows.appendChild(tr);
    });
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  $("create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const contribution = parseFloat(contributionInput.value);
    const maxMembers = parseInt(maxMembersInput.value, 10);
    const roundLength = parseInt(roundLengthInput.value, 10);
    if (!Number.isFinite(contribution) || !Number.isInteger(maxMembers) ||
        !Number.isInteger(roundLength)) {
      log("Create rejected: please enter numbers in all three fields.", "error");
      return;
    }
    createCircle(contribution, maxMembers, roundLength);
  });

  resetBtn.addEventListener("click", () => resetDemo());
  loadDemoBtn.addEventListener("click", loadDemo);
  autoplayBtn.addEventListener("click", autoPlay);
  simulateDefaultBtn.addEventListener("click", simulateDefault);

  advance1Btn.addEventListener("click", () => {
    if (!circle) return;
    circle.advanceEpochs(1);
    log("Epoch advanced to " + circle.currentEpoch + ".", "info");
    render();
  });

  advanceDeadlineBtn.addEventListener("click", () => {
    if (!circle || circle.statusCode() !== STATUS.ACTIVE) return;
    const target = circle.roundDeadlineEpoch();
    if (circle.currentEpoch < target) {
      circle.setEpoch(target);
      log("Epoch advanced to the round deadline (" + target + ").", "info");
    }
    render();
  });

  payoutBtn.addEventListener("click", doPayout);
  cancelBtn.addEventListener("click", doCancel);
  badgeCheckbox.addEventListener("change", () => {
    hasBadge = badgeCheckbox.checked;
    render();
  });

  // Initial render + welcome line.
  render();
  log("Welcome — create a circle above, or load the 3-member demo to get started.", "info");
})();
