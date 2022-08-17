const {
  encodeParameters,
  etherUnsigned,
  freezeTime,
  keccak256
} = require('./Utils/Ethereum');
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
const hre = require('hardhat')

import { BigNumber } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { expect } from "chai";
import { call, send, mineBlockWithTimestamp, resetHardhatNetwork  } from "./utils";

chai.use(solidity);

const oneWeekInSeconds = BigNumber.from(7 * 24 * 60 * 60);
const zero = BigNumber.from(0);
const gracePeriod = oneWeekInSeconds.mul(2);

describe('Timelock', () => {
  let root: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let newAdmin: SignerWithAddress;

  let blockTimestamp: BigNumber;
  let timelock: any;
  let delay = oneWeekInSeconds;
  let newDelay = delay.mul(2);
  let target: string
  let value = zero;
  let signature = 'setDelay(uint256)';
  let data = encodeParameters(['uint256'], [newDelay]);
  let revertData = encodeParameters(['uint256'], [etherUnsigned(60 * 60).toFixed()]);
  let eta: BigNumber
  let queuedTxHash: string

  beforeEach(async () => {
    await resetHardhatNetwork();

    [root, notAdmin, newAdmin] = await hre.ethers.getSigners();

    const timelockFactory = await hre.ethers.getContractFactory("TimelockHarness");
    timelock = await timelockFactory.deploy(await root.getAddress(), delay)

    blockTimestamp = BigNumber.from(Math.floor(Date.now() / 1000))
    await freezeTime(blockTimestamp)
    target = timelock.address;
    eta = blockTimestamp.add(delay);

    queuedTxHash = keccak256(
      encodeParameters(
        ['address', 'uint256', 'string', 'bytes', 'uint256'],
        [target, value.toString(), signature, data, eta.toString()]
      )
    );
  });

  describe('constructor', () => {
    it('sets address of admin', async () => {
      let configuredAdmin = await timelock.admin();
      expect(configuredAdmin).to.equal(await root.getAddress());
    });

    it('sets delay', async () => {
      let configuredDelay = await timelock.delay();
      expect(configuredDelay).to.equal(delay.toString());
    });
  });

  describe('setDelay', () => {
    it('requires msg.sender to be Timelock', async () => {
      await expect(send(timelock, 'setDelay', [delay], { from: root })).to.be.revertedWith('Timelock::setDelay: Call must come from Timelock.');
    });
  });

  describe('setPendingAdmin', () => {
    it('requires msg.sender to be Timelock', async () => {
      await expect(
        send(timelock, 'setPendingAdmin', [await newAdmin.getAddress()], { from: root })
      ).to.be.revertedWith('Timelock::setPendingAdmin: Call must come from Timelock.');
    });
  });

  describe('acceptAdmin', () => {
    it('requires msg.sender to be pendingAdmin', async () => {
      await expect(
        send(timelock, 'acceptAdmin', [], { from: notAdmin })
      ).to.be.revertedWith('Timelock::acceptAdmin: Call must come from pendingAdmin.');
    });

    it('sets pendingAdmin to address 0 and changes admin', async () => {
      await send(timelock, 'harnessSetPendingAdmin', [await newAdmin.getAddress()], { from: root });
      const pendingAdminBefore = await timelock.pendingAdmin()
      expect(pendingAdminBefore).to.equal(await newAdmin.getAddress());

      const result = await send(timelock, 'acceptAdmin', [], { from: newAdmin });
      const pendingAdminAfter = await call(timelock, 'pendingAdmin');
      expect(pendingAdminAfter).to.equal('0x0000000000000000000000000000000000000000');

      const timelockAdmin = await call(timelock, 'admin');
      expect(timelockAdmin).to.equal(await newAdmin.getAddress());

      // TODO(lunar-eng): Enable logging tests
      // expect(result).toHaveLog('NewAdmin', {
      //   newAdmin
      // });
    });
  });

  describe('queueTransaction', () => {
    it('requires admin to be msg.sender', async () => {
      await expect(
        send(timelock, 'queueTransaction', [target, value, signature, data, eta], { from: notAdmin })
      ).to.be.revertedWith('Timelock::queueTransaction: Call must come from admin.');
    });

    it('requires eta to exceed delay', async () => {
      const etaLessThanDelay = blockTimestamp.add(delay).sub(1);

      await expect(
        send(timelock, 'queueTransaction', [target, value, signature, data, etaLessThanDelay], {
          from: root
        })
      ).to.be.revertedWith('Timelock::queueTransaction: Estimated execution block must satisfy delay.');
    });

    it('sets hash as true in queuedTransactions mapping', async () => {
      const queueTransactionsHashValueBefore = await call(timelock, 'queuedTransactions', [queuedTxHash]);
      expect(queueTransactionsHashValueBefore).to.equal(false);

      await send(timelock, 'queueTransaction', [target, value, signature, data, eta], { from: root });

      const queueTransactionsHashValueAfter = await call(timelock, 'queuedTransactions', [queuedTxHash]);
      expect(queueTransactionsHashValueAfter).to.equal(true);
    });

    // TODO(lunar-eng): Enable when we test for logs.
    // it('should emit QueueTransaction event', async () => {
    //   const result = await send(timelock, 'queueTransaction', [target, value, signature, data, eta], {
    //     from: root
    //   });

    //   expect(result).toHaveLog('QueueTransaction', {
    //     data,
    //     signature,
    //     target,
    //     eta: eta.toString(),
    //     txHash: queuedTxHash,
    //     value: value.toString()
    //   });
    // });
  });

  describe('cancelTransaction', () => {
    beforeEach(async () => {
      await send(timelock, 'queueTransaction', [target, value, signature, data, eta], { from: root });
    });

    it('requires admin to be msg.sender', async () => {
      await expect(
        send(timelock, 'cancelTransaction', [target, value, signature, data, eta], { from: notAdmin })
      ).to.be.revertedWith('Timelock::cancelTransaction: Call must come from admin.');
    });

    it('sets hash from true to false in queuedTransactions mapping', async () => {
      const queueTransactionsHashValueBefore = await call(timelock, 'queuedTransactions', [queuedTxHash]);
      expect(queueTransactionsHashValueBefore).to.equal(true);

      await send(timelock, 'cancelTransaction', [target, value, signature, data, eta], { from: root });

      const queueTransactionsHashValueAfter = await call(timelock, 'queuedTransactions', [queuedTxHash]);
      expect(queueTransactionsHashValueAfter).to.equal(false);
    });

    // TODO(lunar-eng): Enable when we tests for logs
    // it('should emit CancelTransaction event', async () => {
    //   const result = await send(timelock, 'cancelTransaction', [target, value, signature, data, eta], {
    //     from: root
    //   });

    //   expect(result).toHaveLog('CancelTransaction', {
    //     data,
    //     signature,
    //     target,
    //     eta: eta.toString(),
    //     txHash: queuedTxHash,
    //     value: value.toString()
    //   });
    // });
  });

  describe('queue and cancel empty', () => {
    it('can queue and cancel an empty signature and data', async () => {
      const txHash = keccak256(
        encodeParameters(
          ['address', 'uint256', 'string', 'bytes', 'uint256'],
          [target, value.toString(), '', '0x', eta.toString()]
        )
      );
      expect(await call(timelock, 'queuedTransactions', [txHash])).to.be.false;
      await send(timelock, 'queueTransaction', [target, value, '', '0x', eta], { from: root });
      expect(await call(timelock, 'queuedTransactions', [txHash])).to.be.true;
      await send(timelock, 'cancelTransaction', [target, value, '', '0x', eta], { from: root });
      expect(await call(timelock, 'queuedTransactions', [txHash])).to.be.false;
    });
  });

  describe('executeTransaction (setDelay)', () => {
    beforeEach(async () => {
      // Queue transaction that will succeed
      eta = BigNumber.from(Math.ceil(Date.now() / 1000)).add(delay)
      await send(timelock, 'queueTransaction', [target, value, signature, data, eta], {
        from: root
      });
      queuedTxHash = keccak256(
        encodeParameters(
          ['address', 'uint256', 'string', 'bytes', 'uint256'],
          [target, value.toString(), signature, data, eta.toString()]
        )
      );

      // Queue transaction that will revert when executed
      await send(timelock, 'queueTransaction', [target, value, signature, revertData, eta], {
        from: root
      });
    });

    it('requires admin to be msg.sender', async () => {
      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, data, eta], { from: notAdmin })
      ).to.be.revertedWith('Timelock::executeTransaction: Call must come from admin.');
    });

    it('requires transaction to be queued', async () => {
      const differentEta = eta.add(1);
      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, data, differentEta], { from: root })
      ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.");
    });

    it('requires timestamp to be greater than or equal to eta', async () => {
      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, data, eta], {
          from: root
        })
      ).to.be.revertedWith(
        "Timelock::executeTransaction: Transaction hasn't surpassed time lock."
      );
    });

    it('requires timestamp to be less than eta plus gracePeriod', async () => {
      await freezeTime(eta.add(gracePeriod).add(1000));

      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, data, eta], {
          from: root
        })
      ).to.be.revertedWith('Timelock::executeTransaction: Transaction is stale.');
    });

    it('requires target.call transaction to succeed', async () => {
      await freezeTime(eta);

      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, revertData, eta], {
          from: root
        })
      ).to.be.revertedWith('Timelock::executeTransaction: Transaction execution reverted.');
    });

    it('sets hash from true to false in queuedTransactions mapping, updates delay, and emits ExecuteTransaction event', async () => {
      const configuredDelayBefore = await call(timelock, 'delay');
      expect(configuredDelayBefore).to.equal(delay.toString());

      const queueTransactionsHashValueBefore = await call(timelock, 'queuedTransactions', [queuedTxHash]);
      expect(queueTransactionsHashValueBefore).to.equal(true);

      const newBlockTimestamp = BigNumber.from(Math.ceil(Date.now() / 1000)).add(delay).add(1);
      await freezeTime(newBlockTimestamp);

      const result = await send(timelock, 'executeTransaction', [target, value, signature, data, eta], {
        from: root
      });

      const queueTransactionsHashValueAfter = await call(timelock, 'queuedTransactions', [queuedTxHash]);
      expect(queueTransactionsHashValueAfter).to.equal(false);

      const configuredDelayAfter = await call(timelock, 'delay');
      expect(configuredDelayAfter).to.equal(newDelay.toString());

      // TODO(lunar-eng): Enable when we test for logs
      // expect(result).toHaveLog('ExecuteTransaction', {
      //   data,
      //   signature,
      //   target,
      //   eta: eta.toString(),
      //   txHash: queuedTxHash,
      //   value: value.toString()
      // });

      // expect(result).toHaveLog('NewDelay', {
      //   newDelay: newDelay.toString()
      // });
    });
  });

  describe('executeTransaction (setPendingAdmin)', () => {
    beforeEach(async () => {
      signature = 'setPendingAdmin(address)';
      data = encodeParameters(['address'], [await newAdmin.getAddress()]);
      eta = BigNumber.from(Math.ceil(Date.now() / 1000)).add(delay)

      queuedTxHash = keccak256(
        encodeParameters(
          ['address', 'uint256', 'string', 'bytes', 'uint256'],
          [target, value.toString(), signature, data, eta.toString()]
        )
      );

      await send(timelock, 'queueTransaction', [target, value, signature, data, eta], {
        from: root
      });
    });

    it('requires admin to be msg.sender', async () => {
      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, data, eta], { from: notAdmin })
      ).to.be.revertedWith('Timelock::executeTransaction: Call must come from admin.');
    });

    it('requires transaction to be queued', async () => {
      const differentEta = eta.add(1);
      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, data, differentEta], { from: root })
      ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.");
    });

    it('requires timestamp to be greater than or equal to eta', async () => {
      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, data, eta], {
          from: root
        })
      ).to.be.revertedWith(
        "Timelock::executeTransaction: Transaction hasn't surpassed time lock."
      );
    });

    it('requires timestamp to be less than eta plus gracePeriod', async () => {
      await freezeTime(BigNumber.from(Math.ceil(Date.now() / 1000)).add(delay).add(gracePeriod).add(1));

      await expect(
        send(timelock, 'executeTransaction', [target, value, signature, data, eta], {
          from: root
        })
      ).to.be.revertedWith('Timelock::executeTransaction: Transaction is stale.');
    });

    it('sets hash from true to false in queuedTransactions mapping, updates admin, and emits ExecuteTransaction event', async () => {
      const configuredPendingAdminBefore = await call(timelock, 'pendingAdmin');
      expect(configuredPendingAdminBefore).to.equal('0x0000000000000000000000000000000000000000');

      const queueTransactionsHashValueBefore = await call(timelock, 'queuedTransactions', [queuedTxHash]);
      expect(queueTransactionsHashValueBefore).to.equal(true);

      const newBlockTimestamp = BigNumber.from(Math.ceil(Date.now() / 1000)).add(delay).add(1);
      await freezeTime(newBlockTimestamp)

      const result = await send(timelock, 'executeTransaction', [target, value, signature, data, eta], {
        from: root
      });

      const queueTransactionsHashValueAfter = await call(timelock, 'queuedTransactions', [queuedTxHash]);
      expect(queueTransactionsHashValueAfter).to.equal(false);

      const configuredPendingAdminAfter = await call(timelock, 'pendingAdmin');
      expect(configuredPendingAdminAfter).to.equal(await newAdmin.getAddress());

      // TODO(lunar-eng): Enable when we do log based testing
      // expect(result).toHaveLog('ExecuteTransaction', {
      //   data,
      //   signature,
      //   target,
      //   eta: eta.toString(),
      //   txHash: queuedTxHash,
      //   value: value.toString()
      // });

      // expect(result).toHaveLog('NewPendingAdmin', {
      //   newPendingAdmin: newAdmin
      // });
    });
  });
});