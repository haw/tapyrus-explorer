const app = require('../app.js');
const { createCache, loadCache } = require('../libs/cache');
const tapyrusd = require('../libs/tapyrusd').client;
const electrs = require('../libs/electrs');
const logger = require('../libs/logger');

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  next();
});

async function getMemTx() {
  const txids = await tapyrusd.getRawMempool();
  const txs = await Promise.all(
    txids.map(txid => electrs.blockchain.transaction.get(txid, true))
  );

  const txsWithTime = txs
    .map(async tx => {
      const txDetail = await tapyrusd.command([
        {
          method: 'getmempoolentry',
          parameters: {
            txid: tx.txid
          }
        }
      ]);
      tx.time = txDetail[0].time;

      return tx;
    })
    .sort((a, b) => b.time - a.time);

  return txsWithTime;
}

//Return a List of transactions
app.get('/transactions', async (req, res) => {
  let perPage = Number(req.query.perPage);
  const page = Number(req.query.page);

  try {
    const chainTxStats = await tapyrusd.getChainTxStats();
    const txCount = chainTxStats.txcount;
    const bestBlockHeight = await tapyrusd.getBlockCount();

    await createCache();
    const cache = loadCache();
    if (cache.getKey(`bestBlockHeight`) !== bestBlockHeight) {
      throw new Error("Cache's best Block Height is not updated");
    }

    let count = 0,
      transList = [];

    const memTxList = await getMemTx();
    if (memTxList.length > perPage * (page - 1)) {
      let j = perPage * (page - 1);
      while (j < memTxList.length) {
        let amount = 0;
        memTxList[j].vout.forEach(vout => {
          amount += vout.value;
        });
        memTxList[j].amount = amount;
        memTxList[j].confirmations = 0;
        transList.push(memTxList[j]);
        j++;
        count++;
        if (count == perPage) {
          break;
        }
      }
    }

    const transactionCount = txCount;
    let startingTrans = transactionCount - perPage * page;

    if (startingTrans < 0) {
      //if last page's remainder should use different value of startingTrans and perPage
      startingTrans = 0;
      perPage = transactionCount % perPage;
    }

    for (let i = startingTrans + perPage - 1; i >= startingTrans; i--) {
      let amount = 0;
      const trans = await electrs.blockchain.transaction.get(
        cache.getKey(i),
        true
      );

      trans.vout.forEach(vout => {
        amount += vout.value;
      });
      trans.amount = amount;
      transList.push(trans);
      count++;
      if (count == perPage) {
        break;
      }
    }

    res.json({
      results: transList,
      txCount
    });
  } catch (error) {
    logger.error(
      `Error retrieving ${perPage} transactions for page#${page}. Error Message - ${error.message}`
    );
    res.status(500).send(`Error Retrieving Blocks`);
  }
});
