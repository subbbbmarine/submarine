// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HolderToken, LaunchToken} from "./Launchpad.sol";

/// @title TokenFactory
/// @notice Deploys the launchpad's tokens. Kept apart from the launchpad so that carrying both token contracts' code doesn't push
/// the launchpad over the 24 KB contract size limit. Only its launchpad can use it, and every token's supply goes to that launchpad.
contract TokenFactory {
    address public immutable deployer;
    /// @notice The one launchpad this serves, set once.
    address public launchpad;

    error NotLaunchpad();
    error BadConfig();

    constructor() {
        deployer = msg.sender;
    }

    function setLaunchpad(address launchpad_) external {
        if (msg.sender != deployer || launchpad != address(0) || launchpad_ == address(0)) revert BadConfig();
        launchpad = launchpad_;
    }

    /// @notice A new token with its whole supply minted to the launchpad. `exempt` is used only by a token that pays its holders.
    function create(
        bool holders,
        string calldata name_,
        string calldata symbol_,
        string calldata uri_,
        uint256 supply,
        address vault_,
        address venue_,
        address hook_,
        address[] calldata exempt
    ) external returns (address) {
        if (msg.sender != launchpad) revert NotLaunchpad();
        return holders
            ? address(new HolderToken(name_, symbol_, uri_, supply, msg.sender, vault_, venue_, hook_, exempt))
            : address(new LaunchToken(name_, symbol_, uri_, supply, msg.sender, vault_, venue_, hook_));
    }
}
