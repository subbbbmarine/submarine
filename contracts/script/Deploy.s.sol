// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {Launchpad} from "../src/core/Launchpad.sol";
import {ZroInfinityPools} from "../src/core/ZroInfinityPools.sol";
import {ZroInfinityVenue} from "../src/periphery/ZroInfinityVenue.sol";
import {Vault} from "infinity-core/src/Vault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {Router} from "../src/periphery/Router.sol";
import {LimitOrders} from "../src/periphery/LimitOrders.sol";
import {BuybackVault} from "../src/fees/BuybackVault.sol";
import {Referrals} from "../src/periphery/Referrals.sol";
import {CopyVault} from "../src/periphery/CopyVault.sol";

/// @notice Deploys and wires the whole stack, then writes the addresses to deployments/<chainId>.json.
/// Reads the key from PRIVATE_KEY. Its address owns everything and runs the buybacks, unless OWNER (a multisig) and KEEPER are set.
contract Deploy is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(key);
        vm.startBroadcast(key);

        Referrals referrals = new Referrals();
        BuybackVault vault = new BuybackVault(me, me);
        // PancakeSwap Infinity's core, ours on this chain: the vault holds every pool's money, the manager runs the pools.
        Vault infinityVault = new Vault();
        CLPoolManager poolManager = new CLPoolManager(infinityVault);
        infinityVault.registerApp(address(poolManager));
        ZroInfinityPools pools = new ZroInfinityPools(me, infinityVault, poolManager);
        // Trades reach the pools through their own venue: Infinity doesn't charge a hook's own swaps.
        ZroInfinityVenue poolVenue = new ZroInfinityVenue(pools);
        pools.setVenue(address(poolVenue));
        Launchpad launchpad = new Launchpad(me, address(vault), address(pools), address(referrals));
        pools.setLaunchpad(address(launchpad));

        Router router = new Router(me, address(vault), address(referrals));
        // Both take the 1% base themselves, the terminal's 0.4% included, so the router adds nothing on our own tokens.
        router.listVenue(address(launchpad), 0, "Submarine Launchpad");
        router.listVenue(address(poolVenue), 0, "Submarine Pools");
        router.finishSetup(); // from here on, a new venue has to wait out the public delay
        vault.setRouter(address(router));
        launchpad.setRouter(address(router));

        LimitOrders limitOrders = new LimitOrders(me, address(vault), address(router), address(launchpad));
        CopyVault copyVault = new CopyVault(address(router), address(launchpad));
        // They trade for their users, so those trades count for the users' volume and rank.
        address[] memory forwarders = new address[](2);
        (forwarders[0], forwarders[1]) = (address(limitOrders), address(copyVault));
        router.setForwarders(forwarders);

        // These only pass tokens through, so on a token that pays its holders they shouldn't earn like holders.
        // The Infinity vault too: that is where every pool's tokens sit.
        address[] memory passThrough = new address[](6);
        (passThrough[0], passThrough[1], passThrough[2], passThrough[3], passThrough[4], passThrough[5]) =
            (address(router), address(limitOrders), address(vault), address(copyVault), address(infinityVault), address(poolVenue));
        launchpad.setNotEarning(passThrough);

        // A separate key for the buybacks, and a multisig to own everything, when given. The contracts with two-step ownership
        // offer it, and the multisig takes it with acceptOwnership; the pools and Infinity's pool manager hand it over at once.
        address keeper = vm.envOr("KEEPER", address(0));
        if (keeper != address(0)) vault.setKeeper(keeper);
        address owner = vm.envOr("OWNER", address(0));
        if (owner != address(0) && owner != me) {
            launchpad.transferOwnership(owner);
            router.transferOwnership(owner);
            limitOrders.transferOwnership(owner);
            vault.transferOwnership(owner);
            infinityVault.transferOwnership(owner);
            pools.transferOwnership(owner);
            poolManager.transferOwnership(owner);
        }
        vm.stopBroadcast();

        // A dry run computes addresses for contracts that will never exist. The indexer and the site trust this file, so a
        // dry run must not write it. A broadcast does, but before it sends anything: scripts/deploy-zero.ps1 then checks
        // the chain and removes the file if the send failed.
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            console2.log("dry run, no deployment file written");
            return;
        }

        string memory json = "d";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "startBlock", block.number);
        vm.serializeAddress(json, "vault", address(vault));
        vm.serializeAddress(json, "pools", address(pools));
        vm.serializeAddress(json, "infinityVault", address(infinityVault));
        vm.serializeAddress(json, "poolManager", address(poolManager));
        vm.serializeAddress(json, "poolVenue", address(poolVenue));
        vm.serializeAddress(json, "launchpad", address(launchpad));
        vm.serializeAddress(json, "router", address(router));
        vm.serializeAddress(json, "referrals", address(referrals));
        vm.serializeAddress(json, "copyVault", address(copyVault));
        string memory out = vm.serializeAddress(json, "limitOrders", address(limitOrders));
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("deployed, addresses in", path);
    }
}
