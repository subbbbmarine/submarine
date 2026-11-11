// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SamplePadToken is ERC20 {
    string public metadata;

    constructor(string memory name_, string memory symbol_, string memory metadata_, uint256 supply) ERC20(name_, symbol_) {
        metadata = metadata_;
        _mint(msg.sender, supply);
    }
}

/// @notice For testing only: a stand-in for someone else's launchpad, to prove the terminal can launch, trade and index on
/// one it knows nothing about except its entry in launchpads/. Its names, events, supply and curve all differ from ours on
/// purpose. When the curve fills, trading just stops, as it does on launchpads that move to an outside exchange.
contract SamplePad {
    uint256 public constant SUPPLY = 800_000_000 ether;
    uint256 public constant TARGET = 1.2 ether;
    uint256 public constant VIRTUAL_ZRO = 0.4 ether;

    struct Market {
        address dev;
        uint256 raised;
        uint256 sold;
        bool done;
    }

    mapping(address => Market) public markets;

    event TokenBorn(address indexed token, address indexed dev, string name, string symbol, string metadata);
    event Purchased(address indexed token, address indexed buyer, uint256 paid, uint256 got, uint256 raised);
    event Dumped(address indexed token, address indexed seller, uint256 amount, uint256 received, uint256 raised);
    event Completed(address indexed token, uint256 raised);

    error Unknown();
    error Closed();
    error TooLittle();
    error PayFailed();

    /// @notice Any ZRO sent is the creator's first purchase.
    function createToken(string calldata name_, string calldata symbol_, string calldata metadata_) external payable returns (address token) {
        token = address(new SamplePadToken(name_, symbol_, metadata_, SUPPLY));
        markets[token].dev = msg.sender;
        emit TokenBorn(token, msg.sender, name_, symbol_, metadata_);
        if (msg.value > 0) _purchase(token, msg.value, 0);
    }

    function purchase(address token, uint256 minTokens) external payable returns (uint256) {
        return _purchase(token, msg.value, minTokens);
    }

    function dump(address token, uint256 amount, uint256 minZro) external returns (uint256 received) {
        Market storage m = markets[token];
        if (m.dev == address(0)) revert Unknown();
        if (m.done) revert Closed();
        received = _dumpQuote(m, amount);
        if (received == 0 || received < minZro) revert TooLittle();
        m.raised -= received;
        m.sold -= amount;
        SamplePadToken(token).transferFrom(msg.sender, address(this), amount);
        _pay(msg.sender, received);
        emit Dumped(token, msg.sender, amount, received, m.raised);
    }

    function previewPurchase(address token, uint256 zroIn) external view returns (uint256 tokens) {
        Market storage m = markets[token];
        if (m.dev == address(0) || m.done) return 0;
        (tokens,) = _purchaseQuote(m, zroIn);
    }

    function previewDump(address token, uint256 amount) external view returns (uint256) {
        Market storage m = markets[token];
        if (m.dev == address(0) || m.done || amount > m.sold) return 0;
        return _dumpQuote(m, amount);
    }

    function _purchase(address token, uint256 zroIn, uint256 minTokens) private returns (uint256 tokens) {
        Market storage m = markets[token];
        if (m.dev == address(0)) revert Unknown();
        if (m.done) revert Closed();
        uint256 used;
        (tokens, used) = _purchaseQuote(m, zroIn);
        if (tokens == 0 || tokens < minTokens) revert TooLittle();
        m.raised += used;
        m.sold += tokens;
        SamplePadToken(token).transfer(msg.sender, tokens);
        emit Purchased(token, msg.sender, used, tokens, m.raised);
        if (m.raised == TARGET) {
            m.done = true;
            emit Completed(token, m.raised);
        }
        if (zroIn > used) _pay(msg.sender, zroIn - used);
    }

    function _purchaseQuote(Market storage m, uint256 zroIn) private view returns (uint256 tokens, uint256 used) {
        uint256 room = TARGET - m.raised;
        used = zroIn < room ? zroIn : room;
        uint256 left = (VIRTUAL_ZRO * SUPPLY) / (VIRTUAL_ZRO + m.raised + used) + 1;
        tokens = SUPPLY - m.sold - left;
    }

    function _dumpQuote(Market storage m, uint256 amount) private view returns (uint256) {
        uint256 after_ = (VIRTUAL_ZRO * SUPPLY) / (SUPPLY - m.sold + amount) + 1;
        uint256 before = VIRTUAL_ZRO + m.raised;
        return before > after_ ? before - after_ : 0;
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert PayFailed();
    }
}
