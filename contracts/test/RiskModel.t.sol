// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";
import {AnoraFactory} from "../src/AnoraFactory.sol";
import {AnoraFacility} from "../src/AnoraFacility.sol";

contract RiskModelTest is Test {
    uint256 constant USDC = 1e6;
    uint256 constant LIMIT = 300_000 * USDC;
    uint256 constant FIRST_LOSS = 30_000 * USDC;

    TestUSDC usdc;
    AnoraFactory factory;

    address riskAgent = makeAddr("riskAgent");
    address senior1 = makeAddr("senior1");
    address senior2 = makeAddr("senior2");
    address junior1 = makeAddr("junior1");
    address junior2 = makeAddr("junior2");
    address originator = makeAddr("originator");

    function setUp() public {
        usdc = new TestUSDC();
        factory = new AnoraFactory(address(usdc), riskAgent, 1_000);
        address[5] memory everyone = [senior1, senior2, junior1, junior2, originator];
        for (uint256 i = 0; i < everyone.length; i++) {
            usdc.mint(everyone[i], 10_000_000 * USDC);
        }
        factory.setOriginatorApproved(originator, true);
        vm.prank(originator);
        usdc.approve(address(factory), type(uint256).max);
    }

    function _terms(uint256 ratioBps) internal pure returns (AnoraFacility.Terms memory) {
        return AnoraFacility.Terms({
            limit: LIMIT,
            firstLoss: FIRST_LOSS,
            tenor: 90 days,
            grace: 30 days,
            financingFeeBps: 200,
            lateFeePerDayBps: 10,
            seniorPerJuniorBps: ratioBps,
            seniorFeeShareBps: 6_000,
            capitalCap: 1_000_000 * USDC
        });
    }

    function _approveAll(AnoraFacility f) internal {
        address[5] memory everyone = [senior1, senior2, junior1, junior2, originator];
        for (uint256 i = 0; i < everyone.length; i++) {
            vm.prank(everyone[i]);
            usdc.approve(address(f), type(uint256).max);
        }
    }

    function _open(uint256 ratioBps) internal returns (AnoraFacility f) {
        vm.prank(originator);
        f = AnoraFacility(factory.createFacility("Risk model facility", _terms(ratioBps)));
        _approveAll(f);
    }

    function _deposit(AnoraFacility f, address who, AnoraFacility.Tranche tranche, uint256 amount) internal {
        vm.prank(who);
        f.deposit(tranche, amount);
    }

    function _withdraw(AnoraFacility f, address who, AnoraFacility.Tranche tranche, uint256 shares) internal returns (uint256 amount) {
        vm.prank(who);
        amount = f.withdraw(tranche, shares);
    }

    function _exit(AnoraFacility f, address who, AnoraFacility.Tranche tranche) internal {
        uint256 shares = tranche == AnoraFacility.Tranche.Senior ? f.seniorShares(who) : f.juniorShares(who);
        if (shares > 0) _withdraw(f, who, tranche, shares);
    }

    function _repayAll(AnoraFacility f) internal {
        uint256 owed = f.owed();
        vm.prank(originator);
        f.repay(owed);
    }

    function test_juniorWithdrawRevertsWhenItBreaksSeniorProtection() public {
        AnoraFacility f = _open(22_500);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, 120_000 * USDC);
        _deposit(f, senior1, AnoraFacility.Tranche.Senior, 270_000 * USDC);
        uint256 shares = f.juniorShares(junior1);
        vm.prank(junior1);
        vm.expectRevert(AnoraFacility.JuniorProtectionBreached.selector);
        f.withdraw(AnoraFacility.Tranche.Junior, shares / 2);
    }

    function test_juniorWithdrawIsAllowedWhileSeniorStaysProtected() public {
        AnoraFacility f = _open(22_500);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, 120_000 * USDC);
        _deposit(f, senior1, AnoraFacility.Tranche.Senior, 100_000 * USDC);
        uint256 shares = f.juniorShares(junior1);
        vm.prank(junior1);
        uint256 amount = f.withdraw(AnoraFacility.Tranche.Junior, shares / 2);
        assertEq(amount, 60_000 * USDC);
        assertLe(f.seniorAssets(), (f.juniorAssets() + f.firstLossReserve()) * 22_500 / 10_000);
    }

    function test_juniorWithdrawAtTheExactProtectionBoundaryIsAllowed() public {
        AnoraFacility f = _open(10_000);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, 50_000 * USDC);
        _deposit(f, senior1, AnoraFacility.Tranche.Senior, 60_000 * USDC);
        uint256 twoFifths = f.juniorShares(junior1) * 20_000 / 50_000;
        _withdraw(f, junior1, AnoraFacility.Tranche.Junior, twoFifths);
        assertEq(f.juniorAssets(), 30_000 * USDC);
        assertEq(f.seniorAssets(), 60_000 * USDC);
        vm.prank(junior1);
        vm.expectRevert(AnoraFacility.JuniorProtectionBreached.selector);
        f.withdraw(AnoraFacility.Tranche.Junior, 1);
    }

    function test_juniorExitsFreelyAfterSeniorLeaves() public {
        AnoraFacility f = _open(22_500);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, 120_000 * USDC);
        _deposit(f, senior1, AnoraFacility.Tranche.Senior, 270_000 * USDC);
        _exit(f, senior1, AnoraFacility.Tranche.Senior);
        _exit(f, junior1, AnoraFacility.Tranche.Junior);
        assertEq(f.juniorAssets(), 0);
    }

    function test_juniorOnlyFacilityIsNeverBlocked() public {
        AnoraFacility f = _open(22_500);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, 120_000 * USDC);
        _exit(f, junior1, AnoraFacility.Tranche.Junior);
        assertEq(f.juniorAssets(), 0);
    }

    function test_juniorExitsFreelyAfterFullRepaymentClosesTheFacility() public {
        AnoraFacility f = _open(22_500);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, 120_000 * USDC);
        _deposit(f, senior1, AnoraFacility.Tranche.Senior, 270_000 * USDC);
        vm.prank(originator);
        f.drawdown(200_000 * USDC);
        _repayAll(f);
        assertEq(uint256(f.status()), uint256(AnoraFacility.Status.Closed));
        _exit(f, junior1, AnoraFacility.Tranche.Junior);
        _exit(f, senior1, AnoraFacility.Tranche.Senior);
        assertEq(usdc.balanceOf(address(f)), 0);
    }

    function test_juniorExitsFreelyAfterDefault() public {
        AnoraFacility f = _open(22_500);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, 120_000 * USDC);
        _deposit(f, senior1, AnoraFacility.Tranche.Senior, 270_000 * USDC);
        vm.prank(originator);
        f.drawdown(100_000 * USDC);
        vm.warp(block.timestamp + 90 days + 1);
        f.markLate();
        vm.warp(block.timestamp + 31 days);
        vm.prank(riskAgent);
        f.declareDefault("buyer stopped paying");
        uint256 shares = f.juniorShares(junior1);
        vm.prank(junior1);
        f.withdraw(AnoraFacility.Tranche.Junior, shares);
        assertEq(f.juniorShares(junior1), 0);
    }

    function test_seniorDepositAboveTheFacilityRatioReverts() public {
        AnoraFacility f = _open(10_000);
        assertEq(f.seniorCapacity(), FIRST_LOSS);
        vm.prank(senior1);
        vm.expectRevert(AnoraFacility.SeniorCapacityExceeded.selector);
        f.deposit(AnoraFacility.Tranche.Senior, FIRST_LOSS + 1);
        _deposit(f, senior1, AnoraFacility.Tranche.Senior, FIRST_LOSS);
        assertEq(f.seniorCapacity(), 0);
    }

    function test_seniorCapacityFollowsEachFacilitysOwnRatio() public {
        AnoraFacility tight = _open(15_000);
        AnoraFacility loose = _open(30_000);
        assertEq(tight.seniorCapacity(), 45_000 * USDC);
        assertEq(loose.seniorCapacity(), 90_000 * USDC);
        _deposit(tight, junior1, AnoraFacility.Tranche.Junior, 10_000 * USDC);
        assertEq(tight.seniorCapacity(), 60_000 * USDC);
        assertEq(loose.seniorCapacity(), 90_000 * USDC);
    }

    function test_modelIsRecordedAtCreationAndEmitted() public {
        bytes32 snapshot = keccak256("snapshot v7");
        vm.prank(originator);
        vm.expectEmit(false, false, false, true, address(factory));
        emit AnoraFactory.TermsFrozen(address(0), 7, snapshot, 22_500, 1_000_000 * USDC);
        AnoraFacility f = AnoraFacility(factory.createFacilityWithModel("Modelled", _terms(22_500), 7, snapshot));
        assertEq(f.modelVersion(), 7);
        assertEq(f.snapshotHash(), snapshot);
        assertEq(factory.facilities(factory.facilityCount() - 1), address(f));
    }

    function test_modelStaysFrozenThroughDepositsAndWithdrawals() public {
        bytes32 snapshot = keccak256("snapshot v7");
        vm.prank(originator);
        AnoraFacility f = AnoraFacility(factory.createFacilityWithModel("Modelled", _terms(22_500), 7, snapshot));
        _approveAll(f);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, 50_000 * USDC);
        _deposit(f, senior1, AnoraFacility.Tranche.Senior, 100_000 * USDC);
        uint256 half = f.seniorShares(senior1) / 2;
        _withdraw(f, senior1, AnoraFacility.Tranche.Senior, half);
        (,,,,, , uint256 ratio,, uint256 cap) = f.terms();
        assertEq(ratio, 22_500);
        assertEq(cap, 1_000_000 * USDC);
        assertEq(f.modelVersion(), 7);
        assertEq(f.snapshotHash(), snapshot);
    }

    function test_legacyCreationCarriesNoModel() public {
        AnoraFacility f = _open(22_500);
        assertEq(f.modelVersion(), 0);
        assertEq(f.snapshotHash(), bytes32(0));
    }

    function test_factoryRejectsAModelWithoutAHash() public {
        vm.prank(originator);
        vm.expectRevert(AnoraFactory.InvalidTerms.selector);
        factory.createFacilityWithModel("No hash", _terms(22_500), 7, bytes32(0));
    }

    function test_factoryRejectsAModelWithoutAVersion() public {
        vm.prank(originator);
        vm.expectRevert(AnoraFactory.InvalidTerms.selector);
        factory.createFacilityWithModel("No version", _terms(22_500), 0, keccak256("snapshot"));
    }

    function test_factoryRejectsARatioAboveTheProtocolMaximum() public {
        uint256 above = factory.MAX_SENIOR_PER_JUNIOR_BPS() + 1;
        vm.prank(originator);
        vm.expectRevert(AnoraFactory.InvalidTerms.selector);
        factory.createFacility("Too levered", _terms(above));
    }

    function test_factoryAcceptsARatioAtTheProtocolMaximum() public {
        uint256 maximum = factory.MAX_SENIOR_PER_JUNIOR_BPS();
        vm.prank(originator);
        address facility = factory.createFacility("Max levered", _terms(maximum));
        assertTrue(facility != address(0));
    }

    function test_factoryAcceptsARatioOfZeroAsNoSeniorCapacity() public {
        AnoraFacility f = _open(0);
        assertEq(f.seniorCapacity(), 0);
        vm.prank(senior1);
        vm.expectRevert(AnoraFacility.SeniorCapacityExceeded.selector);
        f.deposit(AnoraFacility.Tranche.Senior, 1);
    }

    function testFuzz_everyHolderCanExitAfterFullRepayment(
        uint256 juniorAmount,
        uint256 seniorAmount,
        bool juniorFirst,
        uint256 drawAmount
    ) public {
        AnoraFacility f = _open(22_500);
        juniorAmount = bound(juniorAmount, 0, 150_000 * USDC);
        if (juniorFirst && juniorAmount > 0) _deposit(f, junior1, AnoraFacility.Tranche.Junior, juniorAmount);
        seniorAmount = bound(seniorAmount, 0, f.seniorCapacity());
        if (seniorAmount > 0) _deposit(f, senior1, AnoraFacility.Tranche.Senior, seniorAmount);
        if (!juniorFirst && juniorAmount > 0) _deposit(f, junior1, AnoraFacility.Tranche.Junior, juniorAmount);
        uint256 funded = f.seniorAssets() + f.juniorAssets();
        vm.assume(funded > 0);
        drawAmount = bound(drawAmount, 1, funded < LIMIT ? funded : LIMIT);
        vm.prank(originator);
        f.drawdown(drawAmount);
        _repayAll(f);
        assertEq(uint256(f.status()), uint256(AnoraFacility.Status.Closed));
        _exit(f, senior1, AnoraFacility.Tranche.Senior);
        _exit(f, junior1, AnoraFacility.Tranche.Junior);
        assertEq(usdc.balanceOf(address(f)), 0);
    }

    function testFuzz_juniorWithdrawOnlyRevertsWhenSeniorWouldLoseProtection(uint256 juniorAmount, uint256 seniorAmount, uint256 takeBps)
        public
    {
        AnoraFacility f = _open(22_500);
        juniorAmount = bound(juniorAmount, 1_000 * USDC, 150_000 * USDC);
        _deposit(f, junior1, AnoraFacility.Tranche.Junior, juniorAmount);
        seniorAmount = bound(seniorAmount, 0, f.seniorCapacity());
        if (seniorAmount > 0) _deposit(f, senior1, AnoraFacility.Tranche.Senior, seniorAmount);
        takeBps = bound(takeBps, 1, 10_000);
        uint256 shares = f.juniorShares(junior1) * takeBps / 10_000;
        vm.assume(shares > 0);
        uint256 amount = shares * f.juniorAssets() / f.juniorTotalShares();
        uint256 protection = (f.juniorAssets() - amount + f.firstLossReserve()) * 22_500 / 10_000;
        bool breaches = f.seniorAssets() > 0 && f.seniorAssets() > protection;
        vm.prank(junior1);
        if (breaches) vm.expectRevert(AnoraFacility.JuniorProtectionBreached.selector);
        f.withdraw(AnoraFacility.Tranche.Junior, shares);
        if (!breaches) assertEq(f.juniorShares(junior1), f.juniorTotalShares());
    }
}
