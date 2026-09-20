// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRiskAgentSource {
    function riskAgent() external view returns (address);
}

/// @title AnoraFacility
/// @notice One isolated credit facility: its own Senior/Junior capital, first-loss stake, and default waterfall.
contract AnoraFacility is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Tranche {
        Senior,
        Junior
    }

    enum Status {
        Open,
        Late,
        Defaulted,
        Closed
    }

    struct Terms {
        uint256 limit;
        uint256 firstLoss;
        uint256 tenor;
        uint256 grace;
        uint256 financingFeeBps;
        uint256 lateFeePerDayBps;
        uint256 seniorPerJuniorBps;
        uint256 seniorFeeShareBps;
        uint256 capitalCap;
    }

    error SeniorCapacityExceeded();
    error CapitalCapExceeded();
    error LimitExceeded();
    error InsufficientLiquidity();
    error InsufficientShares();
    error NotOriginator();
    error NotRiskAgent();
    error FacilityNotOpen();
    error FacilityNotLate();
    error NotPastDue();
    error GraceNotElapsed();
    error Overpayment();
    error NothingToRecover();

    uint256 public constant BPS = 10_000;

    address public factory;
    IERC20 public asset;
    address public originator;
    string public name;
    Terms public terms;

    uint256 public seniorAssets;
    uint256 public juniorAssets;
    uint256 public seniorTotalShares;
    uint256 public juniorTotalShares;
    mapping(address => uint256) public seniorShares;
    mapping(address => uint256) public juniorShares;

    uint256 public firstLossReserve;
    uint256 public principal;
    uint256 public fee;
    uint256 public dueAt;
    uint256 public lateSince;
    uint256 public lateAccruedAt;
    Status public status;
    uint256 public defaultedAt;
    string public defaultReason;
    uint256 public lossFirstLoss;
    uint256 public lossJunior;
    uint256 public lossSenior;
    bytes32 public evidenceHash;

    event Deposited(address indexed provider, Tranche tranche, uint256 assets, uint256 shares);
    event Withdrawn(address indexed provider, Tranche tranche, uint256 assets, uint256 shares);
    event Drawn(uint256 amount, uint256 fee, uint256 dueAt);
    event Repaid(uint256 principal, uint256 fee);
    event MarkedLate(uint256 dueAt, uint256 at);
    event DefaultDeclared(string reason, uint256 lossFirstLoss, uint256 lossJunior, uint256 lossSenior);
    event Recovered(uint256 amount, uint256 toSenior, uint256 toJunior, uint256 toOriginator);
    event FacilityClosed();
    event EvidenceAttached(bytes32 indexed hash, address indexed by);

    constructor() {
        _disableInitializers();
    }

    /// @notice Called once by the factory after it has moved the first-loss stake into this contract.
    function initialize(address asset_, address originator_, string calldata name_, Terms calldata terms_)
        external
        initializer
    {
        factory = msg.sender;
        asset = IERC20(asset_);
        originator = originator_;
        name = name_;
        terms = terms_;
        firstLossReserve = terms_.firstLoss;
    }

    function riskAgent() public view returns (address) {
        return IRiskAgentSource(factory).riskAgent();
    }

    function totalCapital() public view returns (uint256) {
        return seniorAssets + juniorAssets + firstLossReserve;
    }

    function liquidity() public view returns (uint256) {
        uint256 balance = asset.balanceOf(address(this));
        return balance > firstLossReserve ? balance - firstLossReserve : 0;
    }

    function seniorCapacity() public view returns (uint256) {
        uint256 cap = (juniorAssets + firstLossReserve) * terms.seniorPerJuniorBps / BPS;
        return cap > seniorAssets ? cap - seniorAssets : 0;
    }

    function owed() public view returns (uint256) {
        return principal + fee + _pendingLateFee();
    }

    function losses() external view returns (uint256, uint256, uint256) {
        return (lossFirstLoss, lossJunior, lossSenior);
    }

    /// @notice Supply capital to a tranche. Senior only opens in proportion to Junior plus the first-loss stake.
    function deposit(Tranche tranche, uint256 amount) external nonReentrant returns (uint256 shares) {
        if (totalCapital() + amount > terms.capitalCap) revert CapitalCapExceeded();
        if (tranche == Tranche.Senior) {
            if (amount > seniorCapacity()) revert SeniorCapacityExceeded();
            shares = _toShares(amount, seniorAssets, seniorTotalShares);
            seniorAssets += amount;
            seniorTotalShares += shares;
            seniorShares[msg.sender] += shares;
        } else {
            shares = _toShares(amount, juniorAssets, juniorTotalShares);
            juniorAssets += amount;
            juniorTotalShares += shares;
            juniorShares[msg.sender] += shares;
        }
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, tranche, amount, shares);
    }

    /// @notice Redeem tranche shares pro rata, limited by the liquidity not lent out.
    function withdraw(Tranche tranche, uint256 shares) external nonReentrant returns (uint256 amount) {
        if (tranche == Tranche.Senior) {
            if (shares > seniorShares[msg.sender]) revert InsufficientShares();
            amount = shares * seniorAssets / seniorTotalShares;
            seniorShares[msg.sender] -= shares;
            seniorTotalShares -= shares;
            seniorAssets -= amount;
        } else {
            if (shares > juniorShares[msg.sender]) revert InsufficientShares();
            amount = shares * juniorAssets / juniorTotalShares;
            juniorShares[msg.sender] -= shares;
            juniorTotalShares -= shares;
            juniorAssets -= amount;
        }
        if (amount > liquidity()) revert InsufficientLiquidity();
        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, tranche, amount, shares);
    }

    /// @notice Originator draws liquidity up to the limit. The financing fee is booked at drawdown.
    function drawdown(uint256 amount) external nonReentrant {
        if (msg.sender != originator) revert NotOriginator();
        if (status != Status.Open) revert FacilityNotOpen();
        if (principal + amount > terms.limit) revert LimitExceeded();
        if (amount > liquidity()) revert InsufficientLiquidity();
        uint256 drawFee = amount * terms.financingFeeBps / BPS;
        if (dueAt == 0) dueAt = block.timestamp + terms.tenor;
        principal += amount;
        fee += drawFee;
        asset.safeTransfer(msg.sender, amount);
        emit Drawn(amount, drawFee, dueAt);
    }

    /// @notice Repay principal first, then fees. Fees are split between the tranches. Full repayment closes the facility.
    function repay(uint256 amount) external nonReentrant {
        _accrueLateFee();
        if (amount > principal + fee) revert Overpayment();
        uint256 toPrincipal = amount < principal ? amount : principal;
        uint256 toFee = amount - toPrincipal;
        principal -= toPrincipal;
        fee -= toFee;
        asset.safeTransferFrom(msg.sender, address(this), amount);
        _distributeFee(toFee);
        emit Repaid(toPrincipal, toFee);
        if (principal == 0 && fee == 0 && dueAt != 0) _close();
    }

    /// @notice Anyone may flag the facility once the due date has passed. Drawdown stops and late fees start.
    function markLate() external {
        if (status != Status.Open) revert FacilityNotOpen();
        if (principal == 0 || block.timestamp <= dueAt) revert NotPastDue();
        status = Status.Late;
        lateSince = block.timestamp;
        lateAccruedAt = block.timestamp;
        emit MarkedLate(dueAt, block.timestamp);
    }

    /// @notice Risk agent declares default after the grace period, recording the reason onchain.
    ///         Losses hit the first-loss stake, then Junior, then Senior.
    function declareDefault(string calldata reason) external {
        if (msg.sender != riskAgent()) revert NotRiskAgent();
        if (status != Status.Late) revert FacilityNotLate();
        if (block.timestamp < lateSince + terms.grace) revert GraceNotElapsed();
        uint256 loss = principal;
        principal = 0;
        fee = 0;
        status = Status.Defaulted;
        defaultedAt = block.timestamp;
        defaultReason = reason;

        uint256 fromFirst = loss < firstLossReserve ? loss : firstLossReserve;
        firstLossReserve -= fromFirst;
        loss -= fromFirst;

        uint256 fromJunior = loss < juniorAssets ? loss : juniorAssets;
        juniorAssets -= fromJunior;
        loss -= fromJunior;

        uint256 fromSenior = loss < seniorAssets ? loss : seniorAssets;
        seniorAssets -= fromSenior;

        lossFirstLoss = fromFirst;
        lossJunior = fromJunior;
        lossSenior = fromSenior;
        emit DefaultDeclared(reason, fromFirst, fromJunior, fromSenior);
    }

    /// @notice Recovered funds flow back Senior first, then Junior, then the first-loss stake to the originator.
    function recordRecovery(uint256 amount) external nonReentrant {
        if (status != Status.Defaulted) revert NothingToRecover();
        uint256 outstanding = lossSenior + lossJunior + lossFirstLoss;
        if (outstanding == 0 || amount > outstanding) revert NothingToRecover();
        asset.safeTransferFrom(msg.sender, address(this), amount);

        uint256 toSenior = amount < lossSenior ? amount : lossSenior;
        lossSenior -= toSenior;
        seniorAssets += toSenior;
        uint256 rest = amount - toSenior;

        uint256 toJunior = rest < lossJunior ? rest : lossJunior;
        lossJunior -= toJunior;
        juniorAssets += toJunior;
        rest -= toJunior;

        lossFirstLoss -= rest;
        if (rest > 0) asset.safeTransfer(originator, rest);
        emit Recovered(amount, toSenior, toJunior, rest);
    }

    /// @notice Originator attaches the hash of the evidence backing this facility (invoice, warehouse receipt).
    function attachEvidence(bytes32 hash) external {
        if (msg.sender != originator) revert NotOriginator();
        evidenceHash = hash;
        emit EvidenceAttached(hash, msg.sender);
    }

    function _pendingLateFee() internal view returns (uint256) {
        if (status != Status.Late) return 0;
        uint256 daysLate = (block.timestamp - lateAccruedAt) / 1 days;
        return principal * terms.lateFeePerDayBps * daysLate / BPS;
    }

    function _accrueLateFee() internal {
        uint256 pending = _pendingLateFee();
        if (pending == 0) return;
        fee += pending;
        lateAccruedAt += ((block.timestamp - lateAccruedAt) / 1 days) * 1 days;
    }

    function _distributeFee(uint256 amount) internal {
        if (amount == 0) return;
        uint256 toSenior = amount * terms.seniorFeeShareBps / BPS;
        seniorAssets += toSenior;
        juniorAssets += amount - toSenior;
    }

    function _close() internal {
        status = Status.Closed;
        uint256 refund = firstLossReserve;
        firstLossReserve = 0;
        asset.safeTransfer(originator, refund);
        emit FacilityClosed();
    }

    function _toShares(uint256 amount, uint256 assets, uint256 totalShares) internal pure returns (uint256) {
        if (totalShares == 0 || assets == 0) return amount;
        return amount * totalShares / assets;
    }
}
