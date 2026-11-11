// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SamplePad} from "../test/SamplePad.sol";

/// @notice A stand-in for someone else's launchpad, on the test network only. Its entry is launchpads/sample.json.
contract DeploySamplePad is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        SamplePad pad = new SamplePad();
        vm.stopBroadcast();
        console2.log("SAMPLE_PAD", address(pad));
        console2.log("BLOCK", block.number);
    }
}
