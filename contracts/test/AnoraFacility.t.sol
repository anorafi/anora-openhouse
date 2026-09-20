// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";
import {AnoraFactory} from "../src/AnoraFactory.sol";
import {AnoraFacility} from "../src/AnoraFacility.sol";

contract AnoraFacilityTest is Test {
    uint256 constant USDC = 1e6;

    TestUSDC usdc;
    AnoraFactory factory;

    address riskAgent = makeAddr("riskAgent");
    address senior1 = makeAddr("senior1");
    address junior1 = makeAddr("junior1");
    address originator = makeAddr("originator");

    function setUp() public {
        usdc = new TestUSDC();
        factory = new AnoraFactory(address(usdc), riskAgent, 1_000);
        usdc.mint(senior1, 1_000_000 * USDC);
        usdc.mint(junior1, 1_000_000 * USDC);
        usdc.mint(originator, 1_000_000 * USDC);
        vm.prank(originator);
        usdc.approve(address(factory), type(uint256).max);
    }

    function _terms(uint256 limit, uint256 firstLoss) internal pure returns (AnoraFacility.Terms memory) {
        return AnoraFacility.Terms({
            limit: limit,
            firstLoss: firstLoss,
            tenor: 90 days,
            grace: 30 days,
            financingFeeBps: 200,
            lateFeePerDayBps: 10,
            seniorPerJuniorBps: 22_500,
            seniorFeeShareBps: 6_000,
            capitalCap: 1_000_000 * USDC
        });
    }

    function _open() internal returns (AnoraFacility f) {
        vm.prank(originator);
        f = AnoraFacility(factory.createFacility("Bandung Tea Export 01", _terms(300_000 * USDC, 30_000 * USDC)));
        for (uint256 i = 0; i < 3; i++) {
            address who = [senior1, junior1, originator][i];
            vm.prank(who);
            usdc.approve(address(f), type(uint256).max);
        }
    }

    function _seeded() internal returns (AnoraFacility f) {
        f = _open();
        vm.prank(junior1);
        f.deposit(AnoraFacility.Tranche.Junior, 120_000 * USDC);
        vm.prank(senior1);
        f.deposit(AnoraFacility.Tranche.Senior, 270_000 * USDC);
    }

    function _drawn() internal returns (AnoraFacility f) {
        f = _seeded();
        vm.prank(originator);
        f.drawdown(200_000 * USDC);
    }

    function _late(uint256 graceDays) internal returns (AnoraFacility f) {
        f = _drawn();
        vm.warp(block.timestamp + 90 days + 1);
        f.markLate();
        vm.warp(block.timestamp + graceDays * 1 days);
    }

    function test_createFacilityStakesFirstLossAndRegisters() public {
        AnoraFacility f = _open();

        assertEq(f.originator(), originator);
        assertEq(f.name(), "Bandung Tea Export 01");
        assertEq(f.firstLossReserve(), 30_000 * USDC);
        assertEq(usdc.balanceOf(address(f)), 30_000 * USDC);
        assertEq(factory.facilityCount(), 1);
        assertEq(factory.facilities(0), address(f));
        assertEq(f.riskAgent(), riskAgent);
    }

    function test_createFacilityRejectsThinFirstLoss() public {
        vm.prank(originator);
        vm.expectRevert(AnoraFactory.FirstLossTooSmall.selector);
        factory.createFacility("thin", _terms(300_000 * USDC, 29_999 * USDC));
    }

    function test_pausedFactoryRejectsNewFacilities() public {
        factory.pause();
        vm.prank(originator);
        vm.expectRevert();
        factory.createFacility("paused", _terms(300_000 * USDC, 30_000 * USDC));
    }

    function test_implementationCannotBeInitialized() public {
        AnoraFacility impl = AnoraFacility(factory.implementation());
        vm.expectRevert();
        impl.initialize(address(usdc), originator, "x", _terms(1, 1));
    }

    function test_seniorClosedUntilJuniorOrFirstLossExists() public {
        AnoraFacility f = _open();
        assertEq(f.seniorCapacity(), 67_500 * USDC);

        vm.prank(senior1);
        vm.expectRevert(AnoraFacility.SeniorCapacityExceeded.selector);
        f.deposit(AnoraFacility.Tranche.Senior, 67_501 * USDC);
    }

    function test_juniorOpensSeniorInProportion() public {
        AnoraFacility f = _open();
        vm.prank(junior1);
        f.deposit(AnoraFacility.Tranche.Junior, 120_000 * USDC);

        assertEq(f.seniorCapacity(), 337_500 * USDC);
        assertEq(f.juniorShares(junior1), 120_000 * USDC);
    }

    function test_capitalCapCountsTranchesAndFirstLoss() public {
        vm.prank(originator);
        AnoraFacility f = AnoraFacility(factory.createFacility("capped", AnoraFacility.Terms({
            limit: 1_000 * USDC,
            firstLoss: 100 * USDC,
            tenor: 90 days,
            grace: 30 days,
            financingFeeBps: 200,
            lateFeePerDayBps: 10,
            seniorPerJuniorBps: 22_500,
            seniorFeeShareBps: 6_000,
            capitalCap: 1_000 * USDC
        })));
        vm.prank(junior1);
        usdc.approve(address(f), type(uint256).max);

        vm.prank(junior1);
        f.deposit(AnoraFacility.Tranche.Junior, 900 * USDC);

        vm.prank(junior1);
        vm.expectRevert(AnoraFacility.CapitalCapExceeded.selector);
        f.deposit(AnoraFacility.Tranche.Junior, 1 * USDC);
    }

    function test_drawdownWithinLimitAndLiquidity() public {
        AnoraFacility f = _drawn();

        assertEq(usdc.balanceOf(originator), 1_000_000 * USDC - 30_000 * USDC + 200_000 * USDC);
        assertEq(f.principal(), 200_000 * USDC);
        assertEq(f.owed(), 204_000 * USDC);
        assertEq(f.dueAt(), block.timestamp + 90 days);
        assertEq(f.liquidity(), 190_000 * USDC);
    }

    function test_drawdownRejectsBeyondLimit() public {
        AnoraFacility f = _seeded();
        vm.prank(originator);
        vm.expectRevert(AnoraFacility.LimitExceeded.selector);
        f.drawdown(300_001 * USDC);
    }

    function test_drawdownRejectsBeyondLiquidity() public {
        AnoraFacility f = _open();
        vm.prank(junior1);
        f.deposit(AnoraFacility.Tranche.Junior, 50_000 * USDC);
        vm.prank(originator);
        vm.expectRevert(AnoraFacility.InsufficientLiquidity.selector);
        f.drawdown(50_001 * USDC);
    }

    function test_drawdownOnlyByOriginator() public {
        AnoraFacility f = _seeded();
        vm.prank(senior1);
        vm.expectRevert(AnoraFacility.NotOriginator.selector);
        f.drawdown(1 * USDC);
    }

    function test_repayPaysPrincipalBeforeFee() public {
        AnoraFacility f = _drawn();
        vm.prank(originator);
        f.repay(100_000 * USDC);

        assertEq(f.principal(), 100_000 * USDC);
        assertEq(f.owed(), 104_000 * USDC);
        assertEq(f.seniorAssets(), 270_000 * USDC);
    }

    function test_fullRepaySplitsFeeAndClosesFacility() public {
        AnoraFacility f = _drawn();
        uint256 before = usdc.balanceOf(originator);

        vm.prank(originator);
        f.repay(204_000 * USDC);

        assertEq(f.owed(), 0);
        assertEq(uint8(f.status()), uint8(AnoraFacility.Status.Closed));
        assertEq(f.seniorAssets(), 272_400 * USDC);
        assertEq(f.juniorAssets(), 121_600 * USDC);
        assertEq(f.firstLossReserve(), 0);
        assertEq(usdc.balanceOf(originator), before - 204_000 * USDC + 30_000 * USDC);
    }

    function test_markLateNeedsPastDue() public {
        AnoraFacility f = _drawn();
        vm.expectRevert(AnoraFacility.NotPastDue.selector);
        f.markLate();
    }

    function test_lateFacilityPausesDrawdownAndAccruesFee() public {
        AnoraFacility f = _drawn();
        vm.warp(block.timestamp + 90 days + 1);
        f.markLate();

        assertEq(uint8(f.status()), uint8(AnoraFacility.Status.Late));
        vm.prank(originator);
        vm.expectRevert(AnoraFacility.FacilityNotOpen.selector);
        f.drawdown(1 * USDC);

        vm.warp(block.timestamp + 10 days);
        assertEq(f.owed(), 206_000 * USDC);
    }

    function test_graceMeasuredFromMarkLateEvenAfterPartialRepay() public {
        AnoraFacility f = _late(0);
        uint256 markedAt = block.timestamp;
        vm.warp(block.timestamp + 20 days);
        vm.prank(originator);
        f.repay(1_000 * USDC);
        assertEq(f.lateSince(), markedAt);
        vm.warp(block.timestamp + 10 days);

        vm.prank(riskAgent);
        f.declareDefault("grace elapsed");
        assertEq(uint8(f.status()), uint8(AnoraFacility.Status.Defaulted));
    }

    function test_defaultOnlyByRiskAgentAfterGrace() public {
        AnoraFacility f = _late(29);

        vm.prank(originator);
        vm.expectRevert(AnoraFacility.NotRiskAgent.selector);
        f.declareDefault("x");

        vm.prank(riskAgent);
        vm.expectRevert(AnoraFacility.GraceNotElapsed.selector);
        f.declareDefault("x");
    }

    function test_defaultConsumesFirstLossThenJuniorThenSenior() public {
        AnoraFacility f = _late(30);

        vm.prank(riskAgent);
        f.declareDefault("buyer insolvent, invoice disputed");

        assertEq(f.defaultReason(), "buyer insolvent, invoice disputed");
        assertEq(f.defaultedAt(), block.timestamp);
        assertEq(f.firstLossReserve(), 0);
        assertEq(f.juniorAssets(), 0);
        assertEq(f.seniorAssets(), 220_000 * USDC);
        (uint256 lf, uint256 lj, uint256 ls) = f.losses();
        assertEq(lf, 30_000 * USDC);
        assertEq(lj, 120_000 * USDC);
        assertEq(ls, 50_000 * USDC);
    }

    function test_recoveryRestoresSeniorThenJuniorThenFirstLoss() public {
        AnoraFacility f = _late(30);
        vm.prank(riskAgent);
        f.declareDefault("buyer insolvent");
        uint256 before = usdc.balanceOf(originator);

        vm.prank(originator);
        f.recordRecovery(60_000 * USDC);
        assertEq(f.seniorAssets(), 270_000 * USDC);
        assertEq(f.juniorAssets(), 10_000 * USDC);

        vm.prank(originator);
        f.recordRecovery(140_000 * USDC);
        assertEq(f.juniorAssets(), 120_000 * USDC);
        assertEq(usdc.balanceOf(originator), before - 200_000 * USDC + 30_000 * USDC);

        vm.prank(originator);
        vm.expectRevert(AnoraFacility.NothingToRecover.selector);
        f.recordRecovery(1 * USDC);
    }

    function test_defaultInOneFacilityLeavesAnotherUntouched() public {
        AnoraFacility a = _late(30);
        vm.prank(originator);
        AnoraFacility b = AnoraFacility(factory.createFacility("Sumatra Coffee", _terms(100_000 * USDC, 10_000 * USDC)));
        vm.prank(junior1);
        usdc.approve(address(b), type(uint256).max);
        vm.prank(junior1);
        b.deposit(AnoraFacility.Tranche.Junior, 40_000 * USDC);

        vm.prank(riskAgent);
        a.declareDefault("buyer insolvent");

        assertEq(b.juniorAssets(), 40_000 * USDC);
        assertEq(b.firstLossReserve(), 10_000 * USDC);
        assertEq(uint8(b.status()), uint8(AnoraFacility.Status.Open));
    }

    function test_withdrawProRataWithinLiquidity() public {
        AnoraFacility f = _seeded();
        vm.prank(originator);
        f.drawdown(300_000 * USDC);

        vm.prank(senior1);
        f.withdraw(AnoraFacility.Tranche.Senior, 90_000 * USDC);
        assertEq(usdc.balanceOf(senior1), 1_000_000 * USDC - 180_000 * USDC);

        vm.prank(senior1);
        vm.expectRevert(AnoraFacility.InsufficientLiquidity.selector);
        f.withdraw(AnoraFacility.Tranche.Senior, 1 * USDC);
    }

    function test_withdrawAfterFeeReturnsMoreThanDeposited() public {
        AnoraFacility f = _drawn();
        vm.prank(originator);
        f.repay(204_000 * USDC);

        vm.prank(senior1);
        f.withdraw(AnoraFacility.Tranche.Senior, 270_000 * USDC);
        assertEq(usdc.balanceOf(senior1), 1_000_000 * USDC + 2_400 * USDC);

        vm.prank(junior1);
        f.withdraw(AnoraFacility.Tranche.Junior, 120_000 * USDC);
        assertEq(usdc.balanceOf(junior1), 1_000_000 * USDC + 1_600 * USDC);
    }

    function test_riskAgentHandoverAtFactory() public {
        address next = makeAddr("nextAgent");
        vm.prank(originator);
        vm.expectRevert();
        factory.setRiskAgent(next);

        factory.setRiskAgent(next);
        AnoraFacility f = _late(30);
        vm.prank(next);
        f.declareDefault("by new agent");
        assertEq(uint8(f.status()), uint8(AnoraFacility.Status.Defaulted));
    }

    function test_evidenceAttachedByOriginator() public {
        AnoraFacility f = _open();
        bytes32 h = keccak256("invoice-2026-0917.pdf");

        vm.prank(senior1);
        vm.expectRevert(AnoraFacility.NotOriginator.selector);
        f.attachEvidence(h);

        vm.prank(originator);
        f.attachEvidence(h);
        assertEq(f.evidenceHash(), h);
    }

    function testFuzz_waterfallConservesCapital(uint256 draw, uint256 recover) public {
        AnoraFacility f = _seeded();
        draw = bound(draw, 1, 300_000 * USDC);
        vm.prank(originator);
        f.drawdown(draw);
        vm.warp(block.timestamp + 90 days + 1);
        f.markLate();
        vm.warp(block.timestamp + 30 days);
        vm.prank(riskAgent);
        f.declareDefault("fuzz");

        (uint256 lf, uint256 lj, uint256 ls) = f.losses();
        assertEq(lf + lj + ls, draw);
        assertEq(f.totalCapital() + lf + lj + ls, 420_000 * USDC);

        uint256 firstLossBefore = lf;
        recover = bound(recover, 0, draw);
        if (recover > 0) {
            vm.prank(originator);
            f.recordRecovery(recover);
        }
        (lf, lj, ls) = f.losses();
        uint256 returnedToOriginator = firstLossBefore - lf;
        assertEq(f.totalCapital() + lf + lj + ls + returnedToOriginator, 420_000 * USDC);
    }
}
