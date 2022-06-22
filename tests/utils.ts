const hre = require('hardhat')

/**
 * Increase EVM time by `seconds` seconds and mine a new block.
 *
 * @param seconds Number of seconds to advance the clock
 */
export const increaseTime = async (seconds: number) => {
  await hre.ethers.provider.send("evm_increaseTime", [seconds]);
  await hre.ethers.provider.send("evm_mine", []);
}

/**
 * Mines a block at `timestamp`.
 *
 * @param timestamp Timestamp of the new block.
 */
export const mineBlockWithTimestamp = async (timestamp: number) => {
  await hre.ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await hre.ethers.provider.send("evm_mine", []);
}

/**
 * Sets the timestamp of the next mined block.
 *
 * @param timestamp Timestamp of the new block.
 */
export const setNextBlockTimestamp = async (timestamp: number) => {
  await hre.ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
}

/**
 * Reset Hardhat test network.
 */
export const resetHardhatNetwork = async () => {
  await hre.network.provider.send("hardhat_reset");
};
