// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVenue} from "../../src/interfaces/IVenue.sol";
import {CopyVault} from "../../src/periphery/CopyVault.sol";

interface ILimits {
    function placeBuy(address token, uint256 minOut, uint40 expiry) external payable returns (uint256);
    function cancel(uint256 id) external;
}

interface ICopyVault {
    function deposit() external payable;
    function withdraw(uint256 amount, address to) external;
    function follow(address leader, CopyVault.Rules calldata rules) external;
    function copyBuy(address follower, address leader, address token) external returns (uint256);
    function copySell(address follower, address leader, address token) external returns (uint256);
}

/// @notice An order owner whose receive() always reverts, so anything paying it directly fails.
contract Receiver {
    receive() external payable {
        revert("no");
    }

    function placeBuy(address limits, address token, uint256 minOut, uint40 expiry) external payable returns (uint256) {
        return ILimits(limits).placeBuy{value: msg.value}(token, minOut, expiry);
    }

    function cancel(address limits, uint256 id) external {
        ILimits(limits).cancel(id);
    }

    function buy(address venue, address token, uint256 minOut, address to, uint256 deadline) external payable returns (uint256) {
        return IVenue(venue).buy{value: msg.value}(token, minOut, to, deadline);
    }

    // CopyVault, as a follower that can't take ZRO back.
    function deposit(address copyVault) external payable {
        ICopyVault(copyVault).deposit{value: msg.value}();
    }

    function withdrawFrom(address copyVault, uint256 amount, address to) external {
        ICopyVault(copyVault).withdraw(amount, to);
    }

    function follow(address copyVault, address leader, CopyVault.Rules calldata rules) external {
        ICopyVault(copyVault).follow(leader, rules);
    }

    function copyCopy(address copyVault, address follower, address leader, address token) external returns (uint256) {
        return ICopyVault(copyVault).copyBuy(follower, leader, token);
    }
}
