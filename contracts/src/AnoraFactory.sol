// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AnoraFacility} from "./AnoraFacility.sol";

/// @title AnoraFactory
/// @notice Opens isolated facilities as minimal clones and holds the protocol-level roles and floor rules.
contract AnoraFactory is Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    error FirstLossTooSmall();
    error ZeroAddress();

    uint256 public constant BPS = 10_000;

    address public immutable implementation;
    IERC20 public immutable asset;
    address public riskAgent;
    uint256 public minFirstLossBps;
    address[] public facilities;

    event FacilityCreated(
        address indexed facility, address indexed originator, string name, uint256 limit, uint256 firstLoss
    );
    event RiskAgentChanged(address indexed previous, address indexed next);
    event MinFirstLossChanged(uint256 previousBps, uint256 nextBps);

    constructor(address asset_, address riskAgent_, uint256 minFirstLossBps_) Ownable(msg.sender) {
        if (asset_ == address(0) || riskAgent_ == address(0)) revert ZeroAddress();
        implementation = address(new AnoraFacility());
        asset = IERC20(asset_);
        riskAgent = riskAgent_;
        minFirstLossBps = minFirstLossBps_;
    }

    function facilityCount() external view returns (uint256) {
        return facilities.length;
    }

    function allFacilities() external view returns (address[] memory) {
        return facilities;
    }

    /// @notice Originator opens a facility and stakes its first-loss capital in the same transaction.
    function createFacility(string calldata name, AnoraFacility.Terms calldata terms)
        external
        whenNotPaused
        returns (address facility)
    {
        if (terms.firstLoss < terms.limit * minFirstLossBps / BPS) revert FirstLossTooSmall();
        facility = Clones.clone(implementation);
        facilities.push(facility);
        emit FacilityCreated(facility, msg.sender, name, terms.limit, terms.firstLoss);
        asset.safeTransferFrom(msg.sender, facility, terms.firstLoss);
        AnoraFacility(facility).initialize(address(asset), msg.sender, name, terms);
    }

    function setRiskAgent(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit RiskAgentChanged(riskAgent, next);
        riskAgent = next;
    }

    function setMinFirstLossBps(uint256 nextBps) external onlyOwner {
        emit MinFirstLossChanged(minFirstLossBps, nextBps);
        minFirstLossBps = nextBps;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
