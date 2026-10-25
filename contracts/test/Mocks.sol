// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Stands in for IMD (Identity.md, 18 decimals) in local tests.
contract MockIMD {
    string public name = "Identity.md";
    string public symbol = "IMD";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    /// @dev Like the live IMD's issuer blocklist: transfers to or from a blocked address revert.
    mapping(address => bool) public blocked;

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address s, uint256 amt) external returns (bool) {
        allowance[msg.sender][s] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        require(!blocked[msg.sender] && !blocked[to], "blocked");
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address f, address to, uint256 amt) external returns (bool) {
        require(!blocked[f] && !blocked[to], "blocked");
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= amt;
        balanceOf[f] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}
