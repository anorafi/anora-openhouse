// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";
import {AnoraFactory} from "../src/AnoraFactory.sol";
import {AnoraFacility} from "../src/AnoraFacility.sol";

contract LifecycleTest is Test {
    uint256 constant USDC = 1e6;
    uint256 constant T0 = 1_900_000_000;
    string constant DIR = "test/fixtures/status/";
    bytes32 constant INITIALIZED = keccak256("Initialized(uint64)");

    struct Logged {
        address emitter;
        bytes32[] topics;
        bytes data;
        uint256 blockNumber;
        uint256 logIndex;
        bytes32 txHash;
    }

    TestUSDC usdc;
    AnoraFactory factory;
    AnoraFacility f;
    Logged[] logged;
    uint256 step;
    uint256 providerDeposited;
    uint256 providerWithdrawn;

    address riskAgent = makeAddr("riskAgent");
    address provider = makeAddr("provider");
    address originator = makeAddr("originator");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(T0);
        vm.roll(100);
        usdc = new TestUSDC();
        factory = new AnoraFactory(address(usdc), riskAgent, 1_000);
        factory.setOriginatorApproved(originator, true);
        usdc.mint(provider, 100 * USDC);
        usdc.mint(originator, 100 * USDC);
        vm.prank(originator);
        usdc.approve(address(factory), type(uint256).max);
        vm.recordLogs();
    }

    function _terms() internal pure returns (AnoraFacility.Terms memory) {
        return AnoraFacility.Terms({
            limit: 10 * USDC,
            firstLoss: 3 * USDC,
            tenor: 90 days,
            grace: 30 days,
            financingFeeBps: 500,
            lateFeePerDayBps: 10,
            seniorPerJuniorBps: 22_500,
            seniorFeeShareBps: 6_000,
            capitalCap: 1_000_000 * USDC
        });
    }

    function _collect() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        step += 1;
        for (uint256 i = 0; i < logs.length; i++) {
            bool ours = logs[i].emitter == address(factory) || logs[i].emitter == address(f);
            if (!ours || logs[i].topics[0] == INITIALIZED) continue;
            logged.push(
                Logged(logs[i].emitter, logs[i].topics, logs[i].data, block.number, i, keccak256(abi.encode(step, i)))
            );
        }
        vm.roll(block.number + 1);
    }

    function _create() internal {
        vm.prank(originator);
        f = AnoraFacility(
            factory.createFacility("Rice Shipment 01 | Siam Grains | Thailand to Philippines | Commodity finance | x", _terms())
        );
        _collect();
    }

    function _deposit(uint256 amount) internal {
        vm.startPrank(provider);
        usdc.approve(address(f), amount);
        f.deposit(AnoraFacility.Tranche.Senior, amount);
        vm.stopPrank();
        providerDeposited += amount;
        _collect();
    }

    function _withdrawAll() internal {
        uint256 shares = f.seniorShares(provider);
        uint256 balanceBefore = usdc.balanceOf(provider);
        vm.prank(provider);
        f.withdraw(AnoraFacility.Tranche.Senior, shares);
        providerWithdrawn += usdc.balanceOf(provider) - balanceBefore;
        _collect();
    }

    function _draw(uint256 amount) internal {
        vm.prank(originator);
        f.drawdown(amount);
        _collect();
    }

    function _repay(uint256 amount) internal {
        vm.startPrank(originator);
        usdc.approve(address(f), amount);
        f.repay(amount);
        vm.stopPrank();
        _collect();
    }

    function _pastDue() internal {
        vm.warp(f.dueAt() + 1);
    }

    function _late() internal {
        _pastDue();
        f.markLate();
        _collect();
    }

    function _default() internal {
        vm.warp(f.lateSince() + 30 days);
        vm.prank(riskAgent);
        f.declareDefault("Buyer missed payment");
        _collect();
    }

    function _recover(uint256 amount) internal {
        vm.startPrank(originator);
        usdc.approve(address(f), amount);
        f.recordRecovery(amount);
        vm.stopPrank();
        _collect();
    }

    function _s(uint256 v) internal pure returns (string memory) {
        return string.concat('"', vm.toString(v), '"');
    }

    function _kv(string memory k, string memory v) internal pure returns (string memory) {
        return string.concat('"', k, '":', v);
    }

    function _termsJson() internal view returns (string memory) {
        (uint256 a, uint256 b, uint256 c, uint256 d, uint256 e, uint256 g, uint256 h, uint256 i, uint256 j) = f.terms();
        return string.concat(
            "{",
            _kv("limit", _s(a)), ",",
            _kv("firstLoss", _s(b)), ",",
            _kv("tenor", _s(c)), ",",
            _kv("grace", _s(d)), ",",
            _kv("financingFeeBps", _s(e)), ",",
            _kv("lateFeePerDayBps", _s(g)), ",",
            _kv("seniorPerJuniorBps", _s(h)), ",",
            _kv("seniorFeeShareBps", _s(i)), ",",
            _kv("capitalCap", _s(j)),
            "}"
        );
    }

    function _rawJson() internal view returns (string memory) {
        (uint256 lossFirst, uint256 lossJunior, uint256 lossSenior) = f.losses();
        string memory state = string.concat(
            _kv("status", _s(uint256(f.status()))), ",",
            _kv("principal", _s(f.principal())), ",",
            _kv("fee", _s(f.fee())), ",",
            _kv("owed", _s(f.owed())), ",",
            _kv("dueAt", _s(f.dueAt())), ",",
            _kv("lateSince", _s(f.lateSince())), ",",
            _kv("defaultedAt", _s(f.defaultedAt())), ",",
            _kv("defaultReason", string.concat('"', f.defaultReason(), '"')), ","
        );
        string memory capital = string.concat(
            _kv("totalCapital", _s(f.totalCapital())), ",",
            _kv("firstLossReserve", _s(f.firstLossReserve())), ",",
            _kv("seniorAssets", _s(f.seniorAssets())), ",",
            _kv("juniorAssets", _s(f.juniorAssets())), ",",
            _kv("seniorTotalShares", _s(f.seniorTotalShares())), ",",
            _kv("juniorTotalShares", _s(f.juniorTotalShares())), ",",
            _kv("seniorCapacity", _s(f.seniorCapacity())), ",",
            _kv("liquidity", _s(f.liquidity())), ","
        );
        string memory losses = string.concat(
            _kv("lossFirstLoss", _s(lossFirst)), ",",
            _kv("lossJunior", _s(lossJunior)), ",",
            _kv("lossSenior", _s(lossSenior)), ",",
            _kv("providerSeniorShares", _s(f.seniorShares(provider))), ",",
            _kv("providerJuniorShares", _s(f.juniorShares(provider))), ",",
            _kv("providerDeposited", _s(providerDeposited)), ",",
            _kv("providerWithdrawn", _s(providerWithdrawn)), ",",
            _kv("terms", _termsJson())
        );
        return string.concat("{", state, capital, losses, "}");
    }

    function _logsJson() internal view returns (string memory) {
        string memory out = "[";
        for (uint256 i = 0; i < logged.length; i++) {
            Logged storage l = logged[i];
            string memory topics = "[";
            for (uint256 t = 0; t < l.topics.length; t++) {
                topics = string.concat(topics, t == 0 ? "" : ",", '"', vm.toString(l.topics[t]), '"');
            }
            out = string.concat(
                out,
                i == 0 ? "" : ",",
                "{",
                _kv("address", string.concat('"', vm.toString(l.emitter), '"')), ",",
                _kv("topics", string.concat(topics, "]")), ",",
                _kv("data", string.concat('"', vm.toString(l.data), '"')), ",",
                _kv("blockNumber", _s(l.blockNumber)), ",",
                _kv("logIndex", vm.toString(l.logIndex)), ",",
                _kv("txHash", string.concat('"', vm.toString(l.txHash), '"')),
                "}"
            );
        }
        return string.concat(out, "]");
    }

    function _write(string memory name, string memory facilityStatus, bool pastDue, string memory webStage, string memory position, string memory action)
        internal
    {
        string memory expected = string.concat(
            "{",
            _kv("facility", string.concat('"', facilityStatus, '"')), ",",
            _kv("pastDue", pastDue ? "true" : "false"), ",",
            _kv("webStage", string.concat('"', webStage, '"')), ",",
            _kv("position", string.concat('"', position, '"')), ",",
            _kv("webMarketAction", string.concat('"', action, '"')),
            "}"
        );
        string memory head = string.concat(
            "{",
            _kv("scenario", string.concat('"', name, '"')), ",",
            _kv("now", _s(block.timestamp)), ",",
            _kv("chainId", "31337"), ",",
            _kv("factory", string.concat('"', vm.toString(address(factory)), '"')), ",",
            _kv("facility", string.concat('"', vm.toString(address(f)), '"')), ",",
            _kv("provider", string.concat('"', vm.toString(provider), '"')), ",",
            _kv("originator", string.concat('"', vm.toString(originator), '"')), ","
        );
        string memory json = string.concat(
            head, _kv("raw", _rawJson()), ",", _kv("logs", _logsJson()), ",", _kv("expected", expected), "}"
        );
        vm.writeFile(string.concat(DIR, name, ".json"), json);
    }

    function _status() internal view returns (AnoraFacility.Status) {
        return f.status();
    }

    function test_funding() public {
        _create();
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Open));
        assertEq(f.principal(), 0);
        assertEq(f.seniorTotalShares() + f.juniorTotalShares(), 0);
        _write("funding", "FUNDING", false, "open", "NONE", "");
    }

    function test_funded() public {
        _create();
        _deposit(6 * USDC);
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Open));
        assertEq(f.principal(), 0);
        assertGt(f.seniorTotalShares(), 0);
        _write("funded", "FUNDED", false, "funded", "HELD", "View market");
    }

    function test_fundedThenFullyWithdrawn() public {
        _create();
        _deposit(6 * USDC);
        _withdrawAll();
        assertEq(f.seniorTotalShares(), 0);
        assertEq(f.dueAt(), 0);
        _write("funded_withdrawn", "FUNDING", false, "open", "SETTLED", "View market");
    }

    function test_active() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        assertEq(f.principal(), 6 * USDC);
        assertGt(f.dueAt(), block.timestamp);
        _write("active", "ACTIVE", false, "drawn", "HELD", "View position");
    }

    function test_activeWithOnlyFeeOutstanding() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _repay(6 * USDC);
        assertEq(f.principal(), 0);
        assertGt(f.fee(), 0);
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Open));
        _write("active_fee_only", "ACTIVE", false, "drawn", "HELD", "View position");
    }

    function test_pastDueButNotMarked() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _pastDue();
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Open));
        assertGt(block.timestamp, f.dueAt());
        _write("past_due_unmarked", "ACTIVE", true, "drawn", "HELD", "View position");
    }

    function test_late() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _late();
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Late));
        _write("late", "LATE", false, "late", "HELD", "View position");
    }

    function test_defaulted() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _late();
        _default();
        (uint256 lf, uint256 lj, uint256 ls) = f.losses();
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Defaulted));
        assertEq(lf + lj + ls, 6 * USDC);
        _write("defaulted", "DEFAULTED", false, "defaulted", "HELD", "View position");
    }

    function test_recoveredPartially() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _late();
        _default();
        _recover(2 * USDC);
        (uint256 lf, uint256 lj, uint256 ls) = f.losses();
        assertGt(lf + lj + ls, 0);
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Defaulted));
        _write("recovered_partial", "DEFAULTED", false, "defaulted", "HELD", "View position");
    }

    function test_recoveredFully() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _late();
        _default();
        _recover(6 * USDC);
        (uint256 lf, uint256 lj, uint256 ls) = f.losses();
        assertEq(lf + lj + ls, 0);
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Defaulted));
        _write("recovered_full", "RECOVERED", false, "recovered", "CLAIMABLE", "Claim funds");
    }

    function test_closedAfterRecoveryAndWithdrawal() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _late();
        _default();
        _recover(6 * USDC);
        _withdrawAll();
        assertEq(f.seniorTotalShares() + f.juniorTotalShares(), 0);
        _write("closed_after_recovery", "CLOSED", false, "closed", "SETTLED", "View history");
    }

    function test_repaid() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _repay(6.3e6);
        assertEq(uint256(_status()), uint256(AnoraFacility.Status.Closed));
        assertGt(f.seniorTotalShares(), 0);
        _write("repaid", "REPAID", false, "repaid", "CLAIMABLE", "Claim funds");
    }

    function test_settledAfterRepayment() public {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
        _repay(6.3e6);
        _withdrawAll();
        assertEq(f.seniorTotalShares() + f.juniorTotalShares(), 0);
        assertEq(f.seniorAssets(), 0);
        _write("settled", "CLOSED", false, "settled", "SETTLED", "View history");
    }

    function _funded() internal {
        _create();
        _deposit(6 * USDC);
        _draw(6 * USDC);
    }

    function test_impossible_defaultWhileOpen() public {
        _funded();
        vm.prank(riskAgent);
        vm.expectRevert(AnoraFacility.FacilityNotLate.selector);
        f.declareDefault("early");
    }

    function test_impossible_defaultBeforeGraceElapsed() public {
        _funded();
        _late();
        vm.prank(riskAgent);
        vm.expectRevert(AnoraFacility.GraceNotElapsed.selector);
        f.declareDefault("early");
    }

    function test_impossible_defaultByAnyoneButRiskAgent() public {
        _funded();
        _late();
        vm.warp(f.lateSince() + 30 days);
        vm.prank(stranger);
        vm.expectRevert(AnoraFacility.NotRiskAgent.selector);
        f.declareDefault("nope");
    }

    function test_impossible_markLateBeforeDue() public {
        _funded();
        vm.expectRevert(AnoraFacility.NotPastDue.selector);
        f.markLate();
    }

    function test_impossible_markLateWithoutDrawdown() public {
        _create();
        _deposit(6 * USDC);
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(AnoraFacility.NotPastDue.selector);
        f.markLate();
    }

    function test_impossible_markLateTwice() public {
        _funded();
        _late();
        vm.expectRevert(AnoraFacility.FacilityNotOpen.selector);
        f.markLate();
    }

    function test_impossible_markLateAfterClose() public {
        _funded();
        _repay(6.3e6);
        vm.expectRevert(AnoraFacility.FacilityNotOpen.selector);
        f.markLate();
    }

    function test_impossible_drawAfterLate() public {
        _funded();
        _late();
        vm.prank(originator);
        vm.expectRevert(AnoraFacility.FacilityNotOpen.selector);
        f.drawdown(1 * USDC);
    }

    function test_impossible_drawAfterClose() public {
        _funded();
        _repay(6.3e6);
        vm.prank(originator);
        vm.expectRevert(AnoraFacility.FacilityNotOpen.selector);
        f.drawdown(1 * USDC);
    }

    function test_impossible_drawPastDueBeforeMarking() public {
        _funded();
        _pastDue();
        vm.prank(originator);
        vm.expectRevert(AnoraFacility.PastDue.selector);
        f.drawdown(1 * USDC);
    }

    function test_impossible_recoverWhileOpen() public {
        _funded();
        vm.startPrank(originator);
        usdc.approve(address(f), 1 * USDC);
        vm.expectRevert(AnoraFacility.NothingToRecover.selector);
        f.recordRecovery(1 * USDC);
        vm.stopPrank();
    }

    function test_impossible_recoverMoreThanTheLoss() public {
        _funded();
        _late();
        _default();
        vm.startPrank(originator);
        usdc.approve(address(f), 7 * USDC);
        vm.expectRevert(AnoraFacility.NothingToRecover.selector);
        f.recordRecovery(7 * USDC);
        vm.stopPrank();
    }

    function test_impossible_recoverAfterFullRecovery() public {
        _funded();
        _late();
        _default();
        _recover(6 * USDC);
        vm.startPrank(originator);
        usdc.approve(address(f), 1 * USDC);
        vm.expectRevert(AnoraFacility.NothingToRecover.selector);
        f.recordRecovery(1 * USDC);
        vm.stopPrank();
    }

    function test_impossible_repayAfterDefault() public {
        _funded();
        _late();
        _default();
        vm.startPrank(originator);
        usdc.approve(address(f), 1 * USDC);
        vm.expectRevert(AnoraFacility.Overpayment.selector);
        f.repay(1 * USDC);
        vm.stopPrank();
    }

    function test_impossible_repayMoreThanOwed() public {
        _funded();
        vm.startPrank(originator);
        usdc.approve(address(f), 7 * USDC);
        vm.expectRevert(AnoraFacility.Overpayment.selector);
        f.repay(7 * USDC);
        vm.stopPrank();
    }

    function test_impossible_withdrawMoreThanHeld() public {
        _create();
        _deposit(6 * USDC);
        uint256 shares = f.seniorShares(provider);
        vm.prank(provider);
        vm.expectRevert(AnoraFacility.InsufficientShares.selector);
        f.withdraw(AnoraFacility.Tranche.Senior, shares + 1);
    }

    function test_impossible_withdrawLentOutCapital() public {
        _funded();
        uint256 shares = f.seniorShares(provider);
        vm.prank(provider);
        vm.expectRevert(AnoraFacility.InsufficientLiquidity.selector);
        f.withdraw(AnoraFacility.Tranche.Senior, shares);
    }
}
