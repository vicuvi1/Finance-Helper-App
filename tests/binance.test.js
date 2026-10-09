import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseSpot, parseFunding, parseEarn, mergeHoldings } from '../js/binance.js';

const require = createRequire(import.meta.url);
const { sign } = require('../electron/binance.cjs');

test('signs requests exactly like Binance documents it', () => {
  // Example from Binance's API documentation (SIGNED endpoint security).
  const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
  const qs = 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559';
  assert.equal(sign(qs, secret), 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
});

test('merges Spot, Funding and Earn into one coin list', () => {
  const spot = parseSpot({ balances: [
    { asset: 'BTC', free: '0.01000000', locked: '0.00200000' },
    { asset: 'USDT', free: '50.5', locked: '0' },
    { asset: 'LDETH', free: '0.3', locked: '0' },
    { asset: 'DOGE', free: '0', locked: '0' },
  ] });
  const funding = parseFunding([{ asset: 'USDT', free: '100', locked: '0', freeze: '0' }]);
  const earn = parseEarn({ rows: [{ asset: 'BNB', totalAmount: '1.25' }], total: 1 });
  const rows = mergeHoldings({ spot, funding, earn });
  const by = Object.fromEntries(rows.map((r) => [r.asset, r]));
  assert.equal(by.BTC.qty, 0.012);
  assert.equal(by.USDT.qty, 150.5);
  assert.deepEqual(by.USDT.wallets, { spot: 50.5, funding: 100, earn: 0 });
  assert.equal(by.ETH.qty, 0.3); // LDETH counted as ETH
  assert.equal(by.BNB.qty, 1.25);
  assert.equal(by.DOGE, undefined);
});
