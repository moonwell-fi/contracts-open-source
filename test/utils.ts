const { ethers } = require('hardhat')
const hre = require('hardhat')
import { Signer } from 'ethers'

/**
 * Increase EVM time by `seconds` seconds and mine ag new block.
 *
 * @param seconds Number of seconds to advance the clock
 */
export const increaseTime = async (seconds: number) => {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Mines a block at `timestamp`.
 *
 * @param timestamp Timestamp of the new block.
 */
export const mineBlockWithTimestamp = async (timestamp: number) => {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Sets the timestamp of the next mined block.
 *
 * @param timestamp Timestamp of the new block.
 */
export const setNextBlockTimestamp = async (timestamp: number) => {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
}

/**
 * Reset Hardhat test network.
 */
export const resetHardhatNetwork = async () => {
  await hre.network.provider.send("hardhat_reset");
};


/**
 * Returns an address from the given number.
 * 
 * @param n The number to convert into an address
 * @returns A properly formatted ethereum address, starting with '0x'.
 */
export const address = (n: number) => {
  return `0x${n.toString(16).padStart(40, '0')}`;
}

/**
 * Deploy the given contract
 * 
 * @param contractName The name of the contract to deploy
 * @param constructorArguments An array of arguments to send to the constructor
 * @returns An instance of the deployed contract.
 */
export const deploy = async (contractName: string, constructorArguments: Array<any> = []) => {
  const Factory = await hre.ethers.getContractFactory(contractName);
  return await Factory.deploy(...constructorArguments);
}

/**
 * Call the given view.
 * 
 * TODO(lunar-engineering): Make this support passing arguments to the view.
 * 
 * @param contract A contract to call the view on.
 * @param method The name of the view. 
 * @param callArgs Arguments to call with.
 * @returns The result of calling the view.
 */
export const call = async (contract: any, method: string, callArgs: Array<any> = []) => {
  return await contract[method](...callArgs)
}

/**
 * Options to use when sending a contract call.
 */
export type SendOptions = {
  // If set, this signer will be used to make the contract call. Otherwise, the default signer is used.
  from?: Signer
}

/**
 * Send a call to a contract. 
 * 
 * @param contract The contract to interact with. 
 * @param method The name of the method to call.
 * @param sendArgs An array of arguments to pass to the contract.
 * @param options A set of options to use when calling the contract.
 * @returns An ethers Result.
 */
export const send = async (contract: any, method: string, sendArgs: Array<any> = [], options: SendOptions = {}) => {
  const sender = options.from ?? (await hre.ethers.getSigners())[0]
  return (contract.connect(sender))[method](...sendArgs)
}