const { address, call, deploy, send } = require('../utils');
import { expect } from "chai";
import { Signer } from "ethers";
const hre = require('hardhat')


describe('admin / _setPendingAdmin / _acceptAdmin', () => {
  // Root is the initial admin of the contract.
  let root: Signer

  // An array of other accounts, which are not initially admins.
  let accounts: Array<Signer>

  // The comptroller contract under test.
  let comptroller: any

  beforeEach(async () => {
    [root, ...accounts] = await hre.ethers.getSigners();
    comptroller = await deploy('Unitroller');
  });

  describe('admin()', () => {
    it('should return correct admin', async () => {
      expect(await call(comptroller, 'admin')).to.equal(await root.getAddress());
    });
  });

  describe('pendingAdmin()', () => {
    it('should return correct pending admin', async () => {
      expect(await call(comptroller, 'pendingAdmin')).equal(address(0))
    });
  });

  describe('_setPendingAdmin()', () => {
    it('should only be callable by admin', async () => {
      // In a perfect world, we'd make sure the transaction returned an error code, but ethers
      // doesn't give us return values directly. Instead, call the method and then optimistically assume
      // the value is correct. We validate the state below, so this is only checking that errors are the
      // ones we think they are.
      // TODO(lunar-engineering): Reverse engineer `toHaveTrollFailure` and enable this assertion.
      await send(comptroller, '_setPendingAdmin', [await accounts[0].getAddress()], { from: accounts[0]})
      //expect(
      //   await send(comptroller, '_setPendingAdmin', [accounts[0].address], {from: accounts[0]})
      // ).toHaveTrollFailure('UNAUTHORIZED', 'SET_PENDING_ADMIN_OWNER_CHECK');

      // Check admin stays the same
      expect(await call(comptroller, 'admin')).to.equal(await root.getAddress());
      expect(await call(comptroller, 'pendingAdmin')).to.equal(address(0));
    });

    it('should properly set pending admin', async () => {
      await send(comptroller, '_setPendingAdmin', [await accounts[0].getAddress()])

      // Check admin stays the same
      expect(await call(comptroller, 'admin')).to.equal(await root.getAddress());
      expect(await call(comptroller, 'pendingAdmin')).to.equal(await accounts[0].getAddress());
    });

    it('should properly set pending admin twice', async () => {
      await send(comptroller, '_setPendingAdmin', [await accounts[0].getAddress()]);
      await send(comptroller, '_setPendingAdmin', [await accounts[1].getAddress()]);

      // Check admin stays the same
      expect(await call(comptroller, 'admin')).to.equal(await root.getAddress());
      expect(await call(comptroller, 'pendingAdmin')).to.equal(await accounts[1].getAddress());
    });

    // TODO(lunar-engineering): Figure out how to test events in ethers / hardhat.
    // it('should emit event', async () => {
    //   const result = await send(comptroller, '_setPendingAdmin', [accounts[0]]);
    //   expect(result).toHaveLog('NewPendingAdmin', {
    //     oldPendingAdmin: address(0),
    //     newPendingAdmin: accounts[0],f
    //   });
    // });
  });

  describe('_acceptAdmin()', () => {
    it('should fail when pending admin is zero', async () => {
      // In a perfect world, we'd make sure the transaction returned an error code, but ethers
      // doesn't give us return values directly. Instead, call the method and then optimistically assume
      // the value is correct. We validate the state below, so this is only checking that errors are the
      // ones we think they are.
      // TODO(lunar-engineering): Reverse engineer `toHaveTrollFailure` and enable this assertion.
      await send(comptroller, '_acceptAdmin')
      // expect(await send(comptroller, '_acceptAdmin')).toHaveTrollFailure('UNAUTHORIZED', 'ACCEPT_ADMIN_PENDING_ADMIN_CHECK');

      // Check admin stays the same
      expect(await call(comptroller, 'admin')).to.equal(await root.getAddress());
      expect(await call(comptroller, 'pendingAdmin')).to.equal(address(0));
    });

    it('should fail when called by another account (e.g. root)', async () => {
      await send(comptroller, '_setPendingAdmin', [await accounts[0].getAddress()])

      // In a perfect world, we'd make sure the transaction returned an error code, but ethers
      // doesn't give us return values directly. Instead, call the method and then optimistically assume
      // the value is correct. We validate the state below, so this is only checking that errors are the
      // ones we think they are.
      // TODO(lunar-engineering): Reverse engineer `toHaveTrollFailure` and enable this assertion.
      await send(comptroller, '_acceptAdmin')
      // expect(await send(comptroller, '_acceptAdmin')).toHaveTrollFailure('UNAUTHORIZED', 'ACCEPT_ADMIN_PENDING_ADMIN_CHECK');

      // Check admin stays the same
      expect(await call(comptroller, 'admin')).to.equal(await root.getAddress());
      expect(await call(comptroller, 'pendingAdmin')).to.equal(await accounts[0].getAddress());
    });

    it('should succeed and set admin and clear pending admin', async () => {
      await send(comptroller, '_setPendingAdmin', [await accounts[0].getAddress()])
      await send(comptroller, '_acceptAdmin', [], {from: accounts[0]})

      // Check admin stays the same
      expect(await call(comptroller, 'admin')).to.equal(await accounts[0].getAddress());
      expect(await call(comptroller, 'pendingAdmin')).to.equal(address(0));
    });

    // TODO(lunar-engineering): Figure out how to test events in ethers / hardhat.
    // it('should emit log on success', async () => {
    //   expect(await send(comptroller, '_setPendingAdmin', [accounts[0]])).toSucceed();
    //   const result = await send(comptroller, '_acceptAdmin', [], {from: accounts[0]});
    //   expect(result).toHaveLog('NewAdmin', {
    //     oldAdmin: root,
    //     newAdmin: accounts[0],
    //   });
    //   expect(result).toHaveLog('NewPendingAdmin', {
    //     oldPendingAdmin: accounts[0],
    //     newPendingAdmin: address(0),
    //   });
    // });
  });
});
