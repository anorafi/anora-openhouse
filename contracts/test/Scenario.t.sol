// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";
import {AnoraFactory} from "../src/AnoraFactory.sol";
import {AnoraFacility} from "../src/AnoraFacility.sol";

contract ScenarioTest is Test {
    uint256 constant USDC = 1e6;

    TestUSDC usdc;
    AnoraFactory factory;

    address riskAgent = makeAddr("riskAgent");
    address seniorLender = makeAddr("seniorLender");
    address juniorLender = makeAddr("juniorLender");
    address originator = makeAddr("originator");

    function setUp() public {
        usdc = new TestUSDC();
        factory = new AnoraFactory(address(usdc), riskAgent, 1_000);
        address[3] memory who = [seniorLender, juniorLender, originator];
        for (uint256 i = 0; i < who.length; i++) {
            usdc.mint(who[i], 500_000 * USDC);
            vm.prank(who[i]);
            usdc.approve(address(factory), type(uint256).max);
        }
    }

    function test_isolatedFacilityLifecycleFromOpenToRecovery() public {
        vm.prank(originator);
        AnoraFacility f = AnoraFacility(factory.createFacility("Bandung Tea Export 01", AnoraFacility.Terms({
            limit: 300_000 * USDC,
            firstLoss: 30_000 * USDC,
            tenor: 90 days,
            grace: 30 days,
            financingFeeBps: 200,
            lateFeePerDayBps: 10,
            seniorPerJuniorBps: 22_500,
            seniorFeeShareBps: 6_000,
            capitalCap: 1_000_000 * USDC
        })));
        address[3] memory who = [seniorLender, juniorLender, originator];
        for (uint256 i = 0; i < who.length; i++) {
            vm.prank(who[i]);
            usdc.approve(address(f), type(uint256).max);
        }
        assertEq(f.firstLossReserve(), 30_000 * USDC);

        vm.prank(juniorLender);
        f.deposit(AnoraFacility.Tranche.Junior, 90_000 * USDC);
        assertEq(f.seniorCapacity(), 270_000 * USDC);
        vm.prank(seniorLender);
        f.deposit(AnoraFacility.Tranche.Senior, 270_000 * USDC);

        vm.prank(originator);
        f.attachEvidence(keccak256("e-SRG 2026/09/0042"));

        vm.prank(originator);
        f.drawdown(300_000 * USDC);
        assertEq(f.liquidity(), 60_000 * USDC);
        assertEq(f.owed(), 306_000 * USDC);

        vm.warp(block.timestamp + 91 days);
        f.markLate();
        vm.prank(originator);
        vm.expectRevert(AnoraFacility.FacilityNotOpen.selector);
        f.drawdown(1 * USDC);

        vm.warp(block.timestamp + 30 days);
        assertEq(f.owed(), 315_000 * USDC);

        vm.prank(riskAgent);
        f.declareDefault("buyer failed to pay; restructuring refused");
        (uint256 lf, uint256 lj, uint256 ls) = f.losses();
        assertEq(lf, 30_000 * USDC);
        assertEq(lj, 90_000 * USDC);
        assertEq(ls, 180_000 * USDC);

        vm.prank(originator);
        f.recordRecovery(200_000 * USDC);
        assertEq(f.seniorAssets(), 270_000 * USDC);
        assertEq(f.juniorAssets(), 20_000 * USDC);

        vm.prank(seniorLender);
        f.withdraw(AnoraFacility.Tranche.Senior, 270_000 * USDC);
        assertEq(usdc.balanceOf(seniorLender), 500_000 * USDC);
        vm.prank(juniorLender);
        f.withdraw(AnoraFacility.Tranche.Junior, 90_000 * USDC);
        assertEq(usdc.balanceOf(juniorLender), 430_000 * USDC);
    }
}
