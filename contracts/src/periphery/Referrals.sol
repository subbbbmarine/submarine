// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Referrals
/// @notice Who brought whom, and what that has earned. A trader links to a referrer once, for good. From then on the
/// launchpad and the router send part of the treasury's cut of that trader's trades here: most to the referrer, the rest
/// back to the trader as cashback. Both claim whenever they like.
/// @dev Nothing here can be changed by anyone, and it holds only what it has been sent to pay out.
contract Referrals is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    /// @notice Of what `credit` receives, the referrer's part. The rest is the trader's cashback.
    uint256 public constant REFERRER_BPS = 7_500;

    mapping(address => address) public referrerOf;
    mapping(address => uint256) public earned;
    mapping(address => uint256) public referredCount;

    event Linked(address indexed trader, address indexed referrer);
    event Credited(address indexed trader, address indexed referrer, uint256 toReferrer, uint256 toTrader);
    event Claimed(address indexed who, uint256 amount);

    error BadReferrer();
    error AlreadyLinked();
    error NothingToClaim();
    error TransferFailed();

    /// @notice Links the caller to `referrer`. Once only, and not to themselves or to someone they referred.
    function link(address referrer) external {
        if (referrerOf[msg.sender] != address(0)) revert AlreadyLinked();
        if (referrer == address(0) || referrer == msg.sender || referrerOf[referrer] == msg.sender) revert BadReferrer();
        referrerOf[msg.sender] = referrer;
        referredCount[referrer] += 1;
        emit Linked(msg.sender, referrer);
    }

    /// @notice Splits what's sent between `trader`'s referrer and `trader`. Anyone may call it: it only ever adds.
    function credit(address trader) external payable {
        address referrer = referrerOf[trader];
        if (referrer == address(0)) revert BadReferrer();
        uint256 toReferrer = (msg.value * REFERRER_BPS) / BPS;
        earned[referrer] += toReferrer;
        earned[trader] += msg.value - toReferrer;
        emit Credited(trader, referrer, toReferrer, msg.value - toReferrer);
    }

    function claim() external nonReentrant {
        uint256 amount = earned[msg.sender];
        if (amount == 0) revert NothingToClaim();
        earned[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }
}
