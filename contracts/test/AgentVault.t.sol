// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault, AgentVaultFactory} from "../src/periphery/AgentVault.sol";

contract AgentVaultTest is Base {
    AgentVaultFactory internal factory;
    AgentVault internal av;
    address internal agentKey = makeAddr("agent");
    address internal stranger = makeAddr("stranger");
    address internal token;

    function setUp() public override {
        super.setUp();
        factory = new AgentVaultFactory(address(router));
        vm.prank(alice);
        av = factory.create{value: 1_000 ether}(agentKey, _limits(100 ether, 250 ether, 500, false));
        token = _launch();
        vm.roll(block.number + 1);
    }

    function _limits(uint128 perTrade, uint128 perDay, uint16 slip, bool listedOnly) internal pure returns (AgentVault.Limits memory l) {
        l = AgentVault.Limits({perTrade: perTrade, perDay: perDay, slippageBps: slip, listedOnly: listedOnly});
    }

    function _agentBuy(uint256 zro) internal returns (uint256) {
        uint256 minOut = (router.quoteBuy(token, zro) * 99) / 100;
        vm.prank(agentKey);
        return av.buy(token, zro, minOut, _deadline());
    }

    function test_factoryRecordsOwnerAndFunds() public view {
        assertEq(av.owner(), alice);
        assertEq(av.agent(), agentKey);
        assertEq(address(av).balance, 1_000 ether);
        assertTrue(factory.isVault(address(av)));
        assertEq(factory.vaultsOf(alice)[0], address(av));
    }

    function test_agentBuysAndTokensStayInVault() public {
        uint256 got = _agentBuy(50 ether);
        assertGt(got, 0);
        assertEq(IERC20(token).balanceOf(address(av)), got);
        assertEq(IERC20(token).balanceOf(agentKey), 0);
        assertEq(address(av).balance, 950 ether);
        assertEq(av.spentToday(), 50 ether);
    }

    function test_agentSellsAndZroComesBack() public {
        uint256 got = _agentBuy(50 ether);
        vm.roll(block.number + 1); // bought coins rest one block
        uint256 minOut = (router.quoteSell(token, got) * 99) / 100;
        vm.prank(agentKey);
        uint256 zro = av.sell(token, got, minOut, _deadline());
        assertGt(zro, 0);
        assertEq(IERC20(token).balanceOf(address(av)), 0);
        assertEq(address(av).balance, 950 ether + zro);
        assertEq(agentKey.balance, 0);
    }

    function test_perTradeLimit() public {
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.OverTrade.selector);
        av.buy(token, 101 ether, 0, _deadline());
    }

    function test_perDayLimitAndReset() public {
        _agentBuy(100 ether);
        _agentBuy(100 ether);
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.OverDay.selector);
        av.buy(token, 60 ether, 0, _deadline());
        assertEq(av.leftToday(), 50 ether);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 1);
        _agentBuy(100 ether);
        assertEq(av.spentToday(), 100 ether);
    }

    function test_minimumBelowQuoteRefused() public {
        uint256 quote = router.quoteBuy(token, 50 ether);
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.MinTooLow.selector);
        av.buy(token, 50 ether, (quote * 90) / 100, _deadline());

        vm.prank(agentKey);
        vm.expectRevert(AgentVault.MinTooLow.selector);
        av.buy(token, 50 ether, 0, _deadline());
    }

    function test_listedOnly() public {
        vm.prank(alice);
        av.setLimits(_limits(100 ether, 250 ether, 500, true));
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.NotListed.selector);
        av.buy(token, 10 ether, 0, _deadline());

        address[] memory list = new address[](1);
        list[0] = token;
        vm.prank(alice);
        av.setListed(list, true);
        _agentBuy(10 ether);
    }

    function test_onlyOwnerWithdraws() public {
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.NotOwner.selector);
        av.withdraw(1 ether, agentKey);

        uint256 got = _agentBuy(20 ether);
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.NotOwner.selector);
        av.withdrawTokens(IERC20(token), got, agentKey);

        uint256 before = alice.balance;
        vm.prank(alice);
        av.withdraw(100 ether, alice);
        assertEq(alice.balance, before + 100 ether);

        vm.roll(block.number + 1);
        vm.prank(alice);
        av.withdrawTokens(IERC20(token), got, alice);
        assertEq(IERC20(token).balanceOf(alice), got);
    }

    function test_agentCantChangeAnything() public {
        vm.startPrank(agentKey);
        vm.expectRevert(AgentVault.NotOwner.selector);
        av.setAgent(stranger);
        vm.expectRevert(AgentVault.NotOwner.selector);
        av.setLimits(_limits(1_000 ether, 1_000 ether, 5_000, false));
        address[] memory list = new address[](1);
        vm.expectRevert(AgentVault.NotOwner.selector);
        av.setListed(list, true);
        vm.stopPrank();
    }

    function test_strangerCantTrade() public {
        vm.prank(stranger);
        vm.expectRevert(AgentVault.NotAllowed.selector);
        av.buy(token, 1 ether, 0, _deadline());
    }

    function test_ownerRevokesAgent() public {
        vm.prank(alice);
        av.setAgent(address(0));
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.NotAllowed.selector);
        av.buy(token, 1 ether, 0, _deadline());
    }

    function test_ownerTradesOutsideLimits() public {
        vm.prank(alice);
        uint256 got = av.buy(token, 400 ether, 0, _deadline());
        assertGt(got, 0);
        assertEq(av.spentToday(), 0);
    }

    function test_badLimitsRefused() public {
        vm.startPrank(alice);
        vm.expectRevert(AgentVault.BadLimits.selector);
        av.setLimits(_limits(100 ether, 250 ether, 5_001, false));
        vm.expectRevert(AgentVault.BadLimits.selector);
        av.setLimits(_limits(300 ether, 250 ether, 500, false));
        vm.expectRevert(AgentVault.BadLimits.selector);
        av.setAgent(alice);
        vm.stopPrank();
    }

    function test_refundOnCurveFillCountsOnlyWhatWasSpent() public {
        vm.prank(alice);
        av.setLimits(_limits(9_000 ether, 9_000 ether, 5_000, false));
        vm.deal(address(av), 10_000 ether);
        uint256 zro = 9_000 ether; // more than the curve takes, so part comes back
        uint256 minOut = router.quoteBuy(token, zro) / 2;
        vm.prank(agentKey);
        av.buy(token, zro, minOut, _deadline());
        uint256 spent = 10_000 ether - address(av).balance;
        assertLt(spent, zro);
        assertEq(av.spentToday(), spent);
    }
}
