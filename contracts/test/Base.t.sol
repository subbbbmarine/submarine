// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Launchpad, LaunchToken} from "../src/core/Launchpad.sol";
import {ZroInfinityPools} from "../src/core/ZroInfinityPools.sol";
import {ZroInfinityVenue} from "../src/periphery/ZroInfinityVenue.sol";
import {Vault} from "infinity-core/src/Vault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {Router} from "../src/periphery/Router.sol";
import {LimitOrders} from "../src/periphery/LimitOrders.sol";
import {BuybackVault} from "../src/fees/BuybackVault.sol";
import {Referrals} from "../src/periphery/Referrals.sol";
import {CopyVault} from "../src/periphery/CopyVault.sol";

contract PlainToken is ERC20 {
    constructor() ERC20("Plain", "PLN") {
        _mint(msg.sender, 1_000_000 ether);
    }
}

contract Base is Test {
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal creator = makeAddr("creator");
    address internal keeper = makeAddr("keeper");

    BuybackVault internal vault;
    ZroInfinityPools internal pools;
    ZroInfinityVenue internal venue;
    Vault internal infinityVault;
    CLPoolManager internal poolManager;
    Launchpad internal pad;
    Router internal router;
    LimitOrders internal limits;
    Referrals internal referrals;
    CopyVault internal copyVault;

    function setUp() public virtual {
        vm.startPrank(owner);
        referrals = new Referrals();
        vault = new BuybackVault(owner, keeper);
        infinityVault = new Vault();
        poolManager = new CLPoolManager(infinityVault);
        infinityVault.registerApp(address(poolManager));
        pools = new ZroInfinityPools(owner, infinityVault, poolManager);
        venue = new ZroInfinityVenue(pools);
        pools.setVenue(address(venue));
        pad = new Launchpad(owner, address(vault), address(pools), address(referrals));
        pools.setLaunchpad(address(pad));
        router = new Router(owner, address(vault), address(referrals));
        router.listVenue(address(pad), 0, "pad");
        router.listVenue(address(venue), 0, "pools");
        router.finishSetup();
        vault.setRouter(address(router));
        pad.setRouter(address(router));
        limits = new LimitOrders(owner, address(vault), address(router), address(pad));
        copyVault = new CopyVault(address(router), address(pad));
        address[] memory forwarders = new address[](2);
        (forwarders[0], forwarders[1]) = (address(limits), address(copyVault));
        router.setForwarders(forwarders);
        address[] memory passThrough = new address[](6);
        (passThrough[0], passThrough[1], passThrough[2], passThrough[3], passThrough[4], passThrough[5]) =
            (address(router), address(limits), address(vault), address(copyVault), address(infinityVault), address(venue));
        pad.setNotEarning(passThrough);
        vm.stopPrank();

        vm.deal(alice, 400_000 ether);
        vm.deal(bob, 400_000 ether);
        vm.deal(creator, 400_000 ether);
    }

    /// A venue added after launch has to go through the public delay.
    function _listVenue(address venue_, uint16 feeBps, string memory name) internal {
        vm.startPrank(owner);
        router.queueVenue(venue_, feeBps, name);
        vm.warp(block.timestamp + router.LISTING_DELAY());
        router.listVenue(venue_, feeBps, name);
        vm.stopPrank();
    }

    function _launch() internal returns (address token) {
        vm.prank(creator);
        token = pad.launch("Meme", "MEME", "ipfs://x", 0);
    }

    function _graduate(address token) internal {
        vm.prank(bob);
        pad.buy{value: 8_000 ether}(token, 0, bob, block.timestamp);
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 60;
    }
}
