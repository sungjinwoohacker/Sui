const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { getFullnodeUrl, SuiClient } = require('@mysten/sui.js/client');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography'); 
const fs = require('fs');
const path = require('path');
const readline = require('readline');

require('dotenv').config();

const SUI_RPC_URL = process.env.SUI_RPC_URL || getFullnodeUrl('testnet');

const SYMBOLS = {
  info: '📌',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  processing: '🔄',
  wallet: '👛',
  divider: '═════════════════════════════════════════'
};

const logger = {
  info: (message) => console.log(`${SYMBOLS.info} ${message}`),
  success: (message) => console.log(`${SYMBOLS.success} ${message}`),
  error: (message) => console.log(`${SYMBOLS.error} ${message}`),
  warning: (message) => console.log(`${SYMBOLS.warning} ${message}`),
  processing: (message) => console.log(`${SYMBOLS.processing} ${message}`),
  wallet: (message) => console.log(`${SYMBOLS.wallet} ${message}`),
  divider: () => console.log(SYMBOLS.divider),
  result: (key, value) => console.log(`   ${key.padEnd(15)}: ${value}`)
};

class SuiTransferBot {
  constructor(keyInput) {
    this.client = new SuiClient({ url: SUI_RPC_URL });
    this.keypair = this.initializeKeypair(keyInput);
    this.address = this.keypair.getPublicKey().toSuiAddress();
  }

  initializeKeypair(keyInput) {
    try {
      if (keyInput.startsWith('suiprivkey')) {
        const { secretKey } = decodeSuiPrivateKey(keyInput);
        return Ed25519Keypair.fromSecretKey(secretKey);
      } else if (keyInput.startsWith('0x') || /^[0-9a-fA-F]{64}$/.test(keyInput)) {
        const privateKeyBytes = Buffer.from(keyInput.startsWith('0x') ? keyInput.slice(2) : keyInput, 'hex');
        return Ed25519Keypair.fromSecretKey(privateKeyBytes);
      } else if (/^[A-Za-z0-9+/=]+$/.test(keyInput) && keyInput.length === 44) {
        const privateKeyBytes = Buffer.from(keyInput, 'base64');
        return Ed25519Keypair.fromSecretKey(privateKeyBytes);
      } else {
        return Ed25519Keypair.deriveKeypair(keyInput);
      }
    } catch (error) {
      logger.error(`Error initializing keypair: ${error.message}`);
      throw error;
    }
  }

  async getBalance() {
    try {
      const coins = await this.client.getCoins({ owner: this.address });
      const totalBalance = coins.data.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
      return totalBalance;
    } catch (error) {
      logger.error(`Error fetching balance: ${error.message}`);
      throw error;
    }
  }

  async transferSui(recipientAddress, amount) {
    logger.processing(`Preparing to transfer ${amount} SUI to ${recipientAddress}`);
    
    const txb = new TransactionBlock();
    const [coin] = txb.splitCoins(txb.gas, [txb.pure(amount * 10**9)]); 
    txb.transferObjects([coin], txb.pure(recipientAddress));
    txb.setGasBudget(10000000);

    try {
      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: txb,
        signer: this.keypair,
        options: { showEffects: true },
        requestType: 'WaitForLocalExecution',
      });

      logger.success(`Transfer completed successfully`);
      logger.result('Transaction Digest', result.digest);
      return result;
    } catch (error) {
      logger.error(`Transfer failed: ${error.message}`);
      throw error;
    }
  }
}

async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function loadRecipientsFromFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const addresses = data
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      logger.success(`Loaded ${addresses.length} recipient addresses from ${filePath}`);
      return addresses;
    } else {
      logger.warning(`File ${filePath} not found`);
      return [];
    }
  } catch (error) {
    logger.error(`Error reading recipient file: ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('\nSUI TOKEN TRANSFER BOT - AIRDROP INSIDERS');
  logger.divider();

  const pkPath = path.join(__dirname, 'pk.txt');
  const receivePath = path.join(__dirname, 'receive.txt');

  if (!fs.existsSync(pkPath)) {
    logger.error('Please create pk.txt with your private key (suiprivkey, hex, base64) or mnemonic phrase');
    process.exit(1);
  }

  const keyInput = fs.readFileSync(pkPath, 'utf8').trim();
  const bot = new SuiTransferBot(keyInput);
  
  logger.wallet(`Sender Address: ${bot.address}`);
  const balance = await bot.getBalance();
  logger.info(`Current Balance: ${(Number(balance) / 10**9).toFixed(4)} SUI`);

  logger.divider();
  console.log('Recipient options:');
  console.log('1. Enter recipient address manually');
  console.log('2. Load recipients from receive.txt');
  const choice = await promptUser('Choose option (1 or 2): ');

  let recipients = [];
  if (choice === '2') {
    recipients = await loadRecipientsFromFile(receivePath);
    if (recipients.length === 0) {
      logger.error('No valid recipients found in receive.txt. Exiting.');
      process.exit(1);
    }
  } else {
    const recipientAddress = await promptUser('Enter recipient wallet address: ');
    if (!recipientAddress.startsWith('0x') || recipientAddress.length < 64) {
      logger.error('Invalid SUI address format');
      process.exit(1);
    }
    recipients = [recipientAddress];
  }

  const amountInput = await promptUser('Enter amount to send per recipient (in SUI): ');
  const amount = parseFloat(amountInput);
  if (isNaN(amount) || amount <= 0) {
    logger.error('Invalid amount entered');
    process.exit(1);
  }

  const totalAmount = amount * recipients.length;
  if (Number(balance) / 10**9 < totalAmount) {
    logger.error(`Insufficient balance. Required: ${totalAmount} SUI, Available: ${(Number(balance) / 10**9).toFixed(4)} SUI`);
    process.exit(1);
  }

  logger.divider();
  logger.info(`Starting transfer process for ${recipients.length} recipient(s)`);
  
  for (let i = 0; i < recipients.length; i++) {
    logger.divider();
    logger.info(`Processing transfer ${i + 1} of ${recipients.length}`);
    try {
      await bot.transferSui(recipients[i], amount);
      logger.success(`Successfully sent ${amount} SUI to ${recipients[i]}`);
    } catch (error) {
      logger.error(`Failed to send to ${recipients[i]}: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  logger.divider();
  logger.success('Transfer process completed!');
  const newBalance = await bot.getBalance();
  logger.info(`New Balance: ${(Number(newBalance) / 10**9).toFixed(4)} SUI`);
}

main().catch(error => {
  logger.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});