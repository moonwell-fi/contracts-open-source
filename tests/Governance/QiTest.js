const {
  address,
  minerStart,
  minerStop,
  unlockedAccount,
  mineBlock
} = require('../Utils/Avalanche');

const EIP712 = require('../Utils/EIP712');

describe('Benqi', () => {
  const name = 'Benqi';
  const symbol = 'Qi';

  let root, a1, a2, accounts, chainId;
  let benqi;

  beforeEach(async () => {
    [root, a1, a2, ...accounts] = saddle.accounts;
    chainId = 1; // await web3.eth.net.getId(); See: https://github.com/trufflesuite/ganache-core/issues/515
    benqi = await deploy('Benqi', [root]);
  });

  describe('metadata', () => {
    it('has given name', async () => {
      expect(await call(benqi, 'name')).toEqual(name);
    });

    it('has given symbol', async () => {
      expect(await call(benqi, 'symbol')).toEqual(symbol);
    });
  });

  describe('balanceOf', () => {
    it('grants to initial account', async () => {
      expect(await call(benqi, 'balanceOf', [root])).toEqual("7200000000000000000000000000");
    });
  });

  describe('delegateBySig', () => {
    const Domain = (benqi) => ({ name, chainId, verifyingContract: benqi._address });
    const Types = {
      Delegation: [
        { name: 'delegatee', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' }
      ]
    };

    it('reverts if the signatory is invalid', async () => {
      const delegatee = root, nonce = 0, expiry = 0;
      await expect(send(benqi, 'delegateBySig', [delegatee, nonce, expiry, 0, '0xbad', '0xbad'])).rejects.toRevert("revert Benqi::delegateBySig: invalid signature");
    });

    it('reverts if the nonce is bad ', async () => {
      const delegatee = root, nonce = 1, expiry = 0;
      const { v, r, s } = EIP712.sign(Domain(benqi), 'Delegation', { delegatee, nonce, expiry }, Types, unlockedAccount(a1).secretKey);
      await expect(send(benqi, 'delegateBySig', [delegatee, nonce, expiry, v, r, s])).rejects.toRevert("revert Benqi::delegateBySig: invalid nonce");
    });

    it('reverts if the signature has expired', async () => {
      const delegatee = root, nonce = 0, expiry = 0;
      const { v, r, s } = EIP712.sign(Domain(benqi), 'Delegation', { delegatee, nonce, expiry }, Types, unlockedAccount(a1).secretKey);
      await expect(send(benqi, 'delegateBySig', [delegatee, nonce, expiry, v, r, s])).rejects.toRevert("revert Benqi::delegateBySig: signature expired");
    });

    it('delegates on behalf of the signatory', async () => {
      const delegatee = root, nonce = 0, expiry = 10e9;
      const { v, r, s } = EIP712.sign(Domain(benqi), 'Delegation', { delegatee, nonce, expiry }, Types, unlockedAccount(a1).secretKey);
      expect(await call(benqi, 'delegates', [a1])).toEqual(address(0));
      const tx = await send(benqi, 'delegateBySig', [delegatee, nonce, expiry, v, r, s]);
      expect(tx.gasUsed < 80000);
      expect(await call(benqi, 'delegates', [a1])).toEqual(root);
    });
  });

  describe('numCheckpoints', () => {
    it('returns the number of checkpoints for a delegate', async () => {
      let guy = accounts[0];
      await send(benqi, 'transfer', [guy, '100']); //give an account a few tokens for readability
      await expect(call(benqi, 'numCheckpoints', [a1])).resolves.toEqual('0');

      const t1 = await send(benqi, 'delegate', [a1], { from: guy });
      await expect(call(benqi, 'numCheckpoints', [a1])).resolves.toEqual('1');

      const t2 = await send(benqi, 'transfer', [a2, 10], { from: guy });
      await expect(call(benqi, 'numCheckpoints', [a1])).resolves.toEqual('2');

      const t3 = await send(benqi, 'transfer', [a2, 10], { from: guy });
      await expect(call(benqi, 'numCheckpoints', [a1])).resolves.toEqual('3');

      const t4 = await send(benqi, 'transfer', [guy, 20], { from: root });
      await expect(call(benqi, 'numCheckpoints', [a1])).resolves.toEqual('4');

      await expect(call(benqi, 'checkpoints', [a1, 0])).resolves.toEqual(expect.objectContaining({ fromBlock: t1.blockNumber.toString(), votes: '100' }));
      await expect(call(benqi, 'checkpoints', [a1, 1])).resolves.toEqual(expect.objectContaining({ fromBlock: t2.blockNumber.toString(), votes: '90' }));
      await expect(call(benqi, 'checkpoints', [a1, 2])).resolves.toEqual(expect.objectContaining({ fromBlock: t3.blockNumber.toString(), votes: '80' }));
      await expect(call(benqi, 'checkpoints', [a1, 3])).resolves.toEqual(expect.objectContaining({ fromBlock: t4.blockNumber.toString(), votes: '100' }));
    });

    it('does not add more than one checkpoint in a block', async () => {
      let guy = accounts[0];

      await send(benqi, 'transfer', [guy, '100']); //give an account a few tokens for readability
      await expect(call(benqi, 'numCheckpoints', [a1])).resolves.toEqual('0');
      await minerStop();

      let t1 = send(benqi, 'delegate', [a1], { from: guy });
      let t2 = send(benqi, 'transfer', [a2, 10], { from: guy });
      let t3 = send(benqi, 'transfer', [a2, 10], { from: guy });

      await minerStart();
      t1 = await t1;
      t2 = await t2;
      t3 = await t3;

      await expect(call(benqi, 'numCheckpoints', [a1])).resolves.toEqual('1');

      await expect(call(benqi, 'checkpoints', [a1, 0])).resolves.toEqual(expect.objectContaining({ fromBlock: t1.blockNumber.toString(), votes: '80' }));
      await expect(call(benqi, 'checkpoints', [a1, 1])).resolves.toEqual(expect.objectContaining({ fromBlock: '0', votes: '0' }));
      await expect(call(benqi, 'checkpoints', [a1, 2])).resolves.toEqual(expect.objectContaining({ fromBlock: '0', votes: '0' }));

      const t4 = await send(benqi, 'transfer', [guy, 20], { from: root });
      await expect(call(benqi, 'numCheckpoints', [a1])).resolves.toEqual('2');
      await expect(call(benqi, 'checkpoints', [a1, 1])).resolves.toEqual(expect.objectContaining({ fromBlock: t4.blockNumber.toString(), votes: '100' }));
    });
  });

  describe('getPriorVotes', () => {
    it('reverts if block number >= current block', async () => {
      await expect(call(benqi, 'getPriorVotes', [a1, 5e10])).rejects.toRevert("revert Benqi::getPriorVotes: not yet determined");
    });

    it('returns 0 if there are no checkpoints', async () => {
      expect(await call(benqi, 'getPriorVotes', [a1, 0])).toEqual('0');
    });

    it('returns the latest block if >= last checkpoint block', async () => {
      const t1 = await send(benqi, 'delegate', [a1], { from: root });
      await mineBlock();
      await mineBlock();

      expect(await call(benqi, 'getPriorVotes', [a1, t1.blockNumber])).toEqual('7200000000000000000000000000');
      expect(await call(benqi, 'getPriorVotes', [a1, t1.blockNumber + 1])).toEqual('7200000000000000000000000000');
    });

    it('returns zero if < first checkpoint block', async () => {
      await mineBlock();
      const t1 = await send(benqi, 'delegate', [a1], { from: root });
      await mineBlock();
      await mineBlock();

      expect(await call(benqi, 'getPriorVotes', [a1, t1.blockNumber - 1])).toEqual('0');
      expect(await call(benqi, 'getPriorVotes', [a1, t1.blockNumber + 1])).toEqual('7200000000000000000000000000');
    });

    it('generally returns the voting balance at the appropriate checkpoint', async () => {
      const t1 = await send(benqi, 'delegate', [a1], { from: root });
      await mineBlock();
      await mineBlock();
      const t2 = await send(benqi, 'transfer', [a2, 10], { from: root });
      await mineBlock();
      await mineBlock();
      const t3 = await send(benqi, 'transfer', [a2, 10], { from: root });
      await mineBlock();
      await mineBlock();
      const t4 = await send(benqi, 'transfer', [root, 20], { from: a2 });
      await mineBlock();
      await mineBlock();

      expect(await call(benqi, 'getPriorVotes', [a1, t1.blockNumber - 1])).toEqual('0');
      expect(await call(benqi, 'getPriorVotes', [a1, t1.blockNumber])).toEqual('7200000000000000000000000000');
      expect(await call(benqi, 'getPriorVotes', [a1, t1.blockNumber + 1])).toEqual('7200000000000000000000000000');
      expect(await call(benqi, 'getPriorVotes', [a1, t2.blockNumber])).toEqual('7199999999999999999999999990');
      expect(await call(benqi, 'getPriorVotes', [a1, t2.blockNumber + 1])).toEqual('7199999999999999999999999990');
      expect(await call(benqi, 'getPriorVotes', [a1, t3.blockNumber])).toEqual('7199999999999999999999999980');
      expect(await call(benqi, 'getPriorVotes', [a1, t3.blockNumber + 1])).toEqual('7199999999999999999999999980');
      expect(await call(benqi, 'getPriorVotes', [a1, t4.blockNumber])).toEqual('7200000000000000000000000000');
      expect(await call(benqi, 'getPriorVotes', [a1, t4.blockNumber + 1])).toEqual('7200000000000000000000000000');
    });
  });
});
