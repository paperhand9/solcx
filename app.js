const {
  Connection,
  clusterApiUrl,
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
} = solanaWeb3;
const {
  Token,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = splToken;
const { PhantomWalletAdapter } = walletAdapterWallets;

let connection;
let wallet;
let publicKey;

document.addEventListener("DOMContentLoaded", () => {
  connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
  wallet = new PhantomWalletAdapter();

  document
    .getElementById("connect-wallet")
    .addEventListener("click", connectWallet);
  document
    .getElementById("create-token")
    .addEventListener("click", createToken);

  wallet.on("connect", () => {
    publicKey = wallet.publicKey;
    document.getElementById("wallet-address").textContent = publicKey.toString();
    document.getElementById("create-token").disabled = false;
    hideStatus();
  });

  wallet.on("disconnect", () => {
    publicKey = null;
    document.getElementById("wallet-address").textContent = "Not connected";
    document.getElementById("create-token").disabled = true;
    hideStatus();
  });
});

async function connectWallet() {
  if (!wallet) {
    alert("Phantom wallet not found. Please install it from https://phantom.app/");
    return;
  }
  try {
    await wallet.connect();
  } catch (err) {
    showStatus("Error connecting wallet: " + err.message, "error");
  }
}

async function createToken() {
  const tokenName = document.getElementById("token-name").value.trim();
  const tokenSymbol = document.getElementById("token-symbol").value.trim();
  const tokenDescription = document.getElementById("token-description").value.trim();
  const tokenDecimals = parseInt(document.getElementById("token-decimals").value);
  const tokenSupply = parseInt(document.getElementById("token-supply").value);

  if (!tokenName || !tokenSymbol || !tokenDescription) {
    showStatus("Token name, symbol, and description are required", "error");
    return;
  }
  if (!wallet.connected) {
    showStatus("Please connect your wallet first", "error");
    return;
  }

  showStatus("Creating token...", "loading");

  try {
    const payer = wallet.publicKey;
    const mintAccount = Keypair.generate();

    // Helper to send transaction signed by Phantom wallet
    async function sendAndConfirm(tx, signers = []) {
      tx.feePayer = payer;
      tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
      if (signers.length) tx.partialSign(...signers);
      const signedTx = await wallet.signTransaction(tx);
      const txid = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(txid);
      return txid;
    }

    const lamports = await Token.getMinBalanceRentForExemptMint(connection);

    // Create mint account & initialize mint
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: mintAccount.publicKey,
        space: Token.MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        mintAccount.publicKey,
        tokenDecimals,
        payer,
        null // freezeAuthority disabled
      )
    );
    await sendAndConfirm(createMintTx, [mintAccount]);

    // Create or get associated token account for the wallet
    const associatedTokenAccount = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mintAccount.publicKey,
      payer
    );

    const accountInfo = await connection.getAccountInfo(associatedTokenAccount);
    if (!accountInfo) {
      const createATAIx = Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mintAccount.publicKey,
        associatedTokenAccount,
        payer,
        payer
      );
      await sendAndConfirm(new Transaction().add(createATAIx));
    }

    // Mint tokens to associated token account
    const mintTokensIx = Token.createMintToInstruction(
      TOKEN_PROGRAM_ID,
      mintAccount.publicKey,
      associatedTokenAccount,
      payer,
      [],
      tokenSupply * Math.pow(10, tokenDecimals)
    );
    const mintTx = new Transaction().add(mintTokensIx);
    const mintTxId = await sendAndConfirm(mintTx);

    showStatus("Token created successfully!", "success");
    document.getElementById("token-address").textContent = mintAccount.publicKey.toString();
    document.getElementById("transaction-signature").textContent = mintTxId;
    document.getElementById("token-details").style.display = "block";

  } catch (error) {
    console.error(error);
    showStatus("Error creating token: " + error.message, "error");
  }
}

function showStatus(message, type) {
  const statusElement = document.getElementById("status");
  statusElement.textContent = "";
  statusElement.className = "status";

  if (type === "loading") {
    statusElement.innerHTML = `<div class="loading"></div> ${message}`;
  } else if (type === "success") {
    statusElement.textContent = message;
    statusElement.classList.add("success");
  } else if (type === "error") {
    statusElement.textContent = message;
    statusElement.classList.add("error");
  }
  statusElement.style.display = "block";
}

function hideStatus() {
  const statusElement = document.getElementById("status");
  statusElement.style.display = "none";
}
