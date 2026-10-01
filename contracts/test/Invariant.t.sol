// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";
import {AnoraFactory} from "../src/AnoraFactory.sol";
import {AnoraFacility} from "../src/AnoraFacility.sol";

contract RiskHandler is Test {
    uint256 constant USDC = 1e6;
    uint256 constant BPS = 10_000;

    AnoraFacility public facility;
    TestUSDC public usdc;
    address public originator;
    address public riskAgent;
    address[] public actors;

    bool public wrongRejection;
    uint256 public justifiedRejections;
    uint256 public exits;
    uint256 public steps;

    constructor(AnoraFacility facility_, TestUSDC usdc_, address originator_, address riskAgent_, address[] memory actors_) {
        facility = facility_;
        usdc = usdc_;
        originator = originator_;
        riskAgent = riskAgent_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function seniorDeposit(uint256 seed, uint256 amount) external {
        steps++;
        amount = bound(amount, 0, facility.seniorCapacity());
        if (amount == 0) return;
        vm.prank(_actor(seed));
        try facility.deposit(AnoraFacility.Tranche.Senior, amount) {} catch {}
    }

    function juniorDeposit(uint256 seed, uint256 amount) external {
        steps++;
        amount = bound(amount, 0, 200_000 * USDC);
        if (amount == 0) return;
        vm.prank(_actor(seed));
        try facility.deposit(AnoraFacility.Tranche.Junior, amount) {} catch {}
    }

    function seniorWithdraw(uint256 seed, uint256 bps) external {
        steps++;
        address who = _actor(seed);
        uint256 shares = facility.seniorShares(who) * bound(bps, 0, BPS) / BPS;
        if (shares == 0) return;
        vm.prank(who);
        try facility.withdraw(AnoraFacility.Tranche.Senior, shares) {
            exits++;
        } catch {}
    }

    function juniorWithdraw(uint256 seed, uint256 bps) external {
        steps++;
        address who = _actor(seed);
        uint256 shares = facility.juniorShares(who) * bound(bps, 0, BPS) / BPS;
        if (shares == 0) return;
        uint256 amount = shares * facility.juniorAssets() / facility.juniorTotalShares();
        (,,,,,, uint256 ratio,,) = facility.terms();
        AnoraFacility.Status status = facility.status();
        bool exposed = status == AnoraFacility.Status.Open || status == AnoraFacility.Status.Late;
        uint256 protection = (facility.juniorAssets() - amount + facility.firstLossReserve()) * ratio / BPS;
        bool breaches = exposed && facility.seniorAssets() > 0 && facility.seniorAssets() > protection;
        vm.prank(who);
        try facility.withdraw(AnoraFacility.Tranche.Junior, shares) {
            exits++;
            if (breaches) wrongRejection = true;
        } catch (bytes memory reason) {
            bytes4 selector = bytes4(reason);
            if (selector == AnoraFacility.JuniorProtectionBreached.selector) {
                if (breaches) justifiedRejections++;
                else wrongRejection = true;
            } else if (selector != AnoraFacility.InsufficientLiquidity.selector) {
                wrongRejection = true;
            }
        }
    }

    function draw(uint256 amount) external {
        steps++;
        (uint256 limit,,,,,,,,) = facility.terms();
        uint256 headroom = limit > facility.principal() ? limit - facility.principal() : 0;
        uint256 liquidity = facility.liquidity();
        amount = bound(amount, 0, liquidity < headroom ? liquidity : headroom);
        if (amount == 0) return;
        vm.prank(originator);
        try facility.drawdown(amount) {} catch {}
    }

    function repay(uint256 bps) external {
        steps++;
        uint256 owed = facility.principal() + facility.fee();
        uint256 amount = owed * bound(bps, 0, BPS) / BPS;
        if (amount == 0) return;
        usdc.mint(originator, amount);
        vm.prank(originator);
        try facility.repay(amount) {} catch {}
    }

    function warp(uint256 secondsForward) external {
        steps++;
        vm.warp(block.timestamp + bound(secondsForward, 0, 60 days));
    }

    function markLate() external {
        steps++;
        try facility.markLate() {} catch {}
    }

    function declareDefault() external {
        steps++;
        vm.prank(riskAgent);
        try facility.declareDefault("invariant run") {} catch {}
    }

    function recover(uint256 bps) external {
        steps++;
        (uint256 lossFirst, uint256 lossJunior, uint256 lossSenior) = facility.losses();
        uint256 outstanding = lossFirst + lossJunior + lossSenior;
        uint256 amount = outstanding * bound(bps, 0, BPS) / BPS;
        if (amount == 0) return;
        usdc.mint(originator, amount);
        vm.prank(originator);
        try facility.recordRecovery(amount) {} catch {}
    }
}

contract RiskInvariantTest is StdInvariant, Test {
    uint256 constant USDC = 1e6;
    uint256 constant BPS = 10_000;

    TestUSDC usdc;
    AnoraFactory factory;
    AnoraFacility facility;
    RiskHandler handler;

    address riskAgent = makeAddr("riskAgent");
    address originator = makeAddr("originator");

    function setUp() public {
        usdc = new TestUSDC();
        factory = new AnoraFactory(address(usdc), riskAgent, 1_000);
        factory.setOriginatorApproved(originator, true);
        usdc.mint(originator, 100_000_000 * USDC);
        vm.prank(originator);
        usdc.approve(address(factory), type(uint256).max);
        vm.prank(originator);
        facility = AnoraFacility(
            factory.createFacility(
                "Invariant facility",
                AnoraFacility.Terms({
                    limit: 500_000 * USDC,
                    firstLoss: 50_000 * USDC,
                    tenor: 30 days,
                    grace: 10 days,
                    financingFeeBps: 300,
                    lateFeePerDayBps: 10,
                    seniorPerJuniorBps: 20_000,
                    seniorFeeShareBps: 6_000,
                    capitalCap: 900_000 * USDC
                })
            )
        );
        address[] memory actors = new address[](4);
        for (uint256 i = 0; i < actors.length; i++) {
            actors[i] = makeAddr(string.concat("actor", vm.toString(i)));
            usdc.mint(actors[i], 100_000_000 * USDC);
            vm.prank(actors[i]);
            usdc.approve(address(facility), type(uint256).max);
        }
        vm.prank(originator);
        usdc.approve(address(facility), type(uint256).max);
        handler = new RiskHandler(facility, usdc, originator, riskAgent, actors);
        targetContract(address(handler));
    }

    function invariant_seniorStaysProtectedWhileCapitalIsExposed() public view {
        AnoraFacility.Status status = facility.status();
        if (status != AnoraFacility.Status.Open && status != AnoraFacility.Status.Late) return;
        if (facility.principal() == 0) return;
        (,,,,,, uint256 ratio,,) = facility.terms();
        assertLe(facility.seniorAssets(), (facility.juniorAssets() + facility.firstLossReserve()) * ratio / BPS);
    }

    function invariant_assetBalanceMatchesTheLedger() public view {
        uint256 ledger = facility.seniorAssets() + facility.juniorAssets() + facility.firstLossReserve();
        assertEq(usdc.balanceOf(address(facility)) + facility.principal(), ledger);
    }

    function invariant_noSafeJuniorWithdrawalIsEverRejectedAndNoUnsafeOneAccepted() public view {
        assertFalse(handler.wrongRejection());
    }
}
