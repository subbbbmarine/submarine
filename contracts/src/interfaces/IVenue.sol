// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The shape every place a token can trade must have. The launchpad curve and the pools implement it directly;
/// a third-party launchpad joins the terminal through a small adapter with this same interface.
/// @dev A venue that cannot serve a token quotes 0 instead of reverting, so routing can compare venues safely.
interface IVenue {
    function quoteBuy(address token, uint256 zroIn) external view returns (uint256 tokensOut);
    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 zroOut);
    function buy(address token, uint256 minOut, address recipient, uint256 deadline) external payable returns (uint256 tokensOut);
    function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline) external returns (uint256 zroOut);
}
