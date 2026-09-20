// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TestUSDC} from "../test/utils/TestUSDC.sol";
import {AnoraFactory} from "../src/AnoraFactory.sol";

contract Deploy is Script {
    function run() external {
        address riskAgent = vm.envOr("RISK_AGENT", msg.sender);
        address asset = vm.envOr("POOL_ASSET", address(0));
        uint256 minFirstLossBps = vm.envOr("MIN_FIRST_LOSS_BPS", uint256(1_000));
        vm.startBroadcast();
        if (asset == address(0)) asset = address(new TestUSDC());
        AnoraFactory factory = new AnoraFactory(asset, riskAgent, minFirstLossBps);
        vm.stopBroadcast();
        console.log("asset", asset);
        console.log("AnoraFactory", address(factory));
        console.log("AnoraFacility implementation", factory.implementation());
        console.log("riskAgent", riskAgent);
    }
}
