// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20Lite {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @title ExitProbe
/// @notice Never deployed: the terminal hands this code to the node for one `eth_call`, to ask what selling a token right
/// after buying it would bring back, through the same router a trade uses. Everything it does ends with the call. A token
/// that taxes a sale or refuses one shows up here before anybody has spent anything.
contract ExitProbe {
    receive() external payable {}

    /// @param venue The router a trade would use.
    /// @param buyData The buy, naming this contract as the receiver of the tokens.
    /// @param sellHead The sale's calldata before its amount.
    /// @param sellTail The sale's calldata after its amount.
    /// @return bought Tokens that reached this contract.
    /// @return back ZRO the sale returned, zero if it reverted.
    /// @return sold Whether the sale went through.
    function probe(address venue, bytes calldata buyData, address token, bytes calldata sellHead, bytes calldata sellTail)
        external
        payable
        returns (uint256 bought, uint256 back, bool sold)
    {
        (bool buyOk, bytes memory why) = venue.call{value: msg.value}(buyData);
        if (!buyOk) {
            assembly {
                revert(add(why, 32), mload(why))
            }
        }
        bought = IERC20Lite(token).balanceOf(address(this));
        // Some tokens answer an approval with nothing: only whether the sale works matters.
        (bool approved,) = token.call(abi.encodeCall(IERC20Lite.approve, (venue, type(uint256).max)));
        approved;
        uint256 before = address(this).balance;
        (sold,) = venue.call(bytes.concat(sellHead, abi.encode(bought), sellTail));
        if (sold) back = address(this).balance - before;
    }
}
